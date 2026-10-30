import { env } from "../config/env";
import { bus, type MeetingEndedEvent, type TranscriptFinalEvent } from "../events";
import { Meeting } from "../models/Meeting";
import { logger } from "../utils/logger";
import { broadcast, waitForRoomFinalization } from "../websocket/rooms";
import { countFinalSegments } from "./TranscriptService";
import {
  generateMeetingSummary,
  getMeetingSummary,
  type SummaryMode,
} from "./MeetingSummaryService";

const incrementalState = new Map<string, { segments: number; lastDraftAt: number }>();
const finalizing = new Set<string>();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function summaryPayload(summary: Awaited<ReturnType<typeof getMeetingSummary>>) {
  if (!summary) return null;
  return {
    meetingId: summary.meetingId.toString(),
    status: summary.status,
    executiveSummary: summary.executiveSummary,
    keyPoints: summary.keyPoints,
    decisions: summary.decisions,
    actionItems: summary.actionItems,
    importantMoments: summary.importantMoments,
    openQuestions: summary.openQuestions,
    model: summary.model,
    generatedAt: summary.generatedAt,
    basedOnSegmentCount: summary.basedOnSegmentCount,
    incompleteTranscript: summary.incompleteTranscript,
    error: summary.error,
  };
}

async function handleTranscriptFinal(event: TranscriptFinalEvent): Promise<void> {
  const state = incrementalState.get(event.meetingId) ?? {
    segments: 0,
    lastDraftAt: Date.now(),
  };
  state.segments += 1;
  incrementalState.set(event.meetingId, state);

  if (state.segments < env.summaryIncrementSegments) return;
  if (Date.now() - state.lastDraftAt < env.summaryIncrementMinMs) return;

  const meeting = await Meeting.findById(event.meetingId).select("status").lean();
  if (!meeting || meeting.status !== "active") return;

  state.segments = 0;
  state.lastDraftAt = Date.now();

  broadcast(event.roomId, {
    type: "SUMMARY_PROGRESS",
    meetingId: event.meetingId,
    mode: "draft",
    state: "processing",
  });

  try {
    const summary = await generateMeetingSummary(event.meetingId, "draft");
    broadcast(event.roomId, {
      type: "SUMMARY_READY",
      meetingId: event.meetingId,
      mode: "draft",
      summary: summaryPayload(summary),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Draft summary failed";
    logger.warn(`Incremental summary failed for ${event.meetingId}: ${message}`);
    broadcast(event.roomId, {
      type: "SUMMARY_PROGRESS",
      meetingId: event.meetingId,
      mode: "draft",
      state: "error",
      message,
    });
  }
}

async function markTranscriptionFinished(meetingId: string): Promise<void> {
  const count = await countFinalSegments(meetingId);
  await Meeting.updateOne(
    { _id: meetingId },
    {
      $set: {
        transcriptionStatus: "complete",
        transcriptAvailable: count > 0,
        transcriptionError: null,
      },
    },
  );
}

/** Starts the final summary in the background and broadcasts progress. */
export async function startFinalSummary(meetingId: string, roomId: string): Promise<boolean> {
  if (finalizing.has(meetingId)) return false;
  finalizing.add(meetingId);
  incrementalState.delete(meetingId);

  await Meeting.updateOne(
    { _id: meetingId },
    { $set: { summaryStatus: "processing", summaryError: null, transcriptionStatus: "finalizing" } },
  );

  broadcast(roomId, {
    type: "SUMMARY_PROGRESS",
    meetingId,
    mode: "final",
    state: "processing",
  });

  void (async () => {
    try {
      await markTranscriptionFinished(meetingId);
      const summary = await generateMeetingSummary(meetingId, "final");
      broadcast(roomId, {
        type: "SUMMARY_READY",
        meetingId,
        mode: "final",
        summary: summaryPayload(summary),
      });
      broadcast(roomId, { type: "TRANSCRIPTION_STATUS", state: "complete", meetingId });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Final summary failed";
      logger.error(`Final summary failed for ${meetingId}: ${message}`);
      broadcast(roomId, {
        type: "SUMMARY_PROGRESS",
        meetingId,
        mode: "final",
        state: "error",
        message,
      });
    } finally {
      finalizing.delete(meetingId);
    }
  })();

  return true;
}

async function handleMeetingEnded(event: MeetingEndedEvent): Promise<void> {
  if (finalizing.has(event.meetingId)) return;
  logger.info(`Meeting ended (${event.reason}); scheduling final summary for ${event.meetingId}`);
  // Let the signaling layer register its room finalization, then wait for the
  // last audio windows and transcript writes to flush into MongoDB.
  await sleep(1000);
  const drained = await waitForRoomFinalization(event.roomId, 120_000);
  if (!drained) {
    logger.warn(`Timed out waiting for transcription to drain for ${event.meetingId}`);
  }
  const meeting = await Meeting.findById(event.meetingId).select("status transcriptionStatus").lean();
  if (!meeting) return;
  if (meeting.transcriptionStatus !== "failed") {
    await markTranscriptionFinished(event.meetingId);
  }
  await startFinalSummary(event.meetingId, event.roomId);
}

export function registerSummaryOrchestrator(): void {
  bus.on("transcript:final", (event) => {
    void handleTranscriptFinal(event);
  });
  bus.on("meeting:ended", (event) => {
    void handleMeetingEnded(event);
  });
}

export async function retryFinalSummary(meetingId: string, roomId: string): Promise<boolean> {
  const meeting = await Meeting.findById(meetingId).select("roomId").lean();
  if (!meeting) return false;
  return startFinalSummary(meetingId, meeting.roomId);
}

export async function requestSummary(meetingId: string, roomId: string, mode: SummaryMode) {
  if (mode === "final") return startFinalSummary(meetingId, roomId);
  const summary = await generateMeetingSummary(meetingId, "draft");
  return summaryPayload(summary);
}
