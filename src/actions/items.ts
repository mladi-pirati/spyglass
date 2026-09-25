"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireSpyglassAccess } from "@/lib/auth/access";
import { createFolder, isUniqueViolation, moveItem, renameItem, restoreItem, trashItem } from "@/lib/drive";

type ActionResult = { ok: true } | { ok: false; message: string };
const optionalUuid = z.string().uuid().nullable();

function messageFor(error: unknown) {
  if (isUniqueViolation(error)) return "An item with that name already exists here.";
  if (error instanceof z.ZodError) return error.issues[0]?.message ?? "Invalid input.";
  return error instanceof Error ? error.message : "Unexpected server error.";
}

export async function createFolderAction(input: { parentId: string | null; name: string }): Promise<ActionResult> {
  try {
    const actor = await requireSpyglassAccess();
    await createFolder(actor, { parentId: optionalUuid.parse(input.parentId), name: input.name });
    revalidatePath("/");
    return { ok: true };
  } catch (error) { return { ok: false, message: messageFor(error) }; }
}

export async function renameItemAction(input: { id: string; name: string }): Promise<ActionResult> {
  try {
    const actor = await requireSpyglassAccess();
    await renameItem(actor, { id: z.string().uuid().parse(input.id), name: input.name });
    revalidatePath("/");
    return { ok: true };
  } catch (error) { return { ok: false, message: messageFor(error) }; }
}

export async function moveItemAction(input: { id: string; parentId: string | null }): Promise<ActionResult> {
  try {
    const actor = await requireSpyglassAccess();
    await moveItem(actor, { id: z.string().uuid().parse(input.id), parentId: optionalUuid.parse(input.parentId) });
    revalidatePath("/");
    return { ok: true };
  } catch (error) { return { ok: false, message: messageFor(error) }; }
}

export async function trashItemAction(id: string): Promise<ActionResult> {
  try {
    const actor = await requireSpyglassAccess();
    await trashItem(actor, z.string().uuid().parse(id));
    revalidatePath("/"); revalidatePath("/trash");
    return { ok: true };
  } catch (error) { return { ok: false, message: messageFor(error) }; }
}

export async function restoreItemAction(id: string): Promise<ActionResult> {
  try {
    const actor = await requireSpyglassAccess();
    await restoreItem(actor, z.string().uuid().parse(id));
    revalidatePath("/"); revalidatePath("/trash");
    return { ok: true };
  } catch (error) { return { ok: false, message: messageFor(error) }; }
}
