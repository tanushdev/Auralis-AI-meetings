import { Schema, model, models, type Model, type Types } from "mongoose";

export interface IChatMessage {
  _id: Types.ObjectId;
  meetingId: Types.ObjectId;
  senderId: string;
  userId: Types.ObjectId | null;
  senderName: string;
  message: string;
  createdAt: Date;
  updatedAt: Date;
}

const chatMessageSchema = new Schema<IChatMessage>(
  {
    meetingId: { type: Schema.Types.ObjectId, ref: "Meeting", required: true, index: true },
    senderId: { type: String, required: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", default: null },
    senderName: { type: String, required: true, maxlength: 80 },
    message: { type: String, required: true, trim: true, minlength: 1, maxlength: 2000 },
  },
  { timestamps: true },
);

chatMessageSchema.index({ meetingId: 1, createdAt: 1 });

export const ChatMessage =
  (models.ChatMessage as Model<IChatMessage> | undefined) ??
  model<IChatMessage>("ChatMessage", chatMessageSchema);
