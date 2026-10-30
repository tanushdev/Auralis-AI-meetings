import { env } from "../config/env";
import { pingDatabase } from "../db/connect";
import { checkTranscriptionHealth } from "./TranscriptionService";
import { checkOllamaHealth } from "./AIService";

export interface HealthReport {
  ok: boolean;
  status: "ok" | "degraded";
  timestamp: string;
  version: string;
  services: {
    database: Awaited<ReturnType<typeof pingDatabase>>;
    transcription: Awaited<ReturnType<typeof checkTranscriptionHealth>>;
    ollama: Awaited<ReturnType<typeof checkOllamaHealth>>;
  };
  config: {
    transcriptionProvider: string;
    whisperModel: string;
    aiProvider: string;
    ollamaModel: string;
    maxParticipants: number;
  };
}

export async function getHealth(): Promise<HealthReport> {
  const [database, transcription, ollama] = await Promise.all([
    pingDatabase(),
    checkTranscriptionHealth(),
    checkOllamaHealth(),
  ]);

  const ok =
    database.ok && transcription.ok && ollama.ok && ollama.modelAvailable;

  return {
    ok,
    status: ok ? "ok" : "degraded",
    timestamp: new Date().toISOString(),
    version: "1.0.0",
    services: { database, transcription, ollama },
    config: {
      transcriptionProvider: env.transcriptionProvider,
      whisperModel: env.whisperModel,
      aiProvider: env.aiProvider,
      ollamaModel: env.ollamaModel,
      maxParticipants: env.maxParticipants,
    },
  };
}
