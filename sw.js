/* こえ Service Worker
   - HTML と app.js（アプリのコード）はネットワーク優先 → オンラインなら1回の起動で最新が届く
     （iOSホーム画面PWAは cache-first だと更新が永久に届かないため。memory: ios-pwa-update-delivery-traps）
   - アイコン・manifest 等の静的アセットはキャッシュ優先（オフライン動作用）
   ※更新時は CACHE 名を上げる（旧キャッシュ削除のトリガー） */
const CACHE = "koe-v13";
const ASSETS = [
  "./",
  "./index.html",
  "./app.js",
  "./manifest.json",
  "./icon-180.png",
  "./icon-192.png",
  "./icon-512.png"
];

self.addEventListener("install", e=>{
  e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting()));
});

self.addEventListener("activate", e=>{
  e.waitUntil(
    caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k))))
      .then(()=>self.clients.claim())
  );
});

self.addEventListener("fetch", e=>{
  if(e.request.method !== "GET") return;
  const url = new URL(e.request.url);
  // アプリのコード（HTML / app.js）はネットワーク優先・取れたらキャッシュ更新・オフライン時のみキャッシュ
  const isCode = e.request.mode === "navigate" ||
                 url.pathname.endsWith("/") ||
                 url.pathname.endsWith("/index.html") ||
                 url.pathname.endsWith("/app.js");
  if(isCode){
    e.respondWith(
      fetch(e.request).then(res=>{
        const copy = res.clone();
        caches.open(CACHE).then(c=>c.put(e.request, copy));
        return res;
      }).catch(()=>
        caches.match(e.request, {ignoreSearch:true}).then(hit=> hit || caches.match("./index.html"))
      )
    );
  }else{
    // 静的アセット（アイコン・manifest）はキャッシュ優先
    e.respondWith(
      caches.match(e.request, {ignoreSearch:true}).then(hit=>
        hit || fetch(e.request).then(res=>{
          const copy = res.clone();
          caches.open(CACHE).then(c=>c.put(e.request, copy));
          return res;
        })
      )
    );
  }
});
