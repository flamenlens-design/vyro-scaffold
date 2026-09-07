# syntax=docker/dockerfile:1

# ---------- deps: install node_modules only ----------
FROM node:20-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# --ignore-scripts skips the `prisma generate` postinstall here — the schema
# isn't copied into this stage, and generating happens explicitly in the
# builder stage once the full source is present. Keeps this layer cacheable
# on package.json changes alone.
RUN npm ci --ignore-scripts

# ---------- builder: generate Prisma client + build Next.js ----------
    FROM node:20-slim AS builder
    WORKDIR /app
    COPY --from=deps /app/node_modules ./node_modules
    COPY . .
    ENV NEXT_TELEMETRY_DISABLED=1

    # next build imports every API route to collect metadata, which runs
    # `new PrismaClient()` at module scope — it throws if DATABASE_URL is
    # unset. This dummy value only satisfies that check; Prisma doesn't
    # connect during build. Real DATABASE_URL comes from Render at runtime.
    ENV DATABASE_URL="postgresql://build:build@localhost:5432/build"

    RUN apt-get update && apt-get install -y --no-install-recommends \
          openssl ca-certificates \
        && rm -rf /var/lib/apt/lists/*

    RUN npm run build
# ---------- runner: minimal production image ----------
FROM node:20-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME=0.0.0.0

# ffmpeg: needed by the export pipeline (roadmap step 9). openssl/ca-certificates:
# required by Prisma's query engine at runtime on Debian-based images.
RUN apt-get update && apt-get install -y --no-install-recommends \
      ffmpeg openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

RUN addgroup --system --gid 1001 nodejs \
    && adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder /app/prisma ./prisma

# render.yaml's vyro-worker service runs `npm run worker` (tsx
# lib/queue/run-worker.ts) against this exact image via dockerCommand —
# but everything copied above only serves the standalone Next.js *web*
# server. Without package.json (nowhere for `npm run worker` to find the
# script), the lib/ source (never copied), and the full node_modules
# (tsx/bullmq/ioredis and the OpenRouter/ElevenLabs/Groq/fal.ai clients are
# all pruned from the standalone build since it only traces the web
# server's own dependency graph), that command fails immediately with
# "Cannot find module" or "missing script: worker". From the outside that
# looks identical to jobs stuck at QUEUED forever — the worker container
# never actually starts, so nothing is ever there to dequeue them. Copying
# the full node_modules (superset of the two Prisma-specific folders this
# used to copy individually) plus the worker's source is what makes one
# shared image correctly serve both services.
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/tsconfig.json ./tsconfig.json
COPY --from=builder /app/lib ./lib
COPY --from=builder /app/node_modules ./node_modules

USER nextjs
EXPOSE 10000

CMD ["node", "server.js"]
