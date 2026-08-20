"use client";

import PlayerBadge from "./PlayerBadge";

// Shown when the configured number of rounds is done. `scores` is already
// sorted highest-first (same shape the Scoreboard uses): [name, points][].
export type GalleryItem = { image: string; word: string; winner?: string; ai?: boolean };

export default function Podium({
  scores,
  totalRounds,
  gallery = [],
  onNewGame,
  onLeave,
}: {
  scores: [string, number][];
  totalRounds: number;
  gallery?: GalleryItem[];
  onNewGame: () => void;
  onLeave: () => void;
}) {
  const top3 = scores.slice(0, 3);
  const rest = scores.slice(3);
  const winner = scores[0]?.[0];

  // Visual order on the stand: 2nd, 1st, 3rd (classic podium layout).
  const layout: { entry?: [string, number]; place: number }[] = [
    { entry: top3[1], place: 2 },
    { entry: top3[0], place: 1 },
    { entry: top3[2], place: 3 },
  ];
  const medal = ["🥇", "🥈", "🥉"];
  const barH = { 1: "h-24", 2: "h-16", 3: "h-12" } as const;

  return (
    <div className="absolute inset-0 z-20 grid place-items-center bg-ink/90 p-6 backdrop-blur-sm">
      <div className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-edge bg-panel p-8 text-center shadow-xl">
        <div className="text-4xl">🏆</div>
        <h2 className="mt-2 text-xl font-semibold">
          {winner ? (
            <>
              ¡Ganó <span className="text-accent">{winner === "🤖 IA" ? "la IA 🤖" : winner}</span>!
            </>
          ) : (
            "Fin de la partida"
          )}
        </h2>
        <p className="mt-1 text-sm text-fg/50">{totalRounds} rondas jugadas</p>

        {scores.length === 0 ? (
          <p className="mt-6 text-sm text-fg/50">Nadie anotó puntos esta vez.</p>
        ) : (
          <div className="mt-6 flex items-end justify-center gap-3">
            {layout.map(({ entry, place }) =>
              entry ? (
                <div key={place} className="flex w-24 flex-col items-center">
                  <div className="mb-1 text-2xl">{medal[place - 1]}</div>
                  <PlayerBadge name={entry[0] === "🤖 IA" ? "IA" : entry[0]} />
                  <div className="mt-1 max-w-full truncate text-sm font-medium">
                    {entry[0]}
                  </div>
                  <div className="text-xs text-fg/50">{entry[1]} pts</div>
                  <div
                    className={`mt-2 w-full rounded-t-md bg-accent/30 ${barH[place as 1 | 2 | 3]}`}
                  />
                </div>
              ) : (
                <div key={place} className="w-24" />
              ),
            )}
          </div>
        )}

        {rest.length > 0 && (
          <ul className="mt-5 space-y-1 text-left text-sm">
            {rest.map(([n, pts], i) => (
              <li key={n} className="flex items-center justify-between text-fg/70">
                <span className="flex items-center gap-2">
                  <span className="w-5 text-right text-fg/40">{i + 4}.</span>
                  {n}
                </span>
                <span className="text-fg/50">{pts} pts</span>
              </li>
            ))}
          </ul>
        )}

        {gallery.length > 0 && (
          <div className="mt-7 text-left">
            <div className="mb-2 text-xs uppercase tracking-wide text-fg/40">
              Galería de la partida
            </div>
            <div className="grid max-h-56 grid-cols-2 gap-3 overflow-y-auto pr-1 sm:grid-cols-3">
              {gallery.map((g, i) => (
                <figure key={i} className="overflow-hidden rounded-lg border border-edge">
                  {/* eslint-disable-next-line @next/next/no-img-element -- data URL, not a remote asset */}
                  <img
                    src={g.image}
                    alt={g.word}
                    className="aspect-[3/2] w-full object-cover"
                  />
                  <figcaption className="flex items-center justify-between gap-1 px-2 py-1 text-[11px]">
                    <span className="truncate font-medium text-fg/80">{g.word}</span>
                    <span className="shrink-0 text-fg/40">
                      {g.winner ? (g.ai ? "🤖" : "✓") : "—"}
                    </span>
                  </figcaption>
                </figure>
              ))}
            </div>
          </div>
        )}

        <div className="mt-7 flex gap-2">
          <button
            onClick={onLeave}
            className="rounded-md border border-edge px-4 py-2 text-sm font-medium text-fg/70 hover:bg-fg/5 hover:text-fg/90"
          >
            Salir
          </button>
          <button
            onClick={onNewGame}
            className="flex-1 rounded-md bg-accent px-4 py-2 font-medium text-white"
          >
            Nueva partida
          </button>
        </div>
      </div>
    </div>
  );
}
