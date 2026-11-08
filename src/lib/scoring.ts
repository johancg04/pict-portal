// Scoring rules, in one place.
//
// Both the game (Game.tsx) and the "¿Cómo se puntúa?" help (ScoreHelp.tsx) read
// from here, so the numbers explained to players can never drift from the
// numbers actually awarded.
//
// Why these rules (see the fairness simulation in the PR/commit notes):
//  - Drawing used to pay nothing and also kept you from guessing, so whoever
//    drew fewer times had more chances to score. The drawer now earns the
//    average of what the guessers earned, which makes a drawing turn worth the
//    same as a guessing turn on average, whatever the turn count is.
//  - Games last whole laps (everyone draws once per lap), so turns are equal.
//  - The streak bonus is capped so one fast player cannot snowball.

export const ROUND_SECONDS = 90;

/** Points for a correct guess: a base plus a bonus for how much clock was left. */
export const BASE_POINTS = 50;
export const SPEED_MAX = 50;

/** Extra points for guessing correctly in consecutive rounds, per round of streak, capped. */
export const STREAK_BONUS = 25;
export const STREAK_MAX = 50;

/** Selectable game lengths, in laps (one lap = every participant draws once). */
export const LAP_OPTIONS = [3, 5, 7] as const;
export const DEFAULT_LAPS = 3;
/** Players can also type their own number of laps, within these limits. */
export const MIN_LAPS = 1;
export const MAX_LAPS = 15;

/** Parses a typed lap count; null when it is empty or outside MIN_LAPS..MAX_LAPS. */
export function parseLaps(text: string): number | null {
  if (!/^\d{1,3}$/.test(text.trim())) return null;
  const n = Number(text);
  return n >= MIN_LAPS && n <= MAX_LAPS ? n : null;
}

/**
 * Help limits, per player per game, so they scale with how long the game is:
 *  - hints: one per lap (at least 2);
 *  - word changes: one every two laps (at least 1).
 * Rooms without a lap count (older rooms) keep the old behaviour: no cap.
 */
export function hintBudget(laps: number): number {
  return laps > 0 ? Math.max(2, laps) : Infinity;
}
export function skipBudget(laps: number): number {
  return laps > 0 ? Math.max(1, Math.floor(laps / 2)) : Infinity;
}

/** `frac` is the share of the round's clock still left (0..1) when the guess landed. */
export function guessPoints(frac: number): number {
  const f = Math.min(1, Math.max(0, frac));
  return BASE_POINTS + Math.round(SPEED_MAX * f);
}

/** `streak` counts wins in a row *after* the first (0 for a first win). */
export function streakBonus(streak: number): number {
  return Math.min(STREAK_MAX, Math.max(0, streak) * STREAK_BONUS);
}

/**
 * What the drawer earns when someone guesses: the average of what each guesser
 * got (only the winner scored, so winnerPoints / number of guessers).
 * `participants` includes the drawer and the AI when it plays.
 */
export function drawerPay(winnerPoints: number, participants: number): number {
  if (participants < 2) return 0;
  return Math.round(winnerPoints / (participants - 1));
}

/** Whole laps: every participant draws the same number of times. */
export function totalRoundsFor(laps: number, participants: number): number {
  return laps * Math.max(1, participants);
}
