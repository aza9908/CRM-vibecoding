ALTER TYPE "public"."user_role" ADD VALUE 'methodist';--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "slug" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "contact_name" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "contact_email" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "contact_phone" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "notes" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "is_active" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "created_by" uuid;--> statement-breakpoint
ALTER TABLE "promo_codes" ADD COLUMN "label" text;