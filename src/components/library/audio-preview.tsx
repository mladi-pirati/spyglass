"use client";

import { useState } from "react";

export function AudioPreview({ src, name }: { src: string; name: string }) {
  const [failed, setFailed] = useState(false);

  return (
    <div className="w-full max-w-xl rounded-xl border bg-muted/50 p-6 shadow-sm">
      <p className="mb-4 truncate text-center font-medium" title={name}>{name}</p>
      {failed ? <p className="text-center text-sm text-muted-foreground">This browser cannot play this audio file. You can download the original file instead.</p> : <audio src={src} controls preload="metadata" aria-label={name} onError={() => setFailed(true)} className="w-full">Your browser does not support audio playback.</audio>}
    </div>
  );
}
