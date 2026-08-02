//   1. User A mở app -> Frontend gọi io(serverUrl, { query: { userId: A } })
//   2. Server nhận connection -> Lưu userSocketMap[A] = socketId_A
//   3. User A gõ chữ -> emit("typing", { targetUserId: B }) -> Server chuyển tiếp cho B
//   4. User A gửi tin -> API lưu DB -> Controller gọi io.to(socketId_B).emit("newMessage")
//   5. User B đang lắng nghe -> nhận "newMessage" -> setMessages thêm tin mới
import { Server, Socket } from "socket.io";
import http from "http";
import express from "express";
import jwt, {} from "jsonwebtoken";
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});
// Một tài khoản có thể mở đồng thời trên nhiều thiết bị/tab.
const userSocketMap = new Map();
// tìm socket của người nhận và gửi tin nhắn real-time
export const getReceiverSocketIds = (userId) => Array.from(userSocketMap.get(userId) ?? []);
io.use((socket, next) => {
    try {
        const token = socket.handshake.auth?.token;
        if (typeof token !== "string" || !process.env.JWT_SECRET) {
            return next(new Error("Unauthorized"));
        }
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const decodedUser = decoded.user ?? decoded;
        const userId = decodedUser?._id ?? decodedUser?.userId ?? decodedUser?.id;
        if (!userId)
            return next(new Error("Unauthorized"));
        socket.data.userId = String(userId);
        next();
    }
    catch {
        next(new Error("Unauthorized"));
    }
});
io.on("connection", (socket) => {
    console.log("User Connected", socket.id);
    const userId = socket.data.userId;
    const sockets = userSocketMap.get(userId) ?? new Set();
    sockets.add(socket.id);
    userSocketMap.set(userId, sockets);
    // Gửi danh sách user online cho tất cả client đang kết nối
    io.emit("getOnlineUsers", Array.from(userSocketMap.keys()));
    socket.on("typing", (payload = {}) => {
        const { chatId, targetUserId } = payload;
        if (typeof chatId !== "string" || typeof targetUserId !== "string")
            return;
        const receiverSocketIds = getReceiverSocketIds(targetUserId);
        const senderUserId = socket.data.userId; // Người đang gõ
        if (receiverSocketIds.length && senderUserId) {
            // Gửi event "userTyping" chỉ cho user B
            io.to(receiverSocketIds).emit("userTyping", { chatId, userId: senderUserId });
        }
    });
    socket.on("typingStop", (payload = {}) => {
        const { chatId, targetUserId } = payload;
        if (typeof chatId !== "string" || typeof targetUserId !== "string")
            return;
        const receiverSocketIds = getReceiverSocketIds(targetUserId);
        if (receiverSocketIds.length) {
            io.to(receiverSocketIds).emit("userTypingStop", { chatId });
        }
    });
    socket.on("disconnect", () => {
        const disconnectedUserId = socket.data.userId;
        if (disconnectedUserId) {
            const sockets = userSocketMap.get(disconnectedUserId);
            sockets?.delete(socket.id);
            if (!sockets?.size)
                userSocketMap.delete(disconnectedUserId);
            io.emit("getOnlineUsers", Array.from(userSocketMap.keys()));
        }
        console.log("User disconnected", socket.id);
    });
});
export { app, server, io };
//# sourceMappingURL=socket.js.map