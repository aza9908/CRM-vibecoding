# LMS — live lessons + workbook + AI assistant

B2B LMS focused on **live lessons**: a teacher starts a lesson, students join by a
**session code**, work in a **workbook** (blocks: text, inputs, tests), the teacher
"focuses" a block in real time and sees responses. Alongside it — a Socratic **AI assistant**.

## Stack

| Layer | Tech |
|---|---|
| Monorepo | pnpm workspaces |
| Frontend | Next.js 16 (App Router), React 19, TanStack Query, Zustand, Tailwind + shadcn/ui, next-intl |
| Backend | NestJS (TypeScript, strict) |
| DB | PostgreSQL 16 + Drizzle ORM |
| Realtime | Socket.IO (Nest WebSocket Gateway) + `@socket.io/redis-adapter` |
| Cache/queues | Redis |
| Auth | JWT (access + refresh), Passport, argon2 |
| Files | S3-compatible (Cloudflare R2 in prod, MinIO locally) |
| LLM | Groq (OpenAI-compatible API) behind a provider abstraction |
| Deploy | Railway |

## Repository layout

```
apps/
  web/      # Next.js 16  (@lms/web)
  api/      # NestJS       (@lms/api)
packages/
  shared/   # shared DTOs, enums, zod schemas, WS event contract (@lms/shared)
docker-compose.yml   # local: postgres + redis + minio
pnpm-workspace.yaml
```

`packages/shared` is the **single source of truth** for DTOs, enums, zod schemas and
WS event types — both `web` and `api` import from `@lms/shared`. Never duplicate types.

## Getting started

```bash
# 1. install dependencies
pnpm install

# 2. start local infrastructure (postgres + redis + minio)
docker compose up -d

# 3. configure env
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.local.example apps/web/.env.local
# fill in JWT_ACCESS_SECRET, JWT_REFRESH_SECRET, GROQ_API_KEY in apps/api/.env

# 4. run database migrations
pnpm --filter @lms/api drizzle:migrate
```

Local services exposed by `docker compose`:

- PostgreSQL — `localhost:5432` (db `lms`, user/pw `postgres`)
- Redis — `localhost:6379`
- MinIO — API `localhost:9000`, console `localhost:9001` (user `minio`, pw `minio12345`)

## Development

```bash
pnpm --filter @lms/web dev    # frontend on :3000
pnpm --filter @lms/api dev    # backend  on :3001
pnpm dev                      # both in parallel
```

## Database (Drizzle)

```bash
pnpm --filter @lms/api drizzle:generate   # generate a migration from schema.ts changes
pnpm --filter @lms/api drizzle:migrate    # apply migrations
```

Schema lives in `apps/api/src/db/schema.ts`. Change the DB only via drizzle-kit
migrations — never with ad-hoc SQL.

## Build, lint, test

```bash
pnpm -r build   # build every workspace
pnpm -r lint
pnpm -r test
```
