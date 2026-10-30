"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowUpRight,
  Captions,
  FileText,
  RefreshCw,
  Search,
  Users,
  X,
} from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { TranscriptPanel } from "@/components/meeting/TranscriptPanel";
import { Avatar, Badge, Button, Card, EmptyState, Input, Spinner } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { cn, formatDate, formatDuration } from "@/lib/format";
import type { MeetingListItem, TranscriptSegment } from "@/types";

interface TranscriptListResponse {
  meetings: MeetingListItem[];
}
interface TranscriptResponse {
  transcript: { segments: TranscriptSegment[]; language: string | null; model: string } | null;
}

export default function TranscriptsPage() {
  const [meetings, setMeetings] = useState<MeetingListItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [segments, setSegments] = useState<TranscriptSegment[]>([]);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api<TranscriptListResponse>("/api/transcripts?limit=50");
      setMeetings(data.meetings);
      setSelectedId((current) => {
        if (current && data.meetings.some((meeting) => meeting._id === current)) return current;
        return data.meetings[0]?._id ?? null;
      });
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : "Could not load transcripts. Check that the backend is running.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!selectedId) {
      setSegments([]);
      return;
    }
    let cancelled = false;
    setPreviewLoading(true);
    setPreviewError(null);
    void api<TranscriptResponse>(`/api/meetings/${selectedId}/transcript`)
      .then((data) => {
        if (!cancelled) setSegments(data.transcript?.segments ?? []);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setPreviewError(err instanceof Error ? err.message : "Could not load this transcript.");
          setSegments([]);
        }
      })
      .finally(() => {
        if (!cancelled) setPreviewLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return meetings;
    return meetings.filter(
      (meeting) =>
        meeting.title.toLowerCase().includes(needle) ||
        meeting.roomId.toLowerCase().includes(needle),
    );
  }, [meetings, query]);

  const selected = meetings.find((meeting) => meeting._id === selectedId) ?? null;
  const speakerCount = new Set(segments.map((segment) => segment.speakerName)).size;

  return (
    <div>
      <PageHeader
        eyebrow="Speech archive"
        title="Transcripts"
        description="Speaker-attributed transcripts from your meetings. Search inside a transcript by keyword or speaker."
        actions={
          <Button variant="secondary" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={cn("size-4", loading && "animate-spin")} /> Refresh
          </Button>
        }
      />

      {error ? (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber-500/25 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
          <span>{error}</span>
          <Button size="sm" variant="secondary" onClick={() => void load()}>
            Retry
          </Button>
        </div>
      ) : null}

      {loading ? (
        <div className="flex min-h-[40vh] items-center justify-center">
          <Spinner className="size-7" />
        </div>
      ) : meetings.length === 0 ? (
        <EmptyState
          icon={<FileText className="size-7" />}
          title="No transcripts yet"
          description="Transcripts are created automatically while you speak in a meeting. Join a room with a working microphone and the local transcription service."
          action={
            <Link href="/dashboard">
              <Button size="sm">Go to dashboard</Button>
            </Link>
          }
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[330px_1fr]">
          <Card className="p-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Find a meeting…"
                className="h-9 pl-8 pr-8 text-xs"
              />
              {query ? (
                <button
                  onClick={() => setQuery("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted hover:text-ink"
                  aria-label="Clear meeting search"
                >
                  <X className="size-3.5" />
                </button>
              ) : null}
            </div>
            <p className="px-1 pb-2 pt-3 text-[10px] uppercase tracking-wide text-muted">
              {filtered.length} transcript{filtered.length === 1 ? "" : "s"}
            </p>
            <div className="max-h-[590px] space-y-1 overflow-y-auto">
              {filtered.length === 0 ? (
                <p className="px-2 py-6 text-center text-xs text-muted">No meetings match.</p>
              ) : (
                filtered.map((meeting) => (
                  <button
                    key={meeting._id}
                    onClick={() => setSelectedId(meeting._id)}
                    className={cn(
                      "w-full rounded-xl border px-3 py-2.5 text-left transition-colors",
                      selectedId === meeting._id
                        ? "border-brand/40 bg-brand/10"
                        : "border-transparent hover:bg-white/[0.03]",
                    )}
                  >
                    <p className="truncate text-xs font-medium text-ink">{meeting.title}</p>
                    <p className="mt-1 text-[10px] text-muted">
                      {formatDate(meeting.startedAt ?? meeting.createdAt)} ·{" "}
                      {formatDuration(meeting.duration)}
                    </p>
                    <div className="mt-1.5 flex items-center gap-2">
                      <Badge tone="info">
                        <Captions className="size-2.5" /> Transcript
                      </Badge>
                    </div>
                  </button>
                ))
              )}
            </div>
          </Card>

          <Card className="min-h-[640px] overflow-hidden p-0">
            {!selected ? (
              <EmptyState
                icon={<Captions className="size-6" />}
                title="Select a transcript"
                description="Choose a meeting on the left to search its speaker-attributed segments."
              />
            ) : (
              <div className="flex h-full flex-col">
                <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line p-4">
                  <div className="min-w-0">
                    <h2 className="truncate text-sm font-semibold">{selected.title}</h2>
                    <p className="mt-1 text-[11px] text-muted">
                      {formatDate(selected.startedAt ?? selected.createdAt)} ·{" "}
                      {formatDuration(selected.duration)} · {speakerCount} speaker
                      {speakerCount === 1 ? "" : "s"}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {Array.from(new Set(segments.map((segment) => segment.speakerName))).map(
                        (speaker) => (
                          <span
                            key={speaker}
                            className="inline-flex items-center gap-1 rounded-full border border-line bg-panel-raised px-2 py-0.5 text-[10px] text-muted"
                          >
                            <Avatar name={speaker} size={14} /> {speaker}
                          </span>
                        ),
                      )}
                    </div>
                  </div>
                  <Link
                    href={`/meetings/${selected._id}?tab=transcript`}
                    className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-xl border border-line bg-panel-raised px-3 text-xs text-ink transition-colors hover:border-brand/50"
                  >
                    Open meeting <ArrowUpRight className="size-3.5" />
                  </Link>
                </div>

                {previewLoading ? (
                  <div className="flex flex-1 items-center justify-center">
                    <Spinner />
                  </div>
                ) : previewError ? (
                  <div className="p-4">
                    <EmptyState
                      icon={<FileText className="size-6" />}
                      title="Transcript unavailable"
                      description={previewError}
                      action={
                        <Button size="sm" variant="secondary" onClick={() => setSelectedId(selected._id)}>
                          Retry
                        </Button>
                      }
                    />
                  </div>
                ) : (
                  <div className="min-h-0 flex-1">
                    <TranscriptPanel
                      meetingId={selected._id}
                      meetingTitle={selected.title}
                      segments={segments}
                      selfId={null}
                      isHost={false}
                      transcription={{}}
                      seekHint="Open the meeting to play a local recording. Transcript search runs in this browser."
                    />
                  </div>
                )}
              </div>
            )}
          </Card>
        </div>
      )}

      <div className="mt-6 flex flex-wrap items-center gap-3 text-[11px] text-muted">
        <span className="inline-flex items-center gap-1.5">
          <Users className="size-3.5" /> Speaker attribution comes from the authenticated microphone
          stream.
        </span>
        <span className="inline-flex items-center gap-1.5">
          <FileText className="size-3.5" /> Export individual transcripts from the panel menu.
        </span>
      </div>
    </div>
  );
}
