import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/auth";
import { validate } from "../middleware/error";
import { ChatMessage } from "../models/ChatMessage";
import { assertMeetingAccessOrThrow, getMeetingById } from "../services/MeetingService";
import { param } from "../utils/http";

export const chatRouter = Router();

chatRouter.get("/:id/chat", requireAuth, async (req, res) => {
  const auth = req.auth!;
  const meeting = await getMeetingById(param(req, "id"));
  await assertMeetingAccessOrThrow(meeting, auth);

  const query = validate(
    z.object({
      page: z.coerce.number().int().min(1).default(1),
      limit: z.coerce.number().int().min(1).max(200).default(100),
    }),
    req.query,
  );

  const [total, messages] = await Promise.all([
    ChatMessage.countDocuments({ meetingId: meeting._id }),
    ChatMessage.find({ meetingId: meeting._id })
      .sort({ createdAt: 1 })
      .skip((query.page - 1) * query.limit)
      .limit(query.limit)
      .lean(),
  ]);

  res.json({
    total,
    page: query.page,
    limit: query.limit,
    pages: Math.ceil(total / query.limit) || 1,
    messages: messages.map((message) => ({
      id: message._id.toString(),
      senderId: message.senderId,
      senderName: message.senderName,
      message: message.message,
      createdAt: message.createdAt,
    })),
  });
});
