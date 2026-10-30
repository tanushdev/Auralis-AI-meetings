"use client";

import { useMemo, useState } from "react";
import {
  Check,
  Copy,
  Download,
  Loader2,
  Pencil,
  Radio,
  Search,
  X,
} from "lucide-react";
import { Badge, Button, EmptyState, Input, Textarea } from "@/components/ui";
import { api } from "@/lib/api";
import { cn, formatClock } from "@/lib/format";
import type { TranscriptSegment, TranscriptionStatus } from "@/types";

interface Props {
  meetingId: string;
  meetingTitle: string;
  segments: TranscriptSegment[];
  selfId: string | null;
  isHost: boolean;
  transcription: Record<string, TranscriptionStatus>;
  onSeek?: (seconds: number) => void;
  seekHint?: string;
  onSegmentUpdated?: (segment: TranscriptSegment) => void;
}

function transcriptText(segments: TranscriptSegment[]): string {
  return segments
    .map((segment) => `[${formatClock(segment.startSec)}] ${segment.speakerName}: ${segment.text}`)
    .join("\n");
}

export function TranscriptPanel({
  meetingId,
  meetingTitle,
  segments,
  selfId,
  isHost,
  transcription,
  onSeek,
  seekHint,
  onSegmentUpdated,
}: Props) {
  const [query, setQuery] = useState("");
  const [copied, setCopied] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const activeSpeakers = useMemo(
    () =>
      Object.values(transcription).filter(
        (status) => status.state === "active" || status.state === "starting",
      ),
    [transcription],
  );
  const hasError = useMemo(
    () => Object.values(transcription).some((status) => status.state === "error"),
    [transcription],
  );

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return segments;
    return segments.filter(
      (segment) =>
        segment.text.toLowerCase().includes(needle) ||
        segment.speakerName.toLowerCase().includes(needle),
    );
  }, [query, segments]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(transcriptText(segments));
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setError("Clipboard access was blocked by the browser.");
    }
  };

  const download = () => {
    const header = `${meetingTitle}\nTranscript generated locally\n\n`;
    const blob = new Blob([header + transcriptText(segments)], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${meetingTitle.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "meeting"}-transcript.txt`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  const beginEdit = (segment: TranscriptSegment) => {
    setEditingId(segment.segmentId);
    setDraft(segment.text);
    setError(null);
  };

  const saveEdit = async (segment: TranscriptSegment) => {
    if (!draft.trim() || saving) return;
    setSaving(true);
    setError(null);
    try {
      const data = await api<{ segment: TranscriptSegment }>(
        `/api/meetings/${meetingId}/transcript/segments/${encodeURIComponent(segment.segmentId)}`,
        { method: "PATCH", body: { text: draft.trim() } },
      );
      onSegmentUpdated?.(data.segment);
      setEditingId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the correction.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="space-y-2 border-b border-line p-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            {activeSpeakers.length > 0 ? (
              <Badge tone="success" dot>
                Live · {activeSpeakers.length} speaker{activeSpeakers.length === 1 ? "" : "s"}
              </Badge>
            ) : hasError ? (
              <Badge tone="danger" dot>
                Transcription error
              </Badge>
            ) : (
              <Badge tone="neutral">Transcription idle</Badge>
            )}
          </div>
          <div className="flex items-center gap-1">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void copy()}
              disabled={segments.length === 0}
              title="Copy transcript"
            >
              {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={download}
              disabled={segments.length === 0}
              title="Download transcript as TXT"
            >
              <Download className="size-3.5" />
            </Button>
          </div>
        </div>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search this transcript…"
            className="h-9 pl-8 text-xs"
          />
        </div>
        {seekHint ? <p className="text-[11px] text-muted">{seekHint}</p> : null}
        {error ? <p className="text-[11px] text-rose-300">{error}</p> : null}
      </div>

      <div className="min-h-0 flex-1 space-y-1 overflow-y-auto p-2">
        {filtered.length === 0 ? (
          <div className="flex h-full items-center justify-center px-4">
            <EmptyState
              icon={<Radio className="size-6" />}
              title={segments.length === 0 ? "Waiting for speech" : "No matches"}
              description={
                segments.length === 0
                  ? "Live transcription runs locally. Speak and finalized sentences will appear here with speaker names and timestamps."
                  : "Try a different search term."
              }
            />
          </div>
        ) : null}

        {filtered.map((segment) => {
          const canEdit =
            segment.status !== "provisional" &&
            (isHost || segment.participantId === selfId);
          const isEditing = editingId === segment.segmentId;
          return (
            <div
              key={segment.segmentId}
              className={cn(
                "rounded-xl px-2.5 py-2 transition-colors",
                segment.status === "provisional"
                  ? "bg-brand/5"
                  : "hover:bg-white/[0.03]",
              )}
            >
              <div className="flex items-center gap-2">
                <button
                  onClick={() => onSeek?.(segment.startSec)}
                  disabled={!onSeek}
                  className={cn(
                    "rounded font-mono text-[11px]",
                    onSeek
                      ? "bg-brand/15 px-1.5 py-0.5 text-brand-soft hover:bg-brand/25"
                      : "text-muted",
                  )}
                  title={onSeek ? "Seek recording to this moment" : "Timestamp"}
                >
                  {formatClock(segment.startSec)}
                </button>
                <span className="truncate text-xs font-medium text-ink/85">{segment.speakerName}</span>
                {segment.status === "provisional" ? (
                  <span className="inline-flex items-center gap-1 text-[10px] text-brand-soft">
                    <Loader2 className="size-2.5 animate-spin" /> live
                  </span>
                ) : null}
                {segment.status === "edited" ? (
                  <span className="text-[10px] text-amber-300">edited</span>
                ) : null}
                {segment.source === "manual" ? (
                  <span className="text-[10px] text-muted">manual</span>
                ) : null}
                {canEdit && !isEditing ? (
                  <button
                    onClick={() => beginEdit(segment)}
                    className="ml-auto rounded p-1 text-muted opacity-0 transition-opacity hover:bg-white/5 hover:text-ink group-hover:opacity-100"
                    title="Correct this segment"
                  >
                    <Pencil className="size-3" />
                  </button>
                ) : null}
              </div>

              {isEditing ? (
                <div className="mt-2 space-y-2">
                  <Textarea
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    rows={3}
                    className="text-xs"
                  />
                  <div className="flex justify-end gap-2">
                    <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>
                      <X className="size-3.5" /> Cancel
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => void saveEdit(segment)}
                      loading={saving}
                      disabled={!draft.trim()}
                    >
                      <Check className="size-3.5" /> Save
                    </Button>
                  </div>
                </div>
              ) : (
                <p
                  className={cn(
                    "mt-1 text-sm leading-relaxed",
                    segment.status === "provisional" ? "text-ink/60" : "text-ink/90",
                  )}
                >
                  {segment.text}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
