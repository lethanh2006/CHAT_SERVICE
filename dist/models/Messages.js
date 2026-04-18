import mongoose, { Document, Schema, Types } from "mongoose";
const schema = new Schema({
    chatId: { type: Schema.Types.ObjectId, ref: "Chat", required: true },
    sender: { type: String, required: true },
    text: { type: String, required: false },
    image: {
        url: { type: String, publicId: String },
    },
    messageType: { type: String, enum: ["text", "image"], default: "text" },
    seen: { type: Boolean, default: false },
    seenAt: { type: Date, default: null },
}, { timestamps: true });
export const Messages = mongoose.model("Messages", schema);
//# sourceMappingURL=Messages.js.map