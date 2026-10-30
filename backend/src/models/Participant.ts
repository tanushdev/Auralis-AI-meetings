import { Schema, model, models, type Model, type Types } from "mongoose";

export interface MediaState {
  audio: boolean;
  video: boolean;
  screen: boolean;
}

export interface IParticipant {
  _id: Types.ObjectId;
  meetingId: Types.ObjectId;
  userId: Types.ObjectId | null;
  guestId: string | null;
  name: string;
  isGuest: boolean;
  socketId: string | null;
  joinedAt: Date;
  leftAt: Date | null;
  mediaState: MediaState;
  createdAt: Date;
  updatedAt: Date;
}

const participantSchema = new Schema<IParticipant>(
  {
    meetingId: { type: Schema.Types.ObjectId, ref: "Meeting", required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", default: null },
    guestId: { type: String, default: null, maxlength: 80 },
    name: { type: String, required: true, trim: true, maxlength: 80 },
    isGuest: { type: Boolean, default: false },
    socketId: { type: String, default: null },
    joinedAt: { type: Date, default: () => new Date() },
    leftAt: { type: Date, default: null },
    mediaState: {
      audio: { type: Boolean, default: false },
      video: { type: Boolean, default: false },
      screen: { type: Boolean, default: false },
    },
  },
  { timestamps: true },
);

participantSchema.index({ meetingId: 1, userId: 1 });
participantSchema.index({ meetingId: 1, leftAt: 1 });

export const Participant =
  (models.Participant as Model<IParticipant> | undefined) ??
  model<IParticipant>("Participant", participantSchema);
