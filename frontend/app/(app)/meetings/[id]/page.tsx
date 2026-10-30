"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowUpRight,
  CalendarClock,
  Captions,
  Check,
  CheckCircle2,
  ClipboardList,
  Clock3,
  Copy,
  Download,
  FileText,
  Gavel,
  HardDrive,
  HelpCircle,
  ListChecks,
  Loader2,
  MessageSquare,
  Mic,
  MonitorPlay,
  Play,
  RefreshCw,
  Sparkles,
  Square,
  Target,
  Users,
  Video,
  X,
} from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { TranscriptPanel } from "@/components/meeting/TranscriptPanel";
import { Avatar, Badge, Button, Card, EmptyState, Modal, Spinner, Tabs } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { cn, formatBytes, formatClock, formatDate, formatDuration } from "@/lib/format";
import { inviteUrl } from "@/lib/meetings";
import { getRecordingsForMeeting } from "@/lib/indexeddb";
import { useAuthStore } from "@/store/authStore";
import type {
  ChatMessage,
  LocalRecording,
  MeetingDetail,
  Summary,
  TranscriptSegment,
} from "@/types";

type Tab =
  | "overview"
  | "transcript"
  | "summary"
  | "keypoints"
  | "decisions"
  | "actions"
  | "moments"
  | "recording"
  | "chat";

const TABS: Array<{ value: Tab; label: string; icon: React.ReactNode }> = [
  { value: "overview", label: "Overview", icon: <Video className="size-3.5" /> },
  { value: "transcript", label: "Transcript", icon: <FileText className="size-3.5" /> },
  { value: "summary", label: "AI Summary", icon: <Sparkles className="size-3.5" /> },
  { value: "keypoints", label: "Key Points", icon: <Target className="size-3.5" /> },
  { value: "decisions", label: "Decisions", icon: <Gavel className="size-3.5" /> },
  { value: "actions", label: "Action Items", icon: <ListChecks className="size-3.5" /> },
  { value: "moments", label: "Moments", icon: <Clock3 className="size-3.5" /> },
  { value: "recording", label: "Recording", icon: <MonitorPlay className="size-3.5" /> },
  { value: "chat", label: "Chat", icon: <MessageSquare className="size-3.5" /> },
];

const TAB_VALUES = new Set<string>(TABS.map((tab) => tab.value));

interface DetailResponse {
  meeting: MeetingDetail;
}
interface TranscriptResponse {
  transcript: { segments: TranscriptSegment[] } | null;
}
interface SummaryResponse {
  summary: Summary | null;
  meeting: {
    summaryStatus: string;
    summaryError: string | null;
    transcriptionStatus: string;
    transcriptionError: string | null;
    transcriptAvailable: boolean;
    status: string;
  };
}
interface ChatResponse {
  messages: ChatMessage[];
}
interface ServerRecording {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  durationSec: number;
  createdAt: string;
}

function SummaryBullets({ items, empty }: { items: string[]; empty: string }) {
  if (items.length === 0) {
    return (
      <EmptyState
        icon={<CheckCircle2 className="size-6" />}
        title={empty}
        description="Nothing in this category was explicitly stated in the transcript."
      />
    );
  }
  return (
    <ul className="space-y-2">
      {items.map((item, index) => (
        <li
          key={`${index}-${item.slice(0, 30)}`}
          className="flex gap-3 rounded-xl border border-line bg-panel-raised/60 p-3 text-sm text-ink/90"
        >
          <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-brand/15 text-[10px] font-semibold text-brand-soft">
            {index + 1}
          </span>
          <span className="leading-relaxed">{item}</span>
        </li>
      ))}
    </ul>
  );
}

export default function MeetingDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const router = useRouter();
  const user = useAuthStore((state) => state.user);

  const [meeting, setMeeting] = useState<MeetingDetail | null>(null);
  const [segments, setSegments] = useState<TranscriptSegment[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [serverRecordings, setServerRecordings] = useState<ServerRecording[]>([]);
  const [localRecordings, setLocalRecordings] = useState<LocalRecording[]>([]);
  const [recordingUrls, setRecordingUrls] = useState<Record<string, string>>({});
  const [selectedRecordingId, setSelectedRecordingId] = useState<string | null>(null);
  const [pendingSeek, setPendingSeek] = useState<number | null>(null);
  const [tab, setTab] = useState<Tab>("overview");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [ending, setEnding] = useState(false);
  const [endOpen, setEndOpen] = useState(false);
  const [endError, setEndError] = useState<string | null>(null);
  const [summaryBusy, setSummaryBusy] = useState(false);
  const [summaryActionError, setSummaryActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  const isHost = Boolean(user && meeting && meeting.hostId === user.id);
  const selectedRecording = useMemo(
    () => localRecordings.find((recording) => recording.id === selectedRecordingId) ?? null,
    [localRecordings, selectedRecordingId],
  );
  const selectedUrl = selectedRecording ? recordingUrls[selectedRecording.id] : null;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const detail = await api<DetailResponse>(`/api/meetings/${id}`);
      const [transcript, summaryData, chat, recordings] = await Promise.all([
        api<TranscriptResponse>(`/api/meetings/${id}/transcript`),
        api<SummaryResponse>(`/api/meetings/${id}/summary`),
        api<ChatResponse>(`/api/meetings/${id}/chat?limit=200`),
        api<{ recordings: ServerRecording[] }>(`/api/meetings/${id}/recordings`).catch(() => ({
          recordings: [] as ServerRecording[],
        })),
      ]);
      setMeeting(detail.meeting);
      setSegments(transcript.transcript?.segments ?? []);
      setSummary(summaryData.summary);
      setMessages(chat.messages);
      setServerRecordings(recordings.recordings);
      try {
        setLocalRecordings(await getRecordingsForMeeting(detail.meeting._id));
      } catch {
        setLocalRecordings([]);
      }
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : "Could not load this meeting. Check that the backend is running.",
      );
    } finally {
      setLoading(false);
    }
  }, [id]);

  const refreshSummary = useCallback(async () => {
    try {
      const data = await api<SummaryResponse>(`/api/meetings/${id}/summary`);
      setSummary(data.summary);
      setMeeting((current) =>
        current
          ? {
              ...current,
              summaryStatus: data.meeting.summaryStatus,
              summaryError: data.meeting.summaryError,
              transcriptionStatus: data.meeting.transcriptionStatus,
              transcriptionError: data.meeting.transcriptionError,
            }
          : current,
      );
    } catch {
      // Polling failures are non-fatal; the page still shows the last state.
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get("tab");
    if (requested && TAB_VALUES.has(requested)) setTab(requested as Tab);
  }, []);

  useEffect(() => {
    if (!meeting) return;
    if (meeting.summaryStatus !== "processing" && meeting.summaryStatus !== "pending") return;
    const timer = setInterval(() => void refreshSummary(), 8000);
    return () => clearInterval(timer);
  }, [meeting, refreshSummary]);

  useEffect(() => {
    const urls: Record<string, string> = {};
    for (const recording of localRecordings) {
      urls[recording.id] = URL.createObjectURL(recording.blob);
    }
    setRecordingUrls(urls);
    setSelectedRecordingId((current) => current ?? localRecordings[0]?.id ?? null);
    return () => {
      for (const url of Object.values(urls)) URL.revokeObjectURL(url);
    };
  }, [localRecordings]);

  useEffect(() => {
    if (pendingSeek === null) return;
    const video = videoRef.current;
    if (!video) return;
    const apply = () => {
      try {
        video.currentTime = Math.max(0, Math.min(pendingSeek, video.duration || pendingSeek));
        void video.play().catch(() => undefined);
      } catch {
        // Some formats seek asynchronously; loadedmetadata will try again.
      }
      setPendingSeek(null);
    };
    if (video.readyState >= 1) apply();
    else video.addEventListener("loadedmetadata", apply, { once: true });
    return () => video.removeEventListener("loadedmetadata", apply);
  }, [pendingSeek, selectedUrl]);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 5000);
    return () => clearTimeout(timer);
  }, [notice]);

  const copyInvite = async () => {
    if (!meeting) return;
    try {
      await navigator.clipboard.writeText(inviteUrl(meeting.roomId));
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setNotice("Clipboard access was blocked by the browser.");
    }
  };

  const downloadRecording = (recording: LocalRecording) => {
    const url = recordingUrls[recording.id];
    if (!url) return;
    const link = document.createElement("a");
    link.href = url;
    link.download = recording.fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
  };

  const seek = (seconds: number) => {
    if (localRecordings.length === 0) {
      setNotice("No local recording is stored in this browser, so this timestamp cannot be played.");
      return;
    }
    if (!selectedRecordingId) setSelectedRecordingId(localRecordings[0]!.id);
    setPendingSeek(seconds);
    if (tab !== "transcript" && tab !== "recording") setTab("recording");
    setNotice(`Seeking recording to ${formatClock(seconds)}.`);
  };

  const requestSummary = async (mode: "draft" | "final") => {
    setSummaryBusy(true);
    setSummaryActionError(null);
    try {
      if (mode === "draft") {
        const data = await api<{ summary: Summary }>(`/api/meetings/${id}/summarize`, {
          method: "POST",
          body: { mode },
        });
        setSummary(data.summary);
        setNotice("A genuine draft summary was generated from the saved transcript.");
      } else {
        await api(`/api/meetings/${id}/summarize`, { method: "POST", body: { mode: "final" } });
        setMeeting((current) => (current ? { ...current, summaryStatus: "processing" } : current));
        setNotice("Final summary generation started. This can take a while on CPU.");
      }
    } catch (err) {
      setSummaryActionError(
        err instanceof ApiError ? err.message : "The local model could not produce a summary.",
      );
    } finally {
      setSummaryBusy(false);
    }
  };

  const retrySummary = async () => {
    setSummaryBusy(true);
    setSummaryActionError(null);
    try {
      await api(`/api/meetings/${id}/summarize/retry`, { method: "POST" });
      setMeeting((current) => (current ? { ...current, summaryStatus: "processing" } : current));
      setNotice("Retry requested. The final summary will replace the failed attempt.");
    } catch (err) {
      setSummaryActionError(
        err instanceof ApiError ? err.message : "Could not request a summary retry.",
      );
    } finally {
      setSummaryBusy(false);
    }
  };

  const endMeeting = async () => {
    if (!meeting) return;
    setEnding(true);
    setEndError(null);
    try {
      const data = await api<{ meeting: { status: string; endedAt: string; duration: number }; message: string }>(
        `/api/meetings/${meeting._id}/end`,
        { method: "POST" },
      );
      setMeeting((current) =>
        current
          ? {
              ...current,
              status: "ended",
              endedAt: data.meeting.endedAt,
              duration: data.meeting.duration,
              summaryStatus: "processing",
              transcriptionStatus: "finalizing",
            }
          : current,
      );
      setEndOpen(false);
      setNotice(data.message);
    } catch (err) {
      setEndError(
        err instanceof ApiError ? err.message : "Could not end the meeting right now.",
      );
    } finally {
      setEnding(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 text-muted">
        <Spinner className="size-7" />
        <p className="text-sm">Loading meeting, transcript and summary…</p>
      </div>
    );
  }

  if (error || !meeting) {
    return (
      <div className="mx-auto max-w-xl py-16">
        <EmptyState
          icon={<AlertTriangle className="size-7" />}
          title="Meeting unavailable"
          description={error ?? "This meeting could not be found or you do not have access."}
          action={
            <div className="flex gap-2">
              <Button variant="secondary" size="sm" onClick={() => void load()}>
                <RefreshCw className="size-3.5" /> Retry
              </Button>
              <Link href="/meetings">
                <Button size="sm">Back to meetings</Button>
              </Link>
            </div>
          }
        />
      </div>
    );
  }

  const transcriptAvailable = segments.length > 0;
  const summaryProcessing =
    meeting.summaryStatus === "processing" ||
    meeting.summaryStatus === "pending" ||
    summaryBusy;
  const summaryError =
    summaryActionError ??
    (summary?.status === "failed" ? summary.error : null) ??
    meeting.summaryError;

  const tabsWithCounts = TABS.map((item) => ({
    ...item,
    count:
      item.value === "keypoints"
        ? summary?.keyPoints.length
        : item.value === "decisions"
          ? summary?.decisions.length
          : item.value === "actions"
            ? summary?.actionItems.length
            : item.value === "moments"
              ? summary?.importantMoments.length
              : item.value === "chat" && messages.length > 0
                ? messages.length
                : undefined,
  }));

  return (
    <div>
      <Link
        href="/meetings"
        className="mb-4 inline-flex items-center gap-1.5 text-xs text-muted transition-colors hover:text-ink"
      >
        <ArrowLeft className="size-3.5" /> All meetings
      </Link>

      <PageHeader
        eyebrow={meeting.status === "active" ? "Live room" : "Meeting history"}
        title={meeting.title}
        description={`${meeting.status === "active" ? "Started" : "Ended"} ${
          meeting.status === "active" ? formatDate(meeting.startedAt) : formatDate(meeting.endedAt)
        } · ${formatDuration(meeting.duration)} · ${meeting.participantCount} participant${
          meeting.participantCount === 1 ? "" : "s"
        }`}
        actions={
          <>
            <Button variant="secondary" onClick={() => void copyInvite()}>
              {copied ? <Check className="size-4 text-emerald-300" /> : <Copy className="size-4" />}
              {copied ? "Copied" : "Invite link"}
            </Button>
            {meeting.status === "active" ? (
              <Link href={`/meeting/${meeting.roomId}`}>
                <Button>
                  <Video className="size-4" /> Join room
                </Button>
              </Link>
            ) : null}
            {isHost && meeting.status === "active" ? (
              <Button variant="danger" onClick={() => setEndOpen(true)}>
                <Square className="size-3.5" /> End meeting
              </Button>
            ) : null}
          </>
        }
      />

      {notice ? (
        <div className="mb-4 flex items-start justify-between gap-3 rounded-2xl border border-brand/30 bg-brand/10 px-4 py-3 text-xs text-brand-soft">
          <span>{notice}</span>
          <button onClick={() => setNotice(null)} aria-label="Dismiss notice">
            <X className="size-4" />
          </button>
        </div>
      ) : null}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Badge tone={meeting.status === "active" ? "success" : "neutral"} dot>
          {meeting.status === "active" ? "Active" : "Ended"}
        </Badge>
        <Badge tone={meeting.transcriptAvailable ? "info" : "neutral"}>
          <Captions className="size-3" />
          {meeting.transcriptAvailable ? `${segments.length} transcript segments` : "No transcript"}
        </Badge>
        <Badge
          tone={
            meeting.summaryStatus === "ready"
              ? "success"
              : meeting.summaryStatus === "failed"
                ? "danger"
                : meeting.summaryStatus === "processing" || meeting.summaryStatus === "pending"
                  ? "warning"
                  : "neutral"
          }
          dot={meeting.summaryStatus === "processing" || meeting.summaryStatus === "pending"}
        >
          <Sparkles className="size-3" />
          {meeting.summaryStatus === "ready"
            ? "Summary ready"
            : meeting.summaryStatus === "failed"
              ? "Summary failed"
              : meeting.summaryStatus === "processing"
                ? "Summarizing"
                : meeting.summaryStatus === "pending"
                  ? "Summary queued"
                  : "No summary"}
        </Badge>
        <span className="font-mono text-[11px] text-muted">{meeting.roomId}</span>
      </div>

      <Tabs tabs={tabsWithCounts} value={tab} onChange={setTab} className="mb-4" />

      <div className="animate-fade-up">
        {tab === "overview" ? (
          <div className="grid gap-4 lg:grid-cols-[1.3fr_1fr]">
            <Card>
              <h2 className="text-sm font-semibold">Meeting information</h2>
              <dl className="mt-4 grid grid-cols-2 gap-4 text-sm">
                <div>
                  <dt className="text-[11px] uppercase tracking-wide text-muted">Room</dt>
                  <dd className="mt-1 font-mono text-xs">{meeting.roomId}</dd>
                </div>
                <div>
                  <dt className="text-[11px] uppercase tracking-wide text-muted">Duration</dt>
                  <dd className="mt-1">{formatDuration(meeting.duration)}</dd>
                </div>
                <div>
                  <dt className="text-[11px] uppercase tracking-wide text-muted">Started</dt>
                  <dd className="mt-1 text-xs">{formatDate(meeting.startedAt)}</dd>
                </div>
                <div>
                  <dt className="text-[11px] uppercase tracking-wide text-muted">Ended</dt>
                  <dd className="mt-1 text-xs">{formatDate(meeting.endedAt)}</dd>
                </div>
                <div className="col-span-2">
                  <dt className="text-[11px] uppercase tracking-wide text-muted">Host</dt>
                  <dd className="mt-1 flex items-center gap-2 text-xs">
                    <Avatar name={meeting.host?.name ?? "Host"} size={24} />
                    {meeting.host?.name ?? "Host"}
                  </dd>
                </div>
              </dl>

              <div className="mt-5 flex flex-wrap gap-2 border-t border-line pt-4">
                {meeting.status === "active" ? (
                  <Link href={`/meeting/${meeting.roomId}`}>
                    <Button size="sm">
                      <Mic className="size-3.5" /> Open live room
                    </Button>
                  </Link>
                ) : null}
                <Button size="sm" variant="secondary" onClick={() => setTab("transcript")}>
                  <FileText className="size-3.5" /> Read transcript
                </Button>
                <Button size="sm" variant="secondary" onClick={() => setTab("summary")}>
                  <Sparkles className="size-3.5" /> AI summary
                </Button>
              </div>
            </Card>

            <Card>
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold">Participants</h2>
                <span className="text-[11px] text-muted">{meeting.participants.length} total</span>
              </div>
              <div className="mt-3 space-y-1">
                {meeting.participants.length === 0 ? (
                  <p className="py-6 text-center text-xs text-muted">No participant records.</p>
                ) : (
                  meeting.participants.map((participant) => (
                    <div
                      key={participant._id}
                      className="flex items-center gap-3 rounded-xl px-2 py-2 hover:bg-white/[0.03]"
                    >
                      <Avatar name={participant.name} size={30} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-medium">
                          {participant.name}
                          {participant.isGuest ? (
                            <span className="ml-2 text-[10px] font-normal text-muted">guest</span>
                          ) : null}
                        </p>
                        <p className="text-[10px] text-muted">
                          Joined {formatDate(participant.joinedAt)}
                          {participant.leftAt ? ` · left ${formatDate(participant.leftAt)}` : ""}
                        </p>
                      </div>
                      <span className="flex items-center gap-1 text-[10px] text-muted">
                        <Mic className={cn("size-3", participant.mediaState.audio ? "" : "text-rose-300")} />
                        <Video className={cn("size-3", participant.mediaState.video ? "" : "text-rose-300")} />
                      </span>
                    </div>
                  ))
                )}
              </div>
            </Card>

            <Card className="lg:col-span-2">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-sm font-semibold">Processing state</h2>
                <Button size="sm" variant="ghost" onClick={() => void load()}>
                  <RefreshCw className="size-3.5" /> Refresh
                </Button>
              </div>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <div className="rounded-xl border border-line bg-panel-raised/50 p-3">
                  <p className="flex items-center gap-1.5 text-xs font-medium">
                    <Captions className="size-3.5 text-brand-soft" /> Transcription
                  </p>
                  <p className="mt-1 text-[11px] capitalize text-muted">
                    {meeting.transcriptionStatus}
                    {meeting.transcriptionError ? ` · ${meeting.transcriptionError}` : ""}
                  </p>
                </div>
                <div className="rounded-xl border border-line bg-panel-raised/50 p-3">
                  <p className="flex items-center gap-1.5 text-xs font-medium">
                    <Sparkles className="size-3.5 text-brand-soft" /> Summary
                  </p>
                  <p className="mt-1 text-[11px] capitalize text-muted">
                    {meeting.aiProcessed ? "AI processed · " : ""}
                    {meeting.summaryStatus}
                    {meeting.summaryError ? ` · ${meeting.summaryError}` : ""}
                  </p>
                </div>
              </div>
            </Card>
          </div>
        ) : null}

        {tab === "transcript" ? (
          <div className="grid gap-4 lg:grid-cols-[1.25fr_1fr]">
            <Card className="min-h-[520px] overflow-hidden p-0">
              <TranscriptPanel
                meetingId={meeting._id}
                meetingTitle={meeting.title}
                segments={segments}
                selfId={null}
                isHost={isHost}
                transcription={{}}
                onSeek={localRecordings.length > 0 ? seek : undefined}
                seekHint={
                  localRecordings.length > 0
                    ? "Click a timestamp to play the local recording from that moment."
                    : "No local recording is stored in this browser; timestamps remain available as reference."
                }
                onSegmentUpdated={(updated) =>
                  setSegments((current) =>
                    current.map((segment) =>
                      segment.segmentId === updated.segmentId ? updated : segment,
                    ),
                  )
                }
              />
            </Card>

            <div className="space-y-4">
              {selectedUrl ? (
                <Card className="p-0 overflow-hidden">
                  <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
                    <p className="flex items-center gap-1.5 text-xs font-medium">
                      <MonitorPlay className="size-3.5 text-brand-soft" /> Local recording
                    </p>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => selectedRecording && downloadRecording(selectedRecording)}
                    >
                      <Download className="size-3.5" /> Download
                    </Button>
                  </div>
                  <video
                    ref={videoRef}
                    src={selectedUrl}
                    controls
                    className="aspect-video w-full bg-black object-contain"
                    preload="metadata"
                  />
                  <p className="px-4 py-2 text-[11px] text-muted">
                    {selectedRecording?.fileName} · stored only in this browser
                  </p>
                </Card>
              ) : (
                <Card>
                  <EmptyState
                    icon={<HardDrive className="size-6" />}
                    title="No local recording"
                    description="Recording files are saved in this browser's IndexedDB. They are not stored on the server and will not appear on another device."
                    action={
                      <Link href="/recordings">
                        <Button size="sm" variant="secondary">
                          View local recordings
                        </Button>
                      </Link>
                    }
                  />
                </Card>
              )}
              <Card>
                <h3 className="flex items-center gap-2 text-sm font-semibold">
                  <Users className="size-4 text-brand-soft" /> Speakers
                </h3>
                <div className="mt-3 space-y-2">
                  {Array.from(new Map(segments.map((segment) => [segment.speakerName, segment])).values()).map(
                    (segment) => (
                      <div key={segment.speakerName} className="flex items-center gap-2 text-xs">
                        <Avatar name={segment.speakerName} size={24} />
                        <span>{segment.speakerName}</span>
                      </div>
                    ),
                  )}
                  {segments.length === 0 ? (
                    <p className="text-xs text-muted">No finalized transcript was saved.</p>
                  ) : null}
                </div>
              </Card>
            </div>
          </div>
        ) : null}

        {tab === "summary" ? (
          <div className="grid gap-4 lg:grid-cols-[1.5fr_1fr]">
            <Card>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-semibold">Executive summary</h2>
                  {summary ? (
                    <Badge tone={summary.status === "final" ? "success" : "warning"}>
                      {summary.status}
                    </Badge>
                  ) : null}
                </div>
                {isHost ? (
                  <div className="flex items-center gap-2">
                    {meeting.status === "active" ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        loading={summaryBusy}
                        onClick={() => void requestSummary("draft")}
                        disabled={!transcriptAvailable}
                      >
                        <Sparkles className="size-3.5" /> Draft summary
                      </Button>
                    ) : meeting.summaryStatus === "failed" ? (
                      <Button size="sm" variant="secondary" loading={summaryBusy} onClick={() => void retrySummary()}>
                        <RefreshCw className="size-3.5" /> Retry final
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="secondary"
                        loading={summaryBusy}
                        onClick={() => void requestSummary("final")}
                        disabled={!transcriptAvailable || summaryProcessing}
                      >
                        <Sparkles className="size-3.5" /> Generate final
                      </Button>
                    )}
                  </div>
                ) : null}
              </div>

              {summaryProcessing ? (
                <div className="mt-4 flex items-center gap-2 rounded-xl border border-brand/30 bg-brand/10 p-3 text-xs text-brand-soft">
                  <Loader2 className="size-4 animate-spin" />
                  {meeting.summaryStatus === "pending"
                    ? "The final summary is queued. It starts after the last transcription windows flush."
                    : "Generating a summary locally with Ollama. This can take several minutes on CPU."}
                </div>
              ) : null}

              {summaryError ? (
                <div className="mt-4 rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-200">
                  <p className="flex items-start gap-1.5">
                    <AlertTriangle className="mt-0.5 size-3.5 shrink-0" /> {summaryError}
                  </p>
                  {isHost ? (
                    <Button
                      size="sm"
                      variant="danger"
                      className="mt-2"
                      loading={summaryBusy}
                      onClick={() => void retrySummary()}
                    >
                      <RefreshCw className="size-3.5" /> Try again
                    </Button>
                  ) : null}
                </div>
              ) : null}

              {summary?.incompleteTranscript ? (
                <p className="mt-4 rounded-xl border border-amber-500/25 bg-amber-500/10 p-2.5 text-[11px] text-amber-200">
                  This summary is based on an incomplete transcript. It may omit the end of the
                  meeting.
                </p>
              ) : null}

              {summary ? (
                <div className="mt-4 space-y-4">
                  <div className="rounded-2xl border border-line bg-panel-raised/50 p-4">
                    <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink/90">
                      {summary.executiveSummary || "The model returned no executive summary."}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="secondary" onClick={() => setTab("keypoints")}>
                      <Target className="size-3.5" /> {summary.keyPoints.length} key points
                    </Button>
                    <Button size="sm" variant="secondary" onClick={() => setTab("decisions")}>
                      <Gavel className="size-3.5" /> {summary.decisions.length} decisions
                    </Button>
                    <Button size="sm" variant="secondary" onClick={() => setTab("actions")}>
                      <ListChecks className="size-3.5" /> {summary.actionItems.length} actions
                    </Button>
                    <Button size="sm" variant="secondary" onClick={() => setTab("moments")}>
                      <Clock3 className="size-3.5" /> {summary.importantMoments.length} moments
                    </Button>
                  </div>
                </div>
              ) : !summaryProcessing && !summaryError ? (
                <div className="mt-4">
                  <EmptyState
                    icon={<Sparkles className="size-6" />}
                    title="No summary generated"
                    description={
                      transcriptAvailable
                        ? "The host can generate a summary from the finalized transcript. Final summaries run automatically after a meeting ends."
                        : "A summary cannot be generated until speech has been transcribed."
                    }
                  />
                </div>
              ) : null}

              {summary ? (
                <div className="mt-4 border-t border-line pt-3 text-[11px] text-muted">
                  {summary.model} · generated {formatDate(summary.generatedAt)} from{" "}
                  {summary.basedOnSegmentCount} segment{summary.basedOnSegmentCount === 1 ? "" : "s"}
                </div>
              ) : null}
            </Card>

            <div className="space-y-4">
              <Card>
                <h3 className="flex items-center gap-2 text-sm font-semibold">
                  <CheckCircle2 className="size-4 text-emerald-300" /> How this was produced
                </h3>
                <p className="mt-2 text-xs leading-relaxed text-muted">
                  The transcript is chunked, analysed and consolidated by a local Ollama model. The
                  JSON response is validated with Zod, and one repair attempt is made before the
                  summary is rejected. No fabricated fallback is shown.
                </p>
              </Card>
              <Card>
                <h3 className="flex items-center gap-2 text-sm font-semibold">
                  <HelpCircle className="size-4 text-brand-soft" /> Open questions
                </h3>
                <div className="mt-3">
                  <SummaryBullets
                    items={summary?.openQuestions ?? []}
                    empty="No open questions"
                  />
                </div>
              </Card>
            </div>
          </div>
        ) : null}

        {tab === "keypoints" ? (
          <Card>
            <div className="flex items-center justify-between">
              <div>
                <h2 className="flex items-center gap-2 text-sm font-semibold">
                  <Target className="size-4 text-brand-soft" /> Key points
                </h2>
                <p className="mt-1 text-xs text-muted">Grounded in explicitly discussed topics.</p>
              </div>
              {summary ? <Badge tone="neutral">{summary.keyPoints.length}</Badge> : null}
            </div>
            <div className="mt-4">
              <SummaryBullets items={summary?.keyPoints ?? []} empty="No key points available" />
            </div>
          </Card>
        ) : null}

        {tab === "decisions" ? (
          <Card>
            <div className="flex items-center justify-between">
              <div>
                <h2 className="flex items-center gap-2 text-sm font-semibold">
                  <Gavel className="size-4 text-brand-soft" /> Confirmed decisions
                </h2>
                <p className="mt-1 text-xs text-muted">
                  Suggestions and unresolved proposals are intentionally excluded.
                </p>
              </div>
              {summary ? <Badge tone="neutral">{summary.decisions.length}</Badge> : null}
            </div>
            <div className="mt-4">
              <SummaryBullets
                items={summary?.decisions ?? []}
                empty="No confirmed decisions"
              />
            </div>
          </Card>
        ) : null}

        {tab === "actions" ? (
          <Card>
            <div className="flex items-center justify-between">
              <div>
                <h2 className="flex items-center gap-2 text-sm font-semibold">
                  <ListChecks className="size-4 text-brand-soft" /> Action items
                </h2>
                <p className="mt-1 text-xs text-muted">
                  Assignees and deadlines are null when the transcript did not state them.
                </p>
              </div>
              {summary ? <Badge tone="neutral">{summary.actionItems.length}</Badge> : null}
            </div>

            {summary && summary.actionItems.length > 0 ? (
              <ul className="mt-4 space-y-2">
                {summary.actionItems.map((item, index) => (
                  <li
                    key={`${index}-${item.task.slice(0, 30)}`}
                    className="rounded-xl border border-line bg-panel-raised/60 p-4"
                  >
                    <p className="flex items-start gap-2 text-sm text-ink/90">
                      <ClipboardList className="mt-0.5 size-4 shrink-0 text-emerald-300" />
                      {item.task}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-4 pl-6 text-[11px] text-muted">
                      <span>
                        Assignee:{" "}
                        <span className={item.assignee ? "text-ink/80" : "italic"}>
                          {item.assignee ?? "not specified"}
                        </span>
                      </span>
                      <span>
                        Deadline:{" "}
                        <span className={item.deadline ? "text-ink/80" : "italic"}>
                          {item.deadline ?? "not specified"}
                        </span>
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="mt-4">
                <SummaryBullets items={[]} empty="No action items available" />
              </div>
            )}
          </Card>
        ) : null}

        {tab === "moments" ? (
          <Card>
            <div className="flex items-center justify-between">
              <div>
                <h2 className="flex items-center gap-2 text-sm font-semibold">
                  <Clock3 className="size-4 text-brand-soft" /> Important moments
                </h2>
                <p className="mt-1 text-xs text-muted">
                  {localRecordings.length > 0
                    ? "Click a timestamp to open the local recording at that moment."
                    : "No local recording is stored in this browser; timestamps are reference only."}
                </p>
              </div>
              {summary ? <Badge tone="neutral">{summary.importantMoments.length}</Badge> : null}
            </div>
            <div className="mt-4 space-y-2">
              {summary && summary.importantMoments.length > 0 ? (
                summary.importantMoments.map((moment, index) => (
                  <div
                    key={`${index}-${moment.time}`}
                    className="flex gap-3 rounded-xl border border-line bg-panel-raised/60 p-3"
                  >
                    <button
                      onClick={() => seek(moment.time)}
                      className="inline-flex h-7 shrink-0 items-center gap-1 rounded-lg bg-brand/15 px-2 font-mono text-[11px] text-brand-soft transition-colors hover:bg-brand/25"
                    >
                      <Play className="size-3" /> {formatClock(moment.time)}
                    </button>
                    <p className="text-sm leading-relaxed text-ink/90">{moment.description}</p>
                  </div>
                ))
              ) : (
                <SummaryBullets items={[]} empty="No important moments available" />
              )}
            </div>
          </Card>
        ) : null}

        {tab === "recording" ? (
          <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
            <Card className="overflow-hidden p-0">
              <div className="flex items-center justify-between border-b border-line p-3">
                <div>
                  <h2 className="text-sm font-semibold">Local recording</h2>
                  <p className="text-[11px] text-muted">Stored in this browser's IndexedDB.</p>
                </div>
                {selectedRecording ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => downloadRecording(selectedRecording)}
                  >
                    <Download className="size-3.5" /> Download
                  </Button>
                ) : null}
              </div>
              {selectedUrl ? (
                <>
                  <video
                    ref={videoRef}
                    src={selectedUrl}
                    controls
                    className="aspect-video w-full bg-black object-contain"
                    preload="metadata"
                  />
                  <div className="border-t border-line p-3 text-[11px] text-muted">
                    {selectedRecording?.fileName} · {formatBytes(selectedRecording?.sizeBytes ?? 0)} ·{" "}
                    {formatClock(selectedRecording?.durationSec ?? 0)} recorded
                  </div>
                </>
              ) : (
                <div className="p-4">
                  <EmptyState
                    icon={<HardDrive className="size-6" />}
                    title="No local recording in this browser"
                    description="Recording is opt-in and local-only. If another participant recorded the meeting, their file is not available here."
                    action={
                      meeting.status === "active" ? (
                        <Link href={`/meeting/${meeting.roomId}`}>
                          <Button size="sm">Join and record</Button>
                        </Link>
                      ) : undefined
                    }
                  />
                </div>
              )}
            </Card>

            <div className="space-y-4">
              <Card>
                <h3 className="text-sm font-semibold">Files in this browser</h3>
                <div className="mt-3 space-y-2">
                  {localRecordings.length === 0 ? (
                    <p className="text-xs text-muted">No local files for this meeting.</p>
                  ) : (
                    localRecordings.map((recording) => (
                      <button
                        key={recording.id}
                        onClick={() => setSelectedRecordingId(recording.id)}
                        className={cn(
                          "flex w-full items-center gap-3 rounded-xl border p-3 text-left transition-colors",
                          selectedRecordingId === recording.id
                            ? "border-brand/40 bg-brand/10"
                            : "border-line bg-panel-raised/50 hover:border-brand/25",
                        )}
                      >
                        <MonitorPlay className="size-4 shrink-0 text-brand-soft" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs font-medium">{recording.fileName}</p>
                          <p className="text-[10px] text-muted">
                            {formatBytes(recording.sizeBytes)} · {formatClock(recording.durationSec)}
                          </p>
                        </div>
                      </button>
                    ))
                  )}
                </div>
              </Card>

              <Card>
                <h3 className="text-sm font-semibold">Recording metadata</h3>
                <p className="mt-1 text-[11px] text-muted">
                  MongoDB stores only size, MIME type and duration — never the video blob.
                </p>
                <div className="mt-3 space-y-2">
                  {serverRecordings.length === 0 ? (
                    <p className="text-xs text-muted">No metadata records.</p>
                  ) : (
                    serverRecordings.map((recording) => (
                      <div
                        key={recording.id}
                        className="rounded-xl border border-line bg-panel-raised/50 p-3"
                      >
                        <p className="truncate text-xs font-medium">{recording.fileName}</p>
                        <p className="mt-1 text-[10px] text-muted">
                          {formatBytes(recording.sizeBytes)} · {formatClock(recording.durationSec)} ·{" "}
                          {formatDate(recording.createdAt)}
                        </p>
                      </div>
                    ))
                  )}
                </div>
              </Card>
            </div>
          </div>
        ) : null}

        {tab === "chat" ? (
          <Card className="p-0">
            <div className="flex items-center justify-between border-b border-line p-4">
              <div>
                <h2 className="flex items-center gap-2 text-sm font-semibold">
                  <MessageSquare className="size-4 text-brand-soft" /> Meeting chat
                </h2>
                <p className="mt-1 text-[11px] text-muted">
                  Persisted with the meeting and visible to everyone with access.
                </p>
              </div>
              <Badge tone="neutral">{messages.length} messages</Badge>
            </div>
            <div className="max-h-[560px] space-y-4 overflow-y-auto p-4">
              {messages.length === 0 ? (
                <p className="py-12 text-center text-xs text-muted">No chat messages were sent.</p>
              ) : (
                messages.map((message) => (
                  <div key={message.id} className="flex gap-3">
                    <Avatar name={message.senderName} size={30} />
                    <div>
                      <div className="flex items-center gap-2 text-[11px] text-muted">
                        <span className="font-medium text-ink/85">{message.senderName}</span>
                        <span>{formatDate(message.createdAt)}</span>
                      </div>
                      <p className="mt-1 whitespace-pre-wrap break-words rounded-xl border border-line bg-panel-raised px-3 py-2 text-sm text-ink/90">
                        {message.message}
                      </p>
                    </div>
                  </div>
                ))
              )}
            </div>
          </Card>
        ) : null}
      </div>

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4 text-[11px] text-muted">
        <span className="inline-flex items-center gap-1.5">
          <CalendarClock className="size-3.5" /> Meeting id {meeting._id}
        </span>
        {isHost && meeting.status === "ended" && meeting.summaryStatus === "failed" ? (
          <Button size="sm" variant="secondary" loading={summaryBusy} onClick={() => void retrySummary()}>
            <RefreshCw className="size-3.5" /> Retry final summary
          </Button>
        ) : null}
      </div>

      <Modal
        open={endOpen}
        onClose={() => {
          if (!ending) setEndOpen(false);
        }}
        title="End meeting for everyone?"
        description="Participants will be disconnected after a short flush. The final summary starts when transcription is finalized."
        footer={
          <>
            <Button variant="ghost" onClick={() => setEndOpen(false)} disabled={ending}>
              Cancel
            </Button>
            <Button variant="danger" loading={ending} onClick={() => void endMeeting()}>
              <Square className="size-3.5" /> End meeting
            </Button>
          </>
        }
      >
        {endError ? (
          <p className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
            {endError}
          </p>
        ) : (
          <p className="text-sm text-muted">
            This closes the room for every participant, including guests. The transcript and summary
            stay available in history.
          </p>
        )}
      </Modal>
    </div>
  );
}
