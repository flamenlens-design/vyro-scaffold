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
    
    RUN apt-get update && apt-get install -y --no-install-recommends \
          openssl ca-certificates \
        && rm -rf /var/lib/apt/lists/*
    
    RUN npm run build
# ---------- runner: minimal production image ----------
FROM node:20-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000

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
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma

USER nextjs
EXPOSE 3000

CMD ["node", "server.js"]
