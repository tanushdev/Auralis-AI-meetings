import type { Server as HttpServer } from "node:http";
import { randomUUID } from "node:crypto";
import { WebSocketServer, WebSocket } from "ws";
import { z } from "zod";
import { Types } from "mongoose";
import { env } from "../config/env";
import { AUTH_COOKIE, GUEST_COOKIE, parseCookieHeader } from "../utils/cookies";
import { verifyToken } from "../utils/jwt";
import { ROOM_ID_PATTERN } from "../utils/ids";
import { logger } from "../utils/logger";
import { ChatMessage } from "../models/ChatMessage";
import { Meeting } from "../models/Meeting";
import { Participant } from "../models/Participant";
import type { MediaState } from "../models/Participant";
import {
  getMeetingByRoomId,
  markMeetingEnded,
  startMeetingIfNeeded,
} from "../services/MeetingService";
import { appendFinalSegment } from "../services/TranscriptService";
import { ParticipantAudioStream, type StreamSegment } from "../services/TranscriptionService";
import { bus } from "../events";
import {
  broadcast,
  broadcastRoomState,
  getRoom,
  rooms,
  send,
  serializeParticipant,
  setRoomFinalization,
  type ParticipantConnection,
  type Room,
} from "./rooms";
import type { AuthContext, GuestTokenPayload, UserTokenPayload } from "../types/auth";

const JOIN_TIMEOUT_MS = 15_000;
const EMPTY_ROOM_GRACE_MS = 20_000;
const CHAT_WINDOW_MS = 10_000;
const CHAT_MAX_PER_WINDOW = 12;

// ---------------------------------------------------------------------------
// Event schemas
// ---------------------------------------------------------------------------

const mediaStateSchema = z.object({
  audio: z.boolean(),
  video: z.boolean(),
  screen: z.boolean(),
});

const candidateSchema = z
  .object({
    candidate: z.string().min(1).max(4000),
    sdpMid: z.string().max(100).nullable().optional(),
    sdpMLineIndex: z.number().int().min(0).nullable().optional(),
    usernameFragment: z.string().max(200).nullable().optional(),
  })
  .nullable();

const clientEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("JOIN_ROOM"), roomId: z.string().regex(ROOM_ID_PATTERN) }),
  z.object({ type: z.literal("LEAVE_ROOM") }),
  z.object({
    type: z.literal("OFFER"),
    to: z.string().min(1).max(100),
    sdp: z.string().min(1).max(300_000),
  }),
  z.object({
    type: z.literal("ANSWER"),
    to: z.string().min(1).max(100),
    sdp: z.string().min(1).max(300_000),
  }),
  z.object({
    type: z.literal("ICE_CANDIDATE"),
    to: z.string().min(1).max(100),
    candidate: candidateSchema,
  }),
  z.object({ type: z.literal("MEDIA_STATE"), media: mediaStateSchema }),
  z.object({
    type: z.literal("RECORDING_STATE"),
    state: z.enum(["off", "recording", "paused"]),
  }),
  z.object({ type: z.literal("CHAT_MESSAGE"), message: z.string().trim().min(1).max(2000) }),
  z.object({
    type: z.literal("AUDIO_START"),
    sampleRate: z.number().int().min(8000).max(48000).default(16000),
  }),
  z.object({ type: z.literal("AUDIO_STOP") }),
  z.object({ type: z.literal("TRANSCRIPTION_RETRY") }),
  z.object({ type: z.literal("PING") }),
]);

type ClientEvent = z.infer<typeof clientEventSchema>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function authenticateRequest(cookieHeader: string | undefined): AuthContext | null {
  if (!cookieHeader) return null;
  const cookies = parseCookieHeader(cookieHeader);

  const userToken = cookies[AUTH_COOKIE];
  if (userToken) {
    const payload = verifyToken<UserTokenPayload>(userToken);
    if (payload?.role === "user" && payload.sub) {
      return {
        role: "user",
        userId: payload.sub,
        name: payload.name,
        email: payload.email,
      };
    }
  }

  const guestToken = cookies[GUEST_COOKIE];
  if (guestToken) {
    const payload = verifyToken<GuestTokenPayload>(guestToken);
    if (payload?.role === "guest" && payload.sub && payload.roomId) {
      return {
        role: "guest",
        guestId: payload.sub,
        name: payload.name,
        roomId: payload.roomId,
      };
    }
  }

  return null;
}

function errorMessage(socket: WebSocket, code: string, message: string, details?: unknown): void {
  send(socket, { type: "ERROR", code, message, details });
}

function toMediaState(media: MediaState): MediaState {
  return { audio: media.audio, video: media.video, screen: media.screen };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref();
  });
}

// ---------------------------------------------------------------------------
// Signaling server
// ---------------------------------------------------------------------------

export function attachSignaling(server: HttpServer): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 });

  server.on("upgrade", (request, socket, head) => {
    let pathname = "/";
    try {
      pathname = new URL(request.url ?? "/", "http://localhost").pathname;
    } catch {
      pathname = "/";
    }
    if (pathname !== "/ws") {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit("connection", ws, request);
    });
  });

  wss.on("connection", (socket, request) => {
    const auth = authenticateRequest(request.headers.cookie);
    if (!auth) {
      errorMessage(socket, "UNAUTHORIZED", "Authentication required");
      socket.close(4401, "Unauthorized");
      return;
    }

    let connection: ParticipantConnection | null = null;
    let cleanedUp = false;
    let chatTimestamps: number[] = [];
    let joinTimer: NodeJS.Timeout | null = setTimeout(() => {
      if (!connection) {
        errorMessage(socket, "JOIN_TIMEOUT", "You must join a room after connecting");
        socket.close(4408, "Join timeout");
      }
    }, JOIN_TIMEOUT_MS);

    const cleanup = async (): Promise<void> => {
      if (cleanedUp) return;
      cleanedUp = true;
      if (joinTimer) {
        clearTimeout(joinTimer);
        joinTimer = null;
      }
      const conn = connection;
      if (!conn) return;

      const room = getRoom(conn.roomId);
      if (room && room.participants.get(conn.participantId) === conn) {
        room.participants.delete(conn.participantId);
      }

      const stream = conn.audioStream;
      conn.audioStream = null;
      stream?.close();

      try {
        await Participant.updateOne(
          { _id: new Types.ObjectId(conn.participantId) },
          { $set: { leftAt: new Date(), socketId: null } },
        );
      } catch (error) {
        logger.warn(`Failed to update participant leftAt: ${String(error)}`);
      }

      if (room) {
        broadcast(room.roomId, { type: "PEER_LEFT", participantId: conn.participantId });
        broadcastRoomState(room.roomId);
        broadcast(room.roomId, {
          type: "TRANSCRIPTION_STATUS",
          meetingId: room.meetingId,
          participantId: conn.participantId,
          state: "idle",
        });

        if (!room.ended && room.participants.size === 0 && !room.emptyTimer) {
          room.emptyTimer = setTimeout(() => {
            void (async () => {
              const current = rooms.get(room.roomId);
              if (!current || current.participants.size > 0) return;
              try {
                const meeting = await Meeting.findById(current.meetingId);
                if (meeting && meeting.status !== "ended") {
                  await markMeetingEnded(meeting, "empty-room");
                }
              } catch (error) {
                logger.error(`Auto-end failed for room ${current.roomId}`, error);
              } finally {
                rooms.delete(current.roomId);
              }
            })();
          }, EMPTY_ROOM_GRACE_MS);
          room.emptyTimer.unref();
        }
      }
    };

    socket.on("close", () => {
      void cleanup();
    });
    socket.on("error", (error) => {
      logger.warn(`WebSocket error: ${error.message}`);
    });

    const handleSegment = async (
      conn: ParticipantConnection,
      room: Room,
      segment: StreamSegment,
    ): Promise<void> => {
      if (segment.text.trim().length === 0) return;
      const offsetSec =
        ((conn.audioStartedAt ?? Date.now()) - room.startedAtMs) / 1000;
      const startSec = Math.max(0, offsetSec + segment.startSec);
      const endSec = Math.max(startSec, offsetSec + segment.endSec);
      const replaceId = segment.replaceId
        ? `${conn.participantId}:${segment.replaceId}`
        : null;

      if (segment.status === "final") {
        const segmentKey = `${conn.participantId}:${segment.segmentId}`;
        let inserted = false;
        try {
          inserted = await appendFinalSegment(room.meetingId, {
            segmentId: segmentKey,
            participantId: conn.participantId,
            speakerName: conn.name,
            startSec,
            endSec,
            text: segment.text,
            language: segment.language,
          });
        } catch (error) {
          logger.error(`Failed to persist transcript segment`, error);
          errorMessage(socket, "TRANSCRIPT_SAVE_FAILED", "Transcript segment could not be saved");
          return;
        }
        if (!inserted) return;

        broadcast(room.roomId, {
          type: "TRANSCRIPT_UPDATE",
          meetingId: room.meetingId,
          replaceId,
          segment: {
            segmentId: segmentKey,
            participantId: conn.participantId,
            speakerName: conn.name,
            startSec,
            endSec,
            text: segment.text,
            status: "final",
            language: segment.language,
          },
        });
        bus.emit("transcript:final", {
          meetingId: room.meetingId,
          roomId: room.roomId,
          participantId: conn.participantId,
          segmentId: segmentKey,
        });
        return;
      }

      broadcast(room.roomId, {
        type: "TRANSCRIPT_UPDATE",
        meetingId: room.meetingId,
        replaceId,
        segment: {
          segmentId: `${conn.participantId}:${segment.segmentId}`,
          participantId: conn.participantId,
          speakerName: conn.name,
          startSec,
          endSec,
          text: segment.text,
          status: "provisional",
          language: segment.language,
        },
      });
    };

    const startTranscription = (conn: ParticipantConnection, room: Room): void => {
      if (conn.audioStream) {
        conn.audioStream.close();
        conn.audioStream = null;
      }
      conn.audioStartedAt = Date.now();

      broadcast(room.roomId, {
        type: "TRANSCRIPTION_STATUS",
        meetingId: room.meetingId,
        participantId: conn.participantId,
        speakerName: conn.name,
        state: "starting",
      });

      const stream = new ParticipantAudioStream({
        meetingId: room.meetingId,
        participantId: conn.participantId,
        speakerName: conn.name,
        onReady: (info) => {
          broadcast(room.roomId, {
            type: "TRANSCRIPTION_STATUS",
            meetingId: room.meetingId,
            participantId: conn.participantId,
            speakerName: conn.name,
            state: "active",
            model: info.model,
            device: info.device,
            computeType: info.computeType,
          });
        },
        onSegment: (segment) => {
          void handleSegment(conn, room, segment);
        },
        onError: (message) => {
          broadcast(room.roomId, {
            type: "TRANSCRIPTION_STATUS",
            meetingId: room.meetingId,
            participantId: conn.participantId,
            speakerName: conn.name,
            state: "error",
            message,
          });
          void Meeting.updateOne(
            { _id: room.meetingId },
            { $set: { transcriptionStatus: "failed", transcriptionError: message } },
          ).catch(() => undefined);
        },
        onClose: () => {
          if (conn.audioStream === stream) conn.audioStream = null;
        },
      });

      conn.audioStream = stream;
      stream.connect();

      void Meeting.updateOne(
        { _id: room.meetingId },
        { $set: { transcriptionStatus: "active", transcriptionError: null } },
      ).catch(() => undefined);
    };

    const stopTranscription = (conn: ParticipantConnection, room: Room): void => {
      conn.audioStream?.close();
      conn.audioStream = null;
      conn.audioStartedAt = null;
      broadcast(room.roomId, {
        type: "TRANSCRIPTION_STATUS",
        meetingId: room.meetingId,
        participantId: conn.participantId,
        state: "idle",
      });
    };

    const joinRoom = async (event: Extract<ClientEvent, { type: "JOIN_ROOM" }>): Promise<void> => {
      if (connection) {
        errorMessage(socket, "ALREADY_JOINED", "You are already in a room");
        return;
      }
      if (auth.role === "guest" && auth.roomId !== event.roomId) {
        errorMessage(socket, "FORBIDDEN", "Your guest pass is for a different meeting");
        socket.close(4403, "Forbidden");
        return;
      }

      const meeting = await getMeetingByRoomId(event.roomId);
      if (!meeting) {
        errorMessage(socket, "ROOM_NOT_FOUND", "That meeting does not exist");
        return;
      }
      if (meeting.status === "ended") {
        errorMessage(socket, "MEETING_ENDED", "That meeting has already ended");
        socket.close(4000, "Meeting ended");
        return;
      }

      let room = getRoom(event.roomId);
      if (room && room.participants.size >= env.maxParticipants) {
        errorMessage(socket, "ROOM_FULL", `This meeting is full (${env.maxParticipants} participants)`);
        socket.close(4004, "Room full");
        return;
      }

      let participant = auth.role === "user"
        ? await Participant.findOne({
            meetingId: meeting._id,
            userId: new Types.ObjectId(auth.userId),
            leftAt: null,
          })
        : await Participant.findOne({
            meetingId: meeting._id,
            guestId: auth.guestId,
            leftAt: null,
          });

      if (!participant) {
        participant = await Participant.create({
          meetingId: meeting._id,
          userId: auth.role === "user" ? new Types.ObjectId(auth.userId) : null,
          guestId: auth.role === "guest" ? auth.guestId : null,
          name: auth.name,
          isGuest: auth.role === "guest",
          joinedAt: new Date(),
          leftAt: null,
          socketId: socketId(),
          mediaState: { audio: false, video: false, screen: false },
        });
      } else {
        await Participant.updateOne(
          { _id: participant._id },
          { $set: { leftAt: null, socketId: socketId(), name: auth.name } },
        );
      }

      await Meeting.updateOne(
        { _id: meeting._id },
        { $addToSet: { participants: participant._id } },
      );

      await startMeetingIfNeeded(meeting);
      const startedAt = meeting.startedAt ?? new Date();

      if (!room) {
        room = {
          roomId: meeting.roomId,
          meetingId: meeting._id.toString(),
          hostUserId: meeting.hostId.toString(),
          participants: new Map(),
          createdAt: Date.now(),
          emptyTimer: null,
          startedAtMs: startedAt.getTime(),
          ended: false,
        };
        rooms.set(room.roomId, room);
      }
      if (room.emptyTimer) {
        clearTimeout(room.emptyTimer);
        room.emptyTimer = null;
      }

      const participantId = participant._id.toString();
      const existing = room.participants.get(participantId);
      if (existing && existing.socket !== socket) {
        room.participants.delete(participantId);
        errorMessage(existing.socket, "REPLACED", "You joined from another connection");
        existing.socket.close(4001, "Replaced by new connection");
      }

      const conn: ParticipantConnection = {
        participantId,
        userId: auth.role === "user" ? auth.userId : null,
        guestId: auth.role === "guest" ? auth.guestId : null,
        name: auth.name,
        isGuest: auth.role === "guest",
        socket,
        meetingId: room.meetingId,
        roomId: room.roomId,
        joinedAt: Date.now(),
        media: { audio: false, video: false, screen: false },
        recording: "off",
        audioStream: null,
        audioStartedAt: null,
      };

      room.participants.set(participantId, conn);
      connection = conn;
      if (joinTimer) {
        clearTimeout(joinTimer);
        joinTimer = null;
      }

      const others = Array.from(room.participants.values()).filter(
        (item) => item.participantId !== participantId,
      );

      send(socket, {
        type: "ROOM_JOINED",
        self: serializeParticipant(conn),
        participants: others.map(serializeParticipant),
        initiateTo: others.map((item) => item.participantId),
        meeting: {
          id: room.meetingId,
          roomId: room.roomId,
          title: meeting.title,
          hostId: meeting.hostId.toString(),
          startedAt: startedAt.toISOString(),
        },
        serverTime: Date.now(),
      });

      broadcast(
        room.roomId,
        { type: "PEER_JOINED", participant: serializeParticipant(conn) },
        participantId,
      );
      broadcastRoomState(room.roomId);
      logger.info(`Participant ${auth.name} joined room ${room.roomId} (${room.participants.size})`);
    };

    socket.on("message", (raw, isBinary) => {
      if (isBinary) {
        if (!connection?.audioStream) {
          errorMessage(socket, "AUDIO_NOT_STARTED", "Send AUDIO_START before streaming audio");
          return;
        }
        const data = Buffer.isBuffer(raw) ? raw : Buffer.from(raw as ArrayBuffer);
        connection.audioStream.sendAudio(data);
        return;
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(raw.toString());
      } catch {
        errorMessage(socket, "INVALID_JSON", "Message must be valid JSON");
        return;
      }

      const result = clientEventSchema.safeParse(parsed);
      if (!result.success) {
        errorMessage(socket, "INVALID_EVENT", "Invalid event payload", {
          issues: result.error.issues.map((issue) => ({
            path: issue.path.join("."),
            message: issue.message,
          })),
        });
        return;
      }

      const event = result.data;

      if (event.type === "JOIN_ROOM") {
        void joinRoom(event).catch((error) => {
          logger.error("Join room failed", error);
          errorMessage(socket, "JOIN_FAILED", "Could not join the room");
        });
        return;
      }

      if (!connection) {
        errorMessage(socket, "NOT_JOINED", "Join a room first");
        return;
      }
      const conn = connection;
      const room = getRoom(conn.roomId);
      if (!room) {
        errorMessage(socket, "ROOM_CLOSED", "The room is no longer available");
        return;
      }

      switch (event.type) {
        case "LEAVE_ROOM":
          errorMessage(socket, "LEFT", "You left the meeting");
          socket.close(1000, "Left meeting");
          break;

        case "OFFER":
        case "ANSWER": {
          const target = room.participants.get(event.to);
          if (!target) {
            errorMessage(socket, "PEER_NOT_FOUND", "That participant has left");
            return;
          }
          send(target.socket, { type: event.type, from: conn.participantId, sdp: event.sdp });
          break;
        }

        case "ICE_CANDIDATE": {
          const target = room.participants.get(event.to);
          if (!target) return;
          send(target.socket, {
            type: "ICE_CANDIDATE",
            from: conn.participantId,
            candidate: event.candidate,
          });
          break;
        }

        case "MEDIA_STATE": {
          const media = toMediaState(event.media);
          conn.media = media;
          void Participant.updateOne(
            { _id: new Types.ObjectId(conn.participantId) },
            { $set: { mediaState: media } },
          ).catch(() => undefined);
          broadcast(
            room.roomId,
            { type: "MEDIA_STATE", participantId: conn.participantId, media },
            conn.participantId,
          );
          break;
        }

        case "RECORDING_STATE": {
          conn.recording = event.state;
          broadcast(room.roomId, {
            type: "RECORDING_STATE",
            participantId: conn.participantId,
            speakerName: conn.name,
            state: conn.recording,
          });
          break;
        }

        case "CHAT_MESSAGE": {
          const now = Date.now();
          chatTimestamps = chatTimestamps.filter((stamp) => now - stamp < CHAT_WINDOW_MS);
          if (chatTimestamps.length >= CHAT_MAX_PER_WINDOW) {
            errorMessage(socket, "CHAT_RATE_LIMIT", "You are sending messages too quickly");
            return;
          }
          chatTimestamps.push(now);

          void (async () => {
            try {
              const saved = await ChatMessage.create({
                meetingId: new Types.ObjectId(room.meetingId),
                senderId: conn.participantId,
                userId: conn.userId ? new Types.ObjectId(conn.userId) : null,
                senderName: conn.name,
                message: event.message,
              });
              broadcast(room.roomId, {
                type: "CHAT_MESSAGE",
                message: {
                  id: saved._id.toString(),
                  meetingId: room.meetingId,
                  senderId: conn.participantId,
                  senderName: conn.name,
                  message: saved.message,
                  createdAt: saved.createdAt.toISOString(),
                },
              });
            } catch (error) {
              logger.error("Failed to save chat message", error);
              errorMessage(socket, "CHAT_SAVE_FAILED", "Message could not be saved");
            }
          })();
          break;
        }

        case "AUDIO_START":
          startTranscription(conn, room);
          break;

        case "AUDIO_STOP":
          stopTranscription(conn, room);
          break;

        case "TRANSCRIPTION_RETRY":
          stopTranscription(conn, room);
          startTranscription(conn, room);
          break;

        case "PING":
          send(socket, { type: "PONG", serverTime: Date.now() });
          break;

        default:
          break;
      }
    });
  });

  const heartbeat = setInterval(() => {
    for (const socket of wss.clients) {
      const alive = (socket as WebSocket & { isAlive?: boolean }).isAlive;
      if (alive === false) {
        socket.terminate();
        continue;
      }
      (socket as WebSocket & { isAlive?: boolean }).isAlive = false;
      try {
        socket.ping();
      } catch {
        // ignore
      }
    }
  }, 25_000);
  heartbeat.unref();

  wss.on("connection", (socket) => {
    (socket as WebSocket & { isAlive?: boolean }).isAlive = true;
    socket.on("pong", () => {
      (socket as WebSocket & { isAlive?: boolean }).isAlive = true;
    });
  });

  wss.on("close", () => {
    clearInterval(heartbeat);
  });

  bus.on("meeting:ended", ({ roomId }) => {
    const room = getRoom(roomId);
    if (!room) return;
    room.ended = true;
    if (room.emptyTimer) {
      clearTimeout(room.emptyTimer);
      room.emptyTimer = null;
    }

    const participants = Array.from(room.participants.values());
    const streams = participants
      .map((participant) => participant.audioStream)
      .filter((stream): stream is ParticipantAudioStream => Boolean(stream));

    for (const stream of streams) stream.flush();
    for (const participant of participants) {
      send(participant.socket, { type: "MEETING_ENDED", roomId });
    }

    const finalization = (async () => {
      // Give the final flush a moment to reach the transcription service, then
      // close each stream and wait for its final segments to be emitted.
      await delay(700);
      await Promise.allSettled(streams.map((stream) => stream.close()));
      // Segment persistence (MongoDB writes) is dispatched from the stream's
      // message handler; allow those writes to settle before summarising.
      await delay(800);
      for (const participant of participants) {
        if (participant.socket.readyState === participant.socket.OPEN) {
          participant.socket.close(4000, "Meeting ended");
        }
      }
      rooms.delete(roomId);
    })();

    setRoomFinalization(roomId, finalization);
  });

  return wss;
}

function socketId(): string {
  return randomUUID();
}
