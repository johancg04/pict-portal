// Visual skins the player can pick (persisted per browser).
//
// A skin is pure presentation: it sets `data-skin`, `data-palette` and
// `data-motion` on <html>, and src/app/skins.css restyles the same components
// from those attributes (color tokens, fonts, backdrop, panel/board/button
// shapes, animations). Game logic never reads them.

export type SkinId = "clasico" | "neon" | "orbita" | "comando" | "grieta";
export type MotionLevel = "full" | "soft" | "off";

export type Palette = { id: string; name: string; swatch: [string, string, string] };
export type Skin = {
  id: SkinId;
  name: string;
  tagline: string;
  /** background, primary, secondary — used for the picker's animated preview */
  preview: [string, string, string];
  palettes: Palette[];
  /** Google Fonts css2 query for the skin's typefaces, loaded on demand. */
  fonts?: string;
};

export const SKINS: Skin[] = [
  {
    id: "clasico",
    name: "Clásico",
    tagline: "El diseño de siempre, claro u oscuro",
    preview: ["#f3f4f6", "#6366f1", "#a855f7"],
    palettes: [
      { id: "indigo", name: "Índigo", swatch: ["#6366f1", "#a855f7", "#f3f4f6"] },
      { id: "esmeralda", name: "Esmeralda", swatch: ["#059669", "#14b8a6", "#f3f4f6"] },
      { id: "rosa", name: "Rosa", swatch: ["#db2777", "#f97316", "#f3f4f6"] },
      { id: "ambar", name: "Ámbar", swatch: ["#d97706", "#ef4444", "#f3f4f6"] },
    ],
  },
  {
    id: "neon",
    name: "Neón",
    tagline: "Arena synthwave con brillo",
    preview: ["#07020f", "#22d3ee", "#f472b6"],
    fonts: "family=Unbounded:wght@500;700;800",
    palettes: [
      { id: "synth", name: "Synthwave", swatch: ["#22d3ee", "#f472b6", "#a78bfa"] },
      { id: "miami", name: "Miami", swatch: ["#2dd4bf", "#fb7185", "#fdba74"] },
      { id: "toxico", name: "Tóxico", swatch: ["#a3e635", "#facc15", "#4ade80"] },
      { id: "laser", name: "Láser rojo", swatch: ["#f87171", "#e879f9", "#fb923c"] },
    ],
  },
  {
    id: "orbita",
    name: "Órbita",
    tagline: "Cristal holográfico en el espacio",
    preview: ["#050816", "#5eead4", "#a78bfa"],
    fonts: "family=Sora:wght@600;700;800",
    palettes: [
      { id: "aurora", name: "Aurora", swatch: ["#5eead4", "#a78bfa", "#f9a8d4"] },
      { id: "nebulosa", name: "Nebulosa", swatch: ["#f0abfc", "#fb7185", "#fdba74"] },
      { id: "hielo", name: "Hielo", swatch: ["#7dd3fc", "#93c5fd", "#e0f2fe"] },
      { id: "solar", name: "Solar", swatch: ["#fcd34d", "#fb923c", "#fda4af"] },
    ],
  },
  {
    id: "comando",
    name: "Comando",
    tagline: "HUD de nave en fósforo",
    preview: ["#030907", "#39ff88", "#ffb020"],
    fonts: "family=Orbitron:wght@700;900&family=JetBrains+Mono:wght@400;500;700",
    palettes: [
      { id: "fosforo", name: "Fósforo", swatch: ["#39ff88", "#ffb020", "#5ef2ff"] },
      { id: "ambar", name: "Ámbar", swatch: ["#ffb020", "#5ef2ff", "#ff5c7a"] },
      { id: "hielo", name: "Hielo", swatch: ["#5ef2ff", "#ffb020", "#c4b5fd"] },
      { id: "alerta", name: "Alerta roja", swatch: ["#ff5c7a", "#ffd166", "#ffffff"] },
    ],
  },
  {
    id: "grieta",
    name: "Grieta",
    tagline: "Battle royale de temporada",
    preview: ["#1e3a8a", "#ffe14d", "#a855f7"],
    fonts: "family=Luckiest+Guy&family=Rubik:wght@500;700;800;900",
    palettes: [
      { id: "t5", name: "Grieta (T5)", swatch: ["#ffe14d", "#b45cff", "#2563eb"] },
      { id: "desierto", name: "Desierto", swatch: ["#ffd166", "#ff7a3d", "#0f766e"] },
      { id: "nieve", name: "Nieve", swatch: ["#e0f2fe", "#7dd3fc", "#f472b6"] },
      { id: "toxico", name: "Zona tóxica", swatch: ["#bef264", "#a855f7", "#16a34a"] },
    ],
  },
];

export const SKIN_KEY = "pictportal-skin";

export type SkinPrefs = { skin: SkinId; palette: string; motion: MotionLevel };

export function defaultPrefs(): SkinPrefs {
  return { skin: "clasico", palette: SKINS[0].palettes[0].id, motion: "full" };
}

export function getSkin(id: string | null | undefined): Skin {
  return SKINS.find((s) => s.id === id) ?? SKINS[0];
}

export function readPrefs(): SkinPrefs {
  try {
    const raw = JSON.parse(localStorage.getItem(SKIN_KEY) || "null") as Partial<SkinPrefs> | null;
    const skin = getSkin(raw?.skin);
    const palette = skin.palettes.find((p) => p.id === raw?.palette)?.id ?? skin.palettes[0].id;
    const motion: MotionLevel = raw?.motion === "soft" || raw?.motion === "off" ? raw.motion : "full";
    return { skin: skin.id, palette, motion };
  } catch {
    return defaultPrefs();
  }
}

function loadFonts(skin: Skin) {
  if (!skin.fonts || document.getElementById(`pp-font-${skin.id}`)) return;
  const link = document.createElement("link");
  link.id = `pp-font-${skin.id}`;
  link.rel = "stylesheet";
  link.href = `https://fonts.googleapis.com/css2?${skin.fonts}&display=swap`;
  document.head.appendChild(link);
}

/** Applies and persists the prefs, then tells the canvas to re-read its colors. */
export function applyPrefs(prefs: SkinPrefs) {
  const root = document.documentElement;
  const skin = getSkin(prefs.skin);
  root.setAttribute("data-skin", skin.id);
  root.setAttribute("data-palette", prefs.palette);
  root.setAttribute("data-motion", prefs.motion);
  loadFonts(skin);
  try {
    localStorage.setItem(SKIN_KEY, JSON.stringify(prefs));
  } catch {
    /* private mode: the choice just won't persist */
  }
  window.dispatchEvent(new CustomEvent("pictportal-theme", { detail: root.getAttribute("data-theme") }));
  window.dispatchEvent(new CustomEvent("pictportal-skin", { detail: prefs }));
}

/**
 * Inline script for <head>: applies the saved skin before first paint so
 * there's no flash of the default look. Kept dependency-free on purpose.
 */
export const SKIN_INIT_SCRIPT = `(function(){try{var d=document.documentElement;var p=JSON.parse(localStorage.getItem(${JSON.stringify(
  SKIN_KEY,
)})||"null");var fonts=${JSON.stringify(Object.fromEntries(SKINS.map((s) => [s.id, s.fonts || ""])))};var ids=${JSON.stringify(
  SKINS.map((s) => s.id),
)};var s=p&&ids.indexOf(p.skin)>=0?p.skin:"clasico";d.setAttribute("data-skin",s);if(p&&p.palette)d.setAttribute("data-palette",p.palette);d.setAttribute("data-motion",p&&(p.motion==="soft"||p.motion==="off")?p.motion:"full");if(fonts[s]){var l=document.createElement("link");l.id="pp-font-"+s;l.rel="stylesheet";l.href="https://fonts.googleapis.com/css2?"+fonts[s]+"&display=swap";document.head.appendChild(l);}}catch(e){}})();`;
