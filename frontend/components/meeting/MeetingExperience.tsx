"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  AudioLines,
  Captions,
  Check,
  Copy,
  Download,
  Loader2,
  Mic,
  MicOff,
  MonitorOff,
  MonitorUp,
  Pause,
  Play,
  Radio,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Square,
  Users,
  Video,
  VideoOff,
  Wifi,
  WifiOff,
  X,
} from "lucide-react";
import { Logo } from "@/components/Logo";
import { ChatPanel } from "@/components/meeting/ChatPanel";
import { ControlBar, type SidePanel } from "@/components/meeting/ControlBar";
import { ParticipantsPanel } from "@/components/meeting/ParticipantsPanel";
import { SummaryPanel } from "@/components/meeting/SummaryPanel";
import { TranscriptPanel } from "@/components/meeting/TranscriptPanel";
import { VideoTile } from "@/components/meeting/VideoTile";
import { Avatar, Badge, Button, Card, Input, Label, Modal, Select, Spinner } from "@/components/ui";
import { useAudioCapture } from "@/hooks/useAudioCapture";
import { useMediaDevices } from "@/hooks/useMediaDevices";
import { useMeetingTimer } from "@/hooks/useMeetingTimer";
import { useRecorder, type RecordingOutput } from "@/hooks/useRecorder";
import { useSignaling, type RoomJoinedPayload } from "@/hooks/useSignaling";
import { useWebRTC } from "@/hooks/useWebRTC";
import { api, ApiError } from "@/lib/api";
import { cn, formatBytes, formatClock, formatDate } from "@/lib/format";
import { inviteUrl } from "@/lib/meetings";
import { saveRecording } from "@/lib/indexeddb";
import { useAuthStore } from "@/store/authStore";
import { useMeetingStore, type SummaryUiState } from "@/store/meetingStore";
import type {
  ChatMessage,
  MediaState,
  ParticipantInfo,
  RoomPublic,
  Summary,
  TranscriptSegment,
  TranscriptionStatus,
} from "@/types";

type Stage = "lobby" | "joining" | "joined" | "ended" | "left";
type Notice = { tone: "info" | "error"; text: string };

interface ChatResponse {
  messages: ChatMessage[];
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
  };
}

function mapConnection(status: ReturnType<typeof useSignaling>["status"]) {
  switch (status) {
    case "connected":
      return "connected" as const;
    case "connecting":
      return "connecting" as const;
    case "reconnecting":
      return "reconnecting" as const;
    case "disconnected":
      return "disconnected" as const;
    default:
      return "idle" as const;
  }
}

function transcriptSignature(segments: TranscriptSegment[]): string {
  return segments.map((segment) => `${segment.segmentId}:${segment.text}`).join("|");
}

export function MeetingExperience({
  room,
  displayName,
  isGuest,
}: {
  room: RoomPublic;
  displayName: string;
  isGuest: boolean;
}) {
  const router = useRouter();
  const user = useAuthStore((state) => state.user);

  const connection = useMeetingStore((state) => state.connection);
  const connectionError = useMeetingStore((state) => state.connectionError);
  const self = useMeetingStore((state) => state.self);
  const meeting = useMeetingStore((state) => state.meeting);
  const participants = useMeetingStore((state) => state.participants);
  const messages = useMeetingStore((state) => state.messages);
  const segments = useMeetingStore((state) => state.segments);
  const transcription = useMeetingStore((state) => state.transcription);
  const summary = useMeetingStore((state) => state.summary);
  const summaryState = useMeetingStore((state) => state.summaryState);
  const ended = useMeetingStore((state) => state.ended);

  const [stage, setStage] = useState<Stage>("lobby");
  const [consent, setConsent] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [activePanel, setActivePanel] = useState<SidePanel>(null);
  const [unreadChat, setUnreadChat] = useState(0);
  const [participantStreams, setParticipantStreams] = useState<Record<string, MediaStream>>({});
  const [peerStates, setPeerStates] = useState<Record<string, RTCPeerConnectionState>>({});
  const [transcriptionError, setTranscriptionError] = useState<string | null>(null);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [endingForAll, setEndingForAll] = useState(false);
  const [endError, setEndError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [recordingSaved, setRecordingSaved] = useState<string | null>(null);
  const [recordingError, setRecordingError] = useState<string | null>(null);
  const [recordingMetadataError, setRecordingMetadataError] = useState<string | null>(null);
  const [summaryBusy, setSummaryBusy] = useState(false);

  const stageRef = useRef<Stage>("lobby");
  const joinedRef = useRef(false);
  const selfRef = useRef<ParticipantInfo | null>(null);
  const panelRef = useRef<SidePanel>(null);
  const sendRef = useRef<((event: Record<string, unknown>) => boolean) | null>(null);
  const disconnectRef = useRef<(() => void) | null>(null);
  const webRTCRef = useRef<ReturnType<typeof useWebRTC> | null>(null);
  const mediaRef = useRef<ReturnType<typeof useMediaDevices> | null>(null);
  const audioRef = useRef<ReturnType<typeof useAudioCapture> | null>(null);
  const recorderRef = useRef<ReturnType<typeof useRecorder> | null>(null);
  const historyTokenRef = useRef(0);

  const isHost = Boolean(user && meeting?.hostId === user.id);
  const meetingStartedAt = meeting?.startedAt ?? room.startedAt;
  const elapsed = useMeetingTimer(meetingStartedAt);
  const inviteLink = inviteUrl(room.roomId);
  const joined = stage === "joined";

  const pushNotice = useCallback((text: string, tone: Notice["tone"] = "info") => {
    setNotice({ text, tone });
  }, []);

  const updateStage = useCallback((next: Stage) => {
    stageRef.current = next;
    setStage(next);
  }, []);

  const teardown = useCallback(
    (next: Stage) => {
      joinedRef.current = false;
      if (recorderRef.current?.recording) {
        try {
          recorderRef.current.stop();
        } catch {
          // ignore
        }
      }
      audioRef.current?.stop(false);
      disconnectRef.current?.();
      if (mediaRef.current?.screenStream) mediaRef.current.stopScreenShare();
      mediaRef.current?.stop();
      useMeetingStore.getState().setConnection("idle");
      updateStage(next);
    },
    [updateStage],
  );

  const publishMedia = useCallback((overrides: Partial<MediaState> = {}) => {
    if (!joinedRef.current) return;
    const media = mediaRef.current;
    const stream = media?.streamRef.current ?? media?.stream ?? null;
    const audioTrack = stream?.getAudioTracks()[0] ?? null;
    const videoTrack = stream?.getVideoTracks()[0] ?? null;
    const state: MediaState = {
      audio: overrides.audio ?? Boolean(audioTrack?.enabled),
      video: overrides.video ?? Boolean(videoTrack?.enabled),
      screen: overrides.screen ?? Boolean(media?.screenRef.current),
    };
    sendRef.current?.({ type: "MEDIA_STATE", media: state });
    const current = selfRef.current;
    if (current) {
      const nextSelf = { ...current, media: state };
      selfRef.current = nextSelf;
      useMeetingStore.getState().setSelf(nextSelf);
    }
  }, []);

  const startTranscription = useCallback((streamOverride?: MediaStream | null) => {
    if (!joinedRef.current) return;
    const media = mediaRef.current;
    const stream = streamOverride ?? media?.streamRef.current ?? media?.stream ?? null;
    const track = stream?.getAudioTracks()[0];
    if (!stream || !track?.enabled) return;
    setTranscriptionError(null);
    void audioRef.current?.start(stream);
  }, []);

  const loadHistory = useCallback(async (meetingId: string) => {
    const token = historyTokenRef.current + 1;
    historyTokenRef.current = token;
    const [chatResult, transcriptResult, summaryResult] = await Promise.allSettled([
      api<ChatResponse>(`/api/meetings/${meetingId}/chat?limit=200`),
      api<TranscriptResponse>(`/api/meetings/${meetingId}/transcript`),
      api<SummaryResponse>(`/api/meetings/${meetingId}/summary`),
    ]);
    if (historyTokenRef.current !== token) return;
    const store = useMeetingStore.getState();

    if (chatResult.status === "fulfilled") {
      const map = new Map<string, ChatMessage>();
      for (const message of chatResult.value.messages) map.set(message.id, message);
      for (const message of store.messages) map.set(message.id, message);
      store.setMessages(
        Array.from(map.values()).sort(
          (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
        ),
      );
    }
    if (transcriptResult.status === "fulfilled") {
      const map = new Map<string, TranscriptSegment>();
      for (const segment of transcriptResult.value.transcript?.segments ?? []) {
        map.set(segment.segmentId, segment);
      }
      for (const segment of store.segments) map.set(segment.segmentId, segment);
      store.setSegments(Array.from(map.values()));
    }
    if (summaryResult.status === "fulfilled") {
      const data = summaryResult.value;
      if (data.summary) {
        store.setSummary(data.summary);
        store.setSummaryState({
          state: data.summary.status === "failed" ? "error" : "ready",
          mode: data.summary.status === "final" ? "final" : "draft",
          message: data.summary.error ?? undefined,
        });
      } else if (
        data.meeting.summaryStatus === "processing" ||
        data.meeting.summaryStatus === "pending"
      ) {
        store.setSummaryState({ state: "processing", mode: "final" });
      }
    }
  }, []);

  const signaling = useSignaling({
    onRoomJoined: (payload: RoomJoinedPayload) => {
      joinedRef.current = true;
      selfRef.current = payload.self;
      const store = useMeetingStore.getState();
      store.setConnection("connected");
      store.setMeeting(payload.meeting);
      store.setSelf(payload.self);
      store.setParticipants(payload.participants);
      store.setEnded(false);
      // Apply the local tracks before creating peers. Otherwise the first offer
      // is sent receive-only and an immediate second offer races it while the
      // first negotiation is still in `have-local-offer`.
      const stream = mediaRef.current?.streamRef.current ?? mediaRef.current?.stream ?? null;
      webRTCRef.current?.setLocalStream(stream);
      webRTCRef.current?.handleRoomJoined(payload);
      setJoinError(null);
      setTranscriptionError(null);
      updateStage("joined");
      publishMedia();
      const recorderState = recorderRef.current?.recording
        ? recorderRef.current.paused
          ? "paused"
          : "recording"
        : "off";
      sendRef.current?.({ type: "RECORDING_STATE", state: recorderState });
      store.setRecordingState(payload.self.participantId, recorderState);
      if (mediaRef.current?.audioEnabled) startTranscription(stream);
      void loadHistory(payload.meeting.id);
    },
    onPeerJoined: (participant) => {
      useMeetingStore.getState().upsertParticipant(participant);
      webRTCRef.current?.handlePeerJoined(participant);
    },
    onPeerLeft: (participantId) => {
      useMeetingStore.getState().removeParticipant(participantId);
      setParticipantStreams((current) => {
        const next = { ...current };
        delete next[participantId];
        return next;
      });
      setPeerStates((current) => {
        const next = { ...current };
        delete next[participantId];
        return next;
      });
    },
    onOffer: (from, sdp) => {
      void webRTCRef.current?.handleOffer(from, sdp);
    },
    onAnswer: (from, sdp) => {
      void webRTCRef.current?.handleAnswer(from, sdp);
    },
    onIceCandidate: (from, candidate) => {
      void webRTCRef.current?.handleIce(from, candidate);
    },
    onRoomState: (list) => {
      const selfId = selfRef.current?.participantId;
      useMeetingStore
        .getState()
        .setParticipants(selfId ? list.filter((item) => item.participantId !== selfId) : list);
    },
    onMediaState: (participantId, media) => {
      useMeetingStore.getState().setMedia(participantId, media);
    },
    onRecordingState: (participantId, state) => {
      useMeetingStore.getState().setRecordingState(participantId, state);
    },
    onChatMessage: (message) => {
      useMeetingStore.getState().addMessage(message);
      if (
        panelRef.current !== "chat" &&
        message.senderId !== selfRef.current?.participantId
      ) {
        setUnreadChat((value) => value + 1);
      }
    },
    onTranscriptUpdate: (segment, replaceId) => {
      useMeetingStore.getState().upsertSegment(segment, replaceId);
    },
    onTranscriptionStatus: (status: TranscriptionStatus) => {
      useMeetingStore.getState().setTranscriptionStatus(status);
      if (status.participantId !== selfRef.current?.participantId) return;
      if (status.state === "error") {
        setTranscriptionError(status.message ?? "Transcription failed for your microphone.");
      } else if (status.state === "active") {
        setTranscriptionError(null);
      }
    },
    onSummaryProgress: ({ mode, state, message }) => {
      useMeetingStore.getState().setSummaryState({
        state,
        mode,
        message,
      });
      if (state === "error" && message) pushNotice(message, "error");
    },
    onSummaryReady: ({ mode, summary: ready }) => {
      useMeetingStore.getState().setSummary(ready);
      useMeetingStore.getState().setSummaryState({
        state: ready.status === "failed" ? "error" : "ready",
        mode,
        message: ready.error ?? undefined,
      });
    },
    onMeetingEnded: () => {
      useMeetingStore.getState().setEnded(true);
      useMeetingStore.getState().setConnection("disconnected");
      pushNotice("The host ended the meeting. A final summary will be generated from the transcript.");
      teardown("ended");
    },
    onError: (code, message) => {
      if (code === "MEETING_ENDED") {
        useMeetingStore.getState().setEnded(true);
        teardown("ended");
        return;
      }
      if (code === "REPLACED") {
        pushNotice(message, "error");
        teardown("left");
        return;
      }
      if (stageRef.current === "joining" || stageRef.current === "lobby") {
        setJoinError(message);
        updateStage("lobby");
        disconnectRef.current?.();
        return;
      }
      pushNotice(message, "error");
    },
    onReconnect: () => {
      if (stageRef.current !== "joined") return;
      useMeetingStore.getState().setConnection("reconnecting");
      joinedRef.current = false;
      audioRef.current?.stop(false);
      webRTCRef.current?.reset();
      setParticipantStreams({});
      setPeerStates({});
    },
  });

  sendRef.current = signaling.send;
  disconnectRef.current = signaling.disconnect;

  const webRTC = useWebRTC({
    send: signaling.send,
    onRemoteStream: (participantId, stream) => {
      setParticipantStreams((current) => {
        const next = { ...current };
        if (stream) next[participantId] = stream;
        else delete next[participantId];
        return next;
      });
    },
    onPeerState: (participantId, state) => {
      setPeerStates((current) => ({ ...current, [participantId]: state }));
    },
  });
  webRTCRef.current = webRTC;

  const media = useMediaDevices({
    onStreamChange: (stream) => {
      webRTCRef.current?.setLocalStream(stream);
      if (joinedRef.current) publishMedia();
    },
    onScreenEnd: () => {
      webRTCRef.current?.setScreenTrack(null);
      if (joinedRef.current) publishMedia({ screen: false });
    },
  });
  mediaRef.current = media;

  const audio = useAudioCapture({
    stream: media.stream,
    send: signaling.send,
    sendBinary: signaling.sendBinary,
  });
  audioRef.current = audio;

  const handleRecordingComplete = useCallback(async (output: RecordingOutput) => {
    const currentMeeting = useMeetingStore.getState().meeting;
    if (!currentMeeting) return;
    setRecordingError(null);
    setRecordingMetadataError(null);
    const id =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `rec-${Date.now()}`;
    try {
      await saveRecording({
        id,
        meetingId: currentMeeting.id,
        roomId: currentMeeting.roomId,
        meetingTitle: currentMeeting.title,
        fileName: output.fileName,
        mimeType: output.mimeType,
        sizeBytes: output.sizeBytes,
        durationSec: output.durationSec,
        createdAt: new Date().toISOString(),
        blob: output.blob,
      });
      setRecordingSaved(output.fileName);
    } catch (err) {
      setRecordingError(
        err instanceof Error
          ? `The recording was created but IndexedDB could not save it: ${err.message}. Use the download button.`
          : "The recording was created but could not be saved to IndexedDB.",
      );
    }

    try {
      await api(`/api/meetings/${currentMeeting.id}/recordings`, {
        method: "POST",
        body: {
          fileName: output.fileName,
          mimeType: output.mimeType,
          sizeBytes: output.sizeBytes,
          durationSec: output.durationSec,
        },
      });
    } catch (err) {
      setRecordingMetadataError(
        err instanceof ApiError
          ? `Local file saved, but recording metadata was not stored: ${err.message}`
          : "Local file saved, but recording metadata could not be sent to the backend.",
      );
    }
  }, []);

  const recorder = useRecorder({
    localStream: media.stream,
    localScreenStream: media.screenStream,
    remoteStreams: participantStreams,
    participants,
    selfName: displayName,
    meetingId: meeting?.id ?? null,
    roomId: room.roomId,
    meetingTitle: meeting?.title ?? room.title,
    onComplete: handleRecordingComplete,
  });
  recorderRef.current = recorder;

  useEffect(() => {
    useMeetingStore.getState().setRecording(recorder.recording);
    const state = recorder.recording ? (recorder.paused ? "paused" : "recording") : "off";
    if (joinedRef.current) {
      sendRef.current?.({ type: "RECORDING_STATE", state });
      const current = selfRef.current;
      if (current) useMeetingStore.getState().setRecordingState(current.participantId, state);
    }
  }, [recorder.recording, recorder.paused]);

  useEffect(() => {
    panelRef.current = activePanel;
  }, [activePanel]);

  useEffect(() => {
    if (activePanel === "chat") setUnreadChat(0);
  }, [activePanel, messages.length]);

  useEffect(() => {
    useMeetingStore.getState().setConnection(mapConnection(signaling.status));
  }, [signaling.status]);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), notice.tone === "error" ? 8000 : 5000);
    return () => clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    document.title = `${room.title} · Auralis`;
    return () => {
      document.title = "Auralis — Local-first AI meetings";
    };
  }, [room.title]);

  useEffect(() => {
    const timer = setTimeout(() => {
      void mediaRef.current?.start();
    }, 60);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (stage !== "joining") return;
    const timer = setTimeout(() => {
      if (stageRef.current !== "joining") return;
      setJoinError(
        "The room did not respond in time. Check the backend and WebSocket server, then try again.",
      );
      updateStage("lobby");
      disconnectRef.current?.();
    }, 22_000);
    return () => clearTimeout(timer);
  }, [stage, updateStage]);

  useEffect(() => {
    if (stage !== "ended" || !meeting) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const data = await api<SummaryResponse>(`/api/meetings/${meeting.id}/summary`);
        if (cancelled) return;
        const store = useMeetingStore.getState();
        if (data.summary) {
          store.setSummary(data.summary);
          if (data.summary.status === "failed") {
            store.setSummaryState({
              state: "error",
              mode: "final",
              message: data.summary.error ?? "The final summary failed.",
            });
          } else {
            store.setSummaryState({ state: "ready", mode: "final" });
          }
        } else if (
          data.meeting.summaryStatus === "processing" ||
          data.meeting.summaryStatus === "pending"
        ) {
          store.setSummaryState({ state: "processing", mode: "final" });
        } else if (data.meeting.summaryStatus === "failed") {
          store.setSummaryState({
            state: "error",
            mode: "final",
            message: data.meeting.summaryError ?? "The final summary failed.",
          });
        }
      } catch {
        // Keep the last known summary state; polling is best-effort.
      }
    };
    void poll();
    const interval = setInterval(() => void poll(), 8000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [stage, meeting]);

  useEffect(() => {
    return () => {
      historyTokenRef.current += 1;
      joinedRef.current = false;
      audioRef.current?.stop(false);
      disconnectRef.current?.();
      webRTCRef.current?.closeAll();
      useMeetingStore.getState().reset();
    };
  }, []);

  const join = () => {
    if (!consent) {
      setJoinError("Please confirm consent before joining.");
      return;
    }
    setJoinError(null);
    updateStage("joining");
    signaling.connect(room.roomId);
  };

  const toggleAudio = async () => {
    const currentMedia = mediaRef.current;
    if (!currentMedia) return;
    if (currentMedia.audioEnabled) {
      currentMedia.toggleAudio();
      audioRef.current?.stop();
      publishMedia({ audio: false });
      return;
    }
    if (!currentMedia.streamRef.current?.getAudioTracks().length) {
      const next = await currentMedia.start({
        audio: true,
        video: currentMedia.videoEnabled,
      });
      if (!next) return;
      publishMedia({ audio: true });
      startTranscription(next);
      return;
    }
    currentMedia.toggleAudio();
    publishMedia({ audio: true });
    startTranscription(currentMedia.streamRef.current);
  };

  const toggleVideo = async () => {
    const currentMedia = mediaRef.current;
    if (!currentMedia) return;
    if (currentMedia.videoEnabled) {
      currentMedia.toggleVideo();
      publishMedia({ video: false });
      return;
    }
    if (!currentMedia.streamRef.current?.getVideoTracks().length) {
      const next = await currentMedia.start({
        audio: currentMedia.audioEnabled,
        video: true,
      });
      if (!next) return;
      publishMedia({ video: true });
      if (currentMedia.audioEnabled) startTranscription(next);
      return;
    }
    currentMedia.toggleVideo();
    publishMedia({ video: true });
  };

  const toggleScreen = async () => {
    const currentMedia = mediaRef.current;
    if (!currentMedia) return;
    if (currentMedia.screenRef.current) {
      currentMedia.stopScreenShare();
      return;
    }
    const display = await currentMedia.startScreenShare();
    const track = display?.getVideoTracks()[0];
    if (!track) return;
    webRTCRef.current?.setScreenTrack(track);
    publishMedia({ screen: true });
  };

  const retryTranscription = () => {
    setTranscriptionError(null);
    audioRef.current?.restart();
  };

  const sendChat = useCallback((message: string) => {
    const started = sendRef.current?.({ type: "CHAT_MESSAGE", message });
    if (!started) {
      throw new Error("Chat is unavailable while the live connection is reconnecting.");
    }
  }, []);

  const generateSummary = async () => {
    if (!meeting) return;
    setSummaryBusy(true);
    useMeetingStore.getState().setSummaryState({ state: "processing", mode: "draft" });
    try {
      const data = await api<{ summary: Summary }>(`/api/meetings/${meeting.id}/summarize`, {
        method: "POST",
        body: { mode: "draft" },
      });
      useMeetingStore.getState().setSummary(data.summary);
      useMeetingStore.getState().setSummaryState({ state: "ready", mode: "draft" });
      pushNotice("Draft summary generated from the finalized transcript.");
    } catch (err) {
      useMeetingStore.getState().setSummaryState({
        state: "error",
        mode: "draft",
        message: err instanceof Error ? err.message : "Summary generation failed.",
      });
    } finally {
      setSummaryBusy(false);
    }
  };

  const copyInvite = async () => {
    try {
      await navigator.clipboard.writeText(inviteLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      pushNotice("Clipboard access was blocked by the browser.", "error");
    }
  };

  const toggleRecording = async () => {
    setRecordingError(null);
    if (recorder.recording) {
      recorder.stop();
    } else {
      await recorder.start();
    }
  };

  const downloadLastRecording = () => {
    if (!recorder.lastOutput || !recorder.previewUrl) return;
    const link = document.createElement("a");
    link.href = recorder.previewUrl;
    link.download = recorder.lastOutput.fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
  };

  const leaveNow = () => {
    setLeaving(true);
    teardown("left");
    setLeaveOpen(false);
    setLeaving(false);
  };

  const endForEveryone = async () => {
    if (!meeting) {
      teardown("ended");
      return;
    }
    setEndingForAll(true);
    setEndError(null);
    try {
      await api(`/api/meetings/${meeting.id}/end`, { method: "POST" });
      setLeaveOpen(false);
      teardown("ended");
    } catch (err) {
      setEndError(
        err instanceof ApiError ? err.message : "Could not end the meeting for everyone.",
      );
      setEndingForAll(false);
    }
  };

  const previewMedia = useMemo<MediaState>(
    () => ({
      audio: Boolean(media.stream?.getAudioTracks().length && media.audioEnabled),
      video: Boolean(media.stream?.getVideoTracks().length && media.videoEnabled),
      screen: false,
    }),
    [media.stream, media.audioEnabled, media.videoEnabled],
  );

  const remoteParticipants = Object.values(participants);
  const recordingParticipants = [self, ...remoteParticipants].filter(
    (participant): participant is ParticipantInfo =>
      participant !== null && participant.recording !== "off",
  );
  const totalParticipants = remoteParticipants.length + (self ? 1 : 0);
  const gridClass =
    totalParticipants <= 1
      ? "grid-cols-1"
      : totalParticipants <= 2
        ? "grid-cols-1 sm:grid-cols-2"
        : totalParticipants <= 4
          ? "grid-cols-1 sm:grid-cols-2"
          : "grid-cols-1 sm:grid-cols-2 xl:grid-cols-3";
  const activeTranscriptionCount = Object.values(transcription).filter(
    (item) => item.state === "active" || item.state === "starting",
  ).length;
  const screenSharing = Boolean(media.screenStream);
  const ownMedia: MediaState = self?.media ?? previewMedia;

  if (stage === "lobby" || stage === "joining") {
    return (
      <PreJoinScreen
        room={room}
        displayName={displayName}
        isGuest={isGuest}
        isJoining={stage === "joining"}
        consent={consent}
        setConsent={setConsent}
        joinError={joinError}
        media={media}
        previewMedia={previewMedia}
        onJoin={join}
        onRetryMedia={() => void media.start()}
      />
    );
  }

  if (stage === "ended" || stage === "left") {
    return (
      <MeetingFinishedScreen
        stage={stage}
        room={room}
        meetingId={meeting?.id ?? null}
        summary={summary}
        summaryState={summaryState}
        isSignedIn={Boolean(user)}
      />
    );
  }

  const panelContent =
    activePanel === "chat" ? (
      <ChatPanel
        messages={messages}
        selfId={self?.participantId ?? null}
        onSend={sendChat}
        disabled={connection !== "connected"}
      />
    ) : activePanel === "people" ? (
      <ParticipantsPanel
        participants={self ? [self, ...remoteParticipants] : remoteParticipants}
        selfId={self?.participantId ?? null}
        transcription={transcription}
        inviteLink={inviteLink}
      />
    ) : activePanel === "transcript" ? (
      <TranscriptPanel
        meetingId={meeting?.id ?? ""}
        meetingTitle={meeting?.title ?? room.title}
        segments={segments}
        selfId={self?.participantId ?? null}
        isHost={isHost}
        transcription={transcription}
        seekHint="Live captions appear as each speaker's microphone is transcribed locally."
        onSegmentUpdated={(updated) => {
          const store = useMeetingStore.getState();
          const existing = store.segments.find((segment) => segment.segmentId === updated.segmentId);
          if (existing) store.upsertSegment(updated);
        }}
      />
    ) : activePanel === "summary" ? (
      <SummaryPanel
        summary={summary}
        uiState={summaryState}
        isHost={isHost}
        canGenerate={segments.some((segment) => segment.status !== "provisional") && !summaryBusy}
        onGenerate={() => void generateSummary()}
        onRetry={() => void generateSummary()}
      />
    ) : null;

  const panelTitles: Record<Exclude<SidePanel, null>, string> = {
    chat: "Chat",
    people: "Participants",
    transcript: "Live transcript",
    summary: "AI summary",
  };

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-canvas">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-line bg-panel/80 px-3 backdrop-blur-xl sm:px-4">
        <Logo compact />
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-sm font-semibold">{meeting?.title ?? room.title}</h1>
          <p className="flex items-center gap-2 text-[10px] text-muted">
            <span className="font-mono">{formatClock(elapsed)}</span>
            <span>·</span>
            <span>{totalParticipants} participant{totalParticipants === 1 ? "" : "s"}</span>
            {isHost ? <span className="text-amber-300">Host</span> : null}
            {isGuest ? <span>Guest</span> : null}
          </p>
        </div>

        <div className="hidden items-center gap-1.5 sm:flex">
          {connection === "connected" ? (
            <Badge tone="success" dot>
              <Wifi className="size-3" /> Live
            </Badge>
          ) : connection === "reconnecting" ? (
            <Badge tone="warning" dot>
              <WifiOff className="size-3" /> Reconnecting
            </Badge>
          ) : (
            <Badge tone="neutral">
              <WifiOff className="size-3" /> Offline
            </Badge>
          )}
          {activeTranscriptionCount > 0 ? (
            <Badge tone="info">
              <Radio className="size-3 animate-pulse-soft" /> Transcribing
            </Badge>
          ) : null}
          {recordingParticipants.length > 0 ? (
            <Badge tone="danger" dot>
              <span className="size-1.5 animate-pulse-soft rounded-full bg-rose-400" /> Recording
            </Badge>
          ) : null}
        </div>

        <Button
          size="sm"
          variant="secondary"
          onClick={() => void copyInvite()}
          className="shrink-0"
          title="Copy invite link"
        >
          {copied ? <Check className="size-3.5 text-emerald-300" /> : <Copy className="size-3.5" />}
          <span className="hidden sm:inline">{copied ? "Copied" : "Invite"}</span>
        </Button>
      </header>

      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          {connection === "reconnecting" ? (
            <div className="flex items-center justify-center gap-2 border-b border-amber-500/20 bg-amber-500/10 px-4 py-1.5 text-[11px] text-amber-200">
              <Loader2 className="size-3.5 animate-spin" /> Connection lost. Rejoining the room and
              rebuilding peer connections…
            </div>
          ) : null}

          {notice ? (
            <div
              className={cn(
                "flex items-center justify-between gap-3 border-b px-4 py-2 text-[11px]",
                notice.tone === "error"
                  ? "border-rose-500/25 bg-rose-500/10 text-rose-200"
                  : "border-brand/25 bg-brand/10 text-brand-soft",
              )}
            >
              <span className="flex items-start gap-1.5">
                {notice.tone === "error" ? (
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                ) : (
                  <Check className="mt-0.5 size-3.5 shrink-0" />
                )}
                {notice.text}
              </span>
              <button onClick={() => setNotice(null)} aria-label="Dismiss message">
                <X className="size-3.5" />
              </button>
            </div>
          ) : null}

          {connectionError ? (
            <div className="flex items-center justify-between gap-3 border-b border-rose-500/25 bg-rose-500/10 px-4 py-2 text-[11px] text-rose-200">
              <span>{connectionError}</span>
              <Button size="sm" variant="ghost" onClick={signaling.retry}>
                <RefreshCw className="size-3.5" /> Retry
              </Button>
            </div>
          ) : null}

          {recordingParticipants.length > 0 ? (
            <div className="flex items-center gap-2 border-b border-rose-500/25 bg-rose-500/10 px-4 py-2 text-[11px] text-rose-200">
              <span className="flex size-2 animate-pulse-soft rounded-full bg-rose-400" />
              <span>
                <span className="font-medium">
                  {recordingParticipants
                    .map((participant) =>
                      participant.participantId === self?.participantId
                        ? "You"
                        : participant.name,
                    )
                    .join(", ")}
                </span>{" "}
                {recordingParticipants.some((participant) => participant.recording === "recording")
                  ? "recording this meeting locally."
                  : "paused a local recording."}{" "}
                The video/audio file is stored on the recorder's device, not on the server.
              </span>
            </div>
          ) : null}

          {!media.stream ? (
            <div className="flex items-center gap-2 border-b border-amber-500/20 bg-amber-500/10 px-4 py-1.5 text-[11px] text-amber-200">
              <MicOff className="size-3.5" /> No camera or microphone stream. Transcription and
              recording are unavailable until you allow device access.
              <button
                onClick={() => void media.start()}
                className="ml-auto inline-flex items-center gap-1 font-medium text-amber-100 hover:underline"
              >
                <RefreshCw className="size-3" /> Enable
              </button>
            </div>
          ) : null}

          {transcriptionError ? (
            <div className="flex flex-wrap items-center gap-2 border-b border-rose-500/25 bg-rose-500/10 px-4 py-2 text-[11px] text-rose-200">
              <AlertTriangle className="size-3.5" /> {transcriptionError}
              <Button size="sm" variant="danger" className="ml-auto h-7" onClick={retryTranscription}>
                <RefreshCw className="size-3" /> Retry transcription
              </Button>
            </div>
          ) : audio.error ? (
            <div className="flex flex-wrap items-center gap-2 border-b border-rose-500/25 bg-rose-500/10 px-4 py-2 text-[11px] text-rose-200">
              <AlertTriangle className="size-3.5" /> {audio.error}
              <Button size="sm" variant="danger" className="ml-auto h-7" onClick={retryTranscription}>
                <RefreshCw className="size-3" /> Retry
              </Button>
            </div>
          ) : null}

          {recordingError || recordingMetadataError || recorder.error ? (
            <div className="flex flex-wrap items-center gap-2 border-b border-rose-500/25 bg-rose-500/10 px-4 py-2 text-[11px] text-rose-200">
              <AlertTriangle className="size-3.5" />
              {recordingError ?? recordingMetadataError ?? recorder.error}
              <button
                className="ml-auto text-rose-100 hover:underline"
                onClick={() => {
                  setRecordingError(null);
                  setRecordingMetadataError(null);
                  recorder.setError(null);
                }}
              >
                Dismiss
              </button>
            </div>
          ) : null}

          {recordingSaved && recorder.lastOutput && !recorder.recording ? (
            <div className="flex flex-wrap items-center gap-2 border-b border-emerald-500/20 bg-emerald-500/10 px-4 py-2 text-[11px] text-emerald-200">
              <Check className="size-3.5" /> Recording saved locally ({formatBytes(recorder.lastOutput.sizeBytes)}).
              <button
                onClick={downloadLastRecording}
                className="ml-auto inline-flex items-center gap-1 font-medium text-emerald-100 hover:underline"
              >
                <Download className="size-3" /> Download {recordingSaved}
              </button>
            </div>
          ) : null}

          <div className="min-h-0 flex-1 overflow-y-auto p-2 sm:p-3">
            <div className={cn("grid h-full min-h-[280px] auto-rows-fr gap-2 sm:gap-3", gridClass)}>
              {self ? (
                <VideoTile
                  name={selfRef.current?.name ?? displayName}
                  stream={
                    media.screenStream ??
                    media.stream ??
                    null
                  }
                  media={ownMedia}
                  isLocal
                  className={cn(
                    "min-h-[180px] sm:min-h-[220px]",
                    media.screenStream && "sm:col-span-2 xl:col-span-3",
                  )}
                />
              ) : null}
              {remoteParticipants.map((participant) => (
                <VideoTile
                  key={participant.participantId}
                  name={participant.name}
                  stream={participantStreams[participant.participantId] ?? null}
                  media={participant.media}
                  connectionState={peerStates[participant.participantId]}
                  className={cn(
                    "min-h-[180px] sm:min-h-[220px]",
                    participant.media.screen && "sm:col-span-2 xl:col-span-3",
                  )}
                />
              ))}
            </div>
            {remoteParticipants.length === 0 ? (
              <p className="mt-3 text-center text-[11px] text-muted">
                You are the only participant. Copy the invite link to bring someone in.
              </p>
            ) : null}
          </div>

          <ControlBar
            audioEnabled={Boolean(self?.media.audio)}
            videoEnabled={Boolean(self?.media.video)}
            screenSharing={screenSharing || Boolean(self?.media.screen)}
            recording={recorder.recording}
            recordingPaused={recorder.paused}
            elapsed={recorder.elapsed}
            activePanel={activePanel}
            unreadChat={unreadChat}
            connectionState={connection}
            onToggleAudio={() => void toggleAudio()}
            onToggleVideo={() => void toggleVideo()}
            onToggleScreen={() => void toggleScreen()}
            onToggleRecord={() => void toggleRecording()}
            onPauseRecord={() => (recorder.paused ? recorder.resume() : recorder.pause())}
            onTogglePanel={(panel) => {
              setActivePanel((current) => (current === panel ? null : panel));
              if (panel === "chat") setUnreadChat(0);
            }}
            onLeave={() => setLeaveOpen(true)}
          />
        </div>

        <aside
          className={cn(
            "fixed inset-y-0 right-0 z-40 flex w-full max-w-md flex-col border-l border-line bg-panel shadow-2xl transition-transform duration-200 lg:static lg:z-auto lg:w-[370px] lg:max-w-none lg:translate-x-0 lg:shadow-none",
            activePanel ? "translate-x-0" : "translate-x-full lg:hidden",
          )}
        >
          {activePanel ? (
            <>
              <div className="flex h-12 shrink-0 items-center justify-between border-b border-line px-3">
                <div className="flex items-center gap-2">
                  {activePanel === "chat" ? (
                    <ChatIcon />
                  ) : activePanel === "people" ? (
                    <Users className="size-4 text-brand-soft" />
                  ) : activePanel === "transcript" ? (
                    <Captions className="size-4 text-brand-soft" />
                  ) : (
                    <Sparkles className="size-4 text-brand-soft" />
                  )}
                  <h2 className="text-sm font-semibold">{panelTitles[activePanel]}</h2>
                  {activePanel === "chat" && unreadChat > 0 ? (
                    <Badge tone="brand">{unreadChat}</Badge>
                  ) : null}
                </div>
                <button
                  onClick={() => setActivePanel(null)}
                  className="rounded-lg p-1.5 text-muted hover:bg-white/5 hover:text-ink"
                  aria-label="Close panel"
                >
                  <X className="size-4" />
                </button>
              </div>
              <div className="min-h-0 flex-1">{panelContent}</div>
            </>
          ) : null}
        </aside>
      </div>

      {activePanel ? (
        <button
          className="fixed inset-0 z-30 bg-black/50 backdrop-blur-sm lg:hidden"
          onClick={() => setActivePanel(null)}
          aria-label="Close side panel"
        />
      ) : null}

      <Modal
        open={leaveOpen}
        onClose={() => {
          if (!leaving && !endingForAll) {
            setLeaveOpen(false);
            setEndError(null);
          }
        }}
        title={isHost ? "Leave or end the meeting?" : "Leave the meeting?"}
        description={
          isHost
            ? "If others are still present, leaving without ending keeps the room open. Ending disconnects everyone and starts the final summary."
            : "Your transcript segments are saved as they are finalized. The host can keep the meeting running."
        }
        footer={
          <div className="flex w-full flex-col gap-2 sm:flex-row sm:justify-end">
            <Button
              variant="ghost"
              onClick={() => setLeaveOpen(false)}
              disabled={leaving || endingForAll}
            >
              Cancel
            </Button>
            <Button variant="secondary" onClick={leaveNow} loading={leaving} disabled={endingForAll}>
              <ArrowLeft className="size-4" /> Leave meeting
            </Button>
            {isHost ? (
              <Button variant="danger" onClick={() => void endForEveryone()} loading={endingForAll}>
                <Square className="size-3.5" /> End for everyone
              </Button>
            ) : null}
          </div>
        }
      >
        {endError ? (
          <p className="mb-3 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
            {endError}
          </p>
        ) : null}
        {recorder.recording ? (
          <p className="rounded-xl border border-amber-500/25 bg-amber-500/10 p-3 text-[11px] leading-relaxed text-amber-200">
            Recording is active. Stopping will save the local file before you leave.
          </p>
        ) : null}
      </Modal>
    </div>
  );
}

function ChatIcon() {
  return <AudioLines className="size-4 text-brand-soft" />;
}

function PreJoinScreen({
  room,
  displayName,
  isGuest,
  isJoining,
  consent,
  setConsent,
  joinError,
  media,
  previewMedia,
  onJoin,
  onRetryMedia,
}: {
  room: RoomPublic;
  displayName: string;
  isGuest: boolean;
  isJoining: boolean;
  consent: boolean;
  setConsent: (value: boolean) => void;
  joinError: string | null;
  media: ReturnType<typeof useMediaDevices>;
  previewMedia: MediaState;
  onJoin: () => void;
  onRetryMedia: () => void;
}) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex h-16 items-center justify-between border-b border-line px-4 sm:px-6">
        <Logo />
        <div className="flex items-center gap-3">
          <Badge tone="success" dot>
            Room active
          </Badge>
          <Link href="/" className="text-xs text-muted hover:text-ink">
            Leave
          </Link>
        </div>
      </header>

      <main className="mx-auto grid w-full max-w-6xl flex-1 gap-4 px-4 py-6 lg:grid-cols-[1.45fr_1fr] lg:items-center lg:py-10">
        <div className="space-y-3">
          <div className="relative min-h-[280px] overflow-hidden rounded-2xl border border-line video-surface sm:min-h-[420px]">
            <VideoTile
              name={displayName}
              stream={media.stream}
              media={previewMedia}
              isLocal
              className="absolute inset-0 rounded-2xl border-0"
            />
            {!media.stream && !media.requesting ? (
              <div className="absolute inset-x-0 bottom-3 flex justify-center p-2">
                <Button size="sm" variant="secondary" onClick={onRetryMedia}>
                  <Video className="size-3.5" /> Enable camera & microphone
                </Button>
              </div>
            ) : null}
            {media.requesting ? (
              <div className="absolute inset-0 flex items-center justify-center bg-black/30">
                <span className="inline-flex items-center gap-2 rounded-full bg-black/70 px-3 py-1.5 text-xs text-white">
                  <Loader2 className="size-3.5 animate-spin" /> Requesting devices…
                </span>
              </div>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center justify-center gap-2">
            <button
              onClick={media.toggleAudio}
              disabled={isJoining}
              className={cn(
                "flex size-11 items-center justify-center rounded-full border transition-colors",
                media.audioEnabled
                  ? "border-line bg-panel-raised text-ink hover:border-brand/50"
                  : "border-rose-500/40 bg-rose-500/15 text-rose-300",
              )}
              aria-label={media.audioEnabled ? "Mute microphone" : "Unmute microphone"}
            >
              {media.audioEnabled ? <Mic className="size-4.5" /> : <MicOff className="size-4.5" />}
            </button>
            <button
              onClick={media.toggleVideo}
              disabled={isJoining}
              className={cn(
                "flex size-11 items-center justify-center rounded-full border transition-colors",
                media.videoEnabled
                  ? "border-line bg-panel-raised text-ink hover:border-brand/50"
                  : "border-rose-500/40 bg-rose-500/15 text-rose-300",
              )}
              aria-label={media.videoEnabled ? "Turn camera off" : "Turn camera on"}
            >
              {media.videoEnabled ? <Video className="size-4.5" /> : <VideoOff className="size-4.5" />}
            </button>
            <Button
              size="sm"
              variant="ghost"
              onClick={onRetryMedia}
              disabled={isJoining || media.requesting}
            >
              <RefreshCw className="size-3.5" /> Retry devices
            </Button>
          </div>

          <div className="grid gap-2 sm:grid-cols-2">
            <div>
              <Label htmlFor="camera-select">Camera</Label>
              <Select
                id="camera-select"
                value={media.selectedCamera ?? ""}
                onChange={(event) => {
                  if (event.target.value) void media.switchDevice("video", event.target.value);
                }}
                disabled={isJoining || media.devices.cameras.length === 0}
              >
                <option value="">System default</option>
                {media.devices.cameras.map((device, index) => (
                  <option key={device.deviceId} value={device.deviceId}>
                    {device.label || `Camera ${index + 1}`}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="mic-select">Microphone</Label>
              <Select
                id="mic-select"
                value={media.selectedMicrophone ?? ""}
                onChange={(event) => {
                  if (event.target.value) void media.switchDevice("audio", event.target.value);
                }}
                disabled={isJoining || media.devices.microphones.length === 0}
              >
                <option value="">System default</option>
                {media.devices.microphones.map((device, index) => (
                  <option key={device.deviceId} value={device.deviceId}>
                    {device.label || `Microphone ${index + 1}`}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          {media.error ? (
            <div className="rounded-xl border border-amber-500/25 bg-amber-500/10 p-3 text-xs text-amber-200">
              <p className="flex items-start gap-1.5">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" /> {media.error}
              </p>
              <p className="mt-1 pl-5 text-[10px] text-amber-200/80">
                You can still join without devices, but live transcription and recording will be
                unavailable.
              </p>
            </div>
          ) : null}
        </div>

        <div>
          <Badge tone="brand">
            <ShieldCheck className="size-3" /> Pre-join
          </Badge>
          <h1 className="mt-4 text-3xl font-semibold tracking-tight">{room.title}</h1>
          <p className="mt-2 text-sm text-muted">
            Hosted by {room.hostName}
            {room.startedAt ? ` · live since ${formatDate(room.startedAt)}` : ""}
          </p>

          <div className="mt-5 flex items-center gap-3 rounded-xl border border-line bg-panel-raised/60 p-3">
            <Avatar name={displayName} size={38} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{displayName}</p>
              <p className="text-[11px] text-muted">{isGuest ? "Guest participant" : "Signed-in participant"}</p>
            </div>
            {isGuest ? <Badge tone="neutral">Guest</Badge> : <Badge tone="success">Account</Badge>}
          </div>

          <div className="mt-4 space-y-2 text-[11px] leading-relaxed text-muted">
            <p className="flex items-start gap-2">
              <Radio className="mt-0.5 size-3.5 shrink-0 text-brand-soft" />
              Your microphone is transcribed locally by faster-whisper. Audio is not sent to a cloud
              service.
            </p>
            <p className="flex items-start gap-2">
              <Sparkles className="mt-0.5 size-3.5 shrink-0 text-brand-soft" />
              Transcript text may be summarized by a local Ollama model after the meeting.
            </p>
          </div>

          <label
            htmlFor="consent"
            className={cn(
              "mt-5 flex cursor-pointer items-start gap-3 rounded-xl border p-3 text-xs leading-relaxed transition-colors",
              consent
                ? "border-brand/40 bg-brand/10 text-ink/90"
                : "border-line bg-panel text-muted hover:border-brand/30",
            )}
          >
            <input
              id="consent"
              type="checkbox"
              checked={consent}
              onChange={(event) => setConsent(event.target.checked)}
              className="mt-0.5 size-4 shrink-0 accent-[#6c5ce7]"
              disabled={isJoining}
            />
            <span>
              I consent to live transcription of my microphone. I understand the host may record this
              meeting locally, and that an active recording is indicated in the meeting interface.
            </span>
          </label>

          {joinError ? (
            <p className="mt-3 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
              {joinError}
            </p>
          ) : null}

          <Button
            size="lg"
            className="mt-4 w-full"
            onClick={onJoin}
            disabled={!consent || isJoining || !media.initialized}
            loading={isJoining}
          >
            {isJoining ? "Joining room…" : "Join meeting"}
            {!isJoining ? <ArrowRight className="size-4" /> : null}
          </Button>
          <p className="mt-2 text-center text-[10px] text-muted">
            The room supports up to 6 participants with mesh WebRTC.
          </p>
        </div>
      </main>
    </div>
  );
}

function MeetingFinishedScreen({
  stage,
  room,
  meetingId,
  summary,
  summaryState,
  isSignedIn,
}: {
  stage: "ended" | "left";
  room: RoomPublic;
  meetingId: string | null;
  summary: Summary | null;
  summaryState: SummaryUiState;
  isSignedIn: boolean;
}) {
  const processing = summaryState.state === "processing" || summaryState.mode === "final" && !summary;
  const failed = summaryState.state === "error" || summary?.status === "failed";
  const errorText = summaryState.message ?? summary?.error ?? null;

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex h-16 items-center justify-between border-b border-line px-4 sm:px-6">
        <Logo />
        <Link href={isSignedIn ? "/dashboard" : "/"} className="text-xs text-muted hover:text-ink">
          {isSignedIn ? "Dashboard" : "Auralis home"}
        </Link>
      </header>

      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center px-4 py-10">
        <div className="text-center">
          <span className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-brand/15 text-brand-soft">
            {stage === "ended" ? <Video className="size-7" /> : <ArrowLeft className="size-7" />}
          </span>
          <h1 className="mt-5 text-3xl font-semibold tracking-tight">
            {stage === "ended" ? "Meeting ended" : "You left the meeting"}
          </h1>
          <p className="mt-2 text-sm text-muted">
            {stage === "ended"
              ? "The room is closed. The final summary is generated from the saved transcript once transcription flushes."
              : "Your transcript segments were saved as they were finalized. The room may still be active for others."}
          </p>
        </div>

        {stage === "ended" ? (
          <Card className="mt-8">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="flex items-center gap-2 text-sm font-semibold">
                  <Sparkles className="size-4 text-brand-soft" /> Final summary
                </h2>
                <p className="mt-0.5 text-[11px] text-muted">{room.title}</p>
              </div>
              {summary?.status === "final" ? (
                <Badge tone="success">Final</Badge>
              ) : failed ? (
                <Badge tone="danger">Failed</Badge>
              ) : (
                <Badge tone="warning" dot>
                  Processing
                </Badge>
              )}
            </div>

            {processing ? (
              <div className="mt-4 flex items-center gap-2 rounded-xl border border-brand/30 bg-brand/10 p-3 text-xs text-brand-soft">
                <Loader2 className="size-4 animate-spin" />
                Ollama is generating the final summary. This page will update automatically.
              </div>
            ) : null}

            {failed ? (
              <div className="mt-4 rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-200">
                <p className="flex items-start gap-1.5">
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />{" "}
                  {errorText ?? "The final summary failed."}
                </p>
                {isSignedIn && meetingId ? (
                  <Link href={`/meetings/${meetingId}?tab=summary`} className="mt-2 inline-block">
                    <Button size="sm" variant="danger">
                      <RefreshCw className="size-3.5" /> Retry from meeting details
                    </Button>
                  </Link>
                ) : null}
              </div>
            ) : null}

            {summary && summary.status !== "failed" ? (
              <div className="mt-4 space-y-4">
                <p className="whitespace-pre-wrap rounded-xl border border-line bg-panel-raised/50 p-4 text-sm leading-relaxed text-ink/90">
                  {summary.executiveSummary || "The summary did not include an executive summary."}
                </p>
                <div className="grid gap-2 sm:grid-cols-3">
                  <div className="rounded-xl border border-line bg-panel-raised/40 p-3">
                    <p className="text-[10px] uppercase tracking-wide text-muted">Key points</p>
                    <p className="mt-1 text-lg font-semibold">{summary.keyPoints.length}</p>
                  </div>
                  <div className="rounded-xl border border-line bg-panel-raised/40 p-3">
                    <p className="text-[10px] uppercase tracking-wide text-muted">Decisions</p>
                    <p className="mt-1 text-lg font-semibold">{summary.decisions.length}</p>
                  </div>
                  <div className="rounded-xl border border-line bg-panel-raised/40 p-3">
                    <p className="text-[10px] uppercase tracking-wide text-muted">Action items</p>
                    <p className="mt-1 text-lg font-semibold">{summary.actionItems.length}</p>
                  </div>
                </div>
                {isSignedIn && meetingId ? (
                  <Link href={`/meetings/${meetingId}?tab=summary`}>
                    <Button variant="secondary" className="w-full">
                      Open full meeting details <ArrowRight className="size-4" />
                    </Button>
                  </Link>
                ) : null}
              </div>
            ) : null}

            {!processing && !failed && !summary ? (
              <p className="mt-4 text-sm text-muted">
                No summary was generated. This usually means no speech was transcribed before the
                meeting ended.
              </p>
            ) : null}
          </Card>
        ) : (
          <div className="mt-8 flex flex-col items-center gap-3">
            {isSignedIn ? (
              <Link href="/dashboard">
                <Button>Back to dashboard</Button>
              </Link>
            ) : (
              <Link href="/">
                <Button>Back to Auralis</Button>
              </Link>
            )}
          </div>
        )}

        <div className="mt-8 flex flex-wrap items-center justify-center gap-4 text-[10px] text-muted">
          <span className="inline-flex items-center gap-1.5">
            <ShieldCheck className="size-3" /> Everything processed locally
          </span>
          <span className="inline-flex items-center gap-1.5">
            <AudioLines className="size-3" /> faster-whisper + Ollama
          </span>
          {meetingId ? (
            <span className="inline-flex items-center gap-1.5">
              <Video className="size-3" /> Room {room.roomId}
            </span>
          ) : null}
        </div>
      </main>
    </div>
  );
}
