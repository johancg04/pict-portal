"use client";

// Sound effects, synthesized at runtime with Web Audio — no audio files to ship,
// nothing to license, nothing to download.
//
//  - A *pack* is a small recipe (waveform, filter, and a list of notes for each
//    game event). There is one pack per visual skin, plus "auto", which follows
//    whichever skin the player has chosen.
//  - Players choose the pack, the volume and mute; the choice is remembered.
//  - `scheduleEvent` is pure with respect to the AudioContext it is given, so
//    the same code can be rendered offline (that is how it is tested).

import { useSyncExternalStore } from "react";

export type SoundEvent =
  | "roundStart" // a round begins (you are watching/guessing)
  | "yourTurn" // a round begins and you hold the pen
  | "correct" // you guessed it
  | "otherCorrect" // someone else guessed it
  | "message" // a guess arrives in the chat
  | "tick" // last seconds of the clock
  | "timeUp" // the round ended with no winner
  | "hint" // a hint was given
  | "reaction" // an emoji reaction
  | "victory" // the game is over
  | "join" // someone came into the room
  | "leave" // someone left the room
  | "clear" // the board was wiped
  | "click"; // a button press in the game UI

export const SOUND_EVENTS: SoundEvent[] = [
  "roundStart",
  "yourTurn",
  "correct",
  "otherCorrect",
  "message",
  "tick",
  "timeUp",
  "hint",
  "reaction",
  "victory",
  "join",
  "leave",
  "clear",
  "click",
];

/** One note: frequency (Hz), start offset and duration (s), optional glide target and relative volume. */
type Note = { f: number; at: number; d: number; to?: number; v?: number };

export type PackId = "suave" | "synth" | "cristal" | "terminal" | "arcade";
export type PackChoice = PackId | "auto";

export type Pack = {
  id: PackId;
  name: string;
  tagline: string;
  wave: OscillatorType;
  /**
   * Base loudness of a full-volume note (before the master volume). Tuned per
   * pack so that all of them have a similar perceived level (RMS): sharper
   * waveforms (square, saw) need a higher peak than a sine bell to match.
   */
  peak: number;
  /** Optional low-pass cutoff (Hz) to take the edge off harsh waveforms. */
  cutoff?: number;
  /** Adds a quiet inharmonic partial, which reads as a bell/glass ring. */
  bell?: boolean;
  /** Attack time (s): short for blips, longer for soft tones. */
  attack: number;
  events: Record<SoundEvent, Note[]>;
};

// Notes
const C4 = 261.63, E4 = 329.63, G4 = 392, A4 = 440;
const C5 = 523.25, D5 = 587.33, E5 = 659.25, G5 = 783.99, A5 = 880, B5 = 987.77;
const C6 = 1046.5, E6 = 1318.5;

/** Frequencies played one after another, `step` seconds apart. */
function arp(freqs: number[], step: number, d: number, v = 1): Note[] {
  return freqs.map((f, i) => ({ f, at: i * step, d, v }));
}

export const PACKS: Record<PackId, Pack> = {
  // Clásico: rounded triangle tones, the sounds the game always had.
  suave: {
    id: "suave",
    name: "Suave",
    tagline: "Tonos redondos y tranquilos",
    wave: "triangle",
    peak: 0.16,
    attack: 0.02,
    events: {
      roundStart: arp([A4, D5], 0.07, 0.16, 0.6),
      yourTurn: arp([C5, E5, G5], 0.08, 0.22, 0.7),
      correct: arp([C5, E5, G5], 0.09, 0.35),
      otherCorrect: arp([E5, G5], 0.08, 0.25, 0.5),
      message: [{ f: A5, at: 0, d: 0.08, v: 0.35 }],
      tick: [{ f: 660, at: 0, d: 0.06, v: 0.3 }],
      timeUp: arp([G4, E4, C4], 0.12, 0.3, 0.6),
      hint: arp([G5, C6], 0.07, 0.18, 0.5),
      reaction: [{ f: C6, at: 0, d: 0.1, to: E6, v: 0.3 }],
      victory: arp([C5, E5, G5, C6, E6], 0.11, 0.5, 1.1),
      join: arp([E5, G5], 0.06, 0.12, 0.4),
      leave: arp([G5, E5], 0.06, 0.14, 0.3),
      clear: [{ f: A5, at: 0, d: 0.18, to: 330, v: 0.3 }],
      click: [{ f: 1200, at: 0, d: 0.02, v: 0.18 }],
    },
  },
  // Neón: warm sawtooth synth with sweeps.
  synth: {
    id: "synth",
    name: "Synth",
    tagline: "Sintetizador ochentero",
    wave: "sawtooth",
    peak: 0.15,
    cutoff: 2200,
    attack: 0.012,
    events: {
      roundStart: arp([220, 330], 0.08, 0.2, 0.7),
      yourTurn: arp([220, 330, 440], 0.07, 0.22, 0.8),
      correct: arp([A4, C5, E5, A5], 0.07, 0.3),
      otherCorrect: arp([330, A4], 0.08, 0.2, 0.5),
      message: [{ f: 330, at: 0, d: 0.1, to: A4, v: 0.4 }],
      tick: [{ f: 220, at: 0, d: 0.07, v: 0.45 }],
      timeUp: [{ f: A4, at: 0, d: 0.5, to: 110, v: 0.7 }],
      hint: [{ f: 330, at: 0, d: 0.15, to: 660, v: 0.5 }],
      reaction: [{ f: 660, at: 0, d: 0.12, to: 990, v: 0.35 }],
      victory: arp([C4, E4, G4, C5, E5, G5], 0.09, 0.5, 1.1),
      join: [{ f: 330, at: 0, d: 0.15, to: 660, v: 0.4 }],
      leave: [{ f: 660, at: 0, d: 0.15, to: 330, v: 0.4 }],
      clear: [{ f: A4, at: 0, d: 0.25, to: 110, v: 0.45 }],
      click: [{ f: 900, at: 0, d: 0.02, v: 0.2 }],
    },
  },
  // Órbita: glassy bell tones with long tails.
  cristal: {
    id: "cristal",
    name: "Cristal",
    tagline: "Campanitas de vidrio",
    wave: "sine",
    peak: 0.09,
    bell: true,
    attack: 0.008,
    events: {
      roundStart: arp([C6, E6], 0.12, 0.6, 0.45),
      yourTurn: arp([G5, C6, E6], 0.1, 0.7, 0.5),
      correct: arp([C6, E6, 1568, 2093], 0.09, 0.8),
      otherCorrect: arp([E6, 1568], 0.1, 0.5, 0.4),
      message: [{ f: 1568, at: 0, d: 0.25, v: 0.3 }],
      tick: [{ f: 1760, at: 0, d: 0.1, v: 0.25 }],
      timeUp: arp([E6, C6, G5], 0.18, 0.6, 0.45),
      hint: [
        { f: 1568, at: 0, d: 0.3, v: 0.35 },
        { f: 2093, at: 0.1, d: 0.4, v: 0.3 },
      ],
      reaction: [{ f: 2093, at: 0, d: 0.2, v: 0.28 }],
      victory: arp([C6, E6, 1568, 2093, 2637], 0.12, 0.9, 0.6),
      join: arp([E6, 1568], 0.08, 0.35, 0.35),
      leave: arp([1568, E6], 0.08, 0.35, 0.3),
      clear: [{ f: 2093, at: 0, d: 0.3, to: C6, v: 0.25 }],
      click: [{ f: 2200, at: 0, d: 0.05, v: 0.15 }],
    },
  },
  // Comando: square-wave terminal beeps.
  terminal: {
    id: "terminal",
    name: "Terminal",
    tagline: "Pitidos de consola de nave",
    wave: "square",
    peak: 0.12,
    cutoff: 3200,
    attack: 0.004,
    events: {
      roundStart: [
        { f: 880, at: 0, d: 0.06 },
        { f: 880, at: 0.1, d: 0.06 },
        { f: 1320, at: 0.2, d: 0.1 },
      ],
      yourTurn: arp([660, 880, 1320], 0.09, 0.08),
      correct: [
        { f: 1760, at: 0, d: 0.06 },
        { f: 2093, at: 0.08, d: 0.16 },
      ],
      otherCorrect: [{ f: 990, at: 0, d: 0.08, v: 0.6 }],
      message: [{ f: 1200, at: 0, d: 0.04, v: 0.5 }],
      tick: [{ f: 800, at: 0, d: 0.03, v: 0.5 }],
      timeUp: [{ f: 300, at: 0, d: 0.35, to: 120, v: 0.7 }],
      hint: arp([1500, 1500], 0.08, 0.05),
      reaction: [{ f: 2000, at: 0, d: 0.03, v: 0.4 }],
      victory: arp([660, 880, 1320, 1760, 2093], 0.08, 0.2, 1.1),
      join: [
        { f: 1000, at: 0, d: 0.04, v: 0.5 },
        { f: 1400, at: 0.06, d: 0.06, v: 0.5 },
      ],
      leave: [
        { f: 1400, at: 0, d: 0.04, v: 0.5 },
        { f: 1000, at: 0.06, d: 0.06, v: 0.5 },
      ],
      clear: [{ f: 600, at: 0, d: 0.25, to: 150, v: 0.6 }],
      click: [{ f: 1800, at: 0, d: 0.015, v: 0.3 }],
    },
  },
  // Grieta: 8-bit arcade "coin" sounds.
  arcade: {
    id: "arcade",
    name: "Arcade",
    tagline: "Monedas y 8 bits",
    wave: "square",
    peak: 0.115,
    attack: 0.003,
    events: {
      roundStart: arp([G4, C5, E5], 0.06, 0.1),
      yourTurn: arp([C5, E5, G5, C6], 0.06, 0.12),
      correct: [
        { f: B5, at: 0, d: 0.07 },
        { f: E6, at: 0.07, d: 0.35 },
      ],
      otherCorrect: [
        { f: E5, at: 0, d: 0.06, v: 0.7 },
        { f: A5, at: 0.06, d: 0.15, v: 0.7 },
      ],
      message: [{ f: G5, at: 0, d: 0.05, v: 0.5 }],
      tick: [{ f: C5, at: 0, d: 0.04, v: 0.5 }],
      timeUp: arp([G4, 370, 349, E4], 0.1, 0.12),
      hint: arp([E5, A5], 0.05, 0.1, 0.6),
      reaction: [{ f: 1175, at: 0, d: 0.05, v: 0.4 }],
      victory: arp([C5, C5, C5, E5, G5, C6], 0.1, 0.2, 1.1),
      join: arp([C5, G5], 0.05, 0.08, 0.6),
      leave: arp([G5, C5], 0.05, 0.08, 0.5),
      clear: [{ f: C6, at: 0, d: 0.2, to: C4, v: 0.6 }],
      click: [{ f: 1400, at: 0, d: 0.02, v: 0.3 }],
    },
  },
};

export const PACK_LIST: Pack[] = [PACKS.suave, PACKS.synth, PACKS.cristal, PACKS.terminal, PACKS.arcade];

/** Which pack "auto" resolves to for each skin. */
export const AUTO_PACK_FOR_SKIN: Record<string, PackId> = {
  clasico: "suave",
  neon: "synth",
  orbita: "cristal",
  comando: "terminal",
  grieta: "arcade",
};

/**
 * Schedules one event's notes on `ctx`, starting `t0` seconds from now, into
 * `dest`. Used for live playback and for offline rendering in tests.
 */
export function scheduleEvent(
  ctx: BaseAudioContext,
  dest: AudioNode,
  packId: PackId,
  event: SoundEvent,
  t0 = 0,
) {
  const pack = PACKS[packId];
  let out: AudioNode = dest;
  if (pack.cutoff) {
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = pack.cutoff;
    lp.connect(dest);
    out = lp;
  }
  const base = ctx.currentTime + t0;
  for (const n of pack.events[event]) {
    const t = base + n.at;
    const peak = pack.peak * (n.v ?? 1);
    voice(ctx, out, pack.wave, n.f, n.to, t, n.d, pack.attack, peak);
    if (pack.bell) voice(ctx, out, "sine", n.f * 2.76, n.to ? n.to * 2.76 : undefined, t, n.d * 0.7, pack.attack, peak * 0.35);
  }
}

function voice(
  ctx: BaseAudioContext,
  dest: AudioNode,
  type: OscillatorType,
  f: number,
  to: number | undefined,
  t: number,
  d: number,
  attack: number,
  peak: number,
) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(f, t);
  if (to) osc.frequency.exponentialRampToValueAtTime(to, t + d);
  gain.gain.setValueAtTime(0, t);
  gain.gain.linearRampToValueAtTime(peak, t + attack);
  gain.gain.exponentialRampToValueAtTime(0.001, t + d);
  osc.connect(gain).connect(dest);
  osc.start(t);
  osc.stop(t + d + 0.05);
}

// ---------------------------------------------------------------------------
// Background music: a small generative sequencer per pack. One bar = 16 steps;
// the chord (pad + arpeggio) and the bass root change every bar over a 4-bar loop.

export type MusicMode = "off" | "wait" | "round" | "urgent";

type MusicPack = {
  bpm: number;
  chords: number[][]; // pad + arpeggio tones, one chord per bar
  bass: number[]; // bass root (Hz) per bar
  bassSteps: number[]; // 16 steps, 1 = a bass hit
  arpSteps: (number | null)[]; // 16 steps: chord tone index (wraps), or rest
  arpOct: number; // multiplier applied to arpeggio notes
  pad: { wave: OscillatorType; gain: number };
  bassWave: OscillatorType;
  arpWave: OscillatorType;
  bell?: boolean;
  hat?: number[]; // 16 steps of noise ticks (relative level), 0 = none
  bassGain: number;
  arpGain: number;
  cutoff: number; // low-pass for the tonal parts
  level: number; // overall loudness trim, so every pack's music sits at a similar level
};

const MUSIC: Record<PackId, MusicPack> = {
  suave: {
    bpm: 84,
    chords: [
      [261.63, 329.63, 392, 493.88],
      [220, 261.63, 329.63, 392],
      [174.61, 220, 261.63, 329.63],
      [196, 246.94, 293.66, 392],
    ],
    bass: [130.81, 110, 87.31, 98],
    bassSteps: [1, 0, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0, 0],
    arpSteps: [0, null, 2, null, 1, null, 3, null, 2, null, 1, null, 0, null, 3, null],
    arpOct: 2,
    pad: { wave: "triangle", gain: 0.05 },
    bassWave: "sine",
    arpWave: "sine",
    bassGain: 0.12,
    arpGain: 0.06,
    cutoff: 1800,
    level: 0.75,
  },
  synth: {
    bpm: 100,
    chords: [
      [220, 261.63, 329.63],
      [174.61, 220, 261.63],
      [261.63, 329.63, 392],
      [196, 246.94, 293.66],
    ],
    bass: [110, 87.31, 130.81, 98],
    bassSteps: [1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0],
    arpSteps: [0, null, 1, null, 2, null, 1, null, 0, null, 2, null, 1, null, 2, null],
    arpOct: 2,
    pad: { wave: "sawtooth", gain: 0.03 },
    bassWave: "sawtooth",
    arpWave: "square",
    bassGain: 0.07,
    arpGain: 0.04,
    cutoff: 1000,
    level: 1.5,
  },
  cristal: {
    bpm: 72,
    chords: [
      [293.66, 369.99, 440, 554.37],
      [246.94, 293.66, 369.99, 440],
      [196, 246.94, 293.66, 369.99],
      [220, 277.18, 329.63, 440],
    ],
    bass: [73.42, 61.74, 49, 55],
    bassSteps: [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    arpSteps: [0, null, null, null, 2, null, null, null, 1, null, null, 3, null, null, 2, null],
    arpOct: 4,
    pad: { wave: "sine", gain: 0.045 },
    bassWave: "sine",
    arpWave: "sine",
    bell: true,
    bassGain: 0.1,
    arpGain: 0.05,
    cutoff: 4000,
    level: 0.75,
  },
  terminal: {
    bpm: 110,
    chords: [
      [164.81, 196, 246.94],
      [130.81, 164.81, 196],
      [146.83, 185, 220],
      [164.81, 196, 246.94],
    ],
    bass: [82.41, 65.41, 73.42, 82.41],
    bassSteps: [1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 1],
    arpSteps: [null, null, 0, null, null, null, 2, null, null, 1, null, null, null, null, 2, null],
    arpOct: 4,
    pad: { wave: "square", gain: 0.015 },
    bassWave: "square",
    arpWave: "square",
    hat: [0, 0, 0.5, 0, 0, 0, 0.5, 0, 0, 0, 0.5, 0, 0, 0, 0.5, 0],
    bassGain: 0.06,
    arpGain: 0.035,
    cutoff: 2400,
    level: 1.4,
  },
  arcade: {
    bpm: 128,
    chords: [
      [261.63, 329.63, 392],
      [196, 246.94, 293.66],
      [220, 261.63, 329.63],
      [174.61, 220, 261.63],
    ],
    bass: [130.81, 98, 110, 87.31],
    bassSteps: [1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0],
    arpSteps: [0, 1, 2, 1, 0, 1, 2, 1, 0, 1, 2, 1, 0, 1, 2, 1],
    arpOct: 2,
    pad: { wave: "triangle", gain: 0.02 },
    bassWave: "triangle",
    arpWave: "square",
    hat: [0, 0, 0.6, 0, 0, 0, 0.6, 0, 0, 0, 0.6, 0, 0, 0, 0.6, 0],
    bassGain: 0.1,
    arpGain: 0.045,
    cutoff: 3600,
    level: 1.5,
  },
};

const noiseBuffers = new WeakMap<BaseAudioContext, AudioBuffer>();
/** One second of white noise, shared by hats and the pen. */
function getNoise(ctx: BaseAudioContext): AudioBuffer {
  let buf = noiseBuffers.get(ctx);
  if (!buf) {
    buf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let seed = 12345; // deterministic, so tests and offline renders are repeatable
    for (let i = 0; i < d.length; i++) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      d[i] = (seed / 0xffffffff) * 2 - 1;
    }
    noiseBuffers.set(ctx, buf);
  }
  return buf;
}

function noiseHit(ctx: BaseAudioContext, dest: AudioNode, t: number, d: number, peak: number) {
  const src = ctx.createBufferSource();
  src.buffer = getNoise(ctx);
  const hp = ctx.createBiquadFilter();
  hp.type = "highpass";
  hp.frequency.value = 6000;
  const g = ctx.createGain();
  g.gain.setValueAtTime(peak, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + d);
  src.connect(hp).connect(g).connect(dest);
  src.start(t);
  src.stop(t + d + 0.02);
}

/** A sustained pad note: slow attack, held, then released into the next bar. */
function padNote(ctx: BaseAudioContext, dest: AudioNode, type: OscillatorType, f: number, t: number, d: number, peak: number) {
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(f, t);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(peak, t + 0.35);
  g.gain.setValueAtTime(peak, t + d - 0.4);
  g.gain.linearRampToValueAtTime(0, t + d + 0.05);
  osc.connect(g).connect(dest);
  osc.start(t);
  osc.stop(t + d + 0.1);
}

/**
 * Schedules one bar of music starting at absolute time `t0` and returns how
 * long it lasts (s). "wait" is the light waiting-room version (pad and a sparse
 * arpeggio); "round" is the full arrangement; "urgent" is faster with a busier
 * bass and hats, for the last seconds of a round.
 */
export function scheduleMusicBar(
  ctx: BaseAudioContext,
  dest: AudioNode,
  packId: PackId,
  mode: Exclude<MusicMode, "off">,
  bar: number,
  t0: number,
): number {
  const m = MUSIC[packId];
  const beat = 60 / (m.bpm * (mode === "urgent" ? 1.2 : 1));
  const step = beat / 4;
  const dur = beat * 4;
  const chord = m.chords[bar % m.chords.length];
  const root = m.bass[bar % m.bass.length];

  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = m.cutoff;
  lp.connect(dest);

  const k = m.level;
  // The waiting room is lighter: a quieter pad under a sparse arpeggio.
  const padGain = m.pad.gain * k * (mode === "wait" ? 0.8 : 1);
  for (const f of chord) padNote(ctx, lp, m.pad.wave, f, t0, dur, padGain);

  for (let i = 0; i < 16; i++) {
    const t = t0 + i * step;
    if (mode !== "wait" && (m.bassSteps[i] || (mode === "urgent" && i % 2 === 0))) {
      voice(ctx, lp, m.bassWave, root, undefined, t, step * 1.7, 0.01, m.bassGain * k);
    }
    const a = m.arpSteps[i];
    if (a != null && (mode !== "wait" || i % 4 === 0)) {
      const f = chord[a % chord.length] * m.arpOct;
      voice(ctx, lp, m.arpWave, f, undefined, t, step * (m.bell ? 3.5 : 1.6), 0.008, m.arpGain * k);
      if (m.bell) voice(ctx, lp, "sine", f * 2.76, undefined, t, step * 2.4, 0.008, m.arpGain * 0.3 * k);
    }
    if (m.hat && mode !== "wait") {
      const h = mode === "urgent" && i % 2 === 1 ? Math.max(m.hat[i], 0.5) : m.hat[i];
      if (h > 0) noiseHit(ctx, dest, t, 0.04, 0.05 * h * k);
    }
  }
  return dur;
}

/** How each pack's pen sounds: band-passed noise, like chalk, a brush or static. */
const PEN: Record<PackId, { freq: number; q: number; gain: number }> = {
  suave: { freq: 1800, q: 0.8, gain: 0.05 },
  synth: { freq: 2400, q: 1.2, gain: 0.05 },
  cristal: { freq: 5200, q: 0.9, gain: 0.035 },
  terminal: { freq: 3200, q: 2.5, gain: 0.04 },
  arcade: { freq: 2000, q: 3, gain: 0.04 },
};

// ---------------------------------------------------------------------------
// Preferences (remembered per device)

export type SoundPrefs = {
  pack: PackChoice;
  /** Master volume (0..1) for everything. */
  volume: number;
  muted: boolean;
  /** Background music on/off and its level relative to the master volume. */
  music: boolean;
  musicVolume: number;
  /** The scratch of the pen while someone draws. */
  pen: boolean;
  /** Small clicks when pressing buttons in the game. */
  clicks: boolean;
};

const KEY = "pictportal-sound";
const LEGACY_MUTED_KEY = "pictportal-muted";

export const DEFAULT_SOUND_PREFS: SoundPrefs = {
  pack: "auto",
  volume: 0.7,
  muted: false,
  music: true,
  musicVolume: 0.5,
  pen: true,
  clicks: true,
};

let prefs: SoundPrefs = DEFAULT_SOUND_PREFS;
let loaded = false;
const listeners = new Set<() => void>();

function load() {
  loaded = true;
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || "null") as Partial<SoundPrefs> | null;
    const pack: PackChoice =
      raw?.pack === "auto" || (raw?.pack && raw.pack in PACKS) ? (raw.pack as PackChoice) : "auto";
    const volume = typeof raw?.volume === "number" ? Math.min(1, Math.max(0, raw.volume)) : DEFAULT_SOUND_PREFS.volume;
    // The old 🔊 toggle stored its own flag; honour it once if there's no new setting yet.
    const muted = typeof raw?.muted === "boolean" ? raw.muted : localStorage.getItem(LEGACY_MUTED_KEY) === "1";
    const music = typeof raw?.music === "boolean" ? raw.music : DEFAULT_SOUND_PREFS.music;
    const musicVolume =
      typeof raw?.musicVolume === "number" ? Math.min(1, Math.max(0, raw.musicVolume)) : DEFAULT_SOUND_PREFS.musicVolume;
    const pen = typeof raw?.pen === "boolean" ? raw.pen : DEFAULT_SOUND_PREFS.pen;
    const clicks = typeof raw?.clicks === "boolean" ? raw.clicks : DEFAULT_SOUND_PREFS.clicks;
    prefs = { pack, volume, muted, music, musicVolume, pen, clicks };
  } catch {
    prefs = DEFAULT_SOUND_PREFS;
  }
}

export function getSoundPrefs(): SoundPrefs {
  if (!loaded && typeof window !== "undefined") load();
  return prefs;
}

export function setSoundPrefs(patch: Partial<SoundPrefs>) {
  prefs = { ...getSoundPrefs(), ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    /* private mode: the choice just won't persist */
  }
  if (masterGain) masterGain.gain.value = masterLevel();
  syncMusic();
  if (!prefs.pen || prefs.muted) penStop();
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** React hook: current sound preferences (server render uses the defaults). */
export function useSoundPrefs(): SoundPrefs {
  return useSyncExternalStore(subscribe, getSoundPrefs, () => DEFAULT_SOUND_PREFS);
}

/** The pack that will actually play: "auto" follows the active skin. */
export function resolvePack(choice: PackChoice = getSoundPrefs().pack): PackId {
  if (choice !== "auto") return choice;
  const skin = typeof document !== "undefined" ? document.documentElement.getAttribute("data-skin") : null;
  return AUTO_PACK_FOR_SKIN[skin ?? "clasico"] ?? "suave";
}

// ---------------------------------------------------------------------------
// Playback

let ctx: AudioContext | null = null;
let masterGain: GainNode | null = null;
let musicBus: GainNode | null = null;
// Quadratic: perceived loudness follows amplitude roughly squared.
const masterLevel = () => Math.pow(getSoundPrefs().volume, 2);

function getCtx(): AudioContext | null {
  try {
    if (ctx && ctx.state !== "closed") return ctx;
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
    masterGain = ctx.createGain();
    masterGain.gain.value = masterLevel();
    masterGain.connect(ctx.destination);
    musicBus = ctx.createGain();
    musicBus.gain.value = 0; // faded in by syncMusic()
    musicBus.connect(masterGain);
    return ctx;
  } catch {
    // Unsupported browser — callers just stay silent.
    return null;
  }
}

// Browsers keep audio suspended until the first gesture (there is no way around
// that), so retry on every early gesture until the context is really running,
// then start whatever music the screen asked for.
if (typeof window !== "undefined") {
  const EVENTS = ["pointerdown", "pointerup", "touchend", "click", "keydown"] as const;
  const unlock = () => {
    const c = getCtx();
    if (!c) return;
    c.resume().then(
      () => {
        if (c.state !== "running") return;
        EVENTS.forEach((e) => window.removeEventListener(e, unlock));
        syncMusic();
      },
      () => {},
    );
  };
  EVENTS.forEach((e) => window.addEventListener(e, unlock));
}

/** How long (s) an event's notes ring for. */
function eventLength(packId: PackId, event: SoundEvent): number {
  return Math.max(...PACKS[packId].events[event].map((n) => n.at + n.d));
}

// Sounds that mark an outcome. If a round starts right after one of them (it
// often does, the next round begins as soon as the last one ends), the start
// jingle waits for the outcome to finish instead of playing on top of it.
const OUTCOME_EVENTS: SoundEvent[] = ["timeUp", "correct", "otherCorrect", "victory"];
const START_EVENTS: SoundEvent[] = ["roundStart", "yourTurn"];
const MAX_WAIT_S = 0.9;
let outcomeEndsAt = 0; // AudioContext time

// Minimum gap between plays of the same event, so a burst of messages or
// reactions becomes a texture instead of a wall of noise.
const MIN_GAP_MS: Partial<Record<SoundEvent, number>> = {
  message: 120,
  reaction: 90,
  tick: 400,
  otherCorrect: 200,
  join: 150,
  leave: 150,
  clear: 150,
  click: 50,
};
const lastPlayed = new Map<SoundEvent, number>();

/** Plays `event` in the player's chosen pack (or `packOverride`, e.g. for previews). */
export function playSound(event: SoundEvent, packOverride?: PackChoice) {
  const p = getSoundPrefs();
  if (p.muted || p.volume <= 0) return;
  if (event === "click" && !p.clicks) return;
  const now = performance.now();
  const gap = MIN_GAP_MS[event] ?? 0;
  if (gap && now - (lastPlayed.get(event) ?? -Infinity) < gap) return;
  lastPlayed.set(event, now);
  const c = getCtx();
  if (!c || !masterGain) return;
  if (c.state === "suspended") c.resume().catch(() => {});
  const pack = resolvePack(packOverride ?? p.pack);
  const t = c.currentTime;
  const delay = START_EVENTS.includes(event) ? Math.min(MAX_WAIT_S, Math.max(0, outcomeEndsAt - t + 0.05)) : 0;
  scheduleEvent(c, masterGain, pack, event, delay);
  if (OUTCOME_EVENTS.includes(event)) outcomeEndsAt = Math.max(outcomeEndsAt, t + eventLength(pack, event));
}

/** A short sample so players can hear a pack before choosing it. */
export function previewPack(choice: PackChoice) {
  playSound("correct", choice);
  setTimeout(() => playSound("tick", choice), 520);
}

// ---------------------------------------------------------------------------
// Background music engine: a look-ahead scheduler that queues one bar at a time.

let gameMode: MusicMode = "off";
let previewMode: MusicMode | null = null;
let previewTimer: ReturnType<typeof setTimeout> | undefined;
let musicTimer: ReturnType<typeof setInterval> | null = null;
let musicStopTimer: ReturnType<typeof setTimeout> | undefined;
let nextBarTime = 0;
let barCursor = 0;

const musicLevel = () => Math.pow(getSoundPrefs().musicVolume, 2);
const wantedMode = (): MusicMode => previewMode ?? gameMode;
const musicAllowed = () => {
  const p = getSoundPrefs();
  return p.music && !p.muted && p.volume > 0 && p.musicVolume > 0 && !(typeof document !== "undefined" && document.hidden);
};

/** What the game is doing right now: the music follows it (off, waiting room, round, last seconds). */
export function setMusicMode(mode: MusicMode) {
  gameMode = mode;
  syncMusic();
}

/** Starts, retunes or fades out the music so it matches the mode and the player's settings. */
export function syncMusic() {
  if (typeof window === "undefined") return;
  const want = wantedMode() !== "off" && musicAllowed();
  if (!want && !musicTimer) return; // nothing is playing and nothing should
  const c = getCtx();
  if (!c || !musicBus) return;
  musicBus.gain.setTargetAtTime(want ? musicLevel() : 0, c.currentTime, want ? 0.5 : 0.2);
  if (want) {
    clearTimeout(musicStopTimer);
    musicStopTimer = undefined;
    if (!musicTimer) {
      if (c.state === "suspended") c.resume().catch(() => {});
      nextBarTime = c.currentTime + 0.1;
      musicTimer = setInterval(musicTick, 100);
      musicTick();
    }
  } else if (!musicStopTimer) {
    // Let the fade-out finish, then stop scheduling.
    musicStopTimer = setTimeout(() => {
      musicStopTimer = undefined;
      if (musicTimer && !(wantedMode() !== "off" && musicAllowed())) {
        clearInterval(musicTimer);
        musicTimer = null;
      }
    }, 900);
  }
}

function musicTick() {
  const mode = wantedMode();
  if (!ctx || !musicBus || mode === "off") return;
  while (nextBarTime < ctx.currentTime + 0.6) {
    nextBarTime += scheduleMusicBar(ctx, musicBus, resolvePack(), mode, barCursor++, nextBarTime);
  }
}

/** A few seconds of the music, so players can hear it from the settings panel. */
export function previewMusic(ms = 4500) {
  if (gameMode !== "off") return; // a game is already playing it
  previewMode = "round";
  syncMusic();
  clearTimeout(previewTimer);
  previewTimer = setTimeout(() => {
    previewMode = null;
    syncMusic();
  }, ms);
}

// Pause the music while the tab is in the background (timers are throttled there).
if (typeof document !== "undefined") document.addEventListener("visibilitychange", () => syncMusic());

// ---------------------------------------------------------------------------
// Pen engine: one looping noise source whose loudness and brightness follow the
// speed of the stroke. Fed by the local pen and by strokes arriving from others.

let penGain: GainNode | null = null;
let penFilter: BiquadFilterNode | null = null;
let penTimer: ReturnType<typeof setTimeout> | undefined;
let lastPenAt = 0;

function ensurePen(c: AudioContext) {
  if (penGain || !masterGain) return;
  const src = c.createBufferSource();
  src.buffer = getNoise(c);
  src.loop = true;
  penFilter = c.createBiquadFilter();
  penFilter.type = "bandpass";
  penGain = c.createGain();
  penGain.gain.value = 0;
  src.connect(penFilter).connect(penGain).connect(masterGain);
  src.start();
}

/**
 * Call while a stroke is being drawn. `speed` is 0..1 (a slow, careful line to a
 * fast scribble); `remote` makes it quieter, for strokes drawn by someone else.
 */
export function penMove(speed: number, remote = false) {
  const p = getSoundPrefs();
  if (!p.pen || p.muted || p.volume <= 0) return;
  const now = performance.now();
  if (now - lastPenAt < 20) return;
  lastPenAt = now;
  const c = getCtx();
  if (!c) return;
  ensurePen(c);
  if (!penGain || !penFilter) return;
  const cfg = PEN[resolvePack()];
  const sp = Math.min(1, Math.max(0, speed));
  penGain.gain.setTargetAtTime(cfg.gain * (0.35 + 0.65 * sp) * (remote ? 0.6 : 1), c.currentTime, 0.03);
  penFilter.frequency.setTargetAtTime(cfg.freq * (0.8 + 0.6 * sp), c.currentTime, 0.03);
  penFilter.Q.value = cfg.q;
  clearTimeout(penTimer);
  penTimer = setTimeout(penStop, 140); // no new points for a moment = the pen lifted
}

/** The pen is up: fade the scratch out. */
export function penStop() {
  clearTimeout(penTimer);
  if (ctx && penGain) penGain.gain.setTargetAtTime(0, ctx.currentTime, 0.05);
}
