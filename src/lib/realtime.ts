"use client";

// Realtime layer on Supabase. Exposes the same `useChannel` shape the game
// was written against when it ran on Portal, so components only change their
// import path.
//
//   Broadcast  -> live messages (strokes, cursors, guesses, round control)
//   Presence   -> "online" activity, which drives the roster
//   Broadcast  -> typing indicator (ephemeral, self-expiring)
//   Table      -> persistent history for channels that are not history:"none"
//
// Semantics kept from Portal: the sender never receives its own live broadcast
// (so `onMessage` only fires for other players), but its own persistent
// messages do appear in `messages` right away.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import { chatChannel, cursorChannel, drawChannel, gameChannel, reactionsChannel } from "@/lib/types";

export type ChannelStatus =
  | "idle"
  | "connecting"
  | "ready"
  | "reconnecting"
  | "degraded"
  | "blocked";

export type ChannelMessage<T> = { id: string; content: T; sender: { id: string } };
export type Activity = { kind: string; userId: string };

type WireMessage = ChannelMessage<unknown>;
type Snapshot = {
  status: ChannelStatus;
  messages: WireMessage[];
  activity: Activity[];
  typing: string[];
};

const PLAYER_ID_KEY = "pictportal-player-id";
const HISTORY_LIMIT = 500;
const TYPING_TTL_MS = 3_000;
const TYPING_SEND_EVERY_MS = 1_500;
const TEARDOWN_GRACE_MS = 5_000; // survives React strict-mode remounts and Lobby -> Game hand-off
const OUTBOX_LIMIT = 200;

const EMPTY: Snapshot = { status: "idle", messages: [], activity: [], typing: [] };

function newId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

// Anonymous identity per TAB. sessionStorage is scoped to a tab, so two tabs
// of the same browser are two different players (as the README suggests when
// it asks you to open "two windows"). localStorage would make them share one id:
// the sender filter would drop each other's messages and presence would collide.
let cachedPlayerId: string | undefined;
export function getPlayerId(): string {
  if (typeof window === "undefined") return "server";
  if (cachedPlayerId) return cachedPlayerId;
  let id: string | null = null;
  try {
    id = sessionStorage.getItem(PLAYER_ID_KEY);
  } catch {
    /* storage disabled: fall through to an in-memory id */
  }
  if (!id) {
    id = newId();
    try {
      sessionStorage.setItem(PLAYER_ID_KEY, id);
    } catch {
      /* ignore */
    }
  }
  cachedPlayerId = id;
  return id;
}

type Listener = () => void;
type Handler = (m: WireMessage) => void;

class RoomChannel {
  private status: ChannelStatus = "idle";
  private messages: WireMessage[] = [];
  private activity: Activity[] = [];
  private typing = new Map<string, number>(); // userId -> expiresAt (ms)
  private listeners = new Set<Listener>();
  readonly handlers = new Set<Handler>();

  private refs = 0;
  private teardownTimer?: ReturnType<typeof setTimeout>;
  private typingTimer?: ReturnType<typeof setTimeout>;
  private lastTypingSentAt = 0;

  private rt?: RealtimeChannel;
  private subscribed = false;
  private outbox: WireMessage[] = []; // persistent sends made before we joined
  private wantActivity: string | null = null;
  // What the server currently has for us in Presence. Supabase closes the
  // channel (ClientPresenceRateLimitReached) if a client re-tracks too often,
  // so Game's 3.5s heartbeat must not turn into a track() per beat. Presence
  // already drops us on its own when our socket goes away.
  private trackedActivity: string | null = null;
  private historyPromise?: Promise<void>;
  private cachedSnapshot: Snapshot | null = null;

  constructor(
    readonly id: string,
    readonly persist: boolean,
  ) {}

  // ---- state for React ------------------------------------------------------

  snapshot(): Snapshot {
    if (!this.cachedSnapshot) {
      const now = Date.now();
      this.cachedSnapshot = {
        status: this.status,
        messages: this.messages,
        activity: this.activity,
        typing: [...this.typing].filter(([, exp]) => exp > now).map(([id]) => id),
      };
    }
    return this.cachedSnapshot;
  }

  subscribeState(l: Listener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  private emit() {
    this.cachedSnapshot = null;
    for (const l of this.listeners) l();
  }

  private setStatus(s: ChannelStatus) {
    this.status = s;
    this.emit();
  }

  // ---- lifecycle (ref-counted, shared across components) --------------------

  acquire() {
    this.refs++;
    clearTimeout(this.teardownTimer);
    if (!this.rt) this.connect();
  }

  release() {
    this.refs = Math.max(0, this.refs - 1);
    if (this.refs === 0) {
      this.teardownTimer = setTimeout(() => {
        if (this.refs === 0) this.disconnect();
      }, TEARDOWN_GRACE_MS);
    }
  }

  private connect() {
    this.setStatus("connecting");
    const rt = supabase.channel(this.id, {
      config: {
        broadcast: { self: false, ack: false },
        presence: { key: getPlayerId() },
      },
    });
    this.rt = rt;

    rt.on("broadcast", { event: "msg" }, ({ payload }) => this.receive(payload as WireMessage));
    rt.on("broadcast", { event: "typing" }, ({ payload }) =>
      this.markTyping((payload as { userId: string }).userId),
    );
    rt.on("presence", { event: "sync" }, () => this.syncPresence());

    rt.subscribe((state) => {
      if (state === "SUBSCRIBED") {
        this.subscribed = true;
        this.trackedActivity = null; // a fresh join starts with no presence on the server
        this.flushOutbox();
        if (this.wantActivity) void this.track(this.wantActivity);
        // Re-fetch history after a reconnect so messages missed while offline show up.
        if (this.historyPromise) this.historyPromise = this.fetchHistory();
        this.setStatus("ready");
      } else if (state === "CHANNEL_ERROR" || state === "TIMED_OUT") {
        this.subscribed = false;
        this.trackedActivity = null;
        this.setStatus("degraded");
      } else if (state === "CLOSED") {
        this.subscribed = false;
        this.trackedActivity = null;
        this.setStatus(this.refs > 0 ? "reconnecting" : "idle");
      }
    });
  }

  private disconnect() {
    if (this.rt) void supabase.removeChannel(this.rt);
    this.rt = undefined;
    this.subscribed = false;
    clearTimeout(this.typingTimer);
    rooms.delete(this.id);
    this.setStatus("idle");
  }

  // ---- outbound -------------------------------------------------------------

  send(content: unknown): Promise<void> {
    const msg: WireMessage = { id: newId(), sender: { id: getPlayerId() }, content };

    if (this.persist) {
      // Our own persistent messages show up locally immediately, since the
      // sender never gets its own broadcast back.
      this.messages = [...this.messages, msg];
      this.emit();
      void supabase
        .from("room_messages")
        .insert({ id: msg.id, channel: this.id, sender_id: msg.sender!.id, content })
        .then(({ error }) => {
          if (error) console.error("[realtime] persist failed:", error.message);
        });
    }

    if (!this.subscribed || !this.rt) {
      // Persistent messages must still reach players already in the room, so
      // hold them until we join. Ephemeral ones (strokes, cursors) are stale by then.
      if (this.persist && this.outbox.length < OUTBOX_LIMIT) this.outbox.push(msg);
      return Promise.resolve();
    }
    return this.broadcast(msg);
  }

  private broadcast(msg: WireMessage): Promise<void> {
    return this.rt!.send({ type: "broadcast", event: "msg", payload: msg }).then(() => undefined);
  }

  private flushOutbox() {
    const pending = this.outbox;
    this.outbox = [];
    for (const msg of pending) void this.broadcast(msg);
  }

  sendActivity(kind: string) {
    this.wantActivity = kind;
    // Repeated heartbeats with the same kind are no-ops: we are already tracked.
    if (this.subscribed && this.trackedActivity !== kind) void this.track(kind);
  }

  private track(kind: string): Promise<unknown> {
    if (!this.rt) return Promise.resolve();
    this.trackedActivity = kind;
    return this.rt.track({ userId: getPlayerId(), kind }).then((res) => {
      if (res !== "ok" && this.trackedActivity === kind) this.trackedActivity = null; // retry on next beat
      return res;
    });
  }

  sendTyping() {
    const now = Date.now();
    if (!this.subscribed || !this.rt) return;
    if (now - this.lastTypingSentAt < TYPING_SEND_EVERY_MS) return;
    this.lastTypingSentAt = now;
    void this.rt.send({ type: "broadcast", event: "typing", payload: { userId: getPlayerId() } });
  }

  // ---- inbound --------------------------------------------------------------

  private receive(msg: WireMessage) {
    if (msg.sender?.id === getPlayerId()) return; // belt and braces; self:false already filters
    if (this.persist) {
      if (!this.messages.some((m) => m.id === msg.id)) {
        this.messages = [...this.messages, msg];
        this.emit();
      }
    }
    for (const h of this.handlers) h(msg);
  }

  private syncPresence() {
    if (!this.rt) return;
    const state = this.rt.presenceState<{ userId: string; kind: string }>();
    this.activity = Object.values(state)
      .flat()
      .map((m) => ({ kind: m.kind, userId: m.userId }));
    this.emit();
  }

  private markTyping(userId: string) {
    if (userId === getPlayerId()) return;
    this.typing.set(userId, Date.now() + TYPING_TTL_MS);
    this.emit();
    clearTimeout(this.typingTimer);
    this.typingTimer = setTimeout(() => {
      const now = Date.now();
      for (const [id, exp] of this.typing) if (exp <= now) this.typing.delete(id);
      this.emit();
    }, TYPING_TTL_MS);
  }

  // ---- history --------------------------------------------------------------

  loadPrevious(): Promise<void> {
    if (!this.persist) return Promise.resolve();
    if (!this.historyPromise) this.historyPromise = this.fetchHistory();
    return this.historyPromise;
  }

  private async fetchHistory(): Promise<void> {
    const { data, error } = await supabase
      .from("room_messages")
      .select("id, sender_id, content")
      .eq("channel", this.id)
      .order("seq", { ascending: false })
      .limit(HISTORY_LIMIT);

    if (error) {
      console.error("[realtime] history failed:", error.message);
      return;
    }

    const rows = ((data ?? []) as { id: string; sender_id: string; content: unknown }[]).reverse();
    const history: WireMessage[] = rows.map((r) => ({
      id: r.id,
      content: r.content,
      sender: { id: r.sender_id },
    }));
    // Keep the history copy for anything we already have, then append live
    // messages that arrived while the query was running.
    const seen = new Set(history.map((m) => m.id));
    const live = this.messages.filter((m) => !seen.has(m.id));
    this.messages = [...history, ...live];
    this.emit();
  }
}

const rooms = new Map<string, RoomChannel>();

function acquireRoom(id: string, persist: boolean): RoomChannel {
  let room = rooms.get(id);
  if (!room) {
    room = new RoomChannel(id, persist);
    rooms.set(id, room);
  }
  room.acquire();
  return room;
}

function releaseRoom(room: RoomChannel) {
  room.release();
}

// ---- public API ------------------------------------------------------------

/**
 * Opens a room's channels ahead of time (used by the lobby while the user
 * types). Returns a function that releases them.
 */
export function prewarmRoom(roomCode: string): () => void {
  const channels: [string, boolean][] = [
    [gameChannel(roomCode), true],
    [chatChannel(roomCode), true],
    [drawChannel(roomCode), false],
    [cursorChannel(roomCode), false],
    [reactionsChannel(roomCode), false],
  ];
  const held = channels.map(([id, persist]) => acquireRoom(id, persist));
  return () => held.forEach(releaseRoom);
}

export type UseChannelOptions<T> = {
  channelId: string;
  /** "none" = live only, nothing stored. Anything else keeps history. */
  history?: "none" | "all";
  onMessage?: (m: ChannelMessage<T>) => void;
};

export function useChannel<T>({ channelId, history, onMessage }: UseChannelOptions<T>) {
  const persist = history !== "none";
  const roomRef = useRef<RoomChannel | null>(null);
  const onMessageRef = useRef(onMessage);
  useEffect(() => {
    onMessageRef.current = onMessage;
  });

  const [snap, setSnap] = useState<Snapshot>(EMPTY);

  useEffect(() => {
    const room = acquireRoom(channelId, persist);
    roomRef.current = room;
    const handler: Handler = (m) => onMessageRef.current?.(m as ChannelMessage<T>);
    room.handlers.add(handler);
    const unsubscribe = room.subscribeState(() => setSnap(room.snapshot()));
    setSnap(room.snapshot());
    return () => {
      unsubscribe();
      room.handlers.delete(handler);
      roomRef.current = null;
      releaseRoom(room);
    };
  }, [channelId, persist]);

  const send = useCallback(
    (arg: { content: T }) => roomRef.current?.send(arg.content) ?? Promise.resolve(),
    [],
  );
  const sendActivity = useCallback((kind: string) => roomRef.current?.sendActivity(kind), []);
  const sendTyping = useCallback(() => roomRef.current?.sendTyping(), []);
  const loadPrevious = useCallback(
    () => roomRef.current?.loadPrevious() ?? Promise.resolve(),
    [],
  );
  const me = useMemo(() => ({ id: getPlayerId() }), []);

  // Presence summary for the drawer-disconnect watchdog in Game: "detailed"
  // means we can see who is present, and count is how many distinct players.
  const presence = useMemo(() => {
    const ids = new Set(snap.activity.map((a) => a.userId));
    return { kind: "detailed" as const, count: ids.size };
  }, [snap.activity]);

  return {
    status: snap.status,
    messages: snap.messages as ChannelMessage<T>[],
    activity: snap.activity,
    presence,
    typing: snap.typing,
    me,
    send,
    sendActivity,
    sendTyping,
    loadPrevious,
  };
}
