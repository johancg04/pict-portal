import { NextRequest, NextResponse } from "next/server";

// Server-only route: given a topic typed by the host, ask the AI for a list
// of drawable words in Spanish to use as the custom word bank for the round.
//
// Uses Google Gemini (free tier), same provider as the /api/guess route.

export const runtime = "nodejs";
export const maxDuration = 15;

type GenerateWordsResult = {
  ok: boolean;
  words?: string[];
  reason?: string;
};

export async function POST(req: NextRequest): Promise<NextResponse<GenerateWordsResult>> {
  const apiKey = process.env.GEMINI_API_KEY;
  const model = process.env.GEMINI_MODEL || "gemini-flash-lite-latest";

  if (!apiKey) {
    return NextResponse.json({ ok: false, reason: "no_api_key" }, { status: 503 });
  }

  let topic: string | undefined;
  try {
    const body = (await req.json()) as { topic?: string };
    topic = typeof body.topic === "string" ? body.topic.trim() : undefined;
  } catch {
    return NextResponse.json({ ok: false, reason: "bad_request" }, { status: 400 });
  }
  if (!topic) {
    return NextResponse.json({ ok: false, reason: "no_topic" }, { status: 400 });
  }

  const prompt =
    "Estamos armando el banco de palabras para una partida de Pictionary. " +
    `El anfitrión propuso este tema: "${topic}". ` +
    "Responde SOLO con JSON estricto, sin prosa ni bloques de código: " +
    '{"words":["<palabra>","<palabra>", ...]}. ' +
    "Genera entre 12 y 20 palabras o frases muy cortas, EN ESPAÑOL, en minúscula, " +
    "fáciles de dibujar a mano en un lienzo, relacionadas con el tema. " +
    "Evitá palabras abstractas o difíciles de representar visualmente.";

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10_000);

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            parts: [{ text: prompt }],
          },
        ],
        generationConfig: {
          maxOutputTokens: 512,
          temperature: 0.7,
        },
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!res.ok) {
      const detail = await res.text();
      console.error(`[api/generate-words] Gemini ${res.status}:`, detail.slice(0, 400));
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
    const words = parseWords(text);
    if (!words) {
      console.error("[api/generate-words] unparseable. Raw model text:", JSON.stringify(text).slice(0, 300));
      return NextResponse.json({ ok: false, reason: "unparseable" }, { status: 502 });
    }
    console.log("[api/generate-words] generated", words.length, "words for topic:", topic);
    return NextResponse.json({ ok: true, words });
  } catch (err) {
    clearTimeout(timeoutId);
    const isAbort = (err as Error).name === "AbortError";
    const reason = isAbort ? "timeout" : `fetch_error: ${(err as Error).message}`;
    console.error(`[api/generate-words] ${reason}`);
    return NextResponse.json({ ok: false, reason }, { status: 502 });
  }
}

function parseWords(text: string): string[] | null {
  const cleaned = text.replace(/```json/gi, "").replace(/```/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1) return null;
  try {
    const obj = JSON.parse(cleaned.slice(start, end + 1)) as { words?: unknown };
    if (!Array.isArray(obj.words)) return null;
    const words = obj.words
      .filter((w): w is string => typeof w === "string" && w.trim().length > 0)
      .map((w) => w.trim().toLowerCase());
    return words.length > 0 ? words : null;
  } catch {
    return null;
  }
}