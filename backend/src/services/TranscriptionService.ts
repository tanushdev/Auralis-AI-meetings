import WebSocket from "ws";
import { env } from "../config/env";
import { logger } from "../utils/logger";

export interface StreamSegment {
  segmentId: string;
  status: "final" | "provisional";
  text: string;
  startSec: number;
  endSec: number;
  language: string | null;
  replaceId?: string | null;
}

export interface StreamReadyInfo {
  model?: string;
  device?: string;
  computeType?: string;
}

export interface StreamOptions {
  meetingId: string;
  participantId: string;
  speakerName: string;
  onReady?: (info: StreamReadyInfo) => void;
  onSegment: (segment: StreamSegment) => void;
  onError: (message: string) => void;
  onClose?: (unexpected: boolean) => void;
}

const MAX_QUEUE_BYTES = 2 * 1024 * 1024; // ~65s of 16-bit 16kHz mono

/**
 * One WebSocket connection to the local faster-whisper service per participant.
 * Audio only ever travels over loopback; the browser never sees this token.
 */
export class ParticipantAudioStream {
  private socket: WebSocket | null = null;
  private queue: Buffer[] = [];
  private queuedBytes = 0;
  private ready = false;
  private closedIntentionally = false;
  private closed = false;
  private closePromise: Promise<void> | null = null;
  private reconnectAttempts = 0;

  constructor(private readonly options: StreamOptions) {}

  connect(): void {
    if (this.closed) return;
    const token = encodeURIComponent(env.transcriptionToken);
    const url = `${env.transcriptionWsUrl}/ws/transcribe?token=${token}`;
    const socket = new WebSocket(url, { handshakeTimeout: 8000 });
    this.socket = socket;

    socket.on("open", () => {
      socket.send(
        JSON.stringify({
          type: "hello",
          meetingId: this.options.meetingId,
          participantId: this.options.participantId,
          speakerName: this.options.speakerName,
          sampleRate: 16000,
          channels: 1,
        }),
      );
    });

    socket.on("message", (data, isBinary) => {
      if (isBinary) return;
      let payload: Record<string, unknown>;
      try {
        payload = JSON.parse(data.toString()) as Record<string, unknown>;
      } catch {
        return;
      }
      if (payload.type === "ready") {
        this.ready = true;
        this.reconnectAttempts = 0;
        this.flushQueue();
        this.options.onReady?.({
          model: typeof payload.model === "string" ? payload.model : undefined,
          device: typeof payload.device === "string" ? payload.device : undefined,
          computeType: typeof payload.computeType === "string" ? payload.computeType : undefined,
        });
        return;
      }
      if (payload.type === "segment") {
        const text = typeof payload.text === "string" ? payload.text.trim() : "";
        if (!text) return;
        this.options.onSegment({
          segmentId: String(payload.segmentId ?? ""),
          status: payload.status === "final" ? "final" : "provisional",
          text,
          startSec: Number(payload.startSec ?? 0),
          endSec: Number(payload.endSec ?? payload.startSec ?? 0),
          language: typeof payload.language === "string" ? payload.language : null,
          replaceId: typeof payload.replaces === "string" ? payload.replaces : null,
        });
        return;
      }
      if (payload.type === "error") {
        this.options.onError(String(payload.message ?? "Transcription service error"));
      }
    });

    socket.on("error", (error) => {
      if (this.closed) return;
      logger.warn(`Transcription socket error for ${this.options.participantId}: ${error.message}`);
      this.options.onError(`Transcription service unavailable: ${error.message}`);
    });

    socket.on("close", (code, reason) => {
      if (this.closed) return;
      const intentional = this.closedIntentionally;
      this.ready = false;
      if (!intentional) {
        this.options.onError(
          `Transcription connection closed (${code})${reason.length ? `: ${reason.toString()}` : ""}`,
        );
      }
      this.options.onClose?.(!intentional);
    });
  }

  sendAudio(chunk: Buffer): void {
    if (this.closed) return;
    if (this.ready && this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(chunk, { binary: true });
      return;
    }
    this.queue.push(chunk);
    this.queuedBytes += chunk.length;
    while (this.queuedBytes > MAX_QUEUE_BYTES && this.queue.length > 1) {
      const dropped = this.queue.shift();
      this.queuedBytes -= dropped?.length ?? 0;
    }
  }

  flush(): void {
    if (this.ready && this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify({ type: "flush" }));
    }
  }

  close(): Promise<void> {
    if (this.closed) return this.closePromise ?? Promise.resolve();
    this.closed = true;
    this.closedIntentionally = true;
    this.ready = false;
    this.queue = [];
    this.queuedBytes = 0;
    const socket = this.socket;
    this.socket = null;
    if (!socket) {
      this.closePromise = Promise.resolve();
      return this.closePromise;
    }

    let resolveClosed!: () => void;
    this.closePromise = new Promise<void>((resolve) => {
      resolveClosed = resolve;
    });

    let settled = false;
    const finalize = (terminate: boolean) => {
      if (settled) return;
      settled = true;
      if (terminate) {
        try {
          socket.terminate();
        } catch {
          // ignore
        }
      }
      clearTimeout(timer);
      resolveClosed();
    };
    const timer = setTimeout(() => finalize(true), 30_000);
    timer.unref();
    socket.once("close", () => finalize(false));

    if (socket.readyState === WebSocket.OPEN) {
      try {
        // flush commits the remaining audio, stop lets the service drain and
        // close cleanly; we wait for that final segment before resolving.
        socket.send(JSON.stringify({ type: "flush" }));
        socket.send(JSON.stringify({ type: "stop" }));
      } catch {
        finalize(true);
      }
    } else if (socket.readyState === WebSocket.CLOSING) {
      // The remote side is already closing; the close event will resolve us.
    } else {
      finalize(true);
    }
    return this.closePromise;
  }

  private flushQueue(): void {
    if (!this.ready || this.socket?.readyState !== WebSocket.OPEN) return;
    for (const chunk of this.queue) {
      this.socket.send(chunk, { binary: true });
    }
    this.queue = [];
    this.queuedBytes = 0;
  }
}

export interface TranscriptionHealth {
  ok: boolean;
  status?: string;
  model?: string;
  device?: string;
  computeType?: string;
  modelLoaded?: boolean;
  error?: string;
  latencyMs: number;
}

export async function checkTranscriptionHealth(timeoutMs = 3000): Promise<TranscriptionHealth> {
  const started = Date.now();
  try {
    const response = await fetch(`${env.transcriptionUrl}/health`, {
      headers: env.transcriptionToken ? { "x-transcription-token": env.transcriptionToken } : {},
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) {
      return { ok: false, error: `HTTP ${response.status}`, latencyMs: Date.now() - started };
    }
    const body = (await response.json()) as Record<string, unknown>;
    return {
      ok: Boolean(body.ok),
      status: typeof body.state === "string" ? body.state : undefined,
      model: typeof body.model === "string" ? body.model : undefined,
      device: typeof body.device === "string" ? body.device : undefined,
      computeType: typeof body.computeType === "string" ? body.computeType : undefined,
      modelLoaded: Boolean(body.modelLoaded),
      error: typeof body.error === "string" ? body.error : undefined,
      latencyMs: Date.now() - started,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Transcription service unreachable",
      latencyMs: Date.now() - started,
    };
  }
}
