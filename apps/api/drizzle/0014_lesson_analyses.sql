-- «ИИ-разбор урока»: AI analyses of recorded lessons.
-- Idempotent (the deploy workflow may apply it more than once).
CREATE TABLE IF NOT EXISTS "lesson_analyses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"lesson_id" uuid,
	"organization_id" uuid,
	"recording_id" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"progress" integer DEFAULT 0 NOT NULL,
	"stage" text DEFAULT 'queued' NOT NULL,
	"title" text NOT NULL,
	"locale" text DEFAULT 'ru' NOT NULL,
	"duration_sec" integer,
	"transcript" text,
	"report" jsonb,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "lesson_analyses" ADD CONSTRAINT "lesson_analyses_session_id_live_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."live_sessions"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "lesson_analyses" ADD CONSTRAINT "lesson_analyses_lesson_id_lessons_id_fk" FOREIGN KEY ("lesson_id") REFERENCES "public"."lessons"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "lesson_analyses" ADD CONSTRAINT "lesson_analyses_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "lesson_analyses_recording_idx" ON "lesson_analyses" USING btree ("recording_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "lesson_analyses_session_idx" ON "lesson_analyses" USING btree ("session_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "lesson_analyses_lesson_idx" ON "lesson_analyses" USING btree ("lesson_id","created_at");