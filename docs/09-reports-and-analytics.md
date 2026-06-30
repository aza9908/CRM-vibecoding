# 09 — Отчёты и аналитика по пройденным урокам

> Два уровня: (1) **отчёты учителя** по конкретным live-сессиям (кто что ответил) и (2) **аналитика по компании/организации** (вовлечённость, средний прогресс). Плюс экспорт.

## 1. Как сейчас (Supabase-проект)

### Отчёты учителя
- `/[locale]/teacher/lessons/[id]/reports` — список сессий урока (счётчики студентов, статус, время).
- `/[locale]/teacher/lessons/[id]/reports/[sessionId]` — детальный отчёт: студенты, блоки, ответы, сгруппированные по блоку; прогресс студента = `отвеченные интерактивные / всего интерактивных * 100`. Вкладки: студенты / ответы / метрики / рейтинги (`SessionMetrics`, `SessionRatings`).
- **Экспорт**: `ExportAllReportsButton` собирает иерархический JSON (уроки → сессии → студенты → ответы по блокам) и скачивает файлом.

### Аналитика по компании
- `/[locale]/dashboard/company` (роль `team_lead`/`admin`): всего студентов, активных за период, средний `progress_percent`, разбивка по сотрудникам (статус active/inactive/completed).
- Питается из `lesson_completions` + RPC `get_company_stats(org_id)`; есть `activity_logs`.

## 2. Что меняем для нового проекта

- RPC `get_company_stats` → **сервис-метод NestJS** с агрегирующим SQL (Drizzle).
- Клиентский сбор JSON в `ExportAllReportsButton` → **бэкенд-эндпоинт отчёта** (агрегация на сервере, отдаём JSON и CSV).
- Источник прогресса — единая `lesson_progress` + `activity_logs` (см. `01`).
- Графики на фронте — **recharts** (как сейчас).

## 3. Модуль отчётов/аналитики (NestJS)

```
apps/api/src/analytics/
├── reports.controller.ts     # отчёты учителя по сессиям + экспорт
├── analytics.controller.ts   # аналитика по организации
├── reports.service.ts
└── analytics.service.ts
```

| Метод | Эндпоинт | Роль | Назначение |
|---|---|---|---|
| GET | `/lessons/:id/sessions` | teacher | список сессий урока + счётчики |
| GET | `/sessions/:id/report` | teacher | детальный отчёт по сессии |
| GET | `/reports/export?lessonId=&format=csv\|json` | teacher | экспорт (вся выгрузка) |
| GET | `/analytics/company` | admin/team_lead | сводка по организации |
| GET | `/analytics/company/users/:userId` | admin/team_lead | детализация по сотруднику |

## 4. Детальный отчёт по сессии

```ts
// reports.service.ts (фрагмент)
async sessionReport(orgId: string, sessionId: string) {
  await this.assertSessionInOrg(sessionId, orgId);

  const session = await this.sessions.get(sessionId);
  const blocks = await this.blocks.getByLesson(session.lessonId);
  const parts = await this.db.select().from(participants)
    .where(eq(participants.sessionId, sessionId));
  const resp = await this.db.select().from(responses)
    .where(inArray(responses.participantId, parts.map(p => p.id)));

  const interactive = blocks.filter(isInteractive);
  const byParticipant = parts.map((p) => {
    const mine = resp.filter(r => r.participantId === p.id);
    const done = mine.filter(r => r.isCompleted &&
      interactive.some(b => b.id === r.blockId)).length;
    return {
      participant: { id: p.id, name: p.name },
      progressPercent: interactive.length ? Math.round(done / interactive.length * 100) : 0,
      answers: mine,
    };
  });

  // также удобно сгруппировать по блоку (вопрос → все ответы)
  const byBlock = blocks.map((b) => ({
    block: b,
    responses: resp.filter(r => r.blockId === b.id)
      .map(r => ({ participant: parts.find(p => p.id === r.participantId)?.name,
                   answer: r.answerText, at: r.updatedAt })),
  }));

  return { session, totals: {
    participants: parts.length,
    responses: resp.length,
    avgProgress: avg(byParticipant.map(x => x.progressPercent)),
  }, byParticipant, byBlock };
}
```

Фронт рисует вкладки: **Студенты** (с % прогресса), **По вопросам** (`byBlock`), **Метрики** (recharts: completion-распределение), **Рейтинги** (агрегаты блоков `input_rating`).

### Метрики для блоков `input_rating` / `test`

- `input_rating`: среднее, распределение по значениям (bar chart).
- `test`: % правильных (сравнение `answer_text` с `options.correct`), сложные вопросы (низкий % верных).

## 5. Экспорт (на бэке)

Текущий клиентский сбор заменяем серверным эндпоинтом — надёжнее и не грузит браузер.

```ts
@Get('reports/export')
@UseGuards(JwtAuthGuard, RolesGuard) @Roles('teacher')
async export(@CurrentUser() user, @Query('lessonId') lessonId: string,
             @Query('format') format: 'csv' | 'json' = 'csv', @Res() res: Response) {
  const data = await this.reports.aggregateForExport(user.orgId, user.sub, lessonId);
  if (format === 'json') {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="report-${lessonId}.json"`);
    return res.send(JSON.stringify(data, null, 2));
  }
  // CSV: одна строка = один ответ (participant × block)
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="report-${lessonId}.csv"`);
  return res.send(toCsv(data.rows)); // колонки: session_code, participant, block, question, answer, completed, at
}
```

> Для очень больших выгрузок (десятки тысяч строк) — стримить CSV построчно или вынести в фоновую задачу (BullMQ) и отдавать ссылку на готовый файл в S3. На старте достаточно синхронного ответа.

## 6. Аналитика по организации

Заменяем RPC `get_company_stats` на агрегирующий запрос. Ключевые метрики:

| Метрика | Источник | Формула |
|---|---|---|
| Всего студентов | `users` | count role='student' в orgId |
| Активные за 30 дней | `activity_logs` / `lesson_progress` | distinct user с активностью за 30д |
| Средний прогресс | `lesson_progress` | avg(progress_percent) по студентам org |
| Завершено уроков | `lesson_progress` | count status='completed' |
| По сотруднику | `lesson_progress`+`users` | прогресс, статус (active/inactive/completed) |

```ts
// analytics.service.ts (фрагмент)
async companyStats(orgId: string) {
  const since = new Date(Date.now() - 30 * 864e5);  // 30 дней (в проде передавай дату из контроллера)
  const [stats] = await this.db.execute(sql`
    SELECT
      (SELECT count(*) FROM users WHERE organization_id = ${orgId} AND role = 'student') AS total_students,
      (SELECT count(DISTINCT user_id) FROM activity_logs
         WHERE organization_id = ${orgId} AND created_at > ${since}) AS active_30d,
      (SELECT coalesce(round(avg(lp.progress_percent), 1), 0)
         FROM lesson_progress lp JOIN users u ON u.id = lp.user_id
         WHERE u.organization_id = ${orgId}) AS avg_progress
  `);
  return stats;
}
```

Статус сотрудника:
- **completed** — все уроки программы `status='completed'`;
- **inactive** — `last_accessed_at` старше 30 дней;
- **active** — иначе.

Детализация по сотруднику (`/analytics/company/users/:userId`): список завершённых уроков с датами + общий процент — join `lesson_progress` × `lessons`.

## 7. Графики (recharts на фронте)

- Компания: линия «активные за неделю», bar «прогресс по сотрудникам», donut «completed / in_progress / not_started».
- Сессия: bar «completion по студентам», bar «средний рейтинг по блокам», heatmap «вопрос × ответил/нет».
- Данные приходят уже агрегированными с бэка — фронт не считает, только рисует.

## 8. Производительность аналитики

- Индексы: `activity_logs(organization_id, created_at)`, `lesson_progress(user_id)` — уже в `01`.
- Для больших организаций тяжёлые сводки **кэшируй в Redis** (TTL 5–15 мин) — дашборд компании не требует секундной свежести.
- Если отчётов много и они тяжёлые — заведи материализованное представление / ночной пересчёт агрегатов (позже, не на старте).

## 9. Чек-лист

- [ ] `GET /sessions/:id/report` — по студентам и по блокам + метрики.
- [ ] Метрики рейтингов/тестов (среднее, распределение, % верных).
- [ ] `GET /reports/export` — CSV и JSON на бэке (не на клиенте).
- [ ] `GET /analytics/company` — total/active/avg + по сотрудникам, скоуп по orgId.
- [ ] `activity_logs` пишется на ключевых действиях (вход в урок, завершение, join сессии).
- [ ] recharts получает готовые агрегаты; тяжёлые сводки кэшируются в Redis.
