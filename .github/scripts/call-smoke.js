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
    browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
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
    await sp.fill('#join-name', 'Smoke test');
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
