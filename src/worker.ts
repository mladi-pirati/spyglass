import { and, asc, eq, isNotNull, lt, lte, sql } from "drizzle-orm";

import { db } from "@/db";
import { auditEvents, itemClosure, items, storageDeletionJobs, uploadSessions } from "@/db/schema";
import { abortMultipartUpload, deleteStoredObject } from "@/lib/s3";

const POLL_MS = 10_000;
const TRASH_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
let stopping = false;

async function expireUploads() {
  const expired = await db.select().from(uploadSessions).where(and(eq(uploadSessions.status, "pending"), lt(uploadSessions.expiresAt, new Date()))).limit(25);
  for (const session of expired) {
    try {
      await abortMultipartUpload(session.storageKey, session.s3UploadId);
    } catch {
      continue;
    }
    await db.transaction(async (tx) => {
      const [claimed] = await tx.update(uploadSessions).set({ status: "expired", updatedAt: new Date() }).where(and(eq(uploadSessions.id, session.id), eq(uploadSessions.status, "pending"))).returning({ id: uploadSessions.id });
      if (!claimed) return;
      await tx.insert(auditEvents).values({ actorType: "system", action: "upload.expired", targetId: session.itemId, targetType: "upload", targetName: session.requestedName, correlationId: session.id, context: { storageKey: session.storageKey } });
    });
  }
}

async function purgeTrash() {
  const cutoff = new Date(Date.now() - TRASH_RETENTION_MS);
  const roots = await db.select().from(items).where(and(
    isNotNull(items.trashedAt), lt(items.trashedAt, cutoff),
    sql`not exists (select 1 from ${itemClosure} c join ${items} a on a.id = c.ancestor_id where c.descendant_id = ${items.id} and c.depth > 0 and a.trashed_at is not null)`,
  )).limit(10);
  for (const root of roots) {
    await db.transaction(async (tx) => {
      const descendants = await tx.select({ id: items.id, storageKey: items.storageKey })
        .from(itemClosure)
        .innerJoin(items, eq(items.id, itemClosure.descendantId))
        .where(eq(itemClosure.ancestorId, root.id));
      for (const descendant of descendants) {
        if (descendant.storageKey) await tx.insert(storageDeletionJobs).values({ itemId: descendant.id, storageKey: descendant.storageKey, reason: "trash-purge", correlationId: root.id });
      }
      await tx.insert(auditEvents).values({ actorType: "system", action: "item.purged", targetId: root.id, targetType: root.kind, targetName: root.name, correlationId: root.id, context: { trashedAt: root.trashedAt?.toISOString(), objectCount: descendants.filter((item) => item.storageKey).length } });
      await tx.delete(items).where(eq(items.id, root.id));
    });
  }
}

async function claimDeletionJob() {
  return db.transaction(async (tx) => {
    const [candidate] = await tx.select().from(storageDeletionJobs)
      .where(and(sql`${storageDeletionJobs.status} in ('pending', 'failed')`, lte(storageDeletionJobs.nextAttemptAt, new Date()), lt(storageDeletionJobs.attempts, 10)))
      .orderBy(asc(storageDeletionJobs.nextAttemptAt))
      .limit(1)
      .for("update", { skipLocked: true });
    if (!candidate) return null;
    const [claimed] = await tx.update(storageDeletionJobs)
      .set({ status: "processing", attempts: candidate.attempts + 1 })
      .where(eq(storageDeletionJobs.id, candidate.id))
      .returning();
    return claimed ?? null;
  });
}

async function processDeletionJobs() {
  for (let count = 0; count < 25; count += 1) {
    const job = await claimDeletionJob();
    if (!job) return;
    try {
      await deleteStoredObject(job.storageKey);
      await db.transaction(async (tx) => {
        await tx.update(storageDeletionJobs).set({ status: "completed", completedAt: new Date(), lastError: null }).where(eq(storageDeletionJobs.id, job.id));
        await tx.insert(auditEvents).values({ actorType: "system", action: "storage.object-deleted", targetId: job.itemId, targetType: "s3-object", targetName: job.storageKey, correlationId: job.correlationId, context: { storageKey: job.storageKey, reason: job.reason } });
      });
    } catch (error) {
      const delayMinutes = Math.min(60, 2 ** Math.min(job.attempts, 6));
      await db.update(storageDeletionJobs).set({ status: "failed", lastError: error instanceof Error ? error.message.slice(0, 1000) : "Unknown deletion error", nextAttemptAt: new Date(Date.now() + delayMinutes * 60_000) }).where(eq(storageDeletionJobs.id, job.id));
    }
  }
}

async function tick() {
  await Promise.all([expireUploads(), purgeTrash(), processDeletionJobs()]);
}

async function run() {
  console.info("[worker] Spyglass lifecycle worker started");
  await db.update(storageDeletionJobs).set({ status: "pending" }).where(eq(storageDeletionJobs.status, "processing"));
  while (!stopping) {
    try { await tick(); } catch (error) { console.error("[worker] tick failed", error); }
    await Bun.sleep(POLL_MS);
  }
}

process.on("SIGINT", () => { stopping = true; });
process.on("SIGTERM", () => { stopping = true; });
void run();
