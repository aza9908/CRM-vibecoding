# 07 — Материалы урока (учитель прикрепляет, ученик видит в правой панели)

> Учитель загружает файлы / добавляет ссылки и привязывает их к урокам. Ученик видит материалы текущего урока во вкладке «Материалы» правой панели рабочей тетради.

## 1. Как сейчас (Supabase-проект)

- **Модель**: `course_materials` (id, title, type `file|link`, url, created_by) + junction `lesson_materials` (lesson_id, material_id). Один материал можно привязать к нескольким урокам (many-to-many).
- **Учитель**: страница `/[locale]/teacher/materials` → `MaterialsList`, server actions `materials-actions.ts`:
  - `createMaterialAction` — создаёт материал + связи с уроками;
  - `updateMaterialAction` — upsert + пересоздание связей;
  - `deleteMaterialAction` — удаляет из бакета `course-materials` + каскад в БД;
  - `getMaterialsForLessonAction` — материалы конкретного урока.
- **Файлы**: приватный бакет `course-materials`, доступ — через **signed URL**.
- **Ученик**: `LessonMaterialsView` живёт во вкладке «Заметки» правой панели (`RightPanel`), показывает материалы текущего урока, клик → скачивание (signed URL) или открытие ссылки.

## 2. Что переносим / меняем

- Модель `course_materials` + `lesson_materials` сохраняем как есть (уже в `01-database-schema.md`), добавили только `organization_id` для скоупинга тенанта.
- Бакет Supabase → **приватный бакет S3/R2**, доступ через **presigned GET** (аналог signed URL).
- На фронте материалы выносим в **отдельную вкладку «Материалы»** правой панели (в текущем проекте они приклеены к заметкам — в новом разведём, см. `08-right-panel-and-progress.md`).

## 3. API материалов (NestJS)

```
apps/api/src/materials/
├── materials.controller.ts
├── materials.service.ts
└── dto/{create-material,update-material}.dto.ts
```

| Метод | Эндпоинт | Роль | Назначение |
|---|---|---|---|
| GET | `/materials` | teacher | все материалы организации |
| POST | `/materials` | teacher | создать материал (+ привязать к урокам) |
| PATCH | `/materials/:id` | teacher | переименовать / переподвязать уроки |
| DELETE | `/materials/:id` | teacher | удалить (файл из S3 + строки) |
| POST | `/uploads/presign` | teacher | presign PUT для загрузки файла (см. `03`) |
| GET | `/lessons/:id/materials` | teacher/participant | материалы урока (для правой панели) |
| GET | `/materials/:id/download` | teacher/participant | presigned GET для скачивания файла |

### Создание материала (файл или ссылка) + привязка к урокам

```ts
// materials.service.ts (фрагмент)
async create(orgId: string, userId: string, dto: CreateMaterialDto) {
  // dto: { title, type: 'file'|'link', url, lessonIds: string[] }
  return this.db.transaction(async (tx) => {
    const [m] = await tx.insert(courseMaterials).values({
      organizationId: orgId,
      createdBy: userId,
      title: dto.title,
      type: dto.type,
      url: dto.url,            // S3-ключ (для file) или web-URL (для link)
    }).returning();

    if (dto.lessonIds?.length) {
      // привязываем только уроки этой же организации
      await this.assertLessonsInOrg(dto.lessonIds, orgId);
      await tx.insert(lessonMaterials).values(
        dto.lessonIds.map((lessonId) => ({ lessonId, materialId: m.id })),
      );
    }
    return m;
  });
}
```

### Загрузка файла (presign, без проксирования через бэк)

Поток для учителя:
1. `POST /uploads/presign { filename, contentType }` → `{ uploadUrl, key }` (см. `03-lessons-and-curriculum.md`, тот же механизм, что и для картинок блоков, но префикс `course-materials/`).
2. Фронт `PUT` файла напрямую в S3/R2 по `uploadUrl`.
3. `POST /materials { title, type:'file', url: key, lessonIds }`.

### Скачивание (приватный бакет → presigned GET)

```ts
@Get('materials/:id/download')
@UseGuards(JwtOrParticipantGuard)   // и user, и participant сессии могут качать
async download(@Param('id') id: string, @CurrentIdentity() who) {
  const m = await this.materials.getAccessible(id, who); // проверка orgId / доступа к уроку
  if (m.type === 'link') return { url: m.url };          // внешняя ссылка — отдаём как есть
  const url = await this.s3.getSignedGetUrl(m.url, 300); // 5 мин
  return { url };
}
```

> Файлы лежат в **приватном** бакете — прямого публичного URL нет, только короткоживущий signed GET. Это важно: материалы могут быть платным контентом.

## 4. Привязка материала к уроку у учителя (UX)

Два равноценных входа (как удобнее):
- **Из менеджера материалов** (`/teacher/materials`): создаёшь материал и галочками выбираешь уроки.
- **Из редактора урока** (`/editor?id=...`): панель «Материалы урока» — прикрепить существующий материал или загрузить новый прямо здесь (вызывает те же эндпоинты с предзаполненным `lessonIds=[currentLesson]`).

Рекомендую сделать оба, но если резать MVP — оставь привязку из редактора урока (ближе к рабочему потоку учителя).

## 5. Вкладка «Материалы» у ученика

В live-тетради правая панель имеет вкладку «Материалы» (см. `08`). Компонент:

```ts
// apps/web/src/components/live/MaterialsTab.tsx (набросок)
function MaterialsTab({ lessonId }: { lessonId: string }) {
  const { data: materials } = useQuery(['lesson-materials', lessonId],
    () => api.get(`/lessons/${lessonId}/materials`));
  return materials?.map((m) => (
    <MaterialRow key={m.id} material={m}
      onOpen={async () => {
        const { url } = await api.get(`/materials/${m.id}/download`);
        window.open(url, '_blank');  // signed GET или внешняя ссылка
      }} />
  ));
}
```

Иконка по типу: файл (pdf/doc/zip…) или ссылка. Подгружаются материалы **текущего урока сессии**.

## 6. Чек-лист

- [ ] Таблицы `course_materials` + `lesson_materials` (готово в `01`), скоуп по `organization_id`.
- [ ] CRUD материалов; привязка к нескольким урокам через junction.
- [ ] Загрузка файлов presign'ом в приватный бакет `course-materials/`.
- [ ] Скачивание — только через presigned GET (5 мин), ссылки — как есть.
- [ ] Доступ к `/materials/:id/download` и для `user`, и для `participant` (проверка по orgId/уроку).
- [ ] Вкладка «Материалы» в правой панели тянет материалы текущего урока.
