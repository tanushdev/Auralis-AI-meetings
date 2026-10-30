import { Router } from "express";
import { requireAuth, requireUser } from "../middleware/auth";
import { env } from "../config/env";
import { getHealth } from "../services/HealthService";
import { checkTranscriptionHealth } from "../services/TranscriptionService";
import { checkOllamaHealth } from "../services/AIService";

export const healthRouter = Router();

healthRouter.get("/health", async (_req, res) => {
  const report = await getHealth();
  res.status(report.ok ? 200 : 200).json(report);
});

healthRouter.get("/transcription/status", requireAuth, async (_req, res) => {
  const [transcription, ollama] = await Promise.all([
    checkTranscriptionHealth(),
    checkOllamaHealth(),
  ]);
  res.json({ transcription, ollama });
});

healthRouter.get("/settings", requireUser, (_req, res) => {
  res.json({
    config: {
      transcriptionProvider: env.transcriptionProvider,
      whisperModel: env.whisperModel,
      aiProvider: env.aiProvider,
      ollamaModel: env.ollamaModel,
      maxParticipants: env.maxParticipants,
      summaryChunkChars: env.summaryChunkChars,
      summaryIncrementSegments: env.summaryIncrementSegments,
      summaryIncrementMinMs: env.summaryIncrementMinMs,
      maxUploadMb: env.maxUploadMb,
    },
  });
});
