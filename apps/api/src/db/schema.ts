// apps/api/src/db/schema.ts
import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  boolean,
  jsonb,
  pgEnum,
  uniqueIndex,
  index,
  primaryKey,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

// ── enums ─────────────────────────────────────────────
export const userRole = pgEnum('user_role', [
  'student',
  'teacher',
  'admin',
  'team_lead',
]);
export const lessonType = pgEnum('lesson_type', ['video', 'stream', 'text']);
export const sessionStatus = pgEnum('session_status', [
  'scheduled',
  'live',
  'ended',
]);
export const blockType = pgEnum('block_type', [
  'text',
  'image',
  'input_text',
  'input_select',
  'input_rating',
  'action_button',
  'input_file',
  'test',
]);
export const progressStatus = pgEnum('progress_status', [
  'started',
  'completed',
]);
// Kind of attachable material. We deliberately keep this minimal: a `file`
// lives in the private `course-materials/` S3 bucket (url = S3 key), a `link`
// is an external web URL (url = href) served as-is.
export const materialType = pgEnum('material_type', ['file', 'link']);

// ── мультитенантность ─────────────────────────────────
export const organizations = pgTable('organizations', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
});

export const users = pgTable(
  'users',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: uuid('organization_id').references(() => organizations.id, {
      onDelete: 'cascade',
    }),
    email: text('email').notNull(),
    passwordHash: text('password_hash'), // argon2; null если только OAuth
    fullName: text('full_name'),
    avatarUrl: text('avatar_url'),
    role: userRole('role').notNull().default('student'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  },
  (t) => ({
    emailIdx: uniqueIndex('users_email_idx').on(t.email),
    orgIdx: index('users_org_idx').on(t.organizationId),
  }),
);

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
  courseId: uuid('course_id').references(() => courses.id, {
    onDelete: 'cascade',
  }),
  title: text('title').notNull(),
  code: text('code'), // 'M1', 'M2', 'M3'
  order: integer('order').notNull().default(0),
});

export const lessons = pgTable(
  'lessons',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    // Direct tenant owner. A lesson belongs to an org regardless of whether it
    // is attached to a module yet (the editor creates module-less lessons), so
    // scoping goes through this column — never through module → course.
    organizationId: uuid('organization_id').references(() => organizations.id, {
      onDelete: 'cascade',
    }),
    moduleId: uuid('module_id').references(() => modules.id, {
      onDelete: 'set null',
    }),
    teacherId: uuid('teacher_id').references(() => users.id),
    title: text('title').notNull(),
    type: lessonType('type').notNull().default('stream'),
    contentUrl: text('content_url'),
    order: integer('order').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  },
  (t) => ({
    orgIdx: index('lessons_org_idx').on(t.organizationId),
    moduleIdx: index('lessons_module_idx').on(t.moduleId),
    teacherIdx: index('lessons_teacher_idx').on(t.teacherId),
  }),
);

export const lessonOutcomes = pgTable('lesson_outcomes', {
  id: uuid('id').defaultRandom().primaryKey(),
  lessonId: uuid('lesson_id').references(() => lessons.id, {
    onDelete: 'cascade',
  }),
  title: text('title').notNull(),
});

export const lessonBlocks = pgTable(
  'lesson_blocks',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    lessonId: uuid('lesson_id').references(() => lessons.id, {
      onDelete: 'cascade',
    }),
    type: blockType('type').notNull(),
    content: text('content'),
    imageUrl: text('image_url'),
    options: jsonb('options'), // {items:[...], correct:[...]} для test/select
    orderIndex: integer('order_index').notNull().default(0),
    outcomeId: uuid('outcome_id').references(() => lessonOutcomes.id, {
      onDelete: 'set null',
    }),
    blockRole: text('block_role'), // 'system'|'agenda'|'intro'|'reflection'
    generatedBy: text('generated_by').default('manual'), // 'manual'|'ai'
  },
  (t) => ({
    lessonIdx: index('blocks_lesson_idx').on(t.lessonId, t.orderIndex),
  }),
);

// ── live-сессии и участники ───────────────────────────
export const liveSessions = pgTable(
  'live_sessions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    lessonId: uuid('lesson_id').references(() => lessons.id),
    organizationId: uuid('organization_id').references(() => organizations.id),
    code: text('code').notNull(), // 6-значный код входа
    status: sessionStatus('status').notNull().default('scheduled'),
    focusedBlockId: uuid('focused_block_id'), // что «фокусит» учитель
    startTime: timestamp('start_time', { withTimezone: true }),
    endTime: timestamp('end_time', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  },
  (t) => ({
    // частичный уникальный индекс: код уникален только среди ЖИВЫХ сессий
    codeLiveIdx: uniqueIndex('sessions_code_live_idx')
      .on(t.code)
      .where(sql`status = 'live'`),
  }),
);

export const participants = pgTable(
  'participants',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    sessionId: uuid('session_id').references(() => liveSessions.id, {
      onDelete: 'cascade',
    }),
    userId: uuid('user_id').references(() => users.id), // null если гость по коду
    name: text('name').notNull(),
    attendance: boolean('attendance').default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  },
  (t) => ({
    sessionIdx: index('participants_session_idx').on(t.sessionId),
  }),
);

export const responses = pgTable(
  'responses',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    participantId: uuid('participant_id').references(() => participants.id, {
      onDelete: 'cascade',
    }),
    blockId: uuid('block_id').references(() => lessonBlocks.id, {
      onDelete: 'cascade',
    }),
    answerText: text('answer_text'),
    isCompleted: boolean('is_completed').default(false),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  },
  (t) => ({
    uniq: uniqueIndex('responses_participant_block_idx').on(
      t.participantId,
      t.blockId,
    ),
  }),
);

// ── прогресс и ИИ ─────────────────────────────────────
export const userProgress = pgTable(
  'user_progress',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id').references(() => users.id, {
      onDelete: 'cascade',
    }),
    lessonId: uuid('lesson_id').references(() => lessons.id, {
      onDelete: 'cascade',
    }),
    status: progressStatus('status').notNull().default('started'),
    // Persisted lesson-summary fields (docs/08). The DB enum stays 2-valued
    // ('started'|'completed'); the API maps no-row → not_started,
    // 'started' → in_progress, 'completed' → completed for the view layer.
    progressPercent: integer('progress_percent').notNull().default(0),
    lastAccessedAt: timestamp('last_accessed_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (t) => ({
    uniq: uniqueIndex('progress_user_lesson_idx').on(t.userId, t.lessonId),
  }),
);

export const aiChats = pgTable('ai_chats', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
  lessonId: uuid('lesson_id').references(() => lessons.id, {
    onDelete: 'set null',
  }),
  messages: jsonb('messages').notNull().default('[]'), // [{role, content}]
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
});

// ── материалы (docs/07) ───────────────────────────────
// Один материал может быть привязан к нескольким урокам (many-to-many через
// lesson_materials). Скоуп тенанта — прямой organization_id.
export const courseMaterials = pgTable(
  'course_materials',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: uuid('organization_id')
      .references(() => organizations.id, { onDelete: 'cascade' })
      .notNull(),
    createdBy: uuid('created_by').references(() => users.id),
    title: text('title').notNull(),
    type: materialType('type').notNull(),
    url: text('url').notNull(), // S3-ключ (file) или web-URL (link)
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  },
  (t) => ({
    orgIdx: index('materials_org_idx').on(t.organizationId),
  }),
);

export const lessonMaterials = pgTable(
  'lesson_materials',
  {
    lessonId: uuid('lesson_id')
      .references(() => lessons.id, { onDelete: 'cascade' })
      .notNull(),
    materialId: uuid('material_id')
      .references(() => courseMaterials.id, { onDelete: 'cascade' })
      .notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.lessonId, t.materialId] }),
  }),
);

// ── заметки ученика по уроку (docs/08) ────────────────
export const lessonNotes = pgTable(
  'lesson_notes',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    lessonId: uuid('lesson_id')
      .references(() => lessons.id, { onDelete: 'cascade' })
      .notNull(),
    content: text('content').notNull().default(''),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
  },
  (t) => ({
    uniq: uniqueIndex('notes_user_lesson_idx').on(t.userId, t.lessonId),
  }),
);

// ── журнал активности (docs/09 — аналитика) ───────────
export const activityLogs = pgTable(
  'activity_logs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: uuid('organization_id')
      .references(() => organizations.id, { onDelete: 'cascade' })
      .notNull(),
    userId: uuid('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    action: text('action').notNull(), // 'lesson_started' | 'lesson_completed' | 'session_joined' | ...
    lessonId: uuid('lesson_id').references(() => lessons.id, {
      onDelete: 'set null',
    }),
    metadata: jsonb('metadata'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  },
  (t) => ({
    orgCreatedIdx: index('activity_org_created_idx').on(
      t.organizationId,
      t.createdAt,
    ),
  }),
);

// ── barrel для drizzle query API ──────────────────────
export const schema = {
  // enums
  userRole,
  lessonType,
  sessionStatus,
  blockType,
  progressStatus,
  materialType,
  // tables
  organizations,
  users,
  courses,
  modules,
  lessons,
  lessonOutcomes,
  lessonBlocks,
  liveSessions,
  participants,
  responses,
  userProgress,
  aiChats,
  courseMaterials,
  lessonMaterials,
  lessonNotes,
  activityLogs,
};
