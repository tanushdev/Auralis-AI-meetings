"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { WS_URL } from "@/lib/api";
import type {
  ChatMessage,
  ParticipantInfo,
  Summary,
  TranscriptSegment,
  TranscriptionStatus,
} from "@/types";

export type SignalingStatus = "idle" | "connecting" | "connected" | "reconnecting" | "disconnected";

export interface RoomJoinedPayload {
  self: ParticipantInfo;
  participants: ParticipantInfo[];
  initiateTo: string[];
  meeting: {
    id: string;
    roomId: string;
    title: string;
    hostId: string;
    startedAt: string;
  };
  serverTime: number;
}

export interface SignalingHandlers {
  onRoomJoined: (payload: RoomJoinedPayload) => void;
  onPeerJoined: (participant: ParticipantInfo) => void;
  onPeerLeft: (participantId: string) => void;
  onOffer: (from: string, sdp: string) => void;
  onAnswer: (from: string, sdp: string) => void;
  onIceCandidate: (from: string, candidate: RTCIceCandidateInit | null) => void;
  onRoomState: (participants: ParticipantInfo[]) => void;
  onMediaState: (participantId: string, media: ParticipantInfo["media"]) => void;
  onRecordingState: (participantId: string, state: ParticipantInfo["recording"]) => void;
  onChatMessage: (message: ChatMessage) => void;
  onTranscriptUpdate: (segment: TranscriptSegment, replaceId: string | null) => void;
  onTranscriptionStatus: (status: TranscriptionStatus) => void;
  onSummaryProgress: (payload: { mode: "draft" | "final"; state: "processing" | "error"; message?: string }) => void;
  onSummaryReady: (payload: { mode: "draft" | "final"; summary: Summary }) => void;
  onMeetingEnded: () => void;
  onError: (code: string, message: string) => void;
  onReconnect: () => void;
}

const FATAL_CODES = new Set([
  "UNAUTHORIZED",
  "MEETING_ENDED",
  "ROOM_NOT_FOUND",
  "ROOM_FULL",
  "FORBIDDEN",
  "JOIN_FAILED",
]);

export function useSignaling(handlers: SignalingHandlers) {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  const socketRef = useRef<WebSocket | null>(null);
  const roomRef = useRef<string | null>(null);
  const manualCloseRef = useRef(false);
  const attemptRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [status, setStatus] = useState<SignalingStatus>("idle");

  const clearTimers = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    if (heartbeatRef.current) {
      clearInterval(heartbeatRef.current);
      heartbeatRef.current = null;
    }
  }, []);

  const open = useCallback(() => {
    const roomId = roomRef.current;
    if (!roomId || manualCloseRef.current) return;
    clearTimers();
    setStatus(attemptRef.current === 0 ? "connecting" : "reconnecting");

    let socket: WebSocket;
    try {
      socket = new WebSocket(`${WS_URL}/ws`);
    } catch {
      setStatus("disconnected");
      return;
    }
    socketRef.current = socket;

    socket.onopen = () => {
      socket.send(JSON.stringify({ type: "JOIN_ROOM", roomId }));
      heartbeatRef.current = setInterval(() => {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: "PING" }));
        }
      }, 20_000);
    };

    socket.onmessage = (event) => {
      if (typeof event.data !== "string") return;
      let payload: Record<string, unknown>;
      try {
        payload = JSON.parse(event.data) as Record<string, unknown>;
      } catch {
        return;
      }
      const type = payload.type;
      switch (type) {
        case "ROOM_JOINED": {
          attemptRef.current = 0;
          setStatus("connected");
          handlersRef.current.onRoomJoined(payload as unknown as RoomJoinedPayload);
          break;
        }
        case "PEER_JOINED":
          handlersRef.current.onPeerJoined(payload.participant as ParticipantInfo);
          break;
        case "PEER_LEFT":
          handlersRef.current.onPeerLeft(String(payload.participantId));
          break;
        case "OFFER":
          handlersRef.current.onOffer(String(payload.from), String(payload.sdp));
          break;
        case "ANSWER":
          handlersRef.current.onAnswer(String(payload.from), String(payload.sdp));
          break;
        case "ICE_CANDIDATE":
          handlersRef.current.onIceCandidate(
            String(payload.from),
            (payload.candidate as RTCIceCandidateInit | null) ?? null,
          );
          break;
        case "ROOM_STATE":
          handlersRef.current.onRoomState((payload.participants as ParticipantInfo[]) ?? []);
          break;
        case "MEDIA_STATE":
          handlersRef.current.onMediaState(
            String(payload.participantId),
            payload.media as ParticipantInfo["media"],
          );
          break;
        case "RECORDING_STATE":
          handlersRef.current.onRecordingState(
            String(payload.participantId),
            payload.state === "recording"
              ? "recording"
              : payload.state === "paused"
                ? "paused"
                : "off",
          );
          break;
        case "CHAT_MESSAGE":
          handlersRef.current.onChatMessage(payload.message as ChatMessage);
          break;
        case "TRANSCRIPT_UPDATE":
          handlersRef.current.onTranscriptUpdate(
            payload.segment as TranscriptSegment,
            (payload.replaceId as string | null) ?? null,
          );
          break;
        case "TRANSCRIPTION_STATUS":
          handlersRef.current.onTranscriptionStatus(payload as unknown as TranscriptionStatus);
          break;
        case "SUMMARY_PROGRESS":
          handlersRef.current.onSummaryProgress({
            mode: payload.mode === "final" ? "final" : "draft",
            state: payload.state === "error" ? "error" : "processing",
            message: typeof payload.message === "string" ? payload.message : undefined,
          });
          break;
        case "SUMMARY_READY":
          handlersRef.current.onSummaryReady({
            mode: payload.mode === "final" ? "final" : "draft",
            summary: payload.summary as Summary,
          });
          break;
        case "MEETING_ENDED":
          handlersRef.current.onMeetingEnded();
          break;
        case "ERROR": {
          const code = String(payload.code ?? "ERROR");
          const message = String(payload.message ?? "Signaling error");
          handlersRef.current.onError(code, message);
          if (FATAL_CODES.has(code)) {
            manualCloseRef.current = true;
            setStatus("disconnected");
            socket.close(4000, "Fatal signaling error");
          }
          break;
        }
        default:
          break;
      }
    };

    socket.onclose = () => {
      if (heartbeatRef.current) {
        clearInterval(heartbeatRef.current);
        heartbeatRef.current = null;
      }
      if (manualCloseRef.current) {
        setStatus("idle");
        return;
      }
      attemptRef.current += 1;
      setStatus("reconnecting");
      handlersRef.current.onReconnect();
      const delay = Math.min(15_000, 500 * 2 ** Math.min(attemptRef.current, 5)) + Math.random() * 400;
      reconnectTimerRef.current = setTimeout(open, delay);
    };

    socket.onerror = () => {
      // The close handler schedules reconnection.
    };
  }, [clearTimers]);

  const connect = useCallback(
    (roomId: string) => {
      roomRef.current = roomId;
      manualCloseRef.current = false;
      attemptRef.current = 0;
      if (socketRef.current && socketRef.current.readyState <= WebSocket.OPEN) {
        socketRef.current.close();
      }
      open();
    },
    [open],
  );

  const disconnect = useCallback(() => {
    manualCloseRef.current = true;
    clearTimers();
    const socket = socketRef.current;
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: "LEAVE_ROOM" }));
    }
    socket?.close(1000, "Left meeting");
    socketRef.current = null;
    setStatus("idle");
  }, [clearTimers]);

  const send = useCallback((event: Record<string, unknown>) => {
    const socket = socketRef.current;
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(event));
      return true;
    }
    return false;
  }, []);

  const sendBinary = useCallback((data: ArrayBuffer) => {
    const socket = socketRef.current;
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(data);
      return true;
    }
    return false;
  }, []);

  const retry = useCallback(() => {
    const roomId = roomRef.current;
    if (!roomId) return;
    manualCloseRef.current = false;
    attemptRef.current = 0;
    open();
  }, [open]);

  useEffect(() => {
    return () => {
      manualCloseRef.current = true;
      clearTimers();
      socketRef.current?.close();
      socketRef.current = null;
    };
  }, [clearTimers]);

  return { connect, disconnect, send, sendBinary, retry, status };
}
