import express from 'express';
import { isAuth } from '../middleware/isAuth.js';
import { createNewChat, getAllChats, getMessagesByChat, sendMessage } from '../controllers/chat.js';
import { upload } from '../middleware/multer.js';

const router = express.Router();

/**
 * @swagger
 * /chat/new:
 *   post:
 *     summary: Tạo cuộc trò chuyện mới
 *     tags: [CHAT]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               otherUserId:
 *                 type: string
 *     responses:
 *       200:
 *         description: Hoàn thành
 */
router.post("/chat/new",isAuth, createNewChat);

/**
 * @swagger
 * /chat/all:
 *   get:
 *     summary: Lấy danh sách tất cả trò chuyện
 *     tags: [CHAT]
 *     responses:
 *       200:
 *         description: Hoàn thành
 */
router.get("/chat/all",isAuth, getAllChats );
/**
 * @swagger
 * /message:
 *   post:
 *     summary: Gửi tin nhắn mới (chứa text hoặc file ảnh)
 *     tags: [CHAT]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               chatId:
 *                 type: string
 *               text:
 *                 type: string
 *               image:
 *                 type: string
 *                 format: binary
 *     responses:
 *       200:
 *         description: Gửi thành công
 */
router.post("/message", isAuth, upload.single('image'), sendMessage);

/**
 * @swagger
 * /message/{chatId}:
 *   get:
 *     summary: Lấy danh sách tin nhắn theo ID cuộc trò chuyện
 *     tags: [CHAT]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: chatId
 *         required: true
 *         schema:
 *           type: string
 *         description: ID của cuộc trò chuyện
 *     responses:
 *       200:
 *         description: Success
 */
router.get("/message/:chatId", isAuth , getMessagesByChat);

export default router;