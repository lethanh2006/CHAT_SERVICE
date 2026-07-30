import TryCatch from "../config/TryCatch.js";
import type { AuthenticatedRequest } from "../middleware/isAuth.js";
import { Chat } from "../models/Chat.js";
import { Messages } from "../models/Messages.js";
import axios from "axios";
import { io, getReceiverSocketIds } from "../config/socket.js";


const getUserFromUserService = async (userId: string) => {
    const baseUrl = process.env.USER_SERVICE;
    if (!baseUrl) throw new Error("USER_SERVICE is not configured");
    const { data } = await axios.get(`${baseUrl}/api/user/user/${userId}`);
    return data;
};


export const createNewChat = TryCatch(
    async (req: AuthenticatedRequest, res) => {
        const userId = req.user?._id;
        const { otherUserId } = req.body;

        if (!otherUserId) {
            res.status(400).json({ message: "Cần cung cấp otherUserId " });
            return;
        }

        if (otherUserId.toString() === userId?.toString()) {
            res.status(400).json({ message: "Không thể tạo cuộc trò chuyện với chính mình" });
            return;
        }

        const existingChat = await Chat.findOne({
            users: { $all: [userId, otherUserId], $size: 2 },
        });

        // tồn tại thì trả về cũ
        if (existingChat) {
            res.json({
                message: "Cuộc trò chuyện đã tồn tại",
                chatId: existingChat._id,
            });
            return;
        }

        // tạo chat mới
        res.status(201).json({
            message: "Tạo cuộc trò chuyện mới thành công",
            chatId: (await Chat.create({ users: [userId, otherUserId] }))._id,
        });

    }
);


export const getAllChats = TryCatch(async (req: AuthenticatedRequest, res) => {
    const userId = req.user?._id;
    if (!userId) {
        res.status(400).json({ message: "Cần cung cấp ID người dùng" });
        return;
    }
    const chats = await Chat.find({ users: userId }).sort({ updatedAt: -1 });

    const chatWithUserData = await Promise.all(
        chats.map(async (chat) => {
            const otherUserId = chat.users.find((id) => id.toString() !== userId.toString());
            const unseenCount = await Messages.countDocuments({
                chatId: chat._id,
                sender: { $ne: userId },
                seen: false,
            });
            try {
                const otherUser = await getUserFromUserService(String(otherUserId));
                return {
                    user: otherUser,
                    chat: {
                        ...chat.toObject(),
                        latestMessage: chat.latestMessage || null,
                        unseenCount,
                    }
                };
            } catch (error) {
                return {
                    user: { _id: otherUserId, name: "Unknown User" },
                    chat: {
                        ...chat.toObject(),
                        latestMessage: chat.latestMessage || null,
                        unseenCount,
                    }
                };
            }
        })
    );

    res.status(200).json({
        chats: chatWithUserData,
    });
});


export const sendMessage = TryCatch(async (req: AuthenticatedRequest, res) => {
    const senderId = req.user?._id;
    const { chatId, text } = req.body;
    const imageFile = req.file;


    if (!senderId) {
        res.status(401).json({ message: "Không có quyền truy cập" });
        return;
    }

    if (!chatId) {
        res.status(400).json({ message: "Cần cung cấp chatId (ID cuộc trò chuyện)" });
        return;
    }

    if (!text && !imageFile) {
        res.status(400).json({ message: "Cần có văn bản hoặc hình ảnh để gửi tin nhắn" });
        return;
    }

    const chat = await Chat.findById(chatId);

    if (!chat) {
        res.status(404).json({ message: "Không tìm thấy cuộc trò chuyện" });
        return;
    }

    const isUserInChat = chat.users.some(
        (userId) => userId.toString() === senderId?.toString()
    );

    if (!isUserInChat) {
        res.status(403).json({ message: "Bạn không tham gia vào cuộc trò chuyện này" });
        return;
    }

    const otherUserId = chat.users.find(
        (userId) => userId.toString() !== senderId?.toString()
    );

    if (!otherUserId) {
        res.status(401).json({ message: "Không tìm thấy người dùng khác" });
        return;
    }

    // socket setup 

    let messageData: any = {
        chatId: chatId,
        sender: senderId,
        seen: false,
        seenAt: undefined
    };

    if (imageFile) {
        messageData.image = {
            url: imageFile.path,
            publicId: imageFile.filename
        };
        messageData.messageType = "image";
        messageData.text = text || "";
    } else {
        messageData.text = text;
        messageData.messageType = "text";
    }

    const message = new Messages(messageData);
    const savedMessage = await message.save();

    const latestMessageText = imageFile ? "Sent an image" : text;

    await Chat.findByIdAndUpdate(chatId, {
        latestMessage: {
            text: latestMessageText,
            sender: senderId,
        },
        updatedAt: new Date(),
    },
        { new: true }
    );


    // Nếu người nhận đang online (có socket), emit "newMessage" để họ thấy tin ngay lập tức
    // mà không cần refresh hay polling
    const receiverSocketIds = getReceiverSocketIds(otherUserId.toString());
    if (receiverSocketIds.length) {
        io.to(receiverSocketIds).emit("newMessage", {
            message: savedMessage.toObject ? savedMessage.toObject() : savedMessage,
        });
    }

    res.status(201).json({
        message: savedMessage,
        sender: senderId,
    });
});

export const getMessagesByChat = TryCatch(
    async (req: AuthenticatedRequest, res) => {
        const userId = req.user?._id;
        const { chatId } = req.params;
        if (!userId) {
            res.status(401).json({ message: "Không có quyền truy cập" });
            return;
        }
        if (!chatId) {
            res.status(400).json({ message: "Cần cung cấp chatId (ID cuộc trò chuyện)" });
            return;
        }

        const chat = await Chat.findById(chatId);

        if (!chat) {
            res.status(404).json({ message: "Không tìm thấy cuộc trò chuyện" });
            return;
        }

        const isUserInChat = chat.users.some(
            (memberId) => memberId.toString() === userId?.toString()
        );

        if (!isUserInChat) {
            res.status(403).json({ message: "Bạn không tham gia vào cuộc trò chuyện này" });
            return;
        }

        const messagesToMarkSeen = await Messages.find({
            chatId: chatId,
            sender: { $ne: userId },
            seen: false,
        });

        // tính năng đã xem 
        await Messages.updateMany({
            chatId: chatId,
            sender: { $ne: userId },
            seen: false,
        }, {
            seen: true,
            seenAt: new Date(),
        });

        const messages = await Messages.find({ chatId }).sort({
            createdAt: 1
        });

        const senderIds = new Set(messagesToMarkSeen.map((message) => message.sender));
        senderIds.forEach((senderId) => {
            const socketIds = getReceiverSocketIds(senderId);
            if (socketIds.length) {
                io.to(socketIds).emit("messagesSeen", { chatId, seenBy: userId });
            }
        });

        const otherUserId = chat.users.find((id) => id.toString() !== userId.toString());

        try {
            const otherUser = await getUserFromUserService(String(otherUserId));

            if (!otherUserId) {
                res.status(400).json({ message: "Không tìm thấy người dùng khác" });
                return;
            }

            // socket work 

            res.json({
                messages,
                user: otherUser,
            });

        } catch (error) {
            console.log(error);
            res.json({
                messages,
                user: { _id: otherUserId, name: "unknown User" },
            })
        }
    }
);
