import mongoose from "mongoose";
import { env } from "../config/env";
import { logger } from "../utils/logger";

export async function connectDatabase(): Promise<void> {
  mongoose.set("strictQuery", true);
  await mongoose.connect(env.mongoUri, {
    serverSelectionTimeoutMS: 5000,
    maxPoolSize: 10,
  });
  logger.info(`MongoDB connected: ${mongoose.connection.name}`);
}

export async function pingDatabase(): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
  const started = Date.now();
  try {
    if (mongoose.connection.readyState !== 1) {
      return { ok: false, latencyMs: Date.now() - started, error: "Not connected" };
    }
    await mongoose.connection.db?.admin().ping();
    return { ok: true, latencyMs: Date.now() - started };
  } catch (error) {
    return {
      ok: false,
      latencyMs: Date.now() - started,
      error: error instanceof Error ? error.message : "Unknown MongoDB error",
    };
  }
}

export async function disconnectDatabase(): Promise<void> {
  await mongoose.disconnect();
}
