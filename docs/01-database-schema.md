# 01 — Схема базы данных (PostgreSQL + Drizzle)

> Замена модели Supabase на собственный Postgres с Drizzle ORM. Здесь — все таблицы, связи, индексы и RLS-эквивалент на уровне приложения.

## 1. Как сейчас (Supabase)

В текущем проекте схема живёт в `supabase/schema.sql` + 37 миграций. Ключевые таблицы:

- `organizations`, `profiles` (привязан к `auth.users`), `domains` — мультитенантность
- `courses` → `modules` → `lessons` → `lesson_blocks` — контент
- `lesson_outcomes` — учебные результаты, к ним привязаны блоки
- `live_sessions` (с полями `code`, `focused_block_id`, `status`) — live-сессии
- `students` (участники сессии, `user_id` → auth) и `responses` — ответы
- `user_progress`, `workbook_entries` — прогресс
- `ai_chats` — история диалогов с ИИ

Безопасность — через **RLS-политики Postgres** (Supabase их использует на уровне БД).

## 2. Что меняется на своём бэке

- `auth.users` Supabase → собственная таблица `users` (см. `02-auth-and-participants.md`).
- **RLS на уровне БД заменяем на проверки в сервисах NestJS** (гварды + scoping по `organizationId`). Это проще отлаживать и не привязывает к Postgres-фичам Supabase. (Опционально можно включить и Postgres RLS, но для своего бэка обычно достаточно application-level.)
- Схема описывается в Drizzle (`apps/api/src/db/schema.ts`), миграции — `drizzle-kit`.

## 3. Полная схема (Drizzle)

```ts
// apps/api/src/db/schema.ts
import {
  pgTable, uuid, text, timestamp, integer, boolean,
  jsonb, pgEnum, uniqueIndex, index,
} from 'drizzle-orm/pg-core';

// ── enums ─────────────────────────────────────────────
export const userRole = pgEnum('user_role', [
  'student', 'teacher', 'admin', 'team_lead',
]);
export const lessonType = pgEnum('lesson_type', ['video', 'stream', 'text']);
export const sessionStatus = pgEnum('session_status', ['scheduled', 'live', 'ended']);
export const blockType = pgEnum('block_type', [
  'text', 'image', 'input_text', 'input_select',
  'input_rating', 'action_button', 'input_file', 'test',
]);
export const progressStatus = pgEnum('progress_status', ['started', 'completed']);

// ── мультитенантность ─────────────────────────────────
export const organizations = pgTable('organizations', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  organizationId: uuid('organization_id').references(() => organizations.id, { onDelete: 'cascade' }),
  email: text('email').notNull(),
  passwordHash: text('password_hash'),          // argon2; null если только OAuth
  fullName: text('full_name'),
  avatarUrl: text('avatar_url'),
  role: userRole('role').notNull().default('student'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (t) => ({
  emailIdx: uniqueIndex('users_email_idx').on(t.email),
  orgIdx: index('users_org_idx').on(t.organizationId),
}));

// ── контент: курс → модуль → урок → блок ──────────────
export const courses = pgTable('courses', {
  id: uuid('id').defaultRandom().primaryKey(),
  organizationId: uuid('organization_id').references(() => organizations.id),
  title: text('title').notNull(),
  description: text('description'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

export const modules = pgTable('modules', {
  id: uuid('id').defaultRandom().primaryKey(),
  courseId: uuid('course_id').references(() => courses.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  code: text('code'),                            // 'M1', 'M2', 'M3'
  order: integer('order').notNull().default(0),
});

export const lessons = pgTable('lessons', {
  id: uuid('id').defaultRandom().primaryKey(),
  moduleId: uuid('module_id').references(() => modules.id, { onDelete: 'set null' }),
  teacherId: uuid('teacher_id').references(() => users.id),
  title: text('title').notNull(),
  type: lessonType('type').notNull().default('stream'),
  contentUrl: text('content_url'),
  order: integer('order').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (t) => ({
  moduleIdx: index('lessons_module_idx').on(t.moduleId),
  teacherIdx: index('lessons_teacher_idx').on(t.teacherId),
}));

export const lessonOutcomes = pgTable('lesson_outcomes', {
  id: uuid('id').defaultRandom().primaryKey(),
  lessonId: uuid('lesson_id').references(() => lessons.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
});

export const lessonBlocks = pgTable('lesson_blocks', {
  id: uuid('id').defaultRandom().primaryKey(),
  lessonId: uuid('lesson_id').references(() => lessons.id, { onDelete: 'cascade' }),
  type: blockType('type').notNull(),
  content: text('content'),
  imageUrl: text('image_url'),
  options: jsonb('options'),                     // {items:[...], correct:[...]} для test/select
  orderIndex: integer('order_index').notNull().default(0),
  outcomeId: uuid('outcome_id').references(() => lessonOutcomes.id, { onDelete: 'set null' }),
  blockRole: text('block_role'),                 // 'system'|'agenda'|'intro'|'reflection'
  generatedBy: text('generated_by').default('manual'), // 'manual'|'ai'
}, (t) => ({
  lessonIdx: index('blocks_lesson_idx').on(t.lessonId, t.orderIndex),
}));

// ── live-сессии и участники ───────────────────────────
export const liveSessions = pgTable('live_sessions', {
  id: uuid('id').defaultRandom().primaryKey(),
  lessonId: uuid('lesson_id').references(() => lessons.id),
  organizationId: uuid('organization_id').references(() => organizations.id),
  code: text('code').notNull(),                  // 6-значный код входа
  status: sessionStatus('status').notNull().default('scheduled'),
  focusedBlockId: uuid('focused_block_id'),      // что «фокусит» учитель
  startTime: timestamp('start_time', { withTimezone: true }),
  endTime: timestamp('end_time', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (t) => ({
  // частичный уникальный индекс: код уникален только среди ЖИВЫХ сессий
  codeLiveIdx: uniqueIndex('sessions_code_live_idx')
    .on(t.code).where(sql`status = 'live'`),
}));

export const participants = pgTable('participants', {
  id: uuid('id').defaultRandom().primaryKey(),
  sessionId: uuid('session_id').references(() => liveSessions.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').references(() => users.id),  // null если гость по коду
  name: text('name').notNull(),
  attendance: boolean('attendance').default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (t) => ({
  sessionIdx: index('participants_session_idx').on(t.sessionId),
}));

export const responses = pgTable('responses', {
  id: uuid('id').defaultRandom().primaryKey(),
  participantId: uuid('participant_id').references(() => participants.id, { onDelete: 'cascade' }),
  blockId: uuid('block_id').references(() => lessonBlocks.id, { onDelete: 'cascade' }),
  answerText: text('answer_text'),
  isCompleted: boolean('is_completed').default(false),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (t) => ({
  uniq: uniqueIndex('responses_participant_block_idx').on(t.participantId, t.blockId),
}));

// ── прогресс и ИИ ─────────────────────────────────────
export const userProgress = pgTable('user_progress', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
  lessonId: uuid('lesson_id').references(() => lessons.id, { onDelete: 'cascade' }),
  status: progressStatus('status').notNull().default('started'),
  completedAt: timestamp('completed_at', { withTimezone: true }),
}, (t) => ({
  uniq: uniqueIndex('progress_user_lesson_idx').on(t.userId, t.lessonId),
}));

export const aiChats = pgTable('ai_chats', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
  lessonId: uuid('lesson_id').references(() => lessons.id, { onDelete: 'set null' }),
  messages: jsonb('messages').notNull().default('[]'),  // [{role, content}]
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});
```

> `sql` импортируется из `drizzle-orm`. Частичный уникальный индекс по `code` гарантирует, что среди `status='live'` код не повторится, но переиспользуется после завершения сессии.

## 4. Индексы — что критично под нагрузку

| Таблица | Индекс | Зачем |
|---|---|---|
| `live_sessions` | `code` (partial, where live) | вход по коду — горячий путь |
| `participants` | `session_id` | список участников в live |
| `responses` | `(participant_id, block_id)` unique | upsert ответа |
| `lesson_blocks` | `(lesson_id, order_index)` | рендер тетради по порядку |
| `users` | `email` unique | вход |

## 5. Миграции через Drizzle

```jsonc
// drizzle.config.ts
export default {
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: { url: process.env.DATABASE_URL! },
};
```

```bash
pnpm drizzle-kit generate   # создать SQL-миграцию из изменений схемы
pnpm drizzle-kit migrate    # применить
```

## 6. Изоляция тенантов (замена RLS)

Поскольку RLS Supabase больше нет, **каждый сервисный метод обязан фильтровать по `organizationId`** из JWT. Паттерн:

```ts
// пример: получить уроки только своей организации
async findLessons(orgId: string) {
  return this.db.select().from(lessons)
    .innerJoin(modules, eq(lessons.moduleId, modules.id))
    .innerJoin(courses, eq(modules.courseId, courses.id))
    .where(eq(courses.organizationId, orgId));
}
```

Чтобы не забыть фильтр — заведи общий `TenantScopedRepository` или Nest-интерсептор, прокидывающий `orgId` из `request.user`. Это главный риск безопасности при отказе от RLS, поэтому вынеси его в один проверяемый слой.

## 7. Локальная БД для разработки

```yaml
# docker-compose.yml (фрагмент)
services:
  postgres:
    image: postgres:16
    environment:
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: lms
    ports: ["5432:5432"]
  redis:
    image: redis:7
    ports: ["6379:6379"]
  minio:
    image: minio/minio
    command: server /data --console-address ":9001"
    ports: ["9000:9000", "9001:9001"]
    environment:
      MINIO_ROOT_USER: minio
      MINIO_ROOT_PASSWORD: minio12345
```
