"use client";

import { useEffect, useRef, useState } from "react";
import { MotionLevel, SKINS, SkinPrefs, applyPrefs, defaultPrefs, getSkin, readPrefs } from "@/lib/skins";

const MOTION: { id: MotionLevel; label: string }[] = [
  { id: "full", label: "Completas" },
  { id: "soft", label: "Suaves" },
  { id: "off", label: "Ninguna" },
];

export default function SkinPicker({ label = false }: { label?: boolean }) {
  // Default on the first render (server and client) to avoid a hydration
  // mismatch; the saved choice is already on <html> from the init script.
  const [prefs, setPrefs] = useState<SkinPrefs>(defaultPrefs);
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const sheetRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setPrefs(readPrefs());
    // Another picker (lobby vs. game header) may change it.
    const sync = (e: Event) => setPrefs((e as CustomEvent<SkinPrefs>).detail);
    window.addEventListener("pictportal-skin", sync);
    return () => window.removeEventListener("pictportal-skin", sync);
  }, []);

  useEffect(() => {
    if (!open) return;
    sheetRef.current?.querySelector<HTMLButtonElement>("[aria-pressed='true']")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        btnRef.current?.focus();
      }
    };
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!sheetRef.current?.contains(t) && !btnRef.current?.contains(t)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown);
    };
  }, [open]);

  function update(next: SkinPrefs) {
    setPrefs(next);
    applyPrefs(next);
  }

  const skin = getSkin(prefs.skin);

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label="Elegir diseño"
        title="Elegir diseño"
        className={`pp-icon-btn pp-skin-btn flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-md border border-edge text-fg/70 hover:bg-fg/5 hover:text-fg/90 ${
          label ? "px-2.5 text-xs font-semibold" : "w-8"
        } ${open ? "border-accent text-accent" : ""}`}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 3a9 9 0 1 0 0 18c1.1 0 1.8-.8 1.8-1.7 0-.5-.2-.9-.5-1.2-.3-.3-.5-.7-.5-1.2 0-.9.8-1.7 1.7-1.7H16a5 5 0 0 0 5-5c0-4-4-7.2-9-7.2z" />
          <circle cx="7.5" cy="11" r="1.2" />
          <circle cx="10" cy="7" r="1.2" />
          <circle cx="14.5" cy="7" r="1.2" />
          <circle cx="17" cy="11" r="1.2" />
        </svg>
        {label && <span>Diseño</span>}
      </button>

      {open && (
        <div
          ref={sheetRef}
          role="dialog"
          aria-label="Elegir diseño"
          className="pp-skin-sheet fixed inset-x-0 bottom-0 z-50 max-h-[82dvh] overflow-y-auto rounded-t-2xl border border-edge bg-panel p-4 text-fg shadow-2xl sm:inset-x-auto sm:bottom-auto sm:right-4 sm:top-16 sm:w-[380px] sm:rounded-2xl"
          style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-base font-bold">Elige tu diseño</h2>
              <p className="text-xs text-fg/60">Solo cambia cómo lo ves tú. Se guarda en este dispositivo.</p>
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

          <h3 className="mb-2 mt-4 text-[11px] font-bold uppercase tracking-wider text-fg/60">Estilo</h3>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {SKINS.map((s) => (
              <button
                key={s.id}
                type="button"
                aria-pressed={s.id === skin.id}
                onClick={() => update({ skin: s.id, palette: s.palettes[0].id, motion: prefs.motion })}
                className={`flex flex-col gap-1.5 rounded-xl border-2 p-1.5 text-left transition ${
                  s.id === skin.id ? "border-accent" : "border-edge hover:border-fg/30"
                }`}
              >
                <span
                  className="pp-skin-preview relative h-14 overflow-hidden rounded-lg"
                  style={{ ["--c0" as string]: s.preview[0], ["--c1" as string]: s.preview[1], ["--c2" as string]: s.preview[2] }}
                  aria-hidden="true"
                />
                <span className="px-0.5 text-xs font-bold">{s.name}</span>
                <span className="line-clamp-2 px-0.5 text-[10px] leading-tight text-fg/60">{s.tagline}</span>
              </button>
            ))}
          </div>

          <h3 className="mb-2 mt-4 text-[11px] font-bold uppercase tracking-wider text-fg/60">Paleta</h3>
          <div className="grid grid-cols-2 gap-2">
            {skin.palettes.map((p) => (
              <button
                key={p.id}
                type="button"
                aria-pressed={p.id === prefs.palette}
                onClick={() => update({ ...prefs, palette: p.id })}
                className={`flex min-h-[44px] items-center gap-2 rounded-xl border-2 px-2.5 text-left text-xs font-semibold transition ${
                  p.id === prefs.palette ? "border-accent" : "border-edge hover:border-fg/30"
                }`}
              >
                <span className="flex" aria-hidden="true">
                  {p.swatch.map((c, i) => (
                    <span
                      key={c + i}
                      className="h-4 w-4 rounded-full border-2 border-panel"
                      style={{ background: c, marginLeft: i ? -5 : 0 }}
                    />
                  ))}
                </span>
                {p.name}
              </button>
            ))}
          </div>

          <h3 className="mb-2 mt-4 text-[11px] font-bold uppercase tracking-wider text-fg/60">Animaciones</h3>
          <div className="grid grid-cols-3 gap-1 rounded-xl border border-edge p-1" role="group" aria-label="Nivel de animaciones">
            {MOTION.map((m) => (
              <button
                key={m.id}
                type="button"
                aria-pressed={m.id === prefs.motion}
                onClick={() => update({ ...prefs, motion: m.id })}
                className={`h-9 rounded-lg text-xs font-semibold transition ${
                  m.id === prefs.motion ? "bg-fg text-ink" : "text-fg/70 hover:text-fg"
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
