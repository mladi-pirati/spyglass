import "server-only";

import { and, asc, desc, eq, getTableColumns, ilike, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import { auditEvents, itemClosure, items, storageDeletionJobs, uploadSessions, type DriveItem } from "@/db/schema";
import { normalizeStorageSegment, shortItemId } from "@/lib/storage-path";

export const itemNameSchema = z.string().trim().min(1).max(255).refine(
  (name) => !/[\u0000-\u001f/\\]/.test(name),
  "Names cannot contain slashes or control characters.",
);

type Actor = { id: string };

function parentCondition(parentId: string | null) {
  return parentId ? eq(items.parentId, parentId) : isNull(items.parentId);
}

export function isUniqueViolation(error: unknown) {
  let current = error;
  while (typeof current === "object" && current !== null) {
    if ("code" in current && current.code === "23505") return true;
    current = "cause" in current ? current.cause : null;
  }
  return false;
}

export async function getFolderSegments(folderId: string | null) {
  if (!folderId) return [];
  const result = await db.select({ storageSegment: items.storageSegment })
    .from(itemClosure)
    .innerJoin(items, eq(items.id, itemClosure.ancestorId))
    .where(and(eq(itemClosure.descendantId, folderId), eq(items.kind, "folder")))
    .orderBy(desc(itemClosure.depth));
  return result.map((row) => row.storageSegment).filter((value): value is string => Boolean(value));
}

export async function createFolder(actor: Actor, input: { parentId: string | null; name: string }) {
  const name = itemNameSchema.parse(input.name);
  const id = crypto.randomUUID();
  const baseSegment = normalizeStorageSegment(name, "folder");
  const siblings = await db.select({ segment: items.storageSegment }).from(items).where(and(
    parentCondition(input.parentId),
    eq(items.kind, "folder"),
  ));
  const storageSegment = siblings.some((row) => row.segment === baseSegment)
    ? `${baseSegment}--${shortItemId(id)}`
    : baseSegment;

  return db.transaction(async (tx) => {
    if (input.parentId) {
      const parent = await tx.query.items.findFirst({ where: and(eq(items.id, input.parentId), eq(items.kind, "folder"), isNull(items.trashedAt)) });
      if (!parent) throw new Error("Destination folder was not found.");
    }
    const [folder] = await tx.insert(items).values({
      id,
      parentId: input.parentId,
      kind: "folder",
      name,
      storageSegment,
      createdByHelmId: actor.id,
      updatedByHelmId: actor.id,
    }).returning();
    await tx.insert(itemClosure).values({ ancestorId: id, descendantId: id, depth: 0 });
    if (input.parentId) {
      await tx.execute(sql`
        insert into ${itemClosure} (ancestor_id, descendant_id, depth)
        select ancestor_id, ${id}, depth + 1
        from ${itemClosure}
        where descendant_id = ${input.parentId}
      `);
    }
    await tx.insert(auditEvents).values({
      actorType: "helm-user", actorHelmId: actor.id, action: "folder.created",
      targetId: id, targetType: "folder", targetName: name,
      context: { parentId: input.parentId, storageSegment },
    });
    return folder;
  });
}

export async function renameItem(actor: Actor, input: { id: string; name: string }) {
  const name = itemNameSchema.parse(input.name);
  return db.transaction(async (tx) => {
    const current = await tx.query.items.findFirst({ where: and(eq(items.id, input.id), isNull(items.trashedAt)) });
    if (!current) throw new Error("Item was not found.");
    const [updated] = await tx.update(items).set({ name, updatedAt: new Date(), updatedByHelmId: actor.id }).where(eq(items.id, input.id)).returning();
    await tx.insert(auditEvents).values({
      actorType: "helm-user", actorHelmId: actor.id, action: "item.renamed",
      targetId: current.id, targetType: current.kind, targetName: name,
      context: { previousName: current.name, name, storageKey: current.storageKey },
    });
    return updated;
  });
}

export async function moveItem(actor: Actor, input: { id: string; parentId: string | null }) {
  if (input.id === input.parentId) throw new Error("An item cannot contain itself.");
  return db.transaction(async (tx) => {
    const current = await tx.query.items.findFirst({ where: and(eq(items.id, input.id), isNull(items.trashedAt)) });
    if (!current) throw new Error("Item was not found.");
    if (input.parentId) {
      const parent = await tx.query.items.findFirst({ where: and(eq(items.id, input.parentId), eq(items.kind, "folder"), isNull(items.trashedAt)) });
      if (!parent) throw new Error("Destination folder was not found.");
      const cycle = await tx.query.itemClosure.findFirst({ where: and(eq(itemClosure.ancestorId, input.id), eq(itemClosure.descendantId, input.parentId)) });
      if (cycle) throw new Error("A folder cannot be moved into its own descendant.");
    }

    await tx.execute(sql`
      delete from ${itemClosure}
      where descendant_id in (select descendant_id from ${itemClosure} where ancestor_id = ${input.id})
        and ancestor_id in (
          select ancestor_id from ${itemClosure}
          where descendant_id = ${input.id} and ancestor_id <> ${input.id}
        )
    `);
    if (input.parentId) {
      await tx.execute(sql`
        insert into ${itemClosure} (ancestor_id, descendant_id, depth)
        select parents.ancestor_id, subtree.descendant_id, parents.depth + subtree.depth + 1
        from ${itemClosure} parents
        cross join ${itemClosure} subtree
        where parents.descendant_id = ${input.parentId}
          and subtree.ancestor_id = ${input.id}
      `);
    }
    const [updated] = await tx.update(items).set({ parentId: input.parentId, updatedAt: new Date(), updatedByHelmId: actor.id }).where(eq(items.id, input.id)).returning();
    await tx.insert(auditEvents).values({
      actorType: "helm-user", actorHelmId: actor.id, action: "item.moved",
      targetId: current.id, targetType: current.kind, targetName: current.name,
      context: { previousParentId: current.parentId, parentId: input.parentId, storageKey: current.storageKey },
    });
    return updated;
  });
}

export async function trashItem(actor: Actor, id: string) {
  return db.transaction(async (tx) => {
    const current = await tx.query.items.findFirst({ where: and(eq(items.id, id), isNull(items.trashedAt)) });
    if (!current) throw new Error("Item was not found.");
    const now = new Date();
    await tx.update(items).set({ trashedAt: now, trashedByHelmId: actor.id, updatedAt: now, updatedByHelmId: actor.id }).where(eq(items.id, id));
    await tx.insert(auditEvents).values({
      actorType: "helm-user", actorHelmId: actor.id, action: "item.trashed",
      targetId: current.id, targetType: current.kind, targetName: current.name,
      context: { trashedAt: now.toISOString(), storageKey: current.storageKey },
    });
  });
}

export async function restoreItem(actor: Actor, id: string) {
  return db.transaction(async (tx) => {
    const current = await tx.query.items.findFirst({ where: and(eq(items.id, id), isNotNull(items.trashedAt)) });
    if (!current) throw new Error("Trashed item was not found.");
    await tx.update(items).set({ trashedAt: null, trashedByHelmId: null, updatedAt: new Date(), updatedByHelmId: actor.id }).where(eq(items.id, id));
    await tx.insert(auditEvents).values({
      actorType: "helm-user", actorHelmId: actor.id, action: "item.restored",
      targetId: current.id, targetType: current.kind, targetName: current.name,
      context: { previousTrashedAt: current.trashedAt?.toISOString(), storageKey: current.storageKey },
    });
  });
}

export async function listFolder(parentId: string | null, cursorValue?: string) {
  const cursor = decodeItemCursor(cursorValue);
  const rows = await db.select().from(items).where(and(
    parentCondition(parentId),
    isNull(items.trashedAt),
    sql`not exists (
      select 1 from ${itemClosure} c
      join ${items} ancestor on ancestor.id = c.ancestor_id
      where c.descendant_id = ${items.id} and ancestor.trashed_at is not null
    )`,
    cursor ? itemCursorCondition(cursor) : undefined,
  )).orderBy(itemKindOrder(), sql`lower(${items.name})`, asc(items.id)).limit(101);
  return itemPage(rows);
}

export async function listTrash() {
  return db.select().from(items).where(and(
    isNotNull(items.trashedAt),
    sql`not exists (
      select 1 from ${itemClosure} c
      join ${items} ancestor on ancestor.id = c.ancestor_id
      where c.descendant_id = ${items.id} and c.depth > 0 and ancestor.trashed_at is not null
    )`,
  )).orderBy(desc(items.trashedAt));
}

export async function searchItems(query: string, cursorValue?: string) {
  const value = query.trim().slice(0, 100);
  if (!value) return { items: [] as DriveItem[], nextCursor: null };
  const cursor = decodeItemCursor(cursorValue);
  const rows = await db.select().from(items).where(and(
    ilike(items.name, `%${value}%`),
    isNull(items.trashedAt),
    sql`not exists (
      select 1 from ${itemClosure} c join ${items} ancestor on ancestor.id = c.ancestor_id
      where c.descendant_id = ${items.id} and ancestor.trashed_at is not null
    )`,
    cursor ? itemCursorCondition(cursor) : undefined,
  )).orderBy(itemKindOrder(), sql`lower(${items.name})`, asc(items.id)).limit(101);
  return itemPage(rows);
}

type ItemCursor = { kindOrder: number; name: string; id: string };

function itemKindOrder() {
  return sql<number>`case when ${items.kind} = 'folder' then 0 else 1 end`;
}

function itemCursorCondition(cursor: ItemCursor) {
  return sql`(${itemKindOrder()}, lower(${items.name}), ${items.id}) > (${cursor.kindOrder}, lower(${cursor.name}), ${cursor.id}::uuid)`;
}

function itemPage(rows: DriveItem[]) {
  const hasNext = rows.length > 100;
  const pageItems = hasNext ? rows.slice(0, 100) : rows;
  const last = pageItems.at(-1);
  return {
    items: pageItems,
    nextCursor: hasNext && last ? Buffer.from(JSON.stringify({ kindOrder: last.kind === "folder" ? 0 : 1, name: last.name, id: last.id })).toString("base64url") : null,
  };
}

function decodeItemCursor(value?: string): ItemCursor | null {
  if (!value) return null;
  try {
    const parsed = z.object({ kindOrder: z.union([z.literal(0), z.literal(1)]), name: z.string(), id: z.string().uuid() }).safeParse(JSON.parse(Buffer.from(value, "base64url").toString()));
    return parsed.success ? parsed.data : null;
  } catch { return null; }
}

export async function getItem(id: string) {
  return db.query.items.findFirst({ where: eq(items.id, id) });
}

export async function getBreadcrumbs(itemId: string | null) {
  if (!itemId) return [] as DriveItem[];
  const result = await db.select({ ...getTableColumns(items) })
    .from(itemClosure)
    .innerJoin(items, eq(items.id, itemClosure.ancestorId))
    .where(eq(itemClosure.descendantId, itemId))
    .orderBy(desc(itemClosure.depth));
  return result;
}

export async function listFoldersForMove() {
  return db.select({ id: items.id, name: items.name, parentId: items.parentId }).from(items).where(and(eq(items.kind, "folder"), isNull(items.trashedAt))).orderBy(asc(items.name));
}

export async function listAuditEvents(filters: { action?: string; actor?: string; query?: string; from?: Date; to?: Date; cursor?: string } = {}) {
  const cursor = decodeAuditCursor(filters.cursor);
  const events = await db.select().from(auditEvents).where(and(
    filters.action ? eq(auditEvents.action, filters.action) : undefined,
    filters.actor ? eq(auditEvents.actorHelmId, filters.actor) : undefined,
    filters.query ? or(ilike(auditEvents.targetName, `%${filters.query}%`), sql`${auditEvents.targetId}::text ilike ${`%${filters.query}%`}`) : undefined,
    filters.from ? sql`${auditEvents.occurredAt} >= ${filters.from}` : undefined,
    filters.to ? sql`${auditEvents.occurredAt} < ${filters.to}` : undefined,
    cursor ? or(lt(auditEvents.occurredAt, cursor.occurredAt), and(eq(auditEvents.occurredAt, cursor.occurredAt), lt(auditEvents.id, cursor.id))) : undefined,
  )).orderBy(desc(auditEvents.occurredAt), desc(auditEvents.id)).limit(101);
  const hasNext = events.length > 100;
  const rows = hasNext ? events.slice(0, 100) : events;
  const last = rows.at(-1);
  return { events: rows, nextCursor: hasNext && last ? encodeAuditCursor(last.occurredAt, last.id) : null };
}

function encodeAuditCursor(occurredAt: Date, id: string) {
  return Buffer.from(JSON.stringify([occurredAt.toISOString(), id])).toString("base64url");
}

function decodeAuditCursor(cursor?: string) {
  if (!cursor) return null;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString()) as [string, string];
    const occurredAt = new Date(parsed[0]);
    if (Number.isNaN(occurredAt.getTime()) || !z.string().uuid().safeParse(parsed[1]).success) return null;
    return { occurredAt, id: parsed[1] };
  } catch { return null; }
}

export async function queueDeletion(input: { itemId?: string | null; storageKey: string; reason: string; correlationId: string }) {
  await db.insert(storageDeletionJobs).values(input);
}

export async function findExpiredUploads(now = new Date()) {
  return db.select().from(uploadSessions).where(and(eq(uploadSessions.status, "pending"), lt(uploadSessions.expiresAt, now))).limit(25);
}
