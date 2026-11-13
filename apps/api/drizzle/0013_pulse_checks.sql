-- «Пульс класса»: closed understanding checks of live sessions.
-- Idempotent (the deploy workflow may apply it more than once).
CREATE TABLE IF NOT EXISTS "pulse_checks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"organization_id" uuid,
	"question" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"closed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"eligible" integer DEFAULT 0 NOT NULL,
	"answered" integer DEFAULT 0 NOT NULL,
	"understanding" integer DEFAULT 0 NOT NULL,
	"answers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"pending" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pulse_checks" ADD CONSTRAINT "pulse_checks_session_id_live_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."live_sessions"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "pulse_checks" ADD CONSTRAINT "pulse_checks_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "pulse_checks_session_idx" ON "pulse_checks" USING btree ("session_id");
