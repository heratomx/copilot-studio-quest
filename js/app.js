/* Copilot Studio Quest – a static, gamified workshop app.
   No backend, no sign-in: progress lives in the participant's browser (localStorage). */
(() => {
  'use strict';

  // ---------- Setup ----------
  const params = new URLSearchParams(location.search);
  const WS = ((params.get('workshop') || 'workshop').toLowerCase().replace(/[^a-z0-9-]/g, '')) || 'workshop';
  const STORE_KEY = 'csq:' + WS;
  const AVATARS = ['🦊', '🐼', '🦉', '🐙', '🦄', '🐝', '🐧', '🦁', '🐸', '🤖', '🚀', '☕'];
  const RANK_XP = [0, 60, 160, 300, 450];
  const XP = { base: 10, boss: 2, combo: 5, hintCost: 5, speedBonus: 5, idea: 10, feedback: 5 };

  const app = document.getElementById('app');
  { const nativeAppend = app.append.bind(app); app.append = (...kids) => nativeAppend(...kids.filter((k) => k != null && k !== false)); }
  const topbar = document.getElementById('topbar');
  let config = null;
  const lessons = {};
  let store = load();
  let run = null; // current level run
  let current = { screen: 'welcome', arg: null };
  const LIVE_PARAM = (params.get('live') || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
  const live = { state: 'off', code: null, player: null, timer: null, pending: false };
  let storyIdx = 0;

  // ---------- Language ----------
  const I18N = window.I18N || { en: {} };
  let lang = 'en';
  function t(key, vars) {
    let v = I18N[lang] && I18N[lang][key];
    if (v == null) v = I18N.en[key];
    if (v == null) return key;
    if (typeof v === 'string' && vars) v = v.replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? vars[k] : m));
    return v;
  }
  // Text in workshop.json can be a plain string or { "en": "...", "de": "..." }
  const loc = (v) => (v && typeof v === 'object' && !Array.isArray(v)) ? (v[lang] ?? v.en ?? Object.values(v)[0]) : v;
  const languages = () => (config.languages && config.languages.length ? config.languages : [{ code: 'en', label: 'English', flag: '🇬🇧' }]);

  // ---------- Helpers ----------
  function el(tag, attrs = {}, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') n.className = v;
      else if (k === 'html') n.innerHTML = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat()) {
      if (kid == null || kid === false) continue;
      n.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    }
    return n;
  }
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function inline(s) {
    return esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/\*(.+?)\*/g, '<i>$1</i>').replace(/`(.+?)`/g, '<code>$1</code>');
  }
  // Tiny, safe markdown: paragraphs, "- " bullets, "1. " numbered, **bold**, *italic*, `code`
  function md(text) {
    const blocks = String(text || '').split(/\n\s*\n/);
    return blocks.map((b) => {
      const lines = b.split('\n');
      if (lines.every((l) => /^\s*-\s+/.test(l))) return '<ul>' + lines.map((l) => '<li>' + inline(l.replace(/^\s*-\s+/, '')) + '</li>').join('') + '</ul>';
      if (lines.every((l) => /^\s*\d+\.\s+/.test(l))) return '<ol>' + lines.map((l) => '<li>' + inline(l.replace(/^\s*\d+\.\s+/, '')) + '</li>').join('') + '</ol>';
      return '<p>' + lines.map(inline).join('<br>') + '</p>';
    }).join('');
  }
  const rich = (text) => el('div', { class: 'richtext', html: md(text) });
  const shuffle = (a) => { const b = a.slice(); for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; };
  const clear = (n) => { while (n.firstChild) n.removeChild(n.firstChild); };

  function load() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY)) || { players: {}, current: null, muted: false }; }
    catch { return { players: {}, current: null, muted: false }; }
  }
  function save() { try { localStorage.setItem(STORE_KEY, JSON.stringify(store)); } catch { /* storage full or blocked */ } }
  const me = () => store.players[store.current];

  function rankOf(xp) {
    const names = t('ranks'); let i = 0;
    for (let k = 0; k < RANK_XP.length; k++) if (xp >= RANK_XP[k]) i = k;
    return { idx: i, title: names[i], from: RANK_XP[i], next: i + 1 < RANK_XP.length ? [RANK_XP[i + 1], names[i + 1]] : null };
  }

  // ---------- Sound & effects ----------
  let actx = null;
  function beep(kind) {
    if (store.muted) return;
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      const seq = { good: [660, 880], bad: [220, 160], combo: [660, 880, 1100], level: [523, 659, 784, 1046], click: [500] }[kind] || [500];
      seq.forEach((f, i) => {
        const o = actx.createOscillator(), g = actx.createGain();
        o.type = kind === 'bad' ? 'sawtooth' : 'triangle';
        o.frequency.value = f;
        const t = actx.currentTime + i * 0.09;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.12, t + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
        o.connect(g).connect(actx.destination);
        o.start(t); o.stop(t + 0.2);
      });
    } catch { /* audio not available */ }
  }
  let toastTimer;
  function toast(msg) {
    const t = document.getElementById('toast');
    t.textContent = msg; t.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
  }
  function confetti(amount = 140) {
    const c = document.getElementById('confetti'), ctx = c.getContext('2d');
    c.width = innerWidth; c.height = innerHeight;
    const colors = ['#5b5fc7', '#8a3ffc', '#ff8a3d', '#ffd166', '#1f9d55', '#ef476f'];
    const ps = Array.from({ length: amount }, () => ({
      x: Math.random() * c.width, y: -20 - Math.random() * c.height * 0.5,
      vx: (Math.random() - 0.5) * 4, vy: 2 + Math.random() * 4, s: 5 + Math.random() * 6,
      r: Math.random() * 6, vr: (Math.random() - 0.5) * 0.3, col: colors[Math.floor(Math.random() * colors.length)]
    }));
    let frames = 0;
    (function tick() {
      ctx.clearRect(0, 0, c.width, c.height);
      ps.forEach((p) => { p.x += p.vx; p.y += p.vy; p.vy += 0.05; p.r += p.vr; ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r); ctx.fillStyle = p.col; ctx.fillRect(-p.s / 2, -p.s / 2, p.s, p.s * 0.6); ctx.restore(); });
      if (++frames < 200) requestAnimationFrame(tick); else ctx.clearRect(0, 0, c.width, c.height);
    })();
  }
  function lightbox(src) {
    const lb = document.getElementById('lightbox');
    clear(lb); lb.append(el('img', { src, alt: t('zoomedAlt') }));
    lb.classList.remove('hidden');
    lb.onclick = () => lb.classList.add('hidden');
  }

  // ---------- XP ----------
  function addXp(n, reason) {
    const p = me(); if (!p || !n) return;
    const before = rankOf(p.xp).idx;
    p.xp = Math.max(0, p.xp + n);
    save(); renderTopbar();
    const after = rankOf(p.xp).idx;
    if (n > 0 && after !== before) { setTimeout(() => { toast(t('levelUp', { rank: rankOf(p.xp).title })); beep('level'); confetti(80); }, 600); }
    else if (reason) toast(reason);
  }

  // ---------- Top bar ----------
  function langPicker(extraClass) {
    const langs = languages();
    if (langs.length < 2) return null;
    const sel = el('select', { class: 'langsel ' + (extraClass || ''), 'aria-label': t('language'), title: t('language'), onchange: (e) => setLang(e.target.value) },
      langs.map((L) => el('option', { value: L.code, selected: L.code === lang }, (L.flag ? L.flag + ' ' : '') + (extraClass === 'compact' ? L.code.toUpperCase() : L.label))));
    return sel;
  }
  function renderTopbar() {
    const p = me();
    if (!p) { topbar.classList.add('hidden'); return; }
    topbar.classList.remove('hidden');
    const r = rankOf(p.xp);
    const pct = r.next ? Math.round(((p.xp - r.from) / (r.next[0] - r.from)) * 100) : 100;
    clear(topbar);
    topbar.append(el('div', { class: 'topbar-inner' },
      el('div', { class: 'who' },
        el('div', { class: 'avatar', 'aria-hidden': 'true' }, p.avatar),
        el('div', { class: 'who-text' },
          el('div', { class: 'who-name' }, p.name),
          el('div', { class: 'who-rank' }, r.title),
          el('div', { class: 'xpbar', title: r.next ? t('xpTo', { xp: r.next[0] - p.xp, rank: r.next[1] }) : t('maxRank') }, el('span', { style: `width:${pct}%` })))),
      p.streak >= 2 ? el('span', { class: 'streak', title: t('streakTitle') }, '🔥 ' + p.streak) : null,
      el('span', { class: 'xp-pill' }, p.xp + ' XP'),
      langPicker('compact'),
      el('button', { class: 'iconbtn', title: t('mapTitle'), 'aria-label': t('mapTitle'), onclick: () => go('map') }, '🗺️'),
      el('button', { class: 'iconbtn', title: t('cardsTitle'), 'aria-label': t('cardsTitle'), onclick: () => go('cards') }, '🎴'),
      el('button', { class: 'iconbtn', title: store.muted ? t('soundOff') : t('soundOn'), 'aria-label': t('toggleSound'), onclick: () => { store.muted = !store.muted; save(); renderTopbar(); } }, store.muted ? '🔇' : '🔊')
    ));
  }

  // ---------- Routing ----------
  function go(screen, arg) {
    if (run && run.timer) clearInterval(run.timer);
    if (screen !== 'level') run = null;
    window.scrollTo({ top: 0, behavior: 'smooth' });
    clear(app);
    if (!me() && screen !== 'welcome') screen = 'welcome';
    current = { screen, arg };
    ({ welcome: renderWelcome, map: renderMap, level: startLevel, cards: renderCards, certificate: renderCertificate, report: renderReport })[screen](arg);
    renderTopbar();
  }

  // ---------- Welcome ----------
  function renderWelcome() {
    const intro = config.storyIntro || {};
    const chapters = (intro.chapters || []).map((c) => ({ icon: c.icon, title: loc(c.title), text: loc(c.text), stats: (c.stats || []).map(loc) }));
    const speaker = intro.speaker || {};
    const existing = Object.keys(store.players);

    // Hero banner
    const hero = el('div', { class: 'story-hero' },
      el('div', { class: 'story-hero-top' },
        el('span', { class: 'story-kicker' }, '☕ ' + (loc(config.company) || '')),
        langPicker('on-dark')),
      el('div', { class: 'story-scene', 'aria-hidden': 'true' },
        ['☕', '🏪', '🤖', '🥐', '⚡'].map((e, i) => el('span', { class: 'float f' + i }, e))),
      el('h1', {}, loc(config.title)),
      el('p', { class: 'story-sub' }, loc(config.subtitle)));

    // Story chapters with a speaking character
    const storyBox = el('div', { class: 'card story-card' });
    const joinCard = el('div', { class: 'card stack join-card', id: 'join' });

    function paintStory() {
      clear(storyBox);
      if (!chapters.length) { storyBox.append(rich(loc(config.story))); return; }
      const c = chapters[storyIdx];
      const last = storyIdx === chapters.length - 1;
      storyBox.append(
        el('div', { class: 'story-badge' }, '📜 ' + t('storyBadge')),
        el('div', { class: 'speaker' },
          el('div', { class: 'speaker-avatar', 'aria-hidden': 'true' }, speaker.avatar || '👩‍💼'),
          el('div', {}, el('div', { class: 'speaker-name' }, loc(speaker.name) || ''), el('div', { class: 'speaker-role' }, loc(speaker.role) || ''))),
        el('div', { class: 'chapter', key: storyIdx },
          el('div', { class: 'chapter-icon', 'aria-hidden': 'true' }, c.icon || '☕'),
          el('div', { class: 'speech' },
            el('h2', {}, c.title),
            rich(c.text),
            c.stats.length ? el('div', { class: 'stat-row' }, c.stats.map((x) => el('span', { class: 'stat' }, x))) : null)),
        el('div', { class: 'story-nav' },
          el('div', { class: 'dots', role: 'tablist' }, chapters.map((_, i) => el('button', { class: 'dot' + (i === storyIdx ? ' on' : ''), 'aria-label': (i + 1) + '/' + chapters.length, onclick: () => { storyIdx = i; paintStory(); } }))),
          el('div', { class: 'spacer' }),
          storyIdx > 0 ? el('button', { class: 'btn ghost', onclick: () => { storyIdx--; paintStory(); } }, '◀ ' + t('storyBack')) : el('button', { class: 'btn ghost', onclick: () => { storyIdx = chapters.length - 1; paintStory(); focusJoin(); } }, t('storySkip')),
          last ? el('button', { class: 'btn', onclick: focusJoin }, t('storyReady') + ' ⬇')
               : el('button', { class: 'btn', onclick: () => { storyIdx++; beep('click'); paintStory(); } }, t('storyNext') + ' ▶')));
    }
    function focusJoin() { joinCard.classList.add('pulse-once'); joinCard.scrollIntoView({ behavior: 'smooth', block: 'start' }); setTimeout(() => { nameIn.focus({ preventScroll: true }); joinCard.classList.remove('pulse-once'); }, 700); }

    // Join form
    let avatar = AVATARS[Math.floor(Math.random() * AVATARS.length)];
    const nameIn = el('input', { class: 'input', id: 'nick', maxlength: '24', placeholder: t('nickPlaceholder'), autocomplete: 'off' });
    const avatarsBox = el('div', { class: 'avatars', role: 'radiogroup', 'aria-label': t('chooseAvatar') });
    const paintAvatars = () => {
      clear(avatarsBox);
      AVATARS.forEach((a) => avatarsBox.append(el('button', { type: 'button', class: a === avatar ? 'sel' : '', role: 'radio', 'aria-checked': String(a === avatar), onclick: () => { avatar = a; paintAvatars(); } }, a)));
    };
    paintAvatars();
    const start = () => {
      const name = nameIn.value.trim().replace(/\s+/g, ' ');
      if (name.length < 2) { nameIn.classList.add('shake'); setTimeout(() => nameIn.classList.remove('shake'), 400); nameIn.focus(); return; }
      if (!store.players[name]) store.players[name] = newPlayer(name, avatar);
      else store.players[name].avatar = avatar;
      store.current = name; save(); beep('level');
      go('map');
    };
    nameIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') start(); });
    joinCard.append(
      el('h2', {}, '🦸 ' + t('joinTitle')),
      el('div', {}, el('label', { class: 'lbl', for: 'nick' }, t('nickname')), nameIn),
      el('div', {}, el('div', { class: 'lbl' }, t('pickAvatar')), avatarsBox),
      el('div', { class: 'row' }, el('button', { class: 'btn big', onclick: start }, t('startQuest')),
        el('span', { class: 'muted small' }, t('questMeta', { levels: config.levels.length, minutes: config.durationMinutes }))),
      el('p', { class: 'muted small' }, t('privacyNote')),
      LIVE_PARAM && config.liveResults !== false ? el('p', { class: 'live-notice' }, t('liveNotice')) : null);

    paintStory();
    const kids = [
      hero,
      existing.length ? el('div', { class: 'card returning' }, el('div', { class: 'lbl' }, '👋 ' + t('continueAs')),
        el('div', { class: 'players' }, existing.map((n) => el('button', { class: 'player-chip', onclick: () => { store.current = n; save(); go('map'); } }, store.players[n].avatar + ' ' + n + ' · ' + store.players[n].xp + ' XP')))) : null,
      storyBox, joinCard,
      el('p', { class: 'disclaimer' }, loc(config.disclaimer) || '')];
    app.append(...kids.filter(Boolean));
  }
  function newPlayer(name, avatar) {
    return { name, avatar, xp: 0, streak: 0, bestStreak: 0, badges: [], cards: [], done: {}, progress: {}, unlocked: [], missions: [], idea: null, feedback: null, created: new Date().toISOString() };
  }

  // ---------- Map ----------
  function levelStatus(i) {
    const p = me(), lv = config.levels[i];
    if (p.done[lv.id]) return 'done';
    if (config.unlockMode === 'open' || i === 0 || p.unlocked.includes(lv.id) || p.done[config.levels[i - 1].id]) return 'open';
    return 'locked';
  }
  function renderMap() {
    const p = me();
    ensureLive();
    const doneCount = config.levels.filter((l) => p.done[l.id]).length;
    const firstOpen = config.levels.findIndex((_, i) => levelStatus(i) === 'open');
    const codeIn = el('input', { class: 'input', placeholder: t('trainerCode'), maxlength: '20', 'aria-label': t('trainerCode'), autocomplete: 'off' });
    const useCode = () => {
      const code = codeIn.value.trim().toUpperCase(); if (!code) return;
      if (config.unlockAllCode && code === String(config.unlockAllCode).toUpperCase()) {
        p.unlocked = config.levels.map((l) => l.id); save(); toast(t('allUnlocked')); beep('combo'); return go('map');
      }
      const idx = config.levels.findIndex((l) => String(l.code || '').toUpperCase() === code);
      if (idx < 0) { codeIn.classList.add('shake'); beep('bad'); setTimeout(() => codeIn.classList.remove('shake'), 400); return; }
      // a code unlocks that level and every level before it (for late joiners)
      for (let i = 0; i <= idx; i++) if (!p.unlocked.includes(config.levels[i].id)) p.unlocked.push(config.levels[i].id);
      save(); beep('combo'); toast(t('unlocked', { level: lessons[config.levels[idx].id]?.title || idx }));
      go('map');
    };
    codeIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') useCode(); });

    const tiles = config.levels.map((lv, i) => {
      const L = lessons[lv.id]; const st = levelStatus(i); const d = p.done[lv.id];
      const inProg = p.progress[lv.id] && !d;
      const cls = 'tile ' + (st === 'locked' ? 'locked' : st === 'done' ? 'done' : '') + (i === firstOpen ? ' current' : '');
      return el('button', { class: cls, disabled: st === 'locked', onclick: () => go('level', lv.id), 'aria-label': t('levelAria', { n: i, title: L.title, status: t('status_' + st) }) },
        el('span', { class: 'num' }, i === 0 ? t('start') : t('levelN', { n: i })),
        el('span', { class: 'ic', 'aria-hidden': 'true' }, st === 'locked' ? '🔒' : L.icon),
        el('span', { class: 't' }, L.title),
        el('span', { class: 'muted small' }, L.subtitle || ''),
        el('span', { class: 'meta' }, d ? el('span', { class: 'stars' }, '★'.repeat(d.stars) + '☆'.repeat(3 - d.stars)) : inProg ? t('continue') : t('tileMeta', { min: lv.minutes || 5, steps: L.steps.length })));
    });
    app.append(
      el('div', { class: 'row', style: 'margin:10px 0 16px' },
        el('div', {}, el('h2', { style: 'margin:0' }, t('questMap')), el('div', { class: 'muted' }, t('levelsDone', { done: doneCount, total: config.levels.length }))),
        el('div', { class: 'spacer' }),
        Object.keys(p.results || {}).length ? el('button', { class: 'btn secondary', onclick: () => go('report') }, t('myReport')) : null,
        doneCount === config.levels.length ? el('button', { class: 'btn', onclick: () => go('certificate') }, t('myCertificate')) : null),
      liveChip(),
      el('div', { class: 'map' }, tiles),
      el('div', { class: 'card', style: 'margin-top:18px' },
        el('div', { class: 'lbl' }, t('codePrompt')),
        el('div', { class: 'codebox' }, codeIn, el('button', { class: 'btn', onclick: useCode }, t('unlock')))),
      el('div', { class: 'row', style: 'margin-top:12px' },
        el('button', { class: 'btn ghost', onclick: () => { store.current = null; save(); go('welcome'); } }, t('switchPlayer')),
        el('div', { class: 'spacer' }),
        el('button', { class: 'btn ghost', onclick: () => { if (confirm(t('resetConfirm', { name: p.name }))) { store.players[p.name] = newPlayer(p.name, p.avatar); save(); go('map'); } } }, t('resetProgress'))),
      el('p', { class: 'disclaimer' }, loc(config.disclaimer) || '')
    );
  }

  // ---------- Level runner ----------
  function startLevel(levelId) {
    const L = lessons[levelId]; const p = me();
    const replay = !!p.done[levelId];
    const saved = p.progress[levelId];
    run = {
      id: levelId, L, replay,
      idx: saved && !replay ? saved.idx : 0,
      score: saved && !replay ? saved.score : 0,
      max: saved && !replay ? saved.max : 0,
      hintUsed: saved && !replay ? !!saved.hintUsed : false,
      fiftyUsed: saved && !replay ? !!saved.fiftyUsed : false,
      timer: null
    };
    if (replay) toast(t('practiceMode'));
    renderStep();
  }
  function persistRun() {
    if (!run || run.replay) return;
    me().progress[run.id] = { idx: run.idx, score: run.score, max: run.max, hintUsed: run.hintUsed, fiftyUsed: run.fiftyUsed };
    save();
  }

  function renderStep() {
    clear(app);
    if (run.timer) { clearInterval(run.timer); run.timer = null; }
    const { L } = run; const step = L.steps[run.idx];
    if (!step) return finishLevel();
    const total = L.steps.length;
    const levelNo = config.levels.findIndex((l) => l.id === run.id);
    app.append(
      el('div', { class: 'lvl-head' },
        el('div', { class: 'ic', 'aria-hidden': 'true' }, L.icon),
        el('div', { style: 'flex:1' },
          el('div', { class: 'muted small' }, t('stepOf', { level: levelNo === 0 ? t('start') : t('levelN', { n: levelNo }), n: run.idx + 1, total })),
          el('div', { style: 'font-weight:700' }, L.title)),
        el('button', { class: 'btn ghost', onclick: () => go('map') }, t('closeToMap'))),
      el('div', { class: 'progress', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': String(total), 'aria-valuenow': String(run.idx) }, el('span', { style: `width:${(run.idx / total) * 100}%` }))
    );
    const body = el('div', { class: 'card stack', style: 'margin-top:14px' });
    app.append(body);
    if (step.boss) body.append(el('span', { class: 'boss-tag' }, t('boss')));
    const renderer = RENDER[step.type];
    if (!renderer) { body.append(el('p', {}, t('unknownStep', { type: step.type }))); body.append(nextBtn()); return; }
    renderer(step, body);
  }

  function nextBtn(label = t('next')) {
    const b = el('button', { class: 'btn', onclick: () => { run.idx++; persistRun(); renderStep(); } }, label);
    setTimeout(() => b.focus({ preventScroll: true }), 30);
    return el('div', { class: 'row actions' }, el('div', { class: 'spacer' }), b);
  }

  // Grade a step: fraction 0..1. Shows feedback, awards XP, handles streaks.
  function grade(container, step, fraction, extraText, bonus = 0) {
    const p = me();
    fraction = Math.max(0, Math.min(1, fraction));
    run.score += fraction; run.max += 1;
    recordResult(run.id, run.idx, step, fraction);
    let xp = Math.round((step.xp || XP.base) * fraction) * (step.boss ? XP.boss : 1) + bonus;
    let comboMsg = '';
    if (fraction === 1) {
      p.streak = (p.streak || 0) + 1; p.bestStreak = Math.max(p.bestStreak || 0, p.streak);
      if (p.streak % 3 === 0) { xp += XP.combo; comboMsg = t('combo', { n: p.streak, xp: XP.combo }); }
    } else p.streak = 0;
    if (run.replay) xp = 0;
    const cls = fraction === 1 ? 'good' : fraction >= 0.5 ? 'mid' : 'bad';
    const title = fraction === 1 ? pick(t('good')) : fraction >= 0.5 ? t('mid') : pick(t('bad'));
    container.append(el('div', { class: 'feedback ' + cls },
      el('div', { class: 'fb-title' }, title + (xp ? `  +${xp} XP` : '')),
      extraText ? rich(extraText) : null,
      step.explain ? rich(step.explain) : null));
    beep(fraction === 1 ? (comboMsg ? 'combo' : 'good') : 'bad');
    if (fraction < 0.5) container.closest('.card')?.classList.add('shake');
    addXp(xp, comboMsg ? comboMsg.trim() : null);
    persistRun();
    container.append(nextBtn());
    container.lastChild.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
  const pick = (a) => a[Math.floor(Math.random() * a.length)];

  function lifelines(step, optButtons, correctIdx) {
    const wrap = el('div', { class: 'lifelines' });
    const hintBox = el('div', { class: 'hintbox hidden' });
    if (step.hint) {
      wrap.append(el('button', { class: 'btn secondary', disabled: run.hintUsed, title: t('oneHint'), onclick: (e) => {
        run.hintUsed = true; persistRun(); e.target.disabled = true;
        if (!run.replay) addXp(-XP.hintCost, t('hintUsed', { xp: XP.hintCost }));
        hintBox.textContent = '💡 ' + step.hint; hintBox.classList.remove('hidden');
      } }, t('hint', { xp: XP.hintCost })));
    }
    if (optButtons && correctIdx != null && optButtons.length >= 4) {
      wrap.append(el('button', { class: 'btn secondary', disabled: run.fiftyUsed, title: t('oneFifty'), onclick: (e) => {
        run.fiftyUsed = true; persistRun(); e.target.disabled = true;
        shuffle(optButtons.map((_, i) => i).filter((i) => i !== correctIdx)).slice(0, 2).forEach((i) => { optButtons[i].classList.add('gone'); optButtons[i].disabled = true; });
      } }, '✂️ 50/50'));
    }
    return wrap.childNodes.length ? [wrap, hintBox] : [];
  }

  function image(src, opts = {}) {
    const box = el('div', { class: 'shot' + (opts.clickable ? ' clickable' : '') });
    const img = el('img', { src, alt: opts.alt || t('screenshotAlt'), loading: 'lazy' });
    box.append(img);
    if (!opts.clickable && !opts.noZoom) { img.style.cursor = 'zoom-in'; img.addEventListener('click', () => lightbox(src)); }
    return box;
  }

  // ---------- Step renderers ----------
  const RENDER = {
    info(step, c) {
      if (step.title) c.append(el('h2', {}, step.title));
      if (step.text) c.append(rich(step.text));
      if (step.image) {
        const shot = image(step.image, { noZoom: !!step.callouts });
        c.append(shot);
        if (step.callouts) {
          const txt = el('div', { class: 'callout-text' }, t('tapDots'));
          const seen = new Set();
          step.callouts.forEach((co, i) => {
            const b = el('button', { class: 'callout', style: `left:${co.x}%;top:${co.y}%`, 'aria-label': t('calloutN', { n: i + 1 }), onclick: () => {
              seen.add(i); b.classList.add('seen'); txt.textContent = (i + 1) + '. ' + co.label; beep('click');
            } }, String(i + 1));
            shot.append(b);
          });
          c.append(txt, el('div', { class: 'zoom-hint' }, el('a', { href: step.image, target: '_blank', rel: 'noopener' }, t('openFull'))));
        } else c.append(el('div', { class: 'zoom-hint' }, t('tapZoom')));
      }
      c.append(nextBtn(run.idx === 0 ? t('letsGo') : t('gotIt')));
    },

    mcq(step, c) {
      c.append(el('h2', {}, step.question));
      if (step.image) c.append(image(step.image));
      const order = step.shuffle === false ? step.options.map((_, i) => i) : shuffle(step.options.map((_, i) => i));
      const fb = el('div');
      let timeLeft = step.timed || 0, answered = false;
      const timerBar = step.timed ? el('div', { class: 'timer', title: t('speedTitle') }, el('span', { style: 'width:100%' })) : null;
      const btns = order.map((oi) => el('button', { class: 'opt', onclick: () => choose(oi) }, step.options[oi]));
      const byOrig = []; order.forEach((oi, pos) => { byOrig[oi] = btns[pos]; });
      function choose(oi) {
        if (answered) return; answered = true;
        if (run.timer) { clearInterval(run.timer); run.timer = null; }
        btns.forEach((b) => (b.disabled = true));
        byOrig[step.answer].classList.add('right');
        if (oi !== step.answer) byOrig[oi].classList.add('wrong');
        const fast = step.timed && timeLeft > 0 && oi === step.answer;
        grade(fb, step, oi === step.answer ? 1 : 0, fast ? t('speedBonus', { xp: XP.speedBonus }) : (step.timed && timeLeft <= 0 ? t('timeUp') : null), fast ? XP.speedBonus : 0);
      }
      if (timerBar) c.append(timerBar);
      c.append(el('div', { class: 'opts' }, btns), ...lifelines(step, byOrig, step.answer), fb);
      if (step.timed) {
        const span = timerBar.firstChild;
        run.timer = setInterval(() => {
          timeLeft--; span.style.width = Math.max(0, (timeLeft / step.timed) * 100) + '%';
          if (timeLeft <= step.timed / 3) span.style.background = 'var(--bad)';
          if (timeLeft <= 0) { clearInterval(run.timer); run.timer = null; }
        }, 1000);
      }
    },

    multi(step, c) {
      c.append(el('h2', {}, step.question));
      if (step.image) c.append(image(step.image));
      const sel = new Set(); const fb = el('div');
      const btns = step.options.map((o, i) => el('button', { class: 'opt opt-check', role: 'checkbox', 'aria-checked': 'false', onclick: (e) => {
        const b = e.currentTarget; sel.has(i) ? sel.delete(i) : sel.add(i);
        const on = sel.has(i);
        b.classList.toggle('sel', on); b.setAttribute('aria-checked', String(on));
        b.querySelector('.box').textContent = on ? '✓' : '';
        beep('click');
        check.disabled = sel.size === 0;
      } }, el('span', { class: 'box', 'aria-hidden': 'true' }), el('span', { class: 'lbl-txt' }, o)));
      const check = el('button', { class: 'btn', disabled: true, onclick: () => {
        check.disabled = true; btns.forEach((b) => (b.disabled = true));
        const ans = new Set(step.answers); let ok = 0;
        btns.forEach((b, i) => {
          const should = ans.has(i), did = sel.has(i);
          if (should === did) ok++;
          b.classList.remove('sel');
          b.querySelector('.box').textContent = did ? '✓' : '';
          if (should) b.classList.add('right'); else if (did) b.classList.add('wrong');
          if (should !== did) b.append(el('span', { class: 'opt-note' }, should ? t('shouldSel') : t('shouldNot')));
        });
        grade(fb, step, ok / btns.length, ok === btns.length ? null : t('multiScore', { ok, total: btns.length }));
      } }, t('check'));
      c.append(el('div', { class: 'muted small' }, t('selectAll')), el('div', { class: 'opts' }, btns), ...lifelines(step), el('div', { class: 'row actions' }, el('div', { class: 'spacer' }), check), fb);
    },

    sort(step, c) {
      c.append(el('h2', {}, step.question));
      const items = shuffle(step.items.map((it, i) => ({ ...it, i })));
      const choice = {}; const fb = el('div');
      const rows = items.map((it) => {
        const chips = step.buckets.map((bk, bi) => el('button', { class: 'chip', 'aria-pressed': 'false', onclick: () => {
          choice[it.i] = bi;
          chips.forEach((ch, k) => { ch.classList.toggle('sel', k === bi); ch.setAttribute('aria-pressed', String(k === bi)); });
          check.disabled = Object.keys(choice).length < items.length;
        } }, bk));
        const row = el('div', { class: 'sort-item' }, el('div', { class: 'txt' }, it.text), el('div', { class: 'chips' }, chips));
        row._chips = chips; row._it = it;
        return row;
      });
      const check = el('button', { class: 'btn', disabled: true, onclick: () => {
        check.disabled = true; let ok = 0;
        rows.forEach((r) => {
          const good = choice[r._it.i] === r._it.bucket; if (good) ok++;
          r.classList.add(good ? 'right' : 'wrong');
          r._chips.forEach((ch, k) => { ch.disabled = true; if (!good && k === r._it.bucket) ch.classList.add('correct-hint'); });
          if (!good) r.append(el('div', { class: 'small', style: 'margin-top:6px;color:var(--ok)' }, t('sortCorrect', { bucket: step.buckets[r._it.bucket] })));
        });
        grade(fb, step, ok / rows.length, ok === rows.length ? null : t('sortScore', { ok, total: rows.length }));
      } }, t('check'));
      c.append(el('div', { class: 'muted small' }, t('sortHelp')), el('div', { class: 'stack' }, rows), el('div', { class: 'row actions' }, el('div', { class: 'spacer' }), check), fb);
    },

    order(step, c) {
      c.append(el('h2', {}, step.question));
      let cur = shuffle(step.items.map((t, i) => i));
      if (cur.every((v, i) => v === i) && cur.length > 1) cur = cur.slice().reverse();
      const list = el('div', { class: 'stack' }); const fb = el('div'); let locked = false;
      const paint = () => {
        clear(list);
        cur.forEach((oi, pos) => {
          const right = locked && oi === pos;
          list.append(el('div', { class: 'order-item' + (locked ? (right ? ' right' : ' wrong') : '') },
            el('span', { class: 'pos' }, pos + 1),
            el('span', { class: 'txt' }, step.items[oi], locked && !right ? el('div', { class: 'small', style: 'color:var(--ok)' }, t('orderPos', { n: oi + 1 })) : null),
            locked ? null : el('button', { 'aria-label': t('moveUp'), disabled: pos === 0, onclick: () => { [cur[pos - 1], cur[pos]] = [cur[pos], cur[pos - 1]]; beep('click'); paint(); } }, '▲'),
            locked ? null : el('button', { 'aria-label': t('moveDown'), disabled: pos === cur.length - 1, onclick: () => { [cur[pos + 1], cur[pos]] = [cur[pos], cur[pos + 1]]; beep('click'); paint(); } }, '▼')));
        });
      };
      paint();
      const check = el('button', { class: 'btn', onclick: () => {
        locked = true; check.disabled = true; paint();
        const ok = cur.filter((oi, pos) => oi === pos).length;
        grade(fb, step, ok / cur.length, ok === cur.length ? null : t('orderScore', { ok, total: cur.length }));
      } }, t('checkOrder'));
      c.append(el('div', { class: 'muted small' }, t('orderHelp')), list, el('div', { class: 'row actions' }, el('div', { class: 'spacer' }), check), fb);
    },

    swipe(step, c) {
      c.append(el('h2', {}, step.question));
      const cards = shuffle(step.cards); let i = 0, ok = 0; const fb = el('div');
      const wrap = el('div', { class: 'swipe-wrap' }); const count = el('div', { class: 'swipe-count' });
      const why = el('div');
      const leftBtn = el('button', { class: 'btn secondary', onclick: () => answer('left') }, step.left);
      const rightBtn = el('button', { class: 'btn secondary', onclick: () => answer('right') }, step.right);
      let cardEl;
      const show = () => {
        clear(wrap); clear(why);
        if (i >= cards.length) {
          document.removeEventListener('keydown', onKey);
          leftBtn.disabled = rightBtn.disabled = true;
          wrap.append(el('div', { class: 'swipe-card' }, t('swipeDone', { ok, total: cards.length })));
          count.textContent = '';
          return grade(fb, step, ok / cards.length);
        }
        count.textContent = t('swipeCount', { n: i + 1, total: cards.length });
        cardEl = el('div', { class: 'swipe-card', tabindex: '0' }, cards[i].text);
        let sx = null;
        cardEl.addEventListener('pointerdown', (e) => { sx = e.clientX; });
        cardEl.addEventListener('pointerup', (e) => { if (sx == null) return; const dx = e.clientX - sx; sx = null; if (Math.abs(dx) > 60) answer(dx < 0 ? 'left' : 'right'); });
        wrap.append(cardEl);
        leftBtn.disabled = rightBtn.disabled = false;
      };
      const answer = (side) => {
        if (i >= cards.length || leftBtn.disabled) return;
        leftBtn.disabled = rightBtn.disabled = true;
        const card = cards[i]; const good = card.answer === side; if (good) ok++;
        beep(good ? 'good' : 'bad');
        cardEl.classList.add(side === 'left' ? 'go-left' : 'go-right');
        why.append(el('div', { class: 'feedback ' + (good ? 'good' : 'bad') }, el('b', {}, good ? '✅ ' : '❌ '), card.why || ''));
        setTimeout(() => { if (!document.body.contains(wrap)) return; i++; show(); }, good ? 1300 : 2400);
      };
      const onKey = (e) => {
        if (!document.body.contains(wrap)) { document.removeEventListener('keydown', onKey); return; }
        if (e.key === 'ArrowLeft') answer('left'); if (e.key === 'ArrowRight') answer('right');
      };
      document.addEventListener('keydown', onKey);
      c.append(count, wrap, el('div', { class: 'swipe-btns' }, leftBtn, rightBtn), why, fb);
      show();
    },

    hotspot(step, c) {
      c.append(el('h2', {}, step.question));
      const shot = image(step.image, { clickable: true, alt: t('hotspotAlt') });
      const fb = el('div'); let tries = 0, done = false; const tg = step.target; const tol = 2;
      const tryMsg = el('div', { class: 'muted small' }, t('hotspotHelp'));
      shot.addEventListener('click', (e) => {
        if (done) return;
        const r = shot.getBoundingClientRect();
        const x = ((e.clientX - r.left) / r.width) * 100, y = ((e.clientY - r.top) / r.height) * 100;
        const hit = x >= tg.x - tol && x <= tg.x + tg.w + tol && y >= tg.y - tol && y <= tg.y + tg.h + tol;
        shot.append(el('span', { class: 'marker ' + (hit ? 'ok' : 'no'), style: `left:${x}%;top:${y}%` }));
        tries++;
        if (hit || tries >= 2) {
          done = true;
          shot.append(el('span', { class: 'target-box', style: `left:${tg.x}%;top:${tg.y}%;width:${tg.w}%;height:${tg.h}%` }));
          grade(fb, step, hit ? (tries === 1 ? 1 : 0.5) : 0, hit ? null : t('hotspotShow'));
        } else { beep('bad'); tryMsg.textContent = t('hotspotRetry'); }
      });
      c.append(tryMsg, shot, ...lifelines(step), fb);
    },

    prompt(step, c) {
      // Keyword detection: English + German in `re`, Spanish + Chinese in EXTRA (mixed text works too)
      const EXTRA = [
        /(\b(ayud|respond|contest|crea|resum|redact|enumer|explic|gu[ií]a|comprueb|revis|recomiend|busc|ped)|帮助|帮|回答|解答|创建|总结|起草|列出|解释|指导|检查|推荐|支持|查找|订购)/i,
        /(\b(para|nuestr|emplead|client|equipo|baristas?|gerente|encargad|nuev[oa]s?|usuari|compa[ñn]er|porque)|为|员工|客户|团队|咖啡师|经理|新员工|用户|同事|因为)/i,
        /(\b(conocimiento|documento|archivo|pol[ií]tica|manual|cat[aá]logo|sitio web|solo (con|a partir|de)|basad|lista de precios|fuente)|知识|文档|文件|政策|手册|目录|网站|只根据|仅根据|根据|基于|价目表|价格表|来源)/i,
        /(\b(vi[ñn]eta|tabla|breve|corto|tono|amable|formal|pasos|formato|conciso|m[aá]ximo|\d+\s*(palabras|frases|puntos|l[ií]neas))|要点|表格|简短|简洁|语气|友好|正式|步骤|格式|最多|\d+\s*(个|条|句|行|字))/i,
        /(\b(nunca|jam[aá]s|si (no|el|la|algo|un)\b.*\bno\b|escal|deriv|remit|aprob|confirm|pregunt|insegur)|不要|切勿|绝不|从不|如果.*(没有|不)|升级|转给|转交|批准|审批|确认|询问|不确定)/i
      ];
      const rules = [
        { k: t('pGoal'), d: t('pGoalD'), tip: t('pGoalT'), re: /(\b(help|helps|answer|answers|create|summari[sz]e|draft|list|explain|guide|write|check|recommend|support|find|order)\b|\b(hilf|hilfst|hilft|helfen|beantworte|beantwortest|erstelle|erstellst|fasse|entwirf|liste|erkläre|erklärst|unterstütze|unterstützt|finde|bestelle|prüfe))/i },
        { k: t('pCtx'), d: t('pCtxD'), tip: t('pCtxT'), re: /(\b(for|our|employees?|staff|customers?|new hires?|team|baristas?|managers?|users?|colleagues?|because)\b|(\bfür\b|\bunsere?n?\b|mitarbeit|kund|\bteam|barista|filialleit|neue[nr]? |kolleg|\bweil\b|nutzer))/i },
        { k: t('pSrc'), d: t('pSrcD'), tip: t('pSrcT'), re: /(\b(sharepoint|knowledge|documents?|files?|policy|handbook|catalog(ue)?|website|only from|based on|price list|excel|sources?)\b|(wissen|dokument|datei|richtlinie|handbuch|katalog|webseite|nur auf basis|nur aus|basierend|preisliste|quelle))/i },
        { k: t('pExp'), d: t('pExpD'), tip: t('pExpT'), re: /(\b(bullets?|table|short|brief|tone|friendly|formal|steps?|format|concise|max(imum)?\.?|\d+\s*(words|sentences|bullets|points|lines))\b|(stichpunkt|aufzählung|tabelle|\bkurz|\bton\b|freundlich|förmlich|schritt|prägnant|höchstens|\d+\s*(wörter|sätze|punkte|zeilen)))/i },
        { k: t('pGrd'), d: t('pGrdD'), tip: t('pGrdT'), re: /(don't|do not|never|if (it|you|the|an|a)\b.*\b(not|don't|isn't|unsure)|escalate|refer|approv|confirm|ask the|unsure|\bnie\b|niemals|\bkeine?n?\b|\bnicht\b|wenn .*nicht|eskalier|verweis|weiterleit|genehmig|bestätig|frag|unsicher)/i }
      ];
      c.append(el('h2', {}, step.title || t('promptChallenge')), el('p', {}, el('b', {}, '🎯 '), step.scenario));
      const ta = el('textarea', { class: 'input', rows: '6', placeholder: t('promptPlaceholder'), 'aria-label': t('yourInstructions') });
      const meter = el('div', { class: 'meter' }); const bar = el('div', { class: 'scorebar' }, el('span', { style: 'width:0%' }));
      const tips = el('ul', { class: 'tips' }); const scoreTxt = el('div', { style: 'font-weight:700' });
      const fb = el('div');
      const els = rules.map((r) => el('div', { class: 'el' }, el('b', {}, '○ ' + r.k), r.d));
      meter.append(...els);
      const vague = /(\b(stuff|things|something|etc\.?|whatever|amazing|awesome|zeug|sachen|irgendwas|irgendwie|usw\.?|toll|super|cosas|algo|lo que sea|genial)\b|东西|之类|什么的|随便|等等)/gi;
      function score() {
        const txt = ta.value;
        // Chinese has no spaces: count ~2 CJK characters as one word
        const cjk = (txt.match(/[\u3400-\u9fff\uf900-\ufaff]/g) || []).length;
        const words = txt.replace(/[\u3400-\u9fff\uf900-\ufaff]/g, ' ').trim().split(/\s+/).filter(Boolean).length + Math.round(cjk / 2);
        let s = 0; clear(tips);
        rules.forEach((r, i) => {
          const on = r.re.test(txt) || EXTRA[i].test(txt); els[i].classList.toggle('on', on); els[i].firstChild.textContent = (on ? '✔ ' : '○ ') + r.k;
          if (on) s++; else if (words > 3) tips.append(el('li', {}, r.tip));
        });
        const v = (txt.match(vague) || []).length;
        if (v) tips.append(el('li', {}, t('vague', { words: [...new Set(txt.match(vague).map((x) => x.toLowerCase()))].join(', ') })));
        if (words > 0 && words < 20) tips.append(el('li', {}, t('tooShort')));
        const final = Math.max(0, s - Math.min(1, v) + (words >= 25 && words <= 200 ? 1 : 0));
        bar.firstChild.style.width = Math.min(100, (final / 6) * 100) + '%';
        scoreTxt.textContent = t('promptScore', { s: final });
        submit.disabled = words < 8;
        return final;
      }
      const submit = el('button', { class: 'btn', disabled: true, onclick: () => {
        submit.disabled = true; ta.readOnly = true;
        const s = score(); me().lastPrompt = ta.value; save();
        const frac = Math.min(1, s / (step.minScore + 1));
        grade(fb, step, frac, (s >= step.minScore ? t('promptStrong', { s }) : t('promptWeak', { s })) + '\n\n' + t('promptExample') + '\n\n*' + step.example + '*');
      } }, t('submitPrompt'));
      ta.addEventListener('input', score);
      c.append(ta, scoreTxt, bar, meter, tips, el('div', { class: 'row actions' }, el('span', { class: 'muted small' }, t('meterNote')), el('div', { class: 'spacer' }), submit), fb);
      score();
    },

    breakbot(step, c) {
      const a = step.agent;
      c.append(el('h2', {}, t('testBot', { avatar: a.avatar || '🤖', name: a.name })),
        el('p', { class: 'muted' }, t('botHelp')));
      const chat = el('div', { class: 'chat', 'aria-live': 'polite' }, el('div', { class: 'bubble sys' }, `${a.name}: ${a.description}`));
      const qs = el('div'); const fb = el('div'); let judged = 0, ok = 0, busy = false;
      const info = el('div', { class: 'bot-info' }, el('b', {}, t('botKnows')), el('ul', { style: 'margin:6px 0 0;padding-left:18px' }, a.knowledge.map((k) => el('li', {}, k))));
      step.tests.forEach((tc) => {
        const b = el('button', { class: 'test-q', onclick: () => {
          if (busy) return; busy = true; b.disabled = true;
          qs.querySelectorAll('.test-q').forEach((x) => (x.disabled = true));
          chat.append(el('div', { class: 'bubble user' }, tc.q));
          const typing = el('div', { class: 'typing' }, t('typing', { name: a.name })); chat.append(typing);
          setTimeout(() => {
            if (!document.body.contains(chat)) return;
            typing.remove(); chat.append(el('div', { class: 'bubble bot' }, tc.a));
            const judge = el('div', { class: 'row' },
              el('button', { class: 'btn secondary', onclick: () => decide(false) }, t('goodAnswer')),
              el('button', { class: 'btn secondary', onclick: () => decide(true) }, t('bug')));
            chat.append(judge); judge.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            function decide(saysBug) {
              judge.remove(); const right = saysBug === tc.fails; judged++; if (right) ok++;
              beep(right ? 'good' : 'bad');
              b.classList.add(right ? 'done-ok' : 'done-bad'); b.textContent = (tc.fails ? '🐞 ' : '✅ ') + tc.q;
              chat.append(el('div', { class: 'bubble sys' }, (right ? t('youRight') : t('notQuite')) + (tc.fails ? t('isBug') : t('isFine')) + tc.why));
              busy = false;
              qs.querySelectorAll('.test-q').forEach((x) => { if (!x.classList.contains('done-ok') && !x.classList.contains('done-bad')) x.disabled = false; });
              if (judged === step.tests.length) grade(fb, step, ok / judged, t('botScore', { ok, total: judged, bugs: step.tests.filter((x) => x.fails).length }));
            }
          }, 900);
        } }, '💬 ' + tc.q);
        qs.append(b);
      });
      c.append(el('div', { class: 'bot-layout' }, el('div', {}, info, el('div', { class: 'lbl', style: 'margin-top:12px' }, t('testQuestions')), qs), chat), fb);
    },

    mission(step, c) {
      const p = me(); const already = p.missions.includes(run.id + ':' + run.idx);
      c.append(el('h2', {}, '🛠️ ' + (step.title || t('mission'))), rich(step.text));
      const inp = el('input', { class: 'input', placeholder: t('codeWord'), autocomplete: 'off', 'aria-label': t('codeWord') });
      const res = el('div');
      const submit = () => {
        if (inp.value.trim().toUpperCase() === String(step.codeWord).toUpperCase()) {
          inp.disabled = true; btn.disabled = true;
          if (!already && !run.replay) { p.missions.push(run.id + ':' + run.idx); save(); addXp(step.bonusXp || 20); }
          beep('combo'); confetti(60);
          res.append(el('div', { class: 'feedback good' }, el('div', { class: 'fb-title' }, t('missionDone', { xp: already || run.replay ? '' : '+' + (step.bonusXp || 20) + ' XP' }))));
          skip.textContent = t('next');
        } else { inp.classList.add('shake'); beep('bad'); setTimeout(() => inp.classList.remove('shake'), 400); }
      };
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
      const btn = el('button', { class: 'btn', onclick: submit }, t('submit'));
      const skip = el('button', { class: 'btn ghost', onclick: () => { run.idx++; persistRun(); renderStep(); } }, already ? t('next') : t('skip'));
      if (already) res.append(el('div', { class: 'feedback good' }, t('missionAlready')));
      c.append(el('div', { class: 'codebox' }, inp, btn), res, el('div', { class: 'row actions' }, el('span', { class: 'muted small' }, t('missionNote')), el('div', { class: 'spacer' }), skip));
    },

    idea(step, c) {
      const p = me(); const vals = { ...(p.idea || {}) };
      c.append(el('h2', {}, '💡 ' + (step.title || t('yourIdea'))), el('p', {}, step.question));
      const inputs = step.fields.map((f) => {
        const i = el('input', { class: 'input', id: 'f_' + f.key, placeholder: f.placeholder || '', value: vals[f.key] || '', maxlength: '120' });
        i.addEventListener('input', () => { vals[f.key] = i.value; });
        return el('div', {}, el('label', { class: 'lbl', for: 'f_' + f.key }, f.label), i);
      });
      const out = el('div');
      const btn = el('button', { class: 'btn', onclick: () => {
        if (!step.fields.every((f) => (vals[f.key] || '').trim())) { toast(t('fillAll')); return; }
        const first = !p.idea; p.idea = vals; save(); btn.disabled = true; liveSync();
        clear(out);
        out.append(ideaCard(p), nextBtn());
        if (first && !run.replay) addXp(XP.idea, t('ideaCreated', { xp: XP.idea }));
        beep('good');
      } }, t('createIdea'));
      c.append(...inputs, el('div', { class: 'row actions' }, el('div', { class: 'spacer' }), btn), out);
    },

    feedback(step, c) {
      const p = me(); let stars = p.feedback?.stars || 0;
      c.append(el('h2', {}, '⭐ ' + step.question));
      const pickBox = el('div', { class: 'starpick', role: 'radiogroup', 'aria-label': t('rating') });
      const paint = () => { clear(pickBox); for (let i = 1; i <= 5; i++) pickBox.append(el('button', { class: i <= stars ? 'on' : '', 'aria-label': t('nStars', { n: i }), onclick: () => { stars = i; paint(); } }, '★')); };
      paint();
      const ta = el('textarea', { class: 'input', rows: '3', placeholder: t('ahaPlaceholder') }, p.feedback?.text || '');
      const btn = el('button', { class: 'btn', onclick: () => {
        if (!stars) { toast(t('pickStars')); return; }
        const first = !p.feedback; p.feedback = { stars, text: ta.value.trim() }; save(); liveSync(true);
        if (first && !run.replay) addXp(XP.feedback, t('thanks', { xp: XP.feedback }));
        run.idx++; persistRun(); renderStep();
      } }, t('finish'));
      c.append(pickBox, ta);
      if (config.feedbackFormUrl) c.append(el('p', { class: 'small' }, t('feedbackLinkPre'), el('a', { href: config.feedbackFormUrl, target: '_blank', rel: 'noopener' }, t('feedbackLink'))));
      c.append(el('p', { class: 'muted small' }, t('feedbackLocal')), el('div', { class: 'row actions' }, el('div', { class: 'spacer' }), btn));
    }
  };

  function ideaCard(p) {
    const i = p.idea || {};
    return el('div', { class: 'idea-card' }, el('h3', {}, '🤖 ' + (i.name || t('myAgent'))),
      el('dl', {}, el('dt', {}, t('iFor')), el('dd', {}, i.audience || ''), el('dt', {}, t('iSolves')), el('dd', {}, i.problem || ''),
        el('dt', {}, t('iSource')), el('dd', {}, i.source || ''), el('dt', {}, t('iAction')), el('dd', {}, i.action || '')));
  }

  // ---------- Level complete ----------
  function finishLevel() {
    const p = me(); const { L } = run;
    const pct = run.max ? run.score / run.max : 1;
    const stars = pct >= 0.9 ? 3 : pct >= 0.65 ? 2 : 1;
    const firstTime = !p.done[run.id];
    if (firstTime) {
      p.done[run.id] = { stars, pct: Math.round(pct * 100), at: new Date().toISOString() };
      if (!p.badges.includes(run.id)) p.badges.push(run.id);
      if (!p.cards.includes(run.id)) p.cards.push(run.id);
      delete p.progress[run.id];
      save();
      addXp(stars * 5, null);
      liveSync();
    } else if (stars > p.done[run.id].stars) { p.done[run.id].stars = stars; save(); }
    const idx = config.levels.findIndex((l) => l.id === run.id);
    const next = config.levels[idx + 1];
    beep('level'); confetti(stars === 3 ? 200 : 120);
    clear(app);
    app.append(el('div', { class: 'card complete stack', style: 'margin-top:14px' },
      el('div', { class: 'muted' }, t('levelComplete')),
      el('div', { class: 'big-badge', 'aria-hidden': 'true' }, L.badge?.icon || '🏅'),
      el('h1', {}, L.badge?.name || L.title),
      el('p', { class: 'muted' }, L.badge?.description || ''),
      el('div', { class: 'stars-big', 'aria-label': t('starsOf', { n: stars }) }, '★'.repeat(stars) + '☆'.repeat(3 - stars)),
      el('div', {}, t('score', { pct: Math.round(pct * 100) }) + (firstTime ? t('starBonus', { xp: stars * 5 }) : '')),
      L.card ? el('div', {}, el('div', { class: 'lbl' }, t('newCard')), cheatCard(L)) : null,
      el('div', { class: 'row', style: 'justify-content:center' },
        el('button', { class: 'btn secondary', onclick: () => go('map') }, t('map')),
        next ? el('button', { class: 'btn', onclick: () => go('level', next.id) }, t('nextLevel')) : el('button', { class: 'btn', onclick: () => go('certificate') }, t('getCert')))
    ));
    run = null;
  }
  function cheatCard(L) {
    return el('div', { class: 'cheat' }, el('h3', {}, L.icon + ' ' + L.card.title), el('ul', {}, L.card.lines.map((x) => el('li', {}, x))));
  }

  // ---------- Cards & badges ----------
  function renderCards() {
    const p = me();
    app.append(el('h2', {}, t('myBadges')),
      el('div', { class: 'badges' }, config.levels.map((lv) => {
        const L = lessons[lv.id]; const has = p.badges.includes(lv.id);
        return el('div', { class: 'badge' + (has ? '' : ' locked'), title: L.badge?.description || '' }, el('div', { class: 'i' }, L.badge?.icon || '🏅'), el('div', { class: 'n' }, has ? L.badge?.name : '???'));
      })),
      el('h2', { style: 'margin-top:24px' }, t('myCards')),
      p.cards.length ? el('div', { class: 'cards-grid' }, config.levels.filter((lv) => p.cards.includes(lv.id) && lessons[lv.id].card).map((lv) => cheatCard(lessons[lv.id])))
        : el('p', { class: 'muted' }, t('noCards')),
      p.idea ? el('div', { style: 'margin-top:24px' }, el('h2', {}, t('myIdea')), ideaCard(p)) : null,
      el('div', { class: 'row', style: 'margin-top:20px' }, el('button', { class: 'btn', onclick: () => go('map') }, t('backToMap')),
        el('button', { class: 'btn secondary', onclick: () => window.print() }, t('print'))));
  }

  // ---------- Certificate ----------
  function renderCertificate() {
    const p = me(); const r = rankOf(p.xp);
    const doneCount = config.levels.filter((l) => p.done[l.id]).length;
    const totalStars = Object.values(p.done).reduce((s, d) => s + d.stars, 0);
    confetti(160); beep('level');
    app.append(el('div', { class: 'certificate stack', style: 'margin-top:14px' },
      el('div', { class: 'muted', style: 'letter-spacing:.2em;text-transform:uppercase;font-size:13px' }, t('certTitle')),
      el('div', { style: 'font-size:56px' }, p.avatar),
      el('div', { class: 'cname' }, p.name),
      el('div', {}, t('completed'), el('b', {}, loc(config.title))),
      el('div', { style: 'font-size:20px;font-weight:700' }, '🏆 ' + r.title),
      el('div', { class: 'muted' }, t('certStats', { xp: p.xp, stars: totalStars, done: doneCount, total: config.levels.length, streak: p.bestStreak || 0 })),
      el('div', { class: 'badges' }, config.levels.filter((lv) => p.badges.includes(lv.id)).map((lv) => el('div', { class: 'badge' }, el('div', { class: 'i' }, lessons[lv.id].badge?.icon), el('div', { class: 'n' }, lessons[lv.id].badge?.name)))),
      el('div', { class: 'muted small' }, new Date().toLocaleDateString(lang, { year: 'numeric', month: 'long', day: 'numeric' })),
      el('div', { class: 'disclaimer' }, loc(config.disclaimer) || '')),
      topicStats(p).length ? el('div', { class: 'card', style: 'margin-top:16px' }, el('h3', {}, t('byTopic')), topicBars(p), el('div', { class: 'row no-print', style: 'margin-top:10px' }, el('div', { class: 'spacer' }), el('button', { class: 'btn secondary', onclick: () => go('report') }, t('fullReport')))) : null,
      p.idea ? el('div', { style: 'margin-top:16px' }, ideaCard(p)) : null,
      el('div', { class: 'row no-print', style: 'margin-top:16px;justify-content:center' },
        el('button', { class: 'btn', onclick: () => window.print() }, t('print')),
        el('button', { class: 'btn secondary', onclick: () => go('cards') }, t('myCards')),
        el('button', { class: 'btn secondary', onclick: () => go('map') }, t('map'))),
      el('p', { class: 'muted small no-print', style: 'text-align:center' }, t('shareTip')));
  }

  // ---------- Learning results (first attempt per question) ----------
  function recordResult(levelId, idx, step, f) {
    const p = me(); if (!p || run.replay) return;
    p.results = p.results || {};
    const k = levelId + ':' + idx;
    if (k in p.results) return;
    p.results[k] = { f: Math.round(f * 100) / 100, t: step.topic || levelId };
    save(); liveSync();
  }
  function topicStats(p) {
    const sums = {};
    for (const r of Object.values(p.results || {})) { const x = (sums[r.t] = sums[r.t] || { s: 0, m: 0 }); x.s += r.f; x.m += 1; }
    return config.levels.filter((lv) => sums[lv.id]).map((lv) => {
      const x = sums[lv.id]; const pct = Math.round((x.s / x.m) * 100);
      return { id: lv.id, L: lessons[lv.id], s: x.s, m: x.m, pct, band: pct >= 80 ? 'strong' : pct >= 50 ? 'review' : 'focus' };
    });
  }
  const bandLabel = (b) => t(b === 'strong' ? 'lvlStrong' : b === 'review' ? 'lvlReview' : 'lvlFocus');
  function topicBars(p) {
    return el('div', { class: 'topic-bars' }, topicStats(p).map((x) => el('div', { class: 'topic-row ' + x.band },
      el('div', { class: 'tname' }, el('span', { 'aria-hidden': 'true' }, x.L.icon + ' '), x.L.title),
      el('div', { class: 'tbar', role: 'img', 'aria-label': x.pct + '%' }, el('span', { style: `width:${Math.max(4, x.pct)}%` })),
      el('div', { class: 'tpct' }, x.pct + '%'),
      el('span', { class: 'band ' + x.band }, bandLabel(x.band)))));
  }
  function missedFor(p, topicId) {
    return Object.entries(p.results || {}).filter(([, r]) => r.t === topicId && r.f < 1).map(([k]) => {
      const [lid, i] = k.split(':'); const st = lessons[lid] && lessons[lid].steps[Number(i)];
      const q = st ? (st.question || st.title || st.scenario || '') : '';
      return q.length > 120 ? q.slice(0, 117) + '…' : q;
    }).filter(Boolean);
  }
  function renderReport() {
    const p = me(); const stats = topicStats(p);
    app.append(el('div', { class: 'row', style: 'margin:10px 0 6px' }, el('h2', { style: 'margin:0' }, t('reportTitle')), el('div', { class: 'spacer' }),
      el('button', { class: 'btn ghost no-print', onclick: () => go('map') }, t('backToMap'))));
    if (!stats.length) { app.append(el('div', { class: 'card' }, t('noResults'))); return; }
    const all = stats.reduce((a, x) => ({ s: a.s + x.s, m: a.m + x.m }), { s: 0, m: 0 });
    const overall = Math.round((all.s / all.m) * 100);
    const weak = stats.filter((x) => x.band !== 'strong').sort((a, b) => a.pct - b.pct);
    const strong = stats.filter((x) => x.band === 'strong');
    app.append(
      el('p', { class: 'muted' }, t('reportIntro')),
      el('div', { class: 'card report-head' },
        el('div', { class: 'overall ' + (overall >= 80 ? 'strong' : overall >= 50 ? 'review' : 'focus') }, el('div', { class: 'big' }, overall + '%'), el('div', {}, t('overall'))),
        el('div', { style: 'flex:1;min-width:260px' }, el('h3', {}, t('byTopic')), topicBars(p))),
      strong.length ? el('div', { class: 'card', style: 'margin-top:14px' }, el('h3', {}, t('strengths')),
        el('div', { class: 'chips' }, strong.map((x) => el('span', { class: 'chip strong-chip' }, x.L.icon + ' ' + x.L.title + ' · ' + x.pct + '%')))) : null,
      el('h2', { style: 'margin-top:22px' }, t('focusNext')),
      weak.length ? el('div', { class: 'focus-grid' }, weak.map((x) => {
        const f = x.L.focus || {}; const missed = missedFor(p, x.id);
        return el('div', { class: 'card focus-card ' + x.band },
          el('div', { class: 'row' }, el('h3', { style: 'margin:0' }, x.L.icon + ' ' + x.L.title), el('div', { class: 'spacer' }), el('span', { class: 'band ' + x.band }, x.pct + '% · ' + bandLabel(x.band))),
          f.tips ? el('ul', { class: 'focus-tips' }, f.tips.map((tip) => el('li', {}, tip))) : null,
          missed.length ? el('div', {}, el('div', { class: 'lbl' }, t('missedQs')), el('ul', { class: 'missed' }, missed.map((q) => el('li', {}, q)))) : null,
          f.links && f.links.length ? el('div', {}, el('div', { class: 'lbl' }, t('learnMore')), el('ul', { class: 'links' }, f.links.map((lk) => el('li', {}, el('a', { href: lk.url, target: '_blank', rel: 'noopener' }, '📘 ' + lk.title))))) : null);
      })) : el('div', { class: 'card all-strong' }, t('allStrong')),
      el('div', { class: 'row no-print', style: 'margin-top:18px' }, el('button', { class: 'btn', onclick: () => window.print() }, t('print')), el('button', { class: 'btn secondary', onclick: () => go('map') }, t('backToMap'))));
  }

  // ---------- Live results (optional, only with ?live=CODE from the trainer) ----------
  function playerId() {
    const p = me();
    if (!p.pid) { const a = new Uint8Array(8); (window.crypto || {}).getRandomValues ? crypto.getRandomValues(a) : a.forEach((_, i) => (a[i] = Math.random() * 256)); p.pid = [...a].map((b) => b.toString(16).padStart(2, '0')).join(''); save(); }
    return p.pid;
  }
  function snapshot(p) {
    const topics = {}; for (const x of topicStats(p)) topics[x.id] = { s: Math.round(x.s * 100) / 100, m: x.m };
    const nextLv = config.levels.find((lv) => !p.done[lv.id]);
    return {
      xp: p.xp, rank: rankOf(p.xp).idx, done: config.levels.filter((l) => p.done[l.id]).length,
      level: nextLv ? nextLv.id : 'done', topics,
      missed: Object.entries(p.results || {}).filter(([, r]) => r.f < 1).map(([k]) => k).slice(0, 80),
      idea: p.idea || undefined, feedback: p.feedback || undefined
    };
  }
  async function ensureLive() {
    const p = me(); if (!p || config.liveResults === false) return;
    if (LIVE_PARAM && p.live !== LIVE_PARAM) { p.live = LIVE_PARAM; save(); live.player = null; }
    if (!p.live) { live.state = 'off'; live.player = store.current; return; }
    if (live.player === store.current && live.code === p.live) return;
    live.player = store.current; live.code = p.live; live.state = 'checking';
    try {
      const r = await fetch('api/live/status?code=' + encodeURIComponent(live.code), { cache: 'no-store' });
      if (!r.ok) throw new Error('status ' + r.status);
      const j = await r.json();
      live.state = !j.enabled ? 'paused' : (j.session && j.session.open ? 'on' : 'closed');
    } catch { live.state = 'unavailable'; }
    refreshLiveChip();
    if (live.state === 'on') liveSync(true);
  }
  function liveSync(now) {
    if (live.state !== 'on' && live.state !== 'retry') return;
    live.pending = true; clearTimeout(live.timer);
    live.timer = setTimeout(liveSend, now ? 100 : 2000);
  }
  async function liveSend() {
    const p = me(); if (!p || !live.pending || (live.state !== 'on' && live.state !== 'retry')) return;
    live.pending = false;
    const body = { code: live.code, pid: playerId(), name: p.name, avatar: p.avatar, lang, data: snapshot(p) };
    try {
      const r = await fetch('api/live/progress', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), keepalive: true });
      if (r.status === 429) { live.pending = true; live.timer = setTimeout(liveSend, 1800); return; }
      if (r.status === 403) { const j = await r.json().catch(() => ({})); live.state = j.error === 'paused' ? 'paused' : 'closed'; refreshLiveChip(); return; }
      if (!r.ok) throw new Error('progress ' + r.status);
      if (live.state !== 'on') { live.state = 'on'; refreshLiveChip(); }
    } catch {
      live.pending = true; live.state = 'retry'; refreshLiveChip();
      live.timer = setTimeout(liveSend, 15000);
    }
  }
  function liveChip() {
    const key = { on: 'liveOn', retry: 'liveRetry', paused: 'livePaused', closed: 'liveClosed', unavailable: 'liveUnavailable', checking: 'liveChecking' }[live.state];
    return el('div', { class: 'live-chip ' + live.state + (key ? '' : ' hidden'), id: 'livechip', role: 'status' }, key ? t(key) : '');
  }
  function refreshLiveChip() { const old = document.getElementById('livechip'); if (old) old.replaceWith(liveChip()); }

  // ---------- Content loading & language switching ----------
  async function loadLessons(code) {
    const loaded = {};
    await Promise.all(config.levels.map(async (lv) => {
      let r = null;
      if (code !== 'en') {
        // content/lessons/00-warmup.json -> content/lessons/de/00-warmup.json
        const parts = lv.file.split('/'); parts.splice(parts.length - 1, 0, code);
        r = await fetch('content/' + parts.join('/'), { cache: 'no-cache' }).catch(() => null);
      }
      if (!r || !r.ok) r = await fetch('content/' + lv.file, { cache: 'no-cache' });
      if (!r.ok) throw new Error('Could not load ' + lv.file);
      loaded[lv.id] = await r.json();
    }));
    Object.keys(lessons).forEach((k) => delete lessons[k]);
    Object.assign(lessons, loaded);
  }
  function applyLangChrome() {
    document.documentElement.lang = lang;
    document.title = loc(config.title);
  }
  async function setLang(code) {
    if (code === lang || !languages().some((L) => L.code === code)) return;
    lang = code; store.lang = code; save();
    await loadLessons(code);
    applyLangChrome();
    if (current.screen === 'level' && run) {
      if (run.timer) { clearInterval(run.timer); run.timer = null; }
      run.L = lessons[run.id]; clear(app); renderStep(); renderTopbar();
    } else go(current.screen, current.arg);
  }
  function pickInitialLang() {
    const codes = languages().map((L) => L.code);
    const want = [params.get('lang'), store.lang, ...(navigator.languages || [navigator.language || ''])].filter(Boolean).map((x) => x.toLowerCase().slice(0, 2));
    return want.find((c) => codes.includes(c)) || config.defaultLanguage || codes[0] || 'en';
  }

  // ---------- Boot ----------
  async function boot() {
    try {
      const cfgName = WS === 'workshop' ? 'workshop' : WS;
      let res = await fetch(`content/${cfgName}.json`, { cache: 'no-cache' });
      if (!res.ok) res = await fetch('content/workshop.json', { cache: 'no-cache' });
      config = await res.json();
      lang = pickInitialLang();
      if (params.get('lang')) { store.lang = lang; save(); }
      await loadLessons(lang);
      applyLangChrome();
      if (params.get('reset') === '1') { store = { players: {}, current: null, muted: store.muted, lang: store.lang }; save(); }
      go(me() ? 'map' : 'welcome');
    } catch (e) {
      clear(app);
      app.append(el('div', { class: 'card' }, el('h2', {}, t('loadFail')),
        el('p', {}, String(e.message || e)),
        el('p', { class: 'muted small' }, t('loadFailHint'))));
      console.error(e);
    }
  }
  boot();
})();
