# 00 — Архитектура нового проекта

> Серия документов для запуска нового LMS-проекта «рабочая тетрадь + live-уроки + ИИ-ассистент» на собственном бэкенде (без Supabase), собираемого через Claude Code.

## 1. Что строим

LMS с упором на **live-уроки**: учитель запускает урок, ученики заходят по **коду сессии**, работают в **рабочей тетради** (блоки: текст, поля ввода, тесты), учитель в реальном времени «фокусирует» нужный блок и видит ответы, рядом — **ИИ-ассистент** (сократический наставник).

Минимальный набор функционала (из ТЗ):

1. Регистрация участников
2. Создание уроков
3. Запуск уроков (live)
4. Рабочая тетрадь с доступом по коду сессии
5. Программа обучения (curriculum)
6. ИИ-ассистент

## 2. Как это устроено сейчас (референс)

Текущий проект `university-of-unicorns`:

- **Frontend + backend в одном Next.js** (App Router), вся логика — server actions / API routes.
- **Supabase** закрывает всё: Postgres, Auth, Realtime (WebSocket поверх Postgres-изменений), Storage.
- **Realtime**: учитель пишет `focused_block_id` в строку `live_sessions`, Supabase Realtime рассылает изменение всем подписанным ученикам. Ответы учеников летят через `postgres_changes` на `responses`.
- **ИИ**: `POST /api/agent` → подгружает промпт (`src/ai/prompts/student.md`) → шлёт во внешний webhook (Freedom AI).

Это быстро в разработке, но связывает тебя с лимитами Supabase Realtime и его моделью БД. Мы переносим то же поведение на свой стек.

## 3. Целевая архитектура

```
                 ┌─────────────────────────────┐
   Браузер  ───► │  Next.js 15 (App Router)     │  SSR + клиент
   (ученик/     │  TanStack Query / Zustand    │
    учитель)    └──────────┬──────────────────┘
                            │ REST (https)  +  WebSocket (wss)
                            ▼
                 ┌─────────────────────────────┐
                 │  NestJS API (TypeScript)     │
                 │  ├─ Auth (JWT)               │
                 │  ├─ Lessons / Sessions       │
                 │  ├─ Responses                │
                 │  ├─ AI (Groq, SSE)           │
                 │  └─ WebSocket Gateway        │
                 └───┬───────────┬─────────┬────┘
                     │           │         │
              ┌──────▼───┐  ┌────▼────┐  ┌─▼─────────┐
              │PostgreSQL│  │  Redis  │  │ S3 / R2   │
              │ +Drizzle │  │ pub/sub │  │ (файлы)   │
              └──────────┘  │ + adapter│ └───────────┘
                            └─────────┘
                                  ▲
                                  │ (Socket.IO Redis adapter
                                  │  для нескольких инстансов)
```

## 4. Технологический стек

| Слой | Технология | Назначение |
|---|---|---|
| Frontend | Next.js 16 (App Router), React 19 | UI, SSR |
| Состояние | TanStack Query + Zustand | server-state / client-state |
| UI | Tailwind CSS + shadcn/ui | как в текущем проекте |
| i18n | next-intl | ru / kk / en |
| Backend | **NestJS** | модульный API, DI, гварды |
| ORM | **Drizzle** | типобезопасные запросы и миграции |
| БД | **PostgreSQL 16** | основное хранилище |
| Realtime | **Socket.IO** (Nest WebSocket Gateway) | live-синхронизация тетради |
| Масштаб realtime | **@socket.io/redis-adapter** | несколько инстансов через Redis |
| Кэш/очереди | **Redis** (+ BullMQ опционально) | сессии, rate-limit, фоновые задачи |
| Auth | JWT (access+refresh), Passport, **argon2** | регистрация/вход |
| Файлы | **Cloudflare R2** или **MinIO** (S3 API) | картинки блоков, материалы |
| LLM | **Groq** (OpenAI-совместимый), SSE | ИИ-ассистент |
| Деплой | **Railway** | Postgres + Redis + сервисы |

## 5. Структура репозитория (монорепо)

Рекомендую монорепо (pnpm workspaces или Turborepo), чтобы Claude Code видел фронт и бэк вместе и переиспользовал типы:

```
project/
├── apps/
│   ├── web/                 # Next.js фронтенд
│   │   └── src/
│   │       ├── app/[locale]/...
│   │       ├── components/
│   │       ├── lib/api/      # клиент к NestJS (fetch + react-query)
│   │       └── lib/ws/       # Socket.IO клиент
│   └── api/                 # NestJS бэкенд
│       └── src/
│           ├── auth/
│           ├── users/
│           ├── lessons/
│           ├── sessions/    # live-сессии + код сессии
│           ├── responses/
│           ├── ai/          # Groq
│           ├── realtime/    # WebSocket gateway
│           └── db/          # Drizzle schema + миграции
├── packages/
│   └── shared/              # общие типы (DTO, enums, zod-схемы)
├── docker-compose.yml       # локально: postgres + redis + minio
└── pnpm-workspace.yaml
```

`packages/shared` — ключевая идея: DTO и zod-схемы пишутся один раз и импортируются и фронтом, и бэком. Это резко снижает рассинхрон и помогает Claude Code держать контракт.

## 6. Масштабирование под 10k–100k пользователей / 2k одновременно в live

Узкое место — **не БД, а WebSocket-соединения**.

- **БД**: 100k пользователей, миллионы строк ответов — для Postgres мелочь. Нужны индексы (см. `01-database-schema.md`) и connection pooling (PgBouncer / встроенный в Railway).
- **WebSocket**: 2000 одновременных коннектов один Node-процесс держит спокойно (~1 vCPU, 1–2 GB RAM). Главное — не слать тяжёлые payload'ы и группировать клиентов по **комнатам = сессиям** (`room: session:{id}`), чтобы рассылка focus-события шла только в нужную комнату.
- **Горизонтальное масштабирование**: когда одного инстанса мало, поднимаешь 2–3 за балансировщиком; Redis-адаптер Socket.IO синхронизирует комнаты между ними. Код менять не нужно — он сразу пишется с адаптером.
- **AI**: запросы к Groq — самое «дорогое» по времени. Стримим через SSE, не блокируем event loop, ставим rate-limit на пользователя.

### Пороговая таблица

| Одновременно в live | Что делать |
|---|---|
| до 2 000 | 1 инстанс API, Redis-адаптер «про запас» |
| 2 000 – 10 000 | 2–4 инстанса API за LB, Redis-адаптер обязателен, отдельный Postgres-пул |
| 10 000+ | вынести WS в отдельный realtime-сервис (тот же Socket.IO кластер или Centrifugo), API — отдельно |

## 7. Поток данных (один live-урок)

1. Учитель жмёт «Запустить» → `POST /sessions` создаёт сессию, генерит код, ставит `status=live`.
2. Ученик вводит код → `POST /sessions/join` → получает participant-токен и `sessionId`.
3. Ученик открывает тетрадь → подключается по WS, `socket.emit('session:join', {sessionId})` → сервер кладёт сокет в комнату `session:{id}`.
4. Учитель меняет фокус → `socket.emit('focus:set', {blockId})` → сервер пишет в БД и `io.to('session:{id}').emit('focus:changed', {blockId})`.
5. Ученик отвечает → `POST /responses` (или WS) → сервер сохраняет → шлёт учителю `response:updated`.
6. Ученик зовёт ИИ → `POST /ai/chat` (SSE) → стрим ответа Groq.

## 8. Порядок чтения документов

1. `00-architecture.md` — этот файл
2. `01-database-schema.md` — схема БД и Drizzle
3. `02-auth-and-participants.md` — регистрация и роли
4. `03-lessons-and-curriculum.md` — уроки и программа обучения
5. `04-live-sessions.md` — код сессии, запуск, realtime-тетрадь
6. `05-ai-assistant.md` — ИИ-ассистент на Groq
7. `06-claude-code-workflow.md` — пошаговая сборка через Claude Code
