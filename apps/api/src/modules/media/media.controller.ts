import { Controller, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { MediaService } from './media.service';

const tmpDir = join(process.cwd(), '.tmp-uploads');
mkdirSync(tmpDir, { recursive: true });

@Controller('media')
export class MediaController {
  constructor(private readonly media: MediaService) {}

  @Post('upload')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: tmpDir,
        filename: (_req, _file, cb) => cb(null, randomBytes(16).toString('hex')),
      }),
    })
  )
  upload(@UploadedFile() file: Express.Multer.File) {
    return this.media.upload(file);
  }
}
