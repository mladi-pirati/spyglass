ALTER TYPE "public"."preview_kind" RENAME TO "preview_kind_old";--> statement-breakpoint
CREATE TYPE "public"."preview_kind" AS ENUM('image', 'video', 'audio', 'pdf', 'none');--> statement-breakpoint
ALTER TABLE "items" ALTER COLUMN "preview" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "items" ALTER COLUMN "preview" TYPE "public"."preview_kind" USING "preview"::text::"public"."preview_kind";--> statement-breakpoint
ALTER TABLE "items" ALTER COLUMN "preview" SET DEFAULT 'none';--> statement-breakpoint
DROP TYPE "public"."preview_kind_old";--> statement-breakpoint
UPDATE "items" SET "preview" = 'video' WHERE "kind" = 'file' AND "preview" = 'none' AND "mime_type" = 'video/quicktime';--> statement-breakpoint
UPDATE "items" SET "preview" = 'audio' WHERE "kind" = 'file' AND "preview" = 'none' AND "mime_type" IN ('audio/mpeg', 'audio/mp4', 'audio/aac', 'audio/wav', 'audio/ogg', 'audio/ogg; codecs=opus', 'audio/webm', 'audio/flac', 'audio/x-flac');
