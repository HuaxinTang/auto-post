import {
  Controller,
  Get,
  Param,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { createStorage } from '@auto-post/storage';
import { randomBytes } from 'node:crypto';
import { createReadStream, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Response } from 'express';
import { diskStorage } from 'multer';

const tmpDir = join(process.cwd(), '.tmp-uploads');
mkdirSync(tmpDir, { recursive: true });

function isDiskMode(): boolean {
  return process.env.STORAGE_BACKEND === 'disk' || !process.env.S3_ENDPOINT;
}

@Controller('storage')
export class StorageController {
  @Post('upload')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: tmpDir,
        filename: (_req, _file, cb) => cb(null, randomBytes(16).toString('hex')),
      }),
    })
  )
  async upload(@UploadedFile() file: Express.Multer.File, @Query('key') key?: string) {
    const storage = createStorage();
    const finalKey = key ?? `uploads/${randomBytes(8).toString('hex')}`;
    await storage.putFile(finalKey, file.path, file.mimetype);
    return { key: finalKey };
  }

  @Get('file/:key')
  async getFile(@Param('key') key: string, @Res() res: Response) {
    if (isDiskMode()) {
      const filePath = join(process.env.DISK_STORAGE_ROOT ?? './.storage', key);
      res.setHeader('Content-Type', 'application/octet-stream');
      createReadStream(filePath).pipe(res);
      return;
    }
    const storage = createStorage();
    const url = await storage.presignedGetUrl(key, 300);
    res.redirect(url);
  }
}
