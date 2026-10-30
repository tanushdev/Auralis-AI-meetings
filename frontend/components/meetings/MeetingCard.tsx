"use client";

import Link from "next/link";
import { Check, Clock3, Copy, FileText, Radio, Sparkles, Users, Video } from "lucide-react";
import { useState } from "react";
import { Badge, Button } from "@/components/ui";
import { inviteUrl } from "@/lib/meetings";
import { formatDate, formatDuration, formatRelative } from "@/lib/format";
import type { MeetingListItem } from "@/types";

function statusBadge(meeting: MeetingListItem) {
  if (meeting.status === "active") return <Badge tone="success" dot>Active</Badge>;
  return <Badge tone="neutral">Ended {formatRelative(meeting.endedAt)}</Badge>;
}

function summaryBadge(status: string) {
  switch (status) {
    case "ready":
      return <Badge tone="brand"><Sparkles className="size-3" /> Summary ready</Badge>;
    case "processing":
      return <Badge tone="warning" dot>Summarizing</Badge>;
    case "failed":
      return <Badge tone="danger">Summary failed</Badge>;
    default:
      return <Badge tone="neutral">No summary</Badge>;
  }
}

export function MeetingCard({
  meeting,
  compact = false,
}: {
  meeting: MeetingListItem;
  compact?: boolean;
}) {
  const [copied, setCopied] = useState(false);

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(inviteUrl(meeting.roomId));
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };

  return (
    <article className="panel group relative flex flex-col gap-4 p-4 transition-colors hover:border-brand/35 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            {statusBadge(meeting)}
            {meeting.transcriptAvailable ? (
              <Badge tone="info">
                <FileText className="size-3" /> Transcript
              </Badge>
            ) : null}
          </div>
          <Link
            href={`/meetings/${meeting._id}`}
            className="block truncate text-base font-semibold text-ink transition-colors hover:text-brand-soft"
          >
            {meeting.title}
          </Link>
          <p className="mt-1 font-mono text-[11px] text-muted">{meeting.roomId}</p>
        </div>
        <Link
          href={`/meetings/${meeting._id}`}
          className="flex size-9 shrink-0 items-center justify-center rounded-xl border border-line bg-panel-raised text-muted transition-colors hover:border-brand/40 hover:text-ink"
          aria-label={`Open ${meeting.title}`}
        >
          <Video className="size-4" />
        </Link>
      </div>

      <div className="grid grid-cols-2 gap-2 text-xs text-muted">
        <span className="inline-flex items-center gap-1.5">
          <Clock3 className="size-3.5" />
          {meeting.status === "active"
            ? meeting.startedAt
              ? `Started ${formatRelative(meeting.startedAt)}`
              : "Not started"
            : formatDuration(meeting.duration)}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Users className="size-3.5" />
          {meeting.participantCount} participant{meeting.participantCount === 1 ? "" : "s"}
        </span>
        <span className="col-span-2 text-[11px] text-muted/80">
          Created {formatDate(meeting.createdAt)}
          {meeting.host?.name ? ` · Hosted by ${meeting.host.name}` : ""}
        </span>
      </div>

      {!compact ? (
        <div className="flex flex-wrap items-center gap-1.5 border-t border-line pt-3">
          {summaryBadge(meeting.summaryStatus)}
          {meeting.status === "active" ? (
            <Link
              href={`/meeting/${meeting.roomId}`}
              className="ml-auto inline-flex h-8 items-center gap-1.5 rounded-lg bg-brand px-3 text-xs font-medium text-white transition-colors hover:bg-brand-soft"
            >
              Join room
            </Link>
          ) : (
            <Link
              href={`/meetings/${meeting._id}?tab=summary`}
              className="ml-auto inline-flex h-8 items-center gap-1.5 rounded-lg border border-line bg-panel-raised px-3 text-xs font-medium text-ink transition-colors hover:border-brand/50"
            >
              View summary
            </Link>
          )}
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void copyLink()}
            title="Copy invite link"
            aria-label="Copy invite link"
            className="px-2"
          >
            {copied ? <Check className="size-3.5 text-emerald-300" /> : <Copy className="size-3.5" />}
          </Button>
        </div>
      ) : null}
    </article>
  );
}

export function MeetingCardSkeleton() {
  return (
    <div className="panel animate-pulse space-y-4 p-5">
      <div className="h-4 w-24 rounded bg-white/5" />
      <div className="h-5 w-2/3 rounded bg-white/5" />
      <div className="h-3 w-32 rounded bg-white/5" />
      <div className="grid grid-cols-2 gap-2">
        <div className="h-3 w-24 rounded bg-white/5" />
        <div className="h-3 w-20 rounded bg-white/5" />
      </div>
    </div>
  );
}

export function EmptyMeetings({ onCreate }: { onCreate?: () => void }) {
  return (
    <div className="panel flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
      <span className="flex size-12 items-center justify-center rounded-2xl bg-brand/15 text-brand-soft">
        <Radio className="size-6" />
      </span>
      <p className="text-sm font-medium">No meetings yet</p>
      <p className="max-w-sm text-sm text-muted">
        Create your first room, share the link, and Auralis will transcribe and summarize it locally.
      </p>
      {onCreate ? (
        <Button size="sm" onClick={onCreate} className="mt-1">
          Create a meeting
        </Button>
      ) : null}
    </div>
  );
}
