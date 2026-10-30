"use client";

import { Copy, Crown, Mic, MicOff, MonitorUp, Radio, Video, VideoOff } from "lucide-react";
import { useState } from "react";
import { Avatar, Badge, Button } from "@/components/ui";
import { cn } from "@/lib/format";
import type { ParticipantInfo, TranscriptionStatus } from "@/types";

export function ParticipantsPanel({
  participants,
  selfId,
  transcription,
  inviteLink,
}: {
  participants: ParticipantInfo[];
  selfId: string | null;
  transcription: Record<string, TranscriptionStatus>;
  inviteLink: string;
}) {
  const [copied, setCopied] = useState(false);

  const copyInvite = async () => {
    try {
      await navigator.clipboard.writeText(inviteLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-line p-3">
        <Button variant="secondary" size="sm" className="w-full" onClick={() => void copyInvite()}>
          <Copy className="size-3.5" />
          {copied ? "Link copied" : "Copy invite link"}
        </Button>
      </div>
      <div className="min-h-0 flex-1 space-y-1 overflow-y-auto p-2">
        {participants.map((participant) => {
          const status = transcription[participant.participantId];
          const transcribing = status?.state === "active" || status?.state === "starting";
          return (
            <div
              key={participant.participantId}
              className="flex items-start gap-3 rounded-xl px-2.5 py-2.5 hover:bg-white/[0.03]"
            >
              <Avatar name={participant.name} size={34} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <p className="truncate text-sm font-medium text-ink">
                    {participant.name}
                    {participant.participantId === selfId ? (
                      <span className="ml-1 text-xs font-normal text-muted">(you)</span>
                    ) : null}
                  </p>
                  {participant.isHost ? (
                    <Crown className="size-3.5 shrink-0 text-amber-300" aria-label="Host" />
                  ) : null}
                  {participant.isGuest ? (
                    <Badge tone="neutral" className="ml-1">
                      Guest
                    </Badge>
                  ) : null}
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-muted">
                  <span className="inline-flex items-center gap-1">
                    {participant.media.audio ? (
                      <Mic className="size-3" />
                    ) : (
                      <MicOff className="size-3 text-rose-300" />
                    )}
                    {participant.media.audio ? "Mic on" : "Muted"}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    {participant.media.video ? (
                      <Video className="size-3" />
                    ) : (
                      <VideoOff className="size-3" />
                    )}
                    {participant.media.video ? "Camera" : "No camera"}
                  </span>
                  {participant.media.screen ? (
                    <span className="inline-flex items-center gap-1 text-brand-soft">
                      <MonitorUp className="size-3" /> Sharing
                    </span>
                  ) : null}
                  {participant.recording !== "off" ? (
                    <span className="inline-flex items-center gap-1 text-rose-300">
                      <span
                        className={cn(
                          "size-2 rounded-full bg-rose-400",
                          participant.recording === "recording" && "animate-pulse-soft",
                        )}
                      />
                      {participant.recording === "paused" ? "Recording paused" : "Recording"}
                    </span>
                  ) : null}
                  {transcribing ? (
                    <span
                      className={cn(
                        "inline-flex items-center gap-1",
                        status?.state === "active" ? "text-emerald-300" : "text-amber-300",
                      )}
                    >
                      <Radio className="size-3 animate-pulse-soft" />
                      {status?.state === "active" ? "Transcribing" : "Connecting STT"}
                    </span>
                  ) : null}
                  {status?.state === "error" ? (
                    <span className="text-rose-300">Transcription error</span>
                  ) : null}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <div className="border-t border-line px-3 py-2.5 text-[11px] text-muted">
        {participants.length} participant{participants.length === 1 ? "" : "s"} · mesh limit
        applies
      </div>
    </div>
  );
}
