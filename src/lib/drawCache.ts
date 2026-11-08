// Server-only module: import it from API routes, never from components (it
// reads the service-role key).
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import type { AiDifficulty } from "@/lib/types";
import { wordKey } from "@/lib/words";

// Saved AI doodles, so the AI doesn't ask Gemini to draw the same word over and
// over. Each (word, difficulty) keeps up to VARIANTS_PER_WORD drawings: until
// then every AI turn draws a fresh one (and saves it); after that the AI picks
// one of the saved ones at random — no tokens, instant, still some variety.
//
// Server-only and written with the service-role key, so nobody can plant
// drawings from the browser. Without the key or the `ai_drawings` table (see
// supabase/schema.sql) every call quietly reports "no cache" and the game
// draws with Gemini exactly as before.

export type CachedStroke = { points: { x: number; y: number }[] };

export const VARIANTS_PER_WORD = 4;
const TIMEOUT_MS = 2500; // a slow cache must never hold up the AI's turn

let client: SupabaseClient | null | undefined;
function db(): SupabaseClient | null {
  if (client !== undefined) return client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  client = url && key ? createClient(url, key, { auth: { persistSession: false } }) : null;
  return client;
}

function withTimeout<T>(p: PromiseLike<T>, fallback: T): Promise<T> {
  return Promise.race([
    Promise.resolve(p),
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), TIMEOUT_MS)),
  ]);
}

/** Saved drawings for this word and difficulty (empty when there are none or the cache is off). */
export async function cachedDrawings(word: string, difficulty: AiDifficulty): Promise<CachedStroke[][]> {
  const c = db();
  if (!c) return [];
  try {
    const { data, error } = await withTimeout(
      c
        .from("ai_drawings")
        .select("strokes")
        .eq("word_key", wordKey(word))
        .eq("difficulty", difficulty)
        .limit(VARIANTS_PER_WORD),
      { data: null, error: { message: "timeout" } } as never,
    );
    if (error || !data) {
      if (error) console.error("[drawCache] read:", error.message);
      return [];
    }
    return (data as { strokes: unknown }[]).map((r) => r.strokes).filter(isStrokes);
  } catch (err) {
    console.error("[drawCache] read failed:", (err as Error).message);
    return [];
  }
}

/** Stores a fresh drawing. Best effort: a failure only means it isn't reused later. */
export async function saveDrawing(word: string, difficulty: AiDifficulty, strokes: CachedStroke[]) {
  const c = db();
  if (!c) return;
  try {
    const { error } = await withTimeout(
      c.from("ai_drawings").insert({ word_key: wordKey(word), difficulty, strokes }),
      { error: { message: "timeout" } } as never,
    );
    if (error) console.error("[drawCache] write:", error.message);
  } catch (err) {
    console.error("[drawCache] write failed:", (err as Error).message);
  }
}

function isStrokes(v: unknown): v is CachedStroke[] {
  return (
    Array.isArray(v) &&
    v.length > 0 &&
    v.every((s) => s && typeof s === "object" && Array.isArray((s as CachedStroke).points))
  );
}
