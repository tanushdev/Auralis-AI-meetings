import { Schema, model, models, type Model, type Types } from "mongoose";

export interface IRecordingMeta {
  _id: Types.ObjectId;
  meetingId: Types.ObjectId;
  participantId: string | null;
  userId: Types.ObjectId | null;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  durationSec: number;
  createdAt: Date;
  updatedAt: Date;
}

const recordingSchema = new Schema<IRecordingMeta>(
  {
    meetingId: { type: Schema.Types.ObjectId, ref: "Meeting", required: true, index: true },
    participantId: { type: String, default: null },
    userId: { type: Schema.Types.ObjectId, ref: "User", default: null },
    fileName: { type: String, required: true, maxlength: 255 },
    mimeType: { type: String, required: true, maxlength: 120 },
    sizeBytes: { type: Number, required: true, min: 0 },
    durationSec: { type: Number, required: true, min: 0 },
  },
  { timestamps: true },
);

recordingSchema.index({ meetingId: 1, createdAt: -1 });

export const RecordingMeta =
  (models.RecordingMeta as Model<IRecordingMeta> | undefined) ??
  model<IRecordingMeta>("RecordingMeta", recordingSchema);
