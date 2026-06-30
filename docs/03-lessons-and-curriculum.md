# 03 — Создание уроков и программа обучения

> Как устроены уроки (контент-блоки) и учебная программа, и как перенести это на NestJS + Drizzle.

## 1. Как сейчас (Supabase)

- **Иерархия**: `courses` → `modules` (M1/M2/M3) → `lessons` → `lesson_blocks`.
- **Редактор** (`/[locale]/editor`): визуальный билдер блоков с drag-and-drop (`@dnd-kit`). Типы блоков: `text, image, input_text, input_select, input_rating, action_button, input_file, test`.
- **Автосохранение черновика** в localStorage, при «Опубликовать» — upsert блоков + удаление «осиротевших».
- **Программа обучения** (`/[locale]/syllabus`): 3 модуля, рендер из статического `src/data/syllabus.ts` + данные из БД.
- **Outcomes**: учебные результаты `lesson_outcomes`, к ним привязываются блоки (`outcome_id`).
- **AI-генерация** блоков через `/api/generate-workbook`.

## 2. Что переносим

Та же иерархия и те же типы блоков (см. схему в `01-database-schema.md`). Меняется только транспорт: вместо прямых Supabase-запросов с клиента — REST к NestJS.

## 3. API уроков (NestJS)

```
apps/api/src/lessons/
├── lessons.controller.ts
├── lessons.service.ts
├── blocks.service.ts
└── dto/
    ├── create-lesson.dto.ts
    ├── update-lesson.dto.ts
    └── save-blocks.dto.ts
```

| Метод | Эндпоинт | Роль | Назначение |
|---|---|---|---|
| GET | `/lessons` | teacher | список уроков организации |
| POST | `/lessons` | teacher | создать урок |
| GET | `/lessons/:id` | teacher/student | урок + блоки + outcomes |
| PATCH | `/lessons/:id` | teacher | переименовать/переместить |
| DELETE | `/lessons/:id` | teacher | удалить |
| PUT | `/lessons/:id/blocks` | teacher | **массовое сохранение блоков** (как «Опубликовать») |
| POST | `/lessons/:id/blocks/generate` | teacher | AI-генерация блоков (см. `05`) |
| GET | `/curriculum` | все | программа обучения (модули + уроки) |

### Массовое сохранение блоков (ключевой метод редактора)

Повторяем логику текущего редактора: upsert присланных блоков + удаление тех, что исчезли.

```ts
// blocks.service.ts (фрагмент)
async saveBlocks(orgId: string, lessonId: string, incoming: BlockDto[]) {
  await this.assertLessonInOrg(lessonId, orgId);

  return this.db.transaction(async (tx) => {
    const incomingIds = incoming.filter(b => b.id).map(b => b.id!);

    // 1. удалить осиротевшие блоки
    await tx.delete(lessonBlocks).where(and(
      eq(lessonBlocks.lessonId, lessonId),
      incomingIds.length ? notInArray(lessonBlocks.id, incomingIds) : undefined,
    ));

    // 2. upsert каждого блока с корректным order_index
    for (const [i, b] of incoming.entries()) {
      await tx.insert(lessonBlocks)
        .values({ ...b, lessonId, orderIndex: i })
        .onConflictDoUpdate({
          target: lessonBlocks.id,
          set: { content: b.content, options: b.options, type: b.type,
                 imageUrl: b.imageUrl, orderIndex: i, outcomeId: b.outcomeId },
        });
    }
    return this.getBlocks(lessonId);
  });
}
```

> Порядок блоков определяется индексом в массиве — фронт шлёт их уже отсортированными после drag-and-drop. Это убирает рассинхрон `order_index`.

## 4. Редактор на фронте (Next.js 16)

- Состояние блоков — в Zustand-сторе редактора; автосохранение черновика в `localStorage` (как сейчас), но публикация идёт через `PUT /lessons/:id/blocks`.
- Drag-and-drop — `@dnd-kit` (переносится почти без изменений).
- Загрузка картинок блоков — пресайн-URL из S3/R2 (см. ниже), `imageUrl` сохраняется в блок.

### Загрузка картинок (замена Supabase Storage)

```ts
// storage.controller.ts
@Post('uploads/presign')
@UseGuards(JwtAuthGuard)
async presign(@Body() dto: { filename: string; contentType: string }) {
  const key = `lesson-media/${randomUUID()}-${dto.filename}`;
  const url = await this.s3.getSignedPutUrl(key, dto.contentType); // 60 сек
  return { uploadUrl: url, publicUrl: this.s3.publicUrl(key) };
}
```

Фронт: запрашивает presign → `PUT` файла напрямую в R2/MinIO → кладёт `publicUrl` в блок. Бэкенд файлы не проксирует.

## 5. Программа обучения (curriculum)

Текущий проект частично хранит syllabus статически (`src/data/syllabus.ts`). Рекомендую **перенести программу полностью в БД** (`courses`/`modules`/`lessons`), а статикой оставить только маркетинговое описание, если нужно.

```ts
// curriculum endpoint возвращает дерево
GET /curriculum  →
{
  course: { id, title },
  modules: [
    { id, code: 'M1', title, lessons: [{ id, title, outcomes: [...] }] },
    { id, code: 'M2', title, lessons: [...] },
  ]
}
```

Для ученика дополнительно подмешивается `user_progress` (started/completed), чтобы рисовать галочки прогресса:

```ts
async curriculumForStudent(orgId: string, userId: string) {
  const tree = await this.getCurriculumTree(orgId);
  const progress = await this.db.select().from(userProgress)
    .where(eq(userProgress.userId, userId));
  // смержить status в каждый lesson
  return mergeProgress(tree, progress);
}
```

## 6. Отметка прогресса

Когда ученик завершает урок (например, заполнил все обязательные блоки или учитель закрыл сессию):

```ts
await db.insert(userProgress)
  .values({ userId, lessonId, status: 'completed', completedAt: new Date() })
  .onConflictDoUpdate({
    target: [userProgress.userId, userProgress.lessonId],
    set: { status: 'completed', completedAt: new Date() },
  });
```

## 7. Чек-лист переноса

- [ ] Иерархия courses/modules/lessons/blocks в Drizzle (готово в `01`).
- [ ] CRUD уроков + массовое сохранение блоков с удалением осиротевших.
- [ ] Presign-загрузка картинок в S3/R2.
- [ ] Curriculum-эндпоинт (дерево) + подмешивание прогресса для ученика.
- [ ] Outcomes привязаны к блокам (`outcome_id`).
- [ ] AI-генерация блоков (детали — в `05-ai-assistant.md`).
