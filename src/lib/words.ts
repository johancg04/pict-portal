// Banco de palabras. Sustantivos concretos y fáciles de dibujar.
export const WORDS = [
  "gato", "perro", "casa", "árbol", "coche", "sol", "barco", "pez", "estrella",
  "manzana", "flor", "reloj", "libro", "llave", "taza", "sombrero", "zapato",
  "guitarra", "cohete", "paraguas", "bicicleta", "pizza", "plátano", "serpiente",
  "escalera", "nube", "luna", "cámara", "gafas", "araña", "corona", "robot",
  "cactus", "faro", "montaña", "puente", "sobre", "globo", "ancla", "seta",
];

export function randomWord(): string {
  return WORDS[Math.floor(Math.random() * WORDS.length)];
}

// Draws from the room's custom list when the host set one, otherwise falls
// back to the default bank — the one place that decides which source a
// round's word comes from.
export function pickWord(custom?: string[]): string {
  if (custom && custom.length > 0) {
    return custom[Math.floor(Math.random() * custom.length)];
  }
  return randomWord();
}

const MAX_CUSTOM_WORDS = 100;

// Turns the host's free-form textarea input into a clean word list: split on
// commas or newlines (whichever they used), trim, drop blanks, and
// case-insensitively dedupe — capped so one pasted wall of text can't bloat
// the game-config broadcast everyone receives.
export function parseCustomWords(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of text.split(/[,\n]/)) {
    const w = raw.trim();
    if (!w) continue;
    const key = w.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(w);
    if (out.length >= MAX_CUSTOM_WORDS) break;
  }
  return out;
}

// Length hint shown to guessers, e.g. "cat" -> "_ _ _".
export function maskWord(word: string): string {
  return word
    .split("")
    .map((c) => (c === " " ? " " : "_"))
    .join(" ");
}

// Fallback clue when the AI hint is unavailable: the masked word with `count`
// letters uncovered, always including the first one so it reads as a hint
// rather than noise. Deterministic per (word, count) so repeat calls with the
// same count don't shuffle which letters are showing.
export function revealLetters(word: string, count: number): string {
  const chars = word.split("");
  const idxs = chars.map((_, i) => i).filter((i) => chars[i] !== " ");
  const shown = new Set<number>();
  if (idxs.length > 0) shown.add(idxs[0]);
  // Walk at a fixed stride so successive hints keep earlier reveals visible.
  const stride = Math.max(2, Math.floor(idxs.length / Math.max(1, count)));
  for (let k = stride; k < idxs.length && shown.size < count; k += stride) {
    shown.add(idxs[k]);
  }
  return chars.map((c, i) => (c === " " ? " " : shown.has(i) ? c : "_")).join(" ");
}

// Quita tildes y convierte la ñ en n, para comparar respuestas.
function normalize(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .normalize("NFD")
    // Marcas diacríticas: tras NFD, "á" es "a" + U+0301, así que basta con
    // borrar el rango combinante. Esto también descompone "ñ" en "n" + U+0303.
    .replace(/[̀-ͯ]/g, "");
}

// Compara una respuesta con la palabra objetivo. Ignora mayúsculas, espacios
// sobrantes, tildes y la ñ — mucha gente escribe rápido sin acentos o desde un
// teclado sin ñ, y rechazar "arana" para "araña" se siente como un bug.
// Sigue exigiendo la palabra correcta: no tolera erratas ("caza" ≠ "casa").
export function isCorrect(guess: string, word: string): boolean {
  const g = normalize(guess);
  if (!g) return false;
  return g === normalize(word);
}
