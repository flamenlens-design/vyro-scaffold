// Redis connection for the generation queue (BullMQ).
//
// BullMQ requires `maxRetriesPerRequest: null` on any ioredis connection it
// drives — without it, ioredis's own retry/backoff logic fights with
// BullMQ's blocking-command handling and connections drop under load.
// See https://docs.bullmq.io/guide/going-to-production#maxretriesperrequest

import IORedis, { type RedisOptions } from "ioredis";

const REDIS_OPTIONS: RedisOptions = {
  maxRetriesPerRequest: null,
};

function redisUrl(): string {
  const url = process.env.REDIS_URL;
  if (!url) {
    throw new Error(
      "REDIS_URL is not set. Expected a redis:// (or rediss:// for TLS) " +
        "connection string, e.g. redis://localhost:6379 — see .env.example."
    );
  }
  return url;
}

let sharedConnection: IORedis | null = null;

// Reused by the queue producer (API routes enqueueing jobs). Lazily created
// so importing this module doesn't require REDIS_URL to be set at build time.
export function getConnection(): IORedis {
  if (!sharedConnection) {
    sharedConnection = new IORedis(redisUrl(), REDIS_OPTIONS);
  }
  return sharedConnection;
}

// BullMQ's docs recommend a Worker use its own dedicated connection rather
// than share one with a Queue in the same process, since a worker holds a
// blocking connection open while waiting for jobs.
export function newConnection(): IORedis {
  return new IORedis(redisUrl(), REDIS_OPTIONS);
}
