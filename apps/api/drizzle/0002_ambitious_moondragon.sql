CREATE TYPE "public"."material_type" AS ENUM('file', 'link');--> statement-breakpoint
CREATE TABLE "activity_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"action" text NOT NULL,
	"lesson_id" uuid,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "course_materials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"created_by" uuid,
	"title" text NOT NULL,
	"type" "material_type" NOT NULL,
	"url" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "lesson_materials" (
	"lesson_id" uuid NOT NULL,
	"material_id" uuid NOT NULL,
	CONSTRAINT "lesson_materials_lesson_id_material_id_pk" PRIMARY KEY("lesson_id","material_id")
);
--> statement-breakpoint
CREATE TABLE "lesson_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"lesson_id" uuid NOT NULL,
	"content" text DEFAULT '' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "user_progress" ADD COLUMN "progress_percent" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "user_progress" ADD COLUMN "last_accessed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "activity_logs" ADD CONSTRAINT "activity_logs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_logs" ADD CONSTRAINT "activity_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_logs" ADD CONSTRAINT "activity_logs_lesson_id_lessons_id_fk" FOREIGN KEY ("lesson_id") REFERENCES "public"."lessons"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_materials" ADD CONSTRAINT "course_materials_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_materials" ADD CONSTRAINT "course_materials_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_materials" ADD CONSTRAINT "lesson_materials_lesson_id_lessons_id_fk" FOREIGN KEY ("lesson_id") REFERENCES "public"."lessons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_materials" ADD CONSTRAINT "lesson_materials_material_id_course_materials_id_fk" FOREIGN KEY ("material_id") REFERENCES "public"."course_materials"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_notes" ADD CONSTRAINT "lesson_notes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_notes" ADD CONSTRAINT "lesson_notes_lesson_id_lessons_id_fk" FOREIGN KEY ("lesson_id") REFERENCES "public"."lessons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activity_org_created_idx" ON "activity_logs" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "materials_org_idx" ON "course_materials" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "notes_user_lesson_idx" ON "lesson_notes" USING btree ("user_id","lesson_id");