// Runs INSIDE the API container (stdin → `node -`): exports everything about
// the sessions of one lesson — participants with their registration profile,
// every answer, class pulse checks — as JSON on stdout. The workflow encrypts
// it before anything reaches the (public) log. Scoped to the organization of
// the account whose e-mail hash is given.
//
// env: EMAIL_SHA256, LESSON_MATCH (case-insensitive part of the lesson title)
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const q = (sql, args) => pool.query(sql, args).then((r) => r.rows);
(async () => {
  const eh = process.env.EMAIL_SHA256;
  const match = process.env.LESSON_MATCH;
  const [me] = await q(
    "select organization_id from users where encode(sha256(lower(email)::bytea), 'hex') = $1",
    [eh],
  );
  if (!me) throw new Error('account not found');
  const lessons = await q(
    'select id, title from lessons where organization_id = $1 and title ilike $2',
    [me.organization_id, '%' + match + '%'],
  );
  const out = { lessons: [] };
  for (const l of lessons) {
    const blocks = await q(
      'select id, type, content, block_role, order_index, options from lesson_blocks where lesson_id = $1 order by order_index',
      [l.id],
    );
    const sessions = await q(
      'select id, code, status, start_time, end_time, created_at from live_sessions where lesson_id = $1 order by created_at',
      [l.id],
    );
    for (const s of sessions) {
      s.participants = await q(
        `select p.id, p.name, p.created_at, p.removed_at, p.user_id, p.client_key is not null as has_device_key,
                u.email, u.full_name, u.occupation, o.name as company
           from participants p
           left join users u on u.id = p.user_id
           left join organizations o on o.id = u.organization_id
          where p.session_id = $1 order by p.created_at`,
        [s.id],
      );
      s.responses = await q(
        `select r.participant_id, r.block_id, r.answer_text, r.is_completed, r.updated_at
           from responses r join participants p on p.id = r.participant_id
          where p.session_id = $1`,
        [s.id],
      );
      s.pulses = await q(
        'select question, started_at, closed_at, eligible, answered, understanding, answers, pending from pulse_checks where session_id = $1 order by started_at',
        [s.id],
      );
    }
    out.lessons.push({ id: l.id, title: l.title, blocks, sessions });
  }
  process.stdout.write(JSON.stringify(out));
  await pool.end();
})().catch((e) => {
  console.error('export error: ' + e.message);
  process.exit(1);
});
