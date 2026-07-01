# syntax=docker/dockerfile:1
# Place this file at the REPO ROOT (next to pnpm-workspace.yaml)

# ---------- build stage ----------
FROM node:22-slim AS build
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /repo

# Install deps first (better layer caching)
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile --filter "@lms/api..."

# Build shared package, then the API
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN pnpm --filter @lms/shared build \
 && pnpm --filter @lms/api build

# Produce a standalone bundle with production-only node_modules
RUN pnpm --filter @lms/api --prod deploy /out

# ---------- runtime stage ----------
FROM node:22-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /out .

# Cloud Run injects PORT=8080; main.ts already reads it
EXPOSE 8080
CMD ["node", "dist/main.js"]
