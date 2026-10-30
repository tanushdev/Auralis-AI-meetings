"use client";

import { useEffect, useRef, useState } from "react";
import { MicOff, MonitorUp, WifiOff } from "lucide-react";
import { Avatar } from "@/components/ui";
import { cn } from "@/lib/format";
import type { MediaState } from "@/types";

export function VideoTile({
  name,
  stream,
  media,
  isLocal = false,
  connectionState,
  className,
}: {
  name: string;
  stream: MediaStream | null;
  media: MediaState;
  isLocal?: boolean;
  connectionState?: RTCPeerConnectionState;
  className?: string;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [hasFrame, setHasFrame] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.srcObject !== stream) {
      video.srcObject = stream;
    }
    if (stream) {
      void video.play().catch(() => undefined);
    }
    setHasFrame(false);
  }, [stream]);

  const showVideo = Boolean(stream) && (media.video || media.screen) && hasFrame;
  const disconnected = connectionState === "failed" || connectionState === "disconnected";

  return (
    <div
      className={cn(
        "group relative overflow-hidden rounded-2xl border border-line/70 video-surface",
        className,
      )}
    >
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={isLocal}
        onLoadedData={() => setHasFrame(true)}
        onResize={() => setHasFrame(true)}
        className={cn(
          "h-full w-full object-cover transition-opacity",
          showVideo ? "opacity-100" : "opacity-0",
          media.screen && "object-contain",
        )}
      />

      {!showVideo ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
          <Avatar name={name} size={76} className="shadow-2xl" />
          <p className="text-sm font-medium text-ink/90">{name}</p>
          {media.screen ? (
            <p className="text-xs text-brand-soft">Sharing screen…</p>
          ) : media.video ? (
            <p className="text-xs text-muted">Camera starting…</p>
          ) : null}
        </div>
      ) : null}

      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-black/70 to-transparent" />

      <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-2 p-3">
        <span className="inline-flex max-w-[70%] items-center gap-1.5 truncate rounded-lg bg-black/45 px-2 py-1 text-xs font-medium text-white backdrop-blur">
          {name}
          {isLocal ? <span className="text-white/50">(you)</span> : null}
        </span>
        <span className="flex items-center gap-1.5">
          {media.screen ? (
            <span className="inline-flex items-center gap-1 rounded-lg bg-brand/80 px-2 py-1 text-[10px] font-semibold text-white">
              <MonitorUp className="size-3" /> Screen
            </span>
          ) : null}
          {!media.audio ? (
            <span className="rounded-lg bg-black/45 p-1.5 text-rose-300 backdrop-blur">
              <MicOff className="size-3.5" />
            </span>
          ) : null}
          {disconnected ? (
            <span className="rounded-lg bg-black/45 p-1.5 text-amber-300 backdrop-blur">
              <WifiOff className="size-3.5" />
            </span>
          ) : null}
        </span>
      </div>
    </div>
  );
}
