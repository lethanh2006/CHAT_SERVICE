import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  v2 as cloudinary,
  type UploadApiErrorResponse,
  type UploadApiResponse,
} from "cloudinary";

export interface UploadedImage {
  url: string;
  publicId: string;
}

@Injectable()
export class ChatImageService {
  constructor(private readonly configService: ConfigService) {
    cloudinary.config({
      cloud_name: this.configService.get<string>("CLOUDINARY_CLOUD_NAME"),
      api_key: this.configService.get<string>("CLOUDINARY_API_KEY"),
      api_secret: this.configService.get<string>("CLOUDINARY_API_SECRET"),
    });
  }

  upload(buffer: Buffer): Promise<UploadedImage> {
    return new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        {
          folder: "chat-images",
          allowed_formats: ["jpg", "jpeg", "png", "gif"],
          resource_type: "image",
          transformation: [{ width: 800, height: 800, crop: "limit" }],
        },
        (
          error: UploadApiErrorResponse | undefined,
          result: UploadApiResponse | undefined,
        ) => {
          if (error) {
            reject(new Error(error.message, { cause: error }));
            return;
          }
          if (!result) {
            reject(new Error("Cloudinary không trả về kết quả upload"));
            return;
          }
          resolve({
            url: result.secure_url || result.url,
            publicId: result.public_id,
          });
        },
      );
      stream.end(buffer);
    });
  }

  async remove(publicId: string): Promise<void> {
    await cloudinary.uploader.destroy(publicId, {
      resource_type: "image",
      invalidate: true,
    });
  }
}
