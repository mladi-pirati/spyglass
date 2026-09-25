/* eslint-disable @next/next/no-img-element -- authenticated originals must bypass the public image optimizer */
import Link from "next/link";
import { ArrowLeftIcon, DownloadIcon, FileIcon } from "lucide-react";
import { notFound } from "next/navigation";

import { Button } from "@/components/ui/button";
import { getBreadcrumbs, getItem } from "@/lib/drive";

export default async function FilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const item = await getItem(id);
  if (!item || item.kind !== "file" || item.trashedAt) notFound();
  const path = await getBreadcrumbs(id);
  if (path.some((entry) => entry.trashedAt)) notFound();
  const parentHref = item.parentId ? `/folders/${item.parentId}` : "/";
  const source = `/api/files/${item.id}/content`;

  return (
    <div className="grid min-h-[calc(100vh-7rem)] grid-rows-[auto_1fr] gap-4">
      <div className="flex items-center gap-3">
        <Button variant="outline" size="icon" nativeButton={false} render={<Link href={parentHref} aria-label="Back to folder" />}><ArrowLeftIcon /></Button>
        <div className="min-w-0 flex-1"><h1 className="truncate text-lg font-semibold">{item.name}</h1><p className="text-sm text-muted-foreground">{item.mimeType} · {formatBytes(item.byteSize)}</p></div>
        <Button nativeButton={false} render={<a href={`${source}?download=1`} download />}><DownloadIcon />Download</Button>
      </div>
      <div className="grid min-h-[70vh] place-items-center overflow-hidden border bg-black/95 p-4">
        {item.preview === "image" ? <img src={source} alt={item.name} className="max-h-[80vh] max-w-full object-contain" /> : null}
        {item.preview === "video" ? <video src={source} controls preload="metadata" className="max-h-[80vh] max-w-full" aria-label={item.name} /> : null}
        {item.preview === "pdf" ? <iframe src={source} title={item.name} className="h-[80vh] w-full bg-white" sandbox="allow-same-origin" /> : null}
        {item.preview === "none" ? <div className="grid max-w-md place-items-center gap-4 text-center text-white"><FileIcon className="size-16 text-primary" /><div><h2 className="text-xl font-semibold">Preview unavailable</h2><p className="mt-2 text-sm text-white/65">This file type can only be downloaded.</p></div></div> : null}
      </div>
    </div>
  );
}

function formatBytes(value: number | null) {
  if (value === null) return "—";
  const units = ["B", "KB", "MB", "GB"];
  let size = value; let unit = 0;
  while (size >= 1024 && unit < units.length - 1) { size /= 1024; unit += 1; }
  return `${size.toFixed(unit ? 1 : 0)} ${units[unit]}`;
}
