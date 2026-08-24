-- Company promo codes + program schedule (timeline shown in личный кабинет).
--
-- Hand-written rather than generated, for the same reason as 0004: the
-- deployed database has drifted from the drizzle snapshots (0004 has no
-- snapshot of its own, and `password_reset_tokens` was created by
-- `sql/password_reset_tokens.sql` outside the journal). Every statement below
-- is therefore guarded so this file is safe to re-run and safe to apply to a
-- database that already has some of these objects.

-- ── roles that may author the program: curator + methodist ────────────────
-- Today an admin builds the program and its schedule; these two roles let
-- that work be handed over without granting user management. ADD VALUE cannot
-- be used in the same transaction that adds it, and we do not use it here.
ALTER TYPE "user_role" ADD VALUE IF NOT EXISTS 'curator';
--> statement-breakpoint
ALTER TYPE "user_role" ADD VALUE IF NOT EXISTS 'methodist';
--> statement-breakpoint

-- ── kind of entry on the study timeline ───────────────────────────────────
DO $$ BEGIN
  CREATE TYPE "schedule_event_type" AS ENUM ('lesson', 'qa', 'demo_day', 'workshop', 'other');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint

-- ── promo codes: how a user gets attached to a company ────────────────────
-- `code` is globally unique, not unique per org: registration submits it with
-- no tenant context, so it has to identify exactly one company.
CREATE TABLE IF NOT EXISTS "promo_codes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "code" text NOT NULL,
  "label" text,
  "is_active" boolean DEFAULT true NOT NULL,
  "max_uses" integer,
  "uses_count" integer DEFAULT 0 NOT NULL,
  "expires_at" timestamp with time zone,
  "created_by" uuid,
  "created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "promo_codes"
    ADD CONSTRAINT "promo_codes_organization_id_organizations_id_fk"
    FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id")
    ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "promo_codes_code_idx" ON "promo_codes" ("code");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "promo_codes_org_idx" ON "promo_codes" ("organization_id");
--> statement-breakpoint

-- Which code an account came in through. Informational only — tenant scoping
-- still reads `users.organization_id`.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "promo_code_id" uuid;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "users"
    ADD CONSTRAINT "users_promo_code_id_promo_codes_id_fk"
    FOREIGN KEY ("promo_code_id") REFERENCES "public"."promo_codes"("id")
    ON DELETE set null ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint

-- ── study schedule: first lesson → every Q&A → Demo day ───────────────────
CREATE TABLE IF NOT EXISTS "schedule_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL,
  "lesson_id" uuid,
  "title" text NOT NULL,
  "type" "schedule_event_type" DEFAULT 'lesson' NOT NULL,
  "starts_at" timestamp with time zone NOT NULL,
  "ends_at" timestamp with time zone,
  "description" text,
  "location" text,
  "meeting_url" text,
  "created_by" uuid,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "schedule_events"
    ADD CONSTRAINT "schedule_events_organization_id_organizations_id_fk"
    FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id")
    ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "schedule_events"
    ADD CONSTRAINT "schedule_events_lesson_id_lessons_id_fk"
    FOREIGN KEY ("lesson_id") REFERENCES "public"."lessons"("id")
    ON DELETE set null ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint

DO $$ BEGIN
  ALTER TABLE "schedule_events"
    ADD CONSTRAINT "schedule_events_created_by_users_id_fk"
    FOREIGN KEY ("created_by") REFERENCES "public"."users"("id")
    ON DELETE set null ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "schedule_org_starts_idx" ON "schedule_events" ("organization_id", "starts_at");
--> statement-breakpoint

-- ── backfill: every existing company gets one code ────────────────────────
-- Without this, `POST /auth/register` (which now requires a valid code) would
-- lock out every company created before this migration. The value is derived
-- from the organization id so re-running produces the same code, and the
-- hex→letter mapping keeps it inside the unambiguous alphabet used for
-- session codes and temporary passwords (no O/0, no I/1/L).
INSERT INTO "promo_codes" ("organization_id", "code", "label")
SELECT
  o."id",
  translate(substr(md5(o."id"::text), 1, 8), '0123456789abcdef', 'ABCDEFGHJKMNPQRS'),
  'Создан автоматически при миграции'
FROM "organizations" o
WHERE NOT EXISTS (
  SELECT 1 FROM "promo_codes" p WHERE p."organization_id" = o."id"
)
ON CONFLICT ("code") DO NOTHING;
