import { MediaWorkspace } from "@/components/library/media-workspace";
import { listFolder, listFoldersForMove } from "@/lib/drive";

export default async function Home({ searchParams }: { searchParams: Promise<{ cursor?: string }> }) {
  const { cursor } = await searchParams;
  const [{ items, nextCursor }, folders] = await Promise.all([listFolder(null, cursor), listFoldersForMove()]);
  return <MediaWorkspace title="Library" parentId={null} items={items} breadcrumbs={[]} folders={folders} nextHref={nextCursor ? `/?cursor=${encodeURIComponent(nextCursor)}` : undefined} />;
}
