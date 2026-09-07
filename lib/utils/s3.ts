// Minimal S3-compatible upload helper (Render Key Value / Backblaze B2 /
// Cloudflare R2 all speak this API — see .env.example). The only current
// caller is lib/video/render-export.ts: fal.ai/ElevenLabs results are
// already hosted at a provider URL, so nothing else in the app needs to
// upload its own files — but a stitched full-video export is an artifact
// *we* produce, so it needs somewhere of our own to live.
//
// Deliberately just the one function this needs (PutObjectCommand), not a
// general-purpose client wrapper — same "no more than the call site
// requires" spirit as lib/ai/providers/fal-client.ts.

import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";

let client: S3Client | null = null;

/** True once every S3_* env var this needs is present. */
export function isS3Configured(): boolean {
  return Boolean(
    process.env.S3_ENDPOINT &&
      process.env.S3_BUCKET &&
      process.env.S3_ACCESS_KEY_ID &&
      process.env.S3_SECRET_ACCESS_KEY
  );
}

function getClient(): S3Client {
  if (client) return client;
  if (!isS3Configured()) {
    throw new Error(
      "S3 storage isn't configured — set S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID and " +
        "S3_SECRET_ACCESS_KEY (see .env.example) so exported videos have somewhere to be stored."
    );
  }
  client = new S3Client({
    endpoint: process.env.S3_ENDPOINT,
    region: process.env.S3_REGION || "auto",
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY_ID!,
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!,
    },
    // Path-style (endpoint/bucket/key) rather than virtual-hosted-style
    // (bucket.endpoint/key) — the only style that works uniformly across
    // Render Key Value, Backblaze B2 and most self-hosted S3-compatible
    // endpoints without extra DNS/cert setup.
    forcePathStyle: true,
  });
  return client;
}

/**
 * Streams a local file up to the configured bucket and returns its public
 * URL. The bucket must already be configured for public read (or fronted by
 * a CDN) for that URL to actually be reachable by a <video> tag / download
 * link — this function only performs the upload.
 *
 * IMPORTANT: for most S3-compatible providers, the API endpoint you upload
 * through (S3_ENDPOINT — requires signed requests) is a *different* URL
 * from the public, browser-fetchable one:
 *   - Cloudflare R2: API endpoint is https://<accountid>.r2.cloudflarestorage.com,
 *     but the public URL is the bucket's "Public Development URL"
 *     (https://pub-<hash>.r2.dev) or a connected custom domain.
 *   - Backblaze B2: API endpoint is https://s3.<region>.backblazeb2.com,
 *     but the public "friendly URL" is https://f<cluster>.backblazeb2.com/file/<bucket>.
 * Set S3_PUBLIC_URL_BASE to that public base (no trailing slash) so the
 * returned URL is actually playable. If unset, this falls back to
 * path-style endpoint/bucket/key, which only works for providers where the
 * API endpoint itself is public (e.g. a self-hosted MinIO with an open bucket).
 */
export async function uploadFileToS3(
  key: string,
  filePath: string,
  contentType: string
): Promise<string> {
  const bucket = process.env.S3_BUCKET!;
  const { size } = await stat(filePath);

  await getClient().send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: createReadStream(filePath),
      ContentLength: size,
      ContentType: contentType,
    })
  );

  const publicBase = process.env.S3_PUBLIC_URL_BASE?.replace(/\/+$/, "");
  if (publicBase) return `${publicBase}/${key}`;

  const endpoint = process.env.S3_ENDPOINT!.replace(/\/+$/, "");
  return `${endpoint}/${bucket}/${key}`;
}
