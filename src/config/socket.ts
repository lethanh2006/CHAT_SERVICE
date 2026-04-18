

//   1. User A mở app -> Frontend gọi io(serverUrl, { query: { userId: A } })
//   2. Server nhận connection -> Lưu userSocketMap[A] = socketId_A
//   3. User A gõ chữ -> emit("typing", { targetUserId: B }) -> Server chuyển tiếp cho B
//   4. User A gửi tin -> API lưu DB -> Controller gọi io.to(socketId_B).emit("newMessage")
//   5. User B đang lắng nghe -> nhận "newMessage" -> setMessages thêm tin mới


import { Server, Socket } from "socket.io";
import http from "http";
import express from "express";

const app = express();

const server = http.createServer(app);

const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// Map lưu: userId -> socketId
const userSocketMap: Record<string, string> = {};

// tìm socket của người nhận và gửi tin nhắn real-time
export const getReceiverSocketId = (userId: string) => userSocketMap[userId];


io.on("connection", (socket: Socket) => {
    console.log("User Connected", socket.id);

    const userId = socket.handshake.query.userId as string | undefined;

    if (userId && userId !== "undefined") {
        // Lưu vào map: userId -> socketId để gửi tin cho đúng user
        userSocketMap[userId] = socket.id;
        socket.data.userId = userId;  // Lưu userId vào socket để dùng khi disconnect
        console.log(`User ${userId} mapped to socket ${socket.id}`);
    }

    // Gửi danh sách user online cho tất cả client đang kết nối
    io.emit("getOnlineUsers", Object.keys(userSocketMap));


    socket.on("typing", ({ chatId, targetUserId }: { chatId: string; targetUserId: string }) => {
        const receiverSocketId = userSocketMap[targetUserId];  // Tìm socket của người nhận
        const senderUserId = socket.data.userId as string;      // Người đang gõ
        if (receiverSocketId && senderUserId) {
            // Gửi event "userTyping" chỉ cho user B
            io.to(receiverSocketId).emit("userTyping", { chatId, userId: senderUserId });
        }
    });


    socket.on("typingStop", ({ chatId, targetUserId }: { chatId: string; targetUserId: string }) => {
        const receiverSocketId = userSocketMap[targetUserId];
        if (receiverSocketId) {
            io.to(receiverSocketId).emit("userTypingStop", { chatId });
        }
    });


    socket.on("disconnect", () => {
        const disconnectedUserId = socket.data.userId as string | undefined;
        if (disconnectedUserId) {
            delete userSocketMap[disconnectedUserId];  // Xóa khỏi map
            io.emit("getOnlineUsers", Object.keys(userSocketMap));  // Cập nhật danh sách online
        }
        console.log("User disconnected", socket.id);
    });
});

export { app, server, io };