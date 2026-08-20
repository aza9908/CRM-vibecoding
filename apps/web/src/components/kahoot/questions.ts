/**
 * Question bank for the live quiz — the seven `test` blocks from the Day-1
 * «Вайб-кодинг с Claude» workbook, in deck order.
 *
 * Kept in sync with `apps/api/src/db/workbook-day1.ts` on purpose: the quiz is
 * the workshop's own material played as a game, not filler content, so a
 * participant recognises every question from the session they just sat through.
 */

export interface QuizQuestion {
  /** Where in the deck this question comes from, for the host caption. */
  block: string;
  question: string;
  /** Exactly four, to match the four answer shapes. */
  answers: [string, string, string, string];
  correctIndex: 0 | 1 | 2 | 3;
  /** Seconds on the clock. Kahoot's default is 20. */
  timeLimit: number;
}

export const QUIZ_QUESTIONS: QuizQuestion[] = [
  {
    block: 'Блок 1 · Теория',
    question:
      'Нужны свежие факты со ссылками на источники — какой инструмент выбрать?',
    answers: ['Claude', 'Perplexity', 'Gemini', 'ChatGPT'],
    correctIndex: 1,
    timeLimit: 20,
  },
  {
    block: 'Блок 1 · Теория',
    question: 'Собрать документ, приложение или длинный текст — что лучше подходит?',
    answers: ['Claude', 'Perplexity', 'Gamma', 'NotebookLM'],
    correctIndex: 0,
    timeLimit: 20,
  },
  {
    block: 'Блок 1 · Токены',
    question: 'Что такое токены?',
    answers: [
      'Пароли доступа к модели',
      'Кусочки текста, из которых ИИ собирает запрос и ответ',
      'Деньги за подписку',
      'Названия моделей',
    ],
    correctIndex: 1,
    timeLimit: 25,
  },
  {
    block: 'Блок 1 · Контекстное окно',
    question: 'Что делать, когда контекстное окно переполняется?',
    answers: [
      'Ничего, модель всё помнит вечно',
      'Новая задача — новый чат, важное повторять явно',
      'Перезагрузить компьютер',
      'Писать капслоком',
    ],
    correctIndex: 1,
    timeLimit: 25,
  },
  {
    block: 'Блок 2 · Промпт-инжиниринг',
    question: 'Какого элемента НЕ хватает в промпте «Расскажи про отчёт»?',
    answers: [
      'Всё на месте',
      'Роли, контекста, задачи, формата и стиля — почти всех',
      'Только эмодзи',
      'Только длины',
    ],
    correctIndex: 1,
    timeLimit: 25,
  },
  {
    block: 'Блок 4 · Claude Code',
    question: 'Где в Claude Code вы ставите задачу агенту?',
    answers: [
      'В терминале командой',
      'Обычными словами в панели Claude Code',
      'В настройках VS Code',
      'В браузере',
    ],
    correctIndex: 1,
    timeLimit: 20,
  },
  {
    block: 'Блок 5 · ИИ-агенты',
    question: 'Чем агент отличается от обычного чата с моделью?',
    answers: [
      'Ничем',
      'У агента есть инструменты — он не только отвечает, но и делает',
      'Агент работает без модели',
      'Агент дешевле',
    ],
    correctIndex: 1,
    timeLimit: 20,
  },
];
