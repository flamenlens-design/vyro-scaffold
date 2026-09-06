// Standalone entrypoint for the generation worker process.
//
// Started via `npm run worker` (see package.json), which just runs this
// file with tsx. Render's vyro-worker service (render.yaml) runs that
// same command against the app's Docker image — see the Dockerfile's
// runner stage for why that image needs more than just the Next.js
// standalone build for this to actually work.

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
