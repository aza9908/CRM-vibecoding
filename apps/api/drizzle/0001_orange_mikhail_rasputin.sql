ALTER TABLE "lessons" ADD COLUMN "organization_id" uuid;--> statement-breakpoint
ALTER TABLE "lessons" ADD CONSTRAINT "lessons_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- Backfill existing lessons from the authoring teacher's organization (was previously derived via module -> course).
UPDATE "lessons" SET "organization_id" = "users"."organization_id"
  FROM "users" WHERE "lessons"."teacher_id" = "users"."id" AND "lessons"."organization_id" IS NULL;--> statement-breakpoint
CREATE INDEX "lessons_org_idx" ON "lessons" USING btree ("organization_id");