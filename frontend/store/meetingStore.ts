"use client";

import { create } from "zustand";
import type {
  ChatMessage,
  MediaState,
  ParticipantInfo,
  Summary,
  TranscriptSegment,
  TranscriptionStatus,
} from "@/types";

export type ConnectionState = "idle" | "connecting" | "connected" | "reconnecting" | "disconnected";

export interface RoomMeetingInfo {
  id: string;
  roomId: string;
  title: string;
  hostId: string;
  startedAt: string;
}

export interface SummaryUiState {
  state: "idle" | "processing" | "ready" | "error";
  mode: "draft" | "final" | null;
  message?: string;
}

interface MeetingRoomState {
  connection: ConnectionState;
  connectionError: string | null;
  self: ParticipantInfo | null;
  meeting: RoomMeetingInfo | null;
  participants: Record<string, ParticipantInfo>;
  messages: ChatMessage[];
  segments: TranscriptSegment[];
  transcription: Record<string, TranscriptionStatus>;
  summary: Summary | null;
  summaryState: SummaryUiState;
  ended: boolean;
  recording: boolean;

  reset: () => void;
  setConnection: (state: ConnectionState, error?: string | null) => void;
  setSelf: (self: ParticipantInfo | null) => void;
  setMeeting: (meeting: RoomMeetingInfo) => void;
  setParticipants: (participants: ParticipantInfo[]) => void;
  upsertParticipant: (participant: ParticipantInfo) => void;
  removeParticipant: (participantId: string) => void;
  setMedia: (participantId: string, media: MediaState) => void;
  setRecordingState: (participantId: string, recording: ParticipantInfo["recording"]) => void;
  addMessage: (message: ChatMessage) => void;
  setMessages: (messages: ChatMessage[]) => void;
  setSegments: (segments: TranscriptSegment[]) => void;
  upsertSegment: (segment: TranscriptSegment, replaceId?: string | null) => void;
  setTranscriptionStatus: (status: TranscriptionStatus) => void;
  setSummary: (summary: Summary | null) => void;
  setSummaryState: (state: SummaryUiState) => void;
  setEnded: (ended: boolean) => void;
  setRecording: (recording: boolean) => void;
  clearTranscription: () => void;
}

const initialState = {
  connection: "idle" as ConnectionState,
  connectionError: null as string | null,
  self: null as ParticipantInfo | null,
  meeting: null as RoomMeetingInfo | null,
  participants: {} as Record<string, ParticipantInfo>,
  messages: [] as ChatMessage[],
  segments: [] as TranscriptSegment[],
  transcription: {} as Record<string, TranscriptionStatus>,
  summary: null as Summary | null,
  summaryState: { state: "idle", mode: null } as SummaryUiState,
  ended: false,
  recording: false,
};

export const useMeetingStore = create<MeetingRoomState>((set) => ({
  ...initialState,

  reset: () => set({ ...initialState }),

  setConnection: (connection, error = null) =>
    set({ connection, connectionError: error }),

  setSelf: (self) => set({ self }),

  setMeeting: (meeting) => set({ meeting }),

  setParticipants: (list) =>
    set({
      participants: Object.fromEntries(list.map((participant) => [participant.participantId, participant])),
    }),

  upsertParticipant: (participant) =>
    set((state) => ({
      participants: { ...state.participants, [participant.participantId]: participant },
    })),

  removeParticipant: (participantId) =>
    set((state) => {
      const next = { ...state.participants };
      delete next[participantId];
      const transcription = { ...state.transcription };
      delete transcription[participantId];
      return { participants: next, transcription };
    }),

  setMedia: (participantId, media) =>
    set((state) => {
      const participant = state.participants[participantId];
      if (!participant) return state;
      return {
        participants: {
          ...state.participants,
          [participantId]: { ...participant, media },
        },
      };
    }),

  setRecordingState: (participantId, recording) =>
    set((state) => {
      if (state.self?.participantId === participantId) {
        return { self: { ...state.self, recording } };
      }
      const participant = state.participants[participantId];
      if (!participant) return state;
      return {
        participants: {
          ...state.participants,
          [participantId]: { ...participant, recording },
        },
      };
    }),

  addMessage: (message) =>
    set((state) =>
      state.messages.some((item) => item.id === message.id)
        ? state
        : { messages: [...state.messages, message] },
    ),

  setMessages: (messages) => set({ messages }),

  setSegments: (segments) =>
    set({ segments: [...segments].sort((a, b) => a.startSec - b.startSec) }),

  upsertSegment: (segment, replaceId) =>
    set((state) => {
      const filtered = state.segments.filter(
        (item) => item.segmentId !== segment.segmentId && item.segmentId !== replaceId,
      );
      return { segments: [...filtered, segment].sort((a, b) => a.startSec - b.startSec) };
    }),

  setTranscriptionStatus: (status) =>
    set((state) => ({
      transcription: { ...state.transcription, [status.participantId]: status },
    })),

  setSummary: (summary) => set({ summary }),

  setSummaryState: (summaryState) => set({ summaryState }),

  setEnded: (ended) => set({ ended }),

  setRecording: (recording) => set({ recording }),

  clearTranscription: () => set({ transcription: {} }),
}));
