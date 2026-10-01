/* eslint-disable @next/next/no-img-element -- authenticated originals must bypass the public image optimizer */
import Link from "next/link";
import { ArrowLeftIcon, DownloadIcon, FileIcon } from "lucide-react";
import { notFound } from "next/navigation";

import { PdfPreview } from "@/components/library/pdf-preview";
import { AudioPreview } from "@/components/library/audio-preview";
import { VideoPreview } from "@/components/library/video-preview";
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
      <div className="grid min-h-[70vh] min-w-0 place-items-center overflow-hidden rounded-xl border bg-card p-3 sm:p-5">
        {item.preview === "image" ? <img src={source} alt={item.name} className="max-h-[80vh] max-w-full object-contain shadow-sm" /> : null}
        {item.preview === "video" ? <VideoPreview src={source} name={item.name} mimeType={item.mimeType} /> : null}
        {item.preview === "audio" ? <AudioPreview src={source} name={item.name} /> : null}
        {item.preview === "pdf" ? <PdfPreview src={source} name={item.name} downloadHref={`${source}?download=1`} /> : null}
        {item.preview === "none" ? <div className="grid max-w-md place-items-center gap-4 p-6 text-center"><div className="grid size-20 place-items-center rounded-full bg-primary/10"><FileIcon className="size-10 text-primary" /></div><div><h2 className="text-xl font-semibold">Preview unavailable</h2><p className="mt-2 text-sm text-muted-foreground">This file type can only be downloaded.</p></div></div> : null}
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
