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

/* ---------- 50音盤（紙の文字盤と同じ、あ列が右・縦に あいうえお） ---------- */
// 段（行）ごとに 左→右で [わ ら や ま は な た さ か あ] の順に並べる
const KANA_ROWS = [
  ["わ","ら","や","ま","は","な","た","さ","か","あ"], // あ段
  ["",  "り","",  "み","ひ","に","ち","し","き","い"], // い段
  ["を","る","ゆ","む","ふ","ぬ","つ","す","く","う"], // う段（を を ここに置く）
  ["",  "れ","",  "め","へ","ね","て","せ","け","え"], // え段
  ["ん","ろ","よ","も","ほ","の","と","そ","こ","お"]  // お段（ん をここに置く）
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

/* ---------- 状態 ---------- */
const LS_PHRASES = "koe.phrases.v1";
const LS_FS = "koe.fontscale.v1";
let phrases = loadPhrases();
let activeTab = Object.keys(phrases)[0] || "もじ";
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

/* ---------- タブ描画 ---------- */
function renderTabs(){
  tabsEl.innerHTML = "";
  // 定型文カテゴリ
  Object.keys(phrases).forEach(cat=>{
    const b = document.createElement("button");
    b.className = "tab" + (activeTab===cat?" active":"");
    b.textContent = cat;
    b.onclick = ()=>{ activeTab = cat; renderTabs(); renderMain(); };
    tabsEl.appendChild(b);
  });
  // もじ（50音）タブ
  const kb = document.createElement("button");
  kb.className = "tab" + (activeTab==="もじ"?" active":"");
  kb.textContent = "🔤 もじ";
  kb.onclick = ()=>{ activeTab="もじ"; renderTabs(); renderMain(); };
  tabsEl.appendChild(kb);
}

/* ---------- メイン描画 ---------- */
function renderMain(){
  mainEl.innerHTML = "";
  if(activeTab === "もじ"){ renderKana(); }
  else { renderPhrases(activeTab); }
}

function renderKana(){
  const grid = document.createElement("div");
  grid.id = "kana";
  KANA_ROWS.forEach(row=>{
    row.forEach(ch=>{
      const c = document.createElement("div");
      if(ch === ""){ c.className = "cell blank"; }
      else{
        c.className = "cell";
        c.textContent = ch;
        c.onclick = ()=>appendChar(ch);
      }
      grid.appendChild(c);
    });
  });
  mainEl.appendChild(grid);

  // 機能キー
  const util = document.createElement("div");
  util.id = "kanaUtil";
  const utils = [
    ["゛ 濁点", ()=>toggleLast(DAKUTEN, REV_DAKUTEN)],
    ["゜ 半濁", ()=>toggleLast(HANDAKUTEN, REV_HANDAKUTEN)],
    ["小 文字", ()=>toggleLast(SMALL, REV_SMALL)],
    ["ー", ()=>appendChar("ー")],
    ["、", ()=>appendChar("、")],
    ["。", ()=>appendChar("。")],
    ["？", ()=>appendChar("？")],
    ["！", ()=>appendChar("！")],
    ["␣ 空白", ()=>appendChar("　")],
    ["🔊 読む", ()=>speak(buffer)]
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
  if(next){ buffer = buffer.slice(0,-1) + next; renderText(); }
}

function renderPhrases(cat){
  const wrap = document.createElement("div");
  wrap.id = "phrases";
  (phrases[cat]||[]).forEach((p,idx)=>{
    const b = document.createElement("button");
    b.className = "phrase";
    b.innerHTML = `<span>${escapeHtml(p)}</span><span class="edit-badge">✎</span>`;
    b.onclick = ()=>{
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
  if(editing && activeTab==="もじ"){ activeTab = Object.keys(phrases)[0]; renderTabs(); }
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
