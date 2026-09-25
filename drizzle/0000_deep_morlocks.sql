CREATE TYPE "public"."audit_actor_type" AS ENUM('helm-user', 'system');--> statement-breakpoint
CREATE TYPE "public"."deletion_status" AS ENUM('pending', 'processing', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."item_kind" AS ENUM('file', 'folder');--> statement-breakpoint
CREATE TYPE "public"."preview_kind" AS ENUM('image', 'video', 'pdf', 'none');--> statement-breakpoint
CREATE TYPE "public"."upload_intent" AS ENUM('new', 'replace');--> statement-breakpoint
CREATE TYPE "public"."upload_status" AS ENUM('pending', 'completed', 'aborted', 'expired');--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_type" "audit_actor_type" NOT NULL,
	"actor_helm_id" text,
	"action" text NOT NULL,
	"target_id" uuid,
	"target_type" text NOT NULL,
	"target_name" text,
	"correlation_id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"context" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "item_closure" (
	"ancestor_id" uuid NOT NULL,
	"descendant_id" uuid NOT NULL,
	"depth" integer NOT NULL,
	CONSTRAINT "item_closure_ancestor_id_descendant_id_pk" PRIMARY KEY("ancestor_id","descendant_id")
);
--> statement-breakpoint
CREATE TABLE "items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"parent_id" uuid,
	"kind" "item_kind" NOT NULL,
	"name" text NOT NULL,
	"storage_segment" text,
	"mime_type" text,
	"byte_size" bigint,
	"storage_key" text,
	"storage_etag" text,
	"storage_generation" integer DEFAULT 1 NOT NULL,
	"preview" "preview_kind" DEFAULT 'none' NOT NULL,
	"created_by_helm_id" text NOT NULL,
	"updated_by_helm_id" text NOT NULL,
	"trashed_at" timestamp with time zone,
	"trashed_by_helm_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "items_storage_key_unique" UNIQUE("storage_key")
);
--> statement-breakpoint
CREATE TABLE "storage_deletion_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"item_id" uuid,
	"storage_key" text NOT NULL,
	"reason" text NOT NULL,
	"correlation_id" uuid NOT NULL,
	"status" "deletion_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "upload_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"item_id" uuid NOT NULL,
	"parent_id" uuid,
	"intent" "upload_intent" NOT NULL,
	"requested_name" text NOT NULL,
	"declared_mime_type" text NOT NULL,
	"byte_size" bigint NOT NULL,
	"fingerprint" text,
	"storage_key" text NOT NULL,
	"s3_upload_id" text NOT NULL,
	"part_size" integer NOT NULL,
	"generation" integer NOT NULL,
	"status" "upload_status" DEFAULT 'pending' NOT NULL,
	"created_by_helm_id" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "upload_sessions_storage_key_unique" UNIQUE("storage_key")
);
--> statement-breakpoint
ALTER TABLE "item_closure" ADD CONSTRAINT "item_closure_ancestor_id_items_id_fk" FOREIGN KEY ("ancestor_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_closure" ADD CONSTRAINT "item_closure_descendant_id_items_id_fk" FOREIGN KEY ("descendant_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_parent_id_items_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upload_sessions" ADD CONSTRAINT "upload_sessions_parent_id_items_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_events_occurred_at_idx" ON "audit_events" USING btree ("occurred_at","id");--> statement-breakpoint
CREATE INDEX "audit_events_actor_idx" ON "audit_events" USING btree ("actor_helm_id","occurred_at");--> statement-breakpoint
CREATE INDEX "audit_events_action_idx" ON "audit_events" USING btree ("action","occurred_at");--> statement-breakpoint
CREATE INDEX "audit_events_target_idx" ON "audit_events" USING btree ("target_id","occurred_at");--> statement-breakpoint
CREATE INDEX "item_closure_descendant_idx" ON "item_closure" USING btree ("descendant_id","depth");--> statement-breakpoint
CREATE INDEX "items_parent_id_idx" ON "items" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "items_trashed_at_idx" ON "items" USING btree ("trashed_at");--> statement-breakpoint
CREATE INDEX "items_name_trgm_idx" ON "items" USING gin (lower("name") gin_trgm_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "items_sibling_name_uq" ON "items" USING btree (coalesce("parent_id", '00000000-0000-0000-0000-000000000000'::uuid),lower("name"));--> statement-breakpoint
CREATE INDEX "storage_deletion_jobs_claim_idx" ON "storage_deletion_jobs" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "upload_sessions_status_expiry_idx" ON "upload_sessions" USING btree ("status","expires_at");--> statement-breakpoint
CREATE INDEX "upload_sessions_item_idx" ON "upload_sessions" USING btree ("item_id");
--> statement-breakpoint
CREATE FUNCTION prevent_audit_event_changes() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_events are append-only';
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER audit_events_append_only
BEFORE UPDATE OR DELETE ON "audit_events"
FOR EACH ROW EXECUTE FUNCTION prevent_audit_event_changes();
