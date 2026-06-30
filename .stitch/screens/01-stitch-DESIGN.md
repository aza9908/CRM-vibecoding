---
name: "LMS — Live Lessons & Workbook"
description: "B2B LMS with live lessons, a session-code workbook, and a Socratic AI mentor. Extracted from the codebase (globals.css, tailwind.config.ts, shadcn/ui component variants, messages/ru.json)."
# Tokens below are the literal values resolved from src/app/globals.css (HSL CSS
# custom properties → hex) and tailwind.config.ts. Nothing here is invented.
colors:
  background: "#FFFFFF"          # --background 0 0% 100%
  foreground: "#020817"          # --foreground 222.2 84% 4.9%
  primary: "#0F172A"             # --primary 222.2 47.4% 11.2% (slate-900) — main actions
  primary-foreground: "#F8FAFC"  # --primary-foreground 210 40% 98%
  secondary: "#F1F5F9"           # --secondary 210 40% 96.1% (slate-100)
  secondary-foreground: "#0F172A"
  muted: "#F1F5F9"               # --muted (slate-100)
  muted-foreground: "#64748B"    # --muted-foreground 215.4 16.3% 46.9% (slate-500)
  accent: "#F1F5F9"              # --accent (slate-100) — hover surfaces
  card: "#FFFFFF"                # --card
  border: "#E2E8F0"              # --border 214.3 31.8% 91.4% (slate-200)
  input: "#E2E8F0"               # --input
  ring: "#020817"                # --ring 222.2 84% 4.9% — focus ring
  error: "#EF4444"               # --destructive 0 84.2% 60.2% (red-500)
  on-error: "#F8FAFC"            # --destructive-foreground
  success: "#10B981"             # emerald-500 — Badge variant=success, "Подключено", "Скопировано"
  warning: "#F59E0B"             # amber-500 — rating block (input_rating)
typography:
  font-family-sans: "Inter, var(--font-sans), ui-sans-serif, system-ui, sans-serif"   # next/font Inter, subsets latin+cyrillic
  font-family-mono: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"        # Tailwind default font-mono (session code)
  page-title:                    # text-2xl font-bold — "Уроки", "Редактор урока"
    fontFamily: Inter
    fontSize: 24px
    fontWeight: 700
    lineHeight: 32px
  section-title:                 # text-xl font-semibold — "Управление уроком"
    fontFamily: Inter
    fontSize: 20px
    fontWeight: 600
    lineHeight: 28px
  card-title:                    # CardTitle: text-lg font-semibold tracking-tight
    fontFamily: Inter
    fontSize: 18px
    fontWeight: 600
    lineHeight: 24px
    letterSpacing: "-0.015em"
  body:                          # workbook block text
    fontFamily: Inter
    fontSize: 16px
    fontWeight: 400
    lineHeight: 24px
  ui:                            # buttons, inputs, table cells, descriptions: text-sm
    fontFamily: Inter
    fontSize: 14px
    fontWeight: 400
    lineHeight: 20px
  label:                         # Badge / labels: text-xs font-semibold
    fontFamily: Inter
    fontSize: 12px
    fontWeight: 600
    lineHeight: 16px
  code:                          # SessionCode: font-mono text-2xl font-bold tracking-[0.3em]
    fontFamily: "ui-monospace"
    fontSize: 24px
    fontWeight: 700
    letterSpacing: "0.3em"
rounded:                         # tailwind.config.ts borderRadius (--radius = 0.5rem)
  sm: 4px                        # calc(--radius - 4px)
  md: 6px                        # calc(--radius - 2px) — buttons, inputs
  lg: 8px                        # --radius — cards
  full: 9999px                   # badges, avatars
spacing:
  base: 4px                      # Tailwind 4px scale
  container-padding: 24px        # container.padding 1.5rem
  container-max: 1400px          # container.screens.2xl
  card-padding: 24px             # Card* p-6
elevation:
  card: "0 1px 2px 0 rgb(0 0 0 / 0.05)"   # shadow-sm (the only elevation in use)
dark:                            # .dark block in globals.css
  background: "#020817"          # 222.2 84% 4.9%
  foreground: "#F8FAFC"          # 210 40% 98%
  primary: "#F8FAFC"             # inverted: light primary on dark
  primary-foreground: "#0F172A"
  secondary: "#1E293B"           # 217.2 32.6% 17.5% (slate-800)
  muted-foreground: "#94A3B8"    # 215 20.2% 65.1% (slate-400)
  border: "#1E293B"
  ring: "#CBD5E1"                # 212.7 26.8% 83.9% (slate-300)
  error: "#7F1D1D"               # 0 62.8% 30.6%
---

# LMS — Live Lessons & Workbook · Design System

> **Source of truth.** This file was reverse-engineered from the running codebase, not
> authored from a template. Every token traces to a real value:
> colors → `apps/web/src/app/globals.css` (HSL CSS variables), radius/container →
> `apps/web/tailwind.config.ts`, component rules → the shadcn/ui CVAs in
> `apps/web/src/components/ui/*`, fonts → `app/[locale]/layout.tsx`, and copy →
> `apps/web/src/messages/ru.json`. If the repo doesn't contain it, it isn't here.

## Overview

A B2B LMS centered on **live lessons** (`B2B LMS — live-уроки и рабочая тетрадь`). A
teacher launches a lesson; students join by a **6-character session code**; everyone
works in a shared **workbook** of typed blocks; the teacher focuses one block in real
time and watches answers arrive; an **AI mentor** (`ИИ-наставник`) guides with leading
questions and never hands over the answer.

The implemented look is the **shadcn/ui "slate" system**: white surfaces, a near-black
primary, slate-gray neutrals, and a single accent — **emerald** — reserved for the
"live" moments (connected, copied, completed). It is deliberately **quiet and
content-first**: hairline borders and one soft `shadow-sm`, no gradients, no second
brand hue. The product is bilingual-plus (`ru` default, `kk`, `en`), so layouts must
tolerate variable string lengths.

Design in one line: **white slate surfaces, near-black ink, emerald for "live."**

## Colors

Resolved from the CSS custom properties in `globals.css`.

| Token | Light | Role (where it appears) |
|---|---|---|
| **background / card** | `#FFFFFF` | Page and card backgrounds |
| **foreground** | `#020817` | Primary text & headings; also the focus **ring** |
| **primary** | `#0F172A` | Primary buttons (`Запустить live`, `Новый урок`), active emphasis |
| **primary-foreground** | `#F8FAFC` | Text on primary |
| **secondary / muted / accent** | `#F1F5F9` | Secondary buttons, chips, hover rows, muted panels |
| **muted-foreground** | `#64748B` | Secondary text, captions, placeholders |
| **border / input** | `#E2E8F0` | 1px hairlines, dividers, input borders |
| **error** (`destructive`) | `#EF4444` | `Завершить урок`, delete, validation |
| **success** | `#10B981` | `Badge variant=success`, `Подключено`, `Скопировано`, completed |
| **warning** | `#F59E0B` | Rating block (`input_rating`) |

Usage (as implemented):
- **Primary is near-black, not a hue.** It carries the one important action per region
  (`bg-primary` + `hover:bg-primary/90`). Everything else is `secondary`/`outline`/`ghost`.
- **Emerald is the only saturated accent**, and it means *alive*: a live connection,
  a copied code, a completed item. Don't spend it on generic success toasts.
- **Red is destruction/error only** (`Завершить урок`, `Удалить`, field errors).
- Dark mode (`.dark`) inverts: background `#020817`, light primary `#F8FAFC`,
  slate-800 borders.

## Typography

**Inter** (`next/font`, subsets `latin` + `cyrillic`, `--font-sans`), `antialiased`.
The session code uses the default `font-mono` stack. Scale as actually used in the app:

- **Page title — 24/700** (`text-2xl font-bold`): `Уроки`, `Редактор урока`.
- **Section title — 20/600** (`text-xl font-semibold`): `Управление уроком`.
- **Card title — 18/600, tight tracking** (`text-lg font-semibold tracking-tight`).
- **Body — 16/400**: workbook block text (the reading surface).
- **UI — 14/400** (`text-sm`): buttons, inputs, table cells, `CardDescription`.
- **Label — 12/600** (`text-xs font-semibold`): badges, eyebrows.
- **Code — 24/700 mono, `0.3em` tracking**: the session code — the most scannable
  element on the teacher's live screen.

Cyrillic is first-class (Inter cyrillic subset is loaded) — never assume Latin widths.

## Spacing, radius & elevation

- **4px spacing grid** (Tailwind). Cards pad `24px` (`p-6`); the page sits in a
  **centered container, `24px` gutter, max `1400px`** (`container` config).
- **Radius:** `4px` (sm) · `6px` (md → buttons, inputs) · `8px` (lg → cards) · `full`
  (badges, avatars). `--radius` = `0.5rem`. Don't introduce other radii or mix sharp
  with rounded in one view.
- **Elevation:** the only shadow in use is `shadow-sm` on cards. Everything else is
  flat, separated by `border` + surface contrast. Reserve heavier shadow for
  popovers/modals if added later.

## Components (as built — shadcn/ui)

- **Button** (`rounded-md` 6px, `h-10`, `text-sm font-medium`, `gap-2`, 16px icons,
  `focus-visible:ring-2 ring-ring`):
  - `default` — `bg-primary` near-black, `hover:bg-primary/90` (the main CTA).
  - `secondary` — `bg-secondary` slate-100, `hover:/80`.
  - `outline` — `border-input` + `bg-background`, `hover:bg-accent`.
  - `ghost` — transparent, `hover:bg-accent` (icon/tertiary actions).
  - `destructive` — `bg-destructive` red (`Завершить урок`).
  - `link` — `text-primary underline-offset-4`.
  - Sizes: `default h-10 px-4` · `sm h-9 px-3` · `lg h-11 px-8` · `icon 10×10`.
- **Card** (`rounded-lg`, `border`, `bg-card`, `shadow-sm`): `CardHeader p-6 space-y-1.5`,
  `CardTitle text-lg font-semibold`, `CardDescription text-sm text-muted-foreground`,
  `CardContent p-6 pt-0`. Lesson cards and the auth/join cards follow this.
- **Input** (`h-10`, `rounded-md`, `border-input`, `bg-background`, `px-3 py-2`,
  `text-sm`, placeholder in `muted-foreground`, `focus-visible:ring-2 ring-ring`).
- **Badge** (`rounded-full`, `border`, `px-2.5 py-0.5`, `text-xs font-semibold`):
  `default` (primary), `secondary` (lesson-type chips: `Видео`/`Трансляция`/`Текст`),
  `destructive`, `outline`, **`success`** (`bg-emerald-500 text-white`).

## Domain patterns (real screens & terminology)

### Live session (`live.*`)
- **Session code** (`Код сессии`) is the hero of `/teacher/live`: big mono, `0.3em`
  tracking, a copy button (`Копировать` → `Скопировано`), caption `Поделитесь кодом с
  учениками`.
- **Connection** indicator: emerald dot + `Подключено` (else `Подключение…` /
  `Соединение потеряно`).
- **Focus** (`Сфокусировать блок` / `В фокусе`): the teacher focuses exactly one block;
  students highlight it and auto-scroll. (Current highlight is a card emphasis — the
  brand has no second hue, so keep it within primary/border, e.g. a ring/left-border.)
- **Participants** (`Участники`, empty: `Пока никто не подключился`) and **Answers**
  (`Ответы`, empty: `Ответов пока нет`) are the two live columns on desktop.
- **End**: `Завершить урок` (destructive) → `Урок завершён`.

### Workbook blocks (`editor.*`)
Eight types, one card rhythm: `Текст`, `Изображение`, `Поле ввода`, `Выбор варианта`,
`Оценка` (amber), `Кнопка действия`, `Загрузка файла`, `Тест`. In the editor they are
drag-and-drop sortable (`Перетащите, чтобы изменить порядок`) with
`Добавить блок` / `Сгенерировать с ИИ` / `Опубликовать` (→ `Опубликовано`,
autosave `Черновик сохранён`).

### AI mentor (`ai.*`)
`ИИ-наставник`, intro `Я помогу наводящими вопросами, но не дам готовый ответ.`
A calm chat panel: `Наставник` vs `Вы`, placeholder `Спросите наставника…`, streaming
state `Думаю…`. The restraint *is* the pedagogy — no flashy "AI" gradient.

### Join (`join.*`)
`Вход на урок` · `Введите код сессии и ваше имя` · code placeholder `ABC123` · `Войти`.
Code input is large and uppercase; failure shows `Сессия не найдена или завершена`.

## Accessibility

- The built theme meets WCAG AA: `#020817`/`#0F172A` on white and `#F8FAFC` on
  `#0F172A` both pass; `muted-foreground #64748B` on white passes for ≥14px.
- Visible **2px focus ring** (`ring-ring`, near-black) on every interactive element.
- Status is never color-only — pair emerald/red with a dot + label (`Подключено`,
  not just a green dot).
- Tap targets ≥ 40px (`h-10`); the session code and join inputs are oversized for
  mobile students.

## Do's and Don'ts

- **Do** keep one near-black primary action per region; demote the rest to secondary/outline/ghost.
- **Do** reserve emerald for "live/connected/done" and red for destruction/error.
- **Do** stay flat: hairline `border` + `shadow-sm`, never gradients or heavy shadow.
- **Do** make the session code and the focused block the most scannable things on screen.
- **Don't** add a second brand hue (no indigo/blue) — the system is intentionally monochrome + emerald.
- **Don't** mix corner radii or step outside `4 / 6 / 8 / full`.
- **Don't** hard-code element widths — `ru` / `kk` / `en` strings differ in length.
- **Don't** drop UI text below 14px or body below 16px.