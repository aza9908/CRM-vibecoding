// Load test against the deployed LMS, from the public internet: N people join
// one live session at the same moment from ONE IP address (like a classroom
// on one Wi-Fi), the teacher moves the focus, everyone answers, presses 👍,
// a timer runs out, the teacher removes one person, the lesson media is
// downloaded by everyone at once and a dozen real browsers open the lesson.
// Uses a service lesson (archived afterwards) — never a real class.
//
// env: API (https://lms-api…), WEB (https://airl.kz/lms), TOKEN (user access token),
//      N (participants, default 60), BROWSERS (real browsers, default 12)
const { io } = require('socket.io-client');
const { chromium } = require('playwright');
const { randomUUID } = require('crypto');
const { API, WEB, TOKEN } = process.env;
const N = Number(process.env.N || 60);
const BROWSERS = Number(process.env.BROWSERS || 12);
let fails = 0;
const ok = (c, m) => { console.log(c ? '✓' : '✗ FAIL', m); if (!c) fails++; };
const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * p))] : 0; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const req = async (path, init = {}, token = TOKEN) => {
  const res = await fetch(API + path, {
    ...init,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}), ...(init.headers || {}) },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${init.method || 'GET'} ${path} → ${res.status} ${text.slice(0, 120)}`);
  return text ? JSON.parse(text) : null;
};
const until = async (cond, ms) => { const t = Date.now(); while (Date.now() - t < ms) { if (cond()) return true; await sleep(100); } return cond(); };
const connect = (token) => new Promise((resolve, reject) => {
  // API may live under a path (https://airl.kz/lms-api): Socket.IO takes the path of
  // its URL for the namespace, so the prefix goes into the Engine.IO path instead.
  const api = new URL(API);
  const s = io(api.origin + '/live', { path: api.pathname.replace(/\/+$/, '') + '/socket.io',
    auth: { token }, transports: ['websocket'], reconnection: true });
  const timer = setTimeout(() => reject(new Error('socket timeout')), 20000);
  s.once('connect', () => { clearTimeout(timer); resolve(s); });
  s.once('connect_error', (e) => { clearTimeout(timer); reject(e); });
});

(async () => {
  let lesson, session, browser;
  const sockets = [];
  try {
    // ── service lesson with answer blocks
    const TITLE = 'Нагрузочная проверка (авто)';
    const list = await req('/lessons');
    lesson = (Array.isArray(list) ? list : list.items).find((l) => l.title === TITLE)
      ?? (await req('/lessons', { method: 'POST', body: JSON.stringify({ title: TITLE, category: 'Служебное' }) }));
    const saved = await req(`/lessons/${lesson.id}/blocks`, { method: 'PUT', body: JSON.stringify({ blocks: [
      { type: 'text', blockRole: 'welcome', content: 'Приветствуем, {{name}}!\nНагрузочная проверка' },
      { type: 'input_text', content: 'Вопрос 1' },
      { type: 'input_text', content: 'Вопрос 2' },
      { type: 'checklist', content: 'Чеклист', options: { items: ['Пункт 1', 'Пункт 2', 'Пункт 3'] } },
      { type: 'input_select', content: 'Выбор', options: { choices: ['A', 'B', 'C'] } },
    ] }) });
    const blocks = Array.isArray(saved) ? saved : saved.blocks;
    const inputs = blocks.filter((b) => b.type !== 'text');
    session = await req('/sessions', { method: 'POST', body: JSON.stringify({ lessonId: lesson.id }) });
    ok(!!session.code, `service session ready · ${N} participants · ${BROWSERS} real browsers`);

    const teacher = await connect(TOKEN); sockets.push(teacher);
    teacher.emit('session:join', { sessionId: session.id });
    let pulse = null; teacher.on('pulse:state', (p) => { pulse = p; });
    let liveUpdates = 0; teacher.on('response:updated', () => { liveUpdates++; });

    // ── network baseline: one request at a time (round trip to the server)
    const rtt = [];
    for (let k = 0; k < 5; k++) { const a = Date.now(); await fetch(API + '/sessions/join', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: 'ZZZZZZ', name: 'x' }) }).then((r) => r.text()); rtt.push(Date.now() - a); }
    console.log(`· one request at a time from this machine: ${rtt.join(' / ')} ms`);

    // ── everyone joins in the same second, from one IP
    const t0 = Date.now(); const joinMs = []; const joinErr = [];
    const people = (await Promise.all(Array.from({ length: N }, async (_, i) => {
      const a = Date.now();
      try {
        const body = JSON.stringify({ code: session.code, name: `Участник ${i + 1}`, clientKey: randomUUID() });
        const r = await req('/sessions/join', { method: 'POST', body }, null);
        joinMs.push(Date.now() - a);
        return { i, token: r.participantToken, id: r.participantId, body };
      } catch (e) { joinErr.push(e.message); return null; }
    }))).filter(Boolean);
    ok(people.length === N, `${people.length}/${N} joined together in ${((Date.now() - t0) / 1000).toFixed(1)} s · p50 ${pct(joinMs, 0.5)} ms · p95 ${pct(joinMs, 0.95)} ms ${joinErr[0] || ''}`);
    // a retry after a "lost" response returns the same person, not a duplicate
    const again = await req('/sessions/join', { method: 'POST', body: people[0].body }, null);
    ok(again.participantId === people[0].id, 'retrying a join returns the same participant (no duplicate)');

    // ── live connections
    const t1 = Date.now();
    await Promise.all(people.map(async (p) => {
      p.s = await connect(p.token); sockets.push(p.s);
      p.focus = null; p.timer = null; p.removed = false;
      p.s.on('focus:changed', (x) => { p.focus = x.blockId; });
      p.s.on('timer:state', (x) => { p.timer = x; });
      p.s.on('participant:removed', (x) => { if (x.participantId === p.id) p.removed = true; });
      p.s.emit('session:join', { sessionId: session.id });
      p.state = await req(`/sessions/${session.id}`, {}, p.token);
    }));
    ok(people.every((p) => p.state && p.state.blocks.length === blocks.length), `${N} live connections + lesson loaded in ${((Date.now() - t1) / 1000).toFixed(1)} s`);
    await sleep(800);

    // ── teacher moves the focus: everyone follows
    for (const b of inputs) { teacher.emit('focus:set', { sessionId: session.id, blockId: b.id }); await sleep(300); }
    const last = inputs[inputs.length - 1].id;
    ok(await until(() => people.every((p) => p.focus === last), 8000), `focus reached all ${N}: ${people.filter((p) => p.focus === last).length}/${N}`);

    // ── everyone answers at once (live keystrokes + final save)
    const saveMs = []; let saveErr = 0;
    const t2 = Date.now();
    await Promise.all(people.map(async (p) => {
      for (const b of inputs) {
        const val = b.type === 'checklist' ? '[0,1,2]' : b.type === 'input_select' ? 'B' : `Ответ ${p.i + 1}: хочу собрать сервис записи клиентов`;
        for (let k = 1; k <= 4; k++) { p.s.emit('response:save', { sessionId: session.id, blockId: b.id, answerText: val.slice(0, Math.ceil((val.length * k) / 4)) }); await sleep(250); }
        const a = Date.now();
        try { await req(`/sessions/${session.id}/responses`, { method: 'POST', body: JSON.stringify({ blockId: b.id, answerText: val }) }, p.token); saveMs.push(Date.now() - a); }
        catch { saveErr++; }
      }
    }));
    const stored = await req(`/sessions/${session.id}/responses`);
    const rows = Array.isArray(stored) ? stored : (stored.items || stored.responses || []);
    ok(saveErr === 0 && rows.length >= N * inputs.length, `${rows.length}/${N * inputs.length} answers stored in ${((Date.now() - t2) / 1000).toFixed(0)} s · save p95 ${pct(saveMs, 0.95)} ms · errors ${saveErr}`);
    ok(liveUpdates > N * inputs.length, `teacher saw answers live: ${liveUpdates} updates`);

    // ── «Всё понятно?»: everyone presses 👍
    const started = await new Promise((r) => teacher.emit('pulse:start', { sessionId: session.id, question: '' }, r));
    ok(started && started.ok, 'class pulse started');
    await Promise.all(people.map((p) => new Promise((r) => p.s.emit('pulse:answer', { sessionId: session.id, value: 'yes' }, r))));
    ok(await until(() => pulse && pulse.answered >= N, 6000), `teacher sees ${pulse ? pulse.counts.yes : 0} × 👍 of ${N}`);
    await new Promise((r) => teacher.emit('pulse:close', { sessionId: session.id }, r));

    // ── timer runs out for everyone
    await req(`/sessions/${session.id}/timer`, { method: 'POST', body: JSON.stringify({ seconds: 2 }) });
    ok(await until(() => people.every((p) => p.timer && p.timer.endsAt), 5000), `timer reached all ${N}`);

    // ── the teacher removes one person
    const victim = people[N - 1];
    await req(`/sessions/${session.id}/participants/${victim.id}`, { method: 'DELETE' });
    ok(await until(() => victim.removed && !victim.s.connected, 5000), 'removed person was told and disconnected at once');
    let refused = false; try { await req(`/sessions/${session.id}`, {}, victim.token); } catch (e) { refused = /401/.test(e.message); }
    ok(refused, 'their old pass no longer works');
    const roster = await req(`/sessions/${session.id}/participants`);
    ok(roster.length === N - 1, `roster ${roster.length} (= ${N} − 1)`);
    ok(people.slice(0, N - 1).every((p) => p.s.connected), 'everyone else stayed connected');

    // ── everyone downloads the lesson media at the same time
    // Real file names come from the checkout (they carry content hashes).
    const dir = require('path').join(__dirname, '../../apps/web/public/workbook/aitu');
    const fs = require('fs');
    const slides = fs.readdirSync(dir).filter((f) => /\.w1280\.jpg$/.test(f)).slice(0, 3);
    const clip = fs.readdirSync(dir + '/video').find((f) => /^dwh\..*\.mp4$/.test(f));
    const files = [...slides, 'video/' + clip];
    const t3 = Date.now(); let bytes = 0; const mediaErr = [];
    await Promise.all(people.map(async (p) => {
      for (const f of files.slice(0, p.i < 20 ? files.length : files.length - 1)) {
        try { const r = await fetch(`${WEB}/workbook/aitu/${f}`); if (!r.ok) throw new Error(r.status + ' ' + f); const n = (await r.arrayBuffer()).byteLength; bytes += n; }
        catch (e) { mediaErr.push(e.message); }
      }
    }));
    const secs = (Date.now() - t3) / 1000;
    ok(mediaErr.length === 0, `media burst: ${(bytes / 1e6).toFixed(0)} MB to ${N} people in ${secs.toFixed(1)} s (${((bytes * 8) / 1e6 / secs).toFixed(0)} Mbit/s) ${mediaErr[0] || ''}`);

    // ── real browsers open the lesson together
    browser = await chromium.launch();
    const t4 = Date.now(); const pageMs = []; const pageErr = [];
    await Promise.all(Array.from({ length: BROWSERS }, async (_, i) => {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
      const pg = await ctx.newPage();
      pg.on('pageerror', (e) => pageErr.push(e.message));
      const a = Date.now();
      try {
        await pg.goto(`${WEB}/join`, { timeout: 60000 });
        await pg.fill('#join-code', session.code);
        await pg.fill('#join-name', `Браузер ${i + 1}`); await pg.fill('#join-phone', '+7 700 000 00 00'); await pg.fill('#join-company', 'AIRL (тест)'); await pg.fill('#join-position', 'Проверка');
        await pg.click('button[type=submit]');
        await pg.waitForURL(/\/live\//, { timeout: 60000 });
        await pg.locator('[data-welcome]').waitFor({ timeout: 60000 });
        pageMs.push(Date.now() - a);
      } catch (e) { pageErr.push(e.message.split('\n')[0]); }
    }));
    ok(pageMs.length === BROWSERS && pageErr.length === 0, `${pageMs.length}/${BROWSERS} browsers in the lesson in ${((Date.now() - t4) / 1000).toFixed(1)} s · p95 ${pct(pageMs, 0.95)} ms ${pageErr[0] || ''}`);

    // ── still healthy
    const me = await req('/auth/me');
    ok(!!me, 'API healthy after the load');
  } catch (err) {
    ok(false, 'error: ' + (err && err.message ? err.message.split('\n')[0] : String(err)));
  } finally {
    for (const s of sockets) s.close();
    await browser?.close().catch(() => undefined);
    if (session) await req(`/sessions/${session.id}/end`, { method: 'POST' }).then(() => console.log('· session ended')).catch((e) => console.log('· cleanup: ' + e.message));
    if (lesson) await req(`/lessons/${lesson.id}`, { method: 'PATCH', body: JSON.stringify({ archived: true, category: 'Служебное' }) }).then(() => console.log('· service lesson archived')).catch((e) => console.log('· cleanup: ' + e.message));
  }
  console.log(fails ? `FAILED: ${fails}` : 'LOAD TEST PASSED');
  process.exit(fails ? 1 : 0);
})();
