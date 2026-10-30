import path from "node:path";
import dotenv from "dotenv";
import { z } from "zod";

dotenv.config({ path: path.resolve(__dirname, "../../.env") });

const schema = z.object({
  PORT: z.coerce.number().int().positive().default(5000),
  HOST: z.string().default("127.0.0.1"),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  CORS_ORIGINS: z.string().default("http://localhost:3000,http://127.0.0.1:3000"),
  MONGO_URI: z.string().default("mongodb://127.0.0.1:27017/ai-meeting"),
  JWT_SECRET: z
    .string()
    .min(32, "JWT_SECRET must be at least 32 characters. Run `npm run setup` to generate one."),
  JWT_EXPIRES_IN: z.string().default("7d"),
  GUEST_TOKEN_EXPIRES_IN: z.string().default("12h"),
  TRANSCRIPTION_URL: z.string().default("http://127.0.0.1:8000"),
  TRANSCRIPTION_WS_URL: z.string().default("ws://127.0.0.1:8000"),
  TRANSCRIPTION_TOKEN: z.string().default(""),
  TRANSCRIPTION_PROVIDER: z.string().default("faster-whisper"),
  WHISPER_MODEL: z.string().default("small"),
  AI_PROVIDER: z.string().default("ollama"),
  OLLAMA_URL: z.string().default("http://127.0.0.1:11434"),
  OLLAMA_MODEL: z.string().default("llama3.1:8b"),
  OLLAMA_TIMEOUT_MS: z.coerce.number().int().positive().default(240000),
  OLLAMA_NUM_CTX: z.coerce.number().int().positive().default(8192),
  SUMMARY_INCREMENT_SEGMENTS: z.coerce.number().int().positive().default(12),
  SUMMARY_INCREMENT_MIN_MS: z.coerce.number().int().nonnegative().default(180000),
  SUMMARY_CHUNK_CHARS: z.coerce.number().int().positive().default(7000),
  MAX_PARTICIPANTS: z.coerce.number().int().min(2).max(8).default(6),
  MAX_UPLOAD_MB: z.coerce.number().int().positive().default(25),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error("Invalid environment configuration:");
  for (const issue of parsed.error.issues) {
    console.error(`  - ${issue.path.join(".")}: ${issue.message}`);
  }
  console.error("\nRun `npm run setup` to generate backend/.env from the root .env.");
  process.exit(1);
}

const raw = parsed.data;

export const env = {
  port: raw.PORT,
  host: raw.HOST,
  nodeEnv: raw.NODE_ENV,
  isProduction: raw.NODE_ENV === "production",
  corsOrigins: raw.CORS_ORIGINS.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
  mongoUri: raw.MONGO_URI,
  jwtSecret: raw.JWT_SECRET,
  jwtExpiresIn: raw.JWT_EXPIRES_IN,
  guestTokenExpiresIn: raw.GUEST_TOKEN_EXPIRES_IN,
  transcriptionUrl: raw.TRANSCRIPTION_URL.replace(/\/$/, ""),
  transcriptionWsUrl: raw.TRANSCRIPTION_WS_URL.replace(/\/$/, ""),
  transcriptionToken: raw.TRANSCRIPTION_TOKEN,
  transcriptionProvider: raw.TRANSCRIPTION_PROVIDER,
  whisperModel: raw.WHISPER_MODEL,
  aiProvider: raw.AI_PROVIDER,
  ollamaUrl: raw.OLLAMA_URL.replace(/\/$/, ""),
  ollamaModel: raw.OLLAMA_MODEL,
  ollamaTimeoutMs: raw.OLLAMA_TIMEOUT_MS,
  ollamaNumCtx: raw.OLLAMA_NUM_CTX,
  summaryIncrementSegments: raw.SUMMARY_INCREMENT_SEGMENTS,
  summaryIncrementMinMs: raw.SUMMARY_INCREMENT_MIN_MS,
  summaryChunkChars: raw.SUMMARY_CHUNK_CHARS,
  maxParticipants: raw.MAX_PARTICIPANTS,
  maxUploadMb: raw.MAX_UPLOAD_MB,
};

export type Env = typeof env;
