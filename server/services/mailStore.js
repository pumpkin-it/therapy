// Where email files live: the original .eml, the cleaned-up HTML body and attachments.
// MAIL_STORE=s3 (production and UAT) keeps them in S3 under MAIL_S3_BUCKET / MAIL_S3_PREFIX; anything
// else keeps them on this server's disk under uploads/mail (local development and testing).
// Keys are content hashes, so writing the same file twice is harmless.
const fs = require('fs');
const path = require('path');

const LOCAL_ROOT = path.resolve(process.env.MAIL_LOCAL_DIR || path.join(__dirname, '../../uploads/mail'));

let s3;
function s3Client() {
  if (!s3) {
    const { S3Client } = require('@aws-sdk/client-s3');
    s3 = new S3Client({ region: process.env.MAIL_S3_REGION || process.env.AWS_REGION || 'ap-southeast-2' });
  }
  return s3;
}

const useS3 = () => process.env.MAIL_STORE === 's3';

function s3Location(key) {
  const bucket = process.env.MAIL_S3_BUCKET;
  if (!bucket) throw new Error('MAIL_S3_BUCKET not configured');
  const prefix = (process.env.MAIL_S3_PREFIX || 'therapy-mail').replace(/\/+$/, '');
  return { Bucket: bucket, Key: `${prefix}/${key}` };
}

function localPath(key) {
  const p = path.resolve(LOCAL_ROOT, key);
  if (!p.startsWith(LOCAL_ROOT + path.sep)) throw new Error('Invalid mail storage key');
  return p;
}

async function put(key, buffer, contentType = 'application/octet-stream') {
  if (useS3()) {
    const { PutObjectCommand } = require('@aws-sdk/client-s3');
    await s3Client().send(new PutObjectCommand({ ...s3Location(key), Body: buffer, ContentType: contentType }));
    return;
  }
  const p = localPath(key);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  // Write then rename so a crash never leaves a half-written file under the final name.
  const tmp = `${p}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, buffer);
  fs.renameSync(tmp, p);
}

async function get(key) {
  if (useS3()) {
    const { GetObjectCommand } = require('@aws-sdk/client-s3');
    const res = await s3Client().send(new GetObjectCommand(s3Location(key)));
    return Buffer.from(await res.Body.transformToByteArray());
  }
  return fs.readFileSync(localPath(key));
}

// Size in bytes, or null if it isn't there. Used to confirm a copy exists before the mailbox
// copy is ever removed.
async function size(key) {
  if (useS3()) {
    const { HeadObjectCommand } = require('@aws-sdk/client-s3');
    try {
      return (await s3Client().send(new HeadObjectCommand(s3Location(key)))).ContentLength;
    } catch (e) {
      if (e.name === 'NotFound' || e.$metadata?.httpStatusCode === 404) return null;
      throw e;
    }
  }
  try { return fs.statSync(localPath(key)).size; } catch { return null; }
}

module.exports = { put, get, size };
