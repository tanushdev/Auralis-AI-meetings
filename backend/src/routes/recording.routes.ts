import { Router } from "express";
import { z } from "zod";
import { Types } from "mongoose";
import { requireAuth, requireUser } from "../middleware/auth";
import { validate } from "../middleware/error";
import { badRequest } from "../utils/errors";
import { RecordingMeta } from "../models/RecordingMeta";
import { Meeting } from "../models/Meeting";
import { assertMeetingAccessOrThrow, getMeetingById } from "../services/MeetingService";
import { param } from "../utils/http";

export const recordingRouter = Router();

const metadataSchema = z.object({
  fileName: z.string().trim().min(1).max(255),
  mimeType: z.string().trim().min(1).max(120),
  sizeBytes: z.number().int().min(0).max(20 * 1024 * 1024 * 1024),
  durationSec: z.number().min(0).max(24 * 3600),
});

recordingRouter.post("/:id/recordings", requireAuth, async (req, res) => {
  const auth = req.auth!;
  const meeting = await getMeetingById(param(req, "id"));
  await assertMeetingAccessOrThrow(meeting, auth);
  const body = validate(metadataSchema, req.body);

  const recording = await RecordingMeta.create({
    meetingId: meeting._id,
    participantId: null,
    userId: auth.role === "user" ? new Types.ObjectId(auth.userId) : null,
    ...body,
  });
  await Meeting.updateOne({ _id: meeting._id }, { $set: { recordingAvailable: true } });

  res.status(201).json({
    recording: {
      id: recording._id.toString(),
      ...body,
      createdAt: recording.createdAt,
    },
  });
});

recordingRouter.get("/:id/recordings", requireAuth, async (req, res) => {
  const auth = req.auth!;
  const meeting = await getMeetingById(param(req, "id"));
  await assertMeetingAccessOrThrow(meeting, auth);
  const recordings = await RecordingMeta.find({ meetingId: meeting._id }).sort({ createdAt: -1 }).lean();
  res.json({
    recordings: recordings.map((recording) => ({
      id: recording._id.toString(),
      fileName: recording.fileName,
      mimeType: recording.mimeType,
      sizeBytes: recording.sizeBytes,
      durationSec: recording.durationSec,
      createdAt: recording.createdAt,
      // The blob lives in the browser's IndexedDB, never on the server.
      storedLocally: true,
    })),
  });
});

export const recordingListRouter = Router();

recordingListRouter.get("/", requireUser, async (req, res) => {
  const auth = req.auth!;
  if (auth.role !== "user") throw badRequest("Sign in to view recordings");
  const recordings = await RecordingMeta.find({ userId: new Types.ObjectId(auth.userId) })
    .sort({ createdAt: -1 })
    .limit(100)
    .populate("meetingId", "title roomId duration startedAt")
    .lean();
  res.json({
    recordings: recordings.map((recording) => ({
      id: recording._id.toString(),
      fileName: recording.fileName,
      mimeType: recording.mimeType,
      sizeBytes: recording.sizeBytes,
      durationSec: recording.durationSec,
      createdAt: recording.createdAt,
      meeting: recording.meetingId,
    })),
  });
});
