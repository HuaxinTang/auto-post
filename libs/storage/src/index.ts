import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { createReadStream, createWriteStream, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export interface StorageAdapter {
  putFile(key: string, sourcePath: string, contentType: string): Promise<void>;
  presignedPutUrl(key: string, contentType: string, expiresInSec?: number): Promise<string>;
  presignedGetUrl(key: string, expiresInSec?: number): Promise<string>;
  downloadToFile(key: string, destPath: string): Promise<void>;
}

class S3Adapter implements StorageAdapter {
  private client: S3Client;

  constructor() {
    const endpoint = process.env.S3_ENDPOINT;
    const region = process.env.S3_REGION ?? 'us-east-1';
    this.client = new S3Client({
      region,
      endpoint,
      forcePathStyle: true,
      credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY ?? 'minioadmin',
        secretAccessKey: process.env.S3_SECRET_KEY ?? 'minioadmin',
      },
    });
  }

  private get bucket(): string {
    return process.env.S3_BUCKET ?? 'auto-post';
  }

  async putFile(key: string, sourcePath: string, contentType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: createReadStream(sourcePath),
        ContentType: contentType,
      })
    );
  }

  async presignedPutUrl(key: string, contentType: string, expiresInSec = 600): Promise<string> {
    return getSignedUrl(
      this.client,
      new PutObjectCommand({ Bucket: this.bucket, Key: key, ContentType: contentType }),
      { expiresIn: expiresInSec }
    );
  }

  async presignedGetUrl(key: string, expiresInSec = 600): Promise<string> {
    return getSignedUrl(this.client, new GetObjectCommand({ Bucket: this.bucket, Key: key }), {
      expiresIn: expiresInSec,
    });
  }

  async downloadToFile(key: string, destPath: string): Promise<void> {
    const resp = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    if (!resp.Body) throw new Error(`empty body for ${key}`);
    const dir = join(destPath, '..');
    mkdirSync(dir, { recursive: true });
    const stream = resp.Body as NodeJS.ReadableStream;
    await new Promise<void>((resolve, reject) => {
      const out = createWriteStream(destPath);
      stream.pipe(out).on('finish', resolve).on('error', reject);
    });
  }
}

class DiskAdapter implements StorageAdapter {
  private root = process.env.DISK_STORAGE_ROOT ?? './.storage';

  private resolve(key: string): string {
    return join(this.root, key);
  }

  async putFile(key: string, sourcePath: string, _contentType: string): Promise<void> {
    const dest = this.resolve(key);
    mkdirSync(join(dest, '..'), { recursive: true });
    const { copyFileSync } = await import('node:fs');
    copyFileSync(sourcePath, dest);
  }

  async presignedPutUrl(key: string, _contentType: string): Promise<string> {
    return `disk://${key}`;
  }

  async presignedGetUrl(key: string): Promise<string> {
    return `/api/storage/disk/${encodeURIComponent(key)}`;
  }

  async downloadToFile(key: string, destPath: string): Promise<void> {
    const src = this.resolve(key);
    if (!existsSync(src)) throw new Error(`disk file not found: ${key}`);
    const { copyFileSync } = await import('node:fs');
    mkdirSync(join(destPath, '..'), { recursive: true });
    copyFileSync(src, destPath);
  }
}

export function createStorage(): StorageAdapter {
  if (process.env.STORAGE_BACKEND === 'disk' || !process.env.S3_ENDPOINT) {
    return new DiskAdapter();
  }
  return new S3Adapter();
}
