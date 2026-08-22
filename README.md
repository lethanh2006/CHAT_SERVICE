# Chat Service

NestJS 11 service for one-to-one conversations, image messages and Socket.IO
presence/events. MongoDB continues to use database `nrapp` and collections
`chats` and `messages`, so no data migration is required.

## HTTP contract

- `GET /health`, `GET /health/ready`, `GET /health/live`
- `POST /api/chat/chat/new`
- `GET /api/chat/chat/all`
- `POST /api/chat/message` (`multipart/form-data`, optional `image`, maximum 5MB)
- `GET /api/chat/message/:chatId`

Chat routes accept the Gateway's base64 `x-user-payload` header. Direct calls
remain compatible with `Authorization: Bearer <jwt>`.

## Socket.IO contract

Connect on the default `/socket.io` path with `auth.token`. The service accepts
`typing` and `typingStop`, and emits `getOnlineUsers`, `userTyping`,
`userTypingStop`, `newMessage` and `messagesSeen`. Multiple tabs/devices are
tracked for each user.

## Commands

```bash
npm install
npm run dev
npm run lint
npm test
npm run test:e2e
npm run build
npm run start:prod
```

Copy `.env.example` to `.env` and use the same `JWT_SECRET` as Auth and Gateway.
Image uploads retain the `chat-images` Cloudinary folder, JPG/JPEG/PNG/GIF
allow-list and 800x800 `limit` transformation.
