// Creates a lesson from a JSON spec (.github/scripts/lessons/<name>.json) in
// the account's company, through the public API. Safe by default: an existing
// lesson with the same title is left as it is unless FORCE=true (which
// replaces its blocks — never do that to a lesson that already has answers
// without the owner's say-so).
//
// env: API, TOKEN (user access token), SPEC (file name without .json), FORCE
const fs = require('fs');
const path = require('path');
const { API, TOKEN, SPEC, FORCE } = process.env;
const api = async (p, init = {}) => {
  const res = await fetch(API + p, {
    ...init,
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + TOKEN, ...(init.headers || {}) },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${init.method || 'GET'} ${p} → ${res.status} ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
};
(async () => {
  if (!/^[\w-]+$/.test(SPEC || '')) throw new Error('SPEC must be a file name like aitu-sunday-open');
  const spec = JSON.parse(fs.readFileSync(path.join(__dirname, 'lessons', SPEC + '.json'), 'utf8'));
  const list = await api('/lessons');
  const lessons = Array.isArray(list) ? list : list.items;
  let lesson = lessons.find((l) => l.title === spec.title && !l.archived);
  if (lesson) {
    const detail = await api(`/lessons/${lesson.id}`);
    const have = (detail.blocks || []).length;
    if (have > 0 && FORCE !== 'true') {
      console.log(`lesson already exists with ${have} blocks — left as it is`);
      return;
    }
  } else {
    lesson = await api('/lessons', { method: 'POST', body: JSON.stringify({ title: spec.title, category: spec.category }) });
    console.log('lesson created');
  }
  const saved = await api(`/lessons/${lesson.id}/blocks`, { method: 'PUT', body: JSON.stringify({ blocks: spec.blocks }) });
  const blocks = Array.isArray(saved) ? saved : saved.blocks || [];
  const sections = blocks.filter((b) => b.blockRole === 'section').length;
  console.log(`blocks saved: ${blocks.length} · sections: ${sections} · category: ${spec.category}`);
})().catch((e) => { console.error('✗ FAIL ' + e.message); process.exit(1); });
