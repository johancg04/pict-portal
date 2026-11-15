import zlib from "node:zlib";
import fs from "node:fs";

const env = Object.fromEntries(
  fs.readFileSync(".env.local", "utf8").split("\n")
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);
const KEY = env.GEMINI_API_KEY;

const norm = (s) => s.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

async function gemini(model, parts, maxTokens = 4096, temperature = 0.6) {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${KEY}`,
    { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ contents: [{ parts }], generationConfig: { maxOutputTokens: maxTokens, temperature } }) });
  if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 120)}`);
  const d = await res.json();
  return d.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
}

// Mismo parser tolerante que src/app/api/draw/route.ts
function closeBrackets(s) {
  const st = []; let inStr = false, esc = false;
  for (const ch of s) {
    if (esc) { esc = false; continue; }
    if (inStr) { if (ch === "\\") esc = true; else if (ch === '"') inStr = false; continue; }
    if (ch === '"') inStr = true;
    else if (ch === "{") st.push("}");
    else if (ch === "[") st.push("]");
    else if (ch === "}" || ch === "]") st.pop();
  }
  return s + (inStr ? '"' : "") + st.reverse().join("");
}
function parseStrokes(text) {
  const c = text.replace(/```json/gi, "").replace(/```/g, "").trim();
  const s = c.indexOf("{"); if (s === -1) return null;
  let obj = null;
  for (let e = c.lastIndexOf("}"); e > s; e = c.lastIndexOf("}", e - 1)) {
    try { obj = JSON.parse(c.slice(s, e + 1)); break; } catch {}
  }
  if (!obj) { try { obj = JSON.parse(closeBrackets(c.slice(s))); } catch { return null; } }
  const raw = obj?.strokes; if (!Array.isArray(raw)) return null;
  const out = [];
  for (const entry of raw) {
    const pts = Array.isArray(entry) ? entry : Array.isArray(entry?.points) ? entry.points : null;
    if (!pts) continue;
    const points = [];
    for (const p of pts) {
      let x, y;
      if (Array.isArray(p)) [x, y] = p; else if (p && typeof p === "object") { x = p.x; y = p.y; }
      if (typeof x !== "number" || typeof y !== "number" || !isFinite(x) || !isFinite(y)) continue;
      points.push({ x: Math.max(0, Math.min(1, x)), y: Math.max(0, Math.min(1, y)) });
    }
    if (points.length >= 2) out.push({ points });
  }
  return out.length ? out : null;
}

const W = 320, H = 213, BG = [15, 17, 21], INK = [230, 232, 236];
function render(strokes) {
  const px = Buffer.alloc(W * H * 3);
  for (let i = 0; i < W * H; i++) { px[i*3]=BG[0]; px[i*3+1]=BG[1]; px[i*3+2]=BG[2]; }
  const set = (x, y) => { x=Math.round(x); y=Math.round(y);
    for (let a=-1;a<=1;a++) for (let b=-1;b<=1;b++) { const u=x+a, v=y+b;
      if (u<0||v<0||u>=W||v>=H) continue; const i=(v*W+u)*3; px[i]=INK[0];px[i+1]=INK[1];px[i+2]=INK[2]; } };
  const ln = (x0,y0,x1,y1) => { const n=Math.max(Math.abs(x1-x0),Math.abs(y1-y0))*2||1;
    for (let i=0;i<=n;i++) set(x0+(x1-x0)*i/n, y0+(y1-y0)*i/n); };
  for (const s of strokes) for (let i=0;i<s.points.length-1;i++)
    ln(s.points[i].x*W, s.points[i].y*H, s.points[i+1].x*W, s.points[i+1].y*H);
  const raw = Buffer.alloc(H*(W*3+1));
  for (let y=0;y<H;y++){ raw[y*(W*3+1)]=0; px.copy(raw, y*(W*3+1)+1, y*W*3, (y+1)*W*3); }
  let T=null; const crc=(b)=>{ if(!T){T=[];for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;T[n]=c;}}
    let c=0xffffffff; for(const x of b) c=T[(c^x)&0xff]^(c>>>8); return c^0xffffffff; };
  const ch=(t,d)=>{const l=Buffer.alloc(4);l.writeUInt32BE(d.length);
    const td=Buffer.concat([Buffer.from(t),d]);const cc=Buffer.alloc(4);cc.writeUInt32BE(crc(td)>>>0);
    return Buffer.concat([l,td,cc]);};
  const ih=Buffer.alloc(13); ih.writeUInt32BE(W,0); ih.writeUInt32BE(H,4); ih[8]=8; ih[9]=2;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), ch("IHDR",ih),
    ch("IDAT", zlib.deflateSync(raw)), ch("IEND", Buffer.alloc(0))]);
}

const GUESS_PROMPT =
  "Estamos jugando Pictionary. Este es un garabato en progreso sobre un lienzo. " +
  "Adivina qué se está dibujando. Responde SOLO con JSON estricto, sin prosa ni bloques de código: " +
  '{"guess":"<un sustantivo común>","alternatives":["<sustantivo>","<sustantivo>"]}. ' +
  "Usa sustantivos EN ESPAÑOL, cotidianos, en singular y en minúscula.";

// ---- Variantes de prompt de dibujo ----
const PROMPT_ACTUAL = (w) =>
  `Estás jugando Pictionary y te toca DIBUJAR la palabra "${w}".\n` +
  `Haz un dibujo de líneas simple y claro que un humano reconozca, como un garabato de pizarra.\n` +
  `Responde SOLO con JSON estricto, sin prosa ni bloques de código:\n` +
  `{"strokes":[{"points":[[x,y],[x,y],...]}, ...]}\n` +
  `Reglas: las coordenadas son decimales normalizados de 0 a 1.\n` +
  `Usa entre 3 y 12 trazos. Cada trazo es una polilínea conectada de 2 a 40 puntos.\n` +
  `Llena el lienzo: abarca aproximadamente x 0.15-0.85 e y 0.15-0.85.\n` +
  `Para las curvas, usa muchos segmentos cortos. Cierra las formas repitiendo el primer punto al final.`;

const PROMPT_NUEVO = (w) =>
  `Eres un ilustrador dibujando "${w}" para Pictionary. El lienzo es apaisado (3:2).\n\n` +
  `PIENSA PRIMERO, luego dibuja. Responde SOLO con JSON estricto:\n` +
  `{"plan":"<qué partes vas a dibujar y dónde>","strokes":[{"points":[[x,y],...]}, ...]}\n\n` +
  `El campo "plan" es obligatorio: enumera las 3-6 partes reconocibles del objeto y en qué\n` +
  `zona del lienzo va cada una. Dibuja DESPUÉS siguiendo ese plan.\n\n` +
  `CÓMO DIBUJAR BIEN:\n` +
  `- Dibuja la SILUETA reconocible desde su vista más típica (animales y vehículos de\n` +
  `  perfil; caras y edificios de frente). Nada abstracto ni simbólico.\n` +
  `- El objeto debe ocupar casi todo el lienzo: x entre 0.10 y 0.90, y entre 0.10 y 0.90.\n` +
  `- Cada parte es un trazo aparte. Usa 4-12 trazos.\n` +
  `- Las curvas necesitan MUCHOS puntos: un círculo son ~16 puntos, no 4.\n` +
  `- Cierra las formas repitiendo el primer punto al final.\n` +
  `- Las coordenadas son decimales 0..1 ("x" izquierda→derecha, "y" arriba→abajo).\n\n` +
  `EJEMPLO del nivel de detalle esperado (para "taza"):\n` +
  `{"plan":"cuerpo cilíndrico al centro, asa a la derecha, vapor arriba",\n` +
  ` "strokes":[\n` +
  `  {"points":[[0.30,0.35],[0.30,0.75],[0.33,0.80],[0.62,0.80],[0.65,0.75],[0.65,0.35],[0.30,0.35]]},\n` +
  `  {"points":[[0.65,0.45],[0.74,0.45],[0.78,0.52],[0.74,0.60],[0.65,0.60]]},\n` +
  `  {"points":[[0.40,0.28],[0.43,0.22],[0.40,0.16],[0.43,0.10]]}\n` +
  ` ]}`;

const PALABRAS = ["gato", "casa", "cohete", "paraguas", "pez", "bicicleta", "araña", "reloj", "guitarra", "elefante", "tijeras", "árbol"];

// Dibuja con la ruta REAL (/api/draw, con el servidor en marcha): mide el prompt nuevo + reencuadre.
async function viaRuta(w) {
  const r = await fetch("http://localhost:3000/api/draw", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ word: w, difficulty: "normal" }) });
  const d = await r.json();
  return d.ok ? d.strokes : null;
}

async function evaluar(nombre, model, promptFn) {
  let ok = 0, fallos = [];
  fs.mkdirSync("bench", { recursive: true }); // outputs go in the bench/ folder
  for (const w of PALABRAS) {
    await new Promise(r => setTimeout(r, 4000));
    try {
      const strokes = promptFn ? parseStrokes(await gemini(model, [{ text: promptFn(w) }])) : await viaRuta(w);
      if (!strokes) { fallos.push(`${w}(sin trazos)`); continue; }
      const png = render(strokes);
      const back = await gemini(model === "gemini-flash-lite-latest" ? model : "gemini-flash-lite-latest",
        [{ inline_data: { mime_type: "image/png", data: png.toString("base64") } }, { text: GUESS_PROMPT }], 512, 0.4);
      const c = back.replace(/```json/gi, "").replace(/```/g, "").trim();
      const j = JSON.parse(c.slice(c.indexOf("{"), c.lastIndexOf("}") + 1));
      const cands = [j.guess, ...(j.alternatives ?? [])].map(norm);
      if (cands.includes(norm(w))) { ok++; fs.writeFileSync(`bench/bench-${nombre}-${w}-OK.png`, png); }
      else { fallos.push(`${w}→${j.guess}`); fs.writeFileSync(`bench/bench-${nombre}-${w}-NO.png`, png); }
    } catch (e) { fallos.push(`${w}(err:${String(e.message).slice(0,40)})`); }
  }
  console.log(`${nombre.padEnd(22)} ${ok}/${PALABRAS.length}  ${fallos.length ? "fallan: " + fallos.join(", ") : ""}`);
  return ok;
}

console.log(`Reconocidas por el adivinador (de ${PALABRAS.length} palabras):\n`);
if (process.env.BENCH_ONLY !== "ruta") await evaluar("A-actual-lite", "gemini-flash-lite-latest", PROMPT_ACTUAL);
await evaluar("D-ruta-nueva", "gemini-flash-lite-latest", null);
