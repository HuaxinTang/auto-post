import { Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { prisma } from '@auto-post/db';
import { createStorage } from '@auto-post/storage';
import { getDefaultOrgId } from '../../bootstrap';

const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_SIZE_BYTES = 50 * 1024 * 1024;

@Injectable()
export class MediaService {
  async upload(file: Express.Multer.File, postId?: string) {
    if (!ALLOWED_MIME.includes(file.mimetype)) {
      throw new Error(`不支持的图片格式: ${file.mimetype}（仅支持 JPG/PNG/WebP）`);
    }
    const size = statSync(file.path).size;
    if (size > MAX_SIZE_BYTES) {
      throw new Error('图片超过 50MB 限制');
    }

    const buf = readFileSync(file.path);
    const sha256 = createHash('sha256').update(buf).digest('hex');
    const ext = file.mimetype.split('/')[1] === 'jpeg' ? 'jpg' : file.mimetype.split('/')[1];
    const key = `media/${randomBytes(8).toString('hex')}.${ext}`;

    const storage = createStorage();
    await storage.putFile(key, file.path, file.mimetype);

    const orgId = await getDefaultOrgId();
    return prisma.mediaAsset.create({
      data: {
        organizationId: orgId,
        postId: postId ?? null,
        role: 'IMAGE',
        storageKey: key,
        mimeType: file.mimetype,
        sizeBytes: size,
        sha256,
        status: 'READY',
      },
    });
  }
}
