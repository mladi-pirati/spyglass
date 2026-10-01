"use client";

import dynamic from "next/dynamic";

import { Skeleton } from "@/components/ui/skeleton";

// pdf.js needs browser APIs, so the viewer is never prerendered.
export const PdfPreview = dynamic(() => import("./pdf-viewer"), {
  ssr: false,
  loading: () => <Skeleton className="h-[80vh] w-full bg-muted" />,
});
