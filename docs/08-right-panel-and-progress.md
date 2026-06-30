# 08 — Правая панель и навигация с прогрессом

> Раскладка правой панели рабочей тетради (вкладки) и навигация по блокам/урокам с отображением прогресса.

## 1. Как сейчас (Supabase-проект)

- **Раскладка экрана live**: Sidebar (слева) · Center Stage (видео/стрим + блоки тетради) · **Right Panel** (справа).
- **Right Panel** = три вкладки:
  1. **notes** — заметки ученика (textarea, автосейв в `workbook_entries`) + материалы урока приклеены сверху;
  2. **navigation** — структура урока с поблочными статусами;
  3. **tutor** — чат с ИИ (см. `05`).
- **Прогресс по блокам** («Smart Progression»): когда ученик отвечает на интерактивный блок N, все предшествующие пассивные блоки (text/image) авто-помечаются завершёнными. Интерактивные (input_text/select/rating/file, action_button, test) требуют явного ответа. Состояние держится в памяти (`completedBlockIds: Set`).
- **Цвета статусов блока в навигации**: зелёный ✓ — завершён, синий — активный, фиолетовый со свечением — в фокусе учителя, белый — не начат.
- **Прогресс по урокам/модулям**: dashboard парсит названия уроков «Модуль X.Y», считает `completed/total`. Таблицы прогресса: `lesson_completions` (progress_percent, status, last_accessed_at).

## 2. Что меняем для нового проекта

- Материалы выносим в **отдельную вкладку** (не приклеиваем к заметкам) → 4 вкладки: **Навигация · Материалы · Заметки · ИИ**.
- Прогресс по урокам считаем не из парсинга названий, а из таблицы **`lesson_progress`** (см. `01`) + структуры curriculum.
- Поблочный прогресс выводим из `responses` (что реально отвечено) + smart-progression для пассивных блоков.

## 3. Раскладка правой панели

```
┌───────── live screen ─────────────────────────────┐
│ Sidebar │   Center Stage          │  Right Panel    │
│ (nav)   │   видео/стрим           │  ┌───────────┐  │
│         │   + блоки тетради       │  │ tabs:     │  │
│         │   (focused блок         │  │ Навигация │  │
│         │    подсвечен)           │  │ Материалы │  │
│         │                         │  │ Заметки   │  │
│         │                         │  │ ИИ        │  │
│         │                         │  └───────────┘  │
└───────────────────────────────────────────────────┘
```

Компоненты фронта:

```
apps/web/src/components/live/
├── RightPanel.tsx          # контейнер вкладок
├── NavigationTab.tsx       # структура урока + прогресс по блокам
├── MaterialsTab.tsx        # см. 07-materials.md
├── NotesTab.tsx            # заметки ученика (автосейв)
└── TutorTab.tsx            # ИИ-чат (см. 05)
```

## 4. Поблочный прогресс (вкладка «Навигация»)

### Что считается завершённым

| Тип блока | Когда «завершён» |
|---|---|
| `text`, `image` | авто, если ученик прошёл дальше (smart progression) |
| `input_text`, `input_select`, `input_rating`, `input_file` | есть ответ в `responses` с `is_completed=true` |
| `test` | ответ дан (опц. — правильный) |
| `action_button` | нажата кнопка (записывается как response) |

### Вычисление статусов (клиент)

```ts
// apps/web/src/lib/progress.ts
type BlockState = 'completed' | 'active' | 'focused' | 'pending';

function computeBlockStates(blocks: Block[], answered: Set<string>,
  activeBlockId: string, focusedBlockId: string | null): Map<string, BlockState> {
  const states = new Map<string, BlockState>();
  const lastAnsweredIdx = lastIndexWith(blocks, (b) => answered.has(b.id));
  blocks.forEach((b, i) => {
    if (b.id === focusedBlockId) states.set(b.id, 'focused');      // приоритет фокуса учителя
    else if (b.id === activeBlockId) states.set(b.id, 'active');
    else if (answered.has(b.id)) states.set(b.id, 'completed');
    else if (isPassive(b) && i < lastAnsweredIdx) states.set(b.id, 'completed'); // smart progression
    else states.set(b.id, 'pending');
  });
  return states;
}
```

`answered` наполняется из `responses` (загрузка при входе + событие `response:updated` по WS из `04`). `focusedBlockId` — из события `focus:changed`. Клик по элементу навигации скроллит к блоку в Center Stage.

### Прогресс урока в процентах

```ts
const interactive = blocks.filter(isInteractive);
const done = interactive.filter((b) => answered.has(b.id)).length;
const progressPercent = interactive.length ? Math.round(done / interactive.length * 100) : 0;
```

Этот процент — то, что уходит в `lesson_progress.progressPercent` (см. ниже).

## 5. Синхронизация прогресса с бэком

Поблочный прогресс живёт на клиенте в реальном времени, но **сводку по уроку** надо персистить — для curriculum-галочек и аналитики.

Когда обновлять `lesson_progress`:
- при входе в урок → `status='in_progress'`, `lastAccessedAt=now()` (+ запись в `activity_logs` action `lesson_started`);
- по ходу (debounced, раз в N секунд) → обновляем `progressPercent`;
- при завершении (все интерактивные блоки отвечены ИЛИ учитель закрыл сессию) → `status='completed'`, `progressPercent=100`, `completedAt=now()` (+ `activity_logs` `lesson_completed`).

```ts
// apps/api/src/progress/progress.service.ts
async upsert(userId: string, lessonId: string, percent: number) {
  const status = percent >= 100 ? 'completed' : 'in_progress';
  await this.db.insert(lessonProgress)
    .values({ userId, lessonId, progressPercent: percent, status,
              lastAccessedAt: new Date(),
              completedAt: status === 'completed' ? new Date() : null })
    .onConflictDoUpdate({
      target: [lessonProgress.userId, lessonProgress.lessonId],
      set: { progressPercent: percent, status, lastAccessedAt: new Date(),
             completedAt: status === 'completed' ? new Date() : undefined },
    });
}
```

Эндпоинт: `PUT /lessons/:id/progress { percent }` (роль — авторизованный ученик).

> Важно: прогресс пишем только для авторизованных `User`. Гость-`participant` без аккаунта в аналитику по компании не попадает — это сознательно (нельзя приписать прогресс анониму). Если нужен прогресс и для гостей — заводи им лёгкий аккаунт при join.

## 6. Навигация по курсу (Sidebar + Syllabus)

- **Sidebar** (`apps/web/src/components/layout/Sidebar.tsx`): основные разделы (Дашборд, Программа, Тетрадь, live-индикатор), пункты по роли.
- **Дашборд ученика**: «карта пути» по модулям/урокам с процентами из `lesson_progress`. Источник — `GET /curriculum` (дерево) + merge прогресса (см. `03`, `curriculumForStudent`).
- **Syllabus** (`/syllabus`): полная программа с outcomes; для авторизованного ученика подсвечивает завершённые уроки галочками (тот же merge).

### Дерево с прогрессом для ученика

```ts
GET /curriculum  (ученик) →
{
  modules: [{
    code: 'M1', title,
    progressPercent: 40,                 // среднее по урокам модуля
    lessons: [
      { id, title, status: 'completed', progressPercent: 100 },
      { id, title, status: 'in_progress', progressPercent: 30 },
      { id, title, status: 'not_started', progressPercent: 0 },
    ],
  }]
}
```

Процент модуля — среднее (или взвешенное по числу блоков) по его урокам. Считается на бэке в `curriculumForStudent`, чтобы фронт просто рисовал.

## 7. Чек-лист

- [ ] Правая панель: 4 вкладки (Навигация · Материалы · Заметки · ИИ).
- [ ] Поблочные статусы (completed/active/focused/pending) из `responses` + smart progression.
- [ ] Процент урока из интерактивных блоков; `PUT /lessons/:id/progress`.
- [ ] `lesson_progress` обновляется на входе / по ходу / на завершении + записи в `activity_logs`.
- [ ] Curriculum-дерево возвращает прогресс по урокам и модулям для ученика.
- [ ] Прогресс пишется только для авторизованных пользователей (гости — опц.).
