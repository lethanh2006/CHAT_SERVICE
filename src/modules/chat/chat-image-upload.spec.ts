import { BadRequestException } from '@nestjs/common';
import {
  CHAT_IMAGE_MIME_ERROR,
  filterSupportedChatImage,
  isSupportedChatImageMimeType,
} from './chat-image-upload';

describe('Chat image MIME validation', () => {
  it.each(['image/jpeg', 'image/png', 'image/gif'])(
    'chấp nhận %s',
    (mimeType) => {
      expect(isSupportedChatImageMimeType(mimeType)).toBe(true);
    },
  );

  it('chuẩn hóa chữ hoa và bỏ tham số MIME', () => {
    expect(isSupportedChatImageMimeType(' IMAGE/JPEG; charset=binary ')).toBe(
      true,
    );
  });

  it('chuyển file hợp lệ qua Multer', () => {
    const callback = jest.fn();

    filterSupportedChatImage({ mimetype: 'image/png' }, callback);

    expect(callback).toHaveBeenCalledWith(null, true);
  });

  it.each([
    'image/webp',
    'image/heic',
    'image/svg+xml',
    'application/pdf',
    '',
    undefined,
  ])('từ chối %s trước khi upload Cloudinary', (mimeType) => {
    const callback = jest.fn();

    filterSupportedChatImage({ mimetype: mimeType }, callback);

    expect(callback).toHaveBeenCalledTimes(1);
    const [error, accepted] = callback.mock.calls[0] as [
      BadRequestException,
      boolean,
    ];
    expect(accepted).toBe(false);
    expect(error).toBeInstanceOf(BadRequestException);
    expect(error.message).toBe(CHAT_IMAGE_MIME_ERROR);
  });
});
