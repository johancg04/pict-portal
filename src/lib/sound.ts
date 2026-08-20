"use client";

// Tiny runtime-generated sound effects (Web Audio oscillators) — no audio
// files to ship, no library. Shared by Celebration.tsx (per-guess "acierto")
// and Game.tsx (round start, game victory).

let sharedCtx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  try {
    if (sharedCtx && sharedCtx.state !== "closed") return sharedCtx;
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    sharedCtx = new Ctor();
    return sharedCtx;
  } catch {
    // Autoplay policy or unsupported browser — callers just stay silent.
    return null;
  }
}

type Note = { freq: number; at: number; dur: number };

function playNotes(notes: Note[], { type = "triangle" as OscillatorType, peak = 0.16 } = {}) {
  const ctx = getCtx();
  if (!ctx) return;
  const now = ctx.currentTime;
  for (const { freq, at, dur } of notes) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    const t = now + at;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(peak, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }
}

/** A short rising major triad — "you got it". Used for a correct guess. */
export function playCorrect() {
  playNotes(
    [523.25, 659.25, 783.99].map((freq, i) => ({ freq, at: i * 0.09, dur: 0.35 })),
  );
}

/** A quick two-note blip — "your turn to watch/guess starts now". */
export function playRoundStart() {
  playNotes(
    [440, 587.33].map((freq, i) => ({ freq, at: i * 0.07, dur: 0.16 })),
    { type: "sine", peak: 0.1 },
  );
}

/** A fuller ascending fanfare — the whole game just ended. */
export function playVictory() {
  playNotes(
    [523.25, 659.25, 783.99, 1046.5, 1318.5].map((freq, i) => ({
      freq,
      at: i * 0.11,
      dur: 0.5,
    })),
    { type: "triangle", peak: 0.18 },
  );
}
