"use client";

import { useEffect, useRef, useState } from "react";
import { DownloadIcon, FileWarningIcon, MinusIcon, PlusIcon } from "lucide-react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

// Must be configured in the same module that renders <Document>/<Page>.
pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();

const MIN_SCALE = 0.5;
const MAX_SCALE = 3;
const SCALE_STEP = 0.25;

type PdfViewerProps = { src: string; name: string; downloadHref: string };

export default function PdfViewer({ src, name, downloadHref }: PdfViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState<number>();
  const [numPages, setNumPages] = useState<number>();
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.floor(entry.contentRect.width)));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const pageWidth = width ? Math.min(Math.max(width - 32, 200), 850) : undefined;
  const loading = <div className="grid gap-4 p-4"><Skeleton className="mx-auto aspect-[1/1.414] w-full max-w-[850px] bg-muted" /></div>;
  const error = (
    <div className="grid h-full place-items-center gap-4 p-8 text-center">
      <div className="grid size-20 place-items-center rounded-full bg-primary/10"><FileWarningIcon className="size-10 text-primary" /></div>
      <div><h2 className="text-xl font-semibold">Couldn&apos;t render PDF</h2><p className="mt-2 text-sm text-muted-foreground">The file may be damaged. You can still download it.</p></div>
      <Button nativeButton={false} render={<a href={downloadHref} download />}><DownloadIcon />Download</Button>
    </div>
  );

  return (
    <div className="grid h-[80vh] w-full min-w-0 grid-rows-[auto_1fr] overflow-hidden rounded-lg border bg-muted/40">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-card px-3 py-2 text-sm sm:px-4">
        <span className="font-medium tabular-nums">{numPages === undefined ? "Loading PDF…" : `${numPages} ${numPages === 1 ? "page" : "pages"}`}</span>
        <div className="flex items-center gap-1 text-muted-foreground">
          <Button variant="ghost" size="icon-sm" aria-label="Zoom out" disabled={scale <= MIN_SCALE} onClick={() => setScale((value) => Math.max(MIN_SCALE, value - SCALE_STEP))}><MinusIcon /></Button>
          <span className="w-12 text-center text-xs tabular-nums text-foreground" aria-live="polite">{Math.round(scale * 100)}%</span>
          <Button variant="ghost" size="icon-sm" aria-label="Zoom in" disabled={scale >= MAX_SCALE} onClick={() => setScale((value) => Math.min(MAX_SCALE, value + SCALE_STEP))}><PlusIcon /></Button>
          <span className="mx-1 h-5 border-l" aria-hidden="true" />
          <Button variant="ghost" size="icon-sm" nativeButton={false} render={<a href={downloadHref} download aria-label="Download PDF" />}><DownloadIcon /></Button>
        </div>
      </div>
      <div ref={containerRef} className="min-h-0 overflow-auto" aria-label={name}>
        <Document file={src} loading={loading} error={error} onLoadSuccess={({ numPages: count }) => setNumPages(count)} className="flex min-w-max flex-col items-center gap-4 p-4">
          {pageWidth && numPages
            ? Array.from({ length: numPages }, (_, index) => (
                // Per-page positioning context, reserved for a future annotation overlay.
                <div key={index} className="relative bg-white shadow-md ring-1 ring-border">
                  <Page pageNumber={index + 1} width={pageWidth} scale={scale} loading={<Skeleton className="aspect-[1/1.414] bg-muted" style={{ width: pageWidth * scale }} />} />
                </div>
              ))
            : null}
        </Document>
      </div>
    </div>
  );
}
