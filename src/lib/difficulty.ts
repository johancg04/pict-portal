import type { AiDifficulty } from "./types";

// One place for everything a difficulty level changes, shared by the client
// (cadence, labels) and the API routes (model temperature, prompt wording).

export const DIFFICULTIES: AiDifficulty[] = ["easy", "normal", "hard"];

export function parseDifficulty(v: unknown): AiDifficulty {
  return v === "easy" || v === "hard" ? v : "normal";
}

export const DIFFICULTY_LABEL: Record<AiDifficulty, string> = {
  easy: "fácil",
  normal: "normal",
  hard: "difícil",
};

/** One line for the lobby: what the level actually does. */
export const DIFFICULTY_INFO: Record<AiDifficulty, string> = {
  easy: "La IA tarda en reaccionar, se arriesga poco y dibuja simple. Más tiempo para ti.",
  normal: "La IA adivina de forma equilibrada y dibuja con detalle normal.",
  hard: "La IA adivina rápido, con varias opciones a la vez, y dibuja con mucho detalle.",
};

/** When the AI guesses (it's the guesser, a human draws). */
export const GUESS = {
  // Time between the START of one attempt and the next. Counting from the start
  // (not from the answer) keeps the levels apart even though Gemini takes 3–6 s.
  // The free tier allows 15 requests/min for the WHOLE key (all rooms, draw, hints):
  // hard at 5 s = 12/min leaves a little room; 4 s used it all.
  cycleMs: { easy: 12_000, normal: 7_000, hard: 5_000 } as Record<AiDifficulty, number>,
  // No attempts this long after the round starts, so easy waits for a real sketch.
  graceMs: { easy: 12_000, normal: 0, hard: 0 } as Record<AiDifficulty, number>,
  // Floor: stay above the server's 2.5 s rate limit.
  minGapMs: 2_600,
  temperature: { easy: 0.9, normal: 0.4, hard: 0.15 } as Record<AiDifficulty, number>,
  alternatives: { easy: 0, normal: 2, hard: 4 } as Record<AiDifficulty, number>,
};

/** When the AI draws (a human guesses): how much detail the doodle has. */
export const DRAW = {
  temperature: { easy: 1, normal: 0.6, hard: 0.4 } as Record<AiDifficulty, number>,
  rules: {
    easy:
      "Hazlo MUY simple y esquemático, casi un símbolo: entre 2 y 4 trazos, 2 a 8 puntos por trazo, sin detalles ni sombreado. Que cueste un poco reconocerlo.\n",
    normal:
      "Usa entre 3 y 12 trazos. Cada trazo es una polilínea conectada de 2 a 40 puntos.\n",
    hard:
      "Hazlo detallado y fácil de reconocer: entre 10 y 20 trazos, con rasgos característicos, contornos bien definidos y detalles interiores. Cada trazo es una polilínea de 4 a 40 puntos.\n",
  } as Record<AiDifficulty, string>,
};
