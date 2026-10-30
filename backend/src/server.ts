import "dotenv/config";
import http from "node:http";
import express from "express";
import cors from "cors";
import type { WebSocketServer } from "ws";
import { env } from "./config/env";
import { connectDatabase, disconnectDatabase } from "./db/connect";
import { attachAuth } from "./middleware/auth";
import { errorHandler, notFoundHandler } from "./middleware/error";
import { attachSignaling } from "./websocket/signaling";
import { registerSummaryOrchestrator } from "./services/SummaryOrchestrator";
import { getHealth } from "./services/HealthService";
import { logger } from "./utils/logger";
import { authRouter } from "./routes/auth.routes";
import { meetingRouter } from "./routes/meeting.routes";
import { transcriptListRouter, transcriptRouter } from "./routes/transcript.routes";
import { summaryRouter } from "./routes/summary.routes";
import { chatRouter } from "./routes/chat.routes";
import { recordingListRouter, recordingRouter } from "./routes/recording.routes";
import { healthRouter } from "./routes/health.routes";

const app = express();
app.disable("x-powered-by");
app.set("trust proxy", false);

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || env.corsOrigins.includes(origin)) {
        callback(null, true);
        return;
      }
      callback(null, false);
    },
    credentials: true,
    methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
  }),
);

app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Permissions-Policy", "camera=(self), microphone=(self), display-capture=(self)");
  next();
});

app.use(express.json({ limit: "1mb" }));
app.use(attachAuth);

app.use("/api/auth", authRouter);
app.use("/api/meetings", meetingRouter);
app.use("/api/meetings", transcriptRouter);
app.use("/api/meetings", summaryRouter);
app.use("/api/meetings", chatRouter);
app.use("/api/meetings", recordingRouter);
app.use("/api/transcripts", transcriptListRouter);
app.use("/api/recordings", recordingListRouter);
app.use("/api", healthRouter);

app.use(notFoundHandler);
app.use(errorHandler);

const server = http.createServer(app);
const wss: WebSocketServer = attachSignaling(server);
registerSummaryOrchestrator();

let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info(`${signal} received, shutting down`);
  await new Promise<void>((resolve) => {
    wss.clients.forEach((client) => {
      try {
        client.close(1001, "Server shutting down");
      } catch {
        // ignore
      }
    });
    wss.close(() => resolve());
    server.close(() => resolve());
    setTimeout(resolve, 5000).unref();
  });
  await disconnectDatabase().catch(() => undefined);
  process.exit(0);
}

async function start(): Promise<void> {
  await connectDatabase();
  server.listen(env.port, env.host, () => {
    logger.info(`Backend listening on http://${env.host}:${env.port}`);
    logger.info(`WebSocket signaling on ws://${env.host}:${env.port}/ws`);
    logger.info(
      `Local AI: transcription ${env.transcriptionUrl} (${env.whisperModel}), Ollama ${env.ollamaUrl} (${env.ollamaModel})`,
    );
  });

  setTimeout(() => {
    void getHealth()
      .then((report) => {
        const summary = Object.entries(report.services)
          .map(([name, value]) => `${name}=${value.ok ? "ok" : "down"}`)
          .join(" ");
        logger.info(`Startup health: ${summary}`);
        if (!report.ok) {
          logger.warn(
            "Some local services are unavailable. Transcription and summaries will fail until they are running.",
          );
        }
      })
      .catch((error) => logger.warn(`Startup health check failed: ${String(error)}`));
  }, 1200).unref();
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("unhandledRejection", (reason) => {
  logger.error("Unhandled promise rejection", reason);
});
process.on("uncaughtException", (error) => {
  logger.error("Uncaught exception", error);
});

start().catch((error) => {
  logger.error("Failed to start backend", error);
  console.error(
    "\nCould not start the backend. Is MongoDB running on the URI in backend/.env?\n" +
      "On Windows, check: Get-Service MongoDB\n",
  );
  process.exit(1);
});
