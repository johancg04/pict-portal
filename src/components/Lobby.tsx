"use client";

import { FormEvent, useEffect, useState } from "react";
import Image from "next/image";
import PlayerBadge from "./PlayerBadge";
import ThemeToggle from "./ThemeToggle";
import SkinPicker from "./SkinPicker";
import ScoreHelp from "./ScoreHelp";
import SoundPanel from "./SoundPanel";
import { DEFAULT_LAPS, LAP_OPTIONS, MAX_LAPS, MIN_LAPS, parseLaps } from "@/lib/scoring";
import { generateRoomCode, normalizeRoomCode } from "@/lib/room";
import { prewarmRoom } from "@/lib/realtime";
import { parseCustomWords } from "@/lib/words";
import { playSound, setMusicMode } from "@/lib/sound";
import { DIFFICULTY_INFO } from "@/lib/difficulty";
import { AiDifficulty } from "@/lib/types";

const LAP_CHOICES = LAP_OPTIONS;
const DIFFICULTY_OPTIONS: { value: AiDifficulty; label: string }[] = [
  { value: "easy", label: "Fácil" },
  { value: "normal", label: "Normal" },
  { value: "hard", label: "Difícil" },
];

export default function Lobby({
  onJoin,
}: {
  onJoin: (
    name: string,
    roomCode: string,
    laps?: number,
    aiDifficulty?: AiDifficulty,
    customWords?: string[],
  ) => void;
}) {
  const [name, setName] = useState("");
  const [mode, setMode] = useState<"create" | "join">("create");
  const [joinCode, setJoinCode] = useState("");
  const [laps, setLaps] = useState<number>(DEFAULT_LAPS);
  // "Otra": the player types their own number of laps instead of a preset.
  const [customLaps, setCustomLaps] = useState(false);
  const [customLapsText, setCustomLapsText] = useState("");
  const lapsValue = customLaps ? parseLaps(customLapsText) : laps;
  const [difficulty, setDifficulty] = useState<AiDifficulty>("normal");
  const [customWordsText, setCustomWordsText] = useState("");
  const [generating, setGenerating] = useState(false)
  const [generateError, setGenerateError] = useState<string | null>(null)
  // AI-generated words stay out of the UI: the host would see them and know the
  // answers in advance. Only a count is shown.
  const [generatedWords, setGeneratedWords] = useState<string[]>([])
  const customWordCount = generatedWords.length > 0 ? generatedWords.length : parseCustomWords(customWordsText).length;

  // Generated once per visit (not at submit time) so it can double as the
  // room to prewarm below — reusing the exact code we're about to create.
  const [createdCode] = useState(() => generateRoomCode());

  const trimmed = name.trim();
  const trimmedCode = normalizeRoomCode(joinCode);
  const canSubmit =
    trimmed.length > 0 &&
    (mode === "create" ? lapsValue !== null : trimmedCode.length > 0);

  // Opens the room's channels ahead of time, while the user is still filling in
  // the form. Joining the Supabase channels takes a moment; starting it here
  // hides that wait behind normal typing time. prewarmRoom acquires the shared
  // room registry in src/lib/realtime.ts, so Game's own useChannel on submit
  // gets these same, already-connecting channels. Gated to a full-length code
  // in "join" mode so we're not opening a fresh connection on every keystroke.
  const pendingRoomCode =
    mode === "create" ? createdCode : trimmedCode.length === 5 ? trimmedCode : undefined;
  useEffect(() => {
    if (!pendingRoomCode) return;
    return prewarmRoom(pendingRoomCode);
  }, [pendingRoomCode]);

  // Calm music from the moment the app opens (it starts on the first tap/click,
  // since browsers don't allow sound before that).
  useEffect(() => {
    setMusicMode("wait");
    return () => setMusicMode("off");
  }, []);

  async function generateWordsWithIA() {
    const topic = customWordsText.trim();
    if (!topic || generating) return;

    setGenerating(true);
    setGenerateError(null);

    try {

      const res = await fetch('/api/generate-words', {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({topic}),
      });

      if(!res.ok) throw new Error("La IA no pudo generar palabras :(")

      const data: { ok: boolean; words: string[]} = await res.json()
      if(!Array.isArray(data.words) || data.words.length === 0) {
        throw new Error("Respuesta vacía de la IA.");
      }

      setGeneratedWords(parseCustomWords(data.words.join(", ")))

    } catch(err) {
      setGenerateError(err instanceof Error ? err.message : "Error inesperado.")
    } finally {
      setGenerating(false)
    }
  }


  function submit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;

    const rawWords = parseCustomWords(customWordsText)

    if(mode === "create" && generatedWords.length === 0 && rawWords.length > 0 && rawWords.length <= 2) {
      setGenerateError(
        "Parece que escribiste un tema sin generar las palabras. Pulsa 'Generar con IA' o escribe varias palabras separadas por coma."
      )
      return;
    }



    // The submit click is the user gesture that unlocks audio: confirm with a start jingle.
    playSound("yourTurn");

    const customWords =
      mode === "create" ? (generatedWords.length > 0 ? generatedWords : parseCustomWords(customWordsText)) : [];
    onJoin(
      trimmed,
      mode === "create" ? createdCode : trimmedCode,
      mode === "create" ? (lapsValue ?? DEFAULT_LAPS) : undefined,
      mode === "create" ? difficulty : undefined,
      customWords.length > 0 ? customWords : undefined,
    );
  }

  return (
    <div
      onPointerDownCapture={(e) => {
        const b = (e.target as HTMLElement).closest("button");
        if (b && !b.disabled && b.type !== "submit") playSound("click");
      }}
      className="relative grid min-h-screen place-items-center overflow-hidden p-6"
    >
      {/* Decorative background — purely visual, never intercepts clicks */}
      <div className="pp-lobby-decor pointer-events-none absolute inset-0">
        <div className="absolute -left-40 -top-40 h-96 w-96 rounded-full bg-[#22D3C5]/20 blur-3xl" />
        <div className="absolute -bottom-40 -right-24 h-96 w-96 rounded-full bg-[#7C3AED]/20 blur-3xl" />
        <div
          className="absolute inset-0 opacity-[0.12]"
          style={{
            backgroundImage: "radial-gradient(currentColor 1px, transparent 1px)",
            backgroundSize: "22px 22px",
            color: "rgb(var(--color-fg))",
          }}
        />
      </div>

      <div className="relative flex w-full max-w-sm flex-col items-center">
        {/* Mascot + wordmark */}
        <Image
          src="/logo.png"
          alt="Pict-Portal"
          width={120}
          height={120}
          priority
          className="pp-logo h-28 w-28 drop-shadow-[0_8px_24px_rgba(124,58,237,0.35)]"
        />
        <h1 className="pp-brand mt-2 text-3xl font-extrabold tracking-tight">
          Pict<span className="text-accent">-Portal</span>
        </h1>
        <p className="pp-tagline mt-2 text-center text-sm text-fg/50">
          Pictionary multijugador en tiempo real, con una IA que adivina tus trazos.
        </p>

        {/* Card */}
        <div className="pp-panel pp-lobby mt-6 w-full rounded-2xl border border-edge bg-panel p-6 shadow-xl">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="pp-chip inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-edge px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-fg/60">
              <span className="text-accent">✦</span> IA en la partida
            </span>
            <div className="ml-auto flex items-center gap-2">
              <SoundPanel />
              <ScoreHelp />
              <SkinPicker label />
              <ThemeToggle />
            </div>
          </div>

          {/* Create / Join tabs */}
          <div className="mt-5 flex gap-1 rounded-full border border-edge p-1">
            {(["create", "join"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                className={`flex-1 rounded-full py-2 text-sm font-medium transition ${
                  mode === m
                    ? "bg-gradient-to-r from-accent to-purple-500 text-white shadow"
                    : "text-fg/60 hover:text-fg/90"
                }`}
              >
                {m === "create" ? "Crear sala" : "Unirse con código"}
              </button>
            ))}
          </div>

          <form onSubmit={submit} className="mt-5 flex flex-col gap-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-fg/80">
                Tu nombre
              </label>
              <div className="flex items-center gap-2.5 rounded-xl border border-edge bg-ink px-3 py-2.5 focus-within:border-accent">
                {trimmed ? (
                  <PlayerBadge name={trimmed} />
                ) : (
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-fg/10 text-sm text-fg/40">
                    ?
                  </span>
                )}
                <input
                  autoFocus
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Ada"
                  aria-label="Tu nombre"
                  className="w-full bg-transparent py-1.5 outline-none placeholder:text-fg/30"
                />
              </div>
            </div>

            {mode === "create" ? (
              <div>
                <label className="mb-1.5 block text-sm font-medium text-fg/80">
                  Vueltas
                </label>
                <div className="flex gap-1 rounded-full border border-edge p-1">
                  {LAP_CHOICES.map((n) => (
                    <button
                      key={n}
                      type="button"
                      aria-pressed={!customLaps && laps === n}
                      onClick={() => {
                        setLaps(n);
                        setCustomLaps(false);
                      }}
                      className={`flex-1 rounded-full py-2 text-sm font-medium transition ${
                        !customLaps && laps === n
                          ? "bg-gradient-to-r from-accent to-purple-500 text-white shadow"
                          : "text-fg/60 hover:text-fg/90"
                      }`}
                    >
                      {n}
                    </button>
                  ))}
                  <button
                    type="button"
                    aria-pressed={customLaps}
                    onClick={() => setCustomLaps(true)}
                    className={`flex-1 rounded-full py-2 text-sm font-medium transition ${
                      customLaps
                        ? "bg-gradient-to-r from-accent to-purple-500 text-white shadow"
                        : "text-fg/60 hover:text-fg/90"
                    }`}
                  >
                    Otra
                  </button>
                </div>
                {customLaps && (
                  <div className="mt-2 flex items-center gap-2">
                    <label htmlFor="custom-laps" className="text-sm text-fg/70">
                      Número de vueltas
                    </label>
                    <input
                      id="custom-laps"
                      type="number"
                      inputMode="numeric"
                      min={MIN_LAPS}
                      max={MAX_LAPS}
                      autoFocus
                      value={customLapsText}
                      onChange={(e) => setCustomLapsText(e.target.value)}
                      placeholder={`${MIN_LAPS}–${MAX_LAPS}`}
                      aria-invalid={customLapsText !== "" && lapsValue === null}
                      className="pp-input w-24 rounded-xl border border-edge bg-ink px-3 py-2 text-center text-base outline-none placeholder:text-fg/30 focus:border-accent"
                    />
                  </div>
                )}
                {customLaps && customLapsText !== "" && lapsValue === null ? (
                  <p className="mt-1 text-xs text-red-400">
                    Elige un número entre {MIN_LAPS} y {MAX_LAPS}.
                  </p>
                ) : (
                  <p className="mt-1 text-xs text-fg/40">
                    En cada vuelta todos dibujan una vez (la IA también), así nadie tiene ventaja.
                  </p>
                )}
              </div>
            ) : null}

            {mode === "create" ? (
              <div>
                <label className="mb-1.5 block text-sm font-medium text-fg/80">
                  Dificultad de la IA
                </label>
                <div className="flex gap-1 rounded-full border border-edge p-1">
                  {DIFFICULTY_OPTIONS.map(({ value, label }) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setDifficulty(value)}
                      className={`flex-1 rounded-full py-2 text-sm font-medium transition ${
                        difficulty === value
                          ? "bg-gradient-to-r from-accent to-purple-500 text-white shadow"
                          : "text-fg/60 hover:text-fg/90"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <p className="mt-1 text-xs text-fg/40">{DIFFICULTY_INFO[difficulty]}</p>
              </div>
            ) : null}

            {mode === "create" ? (
              <div>
                <div className="mb-1.5 flex items-center justify-between">
                  <label className="block text-sm font-medium text-fg/80">
                    Categoría personalizada <span className="font-normal text-fg/40">(opcional)</span>
                  </label>
                  <button
                    type="button"
                    onClick={generateWordsWithIA}
                    disabled={!customWordsText.trim() || generating}
                    title={generatedWords.length > 0 ? "Generar otras palabras con el mismo tema" : undefined}
                    className="inline-flex items-center gap-1 rounded-full border border-edge px-2.5 py-1 text-xs font-semibold text-fg/70 transition hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {generating ? "Generando…" : <>✦ {generatedWords.length > 0 ? "Regenerar" : "Generar con IA"}</>}
                  </button>
                </div>
                <textarea
                  value={customWordsText}
                  onChange={(e) => {
                    setCustomWordsText(e.target.value)
                    setGeneratedWords([])
                  }}
                  placeholder="Hogar, Cine, Deporte…"
                  rows={2}
                  className="w-full resize-none rounded-xl border border-edge bg-ink px-3 py-2.5 text-sm outline-none placeholder:text-fg/30 focus:border-accent"
                />
                {generateError ? (
                  <p className="mt-1 text-xs text-red-400">{generateError}</p>
                ) : (
                  <p className="mt-1 text-xs text-fg/40">
                    {generatedWords.length > 0
                      ? `✓ ${generatedWords.length} palabras generadas por IA sobre «${customWordsText.trim()}». Son secretas para que nadie sepa qué saldrá.`
                      : customWordCount > 0
                      ? `${customWordCount} palabra${customWordCount === 1 ? "" : "s"} — reemplazan el banco por defecto.`
                      : "Escribe un tema y pulsa 'Generar con IA', o escribe tus propias palabras separadas por coma o salto de línea."}
                  </p>
                )}
              </div>
            ) : (
              <div>
                <label className="mb-1.5 block text-sm font-medium text-fg/80">
                  Código de sala
                </label>
                <input
                  value={joinCode}
                  onChange={(e) => setJoinCode(e.target.value)}
                  placeholder="A B C 1 2 3"
                  maxLength={8}
                  className="w-full rounded-xl border border-edge bg-ink px-3 py-2.5 text-center font-mono uppercase tracking-[0.3em] outline-none placeholder:tracking-[0.3em] placeholder:text-fg/25 focus:border-accent"
                />
              </div>
            )}

            <button
              type="submit"
              disabled={!canSubmit}
              className="pp-btn-primary mt-1 inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-accent to-purple-500 px-4 py-2.5 font-semibold text-white shadow-lg shadow-accent/20 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
            >
              {mode === "create" ? "Crear y entrar" : "Entrar a la sala"} <span aria-hidden>→</span>
            </button>
          </form>
        </div>

        <p className="mt-4 text-center text-xs text-fg/40">
          Sin registro. Comparte el código y a dibujar.
        </p>
      </div>
    </div>
  );
}
