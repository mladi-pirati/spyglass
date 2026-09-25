import { SearchIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MediaWorkspace } from "@/components/library/media-workspace";
import { listFoldersForMove, searchItems } from "@/lib/drive";

export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string; cursor?: string }> }) {
  const params = await searchParams;
  const query = params.q?.trim() ?? "";
  const [{ items, nextCursor }, folders] = await Promise.all([searchItems(query, params.cursor), listFoldersForMove()]);
  const nextParams = new URLSearchParams({ q: query });
  if (nextCursor) nextParams.set("cursor", nextCursor);
  return <div className="space-y-5">
    <form action="/search" className="flex gap-2 sm:hidden">
      <Input name="q" defaultValue={query} placeholder="Search files and folders" autoFocus />
      <Button type="submit" size="icon" aria-label="Search"><SearchIcon /></Button>
    </form>
    <MediaWorkspace title={query ? `Results for “${query}”` : "Search"} parentId={null} items={items} breadcrumbs={[]} folders={folders} search nextHref={nextCursor ? `/search?${nextParams.toString()}` : undefined} />
  </div>;
}
