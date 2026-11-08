"use client";

import { useState } from "react";
import Lobby from "@/components/Lobby";
import Game from "@/components/Game";
import { AiDifficulty } from "@/lib/types";

export default function Page() {
  const [session, setSession] = useState<{
    name: string;
    roomCode: string;
    laps?: number;
    aiDifficulty?: AiDifficulty;
    customWords?: string[];
  } | null>(null);

  return (
    session ? (
      <Game
        name={session.name}
        roomCode={session.roomCode}
        laps={session.laps}
        aiDifficulty={session.aiDifficulty}
        customWords={session.customWords}
        onLeave={() => setSession(null)}
      />
    ) : (
      <Lobby
        onJoin={(name, roomCode, laps, aiDifficulty, customWords) =>
          setSession({ name, roomCode, laps, aiDifficulty, customWords })
        }
      />
    )
  );
}
