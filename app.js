'use strict';

/* =========================================================
   こえ — 構音障害（口の麻痺で話せない）の方のための文字盤＋読み上げPWA
   - 50音を直接タップして文章を組み立て、読み上げる
   - よく使う定型文はカテゴリ別に1タップで読み上げ
   - 定型文は端末内（localStorage）に保存。追加・編集・削除できる
   ========================================================= */

/* ---------- 初期搭載の定型文（ベッドサイド・在宅介護のベストプラクティスを翻案） ----------
   出典の考え方:
   - ICU/ベッドサイド標準の基礎語彙（はい/いいえ/痛い/トイレ/水/止めて/ありがとう 等）
   - 患者向けボードの分類（体調・してほしいこと・体の症状と痛み・気持ち）
   - 高頻度のコア語彙（〜したい/〜がほしい）を1タップに
   家族で自由に編集してください。 */
const DEFAULT_PHRASES = {
  "きほん": [
    "はい", "いいえ", "ありがとう", "ごめんね", "おねがいします",
    "だいじょうぶ", "わからない", "もう一度言って", "ちょっと待って",
    "そうです", "ちがいます", "やめて・止めて"
  ],
  "からだ・体調": [
    "トイレに行きたい", "おしっこ", "うんち", "痛い", "かゆい",
    "苦しい", "気持ちが悪い", "暑い", "寒い", "のどが渇いた",
    "おなかがすいた", "疲れた", "眠い", "めまいがする", "しびれる",
    "口の中をきれいにして", "痰をとって"
  ],
  "してほしい": [
    "水がほしい", "お茶がほしい", "体の向きを変えて", "起こして", "寝かせて",
    "毛布をかけて", "毛布をとって", "電気をつけて", "電気を消して",
    "テレビをつけて", "テレビを消して", "メガネを取って",
    "窓を開けて", "窓を閉めて", "薬がほしい", "看護師さんを呼んで"
  ],
  "痛み・どこ": [
    "頭", "目", "口の中", "のど", "胸", "おなか", "背中", "腰",
    "手", "足", "とても痛い", "少し痛い", "だんだん痛くなってきた", "ここが痛い"
  ],
  "きもち": [
    "うれしい", "たのしい", "つらい", "かなしい", "不安です",
    "さみしい", "会いたい", "安心した", "がんばる", "ありがとう、感謝してます"
  ],
  "あいさつ": [
    "おはよう", "こんにちは", "こんばんは", "おやすみ",
    "いってらっしゃい", "おかえり", "また来てね", "気をつけてね"
  ],
  "かぞく・じぶん": [
    "孫に会いたい", "家に帰りたい", "（家族の名前）", "（かかりつけの先生）", "（飲んでいる薬）"
  ]
};

/* ---------- 50音盤（あ列が右・縦に あいうえお） ----------
   わ・を・ん を左列の上に詰め、空いた左下・や列下に
   濁点／半濁／小文字／ー を「あいうえお」と同じ大きさで配置する。
   "fn:xxx" は機能キー（後段の FN_KEYS と対応）。 */
const KANA_ROWS = [
  ["わ",          "ら","や",      "ま","は","な","た","さ","か","あ"], // あ段
  ["を",          "り","ゆ",      "み","ひ","に","ち","し","き","い"], // い段
  ["ん",          "る","よ",      "む","ふ","ぬ","つ","す","く","う"], // う段
  ["fn:dakuten",  "れ","fn:small","め","へ","ね","て","せ","け","え"], // え段
  ["fn:handakuten","ろ","fn:dash","も","ほ","の","と","そ","こ","お"]  // お段
];

// 濁点・半濁点・小書き 変換マップ
const DAKUTEN = {
  "か":"が","き":"ぎ","く":"ぐ","け":"げ","こ":"ご",
  "さ":"ざ","し":"じ","す":"ず","せ":"ぜ","そ":"ぞ",
  "た":"だ","ち":"ぢ","つ":"づ","て":"で","と":"ど",
  "は":"ば","ひ":"び","ふ":"ぶ","へ":"べ","ほ":"ぼ",
  "う":"ゔ"
};
const HANDAKUTEN = {"は":"ぱ","ひ":"ぴ","ふ":"ぷ","へ":"ぺ","ほ":"ぽ"};
const SMALL = {
  "あ":"ぁ","い":"ぃ","う":"ぅ","え":"ぇ","お":"ぉ",
  "や":"ゃ","ゆ":"ゅ","よ":"ょ","つ":"っ","わ":"ゎ"
};
// 逆変換（同じキーで戻せるように）
const REV_DAKUTEN = invert(DAKUTEN);
const REV_HANDAKUTEN = invert(HANDAKUTEN);
const REV_SMALL = invert(SMALL);
function invert(o){const r={};for(const k in o)r[o[k]]=k;return r;}

// 盤に埋め込む機能キー（濁点・半濁・小文字・長音）
const FN_KEYS = {
  "fn:dakuten":    {sym:"゛", nm:"だくてん", run:()=>toggleLast(DAKUTEN, REV_DAKUTEN)},
  "fn:handakuten": {sym:"゜", nm:"はんだく", run:()=>toggleLast(HANDAKUTEN, REV_HANDAKUTEN)},
  "fn:small":      {sym:"小", nm:"ちいさく", run:()=>toggleLast(SMALL, REV_SMALL)},
  "fn:dash":       {sym:"ー", nm:"のばす",   run:()=>appendChar("ー")}
};

/* ---------- 濁音・半濁音・小さい文字（拗音）ボード ----------
   紙の文字盤の「濁音／半濁音」「小さい文字」コーナーをそのまま1タップ入力に。
   き→や→小 のように3回押す手間をなくす。 */
const DAKU_TAB = "濁音・半濁・小";
// 濁音＋半濁音: 右から が ざ だ ば ぱ（もじ盤＝あが右、と同じ並び）、段=あいうえお（5列×5段）
const DAKUON_ROWS = [
  ["ぱ","ば","だ","ざ","が"],
  ["ぴ","び","ぢ","じ","ぎ"],
  ["ぷ","ぶ","づ","ず","ぐ"],
  ["ぺ","べ","で","ぜ","げ"],
  ["ぽ","ぼ","ど","ぞ","ご"]
];
// 拗音 前半: 紙の文字盤と同じ並び（右から き ぎ し じ ち ぢ）、段=ゃゅょ
const YOUON_A = [
  ["ぢゃ","ちゃ","じゃ","しゃ","ぎゃ","きゃ"],
  ["ぢゅ","ちゅ","じゅ","しゅ","ぎゅ","きゅ"],
  ["ぢょ","ちょ","じょ","しょ","ぎょ","きょ"]
];
// 拗音 後半: 紙の文字盤と同じ並び（右から に ひ び ぴ み り）、段=ゃゅょ
const YOUON_B = [
  ["りゃ","みゃ","ぴゃ","びゃ","ひゃ","にゃ"],
  ["りゅ","みゅ","ぴゅ","びゅ","ひゅ","にゅ"],
  ["りょ","みょ","ぴょ","びょ","ひょ","にょ"]
];
// 単体の小書き文字＋長音（っ＝小さいつ 等）
const KOGAKI = ["ぁ","ぃ","ぅ","ぇ","ぉ","っ","ゃ","ゅ","ょ","ー"];

/* ---------- 状態 ---------- */
const LS_PHRASES = "koe.phrases.v1";
const LS_FS = "koe.fontscale.v1";
let phrases = loadPhrases();
let activeTab = "もじ";   // デフォルトは50音文字盤
let editing = false;

/* ---------- DOM ---------- */
const $ = s => document.querySelector(s);
const textEl = $("#text");
const tabsEl = $("#tabs");
const mainEl = $("#main");

/* ---------- 文章バッファ ---------- */
let buffer = "";
function renderText(){
  if(buffer === ""){
    textEl.textContent = "ここに ことばが でます";
    textEl.classList.add("placeholder");
  }else{
    textEl.textContent = buffer;
    textEl.classList.remove("placeholder");
  }
}
function appendChar(ch){ buffer += ch; renderText(); }
function backspace(){ buffer = buffer.slice(0,-1); renderText(); }
function clearAll(){ buffer = ""; renderText(); }

/* ---------- 読み上げ（Web Speech API） ---------- */
let jaVoice = null;
function pickVoice(){
  const vs = window.speechSynthesis ? speechSynthesis.getVoices() : [];
  jaVoice = vs.find(v=>/ja[-_]?JP/i.test(v.lang)) || vs.find(v=>/^ja/i.test(v.lang)) || null;
}
if(window.speechSynthesis){
  pickVoice();
  speechSynthesis.onvoiceschanged = pickVoice;
}
function speak(t){
  t = (t||"").trim();
  if(!t) return;
  if(!window.speechSynthesis){ return; }
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(t);
  u.lang = "ja-JP";
  if(jaVoice) u.voice = jaVoice;
  u.rate = 0.95;   // 少しゆっくり
  u.pitch = 1.0;
  speechSynthesis.speak(u);
}

/* ---------- 長押しドラッグで並べ替え ----------
   - 0.45秒の長押しで「移動モード」に入り、指でドラッグして並べ替える
   - 普通のタップ（短押し）は従来通り読み上げ／タブ切替として動く
   - 編集モードのON/OFFに関わらず使える */
let lastReorderTs = 0;   // 直前の並べ替え完了時刻（直後のクリック誤発火を抑止）

function enableLongPressReorder(container, selector, commit){
  container.querySelectorAll(selector).forEach(el=>{
    el.addEventListener("pointerdown", ev=>{
      if(ev.button && ev.button !== 0) return;
      const sx = ev.clientX, sy = ev.clientY, pid = ev.pointerId;
      const cancel = ()=>{
        clearTimeout(timer);
        el.removeEventListener("pointermove", premove);
        el.removeEventListener("pointerup", preup);
        el.removeEventListener("pointercancel", preup);
      };
      const premove = e=>{ if(Math.hypot(e.clientX-sx, e.clientY-sy) > 14) cancel(); };
      const preup = ()=>cancel();
      el.addEventListener("pointermove", premove);
      el.addEventListener("pointerup", preup);
      el.addEventListener("pointercancel", preup);
      const timer = setTimeout(()=>{ cancel(); startDrag(el, container, selector, commit, pid); }, 450);
    });
  });
}

function startDrag(el, container, selector, commit, pid){
  el.classList.add("dragging");
  try{ navigator.vibrate && navigator.vibrate(15); }catch(e){}
  try{ el.setPointerCapture(pid); }catch(e){}

  // ★ドラッグ中だけネイティブのスクロールを止める（縦ドラッグがスクロールに奪われるのを防ぐ）
  //   touch-action は touchstart 時点で確定するため、長押し成立後に非passiveの touchmove で抑止する
  const blockScroll = e=>{ e.preventDefault(); };
  document.addEventListener("touchmove", blockScroll, {passive:false});

  // ★端までドラッグしたらリストを自動スクロール（画面外の項目にも届く）
  const scroller = el.closest("#tabs") || el.closest("#main") || mainEl;
  const horizontal = scroller.id === "tabs";
  const pt = {x:0, y:0};
  const tick = ()=>{
    const r = scroller.getBoundingClientRect(), edge = 56, step = 14;
    if(horizontal){
      if(pt.x && pt.x < r.left + edge) scroller.scrollLeft -= step;
      else if(pt.x && pt.x > r.right - edge) scroller.scrollLeft += step;
    }else if(pt.y){
      if(pt.y < r.top + edge) scroller.scrollTop -= step;
      else if(pt.y > r.bottom - edge) scroller.scrollTop += step;
    }
    raf = requestAnimationFrame(tick);
  };
  let raf = requestAnimationFrame(tick);

  const onMove = e=>{
    e.preventDefault();
    pt.x = e.clientX; pt.y = e.clientY;
    const prevPE = el.style.pointerEvents; el.style.pointerEvents = "none";
    const t = document.elementFromPoint(e.clientX, e.clientY);
    el.style.pointerEvents = prevPE;
    const over = t && t.closest(selector);
    if(over && over !== el && over.parentNode === container){
      const items = [...container.children].filter(n=>n.matches && n.matches(selector));
      // 移動方向に応じて前 or 後ろに差し込む（縦リストでも2列グリッドでも横タブでも自然に動く）
      if(items.indexOf(el) < items.indexOf(over)) container.insertBefore(el, over.nextSibling);
      else container.insertBefore(el, over);
    }
  };
  const onUp = ()=>{
    el.classList.remove("dragging");
    try{ el.releasePointerCapture(pid); }catch(e){}
    document.removeEventListener("touchmove", blockScroll, {passive:false});
    cancelAnimationFrame(raf);
    el.removeEventListener("pointermove", onMove);
    el.removeEventListener("pointerup", onUp);
    el.removeEventListener("pointercancel", onUp);
    lastReorderTs = Date.now();
    commit();
  };
  el.addEventListener("pointermove", onMove);
  el.addEventListener("pointerup", onUp);
  el.addEventListener("pointercancel", onUp);
}

function commitPhraseOrder(cat, container){
  const order = [...container.querySelectorAll(".phrase")].map(el=>parseInt(el.dataset.idx, 10));
  const arr = phrases[cat] || [];
  phrases[cat] = order.map(i=>arr[i]).filter(v=>v !== undefined);
  savePhrases();
  renderMain();
}

function commitCategoryOrder(){
  const order = [...tabsEl.querySelectorAll(".tab.cat")].map(el=>el.dataset.cat);
  const next = {};
  order.forEach(c=>{ if(phrases[c]) next[c] = phrases[c]; });
  Object.keys(phrases).forEach(c=>{ if(!(c in next)) next[c] = phrases[c]; }); // 漏れ保全
  phrases = next;
  savePhrases();
  renderTabs(); renderMain();
}

/* ---------- タブ描画 ---------- */
function renderTabs(){
  tabsEl.innerHTML = "";
  // もじ（50音）タブを先頭に（デフォルト表示のため）
  const kb = document.createElement("button");
  kb.className = "tab" + (activeTab==="もじ"?" active":"");
  kb.textContent = "🔤 もじ";
  kb.onclick = ()=>{ activeTab="もじ"; renderTabs(); renderMain(); };
  tabsEl.appendChild(kb);
  // 濁音・半濁音・小さい文字ボード（もじと同じ固定ボードタブ。並べ替え対象外）
  const dk = document.createElement("button");
  dk.className = "tab" + (activeTab===DAKU_TAB?" active":"");
  dk.textContent = DAKU_TAB;
  dk.onclick = ()=>{ activeTab=DAKU_TAB; renderTabs(); renderMain(); };
  tabsEl.appendChild(dk);
  // 定型文カテゴリ
  Object.keys(phrases).forEach(cat=>{
    const b = document.createElement("button");
    b.className = "tab cat" + (activeTab===cat?" active":"");
    b.dataset.cat = cat;
    b.textContent = cat;
    b.onclick = ()=>{
      if(Date.now() - lastReorderTs < 300) return;   // 並べ替え直後の誤タップ抑止
      activeTab = cat; renderTabs(); renderMain();
    };
    tabsEl.appendChild(b);
  });
  // カテゴリタブを長押しドラッグで並べ替え可能に（もじタブは固定）
  enableLongPressReorder(tabsEl, ".tab.cat", commitCategoryOrder);
}

/* ---------- メイン描画 ---------- */
function renderMain(){
  mainEl.innerHTML = "";
  document.body.classList.toggle("kana-mode", activeTab === "もじ");
  document.body.classList.toggle("daku-mode", activeTab === DAKU_TAB);
  if(activeTab === "もじ"){ renderKana(); }
  else if(activeTab === DAKU_TAB){ renderDakuBoard(); }
  else { renderPhrases(activeTab); }
}

function renderKana(){
  const grid = document.createElement("div");
  grid.id = "kana";
  KANA_ROWS.forEach(row=>{
    row.forEach((ch,col)=>{
      const c = document.createElement("div");
      if(ch === ""){ c.className = "cell blank"; }
      else if(ch.indexOf("fn:") === 0){
        const f = FN_KEYS[ch];
        c.className = "cell fn";   // 機能キー（濁点等）は青のまま・色分け対象外
        c.dataset.fn = ch.slice(3);
        c.innerHTML = `<span class="sym">${f.sym}</span><span class="nm">${f.nm}</span>`;
        c.onclick = f.run;
      }else{
        // かな文字は列ごとに交互オレンジでグルーピング（右端「あ」列に色が付く）
        c.className = "cell " + (col % 2 === 1 ? "c-tint" : "c-plain");
        c.textContent = ch;
        c.onclick = ()=>{ appendChar(ch); speak(ch); };   // 押した1文字を読み上げる
      }
      grid.appendChild(c);
    });
  });
  mainEl.appendChild(grid);

  // 機能キー（句読点・空白）— 濁点/半濁/小/ー は盤に移動済み
  const util = document.createElement("div");
  util.id = "kanaUtil";
  const utils = [
    ["、", ()=>appendChar("、")],
    ["。", ()=>appendChar("。")],
    ["？", ()=>appendChar("？")],
    ["！", ()=>appendChar("！")],
    ["␣ 空白", ()=>appendChar("　")]
  ];
  utils.forEach(([label,fn])=>{
    const b = document.createElement("button");
    b.className = "util"; b.textContent = label; b.onclick = fn;
    util.appendChild(b);
  });
  mainEl.appendChild(util);
}

// 最後の文字に濁点等を付け外し
function toggleLast(map, rev){
  if(!buffer) return;
  const last = buffer.slice(-1);
  let next = null;
  if(map[last]) next = map[last];        // 付ける
  else if(rev[last]) next = rev[last];   // 既に付いていたら外す
  if(next){ buffer = buffer.slice(0,-1) + next; renderText(); speak(next); }
}

/* 濁音・半濁音・小さい文字ボードを描画（セクション＋スクロール）
   theme: 配色テーマ（daku=暖色 / youon=緑 / kogaki=灰）
   tintEven: 列番号が偶数のときに濃い色を付けるか（紙の文字盤の配色に合わせて段ごとに調整） */
function renderDakuBoard(){
  const section = (title, rows, cols, theme, tintEven)=>{
    const sec = document.createElement("div");
    sec.className = "board-sec";
    if(title){
      const h = document.createElement("div");
      h.className = "board-h"; h.textContent = title;
      sec.appendChild(h);
    }
    const g = document.createElement("div");
    g.className = "board-grid theme-" + theme;
    g.style.gridTemplateColumns = `repeat(${cols},1fr)`;
    rows.flat().forEach((ch,i)=>{
      const c = document.createElement("div");
      if(ch === ""){ c.className = "cell blank"; }
      else{
        const col = i % cols;                       // 列番号で交互に色付け（＝五十音の行ごとにグルーピング）
        const tinted = (col % 2 === 0) === tintEven;
        c.className = "cell " + (tinted ? "c-tint" : "c-plain");
        c.textContent = ch;
        c.onclick = ()=>{ appendChar(ch); speak(ch); };   // 1タップで入力＋読み上げ
      }
      g.appendChild(c);
    });
    sec.appendChild(g);
    return sec;
  };
  mainEl.appendChild(section("濁音・半濁音", DAKUON_ROWS, 5, "daku", true));
  mainEl.appendChild(section("小さい文字（ゃ ゅ ょ）", YOUON_A, 6, "youon", true));
  mainEl.appendChild(section("", YOUON_B, 6, "youon", false));
  mainEl.appendChild(section("小書き・のばす", [KOGAKI], KOGAKI.length, "kogaki", true));
}

function renderPhrases(cat){
  // 並べ替えの案内
  const hint = document.createElement("div");
  hint.className = "reorder-hint";
  hint.textContent = "長押しで ことば・タブ を並べ替えできます";
  mainEl.appendChild(hint);

  const wrap = document.createElement("div");
  wrap.id = "phrases";
  (phrases[cat]||[]).forEach((p,idx)=>{
    const b = document.createElement("button");
    b.className = "phrase";
    b.dataset.idx = idx;
    b.innerHTML = `<span>${escapeHtml(p)}</span><span class="edit-badge">✎</span>`;
    b.onclick = ()=>{
      if(Date.now() - lastReorderTs < 300) return;   // 並べ替え直後の誤タップ抑止
      if(editing){ openEditPhrase(cat, idx); }
      else{ buffer = p; renderText(); speak(p); }
    };
    wrap.appendChild(b);
  });
  // 追加ボタン（編集モード時のみ表示）
  const add = document.createElement("button");
  add.className = "addphrase"; add.textContent = "＋ ことばを追加";
  add.onclick = ()=>openAddPhrase(cat);
  wrap.appendChild(add);
  mainEl.appendChild(wrap);

  // 定型文を長押しドラッグで並べ替え可能に
  enableLongPressReorder(wrap, ".phrase", ()=>commitPhraseOrder(cat, wrap));
}

function escapeHtml(s){return s.replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));}

/* ---------- 編集モーダル ---------- */
const modal = $("#modal");
const modalTitle = $("#modalTitle");
const modalInput = $("#modalInput");
const modalBtns = $("#modalBtns");

function openModal(title, value, buttons){
  modalTitle.textContent = title;
  modalInput.value = value;
  modalBtns.innerHTML = "";
  buttons.forEach(b=>{
    const el = document.createElement("button");
    el.className = b.cls; el.textContent = b.label; el.onclick = b.fn;
    modalBtns.appendChild(el);
  });
  modal.classList.add("show");
  setTimeout(()=>modalInput.focus(), 50);
}
function closeModal(){ modal.classList.remove("show"); }

function openAddPhrase(cat){
  openModal("ことばを追加", "", [
    {cls:"sb-ok", label:"追加する", fn:()=>{
      const v = modalInput.value.trim();
      if(v){ phrases[cat].push(v); savePhrases(); renderMain(); }
      closeModal();
    }},
    {cls:"sb-cancel", label:"やめる", fn:closeModal}
  ]);
}
function openEditPhrase(cat, idx){
  openModal("ことばを編集", phrases[cat][idx], [
    {cls:"sb-ok", label:"なおす", fn:()=>{
      const v = modalInput.value.trim();
      if(v){ phrases[cat][idx] = v; savePhrases(); renderMain(); }
      closeModal();
    }},
    {cls:"sb-del", label:"削除", fn:()=>{
      phrases[cat].splice(idx,1); savePhrases(); renderMain(); closeModal();
    }},
    {cls:"sb-cancel", label:"やめる", fn:closeModal}
  ]);
}

/* ---------- 保存・読み込み ---------- */
function loadPhrases(){
  try{
    const raw = localStorage.getItem(LS_PHRASES);
    if(raw){ const o = JSON.parse(raw); if(o && typeof o==="object") return o; }
  }catch(e){}
  return JSON.parse(JSON.stringify(DEFAULT_PHRASES));
}
function savePhrases(){
  try{ localStorage.setItem(LS_PHRASES, JSON.stringify(phrases)); }catch(e){}
}

/* ---------- フォント倍率 ---------- */
function setFontScale(fs){
  document.documentElement.style.setProperty("--fs", fs);
  try{ localStorage.setItem(LS_FS, String(fs)); }catch(e){}
  document.querySelectorAll("#fontBtns .fbtn").forEach(b=>{
    b.classList.toggle("on", b.dataset.fs === String(fs));
  });
}

/* ---------- イベント ---------- */
$("#btnSpeak").onclick = ()=>speak(buffer);
$("#btnBack").onclick = backspace;
$("#btnClear").onclick = clearAll;
$("#btnEdit").onclick = ()=>{
  editing = !editing;
  document.body.classList.toggle("editing", editing);
  $("#btnEdit").classList.toggle("on", editing);
  $("#btnEdit").textContent = editing ? "✓ 編集おわり" : "✏️ ことばを編集";
  // 編集中はもじタブだと編集対象がないので定型文タブへ
  if(editing && (activeTab==="もじ" || activeTab===DAKU_TAB)){ activeTab = Object.keys(phrases)[0]; renderTabs(); }
  renderMain();
};
document.querySelectorAll("#fontBtns .fbtn").forEach(b=>{
  b.onclick = ()=>setFontScale(parseFloat(b.dataset.fs));
});

/* ---------- 起動 ---------- */
(function init(){
  let fs = 1;
  try{ const s = localStorage.getItem(LS_FS); if(s) fs = parseFloat(s); }catch(e){}
  setFontScale(fs);
  renderText();
  renderTabs();
  renderMain();
  // Service Worker 登録（オフライン用）
  if("serviceWorker" in navigator){
    navigator.serviceWorker.register("sw.js").catch(()=>{});
  }
})();
