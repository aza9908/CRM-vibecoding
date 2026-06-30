# 06 — Сборка проекта через Claude Code

> Пошаговый план, как поднять весь проект руками Claude Code, какие промпты давать и в каком порядке. Идея: маленькие проверяемые шаги, на каждом — рабочее состояние.

## 1. Принципы работы с Claude Code на этом проекте

1. **Монорепо в одном контексте.** Держи `apps/web`, `apps/api`, `packages/shared` в одном репозитории — Claude Code видит контракт целиком и не рассинхронит типы.
2. **`packages/shared` — источник правды.** DTO, enums, zod-схемы и WS-события пишутся один раз. Всегда проси Claude импортировать оттуда, а не дублировать.
3. **Шаги маленькие и проверяемые.** Один модуль = один заход. После каждого — `pnpm build` / запуск / curl.
4. **Сначала контракт, потом реализация.** Сначала DTO/типы и сигнатуры эндпоинтов, потом тело сервисов. Так Claude не уплывает.
5. **Дай этот набор доков в контекст.** Когда начинаешь новый чат — приложи `00`–`05`, чтобы агент знал схему и решения.

## 2. CLAUDE.md для нового репозитория

Заведи в корне нового проекта `CLAUDE.md` примерно такого содержания (Claude Code читает его автоматически):

```md
# Проект: LMS (live-уроки + рабочая тетрадь + ИИ)

## Стек
- Монорепо: pnpm workspaces. apps/web (Next.js 16), apps/api (NestJS), packages/shared (типы).
- БД: PostgreSQL + Drizzle. Realtime: Socket.IO + Redis-адаптер. Auth: JWT. LLM: Groq.

## Правила
- Общие DTO/enums/zod/WS-события — ТОЛЬКО в packages/shared, импортировать оттуда.
- Каждый сервис фильтрует данные по orgId из JWT (RLS нет — изоляция на уровне приложения).
- Drizzle-схема: apps/api/src/db/schema.ts. Миграции: drizzle-kit.
- Не класть секреты (GROQ_API_KEY и т.п.) на клиент.
- TypeScript strict. Валидация входа через zod/class-validator.

## Команды
- pnpm --filter api dev / pnpm --filter web dev
- pnpm --filter api drizzle:generate / drizzle:migrate
- docker compose up -d  (postgres, redis, minio)
```

## 3. Порядок шагов

### Шаг 0 — каркас монорепо
> Промпт: «Создай pnpm-монорепо с apps/web (Next.js 16, App Router, TS, Tailwind, shadcn), apps/api (NestJS), packages/shared. Настрой pnpm-workspace.yaml, tsconfig с путями, docker-compose с postgres:16, redis:7, minio. Добавь CLAUDE.md (приложу содержимое).»

Проверка: `docker compose up -d` поднимается, `pnpm --filter web dev` и `--filter api dev` стартуют.

### Шаг 1 — БД и Drizzle
> Промпт: «В apps/api заведи Drizzle по схеме из `01-database-schema.md` (приложена). Настрой drizzle.config.ts, сгенерируй и примени первую миграцию. Добавь DbModule, отдающий drizzle-инстанс через DI.»

Проверка: миграция применяется, таблицы есть в Postgres.

### Шаг 2 — общие типы
> Промпт: «В packages/shared опиши enums (роли, типы блоков, статусы), DTO для auth/lessons/sessions и WS-события из `04-live-sessions.md` (zod-схемы + выведенные типы). Экспортируй из index.»

Проверка: `pnpm --filter shared build` без ошибок.

### Шаг 3 — Auth
> Промпт: «Реализуй модуль auth по `02-auth-and-participants.md`: register/login/refresh/me, JWT (access+refresh, ротация), argon2, JwtAuthGuard, RolesGuard, ParticipantStrategy. DTO бери из packages/shared.»

Проверка: `curl` register → login → me с токеном.

### Шаг 4 — Уроки и программа
> Промпт: «Реализуй модуль lessons по `03-lessons-and-curriculum.md`: CRUD уроков, массовое сохранение блоков (upsert + удаление осиротевших) в транзакции, curriculum-дерево, presign-загрузку в S3/MinIO. Скоупь всё по orgId.»

Проверка: создать урок, сохранить блоки, получить дерево curriculum.

### Шаг 5 — Live-сессии + realtime (ключевой шаг)
> Промпт: «Реализуй модуль sessions + WebSocket-гейтвей по `04-live-sessions.md`: генерация уникального кода, /sessions/join с participant-токеном, namespace /live с комнатами session:{id}, события focus/response, Redis-адаптер. Проверяй токен на connect.»

Проверка: два браузера — учитель меняет фокус, ученик видит; ответ ученика приходит учителю.

### Шаг 6 — ИИ-ассистент
> Промпт: «Реализуй модуль ai по `05-ai-assistant.md`: интерфейс LlmProvider + GroqProvider (OpenAI SDK на baseURL Groq), сборку промпта из prompts/student.md, SSE-эндпоинт /ai/chat с сохранением в ai_chats, AI-генерацию блоков с zod-валидацией, rate-limit.»

Проверка: запрос в чат стримит ответ по токенам.

### Шаг 7 — Фронтенд
> Промпт: «Собери страницы Next.js 16: /join, /live/[sessionId] (ученик), /teacher/lessons, /editor (drag-and-drop блоки), /teacher/live/[sessionId], /syllabus. Используй TanStack Query для REST и хук useSessionSocket для WS. Типы — из packages/shared.»

Проверка: полный сценарий «создать урок → запустить → войти по коду → ответить → ИИ».

### Шаг 8 — Деплой на Railway
У тебя подключён Railway MCP. 
> Промпт: «Разверни на Railway: Postgres, Redis, сервис api (NestJS), сервис web (Next.js). Прокинь переменные (DATABASE_URL, REDIS_URL, GROQ_API_KEY, JWT-секреты, WEB_ORIGIN). Сгенерируй домены.»

## 4. Переменные окружения

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

## 5. Что проверять на каждом шаге (definition of done)

- [ ] `pnpm build` зелёный во всех воркспейсах.
- [ ] Типы берутся из `packages/shared`, нет дублей DTO.
- [ ] Каждый защищённый эндпоинт реально скоупится по orgId (проверь чужой токен → 403/404).
- [ ] Realtime работает в двух вкладках.
- [ ] Секреты не утекли на клиент (`grep` по NEXT_PUBLIC_).

## 6. Типичные грабли

| Грабли | Решение |
|---|---|
| Claude дублирует DTO на фронте и бэке | жёстко требовать импорт из `packages/shared` |
| Забыли orgId-фильтр → утечка между тенантами | единый scoping-слой/интерсептор + тест с чужим токеном |
| WS-события не доходят между инстансами | Redis-адаптер с самого начала |
| Код сессии иногда дублируется | частичный уникальный индекс (where status='live') + ретрай |
| SSE «висит» | таймаут стрима + явный `[DONE]` + закрытие соединения |
| Каждое нажатие клавиши летит в WS | дебаунс ответов на клиенте 200–400 мс |

## 7. Минимальный MVP (если нужно быстро показать)

Если хочешь сначала демо, можно срезать до:
1. Auth (только login учителя + join по коду для ученика).
2. Один захардкоженный урок с блоками (без редактора).
3. Live-сессия + focus + ответы (ядро ценности).
4. ИИ-чат на Groq.

Программу обучения, редактор и AI-генерацию блоков добавить вторым этапом.
