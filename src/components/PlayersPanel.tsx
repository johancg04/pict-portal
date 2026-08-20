"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import PlayerBadge from "./PlayerBadge";

export type PlayerRow = {
  id: string;
  name: string;
  isMe: boolean;
  isDrawer: boolean;
  isTyping: boolean;
  /** Room leader: decides whether the AI plays, and hosts its turns. */
  isLeader?: boolean;
  /** Whoever created the room — the only one who can kick. Separate from
   *  `isLeader`, which can land on anyone currently online. */
  isCreator?: boolean;
  /** The AI bot's synthetic row — not a real connected participant. */
  isAi?: boolean;
};

type Phase = "entering" | "present" | "leaving";
type AnimatedRow = PlayerRow & { phase: Phase };

const EXIT_MS = 300;
const AI_ID = "__ai__";
const HINT_KEY = "pictportal-ai-hint-seen";

export default function PlayersPanel({
  players,
  aiEnabled,
  aiGuessing,
  aiDrawing,
  canToggleAi,
  onToggleAi,
  canKick,
  onKick,
}: {
  players: PlayerRow[];
  aiEnabled: boolean;
  /** True while a round is live, i.e. the bot is actively watching the canvas. */
  aiGuessing: boolean;
  /** True while it's the bot's own turn to draw. */
  aiDrawing: boolean;
  /** Only the room leader decides whether the AI is in the game. */
  canToggleAi: boolean;
  onToggleAi: () => void;
  /** Only the room leader can remove another player. */
  canKick: boolean;
  onKick: (id: string, name: string) => void;
}) {
  // The bot sits in the roster like any other player while it's in the game,
  // so toggling it gets the same enter/exit animation as someone joining or
  // leaving — it reads as a player taking the field, not a setting flipping.
  const roster: PlayerRow[] = useMemo(() => {
    if (!aiEnabled) return players;
    return [
      ...players,
      {
        id: AI_ID,
        name: "IA",
        isMe: false,
        isDrawer: aiDrawing,
        isTyping: aiGuessing,
        isAi: true,
      },
    ];
  }, [players, aiEnabled, aiGuessing, aiDrawing]);

  // Own a local, animated copy of the roster instead of rendering `roster`
  // directly: a row that drops out still needs to stick around in the DOM
  // long enough to play its exit transition before it's removed.
  const [rows, setRows] = useState<AnimatedRow[]>(() =>
    roster.map((p) => ({ ...p, phase: "present" as const })),
  );
  const exitTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  useEffect(() => {
    setRows((prev) => {
      const prevById = new Map(prev.map((r) => [r.id, r]));
      const nextIds = new Set(roster.map((p) => p.id));

      const next: AnimatedRow[] = roster.map((p) => {
        const existing = prevById.get(p.id);
        if (existing?.phase === "leaving") {
          // Rejoined mid-exit — cancel the pending removal and re-enter.
          const t = exitTimers.current.get(p.id);
          if (t) clearTimeout(t);
          exitTimers.current.delete(p.id);
          return { ...p, phase: "entering" };
        }
        if (existing) return { ...p, phase: existing.phase };
        return { ...p, phase: "entering" };
      });

      for (const r of prev) {
        if (nextIds.has(r.id) || r.phase === "leaving") {
          if (!nextIds.has(r.id)) next.push(r); // already leaving, keep as-is
          continue;
        }
        next.push({ ...r, phase: "leaving" });
        const timer = setTimeout(() => {
          setRows((curr) => curr.filter((x) => x.id !== r.id));
          exitTimers.current.delete(r.id);
        }, EXIT_MS);
        exitTimers.current.set(r.id, timer);
      }

      return next;
    });
  }, [roster]);

  useEffect(() => {
    const timers = exitTimers.current;
    return () => timers.forEach((t) => clearTimeout(t));
  }, []);

  // Freshly-entered rows start collapsed; flip them to "present" a frame
  // later so the browser actually animates the transition in, instead of
  // painting the final state straight away.
  useEffect(() => {
    const enteringIds = rows.filter((r) => r.phase === "entering").map((r) => r.id);
    if (enteringIds.length === 0) return;
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        setRows((curr) =>
          curr.map((r) =>
            enteringIds.includes(r.id) && r.phase === "entering" ? { ...r, phase: "present" } : r,
          ),
        );
      });
    });
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
    };
  }, [rows]);

  // One-time nudge so the bot's on/off control is discoverable — most people
  // never think to look for it. Starts hidden on both the server render and
  // the client's first pass (no hydration mismatch), then reveals itself once
  // mounted if this browser hasn't dismissed it before.
  const [hintDismissed, setHintDismissed] = useState(true);
  useEffect(() => {
    try {
      if (!localStorage.getItem(HINT_KEY)) setHintDismissed(false);
    } catch {
      /* storage disabled — just skip the hint */
    }
  }, []);
  // Only worth showing to whoever can actually act on it.
  const showHint = !hintDismissed && canToggleAi;
  function dismissHint() {
    setHintDismissed(true);
    try {
      localStorage.setItem(HINT_KEY, "1");
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="flex w-full flex-col gap-2 rounded-xl border border-edge bg-panel px-4 py-3 lg:h-full lg:w-56 lg:shrink-0">
      <span className="text-xs uppercase tracking-wide text-fg/40">
        Jugadores · {roster.length}
      </span>
      <ul className="flex flex-col">
        {rows.map((p) => {
          const open = p.phase === "present";
          return (
            <li
              key={p.id}
              className={`grid overflow-hidden transition-all duration-300 ease-out ${
                open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
              }`}
            >
              <div className="min-h-0 overflow-hidden">
                <div
                  className={`flex items-center gap-2 py-1.5 transition-transform duration-300 ease-out ${
                    open ? "translate-x-0" : "-translate-x-2"
                  }`}
                >
                  {p.isAi ? (
                    <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent/20 text-xs">
                      🤖
                    </span>
                  ) : (
                    <PlayerBadge name={p.name} />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 truncate text-sm text-fg/80">
                      <span className="truncate">{p.name}</span>
                      {p.isCreator && (
                        <span className="shrink-0" title="Creó la sala — puede expulsar jugadores">
                          🏠
                        </span>
                      )}
                      {p.isLeader && (
                        <span className="shrink-0" title="Líder de la sala — decide si la IA juega">
                          👑
                        </span>
                      )}
                      {p.isMe && <span className="shrink-0 text-xs text-fg/40">(tú)</span>}
                      {p.isAi && <span className="shrink-0 text-xs text-fg/40">(bot)</span>}
                      {p.isDrawer && (
                        <span className="shrink-0" title="dibujando">
                          ✏️
                        </span>
                      )}
                    </div>
                    <div className="h-4 text-xs text-accent">
                      {p.isTyping && (
                        <span className="inline-flex items-center gap-1">
                          <span className="flex gap-0.5">
                            <span className="h-1 w-1 animate-bounce rounded-full bg-accent [animation-delay:-0.3s]" />
                            <span className="h-1 w-1 animate-bounce rounded-full bg-accent [animation-delay:-0.15s]" />
                            <span className="h-1 w-1 animate-bounce rounded-full bg-accent" />
                          </span>
                          {p.isAi ? "adivinando…" : "escribiendo…"}
                        </span>
                      )}
                    </div>
                  </div>
                  {canKick && !p.isAi && !p.isMe && (
                    <button
                      onClick={() => onKick(p.id, p.name)}
                      title={`Expulsar a ${p.name}`}
                      aria-label={`Expulsar a ${p.name}`}
                      className="shrink-0 rounded-md px-1.5 py-1 text-xs text-fg/30 hover:bg-red-500/10 hover:text-red-400"
                    >
                      ✕
                    </button>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      <div className="mt-auto pt-2">
        {showHint && (
          <div className="relative mb-2 rounded-lg border border-accent/40 bg-accent/10 p-2 text-xs text-fg/80">
            <p>
              🤖 La <span className="font-medium">IA juega como un jugador más</span>:
              adivina y también tiene su propio turno para dibujar. Eres el líder de
              la sala, así que tú decides si participa.
            </p>
            <button
              onClick={dismissHint}
              className="mt-1.5 font-medium text-accent hover:underline"
            >
              Entendido
            </button>
            {/* little arrow pointing down at the toggle */}
            <span className="absolute -bottom-1 left-6 h-2 w-2 rotate-45 border-b border-r border-accent/40 bg-accent/10" />
          </div>
        )}
        {canToggleAi && (
          <button
            onClick={onToggleAi}
            className={`w-full rounded-md border px-2 py-1 text-xs transition ${
              showHint
                ? "border-accent/60 text-fg/90"
                : "border-edge text-fg/60 hover:bg-fg/5 hover:text-fg/90"
            }`}
          >
            {aiEnabled ? "Sacar a la IA" : "Que juegue la IA"}
          </button>
        )}
      </div>
    </div>
  );
}
