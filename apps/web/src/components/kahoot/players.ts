/**
 * Simulated opponents.
 *
 * Real Kahoot needs a room full of phones. This recreation has to be playable
 * and demonstrable by one person on one screen, so the other players are
 * simulated: each has a skill (how often it answers correctly) and a pace (how
 * fast), which is enough to make the leaderboard move between questions the way
 * it does in a real game.
 */

import { scoreAnswer } from './scoring';

export interface Player {
  id: string;
  name: string;
  /** True for the human; drives the "you" highlight on the scoreboard. */
  isYou: boolean;
  score: number;
  streak: number;
  /** Place on the previous scoreboard, for the up/down arrow. */
  lastPlace: number | null;
  /** 0..1 chance of answering correctly. Ignored for the human. */
  skill: number;
  /** Fraction of the clock this player typically uses. */
  pace: number;
}

const BOT_NAMES = [
  'Айгерім',
  'Данияр',
  'Мадина',
  'Тимур',
  'Асель',
  'Ержан',
  'Камила',
];

/** Deterministic-ish spread of skill/pace so the pack is not uniform. */
export function createBots(): Player[] {
  return BOT_NAMES.map((name, i) => ({
    id: `bot-${i}`,
    name,
    isYou: false,
    score: 0,
    streak: 0,
    lastPlace: null,
    // 0.55..0.88 — good enough to be beatable but not a walkover.
    skill: 0.55 + ((i * 5) % 8) / 8 * 0.33,
    // 0.25..0.85 of the clock.
    pace: 0.25 + ((i * 3) % 7) / 7 * 0.6,
  }));
}

export function createYou(name: string): Player {
  return {
    id: 'you',
    name: name.trim() || 'Вы',
    isYou: true,
    score: 0,
    streak: 0,
    lastPlace: null,
    skill: 1,
    pace: 0,
  };
}

/**
 * Roll one bot's answer for a question: which option it picks and when.
 *
 * The pick is spread over the wrong options rather than always landing on the
 * same one, so the reveal chart looks like a real room's distribution.
 */
export function rollBotAnswer(
  bot: Player,
  correctIndex: number,
  timeLimitMs: number,
): { index: number; elapsedMs: number } {
  const correct = Math.random() < bot.skill;
  let index = correctIndex;
  if (!correct) {
    const wrong = [0, 1, 2, 3].filter((i) => i !== correctIndex);
    index = wrong[Math.floor(Math.random() * wrong.length)]!;
  }
  // Jitter around the bot's pace so repeat plays differ.
  const jitter = (Math.random() - 0.5) * 0.3;
  const fraction = Math.min(0.97, Math.max(0.08, bot.pace + jitter));
  return { index, elapsedMs: Math.round(fraction * timeLimitMs) };
}

/** Apply an answer to a player, returning the points it earned. */
export function applyAnswer(
  player: Player,
  correct: boolean,
  elapsedMs: number,
  timeLimitMs: number,
): number {
  const { points } = scoreAnswer(correct, elapsedMs, timeLimitMs, player.streak);
  player.score += points;
  player.streak = correct ? player.streak + 1 : 0;
  return points;
}

/** Players sorted by score, highest first, ties broken by name for stability. */
export function ranked(players: Player[]): Player[] {
  return [...players].sort(
    (a, b) => b.score - a.score || a.name.localeCompare(b.name),
  );
}

/** A room code in Kahoot's style: a plain 6-digit game PIN. */
export function generatePin(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}
