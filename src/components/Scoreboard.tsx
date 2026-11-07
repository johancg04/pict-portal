"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import PlayerBadge from "./PlayerBadge";

const MEDALS = ["🥇", "🥈", "🥉"];

function motionOff() {
  return (
    document.documentElement.getAttribute("data-motion") === "off" ||
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/** Counts up from the previous value to the new one. */
function CountUp({ value }: { value: number }) {
  const [shown, setShown] = useState(value);
  const fromRef = useRef(value);
  useEffect(() => {
    const from = fromRef.current;
    fromRef.current = value;
    if (from === value || motionOff()) {
      setShown(value);
      return;
    }
    let raf = 0;
    const t0 = performance.now();
    const tick = (t: number) => {
      const k = Math.min(1, (t - t0) / 700);
      setShown(Math.round(from + (value - from) * (1 - Math.pow(1 - k, 3))));
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return <>{shown}</>;
}

export default function Scoreboard({ scores }: { scores: [string, number][] }) {
  const listRef = useRef<HTMLUListElement | null>(null);
  const prevPos = useRef<Map<string, number>>(new Map());
  const prevOrderKey = useRef("");
  const prevScores = useRef<Map<string, number>>(new Map());
  const prevOrder = useRef<string[]>([]);
  const prevLeader = useRef<string | null>(null);
  const [gains, setGains] = useState<Map<string, number>>(new Map());
  const [climbed, setClimbed] = useState<Set<string>>(new Set());
  const [newLeader, setNewLeader] = useState<string | null>(null);

  // FLIP: when (and only when) the ranking order changes, rows slide from
  // their old slot to the new one. Positions are measured inside the list
  // (offsetTop against the `relative` <ul>), so page scroll or anything above
  // the scoreboard changing height never reads as a reorder.
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const rows = Array.from(list.querySelectorAll<HTMLLIElement>("li[data-name]"));
    const orderKey = rows.map((r) => r.dataset.name).join("|");
    const positions = new Map(rows.map((r) => [r.dataset.name!, r.offsetTop]));
    if (prevOrderKey.current && orderKey !== prevOrderKey.current && !motionOff()) {
      for (const row of rows) {
        const before = prevPos.current.get(row.dataset.name!);
        const now = positions.get(row.dataset.name!)!;
        if (before !== undefined && before !== now) {
          row.animate([{ transform: `translateY(${before - now}px)` }, { transform: "translateY(0)" }], {
            duration: 450,
            easing: "cubic-bezier(.25,.8,.25,1)",
          });
        }
      }
    }
    prevOrderKey.current = orderKey;
    prevPos.current = positions;
  });

  // Who gained points (for the floating "+N") and who climbed a position.
  useEffect(() => {
    const newGains = new Map<string, number>();
    for (const [name, score] of scores) {
      const before = prevScores.current.get(name) ?? 0;
      if (score > before && prevScores.current.size > 0) newGains.set(name, score - before);
    }
    const order = scores.map(([n]) => n);
    const up = new Set<string>();
    order.forEach((n, i) => {
      const was = prevOrder.current.indexOf(n);
      if (was > i) up.add(n);
    });
    const leader = order[0] ?? null;
    const leaderChanged = prevLeader.current !== null && leader !== prevLeader.current;
    prevLeader.current = leader;
    prevScores.current = new Map(scores);
    prevOrder.current = order;
    if (newGains.size === 0 && up.size === 0 && !leaderChanged) return;
    setGains(newGains);
    setClimbed(up);
    setNewLeader(leaderChanged ? leader : null);
    const t = setTimeout(() => {
      setGains(new Map());
      setClimbed(new Set());
      setNewLeader(null);
    }, 1400);
    return () => clearTimeout(t);
  }, [scores]);

  if (scores.length === 0) return null;

  return (
    <div className="pp-panel pp-score rounded-xl border border-edge bg-panel px-4 py-3">
      <span className="pp-panel-title text-xs uppercase tracking-wide text-fg/40">Marcador</span>
      <ul ref={listRef} className="relative mt-2 flex flex-col gap-1.5" aria-live="polite">
        {scores.map(([name, score], i) => {
          const isAi = name === "🤖 IA";
          const displayName = isAi ? "IA" : name;
          const gain = gains.get(name);
          return (
            <li
              key={name}
              data-name={name}
              className={`pp-score-row relative flex items-center gap-2 rounded-lg px-2 py-1 ${
                newLeader === name ? "is-new-lead" : ""
              } ${gain ? "is-gain" : ""} ${climbed.has(name) ? "is-up" : ""}`}
            >
              <span className="pp-score-pos w-5 text-center text-sm">{MEDALS[i] ?? `${i + 1}.`}</span>
              {isAi ? (
                <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-fg/10 text-xs">🤖</span>
              ) : (
                <PlayerBadge name={displayName} />
              )}
              <span className="flex-1 truncate text-sm text-fg/80">{displayName}</span>
              <span className="pp-score-pts font-mono text-sm font-semibold text-fg/90">
                <CountUp value={score} />
              </span>
              {gain ? (
                <span className="pp-score-plus pointer-events-none absolute -top-2 right-2 text-xs font-bold text-accent" aria-hidden>
                  +{gain}
                </span>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
