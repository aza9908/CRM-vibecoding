# syntax=docker/dockerfile:1
# Standalone image for the Next.js web app (VPS deploy).

FROM node:22-slim AS build
WORKDIR /repo
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci
COPY packages/shared packages/shared
COPY apps/web apps/web
# NEXT_PUBLIC_* are inlined into the client bundle at build time, not read at
# container runtime, so they must be build args, not just env vars.
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_WS_URL
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}
ENV NEXT_PUBLIC_WS_URL=${NEXT_PUBLIC_WS_URL}
RUN npm run build --workspace=@lms/shared \
 && npm run build --workspace=@lms/web

FROM node:22-slim
ENV NODE_ENV=production
WORKDIR /app
# Next.js standalone output already contains a pruned node_modules tree.
COPY --from=build /repo/apps/web/.next/standalone ./
COPY --from=build /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /repo/apps/web/public ./apps/web/public
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
