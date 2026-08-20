/**
 * Kahoot's scoring rules, reproduced.
 *
 * A wrong answer is worth nothing. A right one is worth the base points scaled
 * by how fast it came: answering instantly pays full, answering as the clock
 * expires pays half. On top of that a streak of consecutive correct answers
 * adds a flat bonus that grows to a cap.
 *
 * Reproducing this rather than inventing a simpler rule matters for the feel of
 * the game: the halving is what makes the leaderboard move on speed instead of
 * only on accuracy, and the streak bonus is what makes a run of right answers
 * worth defending.
 */

/** Points a question is worth before the speed factor. Kahoot's "standard". */
export const BASE_POINTS = 1000;

/** Streak bonus per consecutive correct answer after the first, and its cap. */
const STREAK_STEP = 100;
const STREAK_CAP = 500;

/**
 * Points for one answer.
 *
 * @param correct     whether the chosen answer was the right one
 * @param elapsedMs   time from the question appearing to the answer
 * @param timeLimitMs the question's clock
 * @param streak      answers correct in a row *before* this one
 */
export function scoreAnswer(
  correct: boolean,
  elapsedMs: number,
  timeLimitMs: number,
  streak: number,
): { points: number; streakBonus: number } {
  if (!correct) {
    return { points: 0, streakBonus: 0 };
  }
  const fraction = Math.min(1, Math.max(0, elapsedMs / timeLimitMs));
  const base = Math.round((1 - fraction / 2) * BASE_POINTS);
  const streakBonus = Math.min(STREAK_CAP, streak * STREAK_STEP);
  return { points: base + streakBonus, streakBonus };
}

/** Ordinal suffix for the podium and the "you placed Nth" line. */
export function placeLabel(place: number): string {
  return `${place}-е место`;
}
