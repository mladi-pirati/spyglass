import { notFound } from "next/navigation";

import { MediaWorkspace } from "@/components/library/media-workspace";
import { getBreadcrumbs, getItem, listFolder, listFoldersForMove } from "@/lib/drive";

export default async function FolderPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ cursor?: string }> }) {
  const { id } = await params;
  const { cursor } = await searchParams;
  const folder = await getItem(id);
  if (!folder || folder.kind !== "folder" || folder.trashedAt) notFound();
  const [{ items, nextCursor }, breadcrumbs, folders] = await Promise.all([listFolder(id, cursor), getBreadcrumbs(id), listFoldersForMove()]);
  return <MediaWorkspace title={folder.name} parentId={folder.id} items={items} breadcrumbs={breadcrumbs} folders={folders} nextHref={nextCursor ? `/folders/${id}?cursor=${encodeURIComponent(nextCursor)}` : undefined} />;
}
