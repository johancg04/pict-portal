import { NextRequest, NextResponse } from "next/server";
import { DRAW, parseDifficulty } from "@/lib/difficulty";
import { cachedDrawings, saveDrawing, VARIANTS_PER_WORD } from "@/lib/drawCache";

// Server-only route: the AI takes its turn as the *drawer*. Given a word, it
// returns a doodle as normalized polylines (0..1) that the client scales to
// the canvas and plays back progressively, so viewers watch it appear stroke
// by stroke exactly like a human drawing.
//
// Uses Google Gemini (free tier). Get a key at https://aistudio.google.com/apikey

export const runtime = "nodejs";
// Room for two Gemini attempts (12 s each) plus a quota back-off in between;
// without it the platform's default limit could kill the retry mid-flight.
export const maxDuration = 40;

type Point = { x: number; y: number };
type Stroke = { points: Point[] };
type DrawResult = { ok: boolean; strokes?: Stroke[]; reason?: string; cached?: boolean };

const pick = <T,>(xs: T[]): T => xs[Math.floor(Math.random() * xs.length)];

export async function POST(req: NextRequest): Promise<NextResponse<DrawResult>> {
  const apiKey = process.env.GEMINI_API_KEY;
  const model = process.env.GEMINI_MODEL || "gemini-flash-lite-latest";

  if (!apiKey) {
    return NextResponse.json({ ok: false, reason: "no_api_key" });
  }

  let word: string | undefined;
  let difficulty = parseDifficulty(undefined);
  try {
    const body = (await req.json()) as { word?: string; difficulty?: string };
    difficulty = parseDifficulty(body.difficulty);
    word = typeof body.word === "string" ? body.word.trim() : undefined;
  } catch {
    return NextResponse.json({ ok: false, reason: "bad_request" }, { status: 400 });
  }
  if (!word) {
    return NextResponse.json({ ok: false, reason: "no_word" }, { status: 400 });
  }

  // Reuse a saved doodle once this word has enough of them: no tokens, instant.
  const saved = await cachedDrawings(word, difficulty);
  if (saved.length >= VARIANTS_PER_WORD) {
    console.log(`[api/draw] "${word}" from cache (${saved.length} saved)`);
    return NextResponse.json({ ok: true, strokes: pick(saved), cached: true });
  }

  const prompt =
    `Estás jugando Pictionary y te toca DIBUJAR la palabra "${word}".\n` +
    `Haz un dibujo de líneas simple y claro que un humano reconozca, como un garabato de pizarra.\n` +
    `Responde SOLO con JSON estricto, sin prosa ni bloques de código:\n` +
    `{"strokes":[{"points":[[x,y],[x,y],...]}, ...]}\n` +
    `Reglas: las coordenadas son decimales normalizados de 0 a 1 ("x" de izquierda a derecha, "y" de arriba abajo).\n` +
    DRAW.rules[difficulty] +
    `Llena el lienzo: abarca aproximadamente x 0.15-0.85 e y 0.15-0.85. Dibuja el objeto completo y centrado.\n` +
    `Para las curvas, usa muchos segmentos cortos. Cierra las formas repitiendo el primer punto al final.`;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  // Response time for the same prompt swings a lot (measured: 2.4s, 14s, and
  // a >20s stall on three consecutive identical requests). One long attempt
  // therefore fails far too often, while a retry after a shorter budget
  // almost always lands quickly — so cap each try and allow one retry.
  let lastReason = "timeout";
  for (let attempt = 0; attempt < 2; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 12000);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { maxOutputTokens: 4096, temperature: DRAW.temperature[difficulty] },
        }),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (res.status === 429 && attempt === 0) {
        // Per-minute quota: wait as long as Gemini asks (within reason) and
        // take the retry we already have.
        const detail = await res.text();
        const m = /"retryDelay":\s*"(\d+(?:\.\d+)?)s"/.exec(detail);
        const waitMs = Math.min(12_000, Math.max(4_000, m ? Math.ceil(Number(m[1]) * 1000) : 6_000));
        console.error(`[api/draw] Gemini 429 — waiting ${waitMs}ms before retry`);
        await new Promise((r) => setTimeout(r, waitMs));
        lastReason = "gemini_429";
        continue;
      }

      if (!res.ok) {
        const detail = await res.text();
        console.error(`[api/draw] Gemini ${res.status}:`, detail.slice(0, 400));
        lastReason = `gemini_${res.status}`;
        break; // falls through to the saved-doodle fallback below
      }

      const data = (await res.json()) as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      };
      const text =
        data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
      const strokes = parseStrokes(text);
      if (strokes) {
        console.log(`[api/draw] drew "${word}" as ${strokes.length} strokes`);
        await saveDrawing(word, difficulty, strokes);
        return NextResponse.json({ ok: true, strokes });
      }
      // Unparseable is also worth one more shot — it's the same coin flip.
      console.error("[api/draw] unparseable. Raw:", JSON.stringify(text).slice(0, 300));
      lastReason = "unparseable";
    } catch (err) {
      clearTimeout(timeoutId);
      const isAbort = (err as Error).name === "AbortError";
      lastReason = isAbort ? "timeout" : `fetch_error: ${(err as Error).message}`;
      console.error(`[api/draw] ${lastReason}${attempt === 0 ? " — retrying" : ""}`);
      if (!isAbort) break; // a real network failure won't fix itself on retry
    }
  }

  // Gemini failed (quota, timeout…): a saved doodle beats skipping the turn.
  if (saved.length > 0) {
    console.log(`[api/draw] "${word}" from cache after ${lastReason}`);
    return NextResponse.json({ ok: true, strokes: pick(saved), cached: true });
  }
  return NextResponse.json({ ok: false, reason: lastReason }, { status: 502 });
}

function parseStrokes(text: string): Stroke[] | null {
  const cleaned = text.replace(/```json/gi, "").replace(/```/g, "").trim();
  const start = cleaned.indexOf("{");
  if (start === -1) return null;

  // This model is unreliable about how it terminates the object: observed
  // both an extra trailing "}" and a missing one entirely (with
  // finishReason STOP, so it isn't truncation). Try, in order: walking back
  // from each "}" (drops trailing junk), then re-balancing whatever brackets
  // were left open (repairs a missing tail).
  let obj: unknown = null;
  for (let end = cleaned.lastIndexOf("}"); end > start; end = cleaned.lastIndexOf("}", end - 1)) {
    try {
      obj = JSON.parse(cleaned.slice(start, end + 1));
      break;
    } catch {
      /* try the next-shorter candidate */
    }
  }
  if (obj === null) {
    try {
      obj = JSON.parse(closeBrackets(cleaned.slice(start)));
    } catch {
      return null;
    }
  }
  if (!obj || typeof obj !== "object") return null;

  const raw = (obj as { strokes?: unknown }).strokes;
  if (!Array.isArray(raw)) return null;

  const strokes: Stroke[] = [];
  for (const entry of raw) {
    // Accept both {points:[[x,y],...]} and a bare [[x,y],...] — the model
    // switches between the two shapes run to run.
    const pts = Array.isArray(entry)
      ? entry
      : Array.isArray((entry as { points?: unknown }).points)
        ? (entry as { points: unknown[] }).points
        : null;
    if (!pts) continue;

    const points: Point[] = [];
    for (const p of pts) {
      let x: unknown, y: unknown;
      if (Array.isArray(p)) [x, y] = p;
      else if (p && typeof p === "object") {
        x = (p as { x?: unknown }).x;
        y = (p as { y?: unknown }).y;
      }
      if (typeof x !== "number" || typeof y !== "number") continue;
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      points.push({ x: clamp01(x), y: clamp01(y) });
    }
    if (points.length >= 2) strokes.push({ points });
  }

  return strokes.length > 0 ? strokes : null;
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** Append whatever `]`/`}` the model left unclosed, innermost first. */
function closeBrackets(s: string): string {
  const stack: string[] = [];
  let inString = false;
  let escaped = false;
  for (const ch of s) {
    if (escaped) {
      escaped = false;
      continue;
    }
    if (inString) {
      if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") stack.push("}");
    else if (ch === "[") stack.push("]");
    else if (ch === "}" || ch === "]") stack.pop();
  }
  // A dangling `,` or a half-written number would still fail to parse, which
  // is fine — the caller treats that as "no drawing this time".
  return s + (inString ? '"' : "") + stack.reverse().join("");
}
