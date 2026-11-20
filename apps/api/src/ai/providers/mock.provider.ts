import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';

import {
  LLM_TASK_MARKER,
  type ChatMessage,
  type LlmProvider,
  type LlmStreamOptions,
  type TranscribeInput,
  type TranscribeResult,
} from './llm-provider.interface';

/**
 * Offline stand-in for the real LLM vendor.
 *
 * Bound instead of {@link GroqProvider} when `LLM_PROVIDER=mock`, or when no
 * `GROQ_API_KEY` is configured (local development, CI, end-to-end tests) —
 * see `ai.module.ts`. It makes the «ИИ-разбор урока» pipeline runnable
 * without a vendor: `transcribe` returns a fixed timed transcript and
 * `complete` returns canned JSON for the two analysis prompts (recognised by
 * their {@link LLM_TASK_MARKER}). Everything else behaves like an
 * unconfigured vendor did before: a clear 503.
 */
@Injectable()
export class MockLlmProvider implements LlmProvider {
  private readonly logger = new Logger(MockLlmProvider.name);

  constructor() {
    this.logger.warn(
      'Mock LLM provider is active (no GROQ_API_KEY or LLM_PROVIDER=mock): ' +
        'lesson analysis and AI reports return canned data, chat/generation answer 503.',
    );
  }

  private notConfigured(): never {
    throw new ServiceUnavailableException('LLM provider is not configured.');
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars, require-yield
  async *stream(
    _messages: ChatMessage[],
    _opts?: LlmStreamOptions,
  ): AsyncIterable<string> {
    this.notConfigured();
  }

  async complete(messages: ChatMessage[]): Promise<string> {
    const system = messages.find((m) => m.role === 'system')?.content ?? '';
    if (system.includes(LLM_TASK_MARKER.analysisNotes)) {
      return JSON.stringify(MOCK_NOTES);
    }
    if (system.includes(LLM_TASK_MARKER.analysisReport)) {
      return JSON.stringify(MOCK_REPORT);
    }
    const user = messages.filter((m) => m.role === 'user').at(-1)?.content ?? '';
    if (system.includes(LLM_TASK_MARKER.answersQuestions)) return JSON.stringify(mockAnswersQuestions(user));
    if (system.includes(LLM_TASK_MARKER.answersFeedback)) return JSON.stringify(mockAnswersFeedback(user));
    if (system.includes(LLM_TASK_MARKER.answersSummary)) return JSON.stringify(mockAnswersSummary(user));
    if (system.includes(LLM_TASK_MARKER.curatorReport)) {
      return JSON.stringify(mockCuratorReport(user, !system.includes('leave it as an empty array')));
    }
    if (system.includes(LLM_TASK_MARKER.curatorSteps)) {
      return JSON.stringify({ learnerSteps: mockSteps(user) });
    }
    this.notConfigured();
  }

  async transcribe(input: TranscribeInput): Promise<TranscribeResult> {
    if (input.audio.length === 0) {
      return { text: '', segments: [], durationSec: 0, language: null };
    }
    return {
      text: MOCK_SEGMENTS.map((s) => s.text).join(' '),
      segments: MOCK_SEGMENTS,
      durationSec: 95,
      language: 'ru',
    };
  }
}

const MOCK_SEGMENTS = [
  { start: 0, end: 12, text: 'Здравствуйте, коллеги. Сегодня мы строим мини-проект с ИИ за семь шагов.' },
  { start: 12, end: 31, text: 'Первый шаг — идея на одну страницу: какую боль решаем и для кого.' },
  { start: 31, end: 52, text: 'Дальше пишем PRD. Плохой критерий — «удобно записывать пациентов», хороший — запись занимает меньше минуты.' },
  { start: 52, end: 70, text: 'Вопрос из чата: а где хранить ключи? Отвечаю: только в файле .env, в git они не попадают.' },
  { start: 70, end: 95, text: 'Всё понятно? Тогда делаем первое упражнение и фиксируем результат коммитом.' },
];

const MOCK_NOTES = {
  topics: ['Идея проекта', 'PRD и проверяемые критерии', 'Ключи и .env'],
  explainedWell: [{ at: '00:31', note: 'Пример плохого и хорошего критерия в PRD.' }],
  unclear: [{ at: '00:12', note: 'Шаг «идея» пройден быстро, без примера от участников.' }],
  studentQuestions: [{ at: '00:52', text: 'Где хранить ключи?' }],
  pace: 'быстрый',
  offTopic: [],
};

const MOCK_REPORT = {
  summary:
    'Короткий вводный фрагмент урока о мини-проекте с ИИ: идея, PRD и работа с ключами. Объяснение структурное, с примерами; участников слышно мало.',
  score: { overall: 7, clarity: 8, structure: 8, engagement: 5, pace: 6, practice: 6 },
  strengths: [
    {
      title: 'Понятный пример критерия в PRD',
      evidence: '«Плохой критерий — удобно записывать пациентов, хороший — запись занимает меньше минуты».',
      at: '00:31',
    },
    {
      title: 'Ответ на вопрос из чата по ходу урока',
      evidence: 'Вопрос про хранение ключей разобран сразу, с конкретным правилом про .env.',
      at: '00:52',
    },
  ],
  weaknesses: [
    {
      title: 'Мало вовлечения участников',
      evidence: 'За весь фрагмент прозвучал один вопрос, говорит почти только преподаватель.',
      at: '00:12',
      fix: 'После шага «идея» попросите двух участников назвать свою идею вслух или запустите «Пульс класса».',
    },
  ],
  timeline: [
    { from: '00:00', to: '00:31', topic: 'Вступление и идея проекта' },
    { from: '00:31', to: '00:52', topic: 'PRD: проверяемые критерии', note: 'Сильный пример.' },
    { from: '00:52', to: '01:35', topic: 'Ключи, .env и первое упражнение' },
  ],
  engagement: {
    teacherTalkShare: 92,
    studentQuestions: 1,
    pulse: 'Опросов «Пульс класса» в этом фрагменте не было.',
    passive: [],
  },
  recommendations: [
    'Запускайте «Пульс класса» после каждого шага, а не только в конце.',
    'Дайте участникам 2 минуты на свою идею до перехода к PRD.',
    'Перед упражнением проговорите критерий готовности.',
  ],
  quotes: [{ at: '00:31', text: 'Хороший критерий — запись занимает меньше минуты.' }],
};

// ── «ИИ-анализ ответов» / «ИИ-куратор»: canned answers built from the prompt ──
// They reuse the refs and anonymous labels that are present in the prompt, so
// the whole pipeline (mapping labels back to names, validation) is exercised.

/** Distinct labels like «Участник 3» found in a prompt, in order. */
function labelsIn(text: string, word: string): string[] {
  return [...new Set(text.match(new RegExp(`${word} \\d+`, 'g')) ?? [])];
}

function mockAnswersQuestions(prompt: string) {
  const refs = [...new Set(prompt.match(/^Q\d+/gm) ?? [])];
  return {
    questions: refs.map((ref) => {
      const block = prompt.slice(prompt.search(new RegExp(`^${ref} `, 'm')));
      const label = labelsIn(block.split(/\n\n/)[0] ?? '', 'Участник')[0];
      return {
        ref,
        title: `Вопрос ${ref.slice(1)}`,
        understood: 'Большинство участников уловили основную идею задания.',
        mistakes: ['Часть ответов слишком общие, без конкретного примера.'],
        bestAnswers: label ? [{ participant: label, quote: 'Конкретный пример из своей работы.' }] : [],
      };
    }),
  };
}

function mockAnswersFeedback(prompt: string) {
  return {
    feedback: labelsIn(prompt, 'Участник').map((participant, i) => ({
      participant,
      text: 'Вы хорошо сформулировали главную мысль. В следующий раз добавьте пример из своей практики.',
      needsHelp: i % 4 === 3,
    })),
  };
}

function mockAnswersSummary(prompt: string) {
  const weak = labelsIn(prompt, 'Участник').slice(0, 2);
  return {
    summary: 'Группа активно работала с тетрадью: большинство ответили на основные задания. Сложнее всего дались открытые вопросы, где нужен пример.',
    needHelp: weak.map((participant) => ({ participant, reason: 'Ответил меньше чем на половину заданий.' })),
    teacherTips: [
      'Начните следующий урок с разбора самого сложного вопроса на примере.',
      'Попросите молчавших участников поделиться ответом в чате.',
    ],
  };
}

function mockSteps(prompt: string) {
  return labelsIn(prompt, 'Ученик').map((learner) => ({
    learner,
    step: 'Завершить обязательные задания последнего урока до следующего занятия.',
  }));
}

function mockCuratorReport(prompt: string, withSteps: boolean) {
  const learners = labelsIn(prompt, 'Ученик');
  return {
    overview: {
      summary: 'Программа идёт по плану: участники посещают уроки и выполняют задания рабочей тетради.',
      attendance: 'Средняя посещаемость — по данным программы.',
      completion: 'Обязательные задания выполняет большая часть группы.',
      engagement: 'Активность стабильная, большинство отвечают в тетради.',
      trend: 'flat',
      trendNote: 'Данных пока немного, явного тренда нет.',
    },
    atRisk: learners.slice(-2).map((learner) => ({
      learner,
      reason: 'Пропустил последний урок и не выполнил обязательные задания.',
      nextStep: 'Позвонить и предложить запись урока.',
    })),
    topPerformers: learners.slice(0, 2).map((learner) => ({
      learner,
      why: 'Больше всех баллов и все обязательные задания выполнены.',
    })),
    trainerActions: [
      'Повторить ключевую тему последнего урока в начале следующего.',
      'Связаться с участниками, которые пропустили два урока подряд.',
    ],
    hrMessage:
      'Добрый день! Делимся промежуточными итогами программы обучения. Участники посещают занятия и выполняют задания рабочей тетради. Несколько человек пропустили последние уроки — мы свяжемся с ними и предложим записи. Предлагаем на следующей неделе короткую встречу, чтобы обсудить прогресс.',
    learnerSteps: withSteps ? mockSteps(prompt) : [],
  };
}
