import { NextRequest, NextResponse } from "next/server";

// Server-only route: the AI looks at the current doodle and guesses what it is.
// The target word is NEVER sent here — the model has to actually recognize the
// drawing, and the client decides if the guess matches.
//
// Uses Google Gemini (free tier). Get a key at https://aistudio.google.com/apikey

export const runtime = "nodejs";
// Gemini vision calls routinely take 3–6s and occasionally longer; give the
// serverless function enough head-room so a slow (but valid) guess isn't
// killed by the platform before our own timeout below can decide.
export const maxDuration = 15;

type GuessResult = {
  ok: boolean;
  guess?: string;
  alternatives?: string[];
  reason?: string;
  // Server said no before even touching Gemini — the caller should back off
  // instead of treating this as a transient failure worth logging.
  skip?: boolean;
};

// Last accepted request per room, so a burst of clients (or a tight local
// loop) can't multiply into one Gemini call per tick per room. Module-level
// state is fine here: this route runs in a single long-lived Node process
// (not a per-request isolate), so the map survives across requests — it just
// won't be shared across multiple server instances behind a load balancer,
// which is an acceptable gap for this project's scale.
const RATE_LIMIT_MS = 2500;
const lastRequestAt = new Map<string, number>();
// Rooms are short-lived; without this the map would grow forever across a
// long-running server process as new room codes keep showing up.
const MAX_TRACKED_ROOMS = 500;

function rateLimited(roomCode: string): boolean {
  const now = Date.now();
  const last = lastRequestAt.get(roomCode);
  if (last !== undefined && now - last < RATE_LIMIT_MS) return true;
  // Delete-then-set so an existing key moves to the end (Map iteration
  // order follows last insertion, not last update) — keeps eviction below
  // roughly least-recently-used instead of evicting by first-ever request.
  lastRequestAt.delete(roomCode);
  if (lastRequestAt.size >= MAX_TRACKED_ROOMS) {
    const oldest = lastRequestAt.keys().next().value;
    if (oldest !== undefined) lastRequestAt.delete(oldest);
  }
  lastRequestAt.set(roomCode, now);
  return false;
}

export async function POST(req: NextRequest): Promise<NextResponse<GuessResult>> {
  const apiKey = process.env.GEMINI_API_KEY;
  const model = process.env.GEMINI_MODEL || "gemini-flash-lite-latest";

  if (!apiKey) {
    // No key configured — the realtime game still works, the AI just sits out.
    return NextResponse.json({ ok: false, reason: "no_api_key" });
  }

  let dataUrl: string | undefined;
  let roomCode: string | undefined;
  try {
    const body = (await req.json()) as { image?: string; roomCode?: string };
    dataUrl = body.image;
    roomCode = typeof body.roomCode === "string" ? body.roomCode.trim() : undefined;
  } catch {
    return NextResponse.json({ ok: false, reason: "bad_request" }, { status: 400 });
  }
  if (!dataUrl?.startsWith("data:image/")) {
    return NextResponse.json({ ok: false, reason: "bad_image" }, { status: 400 });
  }
  if (!roomCode) {
    return NextResponse.json({ ok: false, reason: "no_room" }, { status: 400 });
  }

  // Last line of defense against runaway call volume (bumped polling
  // frequency, multiple active rooms, a client bug): reject over the cap
  // before it ever reaches Gemini, instead of just hoping the client behaves.
  if (rateLimited(roomCode)) {
    return NextResponse.json({ ok: false, skip: true, reason: "rate_limited" }, { status: 429 });
  }

  const base64 = dataUrl.split(",", 2)[1] ?? "";
  const mediaType = dataUrl.slice(5, dataUrl.indexOf(";")) || "image/png";

  const prompt =
    "Estamos jugando Pictionary. Este es un garabato en progreso sobre un lienzo. " +
    "Adivina qué se está dibujando. Responde SOLO con JSON estricto, sin prosa ni bloques de código: " +
    '{"guess":"<un sustantivo común>","alternatives":["<sustantivo>","<sustantivo>"]}. ' +
    "Usa sustantivos EN ESPAÑOL, cotidianos, en singular y en minúscula. " +
    "Si aún es pronto para saberlo, da igualmente tu mejor intento.";

  const controller = new AbortController();
  // 6s was too tight: successful guesses regularly land at 4–5.5s, so the tail
  // past 6s (still valid, just slow) was being aborted into a 502. 10s captures
  // that tail while staying under the function's maxDuration budget.
  const timeoutId = setTimeout(() => controller.abort(), 10_000);

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { inline_data: { mime_type: mediaType, data: base64 } },
              { text: prompt },
            ],
          },
        ],
        generationConfig: {
          maxOutputTokens: 512,
          temperature: 0.4,
        },
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!res.ok) {
      const detail = await res.text();
      console.error(`[api/guess] Gemini ${res.status}:`, detail.slice(0, 400));
      return NextResponse.json(
        { ok: false, reason: `gemini_${res.status}: ${detail.slice(0, 200)}` },
        { status: 502 },
      );
    }

    const data = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    const text =
      data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
    const parsed = parseGuess(text);
    if (!parsed) {
      console.error("[api/guess] unparseable. Raw model text:", JSON.stringify(text).slice(0, 300));
      return NextResponse.json({ ok: false, reason: "unparseable" });
    }
    console.log("[api/guess] AI guess:", parsed.guess);
    return NextResponse.json({ ok: true, ...parsed });
  } catch (err) {
    clearTimeout(timeoutId);
    const isAbort = (err as Error).name === "AbortError";
    const reason = isAbort ? "timeout" : `fetch_error: ${(err as Error).message}`;
    console.error(`[api/guess] ${reason}`);
    return NextResponse.json({ ok: false, reason }, { status: 502 });
  }
}

function parseGuess(text: string): { guess: string; alternatives: string[] } | null {
  const cleaned = text.replace(/```json/gi, "").replace(/```/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1) return null;
  try {
    const obj = JSON.parse(cleaned.slice(start, end + 1)) as {
      guess?: unknown;
      alternatives?: unknown;
    };
    const guess = typeof obj.guess === "string" ? obj.guess.trim().toLowerCase() : "";
    if (!guess) return null;
    const alternatives = Array.isArray(obj.alternatives)
      ? obj.alternatives
          .filter((a): a is string => typeof a === "string")
          .map((a) => a.trim().toLowerCase())
          .slice(0, 4)
      : [];
    return { guess, alternatives };
  } catch {
    return null;
  }
}
