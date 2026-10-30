import { Schema, model, models, type Model, type Types } from "mongoose";

export type StoredSummaryStatus = "draft" | "final" | "failed";

export interface IActionItem {
  task: string;
  assignee: string | null;
  deadline: string | null;
}

export interface IImportantMoment {
  time: number;
  description: string;
}

export interface IMeetingSummary {
  _id: Types.ObjectId;
  meetingId: Types.ObjectId;
  status: StoredSummaryStatus;
  executiveSummary: string;
  keyPoints: string[];
  decisions: string[];
  actionItems: IActionItem[];
  importantMoments: IImportantMoment[];
  openQuestions: string[];
  model: string;
  generatedAt: Date | null;
  basedOnSegmentCount: number;
  incompleteTranscript: boolean;
  error: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const actionItemSchema = new Schema<IActionItem>(
  {
    task: { type: String, required: true, maxlength: 500 },
    assignee: { type: String, default: null, maxlength: 120 },
    deadline: { type: String, default: null, maxlength: 120 },
  },
  { _id: false },
);

const momentSchema = new Schema<IImportantMoment>(
  {
    time: { type: Number, required: true, min: 0 },
    description: { type: String, required: true, maxlength: 500 },
  },
  { _id: false },
);

const summarySchema = new Schema<IMeetingSummary>(
  {
    meetingId: { type: Schema.Types.ObjectId, ref: "Meeting", required: true, unique: true },
    status: { type: String, enum: ["draft", "final", "failed"], default: "draft" },
    executiveSummary: { type: String, default: "", maxlength: 4000 },
    keyPoints: { type: [String], default: [] },
    decisions: { type: [String], default: [] },
    actionItems: { type: [actionItemSchema], default: [] },
    importantMoments: { type: [momentSchema], default: [] },
    openQuestions: { type: [String], default: [] },
    model: { type: String, default: "" },
    generatedAt: { type: Date, default: null },
    basedOnSegmentCount: { type: Number, default: 0 },
    incompleteTranscript: { type: Boolean, default: false },
    error: { type: String, default: null },
  },
  { timestamps: true },
);

export const MeetingSummary =
  (models.MeetingSummary as Model<IMeetingSummary> | undefined) ??
  model<IMeetingSummary>("MeetingSummary", summarySchema);
