import { Schema, model, models } from "mongoose";

// ──────────────────────────────────────────────
// LiveAvatar conversations (optional, for logging)
// Same schema/collection as the main vistarays.de-avatars site so transcripts
// show up in its admin panel when both apps share one MongoDB.
// ──────────────────────────────────────────────
export interface IConversation {
  _id?: string;
  memberName: string;
  messages: { role: string; text: string; timestamp: Date }[];
  createdAt?: Date;
  updatedAt?: Date;
}

const ConversationSchema = new Schema<IConversation>(
  {
    memberName: { type: String, required: true },
    messages: [
      {
        role: { type: String, required: true },
        text: { type: String, required: true },
        timestamp: { type: Date, default: Date.now },
      },
    ],
  },
  { timestamps: true }
);

export const Conversation =
  models.Conversation ?? model<IConversation>("Conversation", ConversationSchema);

// ──────────────────────────────────────────────
// Generic Site Settings (used for LiveAvatar context override)
// ──────────────────────────────────────────────
export interface ISiteSetting {
  _id?: string;
  key: string;
  value: string | string[] | Record<string, string>;
  label: string;
  type: "text" | "textarea" | "url";
  section: string;
  createdAt?: Date;
  updatedAt?: Date;
}

const SiteSettingSchema = new Schema<ISiteSetting>(
  {
    key: { type: String, required: true, unique: true },
    value: { type: Schema.Types.Mixed, required: true },
    label: { type: String, required: true },
    type: { type: String, enum: ["text", "textarea", "url"], default: "text" },
    section: { type: String, required: true },
  },
  { timestamps: true }
);

export const SiteSetting =
  models.SiteSetting ?? model<ISiteSetting>("SiteSetting", SiteSettingSchema);
