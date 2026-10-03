// ================= Gv v14 — 영상 동시재생기 =================
// v12(Gv) + v5.15(videoboard) + GvUX2 요구사항을 하나로 합친 완전판.
//  · 재생 스케줄러(동시 재생 상한 · 자동 조절 · 화면 밖 일시정지/메모리 해제)
//  · 선택 카드에만 재생바/삭제 버튼, 첫 클릭=선택 / 더블클릭=재생·정지
//  · 세션 저장/복원(Cache API 로 영상까지 복원), A/B 반복, 카드별 필터, 넘패드 % 이동
//  · ZIP 사진 뷰어(압축 해제 없이, 컬럼별 스크롤 + 동기 스크롤), GIF/WebP 최적화
//  · 포인트 색상(RGB) / 나이트 / 블루라이트 / 패딩 / 글꼴·UI 크기
(() => {
  'use strict';
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const fmt = t => { if (!isFinite(t)) return '0:00'; t = Math.floor(t); const h = Math.floor(t / 3600), m = Math.floor(t % 3600 / 60), s = t % 60; return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(s).padStart(2, '0'); };

  // ---------- 알림(토스트) / 오류 표시 ----------
  const toastBox = $('#toasts');
  function toast(msg, ok, ms) {
    const d = document.createElement('div'); d.className = 'toast' + (ok ? ' ok' : ''); d.textContent = msg;
    toastBox.appendChild(d); setTimeout(() => d.remove(), ms || 3500);
  }
  window.addEventListener('error', e => { if (/ResizeObserver/.test(e.message || '')) return; toast('JS 오류: ' + (e.message || e)); });
  window.addEventListener('unhandledrejection', e => { toast('오류: ' + (e.reason && e.reason.message || e.reason)); });

  // ---------- DOM ----------
  const gridWrap = $('#grid'), contentRoot = $('#contentRoot'), emptyHint = $('#emptyHint');
  const menuPanel = $('#menuPanel'), settingsPanel = $('#settingsPanel'), scrim = $('#scrim');
  const menuBtn = $('#menuBtn'), settingsBtn = $('#settingsBtn');
  const zgs = $('#zipGlobalScroll'), zgsRail = $('.zgs-rail'), zgsThumb = $('#zgsThumb');
  const fpsHud = $('#fpsHud'), dropOverlay = $('#dropOverlay');
  const el = {
    fileInput: $('#fileInput'), fileInputZip: $('#fileInputZip'),
    skipRange: $('#skipRange'), skipLabel: $('#skipLabel'),
    arrange: $('#arrangeToggle'), del: $('#deleteToggle'),
    playAll: $('#playAll'), pauseAll: $('#pauseAll'), bulkDelete: $('#bulkDelete'),
    lowPower: $('#lowPower'), fps: $('#fpsToggle'), resBadge: $('#resBadge'),
    filterStrength: $('#filterStrength'), filterStrengthLabel: $('#filterStrengthLabel'),
    zoomRange: $('#zoomRange'), zoomLabel: $('#zoomLabel'),
    fontRange: $('#fontRange'), fontLabel: $('#fontLabel'), uiRange: $('#uiRange'), uiLabel: $('#uiLabel'),
    gapRange: $('#gapRange'), gapLabel: $('#gapLabel'), padRange: $('#padRange'), padLabel: $('#padLabel'),
    accentColor: $('#accentColor'),
    nightMode: $('#nightMode'), nightLevel: $('#nightLevel'), nightLabel: $('#nightLabel'),
    blueMode: $('#blueMode'), blueLevel: $('#blueLevel'), blueLabel: $('#blueLabel'),
    zipGap: $('#zipInnerGap'), zipGapLabel: $('#zipInnerGapLabel'), zipAuto: $('#zipAutoCols'),
    autoPause: $('#autoPauseOffscreen'), autoCap: $('#autoCap'), autoUnload: $('#autoUnload'), maxConc: $('#maxConcurrent'),
    forceRes: $('#forceRes'), optRate: $('#optRate'), optLoop: $('#optLoop'), optMute: $('#optMute'), optCache: $('#optCache'),
    profileName: $('#profileName'), profileList: $('#profileList'),
    sessionName: $('#sessionName'), sessionList: $('#sessionList'), cacheInfo: $('#cacheInfo'),
  };

  // ---------- 상태 ----------
  const S = {
    mode: 'video', cols: 4, zipCols: 6, gap: 12, pad: 16, zoom: 1, skip: 5, skipRaw: 5,
    lowPower: false, showFPS: false, arranging: false, deleting: false,
    active: null, filter: 'none', theme: 'dark', accent: '#e50914',
  };
  const cards = [];
  let drag = null;
  const isZip = c => c.kind === 'zip';
  const inMode = c => (S.mode === 'zip') === isZip(c);
  const modeCards = () => cards.filter(inMode);
  const videoCards = () => cards.filter(c => c.kind === 'video' && inMode(c));
  const userCap = () => clamp(parseInt(el.maxConc.value, 10) || 12, 1, 64);
  let autoCapN = Infinity;
  const cap = () => { let n = userCap(); if (el.autoCap.checked) n = Math.min(n, autoCapN); return S.lowPower ? Math.max(1, Math.ceil(n / 2)) : n; };
  const curTime = c => c.loaded ? c.video.currentTime : (c.resume || 0);

  // ================= 레이아웃 (Pinterest 방식 masonry — 실제 영상 비율 기반) =================
  let layoutQueued = false;
  function layout() {
    if (layoutQueued) return; layoutQueued = true;
    const run = () => { if (!layoutQueued) return; layoutQueued = false; layoutNow(); };
    requestAnimationFrame(run); setTimeout(run, 60); // 창이 가려져 rAF 가 멈춰도 레이아웃은 갱신
  }
  const effCols = () => {
    if (S.mode !== 'zip') return S.cols;
    const n = modeCards().length;
    return el.zipAuto.checked ? clamp(n || 2, 2, 6) : clamp(S.zipCols, 2, 6);
  };
  const columnWidth = cols => (gridWrap.clientWidth - (cols - 1) * S.gap) / cols;
  const zipViewportH = () => Math.max(260, window.innerHeight / S.zoom - 40);

  function layoutNow() {
    const mine = modeCards();
    cards.forEach(c => { c.el.style.display = inMode(c) ? '' : 'none'; });
    emptyHint.classList.toggle('hidden', mine.length > 0);
    const columns = effCols();
    contentRoot.classList.toggle('onecol', S.mode !== 'zip' && columns === 1); // 1열 = 화면 폭 70%
    $$('.preset').forEach(b => b.classList.toggle('active', parseInt(b.dataset.cols, 10) === columns));
    const cw = columnWidth(columns);
    const heights = new Array(columns).fill(0);
    for (const c of mine) {
      let span = clamp(c.span || 1, 1, columns), w, h;
      if (isZip(c)) { span = 1; w = Math.round(cw); h = Math.round(zipViewportH()); }
      else { w = Math.round(span * cw + (span - 1) * S.gap); h = Math.max(120, Math.round(w / (c.aspect || 16 / 9))); }
      let col = 0, best = Infinity;
      for (let i = 0; i <= columns - span; i++) {
        let y = 0; for (let k = i; k < i + span; k++) y = Math.max(y, heights[k]);
        if (y < best) { best = y; col = i; }
      }
      const x = Math.round(col * (cw + S.gap)), y = Math.round(best);
      for (let k = col; k < col + span; k++) heights[k] = y + h + S.gap;
      c.rect = { x, y, w, h };
      c.el.style.width = w + 'px'; c.el.style.height = h + 'px';
      let tx = x, ty = y;
      if (drag && drag.card === c) { tx += drag.dx; ty += drag.dy; }
      c.el.style.transform = `translate(${tx}px, ${ty}px)`;
    }
    const totalH = Math.max(0, ...heights);
    gridWrap.style.height = totalH + 'px';
    // transform: scale 은 레이아웃 높이를 바꾸지 않으므로 스크롤 영역을 보정
    contentRoot.style.marginBottom = ((S.zoom - 1) * (totalH + 32)) + 'px';
    zgs.classList.toggle('has-zip', S.mode === 'zip' && mine.length > 0);
    reconcile();
  }
  let resizeT = null;
  const onResize = () => { document.body.classList.add('no-anim'); layout(); clearTimeout(resizeT); resizeT = setTimeout(() => document.body.classList.remove('no-anim'), 300); };
  window.addEventListener('resize', onResize);
  document.addEventListener('fullscreenchange', () => { onResize(); setTimeout(onResize, 250); }); // 전체화면 해제 후 재계산

  function setColumns(n) {
    if (S.mode === 'zip') { S.zipCols = clamp(n, 2, 6); el.zipAuto.checked = false; }
    else S.cols = clamp(n, 1, 8);
    layout();
  }
  $$('.preset').forEach(b => b.addEventListener('click', () => setColumns(parseInt(b.dataset.cols, 10))));
  el.zipAuto.addEventListener('change', layout);

  // ================= 패널(서랍) =================
  let openedPanel = null;
  function openPanel(p) {
    openedPanel = p;
    [menuPanel, settingsPanel].forEach(x => { const o = x === p; x.classList.toggle('open', o); x.setAttribute('aria-hidden', String(!o)); });
    menuBtn.classList.toggle('on', p === menuPanel); settingsBtn.classList.toggle('on', p === settingsPanel);
    scrim.classList.toggle('on', !!p);
  }
  const togglePanel = p => openPanel(openedPanel === p ? null : p);
  menuBtn.addEventListener('click', () => togglePanel(menuPanel));
  settingsBtn.addEventListener('click', () => togglePanel(settingsPanel));
  scrim.addEventListener('click', () => openPanel(null));
  $$('[data-close]').forEach(b => b.addEventListener('click', () => openPanel(null)));
  window.addEventListener('scroll', () => document.body.classList.toggle('scrolled', (window.scrollY || 0) > 80), { passive: true }); // 스크롤하면 제목바는 사라지고 아이콘만 따라다님

  // ================= 모드 =================
  function setMode(m) {
    S.mode = m;
    document.body.classList.toggle('mode-zip', m === 'zip');
    $$('.zip-only').forEach(s => s.classList.toggle('hidden', m !== 'zip'));
    $$('.only-video').forEach(s => s.classList.toggle('hidden', m !== 'video'));
    $$('.mode-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === m));
    setActive(null); window.scrollTo(0, 0); layout();
  }
  $$('.mode-btn').forEach(b => b.addEventListener('click', () => setMode(b.dataset.mode)));

  // ================= 설정 =================
  (function buildGlobalSkip() {
    const box = $('#globalSkipGrid');
    for (let i = 1; i <= 9; i++) {
      const b = document.createElement('button'); b.className = 'chip'; b.textContent = String(i); b.title = `${i * 10}% 지점으로 이동`;
      b.addEventListener('click', () => videoCards().forEach(c => seekPct(c, i / 10)));
      box.appendChild(b);
    }
  })();

  const mapSkip = val => { const t = (val - 1) / 19; return 1 + Math.round((1 - Math.pow(1 - t, 1.6)) * 19); };
  function updateSkip() { S.skipRaw = parseInt(el.skipRange.value, 10); S.skip = mapSkip(S.skipRaw); el.skipLabel.textContent = String(S.skip); }
  el.skipRange.addEventListener('input', updateSkip);

  function setTheme(t) { S.theme = t; document.documentElement.classList.toggle('theme-light', t === 'light'); $$('.theme-btn').forEach(b => b.classList.toggle('active', b.dataset.theme === t)); }
  $$('.theme-btn').forEach(b => b.addEventListener('click', () => setTheme(b.dataset.theme)));

  // 포인트 색상 (RGB 테마)
  function setAccent(hex) {
    if (!/^#[0-9a-f]{6}$/i.test(hex)) return;
    S.accent = hex.toLowerCase();
    const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
    const root = document.documentElement.style; root.setProperty('--accent', hex); root.setProperty('--accent-soft', `rgba(${r},${g},${b},.18)`);
    el.accentColor.value = hex; $$('#accentChips .sw').forEach(s => s.classList.toggle('active', s.dataset.color === S.accent));
  }
  $('#accentChips').addEventListener('click', e => { const b = e.target.closest('.sw'); if (b) setAccent(b.dataset.color); });
  el.accentColor.addEventListener('input', () => setAccent(el.accentColor.value));

  // 나이트 / 블루라이트
  const tintNight = $('#tintNight'), tintBlue = $('#tintBlue');
  function applyTint() {
    el.nightLabel.textContent = el.nightLevel.value; el.blueLabel.textContent = el.blueLevel.value;
    tintNight.style.display = el.nightMode.checked ? 'block' : 'none'; tintNight.style.opacity = String(parseInt(el.nightLevel.value, 10) / 100 * 0.75);
    tintBlue.style.display = el.blueMode.checked ? 'block' : 'none'; tintBlue.style.opacity = String(parseInt(el.blueLevel.value, 10) / 100 * 0.4);
  }
  [el.nightMode, el.nightLevel, el.blueMode, el.blueLevel].forEach(x => x.addEventListener('input', applyTint));

  function setFilter(f) { S.filter = f; $$('.chip-filter').forEach(c => c.classList.toggle('active', c.dataset.filter === f)); contentRoot.className = 'content filter-' + f + (S.mode !== 'zip' && S.cols === 1 ? ' onecol' : ''); }
  $('#filterChips').addEventListener('click', e => { const b = e.target.closest('.chip-filter'); if (b) setFilter(b.dataset.filter || 'none'); });
  function setFilterStrength(v) { el.filterStrengthLabel.textContent = v + '%'; document.documentElement.style.setProperty('--filter-intensity', String(v / 100)); }
  el.filterStrength.addEventListener('input', () => setFilterStrength(parseInt(el.filterStrength.value, 10)));

  const setZoomLabel = v => { el.zoomLabel.textContent = String(v); };
  function applyZoom(v) { S.zoom = v / 100; document.documentElement.style.setProperty('--zoom', String(S.zoom)); layout(); }
  el.zoomRange.addEventListener('input', () => setZoomLabel(parseInt(el.zoomRange.value, 10)));
  el.zoomRange.addEventListener('change', () => applyZoom(parseInt(el.zoomRange.value, 10)));

  function setFont(v) { el.fontLabel.textContent = String(v); document.documentElement.style.setProperty('--font', String(v / 100)); }
  function setUi(v) { el.uiLabel.textContent = String(v); document.documentElement.style.setProperty('--ui', String(v / 100)); }
  el.fontRange.addEventListener('input', () => setFont(parseInt(el.fontRange.value, 10)));
  el.uiRange.addEventListener('input', () => setUi(parseInt(el.uiRange.value, 10)));

  function setGap(v) { el.gapLabel.textContent = String(v); S.gap = v; document.documentElement.style.setProperty('--gap', v + 'px'); layout(); }
  el.gapRange.addEventListener('input', () => setGap(parseInt(el.gapRange.value, 10)));
  function setPad(v) { el.padLabel.textContent = String(v); S.pad = v; document.documentElement.style.setProperty('--pad', v + 'px'); layout(); }
  el.padRange.addEventListener('input', () => setPad(parseInt(el.padRange.value, 10)));
  function setZipGap(v) { el.zipGapLabel.textContent = String(v); document.documentElement.style.setProperty('--zip-gap', v + 'px'); }
  el.zipGap.addEventListener('input', () => setZipGap(parseInt(el.zipGap.value, 10)));

  el.lowPower.addEventListener('change', () => { S.lowPower = el.lowPower.checked; document.body.classList.toggle('low-power', S.lowPower); reconcile(); });
  el.fps.addEventListener('change', () => { S.showFPS = el.fps.checked; fpsHud.classList.toggle('hidden', !S.showFPS); });
  el.resBadge.addEventListener('change', () => document.body.classList.toggle('no-resbadge', !el.resBadge.checked));
  el.autoPause.addEventListener('change', () => reconcileNow());
  el.autoUnload.addEventListener('change', () => cards.forEach(c => { if (c.kind === 'video' || c.anim) nearChanged(c, c.near); }));
  el.maxConc.addEventListener('change', () => { autoCapN = Infinity; reconcileNow(); });
  el.autoCap.addEventListener('change', () => { autoCapN = Infinity; reconcileNow(); });
  el.arrange.addEventListener('change', () => { S.arranging = el.arrange.checked; document.body.classList.toggle('arranging', S.arranging); });
  el.del.addEventListener('change', () => {
    S.deleting = el.del.checked; document.body.classList.toggle('deleting', S.deleting);
    if (S.deleting) { videoCards().forEach(c => { c.wantPlay = false; }); reconcileNow(); }
  });

  // 전체 재생 옵션(배속/반복/음소거) — 새 카드에도 상속
  const G = () => ({ rate: parseFloat(el.optRate.value) || 1, loop: el.optLoop.checked, mute: el.optMute.checked });
  function applyGlobalPlayOpts() {
    const g = G();
    cards.forEach(c => { if (c.kind !== 'video') return; c.rate = g.rate; c.loopOn = g.loop; setMuted(c, g.mute); c.video.loop = g.loop; c.video.playbackRate = g.rate; syncPopover(c); });
  }
  [el.optRate, el.optLoop, el.optMute].forEach(x => x.addEventListener('change', applyGlobalPlayOpts));

  // ---------- 설정 프로파일 ----------
  const PKEY = 'gv_profile:';
  const readJSON = k => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (_) { return null; } };
  function listProfiles() {
    const keys = Object.keys(localStorage).filter(k => k.startsWith(PKEY) && k !== PKEY + 'active' && k !== PKEY + 'last');
    el.profileList.innerHTML = keys.map(k => `<option value="${k}">${k.slice(PKEY.length)}</option>`).join('');
  }
  const snapshot = () => ({
    theme: S.theme, accent: S.accent, filter: S.filter, filterStrength: parseInt(el.filterStrength.value, 10),
    zoom: parseInt(el.zoomRange.value, 10), gap: S.gap, pad: S.pad, zipGap: parseInt(el.zipGap.value, 10), skipRaw: S.skipRaw,
    cols: S.cols, zipCols: S.zipCols, zipAuto: el.zipAuto.checked, appMode: S.mode,
    autoPause: el.autoPause.checked, autoUnload: el.autoUnload.checked, autoCap: el.autoCap.checked,
    maxConcurrent: parseInt(el.maxConc.value, 10), lowPower: el.lowPower.checked,
    font: parseInt(el.fontRange.value, 10), ui: parseInt(el.uiRange.value, 10),
    rate: G().rate, loop: G().loop, mute: G().mute, forceRes: el.forceRes.value, cache: el.optCache.checked,
    resBadge: el.resBadge.checked, fps: el.fps.checked,
    night: el.nightMode.checked, nightLevel: parseInt(el.nightLevel.value, 10), blue: el.blueMode.checked, blueLevel: parseInt(el.blueLevel.value, 10),
  });
  function applyProfile(p) {
    if (!p) return;
    setTheme(p.theme === 'light' ? 'light' : 'dark'); setAccent(p.accent || '#e50914');
    setFilter(p.filter || 'none');
    el.filterStrength.value = String(p.filterStrength || 100); setFilterStrength(p.filterStrength || 100);
    el.zoomRange.value = String(p.zoom || 100); setZoomLabel(p.zoom || 100); applyZoom(p.zoom || 100);
    el.gapRange.value = String(p.gap ?? 12); setGap(p.gap ?? 12);
    el.padRange.value = String(p.pad ?? 16); setPad(p.pad ?? 16);
    el.zipGap.value = String(p.zipGap ?? 6); setZipGap(p.zipGap ?? 6);
    el.skipRange.value = String(p.skipRaw || 5); updateSkip();
    S.cols = clamp(p.cols || 4, 1, 8); S.zipCols = clamp(p.zipCols || 6, 2, 6); el.zipAuto.checked = p.zipAuto !== false;
    el.autoPause.checked = p.autoPause !== false; el.autoUnload.checked = p.autoUnload !== false; el.autoCap.checked = p.autoCap !== false;
    el.maxConc.value = String(p.maxConcurrent || 12);
    el.lowPower.checked = !!p.lowPower; el.lowPower.dispatchEvent(new Event('change'));
    el.fontRange.value = String(p.font || 90); setFont(p.font || 90);
    el.uiRange.value = String(p.ui || 100); setUi(p.ui || 100);
    el.optRate.value = String(p.rate || 1); el.optLoop.checked = p.loop !== false; el.optMute.checked = p.mute !== false;
    el.forceRes.value = p.forceRes || 'free'; el.optCache.checked = p.cache !== false && !privEl.checked;
    el.resBadge.checked = p.resBadge !== false; el.resBadge.dispatchEvent(new Event('change'));
    el.fps.checked = !!p.fps; el.fps.dispatchEvent(new Event('change'));
    el.nightMode.checked = !!p.night; el.nightLevel.value = String(p.nightLevel || 40); el.blueMode.checked = !!p.blue; el.blueLevel.value = String(p.blueLevel || 35); applyTint();
    applyGlobalPlayOpts(); applyForceRes();
    setMode(p.appMode === 'zip' ? 'zip' : 'video');
  }
  $('#saveProfile').addEventListener('click', () => {
    const name = (el.profileName.value || '').trim(); if (!name) return toast('프로파일 이름을 입력하세요.');
    localStorage.setItem(PKEY + name, JSON.stringify(snapshot())); localStorage.setItem(PKEY + 'active', PKEY + name);
    listProfiles(); el.profileList.value = PKEY + name; toast('프로파일 저장: ' + name, true);
  });
  $('#loadProfile').addEventListener('click', () => { const k = el.profileList.value; if (!k) return; applyProfile(readJSON(k)); localStorage.setItem(PKEY + 'active', k); toast('프로파일 적용', true); });
  $('#deleteProfile').addEventListener('click', () => {
    const k = el.profileList.value; if (!k) return; localStorage.removeItem(k);
    if (localStorage.getItem(PKEY + 'active') === k) localStorage.removeItem(PKEY + 'active');
    listProfiles();
  });

  // ================= 재생 스케줄러 =================
  // 보이는 카드 중 cap 개만 실제 재생, 나머지는 마지막 프레임으로 대기(디코딩 비용 0).
  let recT = null;
  function reconcile() { if (recT) return; recT = setTimeout(() => { recT = null; reconcileNow(); }, 40); }

  const playQueue = []; let playTimer = null;
  function enqueuePlay(c) {
    if (c._queued) return; c._queued = true; playQueue.push(c);
    if (!playTimer) playTimer = setInterval(() => {
      const n = playQueue.shift();
      if (!n) { clearInterval(playTimer); playTimer = null; return; }
      n._queued = false;
      if (n.loaded && n.video.paused && n.wantPlay && n.allowed) n.video.play().catch(() => { });
    }, S.lowPower ? 160 : 70); // 한꺼번에 시작하면 디코더가 몰려 순간 버벅임 → 간격을 두고 시작
  }

  function reconcileNow() {
    const vcs = videoCards();
    const pauseOff = el.autoPause.checked;
    const base = gridWrap.offsetTop, mid = (window.scrollY + window.innerHeight / 2) / S.zoom;
    const cand = [];
    for (const c of vcs) {
      c.allowed = false; c.el.classList.remove('paused-by-cap');
      if (!c.loaded) continue;
      const eligible = c.wantPlay && !S.deleting && !document.hidden && (c.near || !pauseOff);
      if (eligible) cand.push(c); else if (!c.video.paused) c.video.pause();
    }
    cand.sort((a, b) => {
      if (a === S.active) return -1; if (b === S.active) return 1;
      const da = a.rect ? Math.abs(base + a.rect.y + a.rect.h / 2 - mid) : 1e9;
      const db = b.rect ? Math.abs(base + b.rect.y + b.rect.h / 2 - mid) : 1e9;
      return da - db;
    });
    const n = cap();
    cand.forEach((c, i) => {
      if (i < n) { c.allowed = true; if (c.video.paused) enqueuePlay(c); }
      else { if (!c.video.paused) c.video.pause(); c.el.classList.add('paused-by-cap'); }
    });
  }
  window.addEventListener('scroll', reconcile, { passive: true });

  // ---------- 자동 상한 조절 ----------
  // 재생 위치가 실제 시간보다 느리게 흐르면(=디코딩이 못 따라감) 동시 재생 수를 줄이고, 여유가 있으면 조금씩 올린다.
  let okStreak = 0, settleUntil = 0, lastDownAt = 0;
  setInterval(() => {
    if (!el.autoCap.checked || document.hidden || S.mode !== 'video') return;
    const now = performance.now();
    const playing = videoCards().filter(c => c.loaded && !c.video.paused && !c.video.seeking);
    let sum = 0, n = 0;
    for (const c of playing) {
      const t = c.video.currentTime;
      if (c._mon && now - c._mon.w < 3000) {
        const dt = (now - c._mon.w) / 1000, dv = t - c._mon.t;
        if (dv >= -0.5 && !(c.ab && c.ab.on)) { sum += Math.min(1.2, Math.max(0, dv) / (dt * (c.video.playbackRate || 1))); n++; }
      }
      c._mon = { t, w: now };
    }
    if (now < settleUntil || n < 1) { okStreak = 0; return; }
    const ratio = sum / n;
    if (ratio < 0.88) {
      autoCapN = Math.max(1, Math.floor(playing.length * 0.8)); settleUntil = now + 5000; lastDownAt = now; okStreak = 0; reconcileNow();
    } else if (ratio > 0.97 && playing.length >= cap() && cap() < userCap() && now - lastDownAt > 20000) {
      if (++okStreak >= 4) { autoCapN = cap() + 1; settleUntil = now + 5000; okStreak = 0; reconcileNow(); }
    } else okStreak = 0;
  }, 2000);
  ['play', 'seeking', 'ratechange'].forEach(ev => document.addEventListener(ev, e => { const c = e.target.closest?.('.card')?._card; if (c) c._mon = null; }, true));

  // ---------- 화면 근접 추적 / Lazy loading ----------
  const io = new IntersectionObserver(entries => {
    entries.forEach(ent => { const c = ent.target._card; if (c) nearChanged(c, ent.isIntersecting); });
  }, { rootMargin: '300px 0px 300px 0px', threshold: 0 });

  function nearChanged(c, near) {
    c.near = near; clearTimeout(c._unloadT);
    const unload = el.autoUnload.checked;
    if (c.kind === 'video') {
      if (near) { if (!c.loaded) loadVideo(c); }
      else if (unload && c.loaded) c._unloadT = setTimeout(() => { if (!c.near && el.autoUnload.checked) unloadVideo(c); }, 3000);
    } else if (c.kind === 'image' && c.anim) { // GIF/WebP 최적화: 화면 밖에서는 디코딩 중단
      if (near) { if (c.gifOff) { c.media.src = c.url; c.media.classList.remove('gif-off'); c.gifOff = false; } }
      else if (unload) c._unloadT = setTimeout(() => { if (!c.near && el.autoUnload.checked) { c.media.removeAttribute('src'); c.media.classList.add('gif-off'); c.gifOff = true; } }, 3000);
    }
    reconcile();
  }
  function snapshotPoster(c) {
    const v = c.video; if (v.readyState < 2 || !v.videoWidth) return;
    const w = 480, h = Math.max(1, Math.round(w * v.videoHeight / v.videoWidth));
    c.poster.width = w; c.poster.height = h;
    try { c.poster.getContext('2d').drawImage(v, 0, 0, w, h); c.hasPoster = true; } catch (_) { }
  }
  function unloadVideo(c) {
    if (!c.loaded) return;
    snapshotPoster(c);
    c.resume = c.video.currentTime || 0;
    c.video.pause(); c.video.removeAttribute('src'); c.video.load();
    c.loaded = false; c.el.classList.add('unloaded'); c.el.classList.toggle('showposter', !!c.hasPoster);
  }
  const attachQueue = []; let attachT = null;
  function pumpAttach() { if (attachT) return; attachT = setInterval(() => { const f = attachQueue.shift(); if (!f) { clearInterval(attachT); attachT = null; return; } f(); }, 90); }
  function loadVideo(c) {
    if (c.loaded || c.loading) return;
    c.loading = true;
    attachQueue.push(() => {
      const v = c.video;
      v.addEventListener('loadedmetadata', () => { v.playbackRate = c.rate || 1; if (c.resume) { try { v.currentTime = c.resume; } catch (_) { } } }, { once: true });
      v.addEventListener('loadeddata', () => { c.loading = false; c.loaded = true; c.el.classList.remove('unloaded', 'showposter'); reconcile(); }, { once: true });
      v.src = c.url;
    });
    pumpAttach();
  }
  function seekTo(c, t) {
    if (c.kind !== 'video') return;
    const d = c.duration || (c.loaded ? c.video.duration : 0) || 0;
    t = clamp(t, 0, d || t);
    if (c.loaded) c.video.currentTime = t; else c.resume = t;
  }
  const seekPct = (c, p) => seekTo(c, (c.duration || 0) * p);

  // ================= 해상도 강제(캔버스 렌더, 실험) =================
  function applyCardRes(c) {
    if (c.kind !== 'video') return;
    const mode = el.forceRes.value, targetH = mode === 'free' ? null : parseInt(mode, 10);
    const v = c.video;
    if (c._cp) { c._cp.stop(); c._cp = null; }
    if (!targetH) { if (c.cvs) { c.cvs.remove(); c.cvs = null; } c.el.classList.remove('cproxy-on'); return; }
    if (!c.cvs) { c.cvs = document.createElement('canvas'); c.cvs.className = 'cproxy'; v.after(c.cvs); }
    const ratio = c.aspect || 16 / 9, cv = c.cvs, ctx = cv.getContext('2d');
    cv.height = targetH; cv.width = Math.round(targetH * ratio);
    c.el.classList.add('cproxy-on');
    let id = 0, stopped = false;
    const useRVFC = 'requestVideoFrameCallback' in v;
    const draw = () => {
      if (stopped) return;
      if (!v.paused && v.readyState >= 2) { try { ctx.drawImage(v, 0, 0, cv.width, cv.height); } catch (_) { } }
      id = useRVFC ? v.requestVideoFrameCallback(draw) : requestAnimationFrame(draw);
    };
    id = useRVFC ? v.requestVideoFrameCallback(draw) : requestAnimationFrame(draw);
    c._cp = { stop() { stopped = true; try { useRVFC ? v.cancelVideoFrameCallback(id) : cancelAnimationFrame(id); } catch (_) { } } };
  }
  function applyForceRes() { cards.forEach(applyCardRes); }
  el.forceRes.addEventListener('change', applyForceRes);

  // ================= 카드 =================
  const ICON = {
    play: '<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M8 5v14l11-7z"/></svg>',
    pause: '<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M6 5h4v14H6zM14 5h4v14h-4z"/></svg>',
    vol: '<svg viewBox="0 0 24 24"><path d="M3 10v4h4l5 4V6L7 10zM16 9a4 4 0 0 1 0 6M19 6a8 8 0 0 1 0 12"/></svg>',
    mute: '<svg viewBox="0 0 24 24"><path d="M3 10v4h4l5 4V6L7 10zM16 9l5 6M21 9l-5 6"/></svg>',
    fs: '<svg viewBox="0 0 24 24"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>',
    more: '<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>',
  };
  const FILTERS = [['', '전체 설정 따름'], ['none', '없음'], ['cinema', '시네마'], ['noir', '누아르'], ['vivid', '비비드'], ['texture', '텍스처'], ['pastel', '파스텔'], ['cool', '쿨톤'], ['warm', '웜톤'], ['hyperreal', '하이퍼리얼'], ['film', '필름'], ['mono', '흑백'], ['neon', '네온']];

  function baseCard(kind, name) {
    const card = document.createElement('article');
    card.className = 'card' + (kind === 'image' ? ' image-card' : '');
    card.innerHTML = `
      <button class="btn-del-top" title="이 카드 삭제">🗑 삭제</button>
      <span class="badge-ab">A-B 반복</span>
      <span class="badge-res"></span>
      <div class="overlay">
        <div class="progress"><div class="buf"></div><div class="mk-range"></div><div class="bar"></div><i class="mk mk-a"></i><i class="mk mk-b"></i></div>
        <div class="controls">
          <button class="ob play" title="재생/정지 (Space)">${ICON.play}</button>
          <span class="timeinfo"></span>
          <span class="sp"></span>
          <button class="ob mutebtn vonly" title="음소거 (M)">${ICON.mute}</button>
          <button class="ob txt opt vonly ab-a" title="구간 시작 지점 (A)">A</button>
          <button class="ob txt opt vonly ab-b" title="구간 끝 지점 (B)">B</button>
          <button class="ob txt opt vonly ab-on" title="A-B 구간 반복 켜기/끄기">⟲</button>
          <button class="ob gear" title="더 보기">${ICON.more}</button>
          <button class="ob fsbtn" title="전체화면 (F)">${ICON.fs}</button>
        </div>
        <div class="popover">
          <div class="prow vonly"><label>배속</label><select class="rate">${[0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 3, 4].map(r => `<option value="${r}">${r}x</option>`).join('')}</select></div>
          <div class="prow vonly"><label>반복재생</label><input type="checkbox" class="loopChk"/></div>
          <div class="prow"><label>화면 채우기</label><select class="fit"><option value="contain">맞춤</option><option value="cover">꽉 채움</option></select></div>
          <div class="prow"><label>필터</label><select class="cfilter">${FILTERS.map(f => `<option value="${f[0]}">${f[1]}</option>`).join('')}</select></div>
          <div class="prow vonly"><label>PiP</label><input type="checkbox" class="pipCheck"/></div>
          <div class="prow"><button class="pbtn capture">📸 현재 화면 캡쳐 (PNG)</button></div>
        </div>
      </div>
      <div class="resize-handle" title="드래그: 가로 칸 수 조절"></div>`;
    const c = { kind, name, el: card, span: 1, aspect: null, rect: null, near: false, wantPlay: true, muted: true, loopOn: true, rate: 1, ab: { a: null, b: null, on: false } };
    card._card = c;
    gridWrap.appendChild(card); cards.push(c);
    return c;
  }

  function removeCard(c, noLayout) {
    const i = cards.indexOf(c); if (i >= 0) cards.splice(i, 1);
    clearTimeout(c._unloadT);
    if (c._cp) c._cp.stop();
    if (c.kind === 'video') { io.unobserve(c.el); c.video.pause(); c.video.removeAttribute('src'); c.video.load(); }
    else if (c.anim) io.unobserve(c.el);
    (c.urls || [c.url]).forEach(u => { if (u && u.startsWith('blob:')) URL.revokeObjectURL(u); });
    if (S.active === c) S.active = null;
    c.el.remove();
    if (!noLayout) layout();
  }

  // ---------- 파일 소스 정규화 ----------
  const VIDEO_EXT = /\.(mp4|mkv|webm|mov|m4v|avi|ogv|ts)$/i, IMG_EXT = /\.(gif|webp|png|jpe?g|bmp|avif)$/i;
  const isZipFile = f => f.type === 'application/zip' || f.type === 'application/x-zip-compressed' || /\.zip$/i.test(f.name);
  function kindOf(f) {
    if (isZipFile(f)) return 'zip';
    if ((f.type || '').startsWith('video/') || VIDEO_EXT.test(f.name)) return 'video';
    if ((f.type || '').startsWith('image/') || IMG_EXT.test(f.name)) return 'image';
    return null;
  }

  // ---------- Cache API (세션 복원용) ----------
  // 키는 http(s) 스킴의 가짜 URL을 사용한다('local:' 같은 스킴은 Cache API 가 거부함).
  const CACHE_NAME = 'gv-media-v1';
  const cacheOK = (() => { try { return !!window.caches && /^https?:$/.test(location.protocol); } catch (_) { return false; } })();
  const cacheKeyFor = f => `/__gvcache/${encodeURIComponent(f.name)}__${f.size}__${f.lastModified || 0}`;
  async function cachePut(key, file) {
    const cache = await caches.open(CACHE_NAME);
    await cache.put(new Request(location.origin + key), new Response(file, { headers: { 'Content-Type': file.type || 'application/octet-stream' } })); // Blob 을 스트림으로 저장(메모리에 통째로 올리지 않음)
  }
  async function cacheGet(key) {
    if (!cacheOK) return null;
    const cache = await caches.open(CACHE_NAME), r = await cache.match(location.origin + key);
    return r ? r.blob() : null;
  }
  async function refreshCacheInfo() {
    try {
      if (!cacheOK) { el.cacheInfo.textContent = '캐시 사용 불가 (실행.bat 으로 http://localhost 에서 열어야 합니다)'; return; }
      const est = await navigator.storage.estimate();
      el.cacheInfo.textContent = `브라우저 저장소 사용: ${(est.usage / 1048576).toFixed(0)}MB / 여유 ${(est.quota / 1073741824).toFixed(1)}GB`;
    } catch (_) { el.cacheInfo.textContent = ''; }
  }
  $('#cacheClear').addEventListener('click', async () => {
    if (!cacheOK || !confirm('저장된 영상 캐시를 모두 비울까요? (세션 JSON 은 남지만 캐시에서 복원은 불가)')) return;
    await caches.delete(CACHE_NAME); cards.forEach(c => { c.cached = false; }); toast('캐시를 비웠습니다.', true); refreshCacheInfo();
  });

  // ---------- 카드 추가 ----------
  // src: { file?: File|Blob, url?: string, name, type, size, lastModified, kind }
  function addSource(src, props) {
    props = props || {};
    return new Promise(resolve => {
      const isVideo = src.kind === 'video';
      const c = baseCard(isVideo ? 'video' : 'image', src.name);
      c.meta = { name: src.name, type: src.type || '', size: src.size || 0, lastModified: src.lastModified || 0 };
      if (src.file) c.url = URL.createObjectURL(src.file); else { c.url = src.url; c.remote = true; }
      const g = G();
      c.rate = props.rate || g.rate; c.loopOn = props.loop ?? g.loop; c.muted = props.muted ?? g.mute;
      c.span = props.span || 1; c.wantPlay = props.wantPlay !== false;
      let m;
      if (isVideo) {
        m = document.createElement('video');
        m.muted = c.muted; m.loop = c.loopOn; m.playsInline = true; m.preload = 'auto';
        m.setAttribute('controlslist', 'nodownload noplaybackrate noremoteplayback');
        c.video = m; c.loaded = false; c.loading = true;
        c.poster = document.createElement('canvas'); c.poster.className = 'poster'; c.el.prepend(c.poster);
      } else { m = document.createElement('img'); m.decoding = 'async'; c.anim = /gif|webp/i.test(src.type || '') || /\.(gif|webp)$/i.test(src.name || ''); }
      m.className = 'media'; c.el.prepend(m); c.media = m;
      if (props.time) c.resume = props.time;

      const done = () => {
        wireCard(c); applyProps(c, props); layout(); applyCardRes(c);
        if (src.file && el.optCache.checked && cacheOK && !props.fromCache) {
          c.cacheKey = cacheKeyFor(src.file);
          c.cachePromise = cachePut(c.cacheKey, src.file).then(() => { c.cached = true; refreshCacheInfo(); }).catch(err => { c.cached = false; toast('캐시 저장 실패: ' + (err && err.message || err)); });
        } else if (props.fromCache) { c.cacheKey = props.cacheKey; c.cached = true; }
        resolve(c);
      };
      if (isVideo) {
        m.addEventListener('loadedmetadata', () => {
          c.aspect = (m.videoWidth || 16) / (m.videoHeight || 9); c.duration = m.duration;
          const h = m.videoHeight; const lab = h >= 4320 ? '8K' : h >= 2160 ? '4K UHD' : h >= 1440 ? '1440p' : h >= 1080 ? 'FHD 1080p' : h >= 720 ? 'HD 720p' : h + 'p';
          $('.badge-res', c.el).textContent = lab + ' · ' + m.videoWidth + '×' + m.videoHeight;
          m.playbackRate = c.rate; if (c.resume) { try { m.currentTime = c.resume; } catch (_) { } }
        }, { once: true });
        m.addEventListener('loadeddata', () => { c.loading = false; c.loaded = true; io.observe(c.el); done(); }, { once: true });
        m.addEventListener('error', () => { toast(`재생할 수 없는 파일: ${src.name} (브라우저가 지원하지 않는 코덱일 수 있어요. 예: 일부 HEVC/MKV)`, false, 6000); removeCard(c); resolve(null); }, { once: true });
        m.src = c.url;
      } else {
        m.addEventListener('load', () => { c.aspect = (m.naturalWidth || 16) / (m.naturalHeight || 9); if (c.anim) io.observe(c.el); done(); }, { once: true });
        m.addEventListener('error', () => { toast('이미지를 열 수 없습니다: ' + src.name); removeCard(c); resolve(null); }, { once: true });
        m.src = c.url;
      }
    });
  }

  function normalizeFile(f) { const kind = kindOf(f); return kind ? { file: f, name: f.name, type: f.type, size: f.size, lastModified: f.lastModified, kind } : null; }

  // 카드 개별 속성 적용 (세션 복원/신규 공통)
  function applyProps(c, p) {
    if (p.cf !== undefined) setCardFilter(c, p.cf);
    if (p.fit) setFit(c, p.fit);
    if (c.kind === 'video') {
      if (p.ab) { c.ab = Object.assign({ a: null, b: null, on: false }, p.ab); refreshAB(c); }
      setMuted(c, c.muted); c.video.loop = c.loopOn; c.video.playbackRate = c.rate;
    }
    syncPopover(c);
  }
  function syncPopover(c) {
    const q = s => $(s, c.el); if (!c.el.isConnected || !q('.rate')) return;
    q('.rate').value = String(c.rate); q('.loopChk').checked = !!c.loopOn; q('.fit').value = c.el.dataset.fit || 'contain'; q('.cfilter').value = c.el.dataset.cf || '';
    q('.mutebtn').innerHTML = c.muted ? ICON.mute : ICON.vol;
  }
  function setCardFilter(c, f) { if (f) c.el.dataset.cf = f; else delete c.el.dataset.cf; }
  function setFit(c, f) { c.el.dataset.fit = f === 'cover' ? 'cover' : 'contain'; }
  function setMuted(c, m) { c.muted = m; if (c.video) { c.video.muted = m; } const b = $('.mutebtn', c.el); if (b) b.innerHTML = m ? ICON.mute : ICON.vol; }
  function refreshAB(c) {
    const { a, b, on } = c.ab, d = c.duration || 0;
    const ma = $('.mk-a', c.el), mb = $('.mk-b', c.el), mr = $('.mk-range', c.el);
    ma.classList.toggle('show', a != null && d > 0); mb.classList.toggle('show', b != null && d > 0);
    if (a != null && d) ma.style.left = (a / d * 100) + '%';
    if (b != null && d) mb.style.left = (b / d * 100) + '%';
    const both = a != null && b != null && b > a && d > 0;
    mr.classList.toggle('show', both); if (both) { mr.style.left = (a / d * 100) + '%'; mr.style.width = ((b - a) / d * 100) + '%'; }
    c.el.classList.toggle('ab-on', !!on && both); $('.ab-on', c.el).classList.toggle('on', !!on && both);
  }
  function setAB(c, which) {
    if (c.kind !== 'video') return;
    c.ab[which] = curTime(c);
    if (c.ab.a != null && c.ab.b != null && c.ab.b > c.ab.a) c.ab.on = true;
    else if (c.ab.a != null && c.ab.b != null) { c.ab.on = false; toast('B 지점은 A 지점보다 뒤여야 합니다.'); }
    refreshAB(c); toast(`${which.toUpperCase()} = ${fmt(c.ab[which])}`, true, 1200);
  }

  function setActive(c) {
    if (S.active && S.active !== c) { S.active.el.classList.remove('active'); $$('.popover.open', S.active.el).forEach(p => p.classList.remove('open')); }
    S.active = c; if (c) c.el.classList.add('active');
    reconcile();
  }

  // 카드별 이벤트 (document/window 리스너는 전역 1회)
  function wireCard(c) {
    const card = c.el, m = c.media;
    const q = s => $(s, card), pop = q('.popover'), progress = q('.progress');
    const stop = e => e.stopPropagation();

    q('.gear').addEventListener('click', e => { stop(e); pop.classList.toggle('open'); });
    pop.addEventListener('click', stop);
    q('.btn-del-top').addEventListener('click', e => { stop(e); removeCard(c); });
    q('.fsbtn').addEventListener('click', async e => { stop(e); try { if (document.fullscreenElement) await document.exitFullscreen(); else await card.requestFullscreen(); } catch (_) { } });
    q('.fit').addEventListener('change', e => setFit(c, e.target.value));
    q('.cfilter').addEventListener('change', e => setCardFilter(c, e.target.value));
    q('.overlay').addEventListener('click', stop); q('.overlay').addEventListener('dblclick', stop);

    q('.capture').addEventListener('click', e => {
      stop(e);
      if (c.kind === 'video') {
        if (!c.loaded) return toast('영상이 메모리에서 해제된 상태입니다. 화면에 보이게 한 뒤 다시 시도하세요.');
        const cv = document.createElement('canvas'); cv.width = m.videoWidth; cv.height = m.videoHeight;
        try { cv.getContext('2d').drawImage(m, 0, 0); } catch (err) { return toast('캡쳐 실패: ' + err.message); }
        cv.toBlob(b => { const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = (c.name || 'capture').replace(/\.[^.]+$/, '') + '_' + Date.now() + '.png'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); toast('캡쳐 저장됨 (원본 해상도 PNG)', true, 1500); });
      } else {
        const a = document.createElement('a'); a.href = c.url; a.download = c.name || 'image'; a.click();
      }
    });

    if (c.kind === 'video') {
      q('.play').addEventListener('click', e => { stop(e); togglePlay(c); });
      q('.mutebtn').addEventListener('click', e => { stop(e); setMuted(c, !c.muted); reconcile(); });
      q('.rate').addEventListener('change', e => { c.rate = parseFloat(e.target.value); m.playbackRate = c.rate; });
      q('.loopChk').addEventListener('change', e => { c.loopOn = e.target.checked; m.loop = c.loopOn; });
      q('.ab-a').addEventListener('click', e => { stop(e); setAB(c, 'a'); });
      q('.ab-b').addEventListener('click', e => { stop(e); setAB(c, 'b'); });
      q('.ab-on').addEventListener('click', e => { stop(e); if (c.ab.a == null || c.ab.b == null || c.ab.b <= c.ab.a) return toast('먼저 A, B 지점을 지정하세요. (A/B 키)'); c.ab.on = !c.ab.on; refreshAB(c); });
      const pip = q('.pipCheck');
      pip.addEventListener('change', async () => {
        try { if (pip.checked) { if (document.pictureInPictureElement) await document.exitPictureInPicture(); await m.requestPictureInPicture(); } else if (document.pictureInPictureElement) await document.exitPictureInPicture(); }
        catch (_) { pip.checked = false; }
      });
      let scrub = false;
      const scrubTo = e => { const r = progress.getBoundingClientRect(); seekPct(c, clamp((e.clientX - r.left) / r.width, 0, 1)); };
      progress.addEventListener('pointerdown', e => { stop(e); scrub = true; progress.setPointerCapture(e.pointerId); scrubTo(e); });
      progress.addEventListener('pointermove', e => { if (scrub) scrubTo(e); });
      progress.addEventListener('pointerup', () => { scrub = false; });
      m.addEventListener('play', () => { q('.play').innerHTML = ICON.pause; });
      m.addEventListener('pause', () => { q('.play').innerHTML = ICON.play; });
    } else {
      $$('.vonly', card).forEach(x => { x.style.display = 'none'; });
    }

    // 첫 클릭 = 선택 / 더블클릭 = 재생·정지
    card.addEventListener('click', e => {
      if (S.deleting) { removeCard(c); return; }
      if (e.target.closest('.overlay, .resize-handle, .btn-del-top')) return;
      if (S.active !== c) setActive(c);
    });
    card.addEventListener('dblclick', e => {
      if (S.deleting || e.target.closest('.overlay, .resize-handle, .btn-del-top')) return;
      if (c.kind === 'video') { setActive(c); togglePlay(c); }
    });
    wireResize(c); wireArrange(c);
    syncPopover(c);
  }

  function togglePlay(c) {
    if (c.kind !== 'video') return;
    c.wantPlay = !c.wantPlay;
    if (!c.wantPlay && c.loaded) c.video.pause();
    reconcileNow();
  }

  // ---------- 크기 조절 (가로 칸 수 스냅 — 다른 카드가 자연스럽게 밀림) ----------
  function wireResize(c) {
    const handle = $('.resize-handle', c.el); let st = null;
    handle.addEventListener('pointerdown', e => { e.stopPropagation(); e.preventDefault(); handle.setPointerCapture(e.pointerId); st = { x: e.clientX, w: c.rect.w }; document.body.classList.add('no-anim'); document.body.style.userSelect = 'none'; });
    handle.addEventListener('pointermove', e => {
      if (!st) return;
      const cols = effCols(), newW = Math.max(120, st.w + (e.clientX - st.x) / S.zoom), cw = columnWidth(cols);
      const span = clamp(Math.round((newW + S.gap) / (cw + S.gap)), 1, cols);
      if (span !== c.span) { c.span = span; layoutNow(); }
    });
    const end = () => { if (!st) return; st = null; document.body.style.userSelect = ''; setTimeout(() => document.body.classList.remove('no-anim'), 50); };
    handle.addEventListener('pointerup', end); handle.addEventListener('pointercancel', end);
  }

  // ---------- 드래그로 순서 변경 (다른 카드가 부드럽게 밀려남) ----------
  function wireArrange(c) {
    const card = c.el;
    card.addEventListener('pointerdown', e => {
      if (!S.arranging || S.deleting || e.button !== 0 || e.target.closest('.overlay, .resize-handle, .zip-toolbar, .btn-del-top')) return;
      drag = { card: c, sx: e.clientX, sy: e.clientY, dx: 0, dy: 0 };
      card.setPointerCapture(e.pointerId); card.classList.add('dragging'); document.body.style.userSelect = 'none';
    });
    card.addEventListener('pointermove', e => {
      if (!drag || drag.card !== c) return;
      drag.dx = (e.clientX - drag.sx) / S.zoom; drag.dy = (e.clientY - drag.sy) / S.zoom;
      const cx = c.rect.x + c.rect.w / 2 + drag.dx, cy = c.rect.y + c.rect.h / 2 + drag.dy;
      let target = null, best = Infinity;
      for (const o of modeCards()) {
        if (o === c || !o.rect) continue;
        const d = Math.hypot(cx - (o.rect.x + o.rect.w / 2), cy - (o.rect.y + o.rect.h / 2));
        if (d < best) { best = d; target = o; }
      }
      if (target && best < Math.min(target.rect.w, target.rect.h) * 0.6) {
        const from = cards.indexOf(c), to = cards.indexOf(target);
        if (from !== to) { cards.splice(from, 1); cards.splice(to, 0, c); }
      }
      layoutNow();
    });
    const end = () => { if (!drag || drag.card !== c) return; card.classList.remove('dragging'); document.body.style.userSelect = ''; drag = null; layoutNow(); };
    card.addEventListener('pointerup', end); card.addEventListener('pointercancel', end);
  }

  // ================= ZIP 사진 (압축 해제 없이 미리보기) =================
  const ZIP_IMG = /\.(png|jpe?g|jfif|pjpeg|pjp|webp|gif|bmp|avif)$/i;
  const natural = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
  function unzipAsync(u8) {
    const { unzip, unzipSync } = window.fflate || {};
    return new Promise((res, rej) => {
      if (unzip) unzip(u8, (err, data) => { if (err) { try { res(unzipSync(u8)); } catch (e) { rej(e); } } else res(data); });
      else if (unzipSync) { try { res(unzipSync(u8)); } catch (e) { rej(e); } }
      else rej(new Error('fflate 로드 실패'));
    });
  }
  async function collectImages(u8, depth, out) { // 중첩 폴더 + ZIP 안의 ZIP(1단계)까지
    const files = await unzipAsync(u8);
    const names = Object.keys(files).filter(n => !n.endsWith('/') && !/^__MACOSX\//.test(n) && !/(^|\/)\._/.test(n)).sort((a, b) => natural.compare(a, b));
    for (const n of names) {
      if (ZIP_IMG.test(n)) out.push({ name: n, buf: files[n] });
      else if (/\.zip$/i.test(n) && depth < 1) { try { await collectImages(files[n], depth + 1, out); } catch (_) { } }
    }
  }
  const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', jfif: 'image/jpeg', pjpeg: 'image/jpeg', pjp: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', bmp: 'image/bmp', avif: 'image/avif' };

  async function addZip(src, props) {
    props = props || {};
    const file = src.file;
    const c = baseCard('zip', src.name); c.urls = [];
    c.meta = { name: src.name, type: src.type || '', size: src.size || 0, lastModified: src.lastModified || 0 };
    const card = c.el; card.classList.add('zip-card'); card.dataset.zipMode = props.zipMode || 'equal';
    card.innerHTML = `
      <div class="zip-toolbar">
        <button class="zip-toggle equal" data-mode="equal">동일 속도</button>
        <button class="zip-toggle prop" data-mode="proportional">비율 모드</button>
        <span class="zip-name"></span>
        <button class="zdel" title="삭제">✕</button>
      </div>
      <div class="zip-inner"></div>
      <div class="zip-loading"><div style="width:60%"><div class="bar"><i></i></div><div style="margin-top:6px;text-align:center;"><span class="pct">0</span>%</div></div></div>`;
    $('.zip-name', card).textContent = src.name; $('.zip-name', card).title = src.name;
    $('.zdel', card).addEventListener('click', e => { e.stopPropagation(); removeCard(c); });
    const toggles = $$('.zip-toggle', card);
    const setZipMode = m => { card.dataset.zipMode = m; toggles.forEach(x => x.classList.toggle('active', x.dataset.mode === m)); };
    toggles.forEach(b => b.addEventListener('click', () => setZipMode(b.dataset.mode))); setZipMode(card.dataset.zipMode);
    card.addEventListener('click', () => { if (S.deleting) removeCard(c); });
    wireArrange(c); layout();

    if (el.optCache.checked && cacheOK && !props.fromCache) {
      c.cacheKey = cacheKeyFor(file);
      c.cachePromise = cachePut(c.cacheKey, file).then(() => { c.cached = true; refreshCacheInfo(); }).catch(err => { toast('캐시 저장 실패: ' + (err && err.message || err)); });
    } else if (props.fromCache) { c.cacheKey = props.cacheKey; c.cached = true; }

    const inner = $('.zip-inner', card), loading = $('.zip-loading', card);
    try {
      const u8 = new Uint8Array(await file.arrayBuffer());
      const imgs = []; await collectImages(u8, 0, imgs);
      let loaded = 0; const total = Math.max(1, imgs.length);
      const upd = () => { const p = Math.floor(loaded / total * 100); $('.pct', loading).textContent = p; $('.bar > i', loading).style.width = p + '%'; if (loaded >= total) loading.remove(); };
      if (!imgs.length) loading.remove();
      for (const it of imgs) {
        const ext = (it.name.match(/\.(\w+)$/) || [])[1]?.toLowerCase();
        const url = URL.createObjectURL(new Blob([it.buf], { type: MIME[ext] || 'image/*' })); c.urls.push(url);
        const img = document.createElement('img'); img.decoding = 'async';
        img.onload = img.onerror = () => { loaded++; upd(); };
        img.src = url; inner.appendChild(img);
      }
    } catch (err) { loading.remove(); inner.textContent = 'ZIP을 읽을 수 없습니다: ' + err.message; }
    layout();
    return c;
  }

  // ZIP 동기 스크롤 (오른쪽 막대 / Alt+휠) — 개별 스크롤은 카드 위 휠(기본), 페이지 스크롤은 카드 밖. 동일 모드는 가장 긴 컬럼 기준.
  const zipGroup = () => modeCards().filter(isZip).map(c => c.el);
  const maxScroll = g => g.reduce((m, e) => Math.max(m, e.scrollHeight - e.clientHeight), 0);
  function setByRatio(ratio, g) {
    const M = maxScroll(g);
    g.forEach(e => { const range = e.scrollHeight - e.clientHeight; if (range <= 0) return; e.scrollTop = e.dataset.zipMode === 'proportional' ? ratio * range : Math.min(range, ratio * M); });
    zgsThumb.style.top = (ratio * Math.max(0, zgsRail.clientHeight - zgsThumb.clientHeight)) + 'px';
  }
  const thumbRatio = () => { const mt = zgsRail.clientHeight - zgsThumb.clientHeight; return mt > 0 ? parseFloat(zgsThumb.style.top || '0') / mt : 0; };
  window.addEventListener('wheel', e => {
    if (S.mode !== 'zip' || !e.altKey) return;
    const g = zipGroup(); if (!g.length) return;
    e.preventDefault(); const M = maxScroll(g); if (M <= 0) return;
    const px = e.deltaMode === 1 ? e.deltaY * 48 : e.deltaY * 0.8;
    setByRatio(clamp(thumbRatio() + px / M, 0, 1), g);
  }, { passive: false });
  let zdrag = null;
  zgsThumb.addEventListener('pointerdown', e => { zdrag = { y: e.clientY, top: parseFloat(zgsThumb.style.top || '0') }; zgsThumb.setPointerCapture(e.pointerId); });
  zgsThumb.addEventListener('pointermove', e => { if (!zdrag) return; const mt = zgsRail.clientHeight - zgsThumb.clientHeight; const top = clamp(zdrag.top + e.clientY - zdrag.y, 0, mt); setByRatio(mt ? top / mt : 0, zipGroup()); });
  zgsThumb.addEventListener('pointerup', () => { zdrag = null; });
  zgsRail.addEventListener('pointerdown', e => { if (e.target === zgsThumb) return; const r = zgsRail.getBoundingClientRect(); const mt = r.height - zgsThumb.clientHeight; setByRatio(clamp((e.clientY - r.top - zgsThumb.clientHeight / 2) / (mt || 1), 0, 1), zipGroup()); });

  // ================= 파일 추가 =================
  async function runPool(items, fn, n) {
    let i = 0; const out = new Array(items.length);
    await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); } }));
    return out;
  }
  async function handleFiles(files) {
    const arr = Array.from(files || []).map(normalizeFile).filter(Boolean);
    if (!arr.length) return toast('지원하지 않는 파일입니다. (영상 / GIF / WebP / 이미지 / ZIP)');
    const zips = arr.filter(s => s.kind === 'zip'), media = arr.filter(s => s.kind !== 'zip');
    if (zips.length && !media.length && S.mode !== 'zip') setMode('zip');
    else if (media.length && !zips.length && S.mode !== 'video') setMode('video');
    // 카드 생성(순서 보존)은 즉시, 로딩은 3개씩 병렬
    await runPool(media, s => addSource(s), 3);
    for (const z of zips) addZip(z);
    layout();
  }
  el.fileInput.addEventListener('change', e => { handleFiles(e.target.files); e.target.value = ''; });
  el.fileInputZip.addEventListener('change', e => { handleFiles(e.target.files); e.target.value = ''; });
  $('#urlBtn').addEventListener('click', () => {
    const u = (prompt('영상/이미지 URL을 입력하세요 (mp4, webm, gif …)') || '').trim(); if (!u) return;
    const name = decodeURIComponent((u.split('?')[0].split('/').pop() || 'url')); const kind = IMG_EXT.test(name) ? 'image' : 'video';
    if (S.mode !== 'video') setMode('video');
    addSource({ url: u, name, type: '', kind });
  });
  // 드래그&드롭
  let dragDepth = 0;
  window.addEventListener('dragenter', e => { if (e.dataTransfer?.types?.includes('Files')) { dragDepth++; dropOverlay.classList.remove('hidden'); } });
  window.addEventListener('dragleave', () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) dropOverlay.classList.add('hidden'); });
  window.addEventListener('dragover', e => { if (e.dataTransfer?.types?.includes('Files')) e.preventDefault(); });
  window.addEventListener('drop', e => { e.preventDefault(); dragDepth = 0; dropOverlay.classList.add('hidden'); if (e.dataTransfer?.files?.length) handleFiles(e.dataTransfer.files); });

  // ================= 전체 제어 =================
  el.playAll.addEventListener('click', () => { videoCards().forEach(c => { c.wantPlay = true; }); reconcileNow(); });
  el.pauseAll.addEventListener('click', () => { videoCards().forEach(c => { c.wantPlay = false; if (c.loaded) c.video.pause(); }); });
  el.bulkDelete.addEventListener('click', () => {
    if (!confirm('현재 모드의 카드를 모두 삭제할까요?')) return;
    modeCards().forEach(c => removeCard(c, true)); layout();
  });

  // ================= 프라이빗 모드 =================
  // 영상은 원래 인터넷으로 나가지 않는다. 이 모드는 PC 브라우저에 남는 흔적(영상 사본·파일 이름·세션)을 막는다.
  const privEl = $('#privateMode'), privBadge = $('#privBadge');
  const isPrivate = () => privEl.checked;
  function setPrivate(on) {
    privEl.checked = on; document.body.classList.toggle('private', on); privBadge.classList.toggle('hidden', !on);
    el.optCache.disabled = on; if (on) el.optCache.checked = false;
    try { if (on) localStorage.setItem('gv_private', '1'); else localStorage.removeItem('gv_private'); } catch (_) { }
  }
  privEl.addEventListener('change', () => {
    setPrivate(privEl.checked);
    if (privEl.checked && confirm('지금까지 남은 기록(영상 캐시·세션·자동 저장)도 지울까요?')) wipeAll(true);
    toast(privEl.checked ? '프라이빗 모드 켜짐 — 기록을 남기지 않습니다' : '프라이빗 모드 꺼짐', true);
  });
  async function wipeAll(silent) {
    Object.keys(localStorage).filter(k => /^gv_(session|profile):/.test(k)).forEach(k => localStorage.removeItem(k));
    try { if (cacheOK) await caches.delete(CACHE_NAME); } catch (_) { }
    cards.forEach(c => { c.cached = false; });
    listSessions(); listProfiles(); refreshCacheInfo();
    if (!silent) toast('남아 있던 기록을 모두 지웠습니다.', true);
  }
  $('#wipeAll').addEventListener('click', () => { if (confirm('저장된 세션·프로파일·영상 캐시·자동 저장을 모두 지울까요?')) wipeAll(); });

  // ================= 세션 (세이브 파일) =================
  const SKEY = 'gv_session:', AUTO_NAME = '⟲ 마지막 종료 상태';
  function listSessions() {
    const keys = Object.keys(localStorage).filter(k => k.startsWith(SKEY)).sort();
    el.sessionList.innerHTML = keys.map(k => { const d = readJSON(k); const n = d && d.cards ? d.cards.length : 0; return `<option value="${k}">${k.slice(SKEY.length)} (${n}개)</option>`; }).join('');
  }
  function buildSession() {
    return {
      app: 'gv', version: 14, savedAt: new Date().toISOString(), settings: snapshot(),
      cards: cards.map(c => {
        const d = { kind: c.kind, name: c.meta ? c.meta.name : c.name, type: c.meta ? c.meta.type : '', size: c.meta ? c.meta.size : 0, lastModified: c.meta ? c.meta.lastModified : 0,
          cacheKey: c.cached ? c.cacheKey : null, url: c.remote ? c.url : null, span: c.span || 1, cf: c.el.dataset.cf || '', fit: c.el.dataset.fit || 'contain' };
        if (c.kind === 'video') Object.assign(d, { time: curTime(c), rate: c.rate, loop: c.loopOn, muted: c.muted, ab: c.ab, wantPlay: c.wantPlay });
        if (c.kind === 'zip') d.zipMode = c.el.dataset.zipMode;
        return d;
      }),
    };
  }
  async function saveSession(name, silent) {
    if (isPrivate()) return toast('프라이빗 모드에서는 세션을 저장하지 않습니다.');
    await Promise.allSettled(cards.map(c => c.cachePromise).filter(Boolean)); // 캐시 저장이 끝날 때까지 대기
    const data = buildSession();
    try { localStorage.setItem(SKEY + name, JSON.stringify(data)); } catch (e) { return toast('세션 저장 실패: ' + e.message); }
    listSessions(); el.sessionList.value = SKEY + name;
    if (!silent) {
      const miss = data.cards.filter(d => !d.cacheKey && !d.url).length;
      toast(`세션 저장: ${name} (${data.cards.length}개)` + (miss ? ` — 캐시되지 않은 ${miss}개는 복원 때 원본 파일이 필요합니다` : ''), true, 4500);
    }
  }
  const sessionNameOrNow = () => (el.sessionName.value || '').trim() || ('세션 ' + new Date().toLocaleString('ko-KR', { hour12: false }));
  $('#sessionSave').addEventListener('click', () => saveSession(sessionNameOrNow()));
  $('#sessionQuick').addEventListener('click', () => saveSession(sessionNameOrNow()));
  $('#sessionOpen').addEventListener('click', () => { openPanel(menuPanel); $('#sessionSec').scrollIntoView({ behavior: 'smooth', block: 'start' }); });
  $('#sessionDel').addEventListener('click', () => { const k = el.sessionList.value; if (!k || !confirm('이 세션을 삭제할까요?')) return; localStorage.removeItem(k); listSessions(); });

  // pool: 직접 선택한 원본 파일들 (name|size 매칭)
  async function restoreSession(data, pool) {
    if (!data || !Array.isArray(data.cards)) return toast('올바른 세션 파일이 아닙니다.');
    cards.slice().forEach(c => removeCard(c, true));
    if (data.settings) applyProfile(data.settings);
    const missing = [];
    toast(`세션 복원 중… (${data.cards.length}개)`, true, 2000);
    await runPool(data.cards, async d => {
      let blob = null, fromCache = false;
      if (!d.url) {
        const f = pool && pool.get(d.name + '|' + d.size);
        if (f) blob = f;
        else if (d.cacheKey) { try { blob = await cacheGet(d.cacheKey); fromCache = !!blob; } catch (_) { } }
        if (!blob) { missing.push(d.name); return null; }
      }
      const file = blob ? (blob instanceof File ? blob : new File([blob], d.name, { type: d.type || blob.type, lastModified: d.lastModified || Date.now() })) : null;
      const src = { file, url: d.url, name: d.name, type: d.type, size: d.size, lastModified: d.lastModified, kind: d.kind };
      const props = { span: d.span, cf: d.cf, fit: d.fit, time: d.time, rate: d.rate, loop: d.loop, muted: d.muted, ab: d.ab, wantPlay: d.wantPlay, fromCache, cacheKey: d.cacheKey, zipMode: d.zipMode };
      return d.kind === 'zip' ? addZip(src, props) : addSource(src, props);
    }, 3);
    layout();
    if (missing.length) toast(`복원하지 못한 ${missing.length}개: ${missing.slice(0, 3).join(', ')}${missing.length > 3 ? ' …' : ''} — 'JSON 가져오기'에서 원본 파일을 함께 선택하세요.`, false, 8000);
    else toast('세션 복원 완료', true);
  }
  $('#sessionLoadBtn').addEventListener('click', () => { const k = el.sessionList.value; if (!k) return toast('저장된 세션이 없습니다.'); restoreSession(readJSON(k)); });
  $('#sessionExport').addEventListener('click', async () => {
    await Promise.allSettled(cards.map(c => c.cachePromise).filter(Boolean));
    const blob = new Blob([JSON.stringify(buildSession(), null, 2)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'gv-session-' + new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-') + '.json'; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  });
  $('#sessionImport').addEventListener('change', async e => {
    const files = Array.from(e.target.files || []); e.target.value = '';
    const json = files.find(f => /\.json$/i.test(f.name) || f.type === 'application/json'); if (!json) return toast('세션 JSON 파일을 함께 선택하세요.');
    let data; try { data = JSON.parse(await json.text()); } catch (_) { return toast('JSON 을 읽을 수 없습니다.'); }
    const pool = new Map(files.filter(f => f !== json).map(f => [f.name + '|' + f.size, f]));
    restoreSession(data, pool);
  });
  window.addEventListener('beforeunload', () => {
    if (isPrivate()) return;
    try { localStorage.setItem(PKEY + 'last', JSON.stringify(snapshot())); if (cards.length) localStorage.setItem(SKEY + AUTO_NAME, JSON.stringify(buildSession())); } catch (_) { }
  });

  // ================= 키보드 =================
  window.addEventListener('keydown', e => {
    if (/^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement?.tagName)) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 'Escape') { if (openedPanel) openPanel(null); else setActive(null); return; }
    if (S.mode !== 'video') return;
    const targets = S.active && S.active.kind === 'video' ? [S.active] : videoCards();
    if (!targets.length) return;
    const dig = /^(?:Digit|Numpad)([1-9])$/.exec(e.code);
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault(); const d = (e.key === 'ArrowLeft' ? -1 : 1) * S.skip;
      targets.forEach(c => seekTo(c, curTime(c) + d));
    } else if (dig) {
      e.preventDefault(); targets.forEach(c => seekPct(c, parseInt(dig[1], 10) / 10)); // 넘패드 4 = 40%, 8 = 80%
    } else if (e.code === 'Space') {
      e.preventDefault();
      if (S.active) togglePlay(S.active);
      else { const any = targets.some(c => c.wantPlay); targets.forEach(c => { c.wantPlay = !any; if (!c.wantPlay && c.loaded) c.video.pause(); }); reconcileNow(); }
    } else if ((e.key === 'a' || e.key === 'A') && S.active) setAB(S.active, 'a');
    else if ((e.key === 'b' || e.key === 'B') && S.active) setAB(S.active, 'b');
    else if ((e.key === 'f' || e.key === 'F') && S.active) { const p = S.active.el.requestFullscreen?.(); if (p && p.catch) p.catch(() => { }); }
    else if ((e.key === 'm' || e.key === 'M') && S.active) { setMuted(S.active, !S.active.muted); reconcile(); }
  });
  // 빈 곳 클릭 → 선택 해제 / 열린 팝오버 닫기
  contentRoot.addEventListener('click', e => { if (!e.target.closest('.card')) setActive(null); });
  document.addEventListener('click', e => { if (!e.target.closest('.popover, .gear')) $$('.popover.open').forEach(p => p.classList.remove('open')); });

  // ================= rAF: 선택 카드 재생바 / A-B 반복 / FPS =================
  let frames = 0, lastT = performance.now();
  function tick(now) {
    frames++;
    if (now - lastT >= 1000) {
      if (S.showFPS) fpsHud.textContent = 'FPS: ' + frames + ' | 재생 ' + videoCards().filter(c => c.loaded && !c.video.paused).length + '/' + videoCards().length + ' | 상한 ' + cap();
      frames = 0; lastT = now;
    }
    // A-B 반복 (재생 중인 카드)
    for (const c of cards) {
      if (c.kind !== 'video' || !c.loaded || !c.ab.on || c.video.paused) continue;
      const t = c.video.currentTime;
      if (c.ab.b != null && (t >= c.ab.b || t < (c.ab.a || 0) - 0.4)) c.video.currentTime = c.ab.a || 0;
    }
    // 재생바는 선택된 카드만 갱신
    const c = S.active;
    if (c && c.kind === 'video' && c.duration && (!S.lowPower || (frames & 3) === 0)) {
      const t = curTime(c);
      c._bar = c._bar || $('.bar', c.el); c._ti = c._ti || $('.timeinfo', c.el); c._buf = c._buf || $('.buf', c.el);
      c._bar.style.transform = `scaleX(${clamp(t / c.duration, 0, 1)})`;
      c._ti.textContent = fmt(t) + ' / ' + fmt(c.duration);
      try { const b = c.video.buffered; if (c.loaded && b.length) c._buf.style.transform = `scaleX(${clamp(b.end(b.length - 1) / c.duration, 0, 1)})`; } catch (_) { }
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
  document.addEventListener('visibilitychange', () => { if (document.hidden) videoCards().forEach(c => { if (c.loaded) c.video.pause(); }); else reconcileNow(); });

  // ================= 초기화 =================
  listProfiles(); listSessions(); refreshCacheInfo();
  document.documentElement.style.setProperty('--zoom', '1');
  updateSkip(); setZoomLabel(100); setFilterStrength(100); setGap(S.gap); setPad(S.pad); setZipGap(6); setFont(90); setUi(100); setTheme('dark'); setAccent(S.accent); applyTint();
  const activeKey = localStorage.getItem(PKEY + 'active');
  const initial = (activeKey && readJSON(activeKey)) || readJSON(PKEY + 'last');
  if (initial) applyProfile(initial); else setMode('video');
  if (activeKey) el.profileList.value = activeKey;
  try { setPrivate(localStorage.getItem('gv_private') === '1'); } catch (_) { }
  layout();
  // 앱 설치(PWA) — http(s) 에서만
  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) navigator.serviceWorker.register('sw.js').catch(() => { });

  window.__gv = { cards, S, handleFiles, reconcileNow, cap, toast, saveSession, restoreSession, buildSession }; // 디버깅/검수용
})();
