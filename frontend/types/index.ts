export interface User {
  id: string;
  name: string;
  email: string;
  avatar: string | null;
}

export interface GuestInfo {
  name: string;
  roomId: string;
}

export interface MediaState {
  audio: boolean;
  video: boolean;
  screen: boolean;
}

export type RecordingState = "off" | "recording" | "paused";

export interface ParticipantInfo {
  participantId: string;
  name: string;
  isGuest: boolean;
  isHost: boolean;
  media: MediaState;
  recording: RecordingState;
  joinedAt: number;
}

export interface RoomPublic {
  roomId: string;
  title: string;
  status: "active" | "ended";
  hostName: string;
  participantCount: number;
  startedAt: string | null;
}

export interface MeetingListItem {
  _id: string;
  roomId: string;
  title: string;
  status: "active" | "ended";
  startedAt: string | null;
  endedAt: string | null;
  duration: number;
  host?: { name: string; email: string };
  participantCount: number;
  transcriptAvailable: boolean;
  recordingAvailable: boolean;
  transcriptionStatus: string;
  summaryStatus: string;
  createdAt: string;
}

export interface ParticipantRecord {
  _id: string;
  name: string;
  isGuest: boolean;
  joinedAt: string;
  leftAt: string | null;
  mediaState: MediaState;
}

export interface MeetingDetail extends MeetingListItem {
  participants: ParticipantRecord[];
  hostId: string;
  transcriptionError: string | null;
  summaryError: string | null;
  aiProcessed: boolean;
}

export type SegmentStatus = "final" | "edited" | "provisional";

export interface TranscriptSegment {
  segmentId: string;
  participantId: string;
  speakerName: string;
  startSec: number;
  endSec: number;
  text: string;
  status: SegmentStatus;
  language: string | null;
  source?: "live" | "manual";
}

export interface ActionItem {
  task: string;
  assignee: string | null;
  deadline: string | null;
}

export interface ImportantMoment {
  time: number;
  description: string;
}

export interface Summary {
  meetingId: string;
  status: "draft" | "final" | "failed";
  executiveSummary: string;
  keyPoints: string[];
  decisions: string[];
  actionItems: ActionItem[];
  importantMoments: ImportantMoment[];
  openQuestions: string[];
  model: string;
  generatedAt: string | null;
  basedOnSegmentCount: number;
  incompleteTranscript: boolean;
  error: string | null;
}

export interface ChatMessage {
  id: string;
  meetingId?: string;
  senderId: string;
  senderName: string;
  message: string;
  createdAt: string;
}

export interface TranscriptionStatus {
  participantId: string;
  speakerName?: string;
  state: "active" | "starting" | "idle" | "error" | "complete";
  message?: string;
  model?: string;
  device?: string;
  computeType?: string;
}

export interface LocalRecording {
  id: string;
  meetingId: string;
  roomId: string;
  meetingTitle: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  durationSec: number;
  createdAt: string;
  blob: Blob;
}

export interface HealthReport {
  ok: boolean;
  status: "ok" | "degraded";
  timestamp: string;
  version: string;
  services: {
    database: { ok: boolean; latencyMs: number; error?: string };
    transcription: {
      ok: boolean;
      status?: string;
      model?: string;
      device?: string;
      computeType?: string;
      modelLoaded?: boolean;
      error?: string;
      latencyMs: number;
    };
    ollama: {
      ok: boolean;
      model: string;
      modelAvailable: boolean;
      models: string[];
      error?: string;
      latencyMs: number;
    };
  };
  config: {
    transcriptionProvider: string;
    whisperModel: string;
    aiProvider: string;
    ollamaModel: string;
    maxParticipants: number;
  };
}

export interface MeetingStats {
  totalMeetings: number;
  transcribedMeetings: number;
  summarizedMeetings: number;
  totalDurationSec: number;
}
