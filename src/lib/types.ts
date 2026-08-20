// Shared message shapes for each Portal channel.

// How often/aggressively the AI tries to guess while someone else draws.
// Chosen once by the room creator (see game-config below) — see
// GUESS_INTERVAL_MS in Game.tsx for what each level actually does.
export type AiDifficulty = "easy" | "normal" | "hard";

// draw:<room>  — high-frequency ephemeral stroke deltas from the current drawer.
export type StrokePoint = { x: number; y: number };

export type DrawMsg =
  | {
      kind: "stroke";
      points: StrokePoint[];
      // A literal hex, or the sentinel "auto" for the theme-default ink
      // swatch — that one only makes sense relative to *your own* canvas
      // background, so each viewer resolves it against their own local
      // theme on receipt instead of everyone sharing the drawer's literal
      // color (which could be invisible if their themes don't match).
      color: string;
      size: number;
    }
  | { kind: "clear" };

// chat:<room>  — guesses (humans + AI) and system events. Persistent.
export type ChatMsg =
  | { kind: "guess"; name: string; text: string; ai?: boolean }
  | { kind: "system"; text: string }
  | {
      kind: "correct";
      name: string;
      word: string;
      ai?: boolean;
      // Who actually won, for the client that should celebrate. Matching on
      // `name` would misfire if two people picked the same one.
      playerId?: string;
    };

// game:<room>  — round control, published by whoever is drawing.
export type GameMsg =
  | {
      kind: "round-start";
      drawerId: string;
      drawerName: string;
      masked: string; // e.g. "_ _ _ _" (length hint, no letters)
      endsAt: number; // epoch ms
      // The AI is drawing this round. `drawerId` still points at the human
      // who started it — the bot has no session of its own, so that client
      // hosts the round: it fetches the strokes, publishes them, and holds
      // the word to validate guesses, exactly as a human drawer would.
      aiDrawing?: boolean;
    }
  | {
      kind: "round-end";
      word: string;
      winner?: string;
      ai?: boolean;
      // Points awarded to the winner this round. Speed-based (faster guess =
      // more), so the scoreboard rewards quick reads instead of a flat +1.
      // Optional for backward-compatibility with rounds recorded before this
      // existed (they tally as a single point). Streak bonuses are computed at
      // tally time from the sequence of winners, not stored here.
      points?: number;
    }
  // A finished round's drawing, captured by the client that held the word and
  // shared so everyone can see the gallery on the end-of-game podium. Sent as
  // its own message (not folded into round-end) to keep round-end tiny and its
  // derivations untouched. `image` is a small downscaled JPEG data URL.
  | {
      kind: "round-art";
      image: string;
      word: string;
      winner?: string;
      ai?: boolean;
    }
  // A deliberate departure (the "Leave" button) — lets everyone drop this
  // player from the roster immediately instead of waiting out the activity
  // heartbeat's expiry window. (Sent as a regular persistent message: the
  // SDK silently drops incoming `ephemeral: true` sends rather than
  // delivering them, so that flag isn't usable for this.)
  | { kind: "player-left"; playerId: string }
  // Broadcasts this session's display name. Presence `metadata` only seeds a
  // *new* channel handle and `setMetadata()` doesn't actually get
  // re-announced by the server (verified against the live backend — the
  // docs claim otherwise), so it's the only reliable way for a renamed or
  // rejoined player's name to reach everyone else.
  | { kind: "name-update"; playerId: string; name: string }
  // Whether the AI competes as a player. Room-wide rather than per-client so
  // everyone's roster agrees — the guessing loop itself only ever runs on the
  // drawer's machine, so a local-only flag would let one player silently
  // disable a bot everyone else still sees listed.
  | { kind: "ai-toggle"; enabled: boolean }
  // Anyone can ask for a clue or a different word, but only the client that
  // holds the word (the drawer, or the host of an AI turn) can act on it —
  // so the ask is broadcast and that client answers.
  | { kind: "round-request"; what: "hint" | "skip" }
  // Total rounds for this game, chosen by whoever created the room. Broadcast
  // once so every client (including late joiners, via history) agrees on when
  // the game ends and the podium shows. 0 = unlimited (legacy / no config).
  // `aiDifficulty` and `customWords` ride along on the same one-time
  // broadcast — all three are room-wide choices the creator makes once,
  // before anyone can be drawing. An empty/absent `customWords` means the
  // room uses the default word bank.
  | {
      kind: "game-config";
      totalRounds: number;
      aiDifficulty?: AiDifficulty;
      customWords?: string[];
    }
  // "Play again" in the same room: marks a new baseline so rounds-played and
  // scores are counted only from here on, without leaving for a new room.
  | { kind: "game-reset" }
  // Room leader removes a player. Broadcast rather than a direct message —
  // there's no way to target one recipient over Portal — so every client
  // sees it and only the matching `playerId` acts on it (leaves).
  | { kind: "kick"; playerId: string };

// cursor:<room> — posición del lápiz del dibujante, normalizada 0..1 respecto
// al lienzo. Muy frecuente y desechable: el canal se usa con `history: "none"`
// y cada cliente olvida un cursor que deja de reportarse.
export type CursorMsg =
  | { kind: "move"; x: number; y: number; name: string }
  | { kind: "gone" };

// reactions:<room> — emojis que cualquiera lanza y flotan en la pantalla de
// todos. Fan-out puro, sin estado que reconstruir.
export type ReactionMsg = { kind: "emoji"; emoji: string; name: string };

export const ROOM = "main";
export const drawChannel = (roomCode = ROOM) => `draw:${roomCode}`;
export const chatChannel = (roomCode = ROOM) => `chat:${roomCode}`;
export const gameChannel = (roomCode = ROOM) => `game:${roomCode}`;
export const cursorChannel = (roomCode = ROOM) => `cursor:${roomCode}`;
export const reactionsChannel = (roomCode = ROOM) => `reactions:${roomCode}`;
