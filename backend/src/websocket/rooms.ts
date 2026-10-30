import type WebSocket from "ws";
import type { MediaState } from "../models/Participant";
import type { ParticipantAudioStream } from "../services/TranscriptionService";

export interface ParticipantConnection {
  participantId: string;
  userId: string | null;
  guestId: string | null;
  name: string;
  isGuest: boolean;
  socket: WebSocket;
  meetingId: string;
  roomId: string;
  joinedAt: number;
  media: MediaState;
  recording: RecordingState;
  audioStream: ParticipantAudioStream | null;
  audioStartedAt: number | null;
}

export type RecordingState = "off" | "recording" | "paused";

export interface Room {
  roomId: string;
  meetingId: string;
  hostUserId: string;
  participants: Map<string, ParticipantConnection>;
  createdAt: number;
  emptyTimer: NodeJS.Timeout | null;
  startedAtMs: number;
  ended: boolean;
}

export const rooms = new Map<string, Room>();

const roomFinalizations = new Map<string, Promise<void>>();

/**
 * Registers the work that must finish before a final transcript/summary is
 * considered complete. The summary orchestrator awaits this even if clients
 * have already disconnected.
 */
export function setRoomFinalization(roomId: string, task: Promise<void>): void {
  roomFinalizations.set(roomId, task);
  void task.finally(() => {
    if (roomFinalizations.get(roomId) === task) roomFinalizations.delete(roomId);
  });
}

export async function waitForRoomFinalization(
  roomId: string,
  timeoutMs = 90_000,
): Promise<boolean> {
  const task = roomFinalizations.get(roomId);
  if (!task) return true;
  const timeout = new Promise<false>((resolve) => {
    const timer = setTimeout(() => resolve(false), timeoutMs);
    timer.unref();
  });
  const result = await Promise.race([task.then(() => true), timeout]);
  return result !== false;
}

export function getRoom(roomId: string): Room | undefined {
  return rooms.get(roomId);
}

export function send(socket: WebSocket, payload: unknown): void {
  if (socket.readyState !== socket.OPEN) return;
  try {
    socket.send(JSON.stringify(payload));
  } catch {
    // Socket is closing; nothing to do.
  }
}

export function broadcast(roomId: string, payload: unknown, exceptParticipantId?: string): void {
  const room = rooms.get(roomId);
  if (!room) return;
  for (const participant of room.participants.values()) {
    if (participant.participantId === exceptParticipantId) continue;
    send(participant.socket, payload);
  }
}

export function serializeParticipant(participant: ParticipantConnection) {
  const room = rooms.get(participant.roomId);
  return {
    participantId: participant.participantId,
    name: participant.name,
    isGuest: participant.isGuest,
    isHost: Boolean(participant.userId && room?.hostUserId === participant.userId),
    media: participant.media,
    recording: participant.recording,
    joinedAt: participant.joinedAt,
  };
}

export function roomParticipants(room: Room) {
  return Array.from(room.participants.values()).map(serializeParticipant);
}

export function broadcastRoomState(roomId: string): void {
  const room = rooms.get(roomId);
  if (!room) return;
  const participants = roomParticipants(room);
  broadcast(roomId, { type: "ROOM_STATE", participants });
}
