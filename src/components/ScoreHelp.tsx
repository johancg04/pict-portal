"use client";

import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  BASE_POINTS,
  SPEED_MAX,
  STREAK_BONUS,
  STREAK_MAX,
  drawerPay,
  guessPoints,
  hintBudget,
  skipBudget,
} from "@/lib/scoring";
import { useSheet } from "@/lib/useSheet";

// "?" button + a short, plain-language explanation of how scoring works.
// Every number comes from src/lib/scoring.ts, the same module the game uses.
export default function ScoreHelp({ label = false, laps = 0 }: { label?: boolean; laps?: number }) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const sheetRef = useRef<HTMLDivElement | null>(null);

  useSheet(open, () => setOpen(false), btnRef, sheetRef);

  // A worked example so the rules stick: 4 participants (3 players + the AI),
  // a correct guess with half the clock left.
  const exampleWin = guessPoints(0.5);
  const exampleDrawer = drawerPay(exampleWin, 4);
  // With a known game length show the real numbers; otherwise the rule.
  const hints = hintBudget(laps);
  const skips = skipBudget(laps);
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label="Cómo se puntúa"
        title="¿Cómo se puntúa?"
        className={`pp-icon-btn pp-help-btn flex h-8 shrink-0 items-center justify-center rounded-md border border-edge text-sm font-bold text-fg/70 hover:bg-fg/5 hover:text-fg/90 ${
          label ? "gap-1.5 px-2.5 text-xs" : "w-8"
        } ${open ? "border-accent text-accent" : ""}`}
      >
        <span aria-hidden="true">?</span>
        {label && <span className="font-semibold">Puntos</span>}
      </button>

      {/* In <body> (not inside the header/panel) so a parent with
          backdrop-filter or transform can never drag this fixed sheet around. */}
      {open &&
        createPortal(
          <div
            ref={sheetRef}
            role="dialog"
            aria-label="Cómo se puntúa"
            className="pp-skin-sheet fixed inset-x-0 bottom-0 z-50 max-h-[82dvh] overflow-y-auto rounded-t-2xl border border-edge bg-panel p-4 text-fg shadow-2xl sm:inset-x-auto sm:bottom-auto sm:right-4 sm:top-16 sm:w-[380px] sm:rounded-2xl"
            style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-bold">¿Cómo se puntúa?</h2>
                <p className="text-xs text-fg/60">Las reglas, en simple.</p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Cerrar"
                className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-edge text-fg/70 hover:bg-fg/5"
              >
                ✕
              </button>
            </div>

            <ul className="mt-4 flex flex-col gap-3 text-sm">
              <Rule icon="🎯" title="Acertar">
                El primero en adivinar gana entre <b>{BASE_POINTS}</b> y <b>{BASE_POINTS + SPEED_MAX}</b> puntos.
                Cuanto más rápido aciertas, más puntos.
              </Rule>
              <Rule icon="✏️" title="Dibujar también suma">
                Quien dibuja no puede adivinar, así que cobra el <b>promedio</b> de lo que ganaron los
                adivinadores. Dibujar vale lo mismo que adivinar.
              </Rule>
              <Rule icon="🔥" title="Racha">
                Aciertas rondas seguidas: <b>+{STREAK_BONUS}</b> la segunda y <b>+{STREAK_MAX}</b> desde la
                tercera (ese es el máximo).
              </Rule>
              <Rule icon="🔄" title="Vueltas">
                Una vuelta es cuando <b>todos dibujan una vez</b> (la IA también). Así nadie dibuja más que
                otro, y todos tienen las mismas oportunidades.
              </Rule>
              <Rule icon="💡" title="Pistas">
                {Number.isFinite(hints) ? (
                  <>
                    Cada jugador tiene <b>{plural(hints, "pista", "pistas")}</b> en toda la partida, y como
                    máximo 3 por ronda.
                  </>
                ) : (
                  <>Hasta 3 pistas por ronda.</>
                )}{" "}
                Son una por vuelta (mínimo 2): cuanto más larga la partida, más pistas.
              </Rule>
              <Rule icon="⏭" title="Cambiar la palabra">
                {Number.isFinite(skips) ? (
                  <>
                    Cada jugador puede cambiarla <b>{plural(skips, "vez", "veces")}</b> en toda la partida
                    (una cada dos vueltas, mínimo 1).{" "}
                  </>
                ) : null}
                El tiempo <b>no se reinicia</b>: sigue corriendo con la palabra nueva.
              </Rule>
              <Rule icon="⏱️" title="Si nadie acierta">
                La ronda termina sin puntos para nadie.
              </Rule>
            </ul>

            <p className="mt-4 rounded-xl border border-edge bg-fg/5 p-3 text-xs leading-relaxed text-fg/80">
              <b>Ejemplo con 4 participantes:</b> aciertas con la mitad del tiempo restante y ganas{" "}
              <b>{exampleWin}</b> puntos. Quien dibujó gana <b>{exampleDrawer}</b>.
            </p>
          </div>,
          document.body,
        )}
    </>
  );
}

function Rule({ icon, title, children }: { icon: string; title: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-fg/5 text-lg" aria-hidden="true">
        {icon}
      </span>
      <div className="min-w-0">
        <h3 className="font-semibold">{title}</h3>
        <p className="text-fg/75">{children}</p>
      </div>
    </li>
  );
}
