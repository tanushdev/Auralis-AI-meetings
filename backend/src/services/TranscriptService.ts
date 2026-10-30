import { Types } from "mongoose";
import { Transcript, type ITranscriptSegment } from "../models/Transcript";
import { Meeting } from "../models/Meeting";
import { env } from "../config/env";
import { notFound } from "../utils/errors";
import { formatTimestamp } from "./MeetingSummaryService";

export interface NewTranscriptSegment {
  segmentId: string;
  participantId: string;
  speakerName: string;
  startSec: number;
  endSec: number;
  text: string;
  language: string | null;
  source?: "live" | "manual";
}

/** Appends a finalized segment, de-duplicating by segmentId. Returns true when inserted. */
export async function appendFinalSegment(
  meetingId: string,
  segment: NewTranscriptSegment,
): Promise<boolean> {
  const numericId = new Types.ObjectId(meetingId);
  const already = await Transcript.exists({
    meetingId: numericId,
    "segments.segmentId": segment.segmentId,
  });
  if (already) return false;

  const document: ITranscriptSegment = {
    segmentId: segment.segmentId,
    participantId: segment.participantId,
    speakerName: segment.speakerName,
    startSec: Math.max(0, segment.startSec),
    endSec: Math.max(segment.startSec, segment.endSec),
    text: segment.text.trim().slice(0, 5000),
    status: "final",
    language: segment.language,
    source: segment.source ?? "live",
    createdAt: new Date(),
    editedAt: null,
    editedBy: null,
  };

  await Transcript.updateOne(
    { meetingId: numericId },
    {
      $push: { segments: document },
      $set: { provider: env.transcriptionProvider, model: env.whisperModel },
      $setOnInsert: { language: segment.language },
    },
    { upsert: true },
  );

  await Meeting.updateOne(
    { _id: numericId },
    {
      $set: { transcriptAvailable: true },
      ...(segment.language ? {} : {}),
    },
  );
  return true;
}

export async function getTranscriptDocument(meetingId: string) {
  if (!Types.ObjectId.isValid(meetingId)) throw notFound("Meeting not found");
  return Transcript.findOne({ meetingId: new Types.ObjectId(meetingId) });
}

export async function getFinalSegments(meetingId: string): Promise<ITranscriptSegment[]> {
  const transcript = await getTranscriptDocument(meetingId);
  if (!transcript) return [];
  return transcript.segments
    .filter((segment) => segment.status === "final" || segment.status === "edited")
    .sort((a, b) => a.startSec - b.startSec);
}

export function buildTranscriptText(segments: ITranscriptSegment[]): string {
  return segments
    .map((segment) => `[${formatTimestamp(segment.startSec)}] ${segment.speakerName}: ${segment.text}`)
    .join("\n");
}

export async function editSegmentText(
  meetingId: string,
  segmentId: string,
  text: string,
  editor: string,
): Promise<ITranscriptSegment> {
  const numericId = new Types.ObjectId(meetingId);
  const transcript = await Transcript.findOne({ meetingId: numericId });
  if (!transcript) throw notFound("Transcript not found");
  const segment = transcript.segments.find((item) => item.segmentId === segmentId);
  if (!segment) throw notFound("Transcript segment not found");

  const updated = await Transcript.findOneAndUpdate(
    { meetingId: numericId, "segments.segmentId": segmentId },
    {
      $set: {
        "segments.$.text": text.trim().slice(0, 5000),
        "segments.$.status": "edited",
        "segments.$.editedAt": new Date(),
        "segments.$.editedBy": editor,
      },
    },
    { new: true },
  );
  if (!updated) throw notFound("Transcript segment not found");
  const stored = updated.segments.find((item) => item.segmentId === segmentId);
  if (!stored) throw notFound("Transcript segment not found");
  return stored;
}

export async function countFinalSegments(meetingId: string): Promise<number> {
  const transcript = await getTranscriptDocument(meetingId);
  if (!transcript) return 0;
  return transcript.segments.filter((segment) => segment.status === "final" || segment.status === "edited")
    .length;
}
