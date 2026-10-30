import { Router } from "express";
import { z } from "zod";
import { Types } from "mongoose";
import { requireAuth, requireUser } from "../middleware/auth";
import { validate } from "../middleware/error";
import { badRequest, forbidden, notFound } from "../utils/errors";
import {
  assertMeetingAccessOrThrow,
  getMeetingById,
  hasMeetingAccess,
  listMeetingsForUser,
} from "../services/MeetingService";
import {
  appendFinalSegment,
  editSegmentText,
  getTranscriptDocument,
} from "../services/TranscriptService";
import { Participant } from "../models/Participant";
import type { AuthContext } from "../types/auth";
import { param } from "../utils/http";

export const transcriptRouter = Router();

function numericId(id: string): Types.ObjectId {
  if (!Types.ObjectId.isValid(id)) throw badRequest("Invalid meeting id");
  return new Types.ObjectId(id);
}

transcriptRouter.get("/:id/transcript", requireAuth, async (req, res) => {
  const auth = req.auth!;
  const meeting = await getMeetingById(param(req, "id"));
  await assertMeetingAccessOrThrow(meeting, auth);
  const transcript = await getTranscriptDocument(param(req, "id"));
  res.json({
    transcript: transcript
      ? {
          meetingId: transcript.meetingId.toString(),
          segments: transcript.segments,
          language: transcript.language,
          provider: transcript.provider,
          model: transcript.model,
          updatedAt: transcript.updatedAt,
        }
      : null,
    meeting: {
      id: meeting._id.toString(),
      transcriptAvailable: meeting.transcriptAvailable,
      transcriptionStatus: meeting.transcriptionStatus,
      transcriptionError: meeting.transcriptionError,
      summaryStatus: meeting.summaryStatus,
      summaryError: meeting.summaryError,
      status: meeting.status,
    },
  });
});

/** Host-only manual segment entry, clearly marked as manual in the transcript. */
transcriptRouter.post("/:id/transcript", requireUser, async (req, res) => {
  const auth = req.auth!;
  if (auth.role !== "user") throw forbidden();
  const meeting = await getMeetingById(param(req, "id"));
  if (meeting.hostId.toString() !== auth.userId) {
    throw forbidden("Only the host can add transcript segments");
  }

  const schema = z.object({
    segments: z
      .array(
        z.object({
          speakerName: z.string().trim().min(1).max(80),
          startSec: z.number().min(0),
          endSec: z.number().min(0),
          text: z.string().trim().min(1).max(5000),
        }),
      )
      .min(1)
      .max(50),
  });
  const body = validate(schema, req.body);

  let inserted = 0;
  for (const segment of body.segments) {
    if (segment.endSec < segment.startSec) throw badRequest("Segment end must be after start");
    const created = await appendFinalSegment(meeting._id.toString(), {
      segmentId: `manual-${new Types.ObjectId().toString()}`,
      participantId: "manual",
      speakerName: segment.speakerName,
      startSec: segment.startSec,
      endSec: segment.endSec,
      text: segment.text,
      language: null,
      source: "manual",
    });
    if (created) inserted += 1;
  }
  res.status(201).json({ inserted });
});

transcriptRouter.patch("/:id/transcript/segments/:segmentId", requireAuth, async (req, res) => {
  const auth = req.auth!;
  const meeting = await getMeetingById(param(req, "id"));
  await assertMeetingAccessOrThrow(meeting, auth);

  const schema = z.object({ text: z.string().trim().min(1).max(5000) });
  const body = validate(schema, req.body);

  const transcript = await getTranscriptDocument(meeting._id.toString());
  if (!transcript) throw notFound("Transcript not found");
  const segmentId = param(req, "segmentId");
  const segment = transcript.segments.find((item) => item.segmentId === segmentId);
  if (!segment) throw notFound("Transcript segment not found");

  // Hosts can correct anything; participants may correct their own speech only.
  let canEdit = auth.role === "user" && meeting.hostId.toString() === auth.userId;
  if (!canEdit) {
    const participant = await Participant.findOne(
      auth.role === "user"
        ? { meetingId: meeting._id, userId: new Types.ObjectId(auth.userId) }
        : { meetingId: meeting._id, guestId: auth.guestId },
    );
    canEdit = Boolean(participant && participant._id.toString() === segment.participantId);
  }
  if (!canEdit) throw forbidden("You can only edit your own transcript segments");

  const updated = await editSegmentText(
    meeting._id.toString(),
    segmentId,
    body.text,
    auth.role === "user" ? auth.userId : auth.guestId,
  );
  res.json({ segment: updated });
});

export const transcriptListRouter = Router();

transcriptListRouter.get("/", requireUser, async (req, res) => {
  const auth = req.auth!;
  if (auth.role !== "user") throw badRequest("Sign in to view transcripts");
  const query = z
    .object({
      page: z.coerce.number().int().min(1).default(1),
      limit: z.coerce.number().int().min(1).max(50).default(20),
    })
    .parse(req.query);
  const result = await listMeetingsForUser(auth.userId, {
    page: query.page,
    limit: query.limit,
  });
  res.json({
    ...result,
    meetings: result.meetings.filter((meeting) => meeting.transcriptAvailable),
  });
});

export async function canAccessMeeting(auth: AuthContext, meetingId: string): Promise<boolean> {
  const meeting = await getMeetingById(meetingId);
  return hasMeetingAccess(meeting, auth);
}
