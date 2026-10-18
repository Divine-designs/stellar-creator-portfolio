import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';

/**
 * POST /api/admin/cron/kyc-cleanup
 *
 * GDPR compliance job for Issue #782: permanently deletes KYC submissions
 * (including encrypted PII) 90 days after upload, regardless of review
 * status. Should be triggered daily by an external cron service (e.g.
 * Vercel Crons, EasyCron).
 *
 * Retention policy: KYC documents are retained for 90 days after upload
 * (tracked via `expiresAt`). Once expired, the stored S3 object is deleted
 * first, then the DB row. The job is idempotent: if it fails midway, the
 * next run re-selects the same expired rows and tolerates objects that were
 * already removed from storage.
 *
 * Authorization: Requires valid cron secret in X-Cron-Secret header.
 */

/**
 * Delete a single S3 object by key. Returns true when the object is gone
 * (deleted now or already absent), false on an unexpected failure.
 *
 * Uses the S3 REST API directly so no extra SDK dependency is required.
 * Objects are stored with SSE-KMS at rest; deletion is access-logged by
 * S3 server access logging / CloudTrail data events.
 */
async function deleteS3Object(key: string): Promise<boolean> {
  const bucket = process.env.KYC_S3_BUCKET;
  const region = process.env.KYC_S3_REGION || process.env.AWS_REGION;

  // No bucket configured: nothing to delete in storage (DB-only deployments).
  if (!bucket || !region) return true;

  const accessKeyId = process.env.KYC_S3_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey =
    process.env.KYC_S3_SECRET_ACCESS_KEY || process.env.AWS_SECRET_ACCESS_KEY;

  if (!accessKeyId || !secretAccessKey) {
    logger.error('KYC cleanup: S3 credentials missing, cannot delete object', { key });
    return false;
  }

  const host = `${bucket}.s3.${region}.amazonaws.com`;
  const canonicalUri = '/' + key.split('/').map(encodeURIComponent).join('/');
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);
  const service = 's3';
  const payloadHash = crypto.createHash('sha256').update('').digest('hex');

  const canonicalHeaders =
    `host:${host}\n` +
    `x-amz-content-sha256:${payloadHash}\n` +
    `x-amz-date:${amzDate}\n`;
  const signedHeaders = 'host;x-amz-content-sha256;x-amz-date';
  const canonicalRequest = [
    'DELETE',
    canonicalUri,
    '',
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');

  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    crypto.createHash('sha256').update(canonicalRequest).digest('hex'),
  ].join('\n');

  const hmac = (k: Buffer | string, d: string) =>
    crypto.createHmac('sha256', k).update(d).digest();
  const signingKey = hmac(
    hmac(hmac(hmac(`AWS4${secretAccessKey}`, dateStamp), region), service),
    'aws4_request',
  );
  const signature = crypto.createHmac('sha256', signingKey).update(stringToSign).digest('hex');

  const authorization =
    `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  try {
    const res = await fetch(`https://${host}${canonicalUri}`, {
      method: 'DELETE',
      headers: {
        Authorization: authorization,
        'x-amz-content-sha256': payloadHash,
        'x-amz-date': amzDate,
      },
    });

    // 204 = deleted, 404 = already gone (idempotent re-run).
    if (res.status === 204 || res.status === 404) return true;

    logger.error('KYC cleanup: S3 delete failed', { key, status: res.status });
    return false;
  } catch (error) {
    logger.error('KYC cleanup: S3 delete threw', { key, err: String(error) });
    return false;
  }
}

export async function POST(req: NextRequest) {
  // Constant-time comparison (mirrors the fix in the corridor-aggregation
  // cron route): a plain !== comparison leaks timing information about how
  // many leading characters of a guess match, letting the secret be
  // recovered incrementally by a network-positioned attacker.
  const cronSecret = req.headers.get('x-cron-secret');
  const validSecret = process.env.CRON_SECRET;

  const authorized = (() => {
    if (!validSecret || !cronSecret) return false;
    try {
      const a = Buffer.from(cronSecret);
      const b = Buffer.from(validSecret);
      if (a.length !== b.length) return false;
      return crypto.timingSafeEqual(a, b);
    } catch {
      return false;
    }
  })();

  if (!authorized) {
    return NextResponse.json(
      { error: 'Unauthorized: Invalid or missing cron secret' },
      { status: 401 },
    );
  }

  try {
    // Select expired records first so we can delete their storage objects
    // before removing the DB rows. If the job dies midway, the rows remain
    // and the next run re-processes them (S3 deletes tolerate 404).
    const expired = await prisma.kYCSubmission.findMany({
      where: { expiresAt: { lte: new Date() } },
      select: { id: true, documentKey: true },
    });

    let objectsDeleted = 0;
    let objectsFailed = 0;
    const deletableIds: string[] = [];

    for (const record of expired) {
      const key = record.documentKey;
      if (!key) {
        // No storage object associated; safe to delete the row.
        deletableIds.push(record.id);
        continue;
      }

      const ok = await deleteS3Object(key);
      if (ok) {
        objectsDeleted += 1;
        deletableIds.push(record.id);
      } else {
        // Keep the row so a later run retries the storage deletion.
        objectsFailed += 1;
      }
    }

    let rowsDeleted = 0;
    if (deletableIds.length > 0) {
      const { count } = await prisma.kYCSubmission.deleteMany({
        where: { id: { in: deletableIds } },
      });
      rowsDeleted = count;
    }

    logger.info('KYC cleanup complete', {
      expired: expired.length,
      objectsDeleted,
      objectsFailed,
      rowsDeleted,
    });

    return NextResponse.json(
      {
        success: objectsFailed === 0,
        expired: expired.length,
        objectsDeleted,
        objectsFailed,
        rowsDeleted,
      },
      { status: 200 },
    );
  } catch (error) {
    logger.error('KYC cleanup cron job failed', { err: String(error) });
    return NextResponse.json(
      { error: 'Failed to clean up expired KYC submissions', details: String(error) },
      { status: 500 },
    );
  }
}
