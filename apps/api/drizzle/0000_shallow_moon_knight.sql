CREATE TYPE "public"."block_type" AS ENUM('text', 'image', 'input_text', 'input_select', 'input_rating', 'action_button', 'input_file', 'test');--> statement-breakpoint
CREATE TYPE "public"."lesson_type" AS ENUM('video', 'stream', 'text');--> statement-breakpoint
CREATE TYPE "public"."progress_status" AS ENUM('started', 'completed');--> statement-breakpoint
CREATE TYPE "public"."session_status" AS ENUM('scheduled', 'live', 'ended');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('student', 'teacher', 'admin', 'team_lead');--> statement-breakpoint
CREATE TABLE "ai_chats" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"lesson_id" uuid,
	"messages" jsonb DEFAULT '[]' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "courses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid,
	"title" text NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "lesson_blocks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lesson_id" uuid,
	"type" "block_type" NOT NULL,
	"content" text,
	"image_url" text,
	"options" jsonb,
	"order_index" integer DEFAULT 0 NOT NULL,
	"outcome_id" uuid,
	"block_role" text,
	"generated_by" text DEFAULT 'manual'
);
--> statement-breakpoint
CREATE TABLE "lesson_outcomes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lesson_id" uuid,
	"title" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lessons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"module_id" uuid,
	"teacher_id" uuid,
	"title" text NOT NULL,
	"type" "lesson_type" DEFAULT 'stream' NOT NULL,
	"content_url" text,
	"order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "live_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lesson_id" uuid,
	"organization_id" uuid,
	"code" text NOT NULL,
	"status" "session_status" DEFAULT 'scheduled' NOT NULL,
	"focused_block_id" uuid,
	"start_time" timestamp with time zone,
	"end_time" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "modules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"course_id" uuid,
	"title" text NOT NULL,
	"code" text,
	"order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "participants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid,
	"user_id" uuid,
	"name" text NOT NULL,
	"attendance" boolean DEFAULT true,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "responses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"participant_id" uuid,
	"block_id" uuid,
	"answer_text" text,
	"is_completed" boolean DEFAULT false,
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "user_progress" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"lesson_id" uuid,
	"status" "progress_status" DEFAULT 'started' NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid,
	"email" text NOT NULL,
	"password_hash" text,
	"full_name" text,
	"avatar_url" text,
	"role" "user_role" DEFAULT 'student' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "ai_chats" ADD CONSTRAINT "ai_chats_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_chats" ADD CONSTRAINT "ai_chats_lesson_id_lessons_id_fk" FOREIGN KEY ("lesson_id") REFERENCES "public"."lessons"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "courses" ADD CONSTRAINT "courses_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_blocks" ADD CONSTRAINT "lesson_blocks_lesson_id_lessons_id_fk" FOREIGN KEY ("lesson_id") REFERENCES "public"."lessons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_blocks" ADD CONSTRAINT "lesson_blocks_outcome_id_lesson_outcomes_id_fk" FOREIGN KEY ("outcome_id") REFERENCES "public"."lesson_outcomes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_outcomes" ADD CONSTRAINT "lesson_outcomes_lesson_id_lessons_id_fk" FOREIGN KEY ("lesson_id") REFERENCES "public"."lessons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lessons" ADD CONSTRAINT "lessons_module_id_modules_id_fk" FOREIGN KEY ("module_id") REFERENCES "public"."modules"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lessons" ADD CONSTRAINT "lessons_teacher_id_users_id_fk" FOREIGN KEY ("teacher_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "live_sessions" ADD CONSTRAINT "live_sessions_lesson_id_lessons_id_fk" FOREIGN KEY ("lesson_id") REFERENCES "public"."lessons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "live_sessions" ADD CONSTRAINT "live_sessions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "modules" ADD CONSTRAINT "modules_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "participants" ADD CONSTRAINT "participants_session_id_live_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."live_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "participants" ADD CONSTRAINT "participants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "responses" ADD CONSTRAINT "responses_participant_id_participants_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."participants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "responses" ADD CONSTRAINT "responses_block_id_lesson_blocks_id_fk" FOREIGN KEY ("block_id") REFERENCES "public"."lesson_blocks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_progress" ADD CONSTRAINT "user_progress_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_progress" ADD CONSTRAINT "user_progress_lesson_id_lessons_id_fk" FOREIGN KEY ("lesson_id") REFERENCES "public"."lessons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "blocks_lesson_idx" ON "lesson_blocks" USING btree ("lesson_id","order_index");--> statement-breakpoint
CREATE INDEX "lessons_module_idx" ON "lessons" USING btree ("module_id");--> statement-breakpoint
CREATE INDEX "lessons_teacher_idx" ON "lessons" USING btree ("teacher_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_code_live_idx" ON "live_sessions" USING btree ("code") WHERE status = 'live';--> statement-breakpoint
CREATE INDEX "participants_session_idx" ON "participants" USING btree ("session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "responses_participant_block_idx" ON "responses" USING btree ("participant_id","block_id");--> statement-breakpoint
CREATE UNIQUE INDEX "progress_user_lesson_idx" ON "user_progress" USING btree ("user_id","lesson_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_idx" ON "users" USING btree ("email");--> statement-breakpoint
CREATE INDEX "users_org_idx" ON "users" USING btree ("organization_id");