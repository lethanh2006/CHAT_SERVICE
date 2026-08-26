import { Schema, type HydratedDocument } from 'mongoose';

export interface LatestMessage {
  text?: string;
  sender?: string;
}

export class Chat {
  users: string[];
  latestMessage?: LatestMessage;
  createdAt: Date;
  updatedAt: Date;
}

export type ChatDocument = HydratedDocument<Chat>;

export const ChatSchema = new Schema<Chat>(
  {
    users: [{ type: String, required: true }],
    latestMessage: {
      text: { type: String, required: false },
      sender: { type: String, required: false },
    },
  },
  {
    collection: 'chats',
    timestamps: true,
  },
);
