# CLAUDE.md — LMS (live-уроки + рабочая тетрадь + ИИ-ассистент)

> Этот файл читается Claude Code автоматически. Скопируй его в корень нового репозитория.
> Подробные спеки по каждой подсистеме — в `new-project-docs/00..06`.

## Что это за проект

B2B LMS с упором на **live-уроки**: учитель запускает урок, ученики входят по **коду сессии**, работают в **рабочей тетради** (блоки: текст, поля ввода, тесты), учитель в реальном времени «фокусит» нужный блок и видит ответы. Рядом — **ИИ-ассистент** (сократический наставник).

Функционал MVP: регистрация участников · создание уроков · запуск уроков (live) · рабочая тетрадь по коду · программа обучения · ИИ-ассистент.

## Стек

| Слой | Технология |
|---|---|
| Монорепо | pnpm workspaces |
| Frontend | Next.js 16 (App Router), React 19, TanStack Query, Zustand, Tailwind + shadcn/ui, next-intl |
| Backend | NestJS (TypeScript, strict) |
| БД | PostgreSQL 16 + Drizzle ORM |
| Realtime | Socket.IO (Nest WebSocket Gateway) + `@socket.io/redis-adapter` |
| Кэш/очереди | Redis |
| Auth | JWT (access + refresh), Passport, argon2 |
| Файлы | S3-совместимое (Cloudflare R2 в проде, MinIO локально) |
| LLM | Groq (OpenAI-совместимый API) через абстракцию провайдера |
| Деплой | Railway |

## Структура репозитория

```
apps/
  web/      # Next.js 16 — src/app/[locale], components, lib/api (REST), lib/ws (Socket.IO)
  api/      # NestJS — auth, users, lessons, sessions, responses, ai, realtime, db
packages/
  shared/   # ОБЩИЕ типы: enums, DTO, zod-схемы, контракт WS-событий
docker-compose.yml   # локально: postgres + redis + minio
pnpm-workspace.yaml
```

## Железные правила (нарушать нельзя)

1. **`packages/shared` — единственный источник правды** для DTO, enums, zod-схем и WS-событий. Всегда импортируй оттуда. НЕ дублируй типы между `web` и `api`.
2. **Изоляция тенантов на уровне приложения.** RLS (как в Supabase) здесь НЕТ. Каждый сервисный метод обязан фильтровать данные по `orgId` из JWT. При сомнении — добавляй фильтр. Это главный риск безопасности проекта.
3. **Два вида аутентификации, не путать:**
   - `User` (учитель/ученик/админ) — JWT с `aud=user`, гварды `JwtAuthGuard` + `RolesGuard`.
   - `Participant` (вход в сессию по коду) — JWT с `aud=participant`. НЕ даёт доступа к user-эндпоинтам.
4. **Секреты только на бэке.** `GROQ_API_KEY`, JWT-секреты, S3-ключи никогда не попадают в `web`. На клиенте — только `NEXT_PUBLIC_*` (URL'ы).
5. **LLM — за интерфейсом `LlmProvider`.** Прямых вызовов Groq/OpenAI вне `apps/api/src/ai/providers/` быть не должно.
6. **Drizzle-схема — в `apps/api/src/db/schema.ts`.** Менять БД только через миграции drizzle-kit, не ручным SQL.
7. **TypeScript strict.** Валидация любого внешнего входа — через zod / class-validator.

## Команды

```bash
# окружение
docker compose up -d                     # postgres, redis, minio

# разработка
pnpm --filter web dev                    # фронт :3000
pnpm --filter api dev                    # бэк :3001

# БД
pnpm --filter api drizzle:generate       # сгенерировать миграцию из изменений schema.ts
pnpm --filter api drizzle:migrate        # применить миграции

# сборка / проверки
pnpm -r build                            # собрать все воркспейсы
pnpm -r lint
pnpm -r test
```

## Конвенции

- **Эндпоинты REST**: ресурс во множественном числе (`/lessons`, `/sessions`). Массовое сохранение блоков — `PUT /lessons/:id/blocks`.
- **WS namespace** — `/live`, комнаты — `session:{id}`. Контракт событий (`focus:set`, `focus:changed`, `response:save`, `response:updated`, `participant:joined`, `session:ended`) описан в `packages/shared/src/ws-events.ts`.
- **Скоупинг**: прокидывай `orgId` из `request.user`; держи единый scoping-слой/интерсептор, а не копипасту фильтра в каждом методе.
- **Ответы учеников по WS** дебаунсятся на клиенте (200–400 мс) и шлются ТОЛЬКО учителю, не всем.
- **Код сессии**: 6 символов A–Z0–9 без похожих (0/O, 1/I); уникальность среди `status='live'` гарантирует частичный индекс + ретрай при коллизии.

## Переменные окружения

```bash
# apps/api/.env
DATABASE_URL=postgres://postgres:postgres@localhost:5432/lms
REDIS_URL=redis://localhost:6379
JWT_ACCESS_SECRET=...
JWT_REFRESH_SECRET=...
GROQ_API_KEY=...
S3_ENDPOINT=http://localhost:9000
S3_BUCKET=lms-media
S3_ACCESS_KEY=minio
S3_SECRET_KEY=minio12345
WEB_ORIGIN=http://localhost:3000

# apps/web/.env.local
NEXT_PUBLIC_API_URL=http://localhost:3001
NEXT_PUBLIC_WS_URL=ws://localhost:3001/live
```

## Definition of Done для любого изменения

- [ ] `pnpm -r build` зелёный, нет дублей DTO (всё из `packages/shared`).
- [ ] Новые/изменённые защищённые эндпоинты скоупятся по `orgId` (проверено чужим токеном → 403/404).
- [ ] Изменения БД — через миграцию drizzle-kit, не ручной SQL.
- [ ] Секреты не утекли на клиент (`grep NEXT_PUBLIC_` чист от ключей).
- [ ] Realtime-изменения проверены в двух вкладках (учитель + ученик).

## Типичные грабли

| Грабли | Решение |
|---|---|
| Дубли DTO на фронте и бэке | импорт из `packages/shared` |
| Забыт `orgId`-фильтр → утечка между тенантами | единый scoping-слой + тест с чужим токеном |
| WS-события не доходят между инстансами | Redis-адаптер подключён с самого начала |
| Дубль кода сессии | частичный уникальный индекс (where `status='live'`) + ретрай |
| SSE-стрим «висит» | таймаут + явный `data: [DONE]` + `res.end()` |
| Каждое нажатие летит в WS | дебаунс ответов 200–400 мс |

## Где что искать в спеках

`00` архитектура · `01` схема БД (Drizzle) · `02` auth и участники · `03` уроки и программа · `04` live-сессии и realtime · `05` ИИ на Groq · `06` пошаговая сборка через Claude Code.
