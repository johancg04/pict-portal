"use client";

import { useState } from "react";
import { PortalProvider } from "@portalsdk/react";
import { portal } from "@/lib/portal";
import Lobby from "@/components/Lobby";
import Game from "@/components/Game";
import { AiDifficulty } from "@/lib/types";

export default function Page() {
  const [session, setSession] = useState<{
    name: string;
    roomCode: string;
    totalRounds?: number;
    aiDifficulty?: AiDifficulty;
    customWords?: string[];
  } | null>(null);

  return (
    <PortalProvider client={portal}>
      {session ? (
        <Game
          name={session.name}
          roomCode={session.roomCode}
          totalRounds={session.totalRounds}
          aiDifficulty={session.aiDifficulty}
          customWords={session.customWords}
          onLeave={() => setSession(null)}
        />
      ) : (
        <Lobby
          onJoin={(name, roomCode, totalRounds, aiDifficulty, customWords) =>
            setSession({ name, roomCode, totalRounds, aiDifficulty, customWords })
          }
        />
      )}
    </PortalProvider>
  );
}
