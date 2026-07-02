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

  // 1. 起動・プレースホルダ・デフォルトもじ
  check("起動: プレースホルダ表示", await evalJs(send, `document.querySelector('#text').classList.contains('placeholder')`));
  check("起動: タブが描画される(>=2)", await evalJs(send, `document.querySelectorAll('.tab').length >= 2`));
  check("起動: 先頭タブがもじ", await evalJs(send, `document.querySelector('.tab').textContent.includes('もじ')`));
  check("起動: デフォルトで50音盤が表示", await evalJs(send, `document.querySelectorAll('#kana .cell:not(.blank)').length > 30`));
  check("起動: body.kana-mode が付く", await evalJs(send, `document.body.classList.contains('kana-mode')`));
  check("もじ時: フッター(編集/文字サイズ)が非表示", await evalJs(send, `getComputedStyle(document.querySelector('#footer')).display === 'none'`));

  // 2. 50音入力（既にもじタブ）
  check("50音: 盤が描画される", await evalJs(send, `document.querySelectorAll('#kana .cell:not(.blank)').length > 30`));
  await evalJs(send, `[...document.querySelectorAll('#kana .cell')].find(c=>c.textContent==='あ').click(); true`);
  await evalJs(send, `[...document.querySelectorAll('#kana .cell')].find(c=>c.textContent==='か').click(); true`);
  check("50音: 「あか」と入力される", (await evalJs(send, `document.querySelector('#text').textContent`)) === "あか");

  // 3. 濁点（盤に埋め込まれた機能キー）
  check("濁点: 盤の機能キーとして存在", await evalJs(send, `!!document.querySelector('#kana .cell.fn[data-fn="dakuten"]')`));
  check("半濁: 盤の機能キーとして存在", await evalJs(send, `!!document.querySelector('#kana .cell.fn[data-fn="handakuten"]')`));
  await evalJs(send, `document.querySelector('#kana .cell.fn[data-fn="dakuten"]').click(); true`);
  check("濁点: 「あが」になる", (await evalJs(send, `document.querySelector('#text').textContent`)) === "あが");
  // もう一度押すと外れる
  await evalJs(send, `document.querySelector('#kana .cell.fn[data-fn="dakuten"]').click(); true`);
  check("濁点: 再押下で「あか」に戻る", (await evalJs(send, `document.querySelector('#text').textContent`)) === "あか");

  // 3.5 濁音・小文字ボード（新カテゴリ）
  await evalJs(send, `document.querySelector('#btnClear').click(); true`);
  check("濁音ボード: タブが存在", await evalJs(send, `[...document.querySelectorAll('.tab')].some(t=>t.textContent.includes('濁音'))`));
  await evalJs(send, `[...document.querySelectorAll('.tab')].find(t=>t.textContent.includes('濁音')).click(); true`);
  await sleep(120);
  check("濁音ボード: body.daku-mode が付く", await evalJs(send, `document.body.classList.contains('daku-mode')`));
  check("濁音ボード: もじ盤(#kana)は出ない", await evalJs(send, `!document.querySelector('#kana')`));
  check("濁音ボード: セクションが3つ以上", await evalJs(send, `document.querySelectorAll('.board-sec').length >= 3`));
  check("濁音ボード: 「ぱ」が直接入力できる", await (async()=>{ await evalJs(send, `[...document.querySelectorAll('.board-grid .cell')].find(c=>c.textContent==='ぱ').click(); true`); return (await evalJs(send, `document.querySelector('#text').textContent`)) === "ぱ"; })());
  check("濁音ボード: 拗音「きゃ」が1タップ入力できる", await (async()=>{ await evalJs(send, `[...document.querySelectorAll('.board-grid .cell')].find(c=>c.textContent==='きゃ').click(); true`); return (await evalJs(send, `document.querySelector('#text').textContent`)) === "ぱきゃ"; })());
  check("濁音ボード: もじ盤に戻れる", await (async()=>{ await evalJs(send, `[...document.querySelectorAll('.tab')].find(t=>t.textContent.includes('もじ')).click(); document.querySelector('#btnClear').click(); true`); return await evalJs(send, `!!document.querySelector('#kana') && !document.body.classList.contains('daku-mode')`); })());
  // 入力欄をリセットして従来テストへ
  await evalJs(send, `[...document.querySelectorAll('#kana .cell')].find(c=>c.textContent==='あ').click(); [...document.querySelectorAll('#kana .cell')].find(c=>c.textContent==='か').click(); true`);

  // 4. ⌫ / 全消し
  await evalJs(send, `document.querySelector('#btnBack').click(); true`);
  check("けす: 「あ」になる", (await evalJs(send, `document.querySelector('#text').textContent`)) === "あ");
  await evalJs(send, `document.querySelector('#btnClear').click(); true`);
  check("全消し: プレースホルダに戻る", await evalJs(send, `document.querySelector('#text').classList.contains('placeholder')`));

  // 5. 定型文タップ（きほんタブへ）
  await evalJs(send, `[...document.querySelectorAll('.tab')].find(t=>t.textContent.includes('きほん')).click(); true`);
  await sleep(120);
  check("定型文時: フッターが表示される", await evalJs(send, `getComputedStyle(document.querySelector('#footer')).display !== 'none'`));
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

  // 7. リロードしても残る（デフォルトもじ→きほんへ切替して確認）
  await send("Page.navigate", {url:`http://127.0.0.1:${PORT}/index.html`});
  await sleep(1000);
  await evalJs(send, `[...document.querySelectorAll('.tab')].find(t=>t.textContent.includes('きほん')).click(); true`);
  await sleep(150);
  check("永続: リロード後も追加語が残る", await evalJs(send, `[...document.querySelectorAll('.phrase span')].some(s=>s.textContent==='テスト追加語')`));

  // 7.5 並べ替え: 定型文を長押しドラッグで先頭2件を入れ替え（きほんタブ表示中）
  // ※ .phrase 内には本文spanと編集バッジspanがあるため、本文(最初のspan)だけを読む
  const pOrder0 = await evalJs(send, `JSON.stringify([...document.querySelectorAll('.phrase')].map(p=>p.querySelector('span').textContent))`);
  await evalJs(send, `(()=>{
    const it=[...document.querySelectorAll('.phrase')]; const a=it[0], b=it[1];
    const rb=b.getBoundingClientRect();
    a.dispatchEvent(new PointerEvent('pointerdown',{pointerId:1,button:0,clientX:1,clientY:1,bubbles:true}));
    window.__pt={x:rb.left+rb.width/2, y:rb.top+rb.height/2};
    return true; })()`);
  await sleep(750); // 長押し成立を待つ（タイマー450ms+余裕）
  await evalJs(send, `(()=>{
    const a=document.querySelectorAll('.phrase')[0];
    a.dispatchEvent(new PointerEvent('pointermove',{pointerId:1,clientX:window.__pt.x,clientY:window.__pt.y,bubbles:true}));
    a.dispatchEvent(new PointerEvent('pointerup',{pointerId:1,clientX:window.__pt.x,clientY:window.__pt.y,bubbles:true}));
    return true; })()`);
  await sleep(150);
  check("並べ替え: 定型文の先頭2件が入れ替わる", await evalJs(send, `(()=>{const o=JSON.parse(${JSON.stringify(pOrder0)});const n=[...document.querySelectorAll('.phrase')].map(p=>p.querySelector('span').textContent);return n[0]===o[1]&&n[1]===o[0];})()`));
  check("並べ替え: 定型文順がlocalStorageに保存", await evalJs(send, `(()=>{const n=[...document.querySelectorAll('.phrase')].map(p=>p.querySelector('span').textContent);const s=JSON.parse(localStorage.getItem('koe.phrases.v1'))['きほん'];return s[0]===n[0]&&s[1]===n[1];})()`));

  // 7.6 並べ替え: カテゴリ(タブ)を長押しドラッグで先頭2件を入れ替え
  const cOrder0 = await evalJs(send, `JSON.stringify([...document.querySelectorAll('.tab.cat')].map(t=>t.dataset.cat))`);
  await evalJs(send, `(()=>{
    const t=[...document.querySelectorAll('.tab.cat')]; const a=t[0], b=t[1];
    const rb=b.getBoundingClientRect();
    a.dispatchEvent(new PointerEvent('pointerdown',{pointerId:2,button:0,clientX:1,clientY:1,bubbles:true}));
    window.__ct={x:rb.left+rb.width/2, y:rb.top+rb.height/2};
    return true; })()`);
  await sleep(750);
  await evalJs(send, `(()=>{
    const a=document.querySelectorAll(".tab.cat")[0];
    a.dispatchEvent(new PointerEvent('pointermove',{pointerId:2,clientX:window.__ct.x,clientY:window.__ct.y,bubbles:true}));
    a.dispatchEvent(new PointerEvent('pointerup',{pointerId:2,clientX:window.__ct.x,clientY:window.__ct.y,bubbles:true}));
    return true; })()`);
  await sleep(150);
  check("並べ替え: カテゴリの先頭2件が入れ替わる", await evalJs(send, `(()=>{const o=JSON.parse(${JSON.stringify(cOrder0)});const n=[...document.querySelectorAll('.tab.cat')].map(t=>t.dataset.cat);return n[0]===o[1]&&n[1]===o[0];})()`));
  check("並べ替え: もじタブは先頭のまま固定", await evalJs(send, `document.querySelector('.tab').textContent.includes('もじ')`));
  check("並べ替え: カテゴリ順がlocalStorageに保存", await evalJs(send, `(()=>{const n=[...document.querySelectorAll('.tab.cat')].map(t=>t.dataset.cat);const k=Object.keys(JSON.parse(localStorage.getItem('koe.phrases.v1')));return k[0]===n[0]&&k[1]===n[1];})()`));

  // 7.7 バックアップ: export payload / import 検証 / UI 表示
  check("バックアップ: export payload が localStorage と一致", await evalJs(send, `(()=>{const p=buildExportPayload();return p.app==='koe-board'&&p.key==='koe.phrases.v1'&&typeof p.exportedAt==='string'&&JSON.stringify(p.phrases)===localStorage.getItem('koe.phrases.v1');})()`));
  check("バックアップ: 不正な形式の import は拒否+localStorage不変", await evalJs(send, `(()=>{const before=localStorage.getItem('koe.phrases.v1');const r=applyImportedPhrases({phrases:{"x":123}});return r.ok===false&&localStorage.getItem('koe.phrases.v1')===before;})()`));
  check("バックアップ: 空オブジェクトの import は拒否される", await evalJs(send, `applyImportedPhrases({}).ok===false`));
  check("バックアップ: 正常な import で置き換え+localStorage反映", await evalJs(send, `(()=>{const r=applyImportedPhrases({app:'koe-board',phrases:{'よみこみ確認':['テスト読込語','はい']}});const s=JSON.parse(localStorage.getItem('koe.phrases.v1'));return r.ok===true&&r.count===1&&s['よみこみ確認'][0]==='テスト読込語';})()`));
  check("バックアップ: import 後にタブ・ことばが再描画される", await evalJs(send, `[...document.querySelectorAll('.tab.cat')].map(t=>t.dataset.cat).join()==='よみこみ確認' && [...document.querySelectorAll('.phrase span')].some(s=>s.textContent==='テスト読込語')`));
  await evalJs(send, `document.querySelector('#btnEdit').click(); true`);
  await sleep(120);
  check("バックアップ: 編集モードでボタン2つが表示される", await evalJs(send, `(()=>{const b=document.querySelector('.backupbar');return !!b&&getComputedStyle(b).display==='flex'&&b.querySelectorAll('.bkbtn').length===2;})()`));
  await evalJs(send, `document.querySelector('#btnEdit').click(); true`);
  await sleep(120);
  check("バックアップ: 通常モードではボタン非表示", await evalJs(send, `getComputedStyle(document.querySelector('.backupbar')).display==='none'`));

  // 8. フォント倍率（定型文タブ表示中＝フッター見える状態で）
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
