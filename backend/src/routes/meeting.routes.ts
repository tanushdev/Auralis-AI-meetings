import { Router } from "express";
import { z } from "zod";
import { requireAuth, requireUser } from "../middleware/auth";
import { rateLimit } from "../middleware/rateLimit";
import { validate } from "../middleware/error";
import { badRequest } from "../utils/errors";
import { isValidRoomId } from "../utils/ids";
import { param } from "../utils/http";
import {
  createMeeting,
  endMeetingAsHost,
  getMeetingDetail,
  getMeetingStats,
  getPublicRoom,
  listMeetingsForUser,
} from "../services/MeetingService";

export const meetingRouter = Router();

const createSchema = z.object({
  title: z.string().trim().min(1, "Give the meeting a title").max(140),
});

const listQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(12),
  search: z.string().trim().max(120).optional(),
});

meetingRouter.post(
  "/",
  requireUser,
  rateLimit({ max: 20, windowMs: 60_000, key: "create-meeting" }),
  async (req, res) => {
    const auth = req.auth!;
    if (auth.role !== "user") throw badRequest("Sign in to create a meeting");
    const body = validate(createSchema, req.body);
    const meeting = await createMeeting(auth.userId, body.title);
    res.status(201).json({
      meeting: {
        id: meeting._id.toString(),
        roomId: meeting.roomId,
        title: meeting.title,
        status: meeting.status,
        createdAt: meeting.createdAt,
        joinUrl: `/meeting/${meeting.roomId}`,
      },
    });
  },
);

meetingRouter.get("/", requireUser, async (req, res) => {
  const auth = req.auth!;
  if (auth.role !== "user") throw badRequest("Sign in to view meetings");
  const query = validate(listQuery, req.query);
  const result = await listMeetingsForUser(auth.userId, query);
  res.json(result);
});

meetingRouter.get("/stats", requireUser, async (req, res) => {
  const auth = req.auth!;
  if (auth.role !== "user") throw badRequest("Sign in to view stats");
  res.json(await getMeetingStats(auth.userId));
});

meetingRouter.get("/room/:roomId", async (req, res) => {
  const { roomId } = req.params;
  if (!isValidRoomId(roomId)) throw badRequest("Invalid meeting link");
  res.json({ room: await getPublicRoom(roomId) });
});

meetingRouter.get("/:id", requireAuth, async (req, res) => {
  const auth = req.auth!;
  const detail = await getMeetingDetail(param(req, "id"), auth);
  res.json({ meeting: detail });
});

meetingRouter.post("/:id/end", requireUser, async (req, res) => {
  const auth = req.auth!;
  if (auth.role !== "user") throw badRequest("Sign in to end a meeting");
  const meeting = await endMeetingAsHost(param(req, "id"), auth.userId);
  res.json({
    meeting: {
      id: meeting._id.toString(),
      status: meeting.status,
      endedAt: meeting.endedAt,
      duration: meeting.duration,
    },
    message: "Meeting ended. The final summary will be generated once transcription flushes.",
  });
});
