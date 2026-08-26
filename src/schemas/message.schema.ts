import { Schema, Types, type HydratedDocument } from 'mongoose';

export interface MessageImage {
  url: string;
  publicId: string;
}

export class Message {
  chatId: Types.ObjectId;
  sender: string;
  text?: string;
  image?: MessageImage;
  messageType: 'text' | 'image';
  seen: boolean;
  seenAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export type MessageDocument = HydratedDocument<Message>;

export const MessageSchema = new Schema<Message>(
  {
    chatId: {
      type: Schema.Types.ObjectId,
      ref: 'Chat',
      required: true,
    },
    sender: { type: String, required: true },
    text: { type: String, required: false },
    image: {
      url: { type: String },
      publicId: { type: String },
    },
    messageType: {
      type: String,
      enum: ['text', 'image'],
      default: 'text',
    },
    seen: { type: Boolean, default: false },
    seenAt: { type: Date, default: null },
  },
  {
    collection: 'messages',
    timestamps: true,
  },
);
