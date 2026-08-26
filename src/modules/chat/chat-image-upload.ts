import { BadRequestException } from '@nestjs/common';

export const CHAT_IMAGE_MIME_ERROR =
  'Định dạng ảnh chưa được hỗ trợ. Chỉ chấp nhận ảnh JPG, PNG hoặc GIF.';

const SUPPORTED_CHAT_IMAGE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
]);

interface ChatImageFile {
  mimetype?: string;
}

type ChatImageFileFilterCallback = (
  error: Error | null,
  acceptFile: boolean,
) => void;

export function isSupportedChatImageMimeType(
  mimeType: string | null | undefined,
): boolean {
  const normalizedMimeType = mimeType?.split(';', 1)[0].trim().toLowerCase();
  return normalizedMimeType
    ? SUPPORTED_CHAT_IMAGE_MIME_TYPES.has(normalizedMimeType)
    : false;
}

export function filterSupportedChatImage(
  file: ChatImageFile,
  callback: ChatImageFileFilterCallback,
): void {
  if (isSupportedChatImageMimeType(file.mimetype)) {
    callback(null, true);
    return;
  }

  callback(new BadRequestException(CHAT_IMAGE_MIME_ERROR), false);
}
