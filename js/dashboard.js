/* Trainer dashboard for Copilot Studio Quest live results.
   Talks to /api/trainer/* with the trainer key (kept in this browser tab only). */
(() => {
  'use strict';
  const root = document.getElementById('dash');
  const KEY_STORE = 'csq:trainerKey';
  const REFRESH_MS = 10000;
  let key = sessionStorage.getItem(KEY_STORE) || '';
  let config = null; const lessons = {};
  let overview = null; let selected = null; let report = null; let timer = null; let autoRefresh = true;

  // ---------- helpers ----------
  function el(tag, attrs = {}, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') n.className = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat()) { if (kid == null || kid === false) continue; n.append(kid.nodeType ? kid : document.createTextNode(String(kid))); }
    return n;
  }
  const clear = (n) => { while (n.firstChild) n.removeChild(n.firstChild); };
  let toastT;
  function toast(m) { const t = document.getElementById('toast'); t.textContent = m; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 2600); }
  const loc = (v) => (v && typeof v === 'object' && !Array.isArray(v)) ? (v.en ?? Object.values(v)[0]) : v;
  const band = (pct) => pct >= 80 ? 'strong' : pct >= 50 ? 'review' : 'focus';
  const bandText = { strong: 'Understood', review: 'Shaky', focus: 'Revisit' };
  const fmtTime = (iso) => { const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleString([], { hour: '2-digit', minute: '2-digit', day: '2-digit', month: 'short' }); };
  const ago = (iso) => { const s = Math.round((Date.now() - Date.parse(iso)) / 1000); return s < 60 ? s + ' s ago' : s < 3600 ? Math.round(s / 60) + ' min ago' : Math.round(s / 3600) + ' h ago'; };

  async function api(action, { body, query } = {}) {
    const qs = query ? '?' + new URLSearchParams(query).toString() : '';
    const r = await fetch('api/trainer/' + action + qs, {
      method: body ? 'POST' : 'GET', cache: 'no-store',
      headers: { 'x-trainer-key': key, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined
    });
    let j = null; try { j = await r.json(); } catch { j = null; }
    if (r.status === 401) { const e = new Error('unauthorized'); e.status = 401; throw e; }
    if (!r.ok) { const e = new Error((j && (j.detail || j.error)) || ('HTTP ' + r.status)); e.status = r.status; e.code = j && j.error; throw e; }
    return j;
  }

  async function loadContent() {
    config = await (await fetch('content/workshop.json', { cache: 'no-cache' })).json();
    await Promise.all(config.levels.map(async (lv) => { lessons[lv.id] = await (await fetch('content/' + lv.file, { cache: 'no-cache' })).json(); }));
  }
  const levelTitle = (id) => (lessons[id] ? lessons[id].icon + ' ' + lessons[id].title : id === 'done' ? '🏁 Finished' : id);
  function questionText(k) {
    const [lid, i] = k.split(':'); const st = lessons[lid] && lessons[lid].steps[Number(i)];
    const q = st ? (st.question || st.title || st.scenario || '') : k;
    return q.length > 140 ? q.slice(0, 137) + '…' : q;
  }
  const joinLink = (code) => new URL('index.html?live=' + code, location.href).href;

  // ---------- login ----------
  function renderLogin(msg) {
    clear(root);
    const inp = el('input', { class: 'input', type: 'password', id: 'tkey', placeholder: 'Trainer key', autocomplete: 'current-password' });
    const go = async () => {
      key = inp.value.trim(); if (!key) return;
      try { await refreshOverview(); sessionStorage.setItem(KEY_STORE, key); render(); }
      catch (e) { renderLogin(e.status === 401 ? '❌ Wrong trainer key.' : e.status === 503 ? '⚠️ ' + explain(e) : '⚠️ Could not reach the API: ' + e.message); }
    };
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
    root.append(
      el('div', { class: 'dash-head' }, el('h1', {}, '📊 Trainer dashboard')),
      el('div', { class: 'card stack', style: 'max-width:520px' },
        el('p', {}, 'Enter the trainer key you set in Azure (app setting ', el('code', {}, 'TRAINER_KEY'), ').'),
        el('label', { class: 'lbl', for: 'tkey' }, 'Trainer key'), inp,
        msg ? el('div', { class: 'warn-box' }, msg) : null,
        el('div', { class: 'row actions' }, el('div', { class: 'spacer' }), el('button', { class: 'btn', onclick: go }, 'Open dashboard'))));
    setTimeout(() => inp.focus(), 30);
  }
  function explain(e) {
    if (e.code === 'trainer-key-not-configured') return 'TRAINER_KEY is not set in Azure (or shorter than 10 characters). See README → Live results.';
    if (e.code === 'storage-not-configured') return 'RESULTS_STORAGE is not set in Azure. See README → Live results.';
    return e.message;
  }

  // ---------- data ----------
  async function refreshOverview() { overview = await api('overview'); }
  async function refreshReport() {
    if (!selected) { report = null; return; }
    try { report = await api('report', { query: { code: selected } }); }
    catch (e) { if (e.status === 404) { selected = null; report = null; } else throw e; }
  }
  function schedule() {
    clearTimeout(timer);
    if (!autoRefresh || !selected || document.hidden) return;
    timer = setTimeout(async () => { try { await refreshReport(); renderReport(); syncCount(); } catch { /* keep last view */ } schedule(); }, REFRESH_MS);
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) schedule(); });

  // ---------- main view ----------
  let reportBox;
  function render() {
    clear(root);
    root.append(el('div', { class: 'dash-head' }, el('h1', {}, '📊 Trainer dashboard'), el('div', { class: 'spacer' }),
      el('a', { class: 'btn ghost', href: 'trainer.html' }, '🎓 Codes & guide'),
      el('button', { class: 'btn ghost', onclick: () => { sessionStorage.removeItem(KEY_STORE); key = ''; clearTimeout(timer); renderLogin(); } }, '🔒 Lock')));
    root.append(el('div', { class: 'dash-grid' }, switchCard(), sessionsCard()));
    reportBox = el('div', { id: 'report', style: 'margin-top:18px' });
    root.append(reportBox);
    renderReport();
    if (overview.cleaned) toast(`🧹 ${overview.cleaned} expired session(s) and their results were deleted`);
  }

  function switchCard() {
    const ov = overview;
    if (ov.hardOff) return el('div', { class: 'card stack' }, el('h2', {}, '🔌 Live results'),
      el('div', { class: 'switch-row' }, el('span', { class: 'state-label off' }, 'OFF in Azure')),
      el('p', { class: 'muted' }, 'The app setting LIVE_RESULTS=off is active: the API does not touch storage at all, and participants keep their progress on their own device. Remove that setting in Azure to use live results again.'));
    const sw = el('button', { class: 'switch' + (ov.enabled ? ' on' : ''), role: 'switch', 'aria-checked': String(ov.enabled), 'aria-label': 'Live results on/off', onclick: async () => {
      sw.disabled = true;
      try { const r = await api('settings', { body: { enabled: !ov.enabled } }); ov.enabled = r.enabled; toast(r.enabled ? '✅ Live results ON' : '⏸️ Live results OFF – no new data is stored'); }
      catch (e) { toast('⚠️ ' + e.message); }
      render();
    } });
    return el('div', { class: 'card stack' },
      el('h2', {}, '🔌 Live results'),
      el('div', { class: 'switch-row' }, sw, el('span', { class: 'state-label ' + (ov.enabled ? 'on' : 'off') }, ov.enabled ? 'ON' : 'OFF')),
      el('p', { class: 'muted small' }, ov.enabled
        ? 'Participants with a live link send their results to your storage. Turn this OFF when you are done – the API then rejects all new data and participants keep playing offline.'
        : 'OFF: nothing new is stored. Participants keep playing; their progress stays on their own device.'),
      el('div', { class: 'row' },
        el('button', { class: 'btn danger small', onclick: async () => {
          if (!confirm('Delete ALL sessions and ALL results from storage? This cannot be undone.')) return;
          try { const r = await api('purge-all', { body: {} }); toast(`🗑️ Deleted ${r.sessions} session(s) and ${r.deleted} result(s)`); selected = null; report = null; await refreshOverview(); render(); }
          catch (e) { toast('⚠️ ' + e.message); }
        } }, '🗑️ Delete all data'),
        el('span', { class: 'muted small' }, 'To stop storage completely, see README → "Turning it off".')));
  }

  function sessionsCard() {
    const title = el('input', { class: 'input', placeholder: 'Workshop name, e.g. Contoso – 21 Oct', maxlength: '80' });
    const hours = el('select', { class: 'input', style: 'max-width:140px', 'aria-label': 'Session length' }, [2, 4, 8, 24, 48].map((h) => el('option', { value: h, selected: h === 4 }, h + ' hours')));
    const rows = (overview.sessions || []).map((s) => el('tr', { class: s.code === selected ? 'selected' : '' },
      el('td', {}, el('span', { class: 'code-pill' }, s.code)),
      el('td', {}, s.title),
      el('td', {}, el('span', { class: 'status-pill ' + (s.open ? 'open' : 'closed') }, s.open ? 'Open' : 'Closed')),
      el('td', { id: 'pc-' + s.code }, String(s.players)),
      el('td', { class: 'muted small' }, 'until ' + fmtTime(s.expiresAt)),
      el('td', {}, el('div', { class: 'row', style: 'gap:6px;flex-wrap:nowrap' },
        el('button', { class: 'btn small', onclick: async () => { selected = s.code; await refreshReport(); render(); schedule(); } }, 'View'),
        s.open ? el('button', { class: 'btn secondary small', title: 'Stop accepting results (keep data)', onclick: async () => { await api('session-close', { body: { code: s.code } }); await refreshOverview(); if (selected === s.code) await refreshReport(); render(); toast('🔒 Session closed – data kept'); } }, 'Close') : null,
        el('button', { class: 'btn danger small', title: 'Close and delete all results', onclick: async () => {
          if (!confirm(`Delete session ${s.code} and all its results?`)) return;
          const r = await api('session-close', { body: { code: s.code, purge: true } }); if (selected === s.code) { selected = null; report = null; }
          await refreshOverview(); render(); toast(`🗑️ Deleted ${r.deleted} result(s)`);
        } }, 'Delete')))));
    return el('div', { class: 'card stack' },
      el('h2', {}, '🎟️ Sessions'),
      overview.enabled ? el('div', { class: 'row' }, title, hours, el('button', { class: 'btn', onclick: async () => {
        try { const r = await api('session-open', { body: { title: title.value, hours: Number(hours.value) } }); selected = r.session.code; await refreshOverview(); await refreshReport(); render(); schedule(); toast('🚀 Session ' + r.session.code + ' started'); }
        catch (e) { toast('⚠️ ' + e.message); }
      } }, '▶ Start session')) : el('div', { class: 'muted-box' }, 'Turn live results ON to start a session.'),
      rows.length ? el('div', { style: 'overflow-x:auto' }, el('table', { class: 'sessions' }, el('tr', {}, ['Code', 'Workshop', 'Status', 'People', 'Expires', ''].map((h) => el('th', {}, h))), rows))
        : el('p', { class: 'muted' }, 'No sessions yet. Sessions and their results are deleted automatically after they expire.'));
  }

  // ---------- report ----------
  function analyse(players) {
    const topicIds = config.levels.map((l) => l.id);
    const topics = topicIds.map((id) => {
      let s = 0, m = 0; const dist = { strong: 0, review: 0, focus: 0 };
      for (const p of players) { const x = p.data.topics && p.data.topics[id]; if (!x || !x.m) continue; s += x.s; m += x.m; dist[band(Math.round((x.s / x.m) * 100))]++; }
      return m ? { id, pct: Math.round((s / m) * 100), answered: dist.strong + dist.review + dist.focus, dist } : null;
    }).filter(Boolean);
    const missed = {};
    for (const p of players) for (const k of p.data.missed || []) missed[k] = (missed[k] || 0) + 1;
    const people = players.map((p) => {
      let s = 0, m = 0, weakest = null;
      for (const [id, x] of Object.entries(p.data.topics || {})) { s += x.s; m += x.m; const pct = Math.round((x.s / x.m) * 100); if (!weakest || pct < weakest.pct) weakest = { id, pct }; }
      return { ...p, overall: m ? Math.round((s / m) * 100) : null, weakest };
    });
    const levelCount = {};
    for (const p of players) { const lv = p.data.level || config.levels[0].id; levelCount[lv] = (levelCount[lv] || 0) + 1; }
    return { topics, missed, people, levelCount };
  }

  function syncCount() {
    if (!report || !overview) return;
    const s = (overview.sessions || []).find((x) => x.code === report.session.code);
    if (s) s.players = report.players.length;
    const cell = document.getElementById('pc-' + report.session.code);
    if (cell) cell.textContent = String(report.players.length);
  }
  function renderReport() {
    if (!reportBox) return;
    syncCount();
    clear(reportBox);
    if (!report) { reportBox.append(el('div', { class: 'card muted-box' }, 'Start a session or select one to see the live room report.')); return; }
    const s = report.session; const players = report.players; const A = analyse(players);
    const link = joinLink(s.code);
    const withOverall = A.people.filter((p) => p.overall != null);
    const avg = withOverall.length ? Math.round(withOverall.reduce((a, p) => a + p.overall, 0) / withOverall.length) : null;
    const fb = players.filter((p) => p.data.feedback && p.data.feedback.stars);
    const avgStars = fb.length ? (fb.reduce((a, p) => a + p.data.feedback.stars, 0) / fb.length).toFixed(1) : '–';
    const avgDone = players.length ? (players.reduce((a, p) => a + (p.data.done || 0), 0) / players.length).toFixed(1) : '0';

    const autoBtn = el('button', { class: 'btn ghost small', onclick: () => { autoRefresh = !autoRefresh; schedule(); renderReport(); } }, autoRefresh ? '⏸ Pause auto-refresh' : '▶ Resume auto-refresh');
    reportBox.append(
      el('div', { class: 'join-box' },
        el('div', {}, el('div', { class: 'small', style: 'opacity:.8' }, s.open ? 'Live session – share this link (or a QR code of it)' : 'Session closed – results are kept until you delete them or it expires'),
          el('div', { class: 'jcode' }, s.code), el('div', { class: 'jlink' }, link)),
        el('div', { class: 'spacer' }),
        el('div', { class: 'stack' },
          el('button', { class: 'btn secondary', onclick: async () => { try { await navigator.clipboard.writeText(link); toast('📋 Link copied'); } catch { prompt('Copy the link:', link); } } }, '📋 Copy link'),
          el('button', { class: 'btn secondary', onclick: () => exportCsv(s, A) }, '⬇️ Export CSV'))),
      el('div', { class: 'row', style: 'margin-top:10px' }, el('h2', { style: 'margin:0' }, '🧭 Room report: ' + s.title), el('div', { class: 'spacer' }),
        el('span', { class: 'refresh-info' }, 'Updated ' + new Date().toLocaleTimeString() + (autoRefresh ? ' · refreshes every 10 s' : '')), autoBtn,
        el('button', { class: 'btn ghost small', onclick: async () => { await refreshReport(); renderReport(); } }, '🔄 Refresh')),
      el('div', { class: 'kpis' },
        kpi(players.length, 'participants'), kpi(avg == null ? '–' : avg + '%', 'average understanding'),
        kpi(avgDone + ' / ' + config.levels.length, 'levels done (avg)'), kpi(avgStars + (fb.length ? ' ★' : ''), `feedback (${fb.length} ratings)`)));

    if (!players.length) { reportBox.append(el('div', { class: 'card muted-box' }, '⏳ Waiting for participants… Results appear here as soon as people answer their first question.')); schedule(); return; }

    // Topic heatmap + recommendations
    const reco = A.topics.filter((x) => x.pct < 80).sort((a, b) => a.pct - b.pct);
    reportBox.append(el('div', { class: 'dash-grid', style: 'margin-top:4px' },
      el('div', { class: 'card', style: 'grid-column:1 / -1' }, el('h2', {}, '🌡️ Understanding by topic'),
        A.topics.length ? A.topics.map((x) => el('div', { class: 'heat-row topic-row ' + band(x.pct) },
          el('div', { class: 'tname' }, levelTitle(x.id)),
          el('div', { class: 'tbar' }, el('span', { style: `width:${Math.max(4, x.pct)}%` })),
          el('div', { class: 'tpct' }, x.pct + '%'),
          el('div', { class: 'dist', title: 'People per level of understanding' }, el('span', {}, '🟢 ' + x.dist.strong), el('span', {}, '🟡 ' + x.dist.review), el('span', {}, '🔴 ' + x.dist.focus)),
          el('span', { class: 'band ' + band(x.pct) }, bandText[band(x.pct)]))) : el('p', { class: 'muted' }, 'No answers yet.')),
      el('div', { class: 'card' }, el('h2', {}, '🎯 What the group should focus on'),
        reco.length ? el('ol', { class: 'reco' }, reco.map((x) => {
          const L = lessons[x.id]; const f = L.focus || {};
          return el('li', {}, el('b', {}, levelTitle(x.id) + ' – ' + x.pct + '%: '), x.pct < 50 ? 'revisit this topic with the whole room. ' : 'do a short recap and discuss the most-missed question. ',
            f.tips && f.tips[0] ? el('div', { class: 'muted small' }, 'Key message: ' + f.tips[0]) : null);
        })) : el('p', {}, '🌟 The group understood every topic well (80%+). Move on to hands-on building.')),
      el('div', { class: 'card' }, el('h2', {}, '📍 Where people are'),
        el('div', { class: 'levelbars' }, [...config.levels.map((l) => l.id), 'done'].filter((id) => A.levelCount[id]).map((id) => el('div', { class: 'levelbar' },
          el('div', {}, levelTitle(id)), el('div', { class: 'b' }, el('span', { style: `width:${(A.levelCount[id] / players.length) * 100}%` })), el('div', { style: 'font-weight:800' }, String(A.levelCount[id])))))),
      el('div', { class: 'card', style: 'grid-column:1 / -1' }, el('h2', {}, '❌ Most-missed questions'),
        Object.keys(A.missed).length ? el('ul', { class: 'missed-list' }, Object.entries(A.missed).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, n]) =>
          el('li', {}, el('div', {}, questionText(k), el('div', { class: 'lv' }, levelTitle(k.split(':')[0]))), el('div', { class: 'cnt' }, n + ' / ' + players.length + ' people')))) : el('p', { class: 'muted' }, 'Nobody has missed a question yet. 🎉'))));

    // People table
    const sorted = A.people.slice().sort((a, b) => (a.overall ?? 101) - (b.overall ?? 101));
    reportBox.append(el('div', { class: 'card', style: 'margin-top:14px' }, el('h2', {}, '👥 Participants'),
      el('p', { class: 'muted small' }, 'Sorted so the people who may need support are at the top.'),
      el('div', { style: 'overflow-x:auto' }, el('table', { class: 'people' },
        el('tr', {}, ['Player', 'Now at', 'Levels', 'XP', 'Understanding', 'Weakest topic', 'Last update'].map((h) => el('th', {}, h))),
        sorted.map((p) => el('tr', {},
          el('td', {}, (p.avatar || '') + ' ' + p.name, p.overall != null && p.overall < 50 ? el('div', { class: 'needs' }, 'May need support') : null),
          el('td', {}, levelTitle(p.data.level)),
          el('td', {}, String(p.data.done || 0)),
          el('td', {}, String(p.data.xp || 0)),
          el('td', {}, p.overall == null ? '–' : el('span', {}, el('span', { class: 'mini' }, el('span', { style: `width:${p.overall}%;background:${p.overall >= 80 ? 'var(--ok)' : p.overall >= 50 ? '#f0a500' : 'var(--bad)'}` })), ' ' + p.overall + '%')),
          el('td', {}, p.weakest ? levelTitle(p.weakest.id) + ' (' + p.weakest.pct + '%)' : '–'),
          el('td', { class: 'muted small' }, ago(p.updated))))))));

    // Ideas & feedback
    const ideas = players.filter((p) => p.data.idea && p.data.idea.name);
    const comments = fb.filter((p) => p.data.feedback.text);
    if (ideas.length || fb.length) reportBox.append(el('div', { class: 'dash-grid', style: 'margin-top:14px' },
      el('div', { class: 'card' }, el('h2', {}, `💡 Agent ideas (${ideas.length})`),
        ideas.length ? el('div', { class: 'ideas' }, ideas.map((p) => el('div', { class: 'idea-card' }, el('b', {}, '🤖 ' + p.data.idea.name),
          el('div', { class: 'small' }, '👥 ' + p.data.idea.audience), el('div', { class: 'small' }, '❓ ' + p.data.idea.problem),
          el('div', { class: 'small' }, '📚 ' + p.data.idea.source), el('div', { class: 'small' }, '⚡ ' + p.data.idea.action),
          el('div', { class: 'muted small', style: 'margin-top:6px' }, '— ' + p.name)))) : el('p', { class: 'muted' }, 'No ideas yet.')),
      el('div', { class: 'card' }, el('h2', {}, `⭐ Feedback (${avgStars}${fb.length ? ' ★' : ''})`),
        comments.length ? comments.map((p) => el('div', { class: 'fb-item' }, '★'.repeat(p.data.feedback.stars) + ' ', p.data.feedback.text, el('span', { class: 'muted small' }, ' — ' + p.name))) : el('p', { class: 'muted' }, 'No comments yet.'))));
    schedule();
  }
  const kpi = (v, l) => el('div', { class: 'kpi' }, el('div', { class: 'v' }, String(v)), el('div', { class: 'l' }, l));

  function exportCsv(s, A) {
    const topicIds = config.levels.map((l) => l.id);
    const safe = (v) => { let x = v == null ? '' : String(v); if (/^[=+\-@\t\r]/.test(x)) x = "'" + x; return '"' + x.replace(/"/g, '""') + '"'; };
    const head = ['nickname', 'language', 'levels_done', 'xp', 'understanding_pct', ...topicIds.map((id) => 'topic_' + id + '_pct'), 'missed_questions', 'idea_name', 'idea_audience', 'idea_problem', 'idea_source', 'idea_action', 'feedback_stars', 'feedback_text', 'last_update'];
    const lines = [head.join(',')];
    for (const p of A.people) {
      const t = p.data.topics || {}; const i = p.data.idea || {}; const f = p.data.feedback || {};
      lines.push([p.name, p.lang, p.data.done || 0, p.data.xp || 0, p.overall ?? '', ...topicIds.map((id) => (t[id] ? Math.round((t[id].s / t[id].m) * 100) : '')),
        (p.data.missed || []).map(questionText).join(' | '), i.name, i.audience, i.problem, i.source, i.action, f.stars || '', f.text || '', p.updated].map(safe).join(','));
    }
    const blob = new Blob(['\ufeff' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = el('a', { href: URL.createObjectURL(blob), download: `quest-results-${s.code}-${new Date().toISOString().slice(0, 10)}.csv` });
    document.body.append(a); a.click(); a.remove();
    toast('⬇️ CSV downloaded');
  }

  // ---------- boot ----------
  (async () => {
    try { await loadContent(); } catch { clear(root); root.append(el('div', { class: 'card' }, '⚠️ Could not load the quest content.')); return; }
    if (!key) return renderLogin();
    try { await refreshOverview(); render(); }
    catch (e) { renderLogin(e.status === 401 ? null : '⚠️ ' + explain(e)); }
  })();
})();
