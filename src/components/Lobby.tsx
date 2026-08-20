"use client";

import { FormEvent, useEffect, useState } from "react";
import Image from "next/image";
import PlayerBadge from "./PlayerBadge";
import ThemeToggle from "./ThemeToggle";
import { generateRoomCode, normalizeRoomCode } from "@/lib/room";
import { portal } from "@/lib/portal";
import { parseCustomWords } from "@/lib/words";
import {
  AiDifficulty,
  chatChannel,
  cursorChannel,
  drawChannel,
  gameChannel,
  reactionsChannel,
} from "@/lib/types";

const ROUND_OPTIONS = [3, 5, 10];
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
    totalRounds?: number,
    aiDifficulty?: AiDifficulty,
    customWords?: string[],
  ) => void;
}) {
  const [name, setName] = useState("");
  const [mode, setMode] = useState<"create" | "join">("create");
  const [joinCode, setJoinCode] = useState("");
  const [rounds, setRounds] = useState(5);
  const [difficulty, setDifficulty] = useState<AiDifficulty>("normal");
  const [customWordsText, setCustomWordsText] = useState("");
  const customWordCount = parseCustomWords(customWordsText).length;

  // Generated once per visit (not at submit time) so it can double as the
  // room to prewarm below — reusing the exact code we're about to create.
  const [createdCode] = useState(() => generateRoomCode());

  const trimmed = name.trim();
  const trimmedCode = normalizeRoomCode(joinCode);
  const canSubmit = trimmed.length > 0 && (mode === "create" || trimmedCode.length > 0);

  // Opens the room's channels ahead of time, while the user is still filling in
  // the form. Connecting to Portal — minting an anonymous identity plus a
  // subscribe handshake per channel — reliably takes a couple of seconds
  // (verified against the live backend); starting it here hides that wait behind
  // normal typing time. `portal.channel(id)` is a registry lookup that hands
  // back this exact same handle to Game's own useChannel on submit, already
  // connecting (or connected) rather than starting from zero. Gated to a
  // full-length code in "join" mode so we're not opening a fresh connection on
  // every keystroke.
  const pendingRoomCode =
    mode === "create" ? createdCode : trimmedCode.length === 5 ? trimmedCode : undefined;
  useEffect(() => {
    if (!pendingRoomCode) return;
    const channels = [
      portal.channel(gameChannel(pendingRoomCode)),
      portal.channel(chatChannel(pendingRoomCode)),
      portal.channel(drawChannel(pendingRoomCode), { history: "none" }),
      portal.channel(cursorChannel(pendingRoomCode), { history: "none" }),
      portal.channel(reactionsChannel(pendingRoomCode), { history: "none" }),
    ];
    for (const c of channels) c.acquire();
    return () => {
      for (const c of channels) c.release();
    };
  }, [pendingRoomCode]);

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    const customWords = mode === "create" ? parseCustomWords(customWordsText) : [];
    onJoin(
      trimmed,
      mode === "create" ? createdCode : trimmedCode,
      mode === "create" ? rounds : undefined,
      mode === "create" ? difficulty : undefined,
      customWords.length > 0 ? customWords : undefined,
    );
  }

  return (
    <div className="relative grid min-h-screen place-items-center overflow-hidden p-6">
      {/* Decorative background — purely visual, never intercepts clicks */}
      <div className="pointer-events-none absolute inset-0">
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
          className="h-28 w-28 drop-shadow-[0_8px_24px_rgba(124,58,237,0.35)]"
        />
        <h1 className="mt-2 text-3xl font-extrabold tracking-tight">
          Pict<span className="text-accent">-Portal</span>
        </h1>
        <p className="mt-2 text-center text-sm text-fg/50">
          Pictionary multijugador en tiempo real, con una IA que adivina tus trazos.
        </p>

        {/* Card */}
        <div className="mt-6 w-full rounded-2xl border border-edge bg-panel p-6 shadow-xl">
          <div className="flex items-center justify-between">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-edge px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-fg/60">
              <span className="text-accent">✦</span> IA en la partida
            </span>
            <ThemeToggle />
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
                  className="w-full bg-transparent outline-none placeholder:text-fg/30"
                />
              </div>
            </div>

            {mode === "create" ? (
              <div>
                <label className="mb-1.5 block text-sm font-medium text-fg/80">
                  Rondas
                </label>
                <div className="flex gap-1 rounded-full border border-edge p-1">
                  {ROUND_OPTIONS.map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => setRounds(n)}
                      className={`flex-1 rounded-full py-2 text-sm font-medium transition ${
                        rounds === n
                          ? "bg-gradient-to-r from-accent to-purple-500 text-white shadow"
                          : "text-fg/60 hover:text-fg/90"
                      }`}
                    >
                      {n}
                    </button>
                  ))}
                </div>
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
              </div>
            ) : null}

            {mode === "create" ? (
              <div>
                <label className="mb-1.5 block text-sm font-medium text-fg/80">
                  Palabras personalizadas <span className="font-normal text-fg/40">(opcional)</span>
                </label>
                <textarea
                  value={customWordsText}
                  onChange={(e) => setCustomWordsText(e.target.value)}
                  placeholder="gato, casa, cohete…"
                  rows={2}
                  className="w-full resize-none rounded-xl border border-edge bg-ink px-3 py-2.5 text-sm outline-none placeholder:text-fg/30 focus:border-accent"
                />
                <p className="mt-1 text-xs text-fg/40">
                  {customWordCount > 0
                    ? `${customWordCount} palabra${customWordCount === 1 ? "" : "s"} — reemplazan el banco por defecto.`
                    : "Separadas por coma o salto de línea. Si lo dejas vacío, se usa el banco por defecto."}
                </p>
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
              className="mt-1 inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-accent to-purple-500 px-4 py-2.5 font-semibold text-white shadow-lg shadow-accent/20 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
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
