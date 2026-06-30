# 05 — ИИ-ассистент (Groq + стриминг)

> Сократический наставник в рабочей тетради. Провайдер — Groq (быстрый инференс, OpenAI-совместимый API), но через абстракцию, чтобы можно было переключить на Claude/OpenAI без переписывания.

## 1. Как сейчас (Supabase-проект)

- Эндпоинт `POST /api/agent` (Next.js route).
- Логика: проверка auth → загрузка промпта (`src/ai/prompts/student.md` или `teacher.md`) → инъекция контекста задачи (код/ответ ученика, контент блока) → запрос во внешний webhook **Freedom AI** (`ai-platform-connect.kassen.space`) с `execution_mode: 'sync'`.
- История диалогов — таблица `ai_chats` (`messages` JSONB).
- Промпт ученика: сократический метод, не давать готовый код, максимум 3 предложения, только текст.

## 2. Что меняется

Тот же поток, но:
- провайдер — **Groq** через OpenAI-совместимый SDK;
- ответ — **стримим через SSE**, чтобы ученик видел текст по мере генерации;
- логика живёт в NestJS-модуле `ai/` с интерфейсом провайдера.

## 3. Модуль AI (NestJS)

```
apps/api/src/ai/
├── ai.module.ts
├── ai.controller.ts        # POST /ai/chat (SSE), POST /lessons/:id/blocks/generate
├── ai.service.ts           # сборка промпта + история + сохранение в ai_chats
├── providers/
│   ├── llm-provider.interface.ts
│   ├── groq.provider.ts    # OpenAI-совместимый клиент на base_url Groq
│   └── claude.provider.ts  # (опционально) на будущее
└── prompts/
    ├── student.md
    └── teacher.md
```

### Интерфейс провайдера (абстракция)

```ts
// providers/llm-provider.interface.ts
export interface ChatMessage { role: 'system' | 'user' | 'assistant'; content: string; }

export interface LlmProvider {
  /** возвращает асинхронный поток токенов */
  stream(messages: ChatMessage[], opts?: { model?: string; temperature?: number }): AsyncIterable<string>;
}
export const LLM_PROVIDER = Symbol('LLM_PROVIDER');
```

### Groq-провайдер (OpenAI-совместимый)

Groq отдаёт OpenAI-совместимый endpoint, поэтому используем `openai` SDK с другим `baseURL`:

```ts
// providers/groq.provider.ts
import OpenAI from 'openai';

@Injectable()
export class GroqProvider implements LlmProvider {
  private client = new OpenAI({
    apiKey: process.env.GROQ_API_KEY,
    baseURL: 'https://api.groq.com/openai/v1',
  });

  async *stream(messages: ChatMessage[], opts?) {
    const res = await this.client.chat.completions.create({
      model: opts?.model ?? 'llama-3.3-70b-versatile',
      temperature: opts?.temperature ?? 0.4,
      messages,
      stream: true,
    });
    for await (const chunk of res) {
      const delta = chunk.choices[0]?.delta?.content;
      if (delta) yield delta;
    }
  }
}
```

> Модель указана как пример — конкретную выбери в консоли Groq. Поскольку провайдер за интерфейсом, смена на Claude (`@anthropic-ai/sdk`) или OpenAI — это новый класс + смена биндинга в модуле, контроллер не трогаем.

В `ai.module.ts` биндим выбранного провайдера:

```ts
providers: [
  AiService,
  { provide: LLM_PROVIDER, useClass: GroqProvider },
],
```

## 4. Сборка промпта и контекста

Повторяем подход текущего проекта: системный промпт из `.md`-файла + инъекция контекста урока.

```ts
// ai.service.ts (фрагмент)
async buildMessages(input: {
  role: 'student' | 'teacher';
  userMessage: string;
  blockContent?: string;     // контент текущего блока
  taskContext?: string;      // ответ/код ученика
  history: ChatMessage[];
}): Promise<ChatMessage[]> {
  const tmpl = await this.loadPrompt(input.role); // читает prompts/{role}.md
  const system = tmpl
    .replace('{{BLOCK_CONTENT}}', input.blockContent ?? '')
    .replace('{{TASK_CONTEXT}}', input.taskContext ?? '');
  return [
    { role: 'system', content: system },
    ...input.history.slice(-10),       // ограничиваем окно
    { role: 'user', content: input.userMessage },
  ];
}
```

### Пример `prompts/student.md`

```md
Ты — наставник, работающий по сократическому методу.
Правила:
- Никогда не давай готовый код или прямой ответ.
- Задавай наводящие вопросы, веди ученика к решению сам.
- Максимум 3 предложения. Только обычный текст, без markdown-блоков кода.

Контекст блока, над которым работает ученик:
{{BLOCK_CONTENT}}

Текущая работа/ответ ученика:
{{TASK_CONTEXT}}
```

## 5. Стриминг через SSE

NestJS умеет SSE через `@Sse` или ручной `res.write`. Для чата с историей удобнее ручной режим:

```ts
// ai.controller.ts
@Post('ai/chat')
@UseGuards(JwtAuthGuard) // ученик авторизован
async chat(@CurrentUser() user, @Body() dto: ChatDto, @Res() res: Response) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const messages = await this.ai.buildMessages({ role: 'student', ...dto, history: dto.history });

  let full = '';
  for await (const token of this.llm.stream(messages)) {
    full += token;
    res.write(`data: ${JSON.stringify({ token })}\n\n`);
  }
  await this.ai.persistChat(user.sub, dto.lessonId, dto.userMessage, full); // в ai_chats
  res.write('data: [DONE]\n\n');
  res.end();
}
```

Фронт читает SSE и дописывает токены в пузырь ответа:

```ts
const res = await fetch('/api/ai/chat', { method: 'POST', body: JSON.stringify(payload) });
const reader = res.body!.getReader();
// парсим строки data: ... и обновляем UI по мере прихода токенов
```

## 6. AI-генерация блоков урока

Аналог `/api/generate-workbook` из текущего проекта. Учитель описывает тему → LLM возвращает **структурированный JSON блоков**, который мы валидируем и вставляем.

```ts
@Post('lessons/:id/blocks/generate')
@UseGuards(JwtAuthGuard, RolesGuard) @Roles('teacher')
async generate(@Param('id') lessonId: string, @Body() dto: { topic: string }) {
  const json = await this.ai.generateBlocks(dto.topic); // просим вернуть массив блоков
  const blocks = WorkbookSchema.parse(json);            // zod-валидация структуры
  return this.blocks.saveBlocks(orgId, lessonId, blocks.map(b => ({ ...b, generatedBy: 'ai' })));
}
```

Здесь лучше использовать модель с устойчивым JSON-выводом и просить строго JSON-схему (или function/tool calling, если провайдер поддерживает). Всегда валидируй ответ через zod перед записью в БД.

## 7. Защита и стоимость

- **Rate-limit** на `/ai/chat` per-user (Redis): например, 20 запросов/мин.
- **Лимит окна истории** (последние ~10 сообщений) — экономит токены и время.
- **Таймаут** на стрим (например, 30 с) и аккуратное закрытие соединения.
- **Ключи** (`GROQ_API_KEY`) только на бэке, никогда не на клиенте.
- Логируй токены/латентность для контроля расходов.

## 8. Чек-лист

- [ ] Интерфейс `LlmProvider` + `GroqProvider` (OpenAI SDK на baseURL Groq).
- [ ] Промпты `student.md` / `teacher.md` с инъекцией контекста.
- [ ] SSE-эндпоинт `/ai/chat` + сохранение в `ai_chats`.
- [ ] AI-генерация блоков с zod-валидацией.
- [ ] Rate-limit + ограничение окна истории.
- [ ] Провайдер легко меняется на Claude/OpenAI (только биндинг в модуле).
