"use client";

import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  AUTO_PACK_FOR_SKIN,
  PACKS,
  PACK_LIST,
  PackChoice,
  PackId,
  playSound,
  previewMusic,
  previewPack,
  resolvePack,
  setSoundPrefs,
  useSoundPrefs,
} from "@/lib/sound";
import { useSheet } from "@/lib/useSheet";

// 🔊 button + panel: choose the sound pack, the volume, the background music,
// the pen and click sounds, or mute everything. The button always shows the
// current state, so it doubles as a "am I muted?" indicator.
export default function SoundPanel({ label = false }: { label?: boolean }) {
  const prefs = useSoundPrefs();
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const sheetRef = useRef<HTMLDivElement | null>(null);
  useSheet(open, () => setOpen(false), btnRef, sheetRef, "[role='switch']");

  const silent = prefs.muted || prefs.volume <= 0;
  const autoPack = PACKS[resolvePack("auto")];

  function choose(choice: PackChoice) {
    setSoundPrefs({ pack: choice });
    previewPack(choice);
  }

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={silent ? "Sonido silenciado: abrir ajustes de sonido" : "Ajustes de sonido"}
        title="Sonido"
        className={`pp-icon-btn pp-sound-btn flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-md border border-edge text-fg/70 hover:bg-fg/5 hover:text-fg/90 ${
          label ? "px-2.5 text-xs font-semibold" : "w-8"
        } ${open ? "border-accent text-accent" : ""}`}
      >
        <span aria-hidden="true">{silent ? "🔇" : "🔊"}</span>
        {label && <span>Sonido</span>}
      </button>

      {/* In <body> so no ancestor (backdrop-filter, transform) can move this fixed sheet. */}
      {open &&
        createPortal(
          <div
            ref={sheetRef}
            role="dialog"
            aria-label="Ajustes de sonido"
            className="pp-skin-sheet fixed inset-x-0 bottom-0 z-50 max-h-[82dvh] overflow-y-auto rounded-t-2xl border border-edge bg-panel p-4 text-fg shadow-2xl sm:inset-x-auto sm:bottom-auto sm:right-4 sm:top-16 sm:w-[380px] sm:rounded-2xl"
            style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-bold">Sonido</h2>
                <p className="text-xs text-fg/60">Solo afecta a lo que oyes tú. Se guarda en este dispositivo.</p>
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

            <SwitchRow
              id="sound-on"
              label="Sonido activado"
              checked={!prefs.muted}
              onChange={(on) => {
                setSoundPrefs({ muted: !on });
                // Confirm with a blip when turning it back on.
                if (on) setTimeout(() => playSound("message"), 0);
              }}
            />

            <Slider
              id="sound-volume"
              label="Volumen"
              value={prefs.volume}
              disabled={prefs.muted}
              onChange={(v) => {
                setSoundPrefs({ volume: v });
                playSound("message"); // throttled: a tick while you drag
              }}
            />

            <h3 className="mb-1 mt-4 text-[11px] font-bold uppercase tracking-wider text-fg/60">Durante la partida</h3>
            <div className={prefs.muted ? "opacity-50" : ""}>
              <SwitchRow
                id="sound-music"
                label="Música de fondo"
                hint="Suave en la sala de espera, se acelera al final de cada ronda"
                checked={prefs.music}
                disabled={prefs.muted}
                onChange={(on) => {
                  setSoundPrefs({ music: on });
                  if (on) previewMusic();
                }}
              />
              <Slider
                id="sound-music-volume"
                label="Volumen de la música"
                value={prefs.musicVolume}
                disabled={prefs.muted || !prefs.music}
                onChange={(v) => {
                  setSoundPrefs({ musicVolume: v });
                  previewMusic();
                }}
              />
              <SwitchRow
                id="sound-pen"
                label="Sonido del lápiz"
                hint="Se oye al dibujar tú y al ver dibujar a otros"
                checked={prefs.pen}
                disabled={prefs.muted}
                onChange={(on) => setSoundPrefs({ pen: on })}
              />
              <SwitchRow
                id="sound-clicks"
                label="Clics de los botones"
                checked={prefs.clicks}
                disabled={prefs.muted}
                onChange={(on) => {
                  setSoundPrefs({ clicks: on });
                  if (on) setTimeout(() => playSound("click"), 0);
                }}
              />
            </div>

            <h3 className="mb-2 mt-4 text-[11px] font-bold uppercase tracking-wider text-fg/60">Estilo de sonido</h3>
            <div className={`grid grid-cols-1 gap-2 sm:grid-cols-2 ${prefs.muted ? "opacity-50" : ""}`}>
              <PackButton
                selected={prefs.pack === "auto"}
                onClick={() => choose("auto")}
                title="Automático"
                subtitle={`Sigue tu diseño (ahora: ${autoPack.name})`}
                icon="✨"
              />
              {PACK_LIST.map((p) => (
                <PackButton
                  key={p.id}
                  selected={prefs.pack === p.id}
                  onClick={() => choose(p.id)}
                  title={p.name}
                  subtitle={p.tagline}
                  icon={ICON[p.id]}
                  hint={autoFor(p.id)}
                />
              ))}
            </div>

            <button
              type="button"
              onClick={() => {
                playSound("yourTurn");
                setTimeout(() => playSound("correct"), 650);
                setTimeout(() => playSound("timeUp"), 1500);
                previewMusic(4500);
              }}
              disabled={prefs.muted}
              className="mt-4 h-11 w-full rounded-xl border border-edge text-sm font-semibold hover:bg-fg/5 disabled:cursor-not-allowed disabled:opacity-50"
            >
              ▶ Probar sonidos y música
            </button>
          </div>,
          document.body,
        )}
    </>
  );
}

const ICON: Record<PackId, string> = { suave: "🎵", synth: "🎹", cristal: "🔔", terminal: "📟", arcade: "🕹️" };

/** The skin that uses this pack under "Automático", shown as a small hint. */
function autoFor(id: PackId): string | undefined {
  const skin = Object.entries(AUTO_PACK_FOR_SKIN).find(([, p]) => p === id)?.[0];
  return skin ? skin.charAt(0).toUpperCase() + skin.slice(1) : undefined;
}

function SwitchRow({
  id,
  label,
  hint,
  checked,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  hint?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (on: boolean) => void;
}) {
  return (
    <div className="mt-2 flex min-h-[44px] items-center justify-between gap-3">
      <label htmlFor={id} className="min-w-0 text-sm">
        <span className="block font-semibold">{label}</span>
        {hint && <span className="block text-xs leading-snug text-fg/60">{hint}</span>}
      </label>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative h-7 w-12 shrink-0 rounded-full transition disabled:cursor-not-allowed ${
          checked ? "bg-accent" : "bg-fg/20"
        }`}
      >
        <span
          className={`absolute left-0.5 top-0.5 h-6 w-6 rounded-full bg-white shadow transition-transform ${
            checked ? "translate-x-5" : "translate-x-0"
          }`}
        />
      </button>
    </div>
  );
}

function Slider({
  id,
  label,
  value,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  value: number;
  disabled?: boolean;
  onChange: (v: number) => void;
}) {
  return (
    <div className={`mt-2 ${disabled ? "opacity-50" : ""}`}>
      <div className="flex items-center justify-between">
        <label htmlFor={id} className="text-sm font-semibold">
          {label}
        </label>
        <span className="text-xs tabular-nums text-fg/60">{Math.round(value * 100)}%</span>
      </div>
      <input
        id={id}
        type="range"
        min={0}
        max={100}
        step={5}
        value={Math.round(value * 100)}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value) / 100)}
        className="h-11 w-full cursor-pointer accent-[rgb(var(--color-accent))] disabled:cursor-not-allowed"
      />
    </div>
  );
}

function PackButton({
  selected,
  onClick,
  title,
  subtitle,
  icon,
  hint,
}: {
  selected: boolean;
  onClick: () => void;
  title: string;
  subtitle: string;
  icon: string;
  hint?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={`flex min-h-[56px] items-center gap-3 rounded-xl border-2 px-3 py-2 text-left transition ${
        selected ? "border-accent" : "border-edge hover:border-fg/30"
      }`}
    >
      <span className="text-xl" aria-hidden="true">
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-bold">
          {title}
          {hint && <span className="ml-1.5 text-[10px] font-semibold uppercase text-fg/50">{hint}</span>}
        </span>
        <span className="block text-xs leading-snug text-fg/60">{subtitle}</span>
      </span>
    </button>
  );
}
