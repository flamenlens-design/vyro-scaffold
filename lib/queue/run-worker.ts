// Standalone entrypoint for the generation worker process.
//
// This scaffold has no "worker" script in package.json yet (out of scope
// for this change — see summary for how to add one). Until then, run this
// file directly with a TS runner, e.g.:
//
//   npx tsx lib/queue/run-worker.ts
//
// or compile with `tsc` and run the emitted JS with `node`.

import { startGenerationWorker } from "./worker";

const worker = startGenerationWorker();

console.log(`[generation-queue] worker started (concurrency ${worker.opts.concurrency ?? 1})`);

async function shutdown(signal: string) {
  console.log(`[generation-queue] received ${signal}, closing worker...`);
  await worker.close();
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
