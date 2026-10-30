import { Types, type HydratedDocument } from "mongoose";
import { Meeting, type IMeeting } from "../models/Meeting";
import { Participant } from "../models/Participant";
import { User } from "../models/User";
import { bus } from "../events";
import { badRequest, forbidden, notFound } from "../utils/errors";
import { generateRoomId } from "../utils/ids";
import { logger } from "../utils/logger";
import type { AuthContext } from "../types/auth";

export async function createMeeting(hostId: string, title: string): Promise<IMeeting> {
  let roomId = generateRoomId();
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const exists = await Meeting.exists({ roomId });
    if (!exists) break;
    roomId = generateRoomId();
  }
  const meeting = await Meeting.create({
    roomId,
    hostId: new Types.ObjectId(hostId),
    title,
    participants: [],
    status: "active",
  });
  return meeting;
}

export async function getMeetingByRoomId(roomId: string): Promise<IMeeting | null> {
  return Meeting.findOne({ roomId });
}

export async function getMeetingById(meetingId: string): Promise<HydratedDocument<IMeeting>> {
  if (!Types.ObjectId.isValid(meetingId)) throw badRequest("Invalid meeting id");
  const meeting = await Meeting.findById(meetingId);
  if (!meeting) throw notFound("Meeting not found");
  return meeting;
}

/** Guests may only ever access the room their token was issued for. */
export function assertMeetingAccess(meeting: IMeeting, auth: AuthContext): void {
  if (auth.role === "guest") {
    if (auth.roomId !== meeting.roomId) {
      throw forbidden("Your guest pass is for a different meeting");
    }
    return;
  }
  if (meeting.hostId.toString() === auth.userId) return;
  throw forbidden("You do not have access to this meeting");
}

export async function hasMeetingAccess(meeting: IMeeting, auth: AuthContext): Promise<boolean> {
  if (auth.role === "guest") return auth.roomId === meeting.roomId;
  if (meeting.hostId.toString() === auth.userId) return true;
  const participant = await Participant.exists({
    meetingId: meeting._id,
    userId: new Types.ObjectId(auth.userId),
  });
  return Boolean(participant);
}

export async function assertMeetingAccessOrThrow(meeting: IMeeting, auth: AuthContext): Promise<void> {
  const allowed = await hasMeetingAccess(meeting, auth);
  if (!allowed) throw forbidden("You do not have access to this meeting");
}

export interface MeetingListOptions {
  page?: number;
  limit?: number;
  search?: string;
}

export async function listMeetingsForUser(userId: string, options: MeetingListOptions) {
  const page = Math.max(1, options.page ?? 1);
  const limit = Math.min(50, Math.max(1, options.limit ?? 12));
  const userObjectId = new Types.ObjectId(userId);

  const participantMeetingIds = await Participant.distinct("meetingId", { userId: userObjectId });
  const filter: Record<string, unknown> = {
    $or: [{ hostId: userObjectId }, { _id: { $in: participantMeetingIds } }],
  };
  if (options.search?.trim()) {
    const escaped = options.search.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    filter.title = { $regex: escaped, $options: "i" };
  }

  const [total, meetings] = await Promise.all([
    Meeting.countDocuments(filter),
    Meeting.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate("hostId", "name email")
      .lean(),
  ]);

  const participantCounts = await Participant.aggregate<{ _id: Types.ObjectId; count: number }>([
    { $match: { meetingId: { $in: meetings.map((meeting) => meeting._id) } } },
    { $group: { _id: "$meetingId", count: { $sum: 1 } } },
  ]);
  const countMap = new Map(participantCounts.map((row) => [row._id.toString(), row.count]));

  return {
    page,
    limit,
    total,
    pages: Math.ceil(total / limit) || 1,
    meetings: meetings.map((meeting) => ({
      ...meeting,
      host: meeting.hostId,
      hostId: undefined,
      participantCount: countMap.get(meeting._id.toString()) ?? 0,
    })),
  };
}

export async function getMeetingDetail(meetingId: string, auth: AuthContext) {
  const meeting = await getMeetingById(meetingId);
  await assertMeetingAccessOrThrow(meeting, auth);
  const [host, participants] = await Promise.all([
    User.findById(meeting.hostId).select("name email avatar").lean(),
    Participant.find({ meetingId: meeting._id }).sort({ joinedAt: 1 }).lean(),
  ]);
  return {
    ...meeting.toObject(),
    host,
    participants,
    participantCount: participants.length,
  };
}

export async function getPublicRoom(roomId: string) {
  const meeting = await Meeting.findOne({ roomId }).populate("hostId", "name").lean();
  if (!meeting) throw notFound("Meeting not found");
  return {
    roomId: meeting.roomId,
    title: meeting.title,
    status: meeting.status,
    hostName: (meeting.hostId as unknown as { name?: string })?.name ?? "Host",
    participantCount: meeting.participants.length,
    startedAt: meeting.startedAt,
  };
}

export async function startMeetingIfNeeded(meeting: IMeeting): Promise<void> {
  if (meeting.startedAt) return;
  await Meeting.updateOne(
    { _id: meeting._id, startedAt: null },
    { $set: { startedAt: new Date(), status: "active" } },
  );
}

export async function markMeetingEnded(
  meeting: IMeeting,
  reason: "host-ended" | "empty-room" | "system",
): Promise<IMeeting> {
  if (meeting.status === "ended") return meeting;
  const endedAt = new Date();
  const startedAt = meeting.startedAt ?? endedAt;
  const duration = Math.max(0, Math.round((endedAt.getTime() - startedAt.getTime()) / 1000));
  const updated = await Meeting.findByIdAndUpdate(
    meeting._id,
    {
      $set: {
        status: "ended",
        endedAt,
        duration,
        transcriptionStatus: "finalizing",
      },
    },
    { new: true },
  );
  if (!updated) throw notFound("Meeting not found");
  logger.info(`Meeting ${updated.roomId} ended (${reason})`);
  bus.emit("meeting:ended", {
    meetingId: updated._id.toString(),
    roomId: updated.roomId,
    reason,
  });
  return updated;
}

export async function endMeetingAsHost(meetingId: string, userId: string): Promise<IMeeting> {
  const meeting = await getMeetingById(meetingId);
  if (meeting.hostId.toString() !== userId) {
    throw forbidden("Only the host can end this meeting");
  }
  return markMeetingEnded(meeting, "host-ended");
}

export async function getMeetingStats(userId: string) {
  const userObjectId = new Types.ObjectId(userId);
  const participantMeetingIds = await Participant.distinct("meetingId", { userId: userObjectId });
  const filter = {
    $or: [{ hostId: userObjectId }, { _id: { $in: participantMeetingIds } }],
  };
  const [total, withTranscript, withSummary, durationAgg] = await Promise.all([
    Meeting.countDocuments(filter),
    Meeting.countDocuments({ ...filter, transcriptAvailable: true }),
    Meeting.countDocuments({ ...filter, summaryStatus: "ready" }),
    Meeting.aggregate<{ _id: null; total: number }>([
      { $match: filter },
      { $group: { _id: null, total: { $sum: "$duration" } } },
    ]),
  ]);
  return {
    totalMeetings: total,
    transcribedMeetings: withTranscript,
    summarizedMeetings: withSummary,
    totalDurationSec: durationAgg[0]?.total ?? 0,
  };
}
