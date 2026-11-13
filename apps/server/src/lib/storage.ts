import { DeleteObjectsCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { env } from '../config.js';

/**
 * Where photos live. Two drivers, chosen with STORAGE_DRIVER:
 *
 *  - local: files on this server's disk under MEDIA_DIR (a Docker volume shared by the API, the
 *    worker and nginx, which serves the public prefixes photos/ and chat/ on the media domain).
 *    The simplest start: one server, nothing else to run.
 *  - s3: any S3-compatible storage (Cloudflare R2, …). Needed once there is more than one app server.
 *
 * Keys look like photos/<user>/<id>/md.webp; everything outside photos/ and chat/ (bot pictures)
 * is never served publicly and is only read back by the server itself.
 */
const local = env.STORAGE_DRIVER === 'local';
const root = resolve(env.MEDIA_DIR);

let client: S3Client | null = null;
function s3(): S3Client {
  client ??= new S3Client({
    endpoint: env.S3_ENDPOINT,
    region: env.S3_REGION,
    forcePathStyle: env.S3_FORCE_PATH_STYLE,
    credentials: { accessKeyId: env.S3_ACCESS_KEY, secretAccessKey: env.S3_SECRET_KEY },
  });
  return client;
}

/** A key as a path inside MEDIA_DIR (never outside it, whatever the key says). */
function pathOf(key: string): string {
  const p = resolve(join(root, key));
  if (p !== root && !p.startsWith(root + sep)) throw new Error(`bad storage key: ${key}`);
  return p;
}

export async function putObject(key: string, body: Buffer, contentType: string, cacheControl = 'public, max-age=31536000, immutable') {
  if (local) {
    const p = pathOf(key);
    await mkdir(dirname(p), { recursive: true });
    // written next to it and renamed, so a reader never sees half a file
    const tmp = `${p}.${process.pid}.tmp`;
    await writeFile(tmp, body);
    await rename(tmp, p);
    return;
  }
  await s3().send(new PutObjectCommand({ Bucket: env.S3_BUCKET, Key: key, Body: body, ContentType: contentType, CacheControl: cacheControl }));
}

export async function deleteObjects(keys: string[]) {
  if (local) {
    await Promise.all(keys.map((k) => rm(pathOf(k), { force: true, recursive: true })));
    return;
  }
  for (let i = 0; i < keys.length; i += 1000) {
    const batch = keys.slice(i, i + 1000);
    if (!batch.length) continue;
    await s3().send(new DeleteObjectsCommand({ Bucket: env.S3_BUCKET, Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true } }));
  }
}

export async function getObject(key: string): Promise<Buffer> {
  if (local) return readFile(pathOf(key));
  const res = await s3().send(new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: key }));
  return Buffer.from(await res.Body!.transformToByteArray());
}

export function publicUrl(key: string): string {
  return `${env.MEDIA_PUBLIC_URL}/${key}`;
}

/** A temporary link to a private file (S3 only; with local files there are no private links). */
export async function signedUrl(key: string, seconds = 600): Promise<string> {
  if (local) return publicUrl(key);
  return getSignedUrl(s3(), new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: key }), { expiresIn: seconds });
}
