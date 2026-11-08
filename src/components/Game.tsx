"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useChannel } from "@/lib/realtime";
import Canvas from "./Canvas";
import Celebration from "./Celebration";
import Chat, { FeedItem } from "./Chat";
import Notifications, { useToasts } from "./Notifications";
import PlayerBadge from "./PlayerBadge";
import Reactions from "./Reactions";
import PlayersPanel, { PlayerRow } from "./PlayersPanel";
import Podium from "./Podium";
import Scoreboard from "./Scoreboard";
import Status from "./Status";
import ThemeToggle from "./ThemeToggle";
import SkinPicker from "./SkinPicker";
import ScoreHelp from "./ScoreHelp";
import SoundPanel from "./SoundPanel";
import {
  AiDifficulty,
  ChatMsg,
  GameMsg,
  chatChannel,
  gameChannel,
} from "@/lib/types";
import { isCorrect, maskWord, pickWord, recentWords, rememberWord, revealLetters } from "@/lib/words";
import { DIFFICULTY_LABEL, GUESS } from "@/lib/difficulty";
import { MusicMode, playSound, setMusicMode, useSoundPrefs } from "@/lib/sound";
import { drawerPay, guessPoints, hintBudget, skipBudget, streakBonus, totalRoundsFor } from "@/lib/scoring";

const ROUND_MS = 90_000;
// Canvas coordinate space the AI's normalized 0..1 strokes are scaled into —
// must match Canvas.tsx's fixed W/H backing store.
const CANVAS_W = 900;
const CANVAS_H = 600;
const MAX_HINTS = 3; // per round, so clues never add up to the answer
const HINT_COOLDOWN_MS = 5_000;
const AI_TURN_ID = "__ai__"; // the bot's slot in the turn order
// Points per publish and pace between publishes for the AI's own drawing.
// Viewers replay each chunk over a few frames (see Canvas), so bigger, rarer
// chunks look just as smooth: ~4 broadcasts/s instead of ~11 at the same
// drawing speed (6 points / 240 ms ≈ 2 points / 90 ms before).
const AI_CHUNK = 6;
const AI_STROKE_MS = 240;
const AI_PAUSE_MS = 260; // pen lift between strokes
const LOBBY_WAIT_MS = 30_000; // waiting room countdown before each round begins
// Scoring lives in src/lib/scoring.ts (shared with the "?" help).

type Round = {
  active: boolean;
  drawerId: string;
  drawerName: string;
  masked: string;
  endsAt: number;
  id: number;
  aiDrawing: boolean;
  /** Word changes so far this turn; the clock does not restart on a change. */
  reroll: number;
};

const NO_ROUND: Round = {
  active: false,
  drawerId: "",
  drawerName: "",
  masked: "",
  endsAt: 0,
  id: 0,
  aiDrawing: false,
  reroll: 0,
};

export default function Game({
  name,
  roomCode,
  laps: lapsProp,
  aiDifficulty: aiDifficultyProp,
  customWords: customWordsProp,
  onLeave,
}: {
  name: string;
  roomCode: string;
  laps?: number;
  aiDifficulty?: AiDifficulty;
  customWords?: string[];
  onLeave: () => void;
}) {
  // ---- Channels -------------------------------------------------------------
  // Players who just hit "Leave" — excluded from the roster the instant their
  // player-left broadcast arrives, instead of waiting out the activity
  // heartbeat's ~5s expiry. Self-clears after a few seconds so it never
  // permanently blocks the same (session-stable, anonymous) id from
  // reappearing if they rejoin.
  const [justLeftIds, setJustLeftIds] = useState<Set<string>>(() => new Set());
  // Set the instant our own player-left in a "kick" arrives — a separate
  // effect further down (once pushToast/onLeave are in scope) reacts to it.
  const [kicked, setKicked] = useState(false);
  // Mirrors `meId` (declared below, after this channel) so this same-render
  // onMessage closure can compare against a value that isn't in scope yet at
  // the point it's written syntactically — see the other *Ref mirrors below.
  const meIdRef = useRef<string | undefined>(undefined);

  const game = useChannel<GameMsg>({
    channelId: gameChannel(roomCode),
    // No `metadata` here on purpose: Lobby pre-warms this channel (with no
    // options) while the player types, so Portal keeps those first options and
    // would warn that a second creation's `metadata` is ignored. We don't rely
    // on presence metadata anyway — names propagate via `name-update`.
    onMessage: (m) => {
      if (m.content.kind === "round-request") {
        // Only the client holding the word can answer these.
        roundRequestRef.current?.(m.content.what, m.sender.id);
        return;
      }
      if (m.content.kind === "kick") {
        if (m.content.playerId === meIdRef.current) setKicked(true);
        return;
      }
      if (m.content.kind !== "player-left") return;
      const id = m.content.playerId;
      setJustLeftIds((prev) => (prev.has(id) ? prev : new Set(prev).add(id)));
      setTimeout(() => {
        setJustLeftIds((prev) => {
          if (!prev.has(id)) return prev;
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      }, 6000);
    },
  });

  // Display names, keyed by player id — kept current via our own
  // `name-update` broadcast (see the effect below) rather than presence
  // `metadata`, which only seeds a *new* channel handle and doesn't actually
  // get re-announced by `setMetadata()` on this backend (verified live).
  // Derived from `game.messages` (not accumulated via onMessage): onMessage
  // only fires for messages delivered live, never for ones a late joiner
  // gets from history backfill — reading `messages` instead covers both, the
  // same way the round derivation below does.
  const namesById = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of game.messages) {
      if (m.content.kind === "name-update") map.set(m.content.playerId, m.content.name);
    }
    return map;
  }, [game.messages]);

  // Game length, from the creator's broadcast config. New rooms use `laps`
  // (one lap = everyone draws once); `totalRounds` is the legacy fixed count.
  // Falls back to the local prop for the creator before their own broadcast
  // echoes back, then to 0 = unlimited. The resulting number of rounds is
  // derived further down, once the turn order (the lap size) is known.
  const { configuredLaps, configuredRounds } = useMemo(() => {
    let laps = 0;
    let rounds = 0;
    for (const m of game.messages) {
      if (m.content.kind !== "game-config") continue;
      rounds = m.content.totalRounds;
      if (m.content.laps) laps = m.content.laps;
    }
    return { configuredLaps: laps, configuredRounds: rounds };
  }, [game.messages]);
  const laps = configuredLaps || lapsProp || 0;

  // Same idea as totalRounds: the creator's broadcast wins for everyone
  // (including late joiners, via history); "normal" if nobody ever set one.
  const configuredDifficulty = useMemo(() => {
    let d: AiDifficulty | undefined;
    for (const m of game.messages) {
      if (m.content.kind === "game-config" && m.content.aiDifficulty) d = m.content.aiDifficulty;
    }
    return d;
  }, [game.messages]);
  const aiDifficulty: AiDifficulty = configuredDifficulty ?? aiDifficultyProp ?? "normal";

  // Same broadcast, same "creator's value wins for everyone" rule — an empty
  // list means the room uses the default word bank (see pickWord).
  const configuredCustomWords = useMemo(() => {
    let words: string[] | undefined;
    for (const m of game.messages) {
      if (m.content.kind === "game-config" && m.content.customWords?.length) {
        words = m.content.customWords;
      }
    }
    return words;
  }, [game.messages]);
  const customWords = configuredCustomWords ?? customWordsProp;

  // Latest ai-toggle wins; the AI plays by default until someone benches it.
  const aiEnabled = useMemo(() => {
    let enabled = true;
    for (const m of game.messages) {
      if (m.content.kind === "ai-toggle") enabled = m.content.enabled;
    }
    return enabled;
  }, [game.messages]);

  const wordRef = useRef<string | null>(null); // known only to the drawer
  // Canvas parks a "paint + publish this stroke" function here so the host of
  // an AI round can play the bot's drawing out through the same draw channel.
  const drawStrokeRef = useRef<((points: { x: number; y: number }[]) => void) | null>(null);
  const endedRef = useRef(false); // guards against double round-end
  // Answers hint/skip asks from other players; only wired up on the client
  // that actually holds the word (see the effect further down).
  const roundRequestRef = useRef<((what: "hint" | "skip", by: string) => void) | null>(null);
  const hintsRef = useRef<string[]>([]); // clues already given this round
  const lastHintAtRef = useRef(0);
  const hintsExhaustedSaidRef = useRef(false);
  const isDrawerRef = useRef(false);
  // Current round's end time, so endRound (kept stable, not re-created per
  // render) can read how much time was left to award speed points.
  const roundEndsAtRef = useRef(0);
  const nameRef = useRef(name);
  const sendChatRef = useRef<((m: ChatMsg) => void) | null>(null);
  const endRoundRef = useRef<((winner?: string, ai?: boolean) => void) | null>(null);

  useEffect(() => {
    nameRef.current = name;
  }, [name]);

  const chat = useChannel<ChatMsg>({
    channelId: chatChannel(roomCode),
    // Same as the game channel above — Lobby pre-warms it first without
    // options, so a `metadata` here would only trigger the "already created
    // with different options" warning and be ignored.
    onMessage: (m) => {
      // The drawer is the authority that validates human guesses.
      if (!isDrawerRef.current || endedRef.current) return;
      const c = m.content;
      if (c.kind !== "guess" || c.ai) return;
      if (c.name === nameRef.current) return;
      const word = wordRef.current;
      if (!word) return;
      if (isCorrect(c.text, word)) {
        sendChatRef.current?.({
          kind: "correct",
          name: c.name,
          word,
          // The guesser's own client is the one that should celebrate.
          ...(m.sender?.id ? { playerId: m.sender.id } : {}),
        });
        endRoundRef.current?.(c.name);
      }
    },
  });

  useEffect(() => {
    sendChatRef.current = (content: ChatMsg) => void chat.send({ content });
  }, [chat.send]);

  // The initial history page isn't fetched automatically on connect (verified
  // live: `messages` comes back empty with `hasPrevious: true` until this is
  // called at least once) — without it, a late joiner's `game.messages` is
  // missing everything that happened before they connected: the active
  // round's round-start, and other players' name-update broadcasts.
  const loadedGameHistory = useRef(false);
  useEffect(() => {
    if (game.status !== "ready" || loadedGameHistory.current) return;
    loadedGameHistory.current = true;
    void game.loadPrevious();
  }, [game.status, game.loadPrevious]);

  const loadedChatHistory = useRef(false);
  const [chatHistoryLoaded, setChatHistoryLoaded] = useState(false);
  useEffect(() => {
    if (chat.status !== "ready" || loadedChatHistory.current) return;
    loadedChatHistory.current = true;
    void chat.loadPrevious().finally(() => setChatHistoryLoaded(true));
  }, [chat.status, chat.loadPrevious]);


  // ---- Derived round state --------------------------------------------------
  const round: Round = useMemo(() => {
    // Take the MOST RECENT round-start. It's the active round unless a round-end
    // came after it or it already expired. Using the latest (by global seq
    // order) means every client converges on the same round, so simultaneous
    // "I'll draw" clicks collapse to one round — and a freshly clicked start is
    // always the one that wins (old expired starts in history are ignored).
    let start: (GameMsg & { kind: "round-start" }) | null = null;
    let lastStartIdx = -1;
    let lastEndIdx = -1;
    game.messages.forEach((m, i) => {
      if (m.content.kind === "round-start") {
        start = m.content;
        lastStartIdx = i;
      } else if (m.content.kind === "round-end") {
        lastEndIdx = i;
      }
    });
    if (!start || lastEndIdx > lastStartIdx) return NO_ROUND;
    const s = start as GameMsg & { kind: "round-start" };

    if (Date.now() > s.endsAt) return NO_ROUND;
    return {
      active: true,
      drawerId: s.drawerId,
      drawerName: s.drawerName,
      masked: s.masked,
      endsAt: s.endsAt,
      // endsAt is the same across word changes (the clock keeps running), so
      // the reroll counter is what makes the id — and the board key — change.
      id: s.endsAt + (s.reroll ?? 0),
      aiDrawing: s.aiDrawing === true,
      reroll: s.reroll ?? 0,
    };
  }, [game.messages]);

  const meId = game.me?.id;
  // Whoever started the round holds the drawer slot even when the AI is the
  // one drawing — they host it (publish its strokes, validate guesses).
  const isDrawer = round.active && !!meId && round.drawerId === meId;

  useEffect(() => {
    isDrawerRef.current = isDrawer;
  }, [isDrawer]);

  const roundRerollRef = useRef(0);
  useEffect(() => {
    roundEndsAtRef.current = round.active ? round.endsAt : 0;
    roundRerollRef.current = round.active ? round.reroll : 0;
  }, [round.active, round.endsAt, round.reroll]);

  // The scoreboard key of whoever holds the pen (a display name, or the AI),
  // readable from endRound even when a client that isn't drawing ends the round.
  const roundDrawerRef = useRef("");
  useEffect(() => {
    roundDrawerRef.current = round.active ? (round.aiDrawing ? "🤖 IA" : round.drawerName) : "";
  }, [round.active, round.aiDrawing, round.drawerName]);

  useEffect(() => {
    meIdRef.current = meId;
  }, [meId]);

  // Tell everyone our current name — on first join, and again if it ever
  // changes (e.g. Leave then rejoin under a new name in the same tab).
  useEffect(() => {
    if (!meId) return;
    void game.send({ content: { kind: "name-update", playerId: meId, name } });
  }, [meId, name, game.send]);

  // The room creator announces the chosen round count once, so everyone
  // (including late joiners, via history) agrees on when the game ends.
  const sentConfigRef = useRef(false);
  useEffect(() => {
    if (!meId || !lapsProp || sentConfigRef.current) return;
    if (configuredLaps || configuredRounds) {
      sentConfigRef.current = true; // someone already configured it
      return;
    }
    sentConfigRef.current = true;
    void game.send({
      content: {
        kind: "game-config",
        totalRounds: 0,
        laps: lapsProp,
        ...(aiDifficultyProp ? { aiDifficulty: aiDifficultyProp } : {}),
        ...(customWordsProp?.length ? { customWords: customWordsProp } : {}),
      },
    });
  }, [meId, lapsProp, aiDifficultyProp, customWordsProp, configuredLaps, configuredRounds, game.send]);

  // ---- Liveness heartbeat ----------------------------------------------------
  // Portal's own `presence` reflects the socket's state server-side, which can
  // lag well behind an actual disconnect (a clean tab close alone can take
  // ~30s+ to propagate as a "leave", longer for a crash/network drop — there's
  // no client knob to tighten that). `activity` entries instead self-expire on
  // every OTHER client after ACTIVITY_EXPIRY_MS (5s) if they stop arriving, so
  // pinging "online" here gives everyone a roster that actually clears out
  // within seconds of someone disappearing, regardless of why.
  useEffect(() => {
    if (!meId) return;
    const ping = game.sendActivity;
    ping("online");
    const iv = setInterval(() => ping("online"), 3500);
    return () => clearInterval(iv);
  }, [meId, game.sendActivity]);

  // ---- Turn rotation: who draws next ---------------------------------------
  // Everyone currently pinging "online" (see heartbeat above), plus ourselves
  // so we never briefly vanish from our own list before our first ping echoes
  // back, sorted so every client agrees on the order.
  const roster = useMemo(() => {
    const ids = new Set<string>();
    for (const a of game.activity) {
      if (a.kind === "online") ids.add(a.userId);
    }
    if (meId) ids.add(meId);
    for (const id of justLeftIds) ids.delete(id);
    return [...ids].sort();
  }, [game.activity, meId, justLeftIds]);

  // Room leader = first id in the (deterministically sorted) roster, so every
  // client agrees without electing anyone. If they leave, the next player
  // inherits it automatically. The leader owns room-level decisions (whether
  // the AI plays) and hosts the AI's turns.
  const leaderId = roster[0];
  const isLeader = !!meId && leaderId === meId;

  // The room's actual creator — whoever sent the one-time game-config
  // broadcast (only the client that came from Lobby's "create" flow ever
  // does, see the sentConfigRef effect below) — as opposed to `leaderId`,
  // which is deliberately just "whoever currently sorts first" and can jump
  // to a brand new joiner the instant they connect. That's fine for
  // `leaderId`'s job (AI hosting/watchdogs need *someone* reliably present,
  // not a specific person), but it's the wrong thing to gate a real
  // privilege like kicking on — a newcomer could otherwise outrank and
  // remove the person who made the room. Sticky to the original creator:
  // doesn't transfer if they leave, so a room can go host-less rather than
  // handing kick power to whoever happens to be around.
  const creatorId = useMemo(() => {
    for (const m of game.messages) {
      if (m.content.kind === "game-config") return m.sender.id;
    }
    return undefined;
  }, [game.messages]);
  const isCreator = !!meId && creatorId === meId;

  // Turn order: everyone present, plus the AI as its own participant when it's
  // in the game — it takes a turn like any other player rather than borrowing
  // someone else's. Rounds played (from history, which every client shares)
  // advances the pointer, so all clients agree on whose turn it is.
  const turnOrder = useMemo(
    () => (aiEnabled ? [...roster, AI_TURN_ID] : roster),
    [roster, aiEnabled],
  );

  // "Play again" drops a game-reset marker; everything after it belongs to the
  // current game. -1 when there's never been a reset (whole history counts).
  const lastResetIdx = useMemo(() => {
    let idx = -1;
    game.messages.forEach((m, i) => {
      if (m.content.kind === "game-reset") idx = i;
    });
    return idx;
  }, [game.messages]);

  // Counts rounds that *finished* in the current game, not ones that started —
  // so re-rolling the word mid-turn (a "skip") replaces the round without
  // handing the turn to the next player.
  const roundsPlayed = useMemo(
    () =>
      game.messages.filter(
        (m, i) => i > lastResetIdx && m.content.kind === "round-end",
      ).length,
    [game.messages, lastResetIdx],
  );

  // The lap size is frozen by the first round of the game (every participant
  // present then draws once per lap), so the total doesn't move if people come
  // and go. Until the first round starts it follows the live turn order.
  const frozenLapSize = useMemo(() => {
    for (let i = lastResetIdx + 1; i < game.messages.length; i++) {
      const c = game.messages[i].content;
      if (c.kind === "round-start" && c.participants) return c.participants;
    }
    return undefined;
  }, [game.messages, lastResetIdx]);
  const lapSize = frozenLapSize ?? Math.max(1, turnOrder.length);
  const totalRounds = laps > 0 ? totalRoundsFor(laps, lapSize) : configuredRounds || 0;
  const participantsRef = useRef(1);
  participantsRef.current = turnOrder.length;

  // ---- Help budget: hints and word changes per player, per game ---------------
  // Scales with the length of the game (see scoring.ts). Counted from the
  // word-holder's "budget-use" messages, so every client agrees, and reset by
  // "Play again" like the scores.
  const gameLaps = laps > 0 ? laps : totalRounds > 0 ? Math.max(1, Math.round(totalRounds / lapSize)) : 0;
  const helpUsed = useMemo(() => {
    const used = { hint: new Map<string, number>(), skip: new Map<string, number>() };
    game.messages.forEach((m, i) => {
      if (i <= lastResetIdx || m.content.kind !== "budget-use") return;
      const map = used[m.content.what];
      map.set(m.content.by, (map.get(m.content.by) ?? 0) + 1);
    });
    return used;
  }, [game.messages, lastResetIdx]);
  const hintsLeft = Math.max(0, hintBudget(gameLaps) - (meId ? helpUsed.hint.get(meId) ?? 0 : 0));
  const skipsLeft = Math.max(0, skipBudget(gameLaps) - (meId ? helpUsed.skip.get(meId) ?? 0 : 0));
  // The word-holder checks other players' requests against the latest counts.
  const helpRef = useRef({ used: helpUsed, laps: gameLaps });
  helpRef.current = { used: helpUsed, laps: gameLaps };

  // The game ends once the configured number of rounds have finished.
  const gameOver = totalRounds > 0 && roundsPlayed >= totalRounds;

  const nextTurnId = turnOrder.length ? turnOrder[roundsPlayed % turnOrder.length] : undefined;
  const isAiTurn = nextTurnId === AI_TURN_ID;
  const isMyTurn = !!meId && nextTurnId === meId;
  // The bot has no client of its own, so on its turn the leader quietly hosts
  // it: fetches the drawing, publishes the strokes, holds the word.
  const iStartNextRound = isMyTurn || (isAiTurn && isLeader);


  const players: PlayerRow[] = useMemo(() => {
    return roster.map((id) => ({
      id,
      name: id === meId ? name : namesById.get(id) ?? "player",
      isMe: id === meId,
      isLeader: id === leaderId,
      isCreator: id === creatorId,
      // On an AI turn the drawerId is just the human hosting it — the pencil
      // belongs on the bot's row, not theirs.
      isDrawer: round.active && !round.aiDrawing && id === round.drawerId,
      isTyping: chat.typing.includes(id),
    }));
  }, [
    roster,
    meId,
    name,
    namesById,
    leaderId,
    creatorId,
    round.active,
    round.aiDrawing,
    round.drawerId,
    chat.typing,
  ]);

  // Every word already played in this room (all games, not just the current
  // one), so "Nueva partida" doesn't reopen with the same words.
  const playedWords = useMemo(() => {
    const out: string[] = [];
    for (const m of game.messages) {
      if (m.content.kind === "round-end" && m.content.word && m.content.word !== "?") out.push(m.content.word);
    }
    return out;
  }, [game.messages]);

  /** Picks the next word: never one played in this room while others remain, and preferably not one this device saw lately. */
  const nextWord = useCallback(
    (alsoAvoid: string[] = []) => {
      const word = pickWord(customWords, [[...playedWords, ...alsoAvoid], recentWords()]);
      rememberWord(word);
      return word;
    },
    [customWords, playedWords],
  );

  // ---- Round control --------------------------------------------------------
  const lastStartRef = useRef(0); // local debounce against double-clicks
  const startRound = useCallback(
    (aiDrawing = false) => {
      // Don't start if there's already an active round, or if we just started
      // one (guards the double-click / double-fire cases locally). The first-wins
      // derivation above handles the cross-client race.
      if (!meId || round.active) return;
      const now = Date.now();
      if (now - lastStartRef.current < 2000) return;
      lastStartRef.current = now;
      const word = nextWord();
      wordRef.current = word;
      endedRef.current = false;
      hintsRef.current = [];
      lastHintAtRef.current = 0;
      hintsExhaustedSaidRef.current = false;
      const endsAt = now + ROUND_MS;
      void game.send({
        content: {
          kind: "round-start",
          drawerId: meId,
          drawerName: aiDrawing ? "🤖 IA" : name,
          masked: maskWord(word),
          endsAt,
          participants: Math.max(1, turnOrder.length),
          ...(aiDrawing ? { aiDrawing: true } : {}),
        },
      });
    },
    [game.send, meId, name, round.active, nextWord, turnOrder.length],
  );

  // Swap in a fresh word for the *same* turn. Publishing a new round-start
  // (with no round-end in between) replaces the live round — the derivation
  // always takes the latest start — and since the turn pointer counts
  // round-ends, the current player keeps their turn.
  const reRollWord = useCallback(
    (aiDrawing: boolean) => {
      if (!meId) return;
      // Never hand back the word being skipped.
      const word = nextWord(wordRef.current ? [wordRef.current] : []);
      wordRef.current = word;
      endedRef.current = false;
      hintsRef.current = [];
      lastHintAtRef.current = 0;
      hintsExhaustedSaidRef.current = false;
      void game.send({
        content: {
          kind: "round-start",
          drawerId: meId,
          drawerName: aiDrawing ? "🤖 IA" : name,
          masked: maskWord(word),
          // Same deadline as the round being replaced: changing the word must
          // not hand out a fresh 90 seconds.
          endsAt: roundEndsAtRef.current || Date.now() + ROUND_MS,
          reroll: roundRerollRef.current + 1,
          ...(aiDrawing ? { aiDrawing: true } : {}),
        },
      });
    },
    [game.send, meId, name, nextWord],
  );


  const endRound = useCallback(
    (winner?: string, ai?: boolean) => {
      if (endedRef.current) return;
      endedRef.current = true;
      const word = wordRef.current ?? "?";
      wordRef.current = null;
      // Speed-based points: the more of the round's clock was left when the
      // guess landed, the bigger the bonus. Only awarded when there's a winner.
      let points: number | undefined;
      let paid: number | undefined;
      if (winner) {
        const endsAt = roundEndsAtRef.current;
        const secLeft = endsAt ? Math.max(0, (endsAt - Date.now()) / 1000) : 0;
        points = guessPoints(secLeft / (ROUND_MS / 1000));
        // The drawer earns the average of what the guessers got, so a drawing
        // turn is worth the same as a guessing turn (see src/lib/scoring.ts).
        paid = drawerPay(points, participantsRef.current);
      }
      const drawer = roundDrawerRef.current || undefined;
      // Share the round's drawing for the end-of-game gallery — only the client
      // that actually held the pen (or hosted the AI) has it on canvas, and
      // only if something was drawn.
      if (isDrawerRef.current) {
        const art = snapshotRef.current?.();
        if (art) {
          void game.send({ content: { kind: "round-art", image: art, word, winner, ai } });
        }
      }
      void game.send({
        content: {
          kind: "round-end",
          word,
          winner,
          ai,
          ...(points != null ? { points } : {}),
          ...(drawer && paid ? { drawer, drawerPoints: paid } : {}),
        },
      });
    },
    // game.send, not game: useChannel returns a fresh object every render, so
    // depending on the whole thing would make endRound unstable — and any
    // effect holding a timer that lists it as a dep would be torn down and
    // restarted on every render (see the AI loop below).
    [game.send],
  );

  useEffect(() => {
    endRoundRef.current = endRound;
  }, [endRound]);

  // Wired only on the client that holds the word, so hint/skip asks from
  // anyone in the room get answered exactly once.
  useEffect(() => {
    if (!isDrawer || !round.active) {
      roundRequestRef.current = null;
      return;
    }
    roundRequestRef.current = (what, by) => {
      if (endedRef.current) return;
      // Out of budget (e.g. asked from a stale screen): ignore it quietly.
      const { used, laps: budgetLaps } = helpRef.current;
      const budget = what === "skip" ? skipBudget(budgetLaps) : hintBudget(budgetLaps);
      if ((used[what].get(by) ?? 0) >= budget) return;
      if (what === "skip") {
        void game.send({ content: { kind: "budget-use", what: "skip", by } });
        void chat.send({
          content: {
            kind: "system",
            // Guessers otherwise just see the blanks silently change shape and
            // wonder whether they missed something.
            text: round.aiDrawing
              ? "⏭ Palabra nueva — la 🤖 IA está dibujando otra vez. ¡Olvida el dibujo anterior!"
              : `⏭ ${name} cambió la palabra — ¡a adivinar de nuevo!`,
          },
        });
        reRollWord(round.aiDrawing);
        return;
      }

      const word = wordRef.current;
      if (!word) return;
      // Keep clues from being spammed into a giveaway — but say so, otherwise
      // the request just vanishes and the button looks broken.
      if (hintsRef.current.length >= MAX_HINTS) {
        if (!hintsExhaustedSaidRef.current) {
          hintsExhaustedSaidRef.current = true;
          sendChatRef.current?.({
            kind: "system",
            text: "💡 No quedan más pistas en esta ronda.",
          });
        }
        return;
      }
      const now = Date.now();
      if (now - lastHintAtRef.current < HINT_COOLDOWN_MS) return;
      lastHintAtRef.current = now;
      void game.send({ content: { kind: "budget-use", what: "hint", by } });

      void (async () => {
        let hint: string | null = null;
        try {
          const res = await fetch("/api/hint", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ word, previous: hintsRef.current }),
          });
          const data = (await res.json()) as { ok: boolean; hint?: string };
          if (data.ok && data.hint) hint = data.hint;
        } catch {
          /* fall through to the letter reveal */
        }
        if (endedRef.current) return;
        // If the model is unavailable or refuses, still give something useful
        // rather than leaving the button feeling broken.
        const text = hint
          ? `💡 Pista: ${hint}`
          : `💡 Pista: ${revealLetters(word, hintsRef.current.length + 1)}`;
        hintsRef.current = [...hintsRef.current, hint ?? text];
        sendChatRef.current?.({ kind: "system", text });
      })();
    };
    // chat.send / reRollWord are the stable pieces; the whole `chat` object is
    // rebuilt every render (useChannel doesn't memoize) and would re-run this
    // needlessly on each countdown tick.
  }, [isDrawer, round.active, round.aiDrawing, name, chat.send, game.send, reRollWord]);

  // If we're the one holding the word, handle it right here. Broadcasting to
  // ourselves does NOT work: Portal delivers a message to every *other*
  // client's onMessage but never echoes it back to the sender (verified
  // against the live backend), so the drawer pressing their own Skip/Hint
  // would be silently dropped. Going direct is also instant — no round trip.
  function requestHint() {
    if (hintPending || !meId) return;
    if (hintsLeft <= 0) {
      pushToast("Ya usaste todas tus pistas de esta partida");
      return;
    }
    setHintPending(true);
    if (roundRequestRef.current) {
      roundRequestRef.current("hint", meId);
      return;
    }
    void game.send({ content: { kind: "round-request", what: "hint" } });
    // Safety net: a request that lands inside the word-holder's cooldown gets
    // no reply at all, so don't leave the button stuck on "Asking…".
    setTimeout(() => setHintPending(false), HINT_COOLDOWN_MS + 2000);
  }

  function requestSkip() {
    if (skipPending || !meId) return;
    if (skipsLeft <= 0) {
      pushToast("Ya usaste todos tus cambios de palabra de esta partida");
      return;
    }
    setSkipPending(true);
    if (roundRequestRef.current) {
      roundRequestRef.current("skip", meId);
      return;
    }
    void game.send({ content: { kind: "round-request", what: "skip" } });
    setTimeout(() => setSkipPending(false), 4000);
  }

  function submitGuess(text: string) {
    void chat.send({ content: { kind: "guess", name, text } });
    // While hosting an AI turn we're both the round's authority *and* a
    // player. The validator in chat's onMessage deliberately skips our own
    // messages, so our guess has to be checked right here.
    if (isDrawer && round.aiDrawing && !endedRef.current) {
      const word = wordRef.current;
      if (word && isCorrect(text, word)) {
        void chat.send({
          content: { kind: "correct", name, word, ...(meId ? { playerId: meId } : {}) },
        });
        endRound(name);
      }
    }
  }

  // The drawer (or the host of an AI round) can cut it short instead of
  // everyone sitting out the full timer — they're the one holding the word,
  // so they're the only client that can end it cleanly anyway.
  function endRoundNow() {
    const word = wordRef.current;
    void chat.send({
      content: {
        kind: "system",
        text: word
          ? `Ronda terminada — la palabra era «${word}».`
          : "Ronda terminada.",
      },
    });
    endRound();
  }

  // "Play again" from the podium — reset the game in the SAME room instead of
  // sending everyone back to the lobby. The game-reset marker rebaselines
  // rounds-played and scores for everyone; the waiting room + auto-start then
  // pick up a fresh game from turn one.
  function startNewGame() {
    void game.send({ content: { kind: "game-reset" } });
    void chat.send({ content: { kind: "system", text: "🔄 ¡Nueva partida! Marcador a cero." } });
  }

  function toggleAi() {
    void game.send({ content: { kind: "ai-toggle", enabled: !aiEnabled } });
    void chat.send({
      content: {
        kind: "system",
        text: aiEnabled ? "🤖 La IA se va a la banca." : "🤖 La IA entra al juego.",
      },
    });
  }

  // Creator-only — see the `creatorId` comment above for why this is *not*
  // `isLeader`. The target client removes itself on receipt (see the
  // `kicked` effect below) — there's no way to force another browser
  // offline, only to tell it to leave and have everyone else agree it's gone.
  function kickPlayer(id: string, playerName: string) {
    if (!isCreator) return;
    void game.send({ content: { kind: "kick", playerId: id } });
    void chat.send({
      content: { kind: "system", text: `👢 ${playerName} fue expulsado de la sala.` },
    });
  }

  // A deliberate "Leave" click is a controlled moment, unlike a crash/dropped
  // connection: we can announce it explicitly instead of leaving everyone
  // else to *infer* we're gone, which is bounded by Portal's ~5s
  // activity-expiry floor (see the roster effect below). Ephemeral — this is
  // a one-off signal, not something a late joiner needs replayed.
  function handleLeave() {
    if (meId) void game.send({ content: { kind: "player-left", playerId: meId } });
    if (isDrawer && round.active) {
      void chat.send({
        content: {
          kind: "system",
          text: `${name} salió — ronda terminada. Cualquiera puede empezar otra.`,
        },
      });
      endRound();
    }
    onLeave();
  }

  // ---- AI drawing (host of an AI round only) --------------------------------
  // The bot has no browser, so the client that started the round fetches its
  // doodle and plays it back through its own canvas — painting locally and
  // fanning out over the draw channel, point by point, so everyone watches it
  // appear like a human sketching rather than a finished image popping in.
  // If Gemini can't draw a word (quota, slow answer, garbled output), the AI
  // first swaps to another word and tries once more; only a second failure in
  // the same turn ends the round. Keyed by the turn's deadline, which a word
  // swap keeps, so it counts per turn. Doesn't touch the players' skip budget.
  const aiDrawRetryRef = useRef<{ turn: number; used: number }>({ turn: 0, used: 0 });
  const reRollWordRef = useRef(reRollWord);
  reRollWordRef.current = reRollWord;

  useEffect(() => {
    if (!isDrawer || !round.active || !round.aiDrawing) return;
    const word = wordRef.current;
    if (!word) return;
    let cancelled = false;
    const turn = round.endsAt;

    const giveUp = () => {
      if (cancelled) return;
      const r = aiDrawRetryRef.current;
      if (r.turn !== turn) aiDrawRetryRef.current = { turn, used: 0 };
      if (aiDrawRetryRef.current.used < 1) {
        aiDrawRetryRef.current.used += 1;
        sendChatRef.current?.({
          kind: "system",
          text: "🤖 La IA no supo dibujar esa palabra — prueba con otra…",
        });
        reRollWordRef.current(true);
        return;
      }
      sendChatRef.current?.({
        kind: "system",
        text: "🤖 La IA no pudo dibujar esa palabra — empezamos otra ronda.",
      });
      endRoundRef.current?.();
    };

    (async () => {
      let strokes: { points: { x: number; y: number }[] }[] = [];
      try {
        const res = await fetch("/api/draw", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ word, difficulty: aiDifficulty }),
        });
        const data = (await res.json()) as {
          ok: boolean;
          strokes?: { points: { x: number; y: number }[] }[];
        };
        if (!data.ok || !data.strokes?.length) {
          giveUp();
          return;
        }
        strokes = data.strokes;
      } catch {
        // Network error or a non-JSON answer (e.g. the platform timed out).
        giveUp();
        return;
      }

      const wait = (ms: number) =>
        new Promise<void>((r) => setTimeout(r, ms));

      for (const stroke of strokes) {
        // Scale the normalized 0..1 coords the route returns onto the canvas.
        const pts = stroke.points.map((p) => ({ x: p.x * CANVAS_W, y: p.y * CANVAS_H }));
        // Emit in small overlapping chunks so each publish continues the line
        // instead of leaving gaps between chunks.
        for (let i = 0; i < pts.length - 1; i += AI_CHUNK) {
          if (cancelled || endedRef.current) return;
          drawStrokeRef.current?.(pts.slice(i, i + AI_CHUNK + 1));
          await wait(AI_STROKE_MS);
        }
        if (cancelled || endedRef.current) return;
        await wait(AI_PAUSE_MS); // a beat between strokes, like lifting the pen
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isDrawer, round.active, round.aiDrawing, round.id, round.endsAt]);

  // ---- AI guessing loop (drawer only) --------------------------------------
  // Skipped while the AI is the one drawing — it would just be recognizing its
  // own doodle and winning instantly.
  useEffect(() => {
    if (!isDrawer || !round.active || !aiEnabled || round.aiDrawing) return;
    endedRef.current = false;
    let stopped = false;
    let lastGuess = ""; // per-round, so a new round can repeat an old guess
    let lastSnap: string | null = null; // to tell whether the drawing changed
    // Base cadence comes from the room's difficulty; the loop then adapts
    // around it — guessing at the base rate while the sketch is changing and
    // easing off toward `maxDelay` when it holds still.
    const base = GUESS.cycleMs[aiDifficulty];
    const loopStart = Date.now();
    const maxDelay = Math.min(base * 2, 12_000);
    let delay = base;
    let extraWait = 0; // set when the server says Gemini's quota is hit
    let timer: ReturnType<typeof setTimeout> | null = null;
    // The request currently in flight. Self-scheduling ticks already prevent
    // pile-ups (the next tick is only queued once this one settles), but we
    // still abort any straggler on teardown so a slow request from a finished
    // round can't resolve into the next one — and abort before firing a new
    // one as a belt-and-suspenders guard.
    let controller: AbortController | null = null;

    // `spent` = how long the last request took: the cycle is counted from the
    // START of an attempt, so a slow Gemini answer doesn't stretch every level.
    const schedule = (spent = 0) => {
      if (stopped) return;
      timer = setTimeout(tick, Math.max(GUESS.minGapMs, delay - spent, extraWait));
      extraWait = 0;
    };

    const tick = async () => {
      if (stopped || endedRef.current) return;
      // Easy gives the drawer a head start before the AI looks at the board.
      const grace = GUESS.graceMs[aiDifficulty] - (Date.now() - loopStart);
      if (grace > 0) {
        timer = setTimeout(tick, grace);
        return;
      }
      const startedAt = Date.now();
      const snap = snapshotRef.current?.();
      // Nothing on the board yet — wait the max interval and re-check.
      if (!snap) {
        delay = maxDelay;
        schedule();
        return;
      }
      // Guess at the base rate while the sketch is actively changing; ease off
      // (grow the delay toward the ceiling) when it's holding still.
      const changed = snap !== lastSnap;
      lastSnap = snap;
      delay = changed ? base : Math.min(maxDelay, Math.round(delay * 1.5));
      // Same picture as last time: the model already answered it, so asking
      // again only spends quota. Wait for the drawing to change.
      if (!changed) {
        schedule();
        return;
      }

      controller?.abort();
      const ac = new AbortController();
      controller = ac;
      try {
        const res = await fetch("/api/guess", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ image: snap, roomCode, difficulty: aiDifficulty }),
          signal: ac.signal,
        });
        const data = (await res.json()) as {
          ok: boolean;
          guess?: string;
          alternatives?: string[];
          skip?: boolean;
          backoffMs?: number;
        };
        // Quota hit: wait it out, and ask again about the SAME picture (the
        // change check below would otherwise skip it as "already answered").
        if (data.backoffMs) {
          extraWait = data.backoffMs;
          lastSnap = null;
        }
        // A 429 skip just means the server-side rate limit already covered
        // this tick (e.g. another room's burst, or a request still in
        // flight) — nothing to guess on, try again next interval.
        if (data.ok && data.guess && !stopped && !endedRef.current) {
          // Check for the win first, then decide whether the guess is worth
          // posting: a repeat of the previous tick's guess is just noise in the
          // chat (the model says "night" over and over at a sparse drawing),
          // but it still counts if it happens to be right.
          const word = wordRef.current;
          const won =
            !!word && [data.guess, ...(data.alternatives ?? [])].some((c) => isCorrect(c, word));
          if (data.guess !== lastGuess || won) {
            lastGuess = data.guess;
            sendChatRef.current?.({ kind: "guess", name: "IA", text: data.guess, ai: true });
          }
          if (won && word) {
            sendChatRef.current?.({ kind: "correct", name: "IA", word, ai: true });
            endRoundRef.current?.("IA", true);
          }
        }
      } catch {
        /* aborted (expected on teardown) or transient — try again next tick */
      } finally {
        if (controller === ac) controller = null;
        schedule(Date.now() - startedAt);
      }
    };

    schedule();

    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      controller?.abort();
    };
    // Deliberately NOT depending on endRound (reached via endRoundRef above):
    // anything that changes identity per render would clear and restart this
    // loop on every render — and since the countdown re-renders this component
    // every 500ms, the interval would never survive long enough to fire.
  }, [isDrawer, round.active, round.id, aiEnabled, aiDifficulty]);

  // ---- Countdown + auto end -------------------------------------------------
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const iv = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(iv);
  }, []);
  // End the round when time's up. Normally the drawer ends it; but a present
  // "watchdog" client (lowest id in the room) also ends it, so the round never
  // hangs if the drawer's tab is gone or asleep.
  useEffect(() => {
    if (!round.active || now <= round.endsAt) return;
    const isWatchdog = roster.length > 0 && roster[0] === meId;
    if (!isDrawer && !isWatchdog) return;
    endRound();
  }, [round.active, round.endsAt, now, isDrawer, roster, meId, endRound]);

  // Drawer disconnect: if the current drawer leaves the room (drops out of
  // presence), a present player ends the round after a short grace period so it
  // returns to the lobby instead of hanging. Only runs with a real roster.
  useEffect(() => {
    if (!round.active || isDrawer || !meId) return;
    console.log("[disc] check", {
      presenceKind: game.presence?.kind,
      count: game.presence?.count,
      roster,
      drawerId: round.drawerId,
      drawerPresent: roster.includes(round.drawerId),
    });
    if (game.presence?.kind !== "detailed") {
      console.log("[disc] presence is not 'detailed' — can't detect disconnect");
      return;
    }
    if (roster.length === 0 || roster[0] !== meId) {
      console.log("[disc] not the watchdog client");
      return;
    }
    if (roster.includes(round.drawerId)) return; // drawer still here
    console.log("[disc] drawer GONE → ending round in 4s");
    const t = setTimeout(() => {
      console.log("[disc] ending round now");
      endRound();
    }, 4000);
    return () => clearTimeout(t);
  }, [round.active, round.drawerId, isDrawer, roster, game.presence, meId, endRound]);

  // Reset the per-round "ended" guard at the start of every round, on every
  // client — so any client (drawer or watchdog) can end each round exactly once.
  useEffect(() => {
    if (round.active) endedRef.current = false;
  }, [round.active, round.id]);

  const secondsLeft = round.active ? Math.max(0, Math.ceil((round.endsAt - now) / 1000)) : 0;

  // ---- Abandoned round: the drawer disconnected ------------------------------
  // Fallback path for a crash/dropped connection — a deliberate "Leave" click
  // is handled instantly by handleLeave() above, which sends its own
  // round-end before the drawer even disconnects. This path exists for the
  // case where there's no chance to say goodbye: `roster` only drops the
  // drawer once their activity ping hasn't been renewed for
  // ACTIVITY_EXPIRY_MS (a fixed 5s inside the Portal SDK, not something we
  // can configure), so ~5s is the fastest this path can ever detect a real
  // disconnect. Only the drawer's own browser knows the word and validates
  // guesses (see the chat onMessage handler above), so once they're gone
  // nobody can mark a guess correct — end the round early instead of making
  // everyone wait out the full 90s timer.
  const drawerMissing =
    round.active && !!round.drawerId && !roster.includes(round.drawerId);
  // Only the lowest-sorted currently-present id acts, so connected clients don't
  // all race to publish the same round-end at once.
  const isAbandonLeader = drawerMissing && isLeader;

  const abandonedRoundIdRef = useRef<number | null>(null);
  useEffect(() => {
    if (!isAbandonLeader) return;
    const sendChat = chat.send;
    const sendGame = game.send;
    const drawerName = round.drawerName;
    const roundId = round.id;
    const timer = setTimeout(() => {
      if (abandonedRoundIdRef.current === roundId) return;
      abandonedRoundIdRef.current = roundId;
      void sendChat({
        content: {
          kind: "system",
          text: `${drawerName} salió — ronda terminada. Cualquiera puede empezar otra.`,
        },
      });
      void sendGame({ content: { kind: "round-end", word: "?" } });
    }, 1500); // short extra grace on top of the ~5s floor above, tuned down
    // from an earlier 6s now that this path only ever fires for real
    // disconnects (deliberate leaves take the instant path instead)
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- chat.send/game.send
    // are the stable pieces; the whole `chat`/`game` objects are recreated every
    // render (useChannel doesn't memoize its return value) and would reset this
    // timer before it ever fires.
  }, [isAbandonLeader, round.id, round.drawerName, chat.send, game.send]);

  // ---- Waiting room ---------------------------------------------------------
  // The waiting room shows whenever there is no active round (before the game
  // and between rounds). The countdown resets each time we return to it, then a
  // fresh round auto-starts when it hits zero.
  // State (not a ref) so the first render after a round ends still sees "not
  // armed yet" and shows a full countdown instead of a stale, long-expired start.
  const [waitStart, setWaitStart] = useState<number | null>(null);
  useEffect(() => {
    // Entered the waiting room (no active round) → restart the countdown.
    setWaitStart(round.active ? null : Date.now());
  }, [round.active]);

  const lobbySecondsLeft = round.active
    ? 0
    : waitStart === null
      ? Math.ceil(LOBBY_WAIT_MS / 1000)
      : Math.max(0, Math.ceil((waitStart + LOBBY_WAIT_MS - now) / 1000));

  // When the countdown ends, the client whose turn it is starts the round —
  // or the leader, standing in for the AI on its turn. Everyone computes the
  // same `nextTurnId`, so exactly one client fires; the round derivation and
  // startRound's debounce still dedupe if two ever raced.
  useEffect(() => {
    if (round.active || lobbySecondsLeft > 0 || !meId || gameOver) return;
    if (!iStartNextRound) return;
    startRound(isAiTurn);
  }, [round.active, lobbySecondsLeft, meId, gameOver, iStartNextRound, isAiTurn, startRound]);

  // ---- Scoreboard from round winners in the current game -------------------
  // Tallied from round-end winners (not chat "correct") so it shares the same
  // reset baseline as roundsPlayed — "Play again" clears the board too.
  const scoreData = useMemo(() => {
    const map = new Map<string, number>();
    // Track back-to-back wins to reward streaks. A round that ends with no
    // winner (timeout / abandon) breaks the streak.
    const wins = new Map<string, number>();
    let lastWinner: string | null = null;
    let streak = 0;
    game.messages.forEach((m, i) => {
      if (i <= lastResetIdx || m.content.kind !== "round-end") return;
      const c = m.content;
      if (!c.winner) {
        lastWinner = null;
        streak = 0;
        return;
      }
      const key = c.ai ? "🤖 IA" : c.winner;
      // `points` is speed-based; fall back to 1 for rounds recorded before the
      // scoring change so old games still tally sensibly.
      const pts = c.points ?? 1;
      streak = key === lastWinner ? streak + 1 : 0;
      lastWinner = key;
      wins.set(key, (wins.get(key) ?? 0) + 1);
      map.set(key, (map.get(key) ?? 0) + pts + streakBonus(streak));
      // The drawer's pay (present on rounds recorded after drawers got paid).
      if (c.drawer && c.drawerPoints) {
        map.set(c.drawer, (map.get(c.drawer) ?? 0) + c.drawerPoints);
      }
    });
    // Ties on points are broken by who guessed more words; anyone still level
    // with the leader after that shares the win.
    const entries = [...map.entries()].sort(
      (a, b) => b[1] - a[1] || (wins.get(b[0]) ?? 0) - (wins.get(a[0]) ?? 0),
    );
    const lead = entries[0];
    const leaders = lead
      ? entries
          .filter(([n, pts]) => pts === lead[1] && (wins.get(n) ?? 0) === (wins.get(lead[0]) ?? 0))
          .map(([n]) => n)
      : [];
    return { entries, leaders };
  }, [game.messages, lastResetIdx]);
  const scores = scoreData.entries;

  // Drawings from finished rounds in the current game, for the podium gallery.
  const gallery = useMemo(() => {
    const items: { image: string; word: string; winner?: string; ai?: boolean }[] = [];
    game.messages.forEach((m, i) => {
      if (i <= lastResetIdx || m.content.kind !== "round-art") return;
      const c = m.content;
      items.push({ image: c.image, word: c.word, winner: c.winner, ai: c.ai });
    });
    return items;
  }, [game.messages, lastResetIdx]);

  const feed: FeedItem[] = chat.messages.map((m) => ({ id: m.id, content: m.content }));

  // Most recent system line — used to release the hint/skip pending state the
  // moment the word-holder's answer actually shows up.
  const lastSystemId = useMemo(() => {
    for (let i = chat.messages.length - 1; i >= 0; i--) {
      if (chat.messages[i].content.kind === "system") return chat.messages[i].id;
    }
    return null;
  }, [chat.messages]);

  // The celebration belongs to whoever actually got it, so this is non-null
  // only when the latest win is ours. Everyone else still sees the green
  // "X guessed it" line in the chat feed.
  const myWinId = useMemo(() => {
    for (let i = chat.messages.length - 1; i >= 0; i--) {
      const c = chat.messages[i].content;
      if (c.kind !== "correct") continue;
      const mine = c.ai ? false : c.playerId ? c.playerId === meId : c.name === name;
      return mine ? chat.messages[i].id : null;
    }
    return null;
  }, [chat.messages, meId, name]);

  // ---- Avisos in-app --------------------------------------------------------
  const { toasts, push: pushToast } = useToasts();
  const notifiedRoundRef = useRef<number | null>(null);
  const notifiedTurnRef = useRef<string | null>(null);

  // Getting kicked plays out like a deliberate Leave: announce it (so our
  // roster row drops immediately for everyone else instead of waiting out
  // the activity heartbeat) and give the toast a beat to actually be seen
  // before handing back to the lobby.
  useEffect(() => {
    if (!kicked) return;
    pushToast("🚪 Te expulsaron de la sala.", "turn");
    if (meId) void game.send({ content: { kind: "player-left", playerId: meId } });
    const t = setTimeout(() => onLeave(), 1500);
    return () => clearTimeout(t);
  }, [kicked, meId, game.send, pushToast, onLeave]);

  useEffect(() => {
    if (!round.active || round.id === notifiedRoundRef.current) return;
    notifiedRoundRef.current = round.id;
    if (isDrawer && !round.aiDrawing) pushToast("✏️ ¡Te toca dibujar!", "turn");
    else if (round.aiDrawing) pushToast("🤖 La IA está dibujando — ¡a adivinar!");
    else pushToast(`🎨 Dibuja ${round.drawerName} — ¡a adivinar!`);
  }, [round.active, round.id, round.aiDrawing, round.drawerName, isDrawer, pushToast]);

  // Aviso anticipado en la sala de espera: saber que sigues tú antes de que
  // arranque la ronda es lo que evita el "¿ya empezó?".
  useEffect(() => {
    if (round.active || !nextTurnId) return;
    const key = `${nextTurnId}:${roundsPlayed}`;
    if (key === notifiedTurnRef.current) return;
    notifiedTurnRef.current = key;
    if (isMyTurn) pushToast("👉 Eres el siguiente en dibujar", "turn");
  }, [round.active, nextTurnId, roundsPlayed, isMyTurn, pushToast]);

  const [hintPending, setHintPending] = useState(false);
  const [skipPending, setSkipPending] = useState(false);

  // Clear the pending state as soon as the answer lands (or the round moves
  // on), rather than guessing at a fixed duration.
  useEffect(() => {
    setHintPending(false);
    setSkipPending(false);
  }, [lastSystemId, round.id]);

  // Sound is opt-out and remembered (pack, volume and mute live in
  // src/lib/sound.ts and are edited from the 🔊 panel) — an effect you can't
  // silence gets old fast. `muted` here only feeds Celebration's props.
  const { muted } = useSoundPrefs();

  // ---- Game sounds -------------------------------------------------------
  // Both effects use the same "prime on the first history-loaded
  // observation, only fire on a later transition" pattern as Celebration's
  // confetti trigger — otherwise a late joiner would get a sound blast the
  // instant their history backfill (an already-active round, or an
  // already-finished game) loads in.
  const roundSoundPrimedRef = useRef(false);
  const roundSoundSeenRef = useRef<number | null>(null);
  useEffect(() => {
    if (!chatHistoryLoaded) return;
    if (!roundSoundPrimedRef.current) {
      roundSoundPrimedRef.current = true;
      roundSoundSeenRef.current = round.id;
      return;
    }
    if (!round.active || round.id === roundSoundSeenRef.current) return;
    roundSoundSeenRef.current = round.id;
    // The AI's host only keeps the word to judge guesses, so it's not "your turn".
    playSound(isDrawer && !round.aiDrawing ? "yourTurn" : "roundStart");
  }, [round.active, round.id, round.aiDrawing, isDrawer, chatHistoryLoaded]);

  const victorySoundPrimedRef = useRef(false);
  const prevGameOverRef = useRef(false);
  useEffect(() => {
    if (!chatHistoryLoaded) return;
    if (!victorySoundPrimedRef.current) {
      victorySoundPrimedRef.current = true;
      prevGameOverRef.current = gameOver;
      return;
    }
    // Fanfare for the winner (or anyone sharing the win), a sad jingle for everyone else.
    if (gameOver && !prevGameOverRef.current) playSound(scoreData.leaders.includes(name) ? "victory" : "defeat");
    prevGameOverRef.current = gameOver;
  }, [gameOver, chatHistoryLoaded, scoreData.leaders, name]);

  // Clock: a tick per second for the last ten seconds of a round.
  useEffect(() => {
    if (round.active && secondsLeft >= 1 && secondsLeft <= 10) playSound("tick");
  }, [round.active, secondsLeft]);

  // Chat: others' guesses, someone getting it right, and hints. Primed on the
  // first history-loaded observation so a late joiner doesn't hear the whole
  // backlog replay. (Your own correct guess is Celebration's job.)
  const chatSoundCountRef = useRef<number | null>(null);
  useEffect(() => {
    if (!chatHistoryLoaded) return;
    const msgs = chat.messages;
    const seen = chatSoundCountRef.current;
    chatSoundCountRef.current = msgs.length;
    if (seen === null || msgs.length <= seen) return;
    for (let i = seen; i < msgs.length; i++) {
      const m = msgs[i];
      const c = m.content;
      if (c.kind === "correct") {
        if (c.playerId !== meId) playSound("otherCorrect");
      } else if (c.kind === "guess") {
        if (c.ai || m.sender.id !== meId) playSound("message");
      } else if (c.kind === "system" && c.text.startsWith("💡")) {
        playSound("hint");
      }
    }
  }, [chat.messages, chatHistoryLoaded, meId]);

  // A round that ends with nobody guessing it: the "time's up" sound (the
  // game-over fanfare covers the final round).
  const endSoundCountRef = useRef<number | null>(null);
  useEffect(() => {
    if (!chatHistoryLoaded) return;
    const seen = endSoundCountRef.current;
    endSoundCountRef.current = roundsPlayed;
    if (seen === null || roundsPlayed <= seen || gameOver) return;
    for (let i = game.messages.length - 1; i > lastResetIdx; i--) {
      const c = game.messages[i].content;
      if (c.kind === "round-end") {
        if (!c.winner) playSound("timeUp");
        break;
      }
    }
  }, [roundsPlayed, gameOver, chatHistoryLoaded, game.messages, lastResetIdx]);

  // People coming and going. Primed after the history loads, and our own id is
  // ignored, so joining a room doesn't announce everyone already in it.
  const rosterSoundRef = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (!chatHistoryLoaded) return;
    const now = new Set(roster);
    const before = rosterSoundRef.current;
    rosterSoundRef.current = now;
    if (!before) return;
    for (const id of now) if (!before.has(id) && id !== meId) playSound("join");
    for (const id of before) if (!now.has(id) && id !== meId) playSound("leave");
  }, [roster, chatHistoryLoaded, meId]);

  const snapshotRef = useRef<(() => string | null) | null>(null);

  // ---- UI -------------------------------------------------------------------
  // The host of an AI turn holds the word only to validate guesses — showing
  // it to them would hand them the answer in a round they're playing, so they
  // see the same masked hint as everyone else.
  const wordLabel = isDrawer && !round.aiDrawing ? wordRef.current ?? "" : round.masked;
  const nextTurnName = !nextTurnId
    ? ""
    : nextTurnId === meId
      ? name
      : namesById.get(nextTurnId) ?? "player";

  // Connecting to Portal (minting an anonymous identity + subscribing to
  // each channel) reliably takes a couple of seconds — verified against the
  // live backend, not something a client-side tweak can shrink much
  // further. Cover the real UI with a deliberate loading veil instead of
  // letting it limp in piecemeal (empty roster, "0 online", an
  // unresponsive canvas), which reads as broken rather than "still
  // loading" — but keep everything mounted underneath (rather than an
  // early return) so Canvas's own draw-channel connection still starts
  // immediately, in parallel with game/chat, instead of waiting for them.
  const connecting = game.status !== "ready" || chat.status !== "ready";

  // Background music follows what the game is doing: light in the waiting
  // room, full during a round, faster in its last seconds, silent when it's
  // over (or while connecting) — and stops for good when leaving the room.
  const urgentNow = round.active && secondsLeft <= 10;
  useEffect(() => {
    const mode: MusicMode = connecting || gameOver ? "off" : round.active ? (urgentNow ? "urgent" : "round") : "wait";
    setMusicMode(mode);
  }, [connecting, gameOver, round.active, urgentNow]);
  useEffect(() => () => setMusicMode("off"), []);

  return (
    // Layout: one column on phones/tablets portrait; from lg (tablet landscape,
    // small laptops) a 2-column grid — canvas left, players + chat stacked
    // right — and from xl the 3-column layout. Overlays are fixed/absolute,
    // so they never take a grid cell.
    <div
      onPointerDownCapture={(e) => {
        // A soft click for buttons in the game UI (reactions already have their own sound).
        const b = (e.target as HTMLElement).closest("button");
        if (b && !b.disabled && !b.getAttribute("aria-label")?.startsWith("Reaccionar")) playSound("click");
      }}
      className="pp-game relative mx-auto flex min-h-dvh w-full max-w-[1600px] flex-col gap-3 overflow-x-hidden p-3 sm:gap-4 sm:p-4 lg:grid lg:h-dvh lg:grid-cols-[minmax(0,1fr)_300px] lg:grid-rows-[auto_minmax(0,1fr)] xl:grid-cols-[224px_minmax(0,1fr)_340px] xl:grid-rows-[minmax(0,1fr)]">
      <Celebration trigger={myWinId} muted={muted} armed={chatHistoryLoaded} />
      <Notifications toasts={toasts} />

      {gameOver && (
        <Podium
          scores={scores}
          leaders={scoreData.leaders}
          totalRounds={totalRounds}
          gallery={gallery}
          onNewGame={startNewGame}
          onLeave={onLeave}
        />
      )}

      {connecting && (
        <div className="absolute inset-0 z-10 grid place-items-center bg-ink">
          <div className="flex flex-col items-center gap-3 text-center">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-fg/20 border-t-accent" />
            <p className="text-sm text-fg/60">Conectando a la sala {roomCode}…</p>
            <button onClick={onLeave} className="text-xs text-fg/40 underline hover:text-fg/60">
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* Left: scoreboard + players — always on screen from lg up, so the
          score is visible next to the board without scrolling. */}
      <div className="flex w-full min-w-0 flex-col gap-3 lg:col-start-2 lg:row-start-1 lg:max-h-[40dvh] lg:overflow-y-auto xl:col-start-1 xl:row-start-1 xl:h-full xl:max-h-none xl:overflow-hidden">
        <div className="hidden lg:block">
          <Scoreboard scores={scores} />
        </div>
      <PlayersPanel
        players={players}
        aiEnabled={aiEnabled}
        aiGuessing={round.active && !round.aiDrawing}
        aiDrawing={round.active && round.aiDrawing}
        canToggleAi={isLeader}
        onToggleAi={toggleAi}
        canKick={isCreator}
        onKick={kickPlayer}
      />
      </div>

      {/* Center: canvas + status */}
      <div className="order-first flex min-w-0 flex-1 flex-col gap-3 lg:order-none lg:col-start-1 lg:row-span-2 lg:row-start-1 lg:min-h-0 lg:overflow-y-auto xl:col-start-2 xl:row-span-1">
        <header className="pp-header flex min-w-0 flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:gap-2">
          <div className="flex w-full min-w-0 items-center justify-between gap-3 sm:w-auto sm:justify-start">
            <button
              onClick={handleLeave}
              className="pp-btn flex items-center gap-1 rounded-md border border-edge px-2.5 py-1 text-sm text-fg/60 hover:bg-fg/5 hover:text-fg/90"
              title="Salir de la sala"
            >
              ← Salir
            </button>
            <h1 className="pp-brand text-lg font-semibold">
              Pict<span className="text-accent">-Portal</span>
            </h1>
          </div>
          <div className="flex w-full min-w-0 flex-wrap items-center gap-2 sm:w-auto sm:justify-end sm:gap-3 lg:gap-5">
            <span className="pp-chip rounded-md bg-panel px-2 py-1 font-mono text-sm tracking-widest text-fg/80 sm:bg-transparent sm:p-0 sm:text-base">
              Sala: {roomCode}
            </span>
            {totalRounds > 0 && (
              <span className="pp-chip rounded-md border border-edge px-2 py-0.5 text-xs font-medium text-fg/70">
                Ronda {Math.min(roundsPlayed + 1, totalRounds)}/{totalRounds}
              </span>
            )}
            {aiEnabled && (
              <span
                title="Qué tan seguido intenta adivinar la IA"
                className="pp-chip rounded-md border border-edge px-2 py-0.5 text-xs font-medium text-fg/70"
              >
                🤖 {DIFFICULTY_LABEL[aiDifficulty]}
              </span>
            )}
            <Status status={game.status} />
            <div className="ml-auto flex min-w-0 items-center gap-1.5 text-xs text-fg/50 sm:ml-0">
              <span className="hidden sm:inline">eres</span>
              <PlayerBadge name={name} />
              <span className="max-w-24 truncate text-fg/80">{name}</span>
            </div>
            <SoundPanel />
            <ScoreHelp laps={gameLaps} />
            <SkinPicker />
            <ThemeToggle />
          </div>
        </header>

        <div className="pp-panel pp-word flex min-w-0 flex-wrap items-center justify-between gap-3 rounded-xl border border-edge bg-panel px-3 py-3 sm:px-4">
          {round.active ? (
            <>
              <div className="min-w-0 text-sm">
                {isDrawer && !round.aiDrawing ? (
                  <>
                    Estás dibujando:{" "}
                    <span className="pp-masked font-mono text-base font-semibold text-accent">
                      {wordLabel}
                    </span>
                  </>
                ) : (
                  <>
                    <span className="inline-flex items-center gap-1.5 text-fg/60">
                      {round.aiDrawing ? (
                        <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-accent/20 text-xs">
                          🤖
                        </span>
                      ) : (
                        <PlayerBadge name={round.drawerName} />
                      )}
                      {round.drawerName} está dibujando
                    </span>{" "}
                    <span className="pp-masked ml-2 font-mono tracking-widest text-fg/90">
                      {round.masked}
                    </span>
                  </>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                <div
                  className={`pp-timer font-mono text-lg ${
                    secondsLeft <= 10 ? "is-urgent text-red-400" : "text-fg/70"
                  }`}
                >
                  {secondsLeft}s
                </div>
                {(!isDrawer || round.aiDrawing) && (
                  <button
                    onClick={requestHint}
                    disabled={hintPending || hintsLeft <= 0}
                    title={
                      hintsLeft <= 0
                        ? "Ya usaste todas tus pistas de esta partida"
                        : `Pídele una pista a la IA (hasta ${MAX_HINTS} por ronda${
                            Number.isFinite(hintsLeft) ? `; te quedan ${hintsLeft} en la partida` : ""
                          })`
                    }
                    className="pp-btn rounded-md border border-edge px-3 py-1.5 text-sm text-fg/60 hover:bg-fg/5 hover:text-fg/90 disabled:opacity-50"
                  >
                    {hintPending ? "💡 Pidiendo…" : `💡 Pista${Number.isFinite(hintsLeft) ? ` (${hintsLeft})` : ""}`}
                  </button>
                )}
                {(isDrawer || round.aiDrawing) && (
                  <button
                    onClick={requestSkip}
                    disabled={skipPending || skipsLeft <= 0}
                    title={
                      skipsLeft <= 0
                        ? "Ya usaste todos tus cambios de palabra de esta partida"
                        : `Cambiar la palabra sin perder el turno ni reiniciar el tiempo${
                            Number.isFinite(skipsLeft) ? ` (te quedan ${skipsLeft} en la partida)` : ""
                          }`
                    }
                    className="pp-btn rounded-md border border-edge px-3 py-1.5 text-sm text-fg/60 hover:bg-fg/5 hover:text-fg/90 disabled:opacity-50"
                  >
                    {skipPending
                      ? "⏭ Cambiando…"
                      : `⏭ Cambiar palabra${Number.isFinite(skipsLeft) ? ` (${skipsLeft})` : ""}`}
                  </button>
                )}
                {isDrawer && (
                  <button
                    onClick={endRoundNow}
                    title="Terminar la ronda ahora y volver a la sala de espera"
                    className="pp-btn rounded-md border border-edge px-3 py-1.5 text-sm text-fg/60 hover:bg-fg/5 hover:text-fg/90"
                  >
                    Terminar ronda
                  </button>
                )}
              </div>
            </>
          ) : (
            <div className="flex w-full min-w-0 flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="text-sm">
                <div className="font-medium text-fg/80">Sala de espera</div>
                <div className="mt-1 flex items-center gap-1.5 text-xs text-fg/60">
                  <span className="text-fg/40">Siguiente:</span>
                  {isAiTurn ? (
                    <>
                      <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-accent/20 text-[10px]">
                        🤖
                      </span>
                      <span>IA</span>
                    </>
                  ) : nextTurnId ? (
                    <>
                      <PlayerBadge name={nextTurnName} />
                      <span>{isMyTurn ? "tú" : nextTurnName}</span>
                    </>
                  ) : (
                    <span>—</span>
                  )}
                  <span className="text-fg/40">· empieza en {lobbySecondsLeft}s</span>
                </div>
              </div>
              {iStartNextRound && (
                <button
                  onClick={() => startRound(isAiTurn)}
                  disabled={!meId}
                  className="pp-btn-primary shrink-0 rounded-md bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
                >
                  {isAiTurn ? "🤖 Empezar el turno de la IA" : "Empezar mi turno"}
                </button>
              )}
            </div>
          )}
        </div>

        {/* Phones: a one-line score strip above the board (the full
            scoreboard lives in the side column on larger screens). */}
        <MiniScores scores={scores} />

        {/* Reactions sit beside the board from sm up, under it on phones. */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
          <div className="min-w-0 flex-1">
            <Canvas
              key={round.id}
              isDrawer={isDrawer}
              snapshotRef={snapshotRef}
              drawStrokeRef={drawStrokeRef}
              aiDrawing={round.aiDrawing}
              roomCode={roomCode}
              name={name}
            />
          </div>
          <Reactions roomCode={roomCode} name={name} />
        </div>
      </div>

      {/* Right: chat */}
      <div className="h-[360px] min-w-0 w-full sm:h-[420px] lg:col-start-2 lg:row-start-2 lg:h-auto lg:min-h-0 xl:col-start-3 xl:row-start-1">
        <Chat
          items={feed}
          // Hosting the AI's turn is a background job, not a turn of your own
          // — the host guesses along with everyone else.
          disabled={(isDrawer && !round.aiDrawing) || !round.active}
          placeholder={
            !round.active
              ? "Empieza una ronda para jugar"
              : isDrawer && !round.aiDrawing
                ? "Estás dibujando — sin espiar 🙂"
                : "Escribe tu respuesta…"
          }
          onSend={submitGuess}
          onTyping={() => chat.sendTyping()}
        />
      </div>
    </div>
  );
}

const MINI_MEDALS = ["🥇", "🥈", "🥉"];

/** Compact, single-row scoreboard for small screens (hidden from lg up). */
function MiniScores({ scores }: { scores: [string, number][] }) {
  if (scores.length === 0) return null;
  return (
    <div
      className="pp-panel pp-mini-score flex items-center gap-1.5 overflow-x-auto rounded-xl border border-edge bg-panel px-3 py-2 lg:hidden"
      aria-label="Marcador"
    >
      {scores.map(([n, pts], i) => (
        <span
          key={n}
          className="flex shrink-0 items-center gap-1 rounded-full bg-fg/5 px-2.5 py-1 text-xs text-fg/80"
        >
          <span>{MINI_MEDALS[i] ?? `${i + 1}.`}</span>
          <span className="max-w-[7rem] truncate">{n === "🤖 IA" ? "🤖 IA" : n}</span>
          <span className="font-mono font-semibold text-fg/90">{pts}</span>
        </span>
      ))}
    </div>
  );
}
