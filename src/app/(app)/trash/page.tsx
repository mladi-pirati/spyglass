import { MediaWorkspace } from "@/components/library/media-workspace";
import { listTrash } from "@/lib/drive";

export default async function TrashPage() {
  return <MediaWorkspace title="Trash" parentId={null} items={await listTrash()} breadcrumbs={[]} folders={[]} trash />;
}
