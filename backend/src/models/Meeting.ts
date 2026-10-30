import { Schema, model, models, type Model, type Types } from "mongoose";

export type MeetingStatus = "active" | "ended";
export type TranscriptionStatus = "idle" | "active" | "finalizing" | "complete" | "failed";
export type SummaryStatus = "none" | "pending" | "processing" | "ready" | "failed";

export interface IMeeting {
  _id: Types.ObjectId;
  roomId: string;
  hostId: Types.ObjectId;
  title: string;
  participants: Types.ObjectId[];
  status: MeetingStatus;
  startedAt: Date | null;
  endedAt: Date | null;
  duration: number;
  recordingAvailable: boolean;
  transcriptAvailable: boolean;
  transcriptionStatus: TranscriptionStatus;
  transcriptionError: string | null;
  summaryStatus: SummaryStatus;
  summaryError: string | null;
  aiProcessed: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const meetingSchema = new Schema<IMeeting>(
  {
    roomId: { type: String, required: true, unique: true, index: true },
    hostId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    title: { type: String, required: true, trim: true, minlength: 1, maxlength: 140 },
    participants: [{ type: Schema.Types.ObjectId, ref: "Participant" }],
    status: { type: String, enum: ["active", "ended"], default: "active", index: true },
    startedAt: { type: Date, default: null },
    endedAt: { type: Date, default: null },
    duration: { type: Number, default: 0, min: 0 },
    recordingAvailable: { type: Boolean, default: false },
    transcriptAvailable: { type: Boolean, default: false },
    transcriptionStatus: {
      type: String,
      enum: ["idle", "active", "finalizing", "complete", "failed"],
      default: "idle",
    },
    transcriptionError: { type: String, default: null },
    summaryStatus: {
      type: String,
      enum: ["none", "pending", "processing", "ready", "failed"],
      default: "none",
    },
    summaryError: { type: String, default: null },
    aiProcessed: { type: Boolean, default: false },
  },
  { timestamps: true },
);

meetingSchema.index({ createdAt: -1 });
meetingSchema.index({ status: 1, createdAt: -1 });

export const Meeting =
  (models.Meeting as Model<IMeeting> | undefined) ?? model<IMeeting>("Meeting", meetingSchema);
