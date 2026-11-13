import { DeleteObjectsCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { env } from '../config.js';

/**
 * S3-compatible object storage (MinIO in docker-compose; Cloudflare R2 or any S3 in production).
 * Public prefixes (photos/, chat/) are readable through MEDIA_PUBLIC_URL / a CDN;
 * everything else is private and served with short-lived signed URLs.
 */
export const s3 = new S3Client({
  endpoint: env.S3_ENDPOINT,
  region: env.S3_REGION,
  forcePathStyle: env.S3_FORCE_PATH_STYLE,
  credentials: { accessKeyId: env.S3_ACCESS_KEY, secretAccessKey: env.S3_SECRET_KEY },
});

export async function putObject(key: string, body: Buffer, contentType: string, cacheControl = 'public, max-age=31536000, immutable') {
  await s3.send(
    new PutObjectCommand({ Bucket: env.S3_BUCKET, Key: key, Body: body, ContentType: contentType, CacheControl: cacheControl }),
  );
}

export async function deleteObjects(keys: string[]) {
  for (let i = 0; i < keys.length; i += 1000) {
    const batch = keys.slice(i, i + 1000);
    if (!batch.length) continue;
    await s3.send(
      new DeleteObjectsCommand({ Bucket: env.S3_BUCKET, Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true } }),
    );
  }
}

export async function getObject(key: string): Promise<Buffer> {
  const res = await s3.send(new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: key }));
  return Buffer.from(await res.Body!.transformToByteArray());
}

export function publicUrl(key: string): string {
  return `${env.MEDIA_PUBLIC_URL}/${key}`;
}

export async function signedUrl(key: string, seconds = 600): Promise<string> {
  return getSignedUrl(s3, new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: key }), { expiresIn: seconds });
}
