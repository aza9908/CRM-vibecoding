ALTER TABLE "participants" ADD COLUMN "removed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "participants" ADD COLUMN "client_key" text;--> statement-breakpoint
CREATE INDEX "participants_session_client_key_idx" ON "participants" USING btree ("session_id","client_key");