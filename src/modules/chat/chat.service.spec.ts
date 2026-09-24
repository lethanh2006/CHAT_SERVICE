import type { Model } from 'mongoose';
import { Types } from 'mongoose';
import { Chat } from '../../schemas/chat.schema';
import { Message } from '../../schemas/message.schema';
import { ChatGateway } from './chat.gateway';
import { ChatService } from './chat.service';
import { ChatImageService } from './chat-image.service';
import { UserClientService } from './user-client.service';

describe('ChatService.getAllChats', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('loads peer profiles in one batch and unseen counts in one aggregation', async () => {
    const viewerId = '64a000000000000000000001';
    const peerOneId = '64a000000000000000000002';
    const peerTwoId = '64a000000000000000000003';
    const chatOneId = new Types.ObjectId('64b000000000000000000001');
    const chatTwoId = new Types.ObjectId('64b000000000000000000002');
    const chats = [
      {
        _id: chatOneId,
        users: [viewerId, peerOneId],
        latestMessage: { text: 'hello' },
      },
      {
        _id: chatTwoId,
        users: [viewerId, peerTwoId],
        latestMessage: null,
      },
    ];
    const findQuery = {
      sort: jest.fn().mockReturnThis(),
      lean: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue(chats),
    };
    const chatModel = {
      find: jest.fn().mockReturnValue(findQuery),
    } as unknown as Model<Chat>;
    const aggregateQuery = {
      exec: jest.fn().mockResolvedValue([{ _id: chatOneId, count: 3 }]),
    };
    const aggregate = jest.fn().mockReturnValue(aggregateQuery);
    const messageModel = { aggregate } as unknown as Model<Message>;
    const getUsers = jest.fn().mockResolvedValue([
      { _id: peerOneId, username: 'one' },
      { _id: peerTwoId, username: 'two' },
    ]);
    const userClient = { getUsers } as unknown as UserClientService;
    const logger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };
    const service = new ChatService(
      chatModel,
      messageModel,
      userClient,
      {} as ChatImageService,
      {} as ChatGateway,
      logger as never,
    );

    const result = await service.getAllChats({ _id: viewerId }, 'request-1');

    expect(getUsers).toHaveBeenCalledTimes(1);
    expect(getUsers).toHaveBeenCalledWith([peerOneId, peerTwoId], 'request-1');
    expect(findQuery.lean).toHaveBeenCalledTimes(1);
    expect(aggregate).toHaveBeenCalledTimes(1);
    expect(aggregate).toHaveBeenCalledWith([
      {
        $match: {
          chatId: { $in: [chatOneId, chatTwoId] },
          sender: { $ne: viewerId },
          seen: false,
        },
      },
      { $group: { _id: '$chatId', count: { $sum: 1 } } },
    ]);
    expect(result.chats).toEqual([
      {
        user: { user: { _id: peerOneId, username: 'one' } },
        chat: {
          _id: chatOneId,
          users: [viewerId, peerOneId],
          latestMessage: { text: 'hello' },
          unseenCount: 3,
        },
      },
      {
        user: { user: { _id: peerTwoId, username: 'two' } },
        chat: {
          _id: chatTwoId,
          users: [viewerId, peerTwoId],
          latestMessage: null,
          unseenCount: 0,
        },
      },
    ]);

    await service.getAllChats({ _id: viewerId }, 'request-cache-hit');
    expect(findQuery.exec).toHaveBeenCalledTimes(1);
    expect(aggregate).toHaveBeenCalledTimes(1);
    expect(getUsers).toHaveBeenCalledTimes(1);
  });

  it('coalesces in-flight reads, caches for 500 ms, then reloads', async () => {
    const viewerId = '64a000000000000000000001';
    const peerId = '64a000000000000000000002';
    const chatId = new Types.ObjectId('64b000000000000000000001');
    const chats = [
      {
        _id: chatId,
        users: [viewerId, peerId],
        latestMessage: { text: 'hello' },
      },
    ];
    let resolveChats!: (value: typeof chats) => void;
    const pendingChats = new Promise<typeof chats>((resolve) => {
      resolveChats = resolve;
    });
    const findQuery = {
      sort: jest.fn().mockReturnThis(),
      lean: jest.fn().mockReturnThis(),
      exec: jest.fn().mockReturnValue(pendingChats),
    };
    const find = jest.fn().mockReturnValue(findQuery);
    const chatModel = { find } as unknown as Model<Chat>;
    const aggregateQuery = {
      exec: jest.fn().mockResolvedValue([]),
    };
    const aggregate = jest.fn().mockReturnValue(aggregateQuery);
    const messageModel = { aggregate } as unknown as Model<Message>;
    const getUsers = jest
      .fn()
      .mockResolvedValue([{ _id: peerId, username: 'peer' }]);
    const userClient = { getUsers } as unknown as UserClientService;
    const logger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };
    const service = new ChatService(
      chatModel,
      messageModel,
      userClient,
      {} as ChatImageService,
      {} as ChatGateway,
      logger as never,
    );
    const user = { _id: viewerId, role: 'user' };
    const now = jest.spyOn(Date, 'now').mockReturnValue(1_000);

    const first = service.getAllChats(user, 'request-first');
    const concurrent = service.getAllChats(user, 'request-concurrent');
    expect(find).toHaveBeenCalledTimes(1);
    resolveChats(chats);
    const [firstResult, concurrentResult] = await Promise.all([
      first,
      concurrent,
    ]);

    expect(firstResult).toEqual(concurrentResult);
    expect(aggregate).toHaveBeenCalledTimes(1);
    expect(getUsers).toHaveBeenCalledTimes(1);

    await service.getAllChats(user, 'request-after-completion');
    expect(find).toHaveBeenCalledTimes(1);
    now.mockReturnValue(6_000);
    await service.getAllChats(user, 'request-after-expiration');
    expect(find).toHaveBeenCalledTimes(2);
    expect(aggregate).toHaveBeenCalledTimes(2);
    expect(getUsers).toHaveBeenCalledTimes(2);
  });

  it('invalidates the completed list when a new chat is created', async () => {
    const viewerId = '64a000000000000000000001';
    const peerId = '64a000000000000000000002';
    const chatId = new Types.ObjectId('64b000000000000000000001');
    const chats = [
      {
        _id: chatId,
        users: [viewerId, peerId],
        latestMessage: null,
      },
    ];
    const findQuery = {
      sort: jest.fn().mockReturnThis(),
      lean: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue(chats),
    };
    const findOneQuery = { exec: jest.fn().mockResolvedValue(null) };
    const chatModel = {
      find: jest.fn().mockReturnValue(findQuery),
      findOne: jest.fn().mockReturnValue(findOneQuery),
      create: jest.fn().mockResolvedValue({ _id: chatId }),
    } as unknown as Model<Chat>;
    const aggregate = jest.fn().mockReturnValue({
      exec: jest.fn().mockResolvedValue([]),
    });
    const messageModel = { aggregate } as unknown as Model<Message>;
    const userClient = {
      getUser: jest.fn().mockResolvedValue({ user: { _id: peerId } }),
      getUsers: jest
        .fn()
        .mockResolvedValue([{ _id: peerId, username: 'peer' }]),
    } as unknown as UserClientService;
    const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    const service = new ChatService(
      chatModel,
      messageModel,
      userClient,
      {} as ChatImageService,
      {} as ChatGateway,
      logger as never,
    );
    const user = { _id: viewerId, role: 'user' };

    await service.getAllChats(user);
    await service.createChat({ otherUserId: peerId }, user);
    await service.getAllChats(user);

    expect(findQuery.exec).toHaveBeenCalledTimes(2);
    expect(aggregate).toHaveBeenCalledTimes(2);
  });
});
