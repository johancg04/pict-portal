// Banco de palabras por defecto (cuando la sala no usa una categoría propia).
// Sustantivos concretos y dibujables, agrupados por tema solo para leerlo mejor.
export const WORDS = [
  // animales
  "gato", "perro", "pez", "serpiente", "araña", "elefante", "jirafa", "león", "tigre", "cebra",
  "mono", "oso", "conejo", "tortuga", "caracol", "pulpo", "tiburón", "ballena", "delfín",
  "pingüino", "búho", "pato", "gallina", "vaca", "cerdo", "oveja", "caballo", "burro", "rana",
  "cocodrilo", "dinosaurio", "mariposa", "abeja", "hormiga", "mosca", "mariquita", "murciélago",
  "ratón", "ardilla", "zorro", "lobo", "camello", "canguro", "koala", "panda", "hipopótamo",
  "rinoceronte", "foca", "cangrejo", "medusa", "estrella de mar", "caballito de mar", "loro",
  "flamenco", "águila", "cisne", "gusano", "erizo", "llama", "pavo real", "avestruz", "escorpión",
  "lagartija", "camaleón", "unicornio", "dragón", "pollito", "ciervo", "morsa", "nutria",
  // comida
  "manzana", "plátano", "pizza", "pera", "uvas", "sandía", "fresa", "piña", "cereza", "limón",
  "naranja", "zanahoria", "tomate", "brócoli", "maíz", "papa", "huevo", "pan", "queso",
  "hamburguesa", "perro caliente", "taco", "helado", "pastel", "galleta", "dona", "palomitas",
  "sándwich", "sushi", "salchicha", "chocolate", "caramelo", "piruleta", "botella", "aguacate",
  "coco", "pimiento", "cebolla", "ajo", "berenjena", "calabaza", "sopa", "espagueti", "croissant",
  "waffle", "panqueques", "nachos", "burrito", "empanada", "arepa",
  // casa
  "reloj", "libro", "llave", "taza", "cama", "silla", "mesa", "sofá", "lámpara", "televisión",
  "puerta", "ventana", "escalera", "espejo", "cuchara", "tenedor", "cuchillo", "plato", "olla",
  "sartén", "tetera", "nevera", "horno", "microondas", "lavadora", "inodoro", "ducha", "bañera",
  "cepillo de dientes", "peine", "tijeras", "martillo", "destornillador", "clavo", "tornillo",
  "sierra", "pala", "rastrillo", "escoba", "cubeta", "vela", "bombilla", "enchufe", "pila", "imán",
  "candado", "campana", "despertador", "almohada", "percha", "cortina", "alfombra", "maceta",
  "regadera", "jaula", "buzón", "chimenea", "ventilador", "plancha", "aspiradora", "teléfono",
  "celular", "computadora", "teclado", "auriculares", "micrófono", "altavoz", "control remoto",
  "calculadora", "lápiz", "goma de borrar", "regla", "cuaderno", "mochila", "sobre", "pegamento",
  "grapadora", "globo terráqueo", "mapa", "brújula", "lupa", "telescopio", "microscopio", "caja",
  "bolsa", "lata", "bote de basura", "cuerda", "cadena", "reloj de arena", "grifo", "jabón",
  "toalla", "cepillo", "sacapuntas", "pincel", "paleta de pintor",
  // ropa
  "sombrero", "zapato", "gafas", "corona", "camiseta", "pantalón", "vestido", "falda", "calcetín",
  "bufanda", "guante", "gorra", "bota", "chaqueta", "corbata", "cinturón", "anillo", "collar",
  "arete", "bolso", "cartera", "paraguas", "chancla", "gafas de sol", "pajarita", "casco",
  "mascarilla", "delantal",
  // transporte
  "coche", "barco", "bicicleta", "cohete", "avión", "helicóptero", "tren", "autobús", "camión",
  "moto", "submarino", "velero", "globo aerostático", "patineta", "patinete", "tractor",
  "ambulancia", "camión de bomberos", "taxi", "carrito", "semáforo", "ovni", "nave espacial",
  "canoa", "paracaídas", "grúa", "excavadora", "carreta", "triciclo", "ancla",
  // naturaleza
  "árbol", "sol", "nube", "luna", "estrella", "montaña", "flor", "cactus", "volcán", "isla",
  "playa", "ola", "río", "cascada", "arcoíris", "rayo", "lluvia", "nieve", "copo de nieve",
  "muñeco de nieve", "tornado", "hoja", "palmera", "pino", "rosa", "girasol", "tulipán", "seta",
  "piedra", "cueva", "planeta", "cometa", "fuego", "gota", "trébol", "bellota", "concha", "tronco",
  "hierba", "eclipse",
  // lugares
  "casa", "faro", "puente", "castillo", "iglesia", "hospital", "escuela", "carpa", "pirámide",
  "torre", "molino", "granja", "iglú", "rascacielos", "columpio", "tobogán", "fuente", "banco",
  "pozo", "noria", "tienda de campaña", "estatua", "granero", "muelle", "garaje",
  // juegos y música
  "pelota", "balón", "guitarra", "piano", "tambor", "trompeta", "violín", "flauta", "maracas",
  "bate", "raqueta", "portería", "canasta", "patines", "dados", "naipe", "yoyo", "trompo",
  "rompecabezas", "mando", "pesas", "trofeo", "medalla", "silbato", "esquís", "tabla de surf",
  "caña de pescar", "boliche", "dardo", "diana", "ajedrez", "xilófono", "acordeón", "saxofón",
  // personajes
  "robot", "pirata", "fantasma", "bruja", "mago", "sirena", "vampiro", "payaso", "astronauta",
  "ninja", "rey", "princesa", "extraterrestre", "momia", "superhéroe", "bombero", "policía",
  "cocinero", "buzo", "vaquero", "caballero", "hada", "duende", "zombi", "espantapájaros",
  // cuerpo
  "ojo", "nariz", "boca", "oreja", "mano", "pie", "diente", "corazón", "cerebro", "hueso",
  "calavera", "esqueleto", "bigote", "barba", "dedo", "lengua", "labios", "huella",
  // cosas
  "bandera", "regalo", "piñata", "espada", "escudo", "arco", "flecha", "cañón", "bomba",
  "diamante", "cofre", "moneda", "billete", "alcancía", "llavero", "bolígrafo", "chupete",
  "biberón", "sonajero", "carta", "tarjeta", "sello", "etiqueta", "termómetro", "jeringa",
  "curita", "muleta", "silla de ruedas", "lápiz labial", "perfume", "secador", "rizador",
  "cepillo de pelo", "cámara", "gafas de buceo", "linterna", "hacha", "tijeras de podar",
  "extintor",
];

export function randomWord(): string {
  return WORDS[Math.floor(Math.random() * WORDS.length)];
}

// Draws from the room's custom list when the host set one, otherwise falls
// back to the default bank — the one place that decides which source a
// round's word comes from.
//
// `avoid` lists words to skip, most important first (e.g. [words already
// played in this room, words this device saw recently]). The first tier is
// always respected while it leaves something to pick; later tiers are dropped
// one by one when they would empty the pool, so a short custom list still
// works and never repeats sooner than it has to.
export function pickWord(custom?: string[], avoid: string[][] = []): string {
  const pool = custom && custom.length > 0 ? custom : WORDS;
  for (let n = avoid.length; n >= 0; n--) {
    const skip = new Set(avoid.slice(0, n).flat().map(wordKey));
    const fresh = pool.filter((w) => !skip.has(wordKey(w)));
    if (fresh.length > 0) return fresh[Math.floor(Math.random() * fresh.length)];
  }
  return pool[Math.floor(Math.random() * pool.length)];
}

/** Comparison key for a word: case- and accent-insensitive. */
export function wordKey(w: string): string {
  return normalize(w);
}

// Words this device handed out lately, kept across games and rooms so a new
// game doesn't reopen with the same few words. Per-viewer convenience only:
// storage can be unavailable (private mode), which just means no memory.
const RECENT_KEY = "pp-recent-words";
const RECENT_MAX = 150;

export function recentWords(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    const list = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(list) ? list.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function rememberWord(word: string) {
  try {
    const key = wordKey(word);
    const next = [word, ...recentWords().filter((w) => wordKey(w) !== key)].slice(0, RECENT_MAX);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    /* storage unavailable: nothing to remember */
  }
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
