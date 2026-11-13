// Checks the AI lesson review on a deployed LMS with the REAL speech-to-text
// and language model: uploads a tiny audio file as a recording of a service
// lesson, waits for the job and prints what came back. Cleans up after itself.
//
// env: API, TOKEN (user access token)
const fs = require('fs');
const path = require('path');
const { API, TOKEN } = process.env;
const api = async (p, init = {}) => {
  const res = await fetch(API + p, { ...init, headers: { authorization: 'Bearer ' + TOKEN, ...(init.headers || {}) } });
  const text = await res.text();
  if (!res.ok) throw new Error(`${init.method || 'GET'} ${p} → ${res.status} ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
};
const json = (body) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
(async () => {
  let lesson, session, failed = false;
  try {
    const TITLE = 'Проверка видеосвязи (авто)';
    const list = await api('/lessons');
    lesson = (Array.isArray(list) ? list : list.items).find((l) => l.title === TITLE)
      ?? (await api('/lessons', json({ title: TITLE })));
    session = await api('/sessions', json({ lessonId: lesson.id }));
    const audio = fs.readFileSync(path.join(__dirname, 'analysis-smoke.webm'));
    const recordingId = 'smoke-' + Date.now();
    const form = new FormData();
    form.append('recordingId', recordingId);
    form.append('seq', '0');
    form.append('file', new Blob([audio], { type: 'audio/webm' }), 'piece.webm');
    const up = await api(`/sessions/${session.id}/analysis/audio`, { method: 'POST', body: form });
    console.log('✓ audio accepted:', JSON.stringify(up));
    await api(`/sessions/${session.id}/analysis/finish`, json({ recordingId, title: 'Проверка ИИ-разбора', locale: 'ru', durationSec: 40 }));
    console.log('✓ analysis queued');
    let a = null, seen = new Set();
    for (let i = 0; i < 100; i++) {
      a = (await api(`/sessions/${session.id}/analysis`)).analysis;
      const key = a ? `${a.status}:${a.stage ?? ''}` : 'none';
      if (!seen.has(key)) { seen.add(key); console.log('  …', key, a?.progress ?? ''); }
      if (a && (a.status === 'done' || a.status === 'failed')) break;
      await new Promise((r) => setTimeout(r, 3000));
    }
    if (!a || a.status !== 'done') {
      failed = true;
      console.log('✗ FAIL analysis did not finish:', a ? `${a.status} · ${a.error ?? ''}` : 'no row');
    } else {
      console.log('✓ real transcription + model finished');
      console.log('  transcript chars:', (a.transcript ?? '').length, '· duration', a.durationSec);
      console.log('  summary:', String(a.report?.summary ?? '').slice(0, 300));
      console.log('  score:', JSON.stringify(a.report?.score ?? null));
      console.log('  strengths:', (a.report?.strengths ?? []).length, '· weaknesses:', (a.report?.weaknesses ?? []).length, '· recommendations:', (a.report?.recommendations ?? []).length);
    }
  } catch (err) {
    failed = true;
    console.log('✗ FAIL', err.message);
  } finally {
    if (session) await api(`/sessions/${session.id}/end`, { method: 'POST' }).catch(() => undefined);
    if (lesson) await api(`/lessons/${lesson.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ archived: true, category: 'Служебное' }) }).catch(() => undefined);
  }
  console.log(failed ? 'ANALYSIS SMOKE FAILED' : 'ANALYSIS SMOKE PASSED');
  process.exit(failed ? 1 : 0);
})();
