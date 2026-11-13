ALTER TABLE "lessons" ADD COLUMN IF NOT EXISTS "category" text;--> statement-breakpoint
-- Backfill (idempotent: only rows without a category). Files existing lessons
-- under the client company they were made for.
UPDATE "lessons" SET "category" = 'Кайзен'
  WHERE "category" IS NULL AND ("title" ILIKE '%кайзен%' OR "title" ILIKE '%кайдзен%' OR "title" ILIKE '%kaizen%');--> statement-breakpoint
UPDATE "lessons" SET "category" = 'Investudy'
  WHERE "category" IS NULL AND "title" ILIKE '%investudy%';--> statement-breakpoint
UPDATE "lessons" SET "category" = 'Pingwin'
  WHERE "category" IS NULL AND ("title" ILIKE '%pingwin%' OR "title" ILIKE '%пингвин%');--> statement-breakpoint
UPDATE "lessons" SET "category" = 'Kazakhtelecom'
  WHERE "category" IS NULL AND ("title" ILIKE '%kazakhtelecom%' OR "title" ILIKE '%казахтелеком%');--> statement-breakpoint
UPDATE "lessons" SET "category" = 'Orzu Medical'
  WHERE "category" IS NULL AND (
    "title" ILIKE '%orzu%'
    OR "module_id" IN (
      SELECT m."id" FROM "modules" m
      JOIN "courses" c ON c."id" = m."course_id"
      WHERE c."title" = 'VibeOps · Хаб руководителя'
    )
  );
