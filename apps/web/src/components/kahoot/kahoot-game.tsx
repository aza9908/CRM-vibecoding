'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  ANSWER_STYLES,
  AnswerShape,
  CORRECT_GREEN,
  KAHOOT_PURPLE,
  WRONG_RED,
} from './shapes';
import { QUIZ_QUESTIONS } from './questions';
import {
  applyAnswer,
  createBots,
  createYou,
  generatePin,
  ranked,
  rollBotAnswer,
  type Player,
} from './players';
import { placeLabel, scoreAnswer } from './scoring';

/**
 * A recreation of Kahoot, playing the Day-1 workshop's own quiz questions.
 *
 * Built as the deliverable of the deck's «соберите прототип» prompt: the whole
 * game is one client component with no backend, so it can be opened, played and
 * screenshotted anywhere — which is the property that makes it usable as a
 * presentation artifact.
 *
 * The flow follows the real game: lobby with a PIN → «Get ready» countdown →
 * question with a shrinking clock and a live answer tally → reveal with the
 * distribution across the four options → scoreboard → podium.
 *
 * It runs single-device rather than host-plus-phones. Real Kahoot has this mode
 * too (solo/practice), and it is the only shape in which the recreation can be
 * demonstrated by one person.
 */

type Phase = 'lobby' | 'countdown' | 'question' | 'reveal' | 'scoreboard' | 'podium';

const COUNTDOWN_SECONDS = 3;
const REVEAL_MS = 4500;
/** How often the clock and the answer tally refresh. */
const TICK_MS = 100;

interface AnswerRecord {
  playerId: string;
  index: number;
  elapsedMs: number;
  applied: boolean;
}

export function KahootGame() {
  const [phase, setPhase] = useState<Phase>('lobby');
  // Minted after mount, not during render: a random PIN generated on the
  // server would not match the one the client generates, and React would
  // discard the whole tree over the mismatch.
  const [pin, setPin] = useState<string | null>(null);
  const [nickname, setNickname] = useState('');
  const [players, setPlayers] = useState<Player[]>([]);
  const [questionIndex, setQuestionIndex] = useState(0);
  const [countdown, setCountdown] = useState(COUNTDOWN_SECONDS);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [answers, setAnswers] = useState<AnswerRecord[]>([]);
  const [yourPick, setYourPick] = useState<number | null>(null);
  const [yourPoints, setYourPoints] = useState(0);

  const question = QUIZ_QUESTIONS[questionIndex]!;
  const timeLimitMs = question.timeLimit * 1000;
  const isLast = questionIndex === QUIZ_QUESTIONS.length - 1;

  // Bot answers are rolled once per question, then played back as the clock
  // passes each one — so the tally climbs during the question instead of
  // appearing all at once at the reveal.
  const plannedRef = useRef<{ playerId: string; index: number; elapsedMs: number }[]>([]);
  const startedAtRef = useRef(0);

  const you = players.find((p) => p.isYou) ?? null;

  useEffect(() => setPin(generatePin()), []);

  const startGame = useCallback(() => {
    const roster = [createYou(nickname), ...createBots()];
    setPlayers(roster);
    setQuestionIndex(0);
    setPhase('countdown');
    setCountdown(COUNTDOWN_SECONDS);
  }, [nickname]);

  /** Roll the room's answers and start the clock for the current question. */
  const beginQuestion = useCallback(() => {
    plannedRef.current = players
      .filter((p) => !p.isYou)
      .map((bot) => ({ playerId: bot.id, ...rollBotAnswer(bot, question.correctIndex, timeLimitMs) }));
    startedAtRef.current = Date.now();
    setElapsedMs(0);
    setAnswers([]);
    setYourPick(null);
    setYourPoints(0);
    setPhase('question');
  }, [players, question.correctIndex, timeLimitMs]);

  // Countdown → question.
  useEffect(() => {
    if (phase !== 'countdown') return;
    if (countdown <= 0) {
      beginQuestion();
      return;
    }
    const t = window.setTimeout(() => setCountdown((c) => c - 1), 800);
    return () => window.clearTimeout(t);
  }, [phase, countdown, beginQuestion]);

  // The question clock, and the bot answers landing as it passes them.
  useEffect(() => {
    if (phase !== 'question') return;
    const timer = window.setInterval(() => {
      const now = Date.now() - startedAtRef.current;
      setElapsedMs(now);
      setAnswers((prev) => {
        const landed = plannedRef.current.filter(
          (a) => a.elapsedMs <= now && !prev.some((p) => p.playerId === a.playerId),
        );
        if (landed.length === 0) return prev;
        return [...prev, ...landed.map((a) => ({ ...a, applied: false }))];
      });
      if (now >= timeLimitMs) {
        setPhase('reveal');
      }
    }, TICK_MS);
    return () => window.clearInterval(timer);
  }, [phase, timeLimitMs]);

  // Everyone has answered — no reason to keep the clock running. `answers`
  // includes the human's own pick, so the room is complete at `players.length`.
  useEffect(() => {
    if (phase !== 'question') return;
    if (yourPick !== null && answers.length >= players.length) {
      const t = window.setTimeout(() => setPhase('reveal'), 600);
      return () => window.clearTimeout(t);
    }
  }, [phase, yourPick, answers.length, players.length]);

  // Score everything once, on entering the reveal.
  useEffect(() => {
    if (phase !== 'reveal') return;
    setPlayers((prev) => {
      const order = ranked(prev);
      const next = prev.map((p) => ({
        ...p,
        lastPlace: order.findIndex((o) => o.id === p.id) + 1,
      }));
      for (const record of answers) {
        const player = next.find((p) => p.id === record.playerId);
        if (!player) continue;
        applyAnswer(
          player,
          record.index === question.correctIndex,
          record.elapsedMs,
          timeLimitMs,
        );
      }
      // Anyone who never answered breaks their streak.
      for (const player of next) {
        if (!answers.some((a) => a.playerId === player.id)) player.streak = 0;
      }
      return next;
    });
    const t = window.setTimeout(() => setPhase('scoreboard'), REVEAL_MS);
    return () => window.clearTimeout(t);
    // `answers` is frozen by the time the reveal starts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  function pick(index: number) {
    if (phase !== 'question' || yourPick !== null || !you) return;
    const elapsed = Date.now() - startedAtRef.current;
    setYourPick(index);
    setAnswers((prev) => [
      ...prev,
      { playerId: you.id, index, elapsedMs: elapsed, applied: false },
    ]);
    const { points } = scoreAnswer(
      index === question.correctIndex,
      elapsed,
      timeLimitMs,
      you.streak,
    );
    setYourPoints(points);
  }

  function next() {
    if (isLast) {
      setPhase('podium');
      return;
    }
    setQuestionIndex((i) => i + 1);
    setCountdown(COUNTDOWN_SECONDS);
    setPhase('countdown');
  }

  function restart() {
    setPhase('lobby');
    setQuestionIndex(0);
    setPlayers([]);
    setNickname('');
  }

  const order = useMemo(() => ranked(players), [players]);
  const secondsLeft = Math.max(0, Math.ceil((timeLimitMs - elapsedMs) / 1000));
  const clockFraction = Math.max(0, 1 - elapsedMs / timeLimitMs);
  const counts = [0, 1, 2, 3].map(
    (i) => answers.filter((a) => a.index === i).length,
  );
  const maxCount = Math.max(1, ...counts);

  return (
    <div
      className="flex min-h-screen flex-col font-[family-name:var(--font-quiz)] text-white"
      style={{ backgroundColor: KAHOOT_PURPLE }}
    >
      {phase === 'lobby' && (
        <Lobby
          pin={pin}
          nickname={nickname}
          onNickname={setNickname}
          onStart={startGame}
        />
      )}

      {phase === 'countdown' && (
        <div className="flex flex-1 flex-col items-center justify-center gap-6">
          <p className="text-2xl font-bold uppercase tracking-widest opacity-80">
            Приготовьтесь
          </p>
          <div
            key={countdown}
            className="flex h-40 w-40 items-center justify-center rounded-full bg-white/15 text-8xl font-black tabular-nums"
            style={{ animation: 'quiz-pop 0.4s ease-out' }}
          >
            {countdown}
          </div>
          <p className="text-lg opacity-80">
            Вопрос {questionIndex + 1} из {QUIZ_QUESTIONS.length}
          </p>
        </div>
      )}

      {(phase === 'question' || phase === 'reveal') && (
        <div className="flex min-h-screen flex-col gap-3 p-4 sm:gap-4 sm:p-6">
          {/* Question card */}
          <div className="rounded-xl bg-white px-6 py-5 text-center shadow-lg">
            <p className="mb-2 text-xs font-bold uppercase tracking-widest text-neutral-400">
              {question.block} · вопрос {questionIndex + 1} из{' '}
              {QUIZ_QUESTIONS.length}
            </p>
            <h1 className="text-balance text-2xl font-black leading-tight text-neutral-900 sm:text-4xl">
              {question.question}
            </h1>
          </div>

          {/* Clock · distribution · answer tally */}
          <div className="flex shrink-0 items-center gap-4 sm:gap-6">
            <div className="relative flex h-20 w-20 shrink-0 items-center justify-center sm:h-24 sm:w-24">
              <svg viewBox="0 0 100 100" className="absolute inset-0 -rotate-90">
                <circle cx="50" cy="50" r="44" fill="rgba(255,255,255,0.15)" />
                <circle
                  cx="50"
                  cy="50"
                  r="44"
                  fill="none"
                  stroke="white"
                  strokeWidth="10"
                  strokeLinecap="round"
                  strokeDasharray={2 * Math.PI * 44}
                  strokeDashoffset={2 * Math.PI * 44 * (1 - clockFraction)}
                />
              </svg>
              <span className="relative text-3xl font-black tabular-nums sm:text-4xl">
                {phase === 'reveal' ? 0 : secondsLeft}
              </span>
            </div>

            <div className="flex h-24 flex-1 items-end justify-center gap-3 sm:gap-6">
              {phase === 'reveal'
                ? ANSWER_STYLES.map((style, i) => (
                    <div
                      key={style.shape}
                      className="flex flex-1 flex-col items-center justify-end gap-1"
                    >
                      <div
                        className="w-full rounded-t transition-all duration-700"
                        style={{
                          backgroundColor: style.color,
                          // Capped so the tallest bar cannot outgrow the band
                          // and push its own count label out of view.
                          height: `${Math.max(6, (counts[i]! / maxCount) * 64)}px`,
                          opacity: i === question.correctIndex ? 1 : 0.45,
                        }}
                      />
                      <div className="flex items-center gap-1.5">
                        <AnswerShape
                          shape={style.shape}
                          className="h-3.5 w-3.5 text-white"
                        />
                        <span className="text-sm font-bold tabular-nums">
                          {counts[i]}
                        </span>
                      </div>
                    </div>
                  ))
                : // During the question the room's picks stay hidden, exactly
                  // as in the real game — showing them would give the answer
                  // away to whoever is still thinking.
                  null}
            </div>

            <div className="shrink-0 rounded-lg bg-black/25 px-4 py-3 text-center">
              <div className="text-2xl font-black tabular-nums sm:text-3xl">
                {answers.length}
              </div>
              <div className="text-xs font-bold uppercase tracking-wider opacity-70">
                {answers.length === 1 ? 'ответ' : 'ответов'}
              </div>
            </div>
          </div>

          {/* Your result, once you have answered */}
          {phase === 'reveal' && yourPick !== null && (
            <div
              className="rounded-xl px-6 py-4 text-center shadow-lg"
              style={{
                backgroundColor:
                  yourPick === question.correctIndex ? CORRECT_GREEN : WRONG_RED,
              }}
            >
              <p className="text-2xl font-black">
                {yourPick === question.correctIndex ? 'Верно!' : 'Неверно'}
              </p>
              {yourPick === question.correctIndex && (
                <p className="text-lg font-bold">+{yourPoints}</p>
              )}
              {yourPick !== question.correctIndex && (
                <p className="text-sm font-semibold opacity-90">
                  Правильный ответ: {question.answers[question.correctIndex]}
                </p>
              )}
            </div>
          )}
          {phase === 'reveal' && yourPick === null && (
            <div className="rounded-xl bg-black/30 px-6 py-4 text-center">
              <p className="text-xl font-black">Время вышло</p>
              <p className="text-sm font-semibold opacity-90">
                Правильный ответ: {question.answers[question.correctIndex]}
              </p>
            </div>
          )}

          {/* Answer tiles. `flex-1` + two rows lets them absorb whatever
              height is left, which is what keeps the canvas from showing a
              large empty band on a desktop screen. */}
          <div className="grid flex-1 grid-cols-1 grid-rows-4 gap-3 sm:grid-cols-2 sm:grid-rows-2 sm:gap-4">
            {ANSWER_STYLES.map((style, i) => {
              const isCorrect = i === question.correctIndex;
              const dimmed = phase === 'reveal' && !isCorrect;
              const chosen = yourPick === i;
              return (
                <button
                  key={style.shape}
                  type="button"
                  onClick={() => pick(i)}
                  disabled={phase === 'reveal' || yourPick !== null}
                  aria-label={`${style.label}: ${question.answers[i]}`}
                  className="flex min-h-[4.5rem] items-center gap-4 rounded-lg px-5 py-4 text-left transition-all disabled:cursor-default"
                  style={{
                    backgroundColor: style.color,
                    borderBottom: `6px solid ${style.shadow}`,
                    opacity: dimmed ? 0.35 : 1,
                    outline: chosen ? '4px solid white' : undefined,
                    outlineOffset: chosen ? '3px' : undefined,
                    transform: phase === 'reveal' && isCorrect ? 'scale(1.02)' : undefined,
                  }}
                >
                  <AnswerShape
                    shape={style.shape}
                    className="h-8 w-8 shrink-0 text-white sm:h-10 sm:w-10"
                  />
                  <span className="text-lg font-black leading-tight sm:text-2xl">
                    {question.answers[i]}
                  </span>
                  {phase === 'reveal' && isCorrect && (
                    <span className="ml-auto text-3xl font-black">✓</span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {phase === 'scoreboard' && (
        <Scoreboard
          order={order}
          onNext={next}
          isLast={isLast}
          questionNumber={questionIndex + 1}
          total={QUIZ_QUESTIONS.length}
        />
      )}

      {phase === 'podium' && (
        <Podium order={order} you={you} onRestart={restart} />
      )}
    </div>
  );
}

function Lobby({
  pin,
  nickname,
  onNickname,
  onStart,
}: {
  pin: string | null;
  nickname: string;
  onNickname: (v: string) => void;
  onStart: () => void;
}) {
  return (
    <div className="flex flex-1 flex-col">
      {/* The join bar real Kahoot puts across the top of the host screen. */}
      <div className="flex flex-wrap items-center justify-center gap-x-8 gap-y-2 bg-white px-6 py-4 text-neutral-900">
        <span className="text-lg font-bold">
          Войдите на <span className="font-black">quiz.lumen</span>
        </span>
        <span className="text-lg font-bold">
          PIN игры:{' '}
          <span className="text-3xl font-black tabular-nums tracking-wider">
            {pin ?? '——————'}
          </span>
        </span>
      </div>

      <div className="flex flex-1 flex-col items-center justify-center gap-8 p-6">
        <div className="text-center">
          <h1 className="text-4xl font-black sm:text-6xl">Викторина по Дню 1</h1>
          <p className="mt-3 text-lg opacity-80">
            {QUIZ_QUESTIONS.length} вопросов из воркшопа «Вайб-кодинг с Claude»
          </p>
        </div>

        <form
          className="flex w-full max-w-md flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            onStart();
          }}
        >
          <input
            value={nickname}
            onChange={(e) => onNickname(e.target.value)}
            maxLength={16}
            placeholder="Ваше имя"
            aria-label="Ваше имя"
            className="rounded-md border-4 border-black/20 bg-white px-4 py-4 text-center text-xl font-bold text-neutral-900 outline-none placeholder:text-neutral-400"
          />
          <button
            type="submit"
            className="rounded-md bg-neutral-900 px-4 py-4 text-xl font-black text-white transition-transform active:scale-95"
          >
            Начать игру
          </button>
        </form>

        <div className="flex flex-wrap items-center justify-center gap-2 opacity-90">
          {['Айгерім', 'Данияр', 'Мадина', 'Тимур', 'Асель', 'Ержан', 'Камила'].map(
            (name) => (
              <span
                key={name}
                className="rounded-md bg-white/15 px-3 py-1.5 text-sm font-bold"
              >
                {name}
              </span>
            ),
          )}
        </div>
        <p className="text-sm opacity-70">7 игроков уже в лобби</p>
      </div>
    </div>
  );
}

function Scoreboard({
  order,
  onNext,
  isLast,
  questionNumber,
  total,
}: {
  order: Player[];
  onNext: () => void;
  isLast: boolean;
  questionNumber: number;
  total: number;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 p-6">
      <div className="text-center">
        <h2 className="text-4xl font-black">Таблица лидеров</h2>
        <p className="mt-1 opacity-80">
          После вопроса {questionNumber} из {total}
        </p>
      </div>

      <ol className="flex w-full max-w-xl flex-col gap-2">
        {order.slice(0, 5).map((p, i) => {
          const place = i + 1;
          const moved = p.lastPlace === null ? 0 : p.lastPlace - place;
          return (
            <li
              key={p.id}
              className="flex items-center gap-3 rounded-lg px-4 py-3 font-bold"
              style={{
                backgroundColor: p.isYou ? 'white' : 'rgba(255,255,255,0.15)',
                color: p.isYou ? '#111' : 'white',
              }}
            >
              <span className="w-6 shrink-0 text-lg tabular-nums opacity-70">
                {place}
              </span>
              <span className="min-w-0 flex-1 truncate text-lg">
                {p.name}
                {p.isYou ? ' (вы)' : ''}
              </span>
              {p.streak >= 2 && (
                <span className="shrink-0 text-sm opacity-80">
                  🔥 {p.streak}
                </span>
              )}
              {moved !== 0 && (
                <span
                  className="shrink-0 text-sm tabular-nums"
                  style={{ color: moved > 0 ? CORRECT_GREEN : WRONG_RED }}
                >
                  {moved > 0 ? `▲${moved}` : `▼${-moved}`}
                </span>
              )}
              <span className="shrink-0 text-lg tabular-nums">{p.score}</span>
            </li>
          );
        })}
      </ol>

      <button
        type="button"
        onClick={onNext}
        className="rounded-md bg-white px-8 py-4 text-xl font-black text-neutral-900 transition-transform active:scale-95"
      >
        {isLast ? 'Показать итоги' : 'Следующий вопрос'}
      </button>
    </div>
  );
}

function Podium({
  order,
  you,
  onRestart,
}: {
  order: Player[];
  you: Player | null;
  onRestart: () => void;
}) {
  const top = order.slice(0, 3);
  // Real Kahoot puts 2nd on the left, 1st in the middle, 3rd on the right.
  const arranged = [top[1], top[0], top[2]].filter(Boolean) as Player[];
  const heights: Record<number, string> = { 1: 'h-48', 2: 'h-36', 3: 'h-28' };
  const yourPlace = you ? order.findIndex((p) => p.id === you.id) + 1 : null;

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-8 p-6">
      <h2 className="text-4xl font-black sm:text-5xl">Итоги викторины</h2>

      <div className="flex items-end justify-center gap-3 sm:gap-6">
        {arranged.map((p) => {
          const place = order.findIndex((o) => o.id === p.id) + 1;
          return (
            <div key={p.id} className="flex w-24 flex-col items-center sm:w-32">
              <span className="mb-1 text-3xl">
                {place === 1 ? '🥇' : place === 2 ? '🥈' : '🥉'}
              </span>
              <span className="mb-2 max-w-full truncate text-sm font-bold sm:text-base">
                {p.name}
                {p.isYou ? ' (вы)' : ''}
              </span>
              <div
                className={`flex w-full ${heights[place]} flex-col items-center justify-start rounded-t-lg bg-white/20 pt-3`}
              >
                <span className="text-xl font-black tabular-nums sm:text-2xl">
                  {p.score}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {yourPlace !== null && you && (
        <p className="text-lg font-bold">
          Ваш результат: {placeLabel(yourPlace)} · {you.score} очков
        </p>
      )}

      <button
        type="button"
        onClick={onRestart}
        className="rounded-md bg-white px-8 py-4 text-xl font-black text-neutral-900 transition-transform active:scale-95"
      >
        Играть снова
      </button>
    </div>
  );
}
