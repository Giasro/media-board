// Gv 서비스워커 — 앱 화면 파일만 저장해서 오프라인 실행/설치를 지원한다.
// 영상·사진은 절대 여기서 다루지 않는다(사용자 파일은 브라우저 안에서 blob 으로만 재생).
const SHELL = 'gv-shell-v15c';
const FILES = ['./', 'index.html', 'manifest.webmanifest', 'static/css/styles.css', 'static/js/app.js', 'static/js/vendor/fflate.min.js', 'static/icons/icon-192.png', 'static/icons/icon-512.png', 'static/fonts/PretendardVariable.woff2'];

self.addEventListener('install', e => { e.waitUntil(caches.open(SHELL).then(c => c.addAll(FILES)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('gv-shell-') && k !== SHELL).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
// 네트워크 우선(업데이트 즉시 반영), 실패하면 저장본으로 실행
self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin || url.pathname.includes('/__gvcache/')) return;
  e.respondWith(fetch(req).then(res => {
    if (res.ok) { const copy = res.clone(); caches.open(SHELL).then(c => c.put(req, copy)); }
    return res;
  }).catch(() => caches.match(req, { ignoreSearch: true }).then(r => r || caches.match('index.html'))));
});
