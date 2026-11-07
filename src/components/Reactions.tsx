"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useChannel } from "@/lib/realtime";
import { ReactionMsg, reactionsChannel } from "@/lib/types";

// Emojis que cualquiera lanza y flotan en la pantalla de todos.
//
// Canal propio con `history: "none"`: son puro fan-out, nadie necesita
// recibir al entrar las reacciones de hace diez minutos.

const EMOJIS = ["🔥", "❤️", "😂", "👏", "😮", "🎨"];
const FLOAT_MS = 2600;

type Floating = { id: number; emoji: string; name: string; left: number };

export default function Reactions({ roomCode, name }: { roomCode: string; name: string }) {
  const [floating, setFloating] = useState<Floating[]>([]);
  const nextId = useRef(0);

  const spawn = useCallback((emoji: string, who: string) => {
    const id = nextId.current++;
    // Dispersión horizontal para que dos reacciones seguidas no se solapen.
    setFloating((prev) => [...prev, { id, emoji, name: who, left: 10 + Math.random() * 70 }]);
    setTimeout(() => {
      setFloating((prev) => prev.filter((f) => f.id !== id));
    }, FLOAT_MS);
  }, []);

  const { send } = useChannel<ReactionMsg>({
    channelId: reactionsChannel(roomCode),
    history: "none",
    onMessage: (m) => {
      if (m.content.kind !== "emoji") return;
      spawn(m.content.emoji, m.content.name);
    },
  });

  function react(emoji: string) {
    // Portal entrega el mensaje a los demás clientes pero nunca se lo devuelve
    // a quien lo envió, así que la propia reacción se pinta a mano.
    spawn(emoji, name);
    void send({ content: { kind: "emoji", emoji, name } });
  }

  return (
    <>
      {/* Capa flotante: cubre la pantalla pero nunca intercepta clics */}
      <div className="pointer-events-none fixed inset-0 z-40 overflow-hidden">
        {floating.map((f) => (
          <div
            key={f.id}
            className="absolute bottom-16 flex flex-col items-center"
            style={{ left: `${f.left}%`, animation: `pp-float ${FLOAT_MS}ms ease-out forwards` }}
          >
            <span className="text-4xl drop-shadow">{f.emoji}</span>
            <span className="mt-0.5 rounded bg-black/50 px-1.5 py-0.5 text-[10px] text-white">
              {f.name}
            </span>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-1">
        {EMOJIS.map((e) => (
          <button
            key={e}
            onClick={() => react(e)}
            aria-label={`Reaccionar con ${e}`}
            className="pp-icon-btn grid h-10 w-10 place-items-center rounded-md text-lg leading-none transition hover:scale-125 hover:bg-fg/5"
          >
            {e}
          </button>
        ))}
      </div>
    </>
  );
}
