// こえ E2E: 起動・50音入力・濁点・定型文・編集追加・localStorage永続を検証
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

const PORT = 8771, CDP = 9335;
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const log = (...a)=>console.log(...a);
let fails = 0;
const check = (name, cond)=>{ log(`${cond?"✅":"❌"} ${name}`); if(!cond) fails++; };

const server = spawn("python3", ["-m","http.server", String(PORT)], { cwd: import.meta.dirname, stdio:"ignore" });
const prof = `/tmp/koe-e2e-${Date.now()}`;
const chrome = spawn(CHROME, [
  `--user-data-dir=${prof}`, "--headless=new", `--remote-debugging-port=${CDP}`,
  "--no-first-run","--no-default-browser-check","--disable-gpu"
], { stdio:"ignore" });

async function wsUrl(){
  for(let i=0;i<40;i++){
    try{
      const r = await fetch(`http://127.0.0.1:${CDP}/json/new?http://127.0.0.1:${PORT}/index.html`, {method:"PUT"});
      const j = await r.json(); if(j.webSocketDebuggerUrl) return j.webSocketDebuggerUrl;
    }catch{}
    await sleep(250);
  }
  throw new Error("CDP not ready");
}

function cdp(ws){
  let id=0; const pending=new Map();
  ws.addEventListener("message", ev=>{
    const m=JSON.parse(ev.data);
    if(m.id && pending.has(m.id)){ pending.get(m.id)(m); pending.delete(m.id); }
  });
  return (method, params={})=> new Promise(res=>{ const i=++id; pending.set(i,res); ws.send(JSON.stringify({id:i,method,params})); });
}
const evalJs = (send, expr)=> send("Runtime.evaluate", {expression:expr, returnByValue:true, awaitPromise:true})
  .then(r=> r.result && r.result.result ? r.result.result.value : undefined);

try{
  await sleep(800);
  const url = await wsUrl();
  const ws = new WebSocket(url);
  await new Promise((res,rej)=>{ ws.onopen=res; ws.onerror=rej; });
  const send = cdp(ws);
  await send("Page.enable"); await send("Runtime.enable");

  // コンソールエラー収集
  const errors=[];
  ws.addEventListener("message", ev=>{
    const m=JSON.parse(ev.data);
    if(m.method==="Runtime.exceptionThrown") errors.push(JSON.stringify(m.params.exceptionDetails?.exception?.description||m.params));
  });

  // ロード待ち
  await send("Page.navigate", {url:`http://127.0.0.1:${PORT}/index.html`});
  await sleep(1200);

  // 1. 起動・プレースホルダ
  check("起動: プレースホルダ表示", await evalJs(send, `document.querySelector('#text').classList.contains('placeholder')`));
  check("起動: タブが描画される(>=2)", await evalJs(send, `document.querySelectorAll('.tab').length >= 2`));
  check("起動: もじタブが存在", await evalJs(send, `[...document.querySelectorAll('.tab')].some(t=>t.textContent.includes('もじ'))`));

  // 2. 50音入力（もじタブへ）
  await evalJs(send, `[...document.querySelectorAll('.tab')].find(t=>t.textContent.includes('もじ')).click(); true`);
  await sleep(150);
  check("50音: 盤が描画される", await evalJs(send, `document.querySelectorAll('#kana .cell:not(.blank)').length > 30`));
  await evalJs(send, `[...document.querySelectorAll('#kana .cell')].find(c=>c.textContent==='あ').click(); true`);
  await evalJs(send, `[...document.querySelectorAll('#kana .cell')].find(c=>c.textContent==='か').click(); true`);
  check("50音: 「あか」と入力される", (await evalJs(send, `document.querySelector('#text').textContent`)) === "あか");

  // 3. 濁点
  await evalJs(send, `[...document.querySelectorAll('.util')].find(b=>b.textContent.includes('濁点')).click(); true`);
  check("濁点: 「あが」になる", (await evalJs(send, `document.querySelector('#text').textContent`)) === "あが");
  // もう一度押すと外れる
  await evalJs(send, `[...document.querySelectorAll('.util')].find(b=>b.textContent.includes('濁点')).click(); true`);
  check("濁点: 再押下で「あか」に戻る", (await evalJs(send, `document.querySelector('#text').textContent`)) === "あか");

  // 4. ⌫ / 全消し
  await evalJs(send, `document.querySelector('#btnBack').click(); true`);
  check("けす: 「あ」になる", (await evalJs(send, `document.querySelector('#text').textContent`)) === "あ");
  await evalJs(send, `document.querySelector('#btnClear').click(); true`);
  check("全消し: プレースホルダに戻る", await evalJs(send, `document.querySelector('#text').classList.contains('placeholder')`));

  // 5. 定型文タップ
  await evalJs(send, `document.querySelector('.tab').click(); true`); // 先頭(きほん)
  await sleep(120);
  const firstPhrase = await evalJs(send, `document.querySelector('.phrase span').textContent`);
  await evalJs(send, `document.querySelector('.phrase').click(); true`);
  check("定型文: タップで表示に反映", (await evalJs(send, `document.querySelector('#text').textContent`)) === firstPhrase);

  // 6. 編集モードで追加
  const before = await evalJs(send, `document.querySelectorAll('.phrase').length`);
  await evalJs(send, `document.querySelector('#btnEdit').click(); true`);
  check("編集: 追加ボタンが表示", await evalJs(send, `getComputedStyle(document.querySelector('.addphrase')).display !== 'none'`));
  await evalJs(send, `document.querySelector('.addphrase').click(); true`);
  await sleep(120);
  await evalJs(send, `document.querySelector('#modalInput').value='テスト追加語'; document.querySelector('#modalBtns .sb-ok').click(); true`);
  await sleep(120);
  const after = await evalJs(send, `document.querySelectorAll('.phrase').length`);
  check("編集: 定型文が1件増える", after === before + 1);
  check("編集: 追加語が末尾に存在", await evalJs(send, `[...document.querySelectorAll('.phrase span')].some(s=>s.textContent==='テスト追加語')`));
  check("永続: localStorageに保存される", await evalJs(send, `JSON.stringify(JSON.parse(localStorage.getItem('koe.phrases.v1'))).includes('テスト追加語')`));

  // 7. リロードしても残る
  await send("Page.navigate", {url:`http://127.0.0.1:${PORT}/index.html`});
  await sleep(1000);
  check("永続: リロード後も追加語が残る", await evalJs(send, `[...document.querySelectorAll('.phrase span')].some(s=>s.textContent==='テスト追加語')`));

  // 8. フォント倍率
  await evalJs(send, `[...document.querySelectorAll('#fontBtns .fbtn')].find(b=>b.dataset.fs==='1.2').click(); true`);
  check("文字大: --fs が1.2", (await evalJs(send, `getComputedStyle(document.documentElement).getPropertyValue('--fs').trim()`)) === "1.2");

  check("JSエラーが無い", errors.length === 0);
  if(errors.length) log("  errors:", errors);

  ws.close();
}catch(e){
  log("❌ テスト実行エラー:", e.message); fails++;
}finally{
  chrome.kill("SIGKILL"); server.kill("SIGKILL");
  await sleep(200);
  log(fails===0 ? "\n🎉 全テスト PASS" : `\n⚠️ ${fails}件 FAIL`);
  process.exit(fails===0?0:1);
}
