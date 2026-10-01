import { sql } from "drizzle-orm";
import {
  bigint,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

export const itemKind = pgEnum("item_kind", ["file", "folder"]);
export const previewKind = pgEnum("preview_kind", ["image", "video", "audio", "pdf", "none"]);
export const uploadIntent = pgEnum("upload_intent", ["new", "replace"]);
export const uploadStatus = pgEnum("upload_status", ["pending", "completed", "aborted", "expired"]);
export const deletionStatus = pgEnum("deletion_status", ["pending", "processing", "completed", "failed"]);
export const auditActorType = pgEnum("audit_actor_type", ["helm-user", "system"]);

export const items = pgTable(
  "items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    parentId: uuid("parent_id").references((): AnyPgColumn => items.id, { onDelete: "cascade" }),
    kind: itemKind("kind").notNull(),
    name: text("name").notNull(),
    storageSegment: text("storage_segment"),
    mimeType: text("mime_type"),
    byteSize: bigint("byte_size", { mode: "number" }),
    storageKey: text("storage_key").unique(),
    storageEtag: text("storage_etag"),
    storageGeneration: integer("storage_generation").notNull().default(1),
    preview: previewKind("preview").notNull().default("none"),
    createdByHelmId: text("created_by_helm_id").notNull(),
    updatedByHelmId: text("updated_by_helm_id").notNull(),
    trashedAt: timestamp("trashed_at", { withTimezone: true }),
    trashedByHelmId: text("trashed_by_helm_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("items_parent_id_idx").on(table.parentId),
    index("items_trashed_at_idx").on(table.trashedAt),
    uniqueIndex("items_sibling_name_uq").on(
      sql`coalesce(${table.parentId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
      sql`lower(${table.name})`,
    ),
  ],
);

export const itemClosure = pgTable(
  "item_closure",
  {
    ancestorId: uuid("ancestor_id").notNull().references(() => items.id, { onDelete: "cascade" }),
    descendantId: uuid("descendant_id").notNull().references(() => items.id, { onDelete: "cascade" }),
    depth: integer("depth").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.ancestorId, table.descendantId] }),
    index("item_closure_descendant_idx").on(table.descendantId, table.depth),
  ],
);

export const uploadSessions = pgTable(
  "upload_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    itemId: uuid("item_id").notNull(),
    parentId: uuid("parent_id").references(() => items.id, { onDelete: "set null" }),
    intent: uploadIntent("intent").notNull(),
    requestedName: text("requested_name").notNull(),
    declaredMimeType: text("declared_mime_type").notNull(),
    byteSize: bigint("byte_size", { mode: "number" }).notNull(),
    fingerprint: text("fingerprint"),
    storageKey: text("storage_key").notNull().unique(),
    s3UploadId: text("s3_upload_id").notNull(),
    partSize: integer("part_size").notNull(),
    generation: integer("generation").notNull(),
    status: uploadStatus("status").notNull().default("pending"),
    createdByHelmId: text("created_by_helm_id").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("upload_sessions_status_expiry_idx").on(table.status, table.expiresAt),
    index("upload_sessions_item_idx").on(table.itemId),
  ],
);

export const storageDeletionJobs = pgTable(
  "storage_deletion_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    itemId: uuid("item_id"),
    storageKey: text("storage_key").notNull(),
    reason: text("reason").notNull(),
    correlationId: uuid("correlation_id").notNull(),
    status: deletionStatus("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [index("storage_deletion_jobs_claim_idx").on(table.status, table.nextAttemptAt)],
);

export const auditEvents = pgTable(
  "audit_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    actorType: auditActorType("actor_type").notNull(),
    actorHelmId: text("actor_helm_id"),
    action: text("action").notNull(),
    targetId: uuid("target_id"),
    targetType: text("target_type").notNull(),
    targetName: text("target_name"),
    correlationId: uuid("correlation_id").notNull().defaultRandom(),
    context: jsonb("context").$type<Record<string, unknown>>().notNull().default({}),
  },
  (table) => [
    index("audit_events_occurred_at_idx").on(table.occurredAt, table.id),
    index("audit_events_actor_idx").on(table.actorHelmId, table.occurredAt),
    index("audit_events_action_idx").on(table.action, table.occurredAt),
    index("audit_events_target_idx").on(table.targetId, table.occurredAt),
  ],
);

export type DriveItem = typeof items.$inferSelect;
export type AuditEvent = typeof auditEvents.$inferSelect;
