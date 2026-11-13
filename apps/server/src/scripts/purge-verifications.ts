import { ListObjectsV2Command } from '@aws-sdk/client-s3';
import { env } from '../config.js';
import { deleteObjects, s3 } from '../lib/storage.js';

/**
 * One-off: deletes every selfie left over from the removed identity verification
 * (all objects under verifications/). Safe to run more than once.
 */
let token: string | undefined;
let removed = 0;
do {
  const page = await s3.send(new ListObjectsV2Command({ Bucket: env.S3_BUCKET, Prefix: 'verifications/', ContinuationToken: token }));
  const keys = (page.Contents ?? []).map((o) => o.Key).filter((k): k is string => !!k);
  await deleteObjects(keys);
  removed += keys.length;
  token = page.IsTruncated ? page.NextContinuationToken : undefined;
} while (token);
console.log(removed ? `removed ${removed} selfie file(s)` : 'no selfie files left');
