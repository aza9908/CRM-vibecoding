// End-to-end check of the video call against a deployed LMS, from the public
// internet: a teacher starts a call in a throw-away lesson, a student joins by
// code and must receive the teacher's video and audio through the media
// server. Cleans up after itself (session ended, lesson archived).
//
// env: API (https://lms-api…), WEB (https://airl.kz/lms), TOKEN (user access token)
const { chromium } = require('playwright');
const { API, WEB, TOKEN } = process.env;
let fails = 0;
const ok = (c, m) => { console.log(c ? '✓' : '✗ FAIL', m); if (!c) fails++; };
const api = async (path, init = {}) => {
  const res = await fetch(API + path, {
    ...init,
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + TOKEN, ...(init.headers || {}) },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${init.method || 'GET'} ${path} → ${res.status} ${text.slice(0, 120)}`);
  return text ? JSON.parse(text) : null;
};
(async () => {
  let lesson, session, browser;
  try {
    const me = await api('/auth/me');
    // One reusable service lesson (kept archived between runs).
    const TITLE = 'Проверка видеосвязи (авто)';
    const list = await api('/lessons');
    lesson = (Array.isArray(list) ? list : list.items).find((l) => l.title === TITLE)
      ?? (await api('/lessons', { method: 'POST', body: JSON.stringify({ title: TITLE }) }));
    session = await api('/sessions', { method: 'POST', body: JSON.stringify({ lessonId: lesson.id }) });
    ok(!!session.code, 'service lesson + live session ready');
    browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required', '--auto-select-desktop-capture-source=Entire screen', '--enable-usermedia-screen-capturing'] });
    const tctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await tctx.addInitScript(([token, user]) => {
      localStorage.setItem('lms-auth', JSON.stringify({ state: { accessToken: token, refreshToken: null, user, participantToken: null, sessionId: null }, version: 0 }));
    }, [TOKEN, me.user ?? me]);
    const tp = await tctx.newPage();
    await tp.goto(`${WEB}/teacher/live/${session.id}`);
    await tp.getByRole('button', { name: /Начать видеосвязь|Вернуться в видеосвязь/ }).first().click({ timeout: 30000 });
    await tp.getByRole('button', { name: 'Войти в видеосвязь', exact: true }).click();
    await tp.getByText('Вы в эфире').waitFor({ timeout: 30000 });
    ok(true, 'teacher is in the call (camera + microphone)');

    const sp = await (await browser.newContext({ viewport: { width: 1300, height: 800 } })).newPage();
    await sp.goto(`${WEB}/join`);
    await sp.fill('#join-code', session.code);
    await sp.fill('#join-name', 'Smoke test'); await sp.fill('#join-phone', '+7 700 000 00 00'); await sp.fill('#join-company', 'AIRL (тест)'); await sp.fill('#join-position', 'Проверка');
    await sp.click('button[type=submit]');
    await sp.waitForURL(/\/live\//, { timeout: 30000 });
    await sp.getByText('Вы в эфире').waitFor({ timeout: 30000 });
    ok(true, 'student auto-joined the running call');
    const recv = () => sp.evaluate(() => ({
      v: [...document.querySelectorAll('#video-room video')].filter((v) => v.videoWidth > 0).length,
      a: [...document.querySelectorAll('audio[data-peer-audio]')].filter((a) => a.srcObject && a.srcObject.getAudioTracks().some((t) => t.readyState === 'live')).length,
    }));
    let r = { v: 0, a: 0 };
    for (let i = 0; i < 60 && !(r.v > 0 && r.a > 0); i++) { await sp.waitForTimeout(500); r = await recv(); }
    ok(r.v > 0 && r.a > 0, `student receives the teacher's video (${r.v}) and audio (${r.a}) through the media server`);
    // Frames really advance (media flows, not just a first frame).
    const t1 = await sp.evaluate(() => [...document.querySelectorAll('#video-room video')].map((v) => v.currentTime));
    await sp.waitForTimeout(3000);
    const t2 = await sp.evaluate(() => [...document.querySelectorAll('#video-room video')].map((v) => v.currentTime));
    ok(t2.some((t, i) => t > (t1[i] ?? 0) + 1), 'video keeps playing for 3 s');

    // Screen sharing: the teacher shares, the student must receive it as a
    // second video next to the camera.
    {
      const liveVideos = () => sp.evaluate(() => [...document.querySelectorAll('#video-room video')].filter((v) => v.videoWidth > 0).length);
      const before = await liveVideos();
      // The screen also takes over the stage, so look for a video whose
      // stream carries the screen track (a second stream from the teacher).
      const screenSeen = async () => sp.evaluate(() => {
        return [...new Set([...document.querySelectorAll('#video-room video')].filter((v) => v.videoWidth > 0 && v.srcObject).map((v) => v.srcObject.id))];
      });
      const streamsBefore = await screenSeen();
      await tp.locator('#video-room button[aria-label="Показать экран"]').first().click({ timeout: 15000 });
      const started = await tp.locator('#video-room button[aria-label="Остановить показ экрана"]').first().waitFor({ timeout: 20000 }).then(() => true).catch(() => false);
      const toast = started ? '' : (await tp.locator('[role=status],[role=alert]').allInnerTexts().catch(() => [])).join(' | ');
      ok(started, 'teacher starts screen sharing' + (toast ? ' · ' + toast.slice(0, 160) : ''));
      let videos = 0;
      let streams = streamsBefore;
      for (let i = 0; i < 40; i++) {
        videos = await liveVideos();
        streams = await screenSeen();
        if (streams.some((id) => !streamsBefore.includes(id))) break;
        await sp.waitForTimeout(500);
      }
      const fresh = streams.filter((id) => !streamsBefore.includes(id)).length;
      ok(fresh > 0, `student receives the shared screen as a new video stream (${fresh} new; videos ${before}→${videos})`);
      if (started) await tp.locator('#video-room button[aria-label="Остановить показ экрана"]').first().click().catch(() => undefined);
    }

    // Recording for YouTube goes through the server: pieces in, then the
    // server talks to YouTube itself. A fake Google token must come back as
    // «sign in again» — that proves the whole path up to YouTube works.
    {
      const rec = await api(`/sessions/${session.id}/recordings`, { method: 'POST', body: JSON.stringify({ title: 'Проверка записи (авто)', mimeType: 'video/webm' }) });
      const piece = Buffer.alloc(1024 * 1024, 7);
      const put = await fetch(`${API}/recordings/${rec.id}/pieces?offset=0`, { method: 'PUT', headers: { authorization: 'Bearer ' + TOKEN, 'content-type': 'application/octet-stream' }, body: piece });
      const putJson = await put.json().catch(() => ({}));
      ok(put.ok && putJson.size === piece.length, `recording: 1 MB piece stored on the server (${put.status}, size ${putJson.size})`);
      await api(`/recordings/${rec.id}/complete`, { method: 'POST' });
      await api(`/recordings/${rec.id}/youtube`, { method: 'POST', body: JSON.stringify({ accessToken: 'ya29.not-a-real-token-smoke-test' }) });
      let st = null;
      for (let i = 0; i < 30; i++) { st = await api(`/recordings/${rec.id}`); if (st.status !== 'uploading') break; await new Promise((r) => setTimeout(r, 1000)); }
      ok(st && st.status === 'ready' && st.error === 'google_signin_expired', `recording: the server reached YouTube, which refused the fake token as expected (${st && st.status} · ${st && st.error})`);
      await api(`/recordings/${rec.id}`, { method: 'DELETE' }).catch(() => undefined);
    }

    // A whole class: PEERS more students join at once (all from this machine).
    const PEERS = Math.min(80, Number(process.env.PEERS || 0));
    if (PEERS > 0) {
      const t0 = Date.now();
      const crowd = [];
      const joinOne = async (i) => {
        const ctx = await browser.newContext({ viewport: { width: 640, height: 480 } });
        const p = await ctx.newPage();
        await p.goto(`${WEB}/join`, { timeout: 90000 });
        await p.fill('#join-code', session.code);
        await p.fill('#join-name', `Нагрузка ${i + 1}`); await p.fill('#join-phone', '+7 700 000 00 00'); await p.fill('#join-company', 'AIRL (тест)'); await p.fill('#join-position', 'Проверка');
        await p.click('button[type=submit]');
        await p.waitForURL(/\/live\//, { timeout: 90000 });
        await p.getByText('Вы в эфире').waitFor({ timeout: 120000 });
        crowd.push(p);
      };
      const results = await Promise.allSettled(Array.from({ length: PEERS }, (_, i) => joinOne(i)));
      const failed = results.filter((x) => x.status === 'rejected');
      ok(failed.length === 0, `${PEERS - failed.length}/${PEERS} more students are in the call (${((Date.now() - t0) / 1000).toFixed(0)} s)` + (failed.length ? ' · ' + String(failed[0].reason).split('\n')[0] : ''));
      const total = crowd.length + 2;
      const seen = async () => Number((await tp.locator('text=/Участников: \\d+/').first().textContent({ timeout: 5000 }).catch(() => '')).replace(/\D+/g, '')) || 0;
      let n = 0;
      for (let i = 0; i < 60 && n < total; i++) { n = await seen(); if (n < total) await tp.waitForTimeout(1000); }
      ok(n === total, `teacher sees everyone: «Участников: ${n}» (expected ${total})`);
      // Each student still gets the teacher's media.
      // track = the media server sends the teacher's video to this student;
      // decoded = this (shared, overloaded) test machine also drew a frame.
      const probe = (p) => p.evaluate(() => {
        const vids = [...document.querySelectorAll('#video-room video')];
        const track = vids.some((v) => v.srcObject && v.srcObject.getVideoTracks().some((t) => t.readyState === 'live' && !t.muted));
        const decoded = vids.some((v) => v.videoWidth > 0);
        const audio = [...document.querySelectorAll('audio[data-peer-audio]')].some((a) => a.srcObject && a.srcObject.getAudioTracks().some((t) => t.readyState === 'live'));
        return { track, decoded, audio };
      }).catch(() => ({ track: false, decoded: false, audio: false }));
      let st = [];
      for (let round = 0; round < 6; round++) {
        st = [];
        for (const p of crowd) st.push(await probe(p));
        if (st.every((x) => x.track && x.audio)) break;
        await tp.waitForTimeout(5000);
      }
      const tracks = st.filter((x) => x.track).length, audio = st.filter((x) => x.audio).length, dec = st.filter((x) => x.decoded).length;
      ok(tracks >= crowd.length - 1 && audio >= crowd.length - 1, `media server sends the teacher's video to ${tracks}/${crowd.length} and audio to ${audio}/${crowd.length} students (frames drawn on this test machine: ${dec})`);
      const load = require('os').loadavg()[0].toFixed(1);
      console.log(`· test machine: ${require('os').cpus().length} CPU, load ${load}`);
      // A reload in the middle of the lesson does not remove anyone.
      if (crowd[0]) {
        const reload = crowd[0].reload({ timeout: 90000 });
        let min = total;
        for (let i = 0; i < 12; i++) { min = Math.min(min, await seen()); await tp.waitForTimeout(500); }
        await reload;
        await crowd[0].getByText('Вы в эфире').waitFor({ timeout: 60000 });
        ok(min === total, `a student reloads: the teacher's count never drops (min ${min}/${total}), the student is back in the call`);
      }
      ok(await sp.getByText('Вы в эфире').count() > 0, 'the first student is still in the call');
    }
  } catch (err) {
    ok(false, 'error: ' + (err && err.message ? err.message.split('\n')[0] : String(err)));
  } finally {
    await browser?.close().catch(() => undefined);
    if (session) await api(`/sessions/${session.id}/end`, { method: 'POST' }).then(() => console.log('· session ended')).catch((e) => console.log('· cleanup: ' + e.message));
    // A lesson that had a session cannot be deleted (answers are kept) — archive it.
    if (lesson) await api(`/lessons/${lesson.id}`, { method: 'PATCH', body: JSON.stringify({ archived: true, category: 'Служебное' }) }).then(() => console.log('· temporary lesson archived')).catch((e) => console.log('· cleanup: ' + e.message));
  }
  console.log(fails ? `FAILED: ${fails}` : 'CALL SMOKE TEST PASSED');
  process.exit(fails ? 1 : 0);
})();
