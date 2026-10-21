/* Copilot Studio Quest – a static, gamified workshop app.
   No backend, no sign-in: progress lives in the participant's browser (localStorage). */
(() => {
  'use strict';

  // ---------- Setup ----------
  const params = new URLSearchParams(location.search);
  const WS = ((params.get('workshop') || 'workshop').toLowerCase().replace(/[^a-z0-9-]/g, '')) || 'workshop';
  const STORE_KEY = 'csq:' + WS;
  const AVATARS = ['🦊', '🐼', '🦉', '🐙', '🦄', '🐝', '🐧', '🦁', '🐸', '🤖', '🚀', '☕'];
  const RANKS = [
    [0, 'Rookie Barista'], [60, 'Agent Apprentice'], [160, 'Agent Builder'],
    [300, 'Agent Pro'], [450, 'Copilot Studio Hero']
  ];
  const XP = { base: 10, boss: 2, combo: 5, hintCost: 5, speedBonus: 5, idea: 10, feedback: 5 };

  const app = document.getElementById('app');
  const topbar = document.getElementById('topbar');
  let config = null;
  const lessons = {};
  let store = load();
  let run = null; // current level run

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
    let r = RANKS[0], next = null;
    for (let i = 0; i < RANKS.length; i++) { if (xp >= RANKS[i][0]) { r = RANKS[i]; next = RANKS[i + 1] || null; } }
    return { title: r[1], from: r[0], next };
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
    clear(lb); lb.append(el('img', { src, alt: 'Zoomed screenshot' }));
    lb.classList.remove('hidden');
    lb.onclick = () => lb.classList.add('hidden');
  }

  // ---------- XP ----------
  function addXp(n, reason) {
    const p = me(); if (!p || !n) return;
    const before = rankOf(p.xp).title;
    p.xp = Math.max(0, p.xp + n);
    save(); renderTopbar();
    const after = rankOf(p.xp).title;
    if (n > 0 && after !== before) { setTimeout(() => { toast('⬆️ Level up! You are now: ' + after); beep('level'); confetti(80); }, 600); }
    else if (reason) toast(reason);
  }

  // ---------- Top bar ----------
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
          el('div', { class: 'xpbar', title: r.next ? `${r.next[0] - p.xp} XP to ${r.next[1]}` : 'Max rank' }, el('span', { style: `width:${pct}%` })))),
      p.streak >= 2 ? el('span', { class: 'streak', title: 'Correct answers in a row' }, '🔥 ' + p.streak) : null,
      el('span', { class: 'xp-pill' }, p.xp + ' XP'),
      el('button', { class: 'iconbtn', title: 'Level map', 'aria-label': 'Level map', onclick: () => go('map') }, '🗺️'),
      el('button', { class: 'iconbtn', title: 'My cheat cards & badges', 'aria-label': 'My cheat cards and badges', onclick: () => go('cards') }, '🎴'),
      el('button', { class: 'iconbtn', title: store.muted ? 'Sound off' : 'Sound on', 'aria-label': 'Toggle sound', onclick: () => { store.muted = !store.muted; save(); renderTopbar(); } }, store.muted ? '🔇' : '🔊')
    ));
  }

  // ---------- Routing ----------
  function go(screen, arg) {
    if (run && run.timer) clearInterval(run.timer);
    if (screen !== 'level') run = null;
    window.scrollTo({ top: 0, behavior: 'smooth' });
    clear(app);
    if (!me() && screen !== 'welcome') screen = 'welcome';
    ({ welcome: renderWelcome, map: renderMap, level: startLevel, cards: renderCards, certificate: renderCertificate })[screen](arg);
    renderTopbar();
  }

  // ---------- Welcome ----------
  function renderWelcome() {
    let avatar = AVATARS[Math.floor(Math.random() * AVATARS.length)];
    const nameIn = el('input', { class: 'input', id: 'nick', maxlength: '24', placeholder: 'e.g. CaptainLatte', autocomplete: 'off' });
    const avatarsBox = el('div', { class: 'avatars', role: 'radiogroup', 'aria-label': 'Choose an avatar' });
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

    const existing = Object.keys(store.players);
    app.append(
      el('div', { class: 'hero' },
        el('div', { class: 'logo', 'aria-hidden': 'true' }, '🚀'),
        el('h1', {}, config.title),
        el('p', { class: 'muted' }, config.subtitle)),
      el('div', { class: 'card stack' },
        el('p', {}, config.story),
        el('div', {}, el('label', { class: 'lbl', for: 'nick' }, 'Your nickname'), nameIn),
        el('div', {}, el('div', { class: 'lbl' }, 'Pick your avatar'), avatarsBox),
        el('div', { class: 'row' }, el('button', { class: 'btn big', onclick: start }, 'Start the quest ▶'),
          el('span', { class: 'muted small' }, `${config.levels.length} levels · about ${config.durationMinutes} minutes`)),
        el('p', { class: 'muted small' }, '🔒 No sign-in. Your progress is saved only in this browser on this device. Please use a nickname, not your full name.'),
        existing.length ? el('div', {}, el('div', { class: 'lbl' }, 'Continue as'),
          el('div', { class: 'players' }, existing.map((n) => el('button', { class: 'player-chip', onclick: () => { store.current = n; save(); go('map'); } }, store.players[n].avatar + ' ' + n + ' · ' + store.players[n].xp + ' XP')))) : null
      ),
      el('p', { class: 'disclaimer' }, config.disclaimer || '')
    );
    setTimeout(() => nameIn.focus(), 50);
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
    const doneCount = config.levels.filter((l) => p.done[l.id]).length;
    const firstOpen = config.levels.findIndex((_, i) => levelStatus(i) === 'open');
    const codeIn = el('input', { class: 'input', placeholder: 'Trainer code', maxlength: '20', 'aria-label': 'Trainer code', autocomplete: 'off' });
    const useCode = () => {
      const code = codeIn.value.trim().toUpperCase(); if (!code) return;
      if (config.unlockAllCode && code === String(config.unlockAllCode).toUpperCase()) {
        p.unlocked = config.levels.map((l) => l.id); save(); toast('🔓 All levels unlocked'); beep('combo'); return go('map');
      }
      const idx = config.levels.findIndex((l) => String(l.code || '').toUpperCase() === code);
      if (idx < 0) { codeIn.classList.add('shake'); beep('bad'); setTimeout(() => codeIn.classList.remove('shake'), 400); return; }
      // a code unlocks that level and every level before it (for late joiners)
      for (let i = 0; i <= idx; i++) if (!p.unlocked.includes(config.levels[i].id)) p.unlocked.push(config.levels[i].id);
      save(); beep('combo'); toast('🔓 Unlocked: ' + (lessons[config.levels[idx].id]?.title || 'level ' + (idx + 1)));
      go('map');
    };
    codeIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') useCode(); });

    const tiles = config.levels.map((lv, i) => {
      const L = lessons[lv.id]; const st = levelStatus(i); const d = p.done[lv.id];
      const inProg = p.progress[lv.id] && !d;
      const cls = 'tile ' + (st === 'locked' ? 'locked' : st === 'done' ? 'done' : '') + (i === firstOpen ? ' current' : '');
      return el('button', { class: cls, disabled: st === 'locked', onclick: () => go('level', lv.id), 'aria-label': `Level ${i}: ${L.title} (${st})` },
        el('span', { class: 'num' }, i === 0 ? 'Start' : 'Level ' + i),
        el('span', { class: 'ic', 'aria-hidden': 'true' }, st === 'locked' ? '🔒' : L.icon),
        el('span', { class: 't' }, L.title),
        el('span', { class: 'muted small' }, L.subtitle || ''),
        el('span', { class: 'meta' }, d ? el('span', { class: 'stars' }, '★'.repeat(d.stars) + '☆'.repeat(3 - d.stars)) : inProg ? '▶ Continue' : `⏱ ${lv.minutes || 5} min · ${L.steps.length} steps`));
    });
    app.append(
      el('div', { class: 'row', style: 'margin:10px 0 16px' },
        el('div', {}, el('h2', { style: 'margin:0' }, '🗺️ Your quest map'), el('div', { class: 'muted' }, `${doneCount} of ${config.levels.length} levels done`)),
        el('div', { class: 'spacer' }),
        doneCount === config.levels.length ? el('button', { class: 'btn', onclick: () => go('certificate') }, '🏆 My certificate') : null),
      el('div', { class: 'map' }, tiles),
      el('div', { class: 'card', style: 'margin-top:18px' },
        el('div', { class: 'lbl' }, '🎟️ Joined late or ahead of the group? Enter the code your trainer shows.'),
        el('div', { class: 'codebox' }, codeIn, el('button', { class: 'btn', onclick: useCode }, 'Unlock'))),
      el('div', { class: 'row', style: 'margin-top:12px' },
        el('button', { class: 'btn ghost', onclick: () => { store.current = null; save(); go('welcome'); } }, '↩ Switch player'),
        el('div', { class: 'spacer' }),
        el('button', { class: 'btn ghost', onclick: () => { if (confirm('Reset all progress for ' + p.name + ' on this device?')) { store.players[p.name] = newPlayer(p.name, p.avatar); save(); go('map'); } } }, '♻ Reset my progress')),
      el('p', { class: 'disclaimer' }, config.disclaimer || '')
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
    if (replay) toast('🔁 Practice mode – no extra XP for replays');
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
          el('div', { class: 'muted small' }, (levelNo === 0 ? 'Start' : 'Level ' + levelNo) + ' · Step ' + (run.idx + 1) + ' of ' + total),
          el('div', { style: 'font-weight:700' }, L.title)),
        el('button', { class: 'btn ghost', onclick: () => go('map') }, '✕ Map')),
      el('div', { class: 'progress', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': String(total), 'aria-valuenow': String(run.idx) }, el('span', { style: `width:${(run.idx / total) * 100}%` }))
    );
    const body = el('div', { class: 'card stack', style: 'margin-top:14px' });
    app.append(body);
    if (step.boss) body.append(el('span', { class: 'boss-tag' }, '👾 BOSS CHALLENGE · double XP'));
    const renderer = RENDER[step.type];
    if (!renderer) { body.append(el('p', {}, 'Unknown step type: ' + step.type)); body.append(nextBtn()); return; }
    renderer(step, body);
  }

  function nextBtn(label = 'Next ▶') {
    const b = el('button', { class: 'btn', onclick: () => { run.idx++; persistRun(); renderStep(); } }, label);
    setTimeout(() => b.focus({ preventScroll: true }), 30);
    return el('div', { class: 'row' }, el('div', { class: 'spacer' }), b);
  }

  // Grade a step: fraction 0..1. Shows feedback, awards XP, handles streaks.
  function grade(container, step, fraction, extraText, bonus = 0) {
    const p = me();
    fraction = Math.max(0, Math.min(1, fraction));
    run.score += fraction; run.max += 1;
    let xp = Math.round((step.xp || XP.base) * fraction) * (step.boss ? XP.boss : 1) + bonus;
    let comboMsg = '';
    if (fraction === 1) {
      p.streak = (p.streak || 0) + 1; p.bestStreak = Math.max(p.bestStreak || 0, p.streak);
      if (p.streak % 3 === 0) { xp += XP.combo; comboMsg = ` 🔥 Combo x${p.streak}! +${XP.combo} bonus`; }
    } else p.streak = 0;
    if (run.replay) xp = 0;
    const cls = fraction === 1 ? 'good' : fraction >= 0.5 ? 'mid' : 'bad';
    const title = fraction === 1 ? pick(['Spot on! ✅', 'Nailed it! 🎯', 'Brilliant! ✨', 'Correct! ☕']) : fraction >= 0.5 ? 'Almost there! 🟡' : pick(['Not quite ❌', 'Good try – here’s why ❌']);
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
      wrap.append(el('button', { class: 'btn secondary', disabled: run.hintUsed, title: 'One hint per level', onclick: (e) => {
        run.hintUsed = true; persistRun(); e.target.disabled = true;
        if (!run.replay) addXp(-XP.hintCost, `💡 Hint used (−${XP.hintCost} XP)`);
        hintBox.textContent = '💡 ' + step.hint; hintBox.classList.remove('hidden');
      } }, `💡 Hint (−${XP.hintCost} XP)`));
    }
    if (optButtons && correctIdx != null && optButtons.length >= 4) {
      wrap.append(el('button', { class: 'btn secondary', disabled: run.fiftyUsed, title: 'One 50/50 per level', onclick: (e) => {
        run.fiftyUsed = true; persistRun(); e.target.disabled = true;
        shuffle(optButtons.map((_, i) => i).filter((i) => i !== correctIdx)).slice(0, 2).forEach((i) => { optButtons[i].classList.add('gone'); optButtons[i].disabled = true; });
      } }, '✂️ 50/50'));
    }
    return wrap.childNodes.length ? [wrap, hintBox] : [];
  }

  function image(src, opts = {}) {
    const box = el('div', { class: 'shot' + (opts.clickable ? ' clickable' : '') });
    const img = el('img', { src, alt: opts.alt || 'Copilot Studio screenshot', loading: 'lazy' });
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
          const txt = el('div', { class: 'callout-text' }, '👆 Tap the numbered dots to explore.');
          const seen = new Set();
          step.callouts.forEach((co, i) => {
            const b = el('button', { class: 'callout', style: `left:${co.x}%;top:${co.y}%`, 'aria-label': 'Callout ' + (i + 1), onclick: () => {
              seen.add(i); b.classList.add('seen'); txt.textContent = (i + 1) + '. ' + co.label; beep('click');
            } }, String(i + 1));
            shot.append(b);
          });
          c.append(txt, el('div', { class: 'zoom-hint' }, el('a', { href: step.image, target: '_blank', rel: 'noopener' }, '🔍 Open full-size image')));
        } else c.append(el('div', { class: 'zoom-hint' }, '🔍 Tap the image to zoom'));
      }
      c.append(nextBtn(run.idx === 0 ? "Let's go ▶" : 'Got it ▶'));
    },

    mcq(step, c) {
      c.append(el('h2', {}, step.question));
      if (step.image) c.append(image(step.image));
      const order = step.shuffle === false ? step.options.map((_, i) => i) : shuffle(step.options.map((_, i) => i));
      const fb = el('div');
      let timeLeft = step.timed || 0, answered = false;
      const timerBar = step.timed ? el('div', { class: 'timer', title: 'Answer fast for a speed bonus' }, el('span', { style: 'width:100%' })) : null;
      const btns = order.map((oi) => el('button', { class: 'opt', onclick: () => choose(oi) }, step.options[oi]));
      const byOrig = []; order.forEach((oi, pos) => { byOrig[oi] = btns[pos]; });
      function choose(oi) {
        if (answered) return; answered = true;
        if (run.timer) { clearInterval(run.timer); run.timer = null; }
        btns.forEach((b) => (b.disabled = true));
        byOrig[step.answer].classList.add('right');
        if (oi !== step.answer) byOrig[oi].classList.add('wrong');
        const fast = step.timed && timeLeft > 0 && oi === step.answer;
        grade(fb, step, oi === step.answer ? 1 : 0, fast ? `⚡ Speed bonus +${XP.speedBonus} XP` : (step.timed && timeLeft <= 0 ? '⏱️ Time was up – no speed bonus this time.' : null), fast ? XP.speedBonus : 0);
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
      const btns = step.options.map((o, i) => el('button', { class: 'opt', 'aria-pressed': 'false', onclick: (e) => {
        const b = e.currentTarget; sel.has(i) ? sel.delete(i) : sel.add(i);
        b.classList.toggle('sel', sel.has(i)); b.setAttribute('aria-pressed', String(sel.has(i)));
        check.disabled = sel.size === 0;
      } }, '☐ ' + o));
      const check = el('button', { class: 'btn', disabled: true, onclick: () => {
        check.disabled = true; btns.forEach((b) => (b.disabled = true));
        const ans = new Set(step.answers); let ok = 0;
        btns.forEach((b, i) => {
          const should = ans.has(i), did = sel.has(i);
          if (should === did) ok++;
          b.textContent = (should ? '☑ ' : '☐ ') + step.options[i];
          b.classList.remove('sel');
          if (should) b.classList.add('right'); else if (did) b.classList.add('wrong');
        });
        grade(fb, step, ok / btns.length, ok === btns.length ? null : `You got **${ok} of ${btns.length}** choices right. Green = should be selected.`);
      } }, 'Check ✔');
      c.append(el('div', { class: 'muted small' }, 'Select all that apply.'), el('div', { class: 'opts' }, btns), ...lifelines(step), el('div', { class: 'row' }, el('div', { class: 'spacer' }), check), fb);
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
          if (!good) r.append(el('div', { class: 'small', style: 'margin-top:6px;color:var(--ok)' }, '✔ Correct: ' + step.buckets[r._it.bucket]));
        });
        grade(fb, step, ok / rows.length, ok === rows.length ? null : `You sorted **${ok} of ${rows.length}** correctly.`);
      } }, 'Check ✔');
      c.append(el('div', { class: 'muted small' }, 'Tap a category for every item, then check.'), el('div', { class: 'stack' }, rows), el('div', { class: 'row' }, el('div', { class: 'spacer' }), check), fb);
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
            el('span', { class: 'txt' }, step.items[oi], locked && !right ? el('div', { class: 'small', style: 'color:var(--ok)' }, '✔ belongs at position ' + (oi + 1)) : null),
            locked ? null : el('button', { 'aria-label': 'Move up', disabled: pos === 0, onclick: () => { [cur[pos - 1], cur[pos]] = [cur[pos], cur[pos - 1]]; beep('click'); paint(); } }, '▲'),
            locked ? null : el('button', { 'aria-label': 'Move down', disabled: pos === cur.length - 1, onclick: () => { [cur[pos + 1], cur[pos]] = [cur[pos], cur[pos + 1]]; beep('click'); paint(); } }, '▼')));
        });
      };
      paint();
      const check = el('button', { class: 'btn', onclick: () => {
        locked = true; check.disabled = true; paint();
        const ok = cur.filter((oi, pos) => oi === pos).length;
        grade(fb, step, ok / cur.length, ok === cur.length ? null : `**${ok} of ${cur.length}** in the right place.`);
      } }, 'Check order ✔');
      c.append(el('div', { class: 'muted small' }, 'Use ▲ ▼ to move items.'), list, el('div', { class: 'row' }, el('div', { class: 'spacer' }), check), fb);
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
          wrap.append(el('div', { class: 'swipe-card' }, `🎉 ${ok} of ${cards.length} right!`));
          count.textContent = '';
          return grade(fb, step, ok / cards.length);
        }
        count.textContent = `Card ${i + 1} of ${cards.length} · swipe or use ← →`;
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
        setTimeout(() => { i++; show(); }, good ? 1300 : 2400);
      };
      const onKey = (e) => { if (e.key === 'ArrowLeft') answer('left'); if (e.key === 'ArrowRight') answer('right'); };
      document.addEventListener('keydown', onKey);
      c.append(count, wrap, el('div', { class: 'swipe-btns' }, leftBtn, rightBtn), why, fb);
      show();
    },

    hotspot(step, c) {
      c.append(el('h2', {}, step.question));
      const shot = image(step.image, { clickable: true, alt: 'Click on the right spot in this screenshot' });
      const fb = el('div'); let tries = 0, done = false; const t = step.target; const tol = 2;
      const tryMsg = el('div', { class: 'muted small' }, '👆 Tap the right spot on the screenshot. You have 2 tries.');
      shot.addEventListener('click', (e) => {
        if (done) return;
        const r = shot.getBoundingClientRect();
        const x = ((e.clientX - r.left) / r.width) * 100, y = ((e.clientY - r.top) / r.height) * 100;
        const hit = x >= t.x - tol && x <= t.x + t.w + tol && y >= t.y - tol && y <= t.y + t.h + tol;
        shot.append(el('span', { class: 'marker ' + (hit ? 'ok' : 'no'), style: `left:${x}%;top:${y}%` }));
        tries++;
        if (hit || tries >= 2) {
          done = true;
          shot.append(el('span', { class: 'target-box', style: `left:${t.x}%;top:${t.y}%;width:${t.w}%;height:${t.h}%` }));
          grade(fb, step, hit ? (tries === 1 ? 1 : 0.5) : 0, hit ? null : 'The green box shows the right spot.');
        } else { beep('bad'); tryMsg.textContent = '❌ Not there – one more try!'; }
      });
      c.append(tryMsg, shot, ...lifelines(step), fb);
    },

    prompt(step, c) {
      const rules = [
        { k: 'Goal', d: 'What should the agent do?', tip: 'Start with what the agent does: "You help…", "Answer…", "Create…"', re: /\b(help|helps|answer|answers|create|summari[sz]e|draft|list|explain|guide|write|check|recommend|support|find|order)\b/i },
        { k: 'Context', d: 'For whom / why?', tip: 'Say who it is for: store managers, baristas, new hires…', re: /\b(for|our|employees?|staff|customers?|new hires?|team|baristas?|managers?|users?|colleagues?|because)\b/i },
        { k: 'Source', d: 'Where do answers come from?', tip: 'Name the source: "Answer only from the Supplier Catalog file".', re: /\b(sharepoint|knowledge|documents?|files?|policy|handbook|catalog(ue)?|website|only from|based on|price list|excel|sources?)\b/i },
        { k: 'Expectations', d: 'Format, length, tone', tip: 'Add a format: "short table", "max. 5 bullets", "friendly tone".', re: /\b(bullets?|table|short|brief|tone|friendly|formal|steps?|format|concise|max(imum)?\.?|\d+\s*(words|sentences|bullets|points|lines))\b/i },
        { k: 'Guardrails', d: 'When unsure / not allowed', tip: 'Add a guardrail: "If it is not in the catalog, say so and refer to…"', re: /(don't|do not|never|if (it|you|the|an|a)\b.*\b(not|don't|isn't|unsure)|escalate|refer|approv|confirm|ask the|unsure)/i }
      ];
      c.append(el('h2', {}, step.title || 'Prompt challenge'), el('p', {}, el('b', {}, '🎯 '), step.scenario));
      const ta = el('textarea', { class: 'input', rows: '6', placeholder: 'Write the instructions for your agent here…', 'aria-label': 'Your instructions' });
      const meter = el('div', { class: 'meter' }); const bar = el('div', { class: 'scorebar' }, el('span', { style: 'width:0%' }));
      const tips = el('ul', { class: 'tips' }); const scoreTxt = el('div', { style: 'font-weight:700' });
      const fb = el('div');
      const els = rules.map((r) => el('div', { class: 'el' }, el('b', {}, '○ ' + r.k), r.d));
      meter.append(...els);
      const vague = /\b(stuff|things|something|etc\.?|whatever|amazing|awesome)\b/gi;
      function score() {
        const t = ta.value; const words = t.trim().split(/\s+/).filter(Boolean).length;
        let s = 0; clear(tips);
        rules.forEach((r, i) => {
          const on = r.re.test(t); els[i].classList.toggle('on', on); els[i].firstChild.textContent = (on ? '✔ ' : '○ ') + r.k;
          if (on) s++; else if (words > 3) tips.append(el('li', {}, r.tip));
        });
        const v = (t.match(vague) || []).length;
        if (v) tips.append(el('li', {}, `Avoid vague words (${[...new Set(t.match(vague).map((x) => x.toLowerCase()))].join(', ')}) – be specific.`));
        if (words > 0 && words < 20) tips.append(el('li', {}, 'A bit short – good instructions are usually 25–150 words.'));
        const final = Math.max(0, s - Math.min(1, v) + (words >= 25 && words <= 200 ? 1 : 0));
        bar.firstChild.style.width = Math.min(100, (final / 6) * 100) + '%';
        scoreTxt.textContent = `Prompt score: ${final} / 6`;
        submit.disabled = words < 8;
        return final;
      }
      const submit = el('button', { class: 'btn', disabled: true, onclick: () => {
        submit.disabled = true; ta.readOnly = true;
        const s = score(); me().lastPrompt = ta.value; save();
        const frac = Math.min(1, s / (step.minScore + 1));
        grade(fb, step, frac, (s >= step.minScore ? `Strong instructions – **${s}/6**!` : `**${s}/6** – check the tips above to level it up.`) + '\n\n**Example of a strong version:**\n\n*' + step.example + '*');
      } }, 'Submit my prompt ✔');
      ta.addEventListener('input', score);
      c.append(ta, scoreTxt, bar, meter, tips, el('div', { class: 'row' }, el('span', { class: 'muted small' }, 'The meter checks for the 5 parts. It can’t judge quality – be honest with yourself 😉'), el('div', { class: 'spacer' }), submit), fb);
      score();
    },

    breakbot(step, c) {
      const a = step.agent;
      c.append(el('h2', {}, `${a.avatar || '🤖'} Test ${a.name} – find the bugs!`),
        el('p', { class: 'muted' }, 'Ask each test question, read the answer, then decide: good answer or bug?'));
      const chat = el('div', { class: 'chat', 'aria-live': 'polite' }, el('div', { class: 'bubble sys' }, `${a.name}: ${a.description}`));
      const qs = el('div'); const fb = el('div'); let judged = 0, ok = 0, busy = false;
      const info = el('div', { class: 'bot-info' }, el('b', {}, '📚 What the agent knows:'), el('ul', { style: 'margin:6px 0 0;padding-left:18px' }, a.knowledge.map((k) => el('li', {}, k))));
      step.tests.forEach((t) => {
        const b = el('button', { class: 'test-q', onclick: () => {
          if (busy) return; busy = true; b.disabled = true;
          qs.querySelectorAll('.test-q').forEach((x) => (x.disabled = true));
          chat.append(el('div', { class: 'bubble user' }, t.q));
          const typing = el('div', { class: 'typing' }, a.name + ' is typing…'); chat.append(typing);
          setTimeout(() => {
            typing.remove(); chat.append(el('div', { class: 'bubble bot' }, t.a));
            const judge = el('div', { class: 'row' },
              el('button', { class: 'btn secondary', onclick: () => decide(false) }, '✅ Good answer'),
              el('button', { class: 'btn secondary', onclick: () => decide(true) }, '🐞 Bug!'));
            chat.append(judge); judge.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            function decide(saysBug) {
              judge.remove(); const right = saysBug === t.fails; judged++; if (right) ok++;
              beep(right ? 'good' : 'bad');
              b.classList.add(right ? 'done-ok' : 'done-bad'); b.textContent = (t.fails ? '🐞 ' : '✅ ') + t.q;
              chat.append(el('div', { class: 'bubble sys' }, (right ? '✔ You’re right' : '✘ Not quite') + (t.fails ? ' – that’s a bug! ' : ' – this answer is fine. ') + t.why));
              busy = false;
              qs.querySelectorAll('.test-q').forEach((x) => { if (!x.classList.contains('done-ok') && !x.classList.contains('done-bad')) x.disabled = false; });
              if (judged === step.tests.length) grade(fb, step, ok / judged, `You judged **${ok} of ${judged}** answers correctly. There were **${step.tests.filter((x) => x.fails).length} bugs** hiding.`);
            }
          }, 900);
        } }, '💬 ' + t.q);
        qs.append(b);
      });
      c.append(el('div', { class: 'bot-layout' }, el('div', {}, info, el('div', { class: 'lbl', style: 'margin-top:12px' }, 'Test questions'), qs), chat), fb);
    },

    mission(step, c) {
      const p = me(); const already = p.missions.includes(run.id + ':' + run.idx);
      c.append(el('h2', {}, '🛠️ ' + (step.title || 'Mission')), rich(step.text));
      const inp = el('input', { class: 'input', placeholder: 'Code word', autocomplete: 'off', 'aria-label': 'Code word' });
      const res = el('div');
      const submit = () => {
        if (inp.value.trim().toUpperCase() === String(step.codeWord).toUpperCase()) {
          inp.disabled = true; btn.disabled = true;
          if (!already && !run.replay) { p.missions.push(run.id + ':' + run.idx); save(); addXp(step.bonusXp || 20); }
          beep('combo'); confetti(60);
          res.append(el('div', { class: 'feedback good' }, el('div', { class: 'fb-title' }, `Mission complete! 🎉 ${already || run.replay ? '' : '+' + (step.bonusXp || 20) + ' XP'}`)));
          skip.textContent = 'Next ▶';
        } else { inp.classList.add('shake'); beep('bad'); setTimeout(() => inp.classList.remove('shake'), 400); }
      };
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
      const btn = el('button', { class: 'btn', onclick: submit }, 'Submit');
      const skip = el('button', { class: 'btn ghost', onclick: () => { run.idx++; persistRun(); renderStep(); } }, already ? 'Next ▶' : 'Skip for now ▶');
      if (already) res.append(el('div', { class: 'feedback good' }, '✔ You already completed this mission.'));
      c.append(el('div', { class: 'codebox' }, inp, btn), res, el('div', { class: 'row' }, el('span', { class: 'muted small' }, 'Bonus missions are optional – they don’t affect your stars.'), el('div', { class: 'spacer' }), skip));
    },

    idea(step, c) {
      const p = me(); const vals = { ...(p.idea || {}) };
      c.append(el('h2', {}, '💡 ' + (step.title || 'Your idea')), el('p', {}, step.question));
      const inputs = step.fields.map((f) => {
        const i = el('input', { class: 'input', id: 'f_' + f.key, placeholder: f.placeholder || '', value: vals[f.key] || '', maxlength: '120' });
        i.addEventListener('input', () => { vals[f.key] = i.value; });
        return el('div', {}, el('label', { class: 'lbl', for: 'f_' + f.key }, f.label), i);
      });
      const out = el('div');
      const btn = el('button', { class: 'btn', onclick: () => {
        if (!step.fields.every((f) => (vals[f.key] || '').trim())) { toast('Fill in every field to create your idea card'); return; }
        const first = !p.idea; p.idea = vals; save(); btn.disabled = true;
        clear(out);
        out.append(ideaCard(p), nextBtn());
        if (first && !run.replay) addXp(XP.idea, `💡 Idea card created +${XP.idea} XP`);
        beep('good');
      } }, 'Create my idea card ✨');
      c.append(...inputs, el('div', { class: 'row' }, el('div', { class: 'spacer' }), btn), out);
    },

    feedback(step, c) {
      const p = me(); let stars = p.feedback?.stars || 0;
      c.append(el('h2', {}, '⭐ ' + step.question));
      const pickBox = el('div', { class: 'starpick', role: 'radiogroup', 'aria-label': 'Rating' });
      const paint = () => { clear(pickBox); for (let i = 1; i <= 5; i++) pickBox.append(el('button', { class: i <= stars ? 'on' : '', 'aria-label': i + ' stars', onclick: () => { stars = i; paint(); } }, '★')); };
      paint();
      const ta = el('textarea', { class: 'input', rows: '3', placeholder: 'What was your biggest "aha" moment today?' }, p.feedback?.text || '');
      const btn = el('button', { class: 'btn', onclick: () => {
        if (!stars) { toast('Pick 1–5 stars first'); return; }
        const first = !p.feedback; p.feedback = { stars, text: ta.value.trim() }; save();
        if (first && !run.replay) addXp(XP.feedback, `🙏 Thanks for your feedback! +${XP.feedback} XP`);
        run.idx++; persistRun(); renderStep();
      } }, 'Finish 🏁');
      c.append(pickBox, ta);
      if (config.feedbackFormUrl) c.append(el('p', { class: 'small' }, '📝 Your trainer would love your feedback: ', el('a', { href: config.feedbackFormUrl, target: '_blank', rel: 'noopener' }, 'open the feedback form')));
      c.append(el('p', { class: 'muted small' }, 'Your rating stays on this device unless you use the feedback form.'), el('div', { class: 'row' }, el('div', { class: 'spacer' }), btn));
    }
  };

  function ideaCard(p) {
    const i = p.idea || {};
    return el('div', { class: 'idea-card' }, el('h3', {}, '🤖 ' + (i.name || 'My agent')),
      el('dl', {}, el('dt', {}, 'For'), el('dd', {}, i.audience || ''), el('dt', {}, 'Solves'), el('dd', {}, i.problem || ''),
        el('dt', {}, 'Trusted source'), el('dd', {}, i.source || ''), el('dt', {}, 'Action'), el('dd', {}, i.action || '')));
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
    } else if (stars > p.done[run.id].stars) { p.done[run.id].stars = stars; save(); }
    const idx = config.levels.findIndex((l) => l.id === run.id);
    const next = config.levels[idx + 1];
    beep('level'); confetti(stars === 3 ? 200 : 120);
    clear(app);
    app.append(el('div', { class: 'card complete stack', style: 'margin-top:14px' },
      el('div', { class: 'muted' }, 'Level complete!'),
      el('div', { class: 'big-badge', 'aria-hidden': 'true' }, L.badge?.icon || '🏅'),
      el('h1', {}, L.badge?.name || L.title),
      el('p', { class: 'muted' }, L.badge?.description || ''),
      el('div', { class: 'stars-big', 'aria-label': stars + ' of 3 stars' }, '★'.repeat(stars) + '☆'.repeat(3 - stars)),
      el('div', {}, `Score: ${Math.round(pct * 100)}%` + (firstTime ? `  ·  +${stars * 5} XP star bonus` : '')),
      L.card ? el('div', {}, el('div', { class: 'lbl' }, '🎴 New cheat card collected'), cheatCard(L)) : null,
      el('div', { class: 'row', style: 'justify-content:center' },
        el('button', { class: 'btn secondary', onclick: () => go('map') }, '🗺️ Map'),
        next ? el('button', { class: 'btn', onclick: () => go('level', next.id) }, 'Next level ▶') : el('button', { class: 'btn', onclick: () => go('certificate') }, '🏆 Get my certificate'))
    ));
    run = null;
  }
  function cheatCard(L) {
    return el('div', { class: 'cheat' }, el('h3', {}, L.icon + ' ' + L.card.title), el('ul', {}, L.card.lines.map((x) => el('li', {}, x))));
  }

  // ---------- Cards & badges ----------
  function renderCards() {
    const p = me();
    app.append(el('h2', {}, '🏅 My badges'),
      el('div', { class: 'badges' }, config.levels.map((lv) => {
        const L = lessons[lv.id]; const has = p.badges.includes(lv.id);
        return el('div', { class: 'badge' + (has ? '' : ' locked'), title: L.badge?.description || '' }, el('div', { class: 'i' }, L.badge?.icon || '🏅'), el('div', { class: 'n' }, has ? L.badge?.name : '???'));
      })),
      el('h2', { style: 'margin-top:24px' }, '🎴 My cheat cards'),
      p.cards.length ? el('div', { class: 'cards-grid' }, config.levels.filter((lv) => p.cards.includes(lv.id) && lessons[lv.id].card).map((lv) => cheatCard(lessons[lv.id])))
        : el('p', { class: 'muted' }, 'Finish a level to collect your first cheat card.'),
      p.idea ? el('div', { style: 'margin-top:24px' }, el('h2', {}, '💡 My agent idea'), ideaCard(p)) : null,
      el('div', { class: 'row', style: 'margin-top:20px' }, el('button', { class: 'btn', onclick: () => go('map') }, '🗺️ Back to map'),
        el('button', { class: 'btn secondary', onclick: () => window.print() }, '🖨️ Print / save as PDF')));
  }

  // ---------- Certificate ----------
  function renderCertificate() {
    const p = me(); const r = rankOf(p.xp);
    const doneCount = config.levels.filter((l) => p.done[l.id]).length;
    const totalStars = Object.values(p.done).reduce((s, d) => s + d.stars, 0);
    confetti(160); beep('level');
    app.append(el('div', { class: 'certificate stack', style: 'margin-top:14px' },
      el('div', { class: 'muted', style: 'letter-spacing:.2em;text-transform:uppercase;font-size:13px' }, 'Certificate of completion'),
      el('div', { style: 'font-size:56px' }, p.avatar),
      el('div', { class: 'cname' }, p.name),
      el('div', {}, 'completed ', el('b', {}, config.title)),
      el('div', { style: 'font-size:20px;font-weight:700' }, '🏆 ' + r.title),
      el('div', { class: 'muted' }, `${p.xp} XP · ${totalStars} ★ · ${doneCount}/${config.levels.length} levels · best streak 🔥${p.bestStreak || 0}`),
      el('div', { class: 'badges' }, config.levels.filter((lv) => p.badges.includes(lv.id)).map((lv) => el('div', { class: 'badge' }, el('div', { class: 'i' }, lessons[lv.id].badge?.icon), el('div', { class: 'n' }, lessons[lv.id].badge?.name)))),
      el('div', { class: 'muted small' }, new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })),
      el('div', { class: 'disclaimer' }, config.disclaimer || '')),
      p.idea ? el('div', { style: 'margin-top:16px' }, ideaCard(p)) : null,
      el('div', { class: 'row no-print', style: 'margin-top:16px;justify-content:center' },
        el('button', { class: 'btn', onclick: () => window.print() }, '🖨️ Print / save as PDF'),
        el('button', { class: 'btn secondary', onclick: () => go('cards') }, '🎴 My cheat cards'),
        el('button', { class: 'btn secondary', onclick: () => go('map') }, '🗺️ Map')),
      el('p', { class: 'muted small no-print', style: 'text-align:center' }, '📸 Tip: take a screenshot and share your badge!'));
  }

  // ---------- Boot ----------
  async function boot() {
    try {
      const cfgName = WS === 'workshop' ? 'workshop' : WS;
      let res = await fetch(`content/${cfgName}.json`, { cache: 'no-cache' });
      if (!res.ok) res = await fetch('content/workshop.json', { cache: 'no-cache' });
      config = await res.json();
      document.title = config.title;
      await Promise.all(config.levels.map(async (lv) => {
        const r = await fetch('content/' + lv.file, { cache: 'no-cache' });
        if (!r.ok) throw new Error('Could not load ' + lv.file);
        lessons[lv.id] = await r.json();
      }));
      if (params.get('reset') === '1') { store = { players: {}, current: null, muted: store.muted }; save(); }
      go(me() ? 'map' : 'welcome');
    } catch (e) {
      clear(app);
      app.append(el('div', { class: 'card' }, el('h2', {}, '⚠️ The quest could not load'),
        el('p', {}, String(e.message || e)),
        el('p', { class: 'muted small' }, 'If you opened index.html directly from disk, start a local web server instead (see README).')));
      console.error(e);
    }
  }
  boot();
})();
