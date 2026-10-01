"use client";

import Video from "next-video";
import type { VideoProps } from "next-video";

type VideoPreviewProps = { src: string; name: string; mimeType: string | null };
type VideoAsset = Exclude<NonNullable<VideoProps["src"]>, string>;

// Mark existing private files as ready so next-video uses the authenticated URL
// directly instead of requesting an asset descriptor or processing the video.
const useOriginal: NonNullable<VideoProps["transform"]> = (asset) => asset;

export function VideoPreview({ src, name, mimeType }: VideoPreviewProps) {
  const asset: VideoAsset = {
    status: "ready",
    originalFilePath: src,
    provider: "spyglass",
    sources: [{ src, type: mimeType ?? undefined }],
    createdAt: 0,
    updatedAt: 0,
  };

  return (
    <div className="w-full max-w-6xl">
      <Video
        src={asset}
        transform={useOriginal}
        controls
        preload="metadata"
        aria-label={name}
        className="spyglass-video overflow-hidden rounded-lg border bg-muted shadow-sm"
      />
    </div>
  );
}
