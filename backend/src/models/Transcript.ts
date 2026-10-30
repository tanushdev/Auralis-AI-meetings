import { Schema, model, models, type Model, type Types } from "mongoose";

export type SegmentStatus = "final" | "edited";

export interface ITranscriptSegment {
  segmentId: string;
  participantId: string;
  speakerName: string;
  startSec: number;
  endSec: number;
  text: string;
  status: SegmentStatus;
  language: string | null;
  source: "live" | "manual";
  createdAt: Date;
  editedAt: Date | null;
  editedBy: string | null;
}

export interface ITranscript {
  _id: Types.ObjectId;
  meetingId: Types.ObjectId;
  segments: ITranscriptSegment[];
  language: string | null;
  provider: string;
  model: string;
  createdAt: Date;
  updatedAt: Date;
}

const segmentSchema = new Schema<ITranscriptSegment>(
  {
    segmentId: { type: String, required: true },
    participantId: { type: String, required: true },
    speakerName: { type: String, required: true, maxlength: 80 },
    startSec: { type: Number, required: true, min: 0 },
    endSec: { type: Number, required: true, min: 0 },
    text: { type: String, required: true, trim: true, maxlength: 5000 },
    status: { type: String, enum: ["final", "edited"], default: "final" },
    language: { type: String, default: null },
    source: { type: String, enum: ["live", "manual"], default: "live" },
    createdAt: { type: Date, default: () => new Date() },
    editedAt: { type: Date, default: null },
    editedBy: { type: String, default: null },
  },
  { _id: false },
);

const transcriptSchema = new Schema<ITranscript>(
  {
    meetingId: { type: Schema.Types.ObjectId, ref: "Meeting", required: true, unique: true },
    segments: { type: [segmentSchema], default: [] },
    language: { type: String, default: null },
    provider: { type: String, default: "faster-whisper" },
    model: { type: String, default: "" },
  },
  { timestamps: true },
);

transcriptSchema.index({ meetingId: 1, "segments.speakerName": 1 });

export const Transcript =
  (models.Transcript as Model<ITranscript> | undefined) ??
  model<ITranscript>("Transcript", transcriptSchema);
