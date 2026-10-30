import { Router } from "express";
import { z } from "zod";
import { requireAuth, requireUser } from "../middleware/auth";
import { validate } from "../middleware/error";
import { badRequest, forbidden } from "../utils/errors";
import { assertMeetingAccessOrThrow, getMeetingById } from "../services/MeetingService";
import { getMeetingSummary } from "../services/MeetingSummaryService";
import { requestSummary, retryFinalSummary } from "../services/SummaryOrchestrator";
import { param } from "../utils/http";

export const summaryRouter = Router();

function serialize(summary: Awaited<ReturnType<typeof getMeetingSummary>>) {
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

summaryRouter.get("/:id/summary", requireAuth, async (req, res) => {
  const auth = req.auth!;
  const meeting = await getMeetingById(param(req, "id"));
  await assertMeetingAccessOrThrow(meeting, auth);
  const summary = await getMeetingSummary(meeting._id.toString());
  res.json({
    summary: serialize(summary),
    meeting: {
      id: meeting._id.toString(),
      title: meeting.title,
      status: meeting.status,
      summaryStatus: meeting.summaryStatus,
      summaryError: meeting.summaryError,
      transcriptionStatus: meeting.transcriptionStatus,
      transcriptionError: meeting.transcriptionError,
      transcriptAvailable: meeting.transcriptAvailable,
    },
  });
});

summaryRouter.post("/:id/summarize/retry", requireUser, async (req, res) => {
  const auth = req.auth!;
  if (auth.role !== "user") throw forbidden();
  const meeting = await getMeetingById(param(req, "id"));
  if (meeting.hostId.toString() !== auth.userId) {
    throw forbidden("Only the host can retry the summary");
  }
  const started = await retryFinalSummary(meeting._id.toString(), meeting.roomId);
  if (!started) {
    res.status(202).json({ status: "processing", message: "A summary is already being generated." });
    return;
  }
  res.status(202).json({ status: "processing", message: "Retrying the final summary." });
});

summaryRouter.post("/:id/summarize", requireUser, async (req, res) => {
  const auth = req.auth!;
  if (auth.role !== "user") throw forbidden();
  const meeting = await getMeetingById(param(req, "id"));
  if (meeting.hostId.toString() !== auth.userId) {
    throw forbidden("Only the host can generate summaries");
  }

  const body = validate(
    z.object({ mode: z.enum(["draft", "final"]).optional() }),
    req.body ?? {},
  );
  const mode = body.mode ?? (meeting.status === "ended" ? "final" : "draft");
  if (mode === "final" && meeting.status !== "ended") {
    throw badRequest("End the meeting before generating the final summary");
  }

  if (mode === "final") {
    const started = await requestSummary(meeting._id.toString(), meeting.roomId, "final");
    res.status(202).json({ status: "processing", started: Boolean(started) });
    return;
  }

  const summary = await requestSummary(meeting._id.toString(), meeting.roomId, "draft");
  res.json({ summary });
});
