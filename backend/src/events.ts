import { EventEmitter } from "node:events";

export interface MeetingEndedEvent {
  meetingId: string;
  roomId: string;
  reason: "host-ended" | "empty-room" | "system";
}

export interface TranscriptFinalEvent {
  meetingId: string;
  roomId: string;
  participantId: string;
  segmentId: string;
}

interface Events {
  "meeting:ended": (event: MeetingEndedEvent) => void;
  "transcript:final": (event: TranscriptFinalEvent) => void;
}

class TypedEmitter extends EventEmitter {
  emit<K extends keyof Events>(event: K, ...args: Parameters<Events[K]>): boolean {
    return super.emit(event, ...args);
  }

  on<K extends keyof Events>(event: K, listener: Events[K]): this {
    return super.on(event, listener);
  }

  off<K extends keyof Events>(event: K, listener: Events[K]): this {
    return super.off(event, listener);
  }
}

export const bus = new TypedEmitter();
