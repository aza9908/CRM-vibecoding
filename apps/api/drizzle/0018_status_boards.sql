ALTER TYPE "public"."block_type" ADD VALUE IF NOT EXISTS 'status_board';--> statement-breakpoint
CREATE TABLE "block_boards" (
	"block_id" uuid PRIMARY KEY NOT NULL,
	"state" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now(),
	"updated_by" uuid
);
--> statement-breakpoint
ALTER TABLE "block_boards" ADD CONSTRAINT "block_boards_block_id_lesson_blocks_id_fk" FOREIGN KEY ("block_id") REFERENCES "public"."lesson_blocks"("id") ON DELETE cascade ON UPDATE no action;