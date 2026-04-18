import mongoose, { Document, Schema } from "mongoose";
const ChatSchema = new Schema({
    users: [
        { type: String, required: true }
    ],
    latestMessage: {
        text: { type: String, required: false },
        sender: { type: String, required: false }
    }
}, { timestamps: true });
export const Chat = mongoose.model("Chat", ChatSchema);
//# sourceMappingURL=Chat.js.map