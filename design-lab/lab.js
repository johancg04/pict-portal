/* Pict-Portal design lab: shared, self-contained game simulation.
 *
 * Every proposal page uses the same data-* hooks so the three designs behave
 * identically and only the look changes. Nothing here talks to a server:
 * it fakes a live round so the layouts can be tried on any device.
 *
 * Hooks:
 *   body[data-role]            "guess" | "draw"   (toggle with [data-role-btn])
 *   body[data-tab]             "chat" | "players" | "score" (mobile tabs, [data-tab-btn])
 *   canvas[data-board]         drawing surface (data-bg, data-ink, data-glow)
 *   [data-word] [data-word-label] [data-timer] [data-timer-mmss] [data-round]
 *   [data-color] [data-size] [data-tool="pen|eraser"] [data-action="clear|undo|hint|skip|end"]
 *   [data-chat-list] form[data-chat-form] [data-typing] [data-unread]
 *   [data-react] [data-fx] [data-toast] [data-score="<id>"] [data-rank]
 *   [data-ai-bars] [data-ai-last] [data-coords]
 *   [data-ambient] (decorative motion, element + children) · [data-ambient-self] (element only)
 *   <script type="application/json" id="lab-config"> { style, primaryVar, inkFollowsPrimary, themes[] }
 *
 * URL params: ?role=draw|guess  ?demo=1 (auto-play)  ?theme=<id>  ?motion=full|soft|off  ?tab=chat|players|score
 */
(() => {
  "use strict";

  const WORD = "guitarra";
  const ROUND_SECONDS = 90;
  const TOTAL_ROUNDS = 5;
  const MAX_HINTS = 3;
  const AI_GUESSES = ["violín", "ukelele", "bajo", "laúd", "banjo", "arpa", "mandolina", "raqueta"];
  const PEER_GUESSES = ["¿lámpara?", "¿pera?", "¿raqueta?", "¿violín?", "¿cuchara?", "creo que es un instrumento", "¡qué buen trazo!"];
  const STYLES = [
    { id: "neon", name: "Neón", file: "1-neon.html", colors: ["#07020f", "#22d3ee", "#f472b6"] },
    { id: "orbita", name: "Órbita", file: "2-orbita.html", colors: ["#050816", "#5eead4", "#a78bfa"] },
    { id: "comando", name: "Comando", file: "3-comando.html", colors: ["#030907", "#39ff88", "#ffb020"] },
    { id: "grieta", name: "Grieta", file: "4-grieta.html", colors: ["#1e3a8a", "#ffe14d", "#a855f7"] },
  ];
  const osReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const body = document.body;
  const root = document.documentElement;
  const params = new URLSearchParams(location.search);
  const norm = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[¿?¡!.,]/g, "").trim().toLowerCase();
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  const rand = (a, b) => a + Math.random() * (b - a);
  const restart = (el, cls) => {
    el.classList.remove(cls);
    void el.offsetWidth;
    el.classList.add(cls);
  };
  const ICON = {
    heart: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 20.5s-7.5-4.6-7.5-10.4A4.3 4.3 0 0 1 12 7.4a4.3 4.3 0 0 1 7.5 2.7c0 5.8-7.5 10.4-7.5 10.4z"/></svg>',
    palette: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3a9 9 0 1 0 0 18c1.1 0 1.8-.8 1.8-1.7 0-.5-.2-.9-.5-1.2-.3-.3-.5-.7-.5-1.2 0-.9.8-1.7 1.7-1.7H16a5 5 0 0 0 5-5c0-4-4-7.2-9-7.2z"/><circle cx="7.5" cy="11" r="1.2"/><circle cx="10" cy="7" r="1.2"/><circle cx="14.5" cy="7" r="1.2"/><circle cx="17" cy="11" r="1.2"/></svg>',
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  };

  // ---- page config + saved preferences ----------------------------------
  const cfg = (() => {
    try {
      return JSON.parse($("#lab-config")?.textContent || "{}");
    } catch {
      return {};
    }
  })();
  const themes = cfg.themes || [];
  const STORE_KEY = `pp-lab-prefs-${cfg.style || "page"}`;
  const loadPrefs = () => {
    try {
      return JSON.parse(localStorage.getItem(STORE_KEY) || "{}");
    } catch {
      return {};
    }
  };
  const savePrefs = () => {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(prefs));
    } catch {
      /* private mode: preferences just won't persist */
    }
  };
  const DEFAULT_PREFS = { theme: themes[0]?.id || null, custom: null, motion: osReduced ? "soft" : "full", ambient: !osReduced };
  const prefs = Object.assign({}, DEFAULT_PREFS, loadPrefs());
  if (params.get("theme")) prefs.theme = params.get("theme");
  if (["full", "soft", "off"].includes(params.get("motion"))) prefs.motion = params.get("motion");

  // ---- shared styles: effects, ranking, likes, icon motion, theme sheet ----
  const style = document.createElement("style");
  style.textContent = `
    [data-fx]{position:fixed;inset:0;pointer-events:none;overflow:hidden;z-index:60}
    .lab-confetti{position:absolute;left:50%;top:40%;width:10px;height:14px;border-radius:2px;background:var(--c);
      animation:lab-burst 1.6s cubic-bezier(.15,.7,.3,1) forwards;animation-delay:var(--d)}
    @keyframes lab-burst{0%{transform:translate(-50%,-50%) rotate(0) scale(.4);opacity:1}
      100%{transform:translate(calc(-50% + var(--x)),calc(-50% + var(--y))) rotate(var(--r)) scale(1);opacity:0}}
    .lab-float{position:absolute;bottom:90px;width:44px;height:44px;display:grid;place-items:center;animation:lab-float 2.2s ease-out forwards}
    .lab-float svg{width:36px;height:36px}
    @keyframes lab-float{0%{transform:translateY(0) scale(.5);opacity:0}15%{opacity:1;transform:translateY(-40px) scale(1.15)}
      100%{transform:translateY(-55vh) translateX(var(--drift)) scale(.9);opacity:0}}
    [data-unread][hidden]{display:none !important}
    [data-toast]{transition:opacity .25s ease,transform .25s ease}
    [data-toast]:not(.is-on){opacity:0;transform:translate(-50%,-12px);pointer-events:none}

    /* live ranking */
    [data-rank]{display:grid;gap:10px}
    .rk{position:relative;display:grid;grid-template-columns:28px minmax(0,1fr) auto;align-items:center;gap:6px 10px;padding:4px 6px;margin:0 -6px;border-radius:10px;will-change:transform}
    .rk__name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .rk.is-me .rk__name{font-weight:800}
    .rk.is-me .rk__name::after{content:" · tú";font-weight:500;opacity:.7}
    .rk__pts{font-variant-numeric:tabular-nums}
    .rk__bar{grid-column:2/4;height:6px;border-radius:3px;overflow:hidden;background:rgba(255,255,255,.08)}
    .rk__bar i{display:block;height:100%;width:var(--w,4%);background:var(--lab-accent,#8b9cff);transition:width .9s cubic-bezier(.2,.9,.3,1)}
    .rk__plus{position:absolute;right:4px;top:-14px;font-weight:800;font-size:13px;color:var(--lab-accent,#8b9cff);pointer-events:none;animation:lab-plus 1.3s ease-out forwards}
    @keyframes lab-plus{0%{opacity:0;transform:translateY(8px) scale(.6)}25%{opacity:1;transform:none}100%{opacity:0;transform:translateY(-20px)}}
    .rk.is-up{animation:lab-rankup 1.1s ease-out}
    @keyframes lab-rankup{0%{background:color-mix(in srgb,var(--lab-accent,#8b9cff) 35%,transparent)}100%{background:transparent}}
    .rk.is-lead .rk__pos{animation:lab-crown 2.4s ease-in-out infinite}
    @keyframes lab-crown{50%{transform:translateY(-2px) scale(1.12)}}
    [data-score]{display:inline-block;font-variant-numeric:tabular-nums}

    /* comments: likes */
    [data-chat-list] .msg{position:relative}
    [data-chat-list] .msg:not(.msg--system){cursor:pointer}
    .msg__likes{display:inline-flex;align-items:center;gap:3px;font-size:11px;font-weight:700;padding:1px 7px;border-radius:9px;background:rgba(255,77,128,.18);color:#ff8fb0;margin-left:2px;animation:lab-pop .35s cubic-bezier(.3,1.6,.5,1)}
    .msg__likes svg{width:11px;height:11px}
    .msg__heart{position:absolute;right:-6px;top:-10px;width:22px;height:22px;color:#ff4d80;pointer-events:none;animation:lab-heart .9s ease-out forwards}
    @keyframes lab-heart{0%{transform:scale(.2);opacity:0}30%{transform:scale(1.35);opacity:1}100%{transform:translateY(-28px) scale(.8);opacity:0}}
    @keyframes lab-pop{0%{transform:scale(.4)}100%{transform:scale(1)}}

    /* icon micro-animations */
    button svg,a svg{transition:transform .25s cubic-bezier(.3,1.6,.5,1)}
    button:hover svg,a:hover svg{transform:scale(1.12)}
    button:active svg{transform:scale(.82)}
    .is-ping svg{animation:lab-ping .7s cubic-bezier(.3,1.6,.5,1)}
    @keyframes lab-ping{30%{transform:scale(1.35) rotate(-12deg)}60%{transform:scale(.92) rotate(8deg)}100%{transform:none}}
    [data-role="draw"] [data-tool="pen"][aria-pressed="true"] svg{animation:lab-wiggle 1.8s ease-in-out infinite;transform-origin:20% 80%}
    .is-drawing-now [data-tool="pen"][aria-pressed="true"] svg{animation-duration:.45s}
    @keyframes lab-wiggle{0%,100%{transform:rotate(0)}25%{transform:rotate(-12deg)}75%{transform:rotate(9deg)}}
    [data-action="hint"] svg{animation:lab-bulb 2.6s ease-in-out infinite}
    @keyframes lab-bulb{0%,100%{filter:none;transform:none}50%{filter:drop-shadow(0 0 6px currentColor);transform:scale(1.1)}}
    [data-react]:hover svg{animation:lab-ping .6s}
    .is-ai-thinking [data-ai-last]{animation:lab-blink .8s steps(2) infinite}
    @keyframes lab-blink{50%{opacity:.3}}

    /* theme button + sheet (neutral so it reads on every style) */
    .lab-theme-btn{width:44px;height:44px;flex:0 0 auto;display:grid;place-items:center;padding:0;border-radius:12px;cursor:pointer;
      border:1px solid rgba(255,255,255,.22);background:rgba(255,255,255,.08);color:inherit}
    .lab-theme-btn svg{width:20px;height:20px}
    .lab-theme-btn[aria-expanded="true"]{background:var(--lab-accent,#8b9cff);color:#0b0d12;border-color:transparent}
    .lab-sheet{position:fixed;z-index:95;top:16px;right:16px;width:min(360px,calc(100vw - 32px));max-height:calc(100dvh - 32px);overflow:auto;
      padding:18px;border-radius:20px;background:rgba(14,16,22,.97);color:#f2f4f8;border:1px solid #2a3040;box-shadow:0 30px 80px rgba(0,0,0,.55);
      font-family:Inter,system-ui,sans-serif;font-size:14px;animation:lab-sheet-in .35s cubic-bezier(.2,.9,.3,1.1)}
    .lab-sheet[hidden]{display:none}
    @keyframes lab-sheet-in{from{opacity:0;transform:translateY(-10px) scale(.97)}}
    @media (max-width:699px){.lab-sheet{top:auto;bottom:0;right:0;left:0;width:auto;max-height:82dvh;border-radius:22px 22px 0 0;padding-bottom:calc(18px + env(safe-area-inset-bottom));animation-name:lab-sheet-up}
      @keyframes lab-sheet-up{from{transform:translateY(100%)}}}
    .lab-sheet h2{margin:0;font-size:17px;font-weight:800;letter-spacing:-.01em}
    .lab-sheet h3{margin:18px 0 8px;font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#b3bacb}
    .lab-sheet__head{display:flex;align-items:center;justify-content:space-between;gap:12px}
    .lab-sheet__head p{margin:4px 0 0;color:#b3bacb;font-size:13px}
    .lab-x{width:40px;height:40px;border-radius:12px;border:1px solid #2a3040;background:transparent;color:#f2f4f8;display:grid;place-items:center;cursor:pointer;flex:0 0 auto}
    .lab-x svg{width:18px;height:18px}
    .lab-styles{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}
    .lab-style{display:flex;flex-direction:column;gap:6px;padding:6px;border-radius:14px;border:2px solid #2a3040;background:#171b25;color:#f2f4f8;cursor:pointer;font:inherit;font-size:12px;font-weight:700;text-align:left}
    .lab-style[aria-pressed="true"]{border-color:var(--lab-accent,#8b9cff)}
    .lab-style__pv{height:54px;border-radius:9px;position:relative;overflow:hidden;background:var(--c0)}
    .lab-style__pv::before{content:"";position:absolute;left:10%;right:10%;top:22%;height:18%;border-radius:4px;background:var(--c1);box-shadow:0 0 12px var(--c1);animation:lab-pv 3s ease-in-out infinite}
    .lab-style__pv::after{content:"";position:absolute;left:10%;width:45%;bottom:16%;height:14%;border-radius:4px;background:var(--c2);animation:lab-pv 3s ease-in-out infinite reverse}
    @keyframes lab-pv{50%{transform:translateX(12%)}}
    .lab-themes{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}
    .lab-chip{display:flex;align-items:center;gap:8px;min-height:44px;padding:6px 10px;border-radius:12px;border:2px solid #2a3040;background:#171b25;color:#f2f4f8;font:inherit;font-weight:600;cursor:pointer;text-align:left}
    .lab-chip[aria-pressed="true"]{border-color:var(--lab-accent,#8b9cff)}
    .lab-dots{display:flex}
    .lab-dots i{width:16px;height:16px;border-radius:50%;border:2px solid #171b25;margin-left:-5px;background:var(--c)}
    .lab-dots i:first-child{margin-left:0}
    .lab-custom{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:8px;min-height:44px;padding:6px 10px;border-radius:12px;border:2px dashed #2a3040}
    .lab-custom input{width:44px;height:32px;border:0;padding:0;background:none;cursor:pointer}
    .lab-seg{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));padding:3px;border-radius:12px;background:#171b25;border:1px solid #2a3040}
    .lab-seg button{height:38px;border:0;border-radius:9px;background:transparent;color:#b3bacb;font:inherit;font-weight:600;cursor:pointer}
    .lab-seg button[aria-pressed="true"]{background:#f2f4f8;color:#0b0d12}
    .lab-switch{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:44px;cursor:pointer}
    .lab-switch input{appearance:none;width:46px;height:28px;border-radius:14px;background:#2a3040;position:relative;cursor:pointer;flex:0 0 auto;transition:background .2s}
    .lab-switch input::after{content:"";position:absolute;top:3px;left:3px;width:22px;height:22px;border-radius:50%;background:#f2f4f8;transition:transform .25s cubic-bezier(.3,1.4,.5,1)}
    .lab-switch input:checked{background:var(--lab-accent,#8b9cff)}
    .lab-switch input:checked::after{transform:translateX(18px)}
    .lab-switch input:focus-visible,.lab-sheet button:focus-visible{outline:2px solid var(--lab-accent,#8b9cff);outline-offset:2px}
    .lab-reset{margin-top:18px;width:100%;height:44px;border-radius:12px;border:1px solid #2a3040;background:transparent;color:#f2f4f8;font:inherit;font-weight:600;cursor:pointer}
    .lab-demo-pill{position:fixed;left:50%;top:10px;transform:translateX(-50%);z-index:75;display:none;align-items:center;gap:8px;padding:6px 12px;border-radius:16px;
      background:rgba(14,16,22,.85);color:#f2f4f8;font:600 12px Inter,system-ui,sans-serif;border:1px solid #2a3040;pointer-events:none}
    .lab-demo-pill::before{content:"";width:8px;height:8px;border-radius:50%;background:#ff4d6d;animation:lab-blink 1s steps(2) infinite}
    .is-demo .lab-demo-pill{display:inline-flex}

    /* motion preferences */
    html[data-ambient="off"] [data-ambient],html[data-ambient="off"] [data-ambient] *,html[data-ambient="off"] [data-ambient]::before,html[data-ambient="off"] [data-ambient]::after,
    html[data-ambient="off"] [data-ambient-self]{animation:none !important}
    html[data-motion="soft"] [data-ambient],html[data-motion="soft"] [data-ambient] *,html[data-motion="soft"] [data-ambient]::before,html[data-motion="soft"] [data-ambient]::after,
    html[data-motion="soft"] [data-ambient-self],html[data-motion="soft"] .lab-float{animation:none !important}
    html[data-motion="off"] *,html[data-motion="off"] *::before,html[data-motion="off"] *::after{animation:none !important;transition:none !important}
    html[data-motion="off"] [data-fx]{display:none}
  `;
  document.head.appendChild(style);

  // ---- state -------------------------------------------------------------
  let role = body.dataset.role || "guess";
  let left = ROUND_SECONDS;
  let round = 2;
  let solved = false;
  let revealed = new Set();
  let unread = 0;
  let plan = null; // a simulated player who will guess right this round
  let demo = params.get("demo") === "1";
  const players = [
    { id: "luis", name: "Luis", score: 85 },
    { id: "marta", name: "Marta", score: 40 },
    { id: "ana", name: "Ana", score: 0 },
    { id: "ia", name: "IA", score: 0 },
  ];
  const DRAWER = "luis";
  const meName = () => (role === "draw" ? "Luis" : "Ana");
  const meId = () => (role === "draw" ? "luis" : "ana");
  const idOf = (name) => players.find((p) => p.name === name)?.id || name.toLowerCase();
  const motion = () => root.dataset.motion || "full";

  // ---- word tiles --------------------------------------------------------
  function renderWord() {
    $$("[data-word]").forEach((el) => {
      el.textContent = "";
      [...WORD].forEach((ch, i) => {
        const t = document.createElement("span");
        t.className = "tile";
        t.style.setProperty("--i", i);
        const show = role === "draw" || solved || revealed.has(i);
        t.textContent = show ? ch.toUpperCase() : "";
        if (show) t.classList.add("is-shown");
        if (revealed.has(i) && role === "guess" && !solved) t.classList.add("is-hint");
        t.setAttribute("aria-hidden", "true");
        el.appendChild(t);
      });
      el.setAttribute("aria-label", role === "draw" || solved ? `Palabra: ${WORD}` : `Palabra oculta de ${WORD.length} letras`);
    });
    $$("[data-word-label]").forEach((el) => {
      el.textContent = role === "draw" ? "Tu palabra" : solved ? "¡Resuelto!" : `Luis está dibujando · ${WORD.length} letras`;
    });
  }

  // ---- timer -------------------------------------------------------------
  function paintTimer() {
    $$("[data-timer]").forEach((el) => (el.textContent = String(left)));
    $$("[data-timer-mmss]").forEach((el) => (el.textContent = `${String(Math.floor(left / 60)).padStart(2, "0")}:${String(left % 60).padStart(2, "0")}`));
    root.style.setProperty("--progress", String(left / ROUND_SECONDS));
    body.classList.toggle("is-urgent", left <= 15 && !solved);
    $$("[data-round]").forEach((el) => (el.textContent = `${round}/${TOTAL_ROUNDS}`));
  }
  setInterval(() => {
    if (solved) return;
    left -= 1;
    if (left <= 0) {
      addMsg("system", null, `Se acabó el tiempo. Era «${WORD}».`);
      newRound();
      return;
    }
    if (!demo && plan && ROUND_SECONDS - left >= plan.at) {
      const p = plan;
      plan = null;
      peerWin(p.who);
    }
    paintTimer();
  }, 1000);

  // Someone else lands the word now and then, so the ranking moves on its own.
  function makePlan() {
    if (role === "draw") {
      plan = Math.random() < 0.75 ? { who: pick(["Ana", "Marta"]), at: Math.round(rand(22, 45)) } : null;
    } else {
      const r = Math.random();
      plan = r < 0.45 ? { who: "Marta", at: Math.round(rand(45, 70)) } : r < 0.6 ? { who: "IA", at: Math.round(rand(55, 80)) } : null;
    }
  }

  function newRound() {
    left = ROUND_SECONDS;
    solved = false;
    revealed = new Set();
    round = round >= TOTAL_ROUNDS ? 1 : round + 1;
    body.classList.remove("is-solved");
    renderWord();
    paintTimer();
    makePlan();
    boards.forEach((b) => (role === "guess" ? b.replay() : b.clear()));
    addMsg("system", null, role === "draw" ? "Nueva ronda: te toca dibujar «guitarra»." : `Ronda ${round}: le toca dibujar a Luis.`);
  }

  // ---- chat --------------------------------------------------------------
  function addMsg(kind, who, text) {
    const now = ROUND_SECONDS - left;
    $$("[data-chat-list]").forEach((list) => {
      const li = document.createElement("li");
      li.className = `msg msg--${kind}`;
      if (who) {
        const w = document.createElement("span");
        w.className = "msg__who";
        w.textContent = who;
        li.appendChild(w);
      }
      const t = document.createElement("span");
      t.className = "msg__text";
      t.textContent = text;
      li.appendChild(t);
      const tm = document.createElement("time");
      tm.className = "msg__time";
      tm.textContent = `00:${String(now).padStart(2, "0")}`;
      li.appendChild(tm);
      list.appendChild(li);
      while (list.children.length > 40) list.firstElementChild.remove();
      list.scrollTop = list.scrollHeight;
    });
    if (kind !== "me") $$('[data-tab-btn="chat"]').forEach((b) => restart(b, "is-ping"));
    const compact = body.dataset.tab !== "chat" && !!$(".tabbar, .dock, .sidetabs") && getComputedStyle($("[data-chat-list]").closest("section") || body).display === "none";
    if (compact && kind !== "me") {
      unread += 1;
      paintUnread();
    }
  }
  function paintUnread() {
    $$("[data-unread]").forEach((el) => {
      el.textContent = String(unread);
      el.hidden = unread === 0;
    });
  }
  function setTyping(text) {
    $$("[data-typing]").forEach((el) => {
      el.textContent = text || "";
      el.classList.toggle("is-on", Boolean(text));
    });
  }

  // Tap a comment to like it; the heart floats up and the counter pops.
  function like(msg, quiet) {
    let tag = msg.querySelector(".msg__likes");
    if (!tag) {
      tag = document.createElement("span");
      tag.className = "msg__likes";
      tag.innerHTML = `${ICON.heart}<span>0</span>`;
      msg.querySelector(".msg__text")?.after(tag);
    }
    const n = tag.querySelector("span");
    n.textContent = String(Number(n.textContent) + 1);
    restart(tag, "is-bump");
    if (motion() !== "off") {
      const h = document.createElement("span");
      h.className = "msg__heart";
      h.innerHTML = ICON.heart;
      msg.appendChild(h);
      setTimeout(() => h.remove(), 950);
    }
    if (!quiet) toast("Te gusta este comentario");
  }
  document.addEventListener("click", (e) => {
    const msg = e.target.closest("[data-chat-list] .msg");
    if (msg && !msg.classList.contains("msg--system")) like(msg);
  });
  setInterval(() => {
    const candidates = $$("[data-chat-list] .msg:not(.msg--system)").slice(-6);
    if (candidates.length && !document.hidden) like(pick(candidates), true);
  }, 12000);

  $$("form[data-chat-form]").forEach((form) => {
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const input = form.querySelector("input");
      const text = input.value.trim();
      if (!text) return;
      input.value = "";
      if (role === "draw") {
        toast("Mientras dibujas no puedes responder");
        return;
      }
      addMsg("me", meName(), text);
      if (!solved && norm(text) === norm(WORD)) win();
    });
  });

  function pointsNow() {
    return 50 + Math.round((left / ROUND_SECONDS) * 50);
  }
  function endSolved(who, pts) {
    solved = true;
    plan = null;
    body.classList.add("is-solved");
    renderWord();
    paintTimer();
    addMsg("success", who, `acertó «${WORD}» · +${pts}`);
    setTimeout(newRound, 4200);
  }
  function win() {
    const pts = pointsNow();
    award(meId(), pts);
    award(DRAWER, 25);
    toast(`¡Acertaste! +${pts}`);
    confetti(70);
    endSolved(meName(), pts);
  }
  function peerWin(who) {
    if (solved) return;
    const pts = pointsNow();
    addMsg(who === "IA" ? "ai" : "peer", who, WORD);
    award(idOf(who), pts);
    award(DRAWER, 25);
    toast(role === "draw" ? `${who} adivinó tu dibujo · +25 para ti` : `${who} acertó antes que tú`);
    confetti(role === "draw" ? 60 : 22);
    endSolved(who, pts);
  }

  // ---- scores + live ranking ---------------------------------------------
  function countTo(id, from, to) {
    $$(`[data-score="${id}"]`).forEach((el) => {
      restart(el, "is-bump");
      if (motion() === "off") {
        el.textContent = String(to);
        return;
      }
      const t0 = performance.now();
      const tick = (t) => {
        const k = Math.min(1, (t - t0) / 800);
        el.textContent = String(Math.round(from + (to - from) * (1 - Math.pow(1 - k, 3))));
        if (k < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  }
  function award(id, pts) {
    const p = players.find((x) => x.id === id);
    if (!p) return;
    const from = p.score;
    p.score += pts;
    countTo(id, from, p.score);
    renderRank(id, pts);
  }
  function renderRank(changedId, pts) {
    const order = [...players].sort((a, b) => b.score - a.score);
    const max = Math.max(1, ...players.map((p) => p.score));
    $$("[data-rank]").forEach((box) => {
      if (!box.dataset.ready) {
        box.textContent = "";
        players.forEach((p) => {
          const r = document.createElement("div");
          r.className = "rk";
          r.dataset.id = p.id;
          r.innerHTML = '<span class="rk__pos"></span><span class="rk__name"></span><b class="rk__pts"></b><span class="rk__bar"><i></i></span>';
          r.querySelector(".rk__name").textContent = p.name;
          box.appendChild(r);
        });
        box.dataset.ready = "1";
      }
      const rows = [...box.children];
      const before = new Map(rows.map((r) => [r.dataset.id, r.getBoundingClientRect().top]));
      const oldIndex = new Map(rows.map((r, i) => [r.dataset.id, i]));
      order.forEach((p, i) => {
        const r = box.querySelector(`[data-id="${p.id}"]`);
        box.appendChild(r);
        r.querySelector(".rk__pos").textContent = String(i + 1);
        r.querySelector(".rk__pts").textContent = String(p.score);
        r.style.setProperty("--w", `${Math.max(4, (p.score / max) * 100)}%`);
        r.classList.toggle("is-me", p.id === meId());
        r.classList.toggle("is-lead", i === 0);
        r.dataset.pos = String(i + 1);
      });
      [...box.children].forEach((r, i) => {
        const dy = before.get(r.dataset.id) - r.getBoundingClientRect().top;
        if (dy && motion() !== "off") {
          r.animate([{ transform: `translateY(${dy}px)` }, { transform: "translateY(0)" }], { duration: 700, easing: "cubic-bezier(.2,.9,.3,1.1)" });
        }
        if (oldIndex.get(r.dataset.id) > i) restart(r, "is-up");
      });
      if (changedId && pts) {
        const r = box.querySelector(`[data-id="${changedId}"]`);
        const plus = document.createElement("span");
        plus.className = "rk__plus";
        plus.textContent = `+${pts}`;
        r.appendChild(plus);
        setTimeout(() => plus.remove(), 1350);
      }
    });
    if (changedId) $$('[data-tab-btn="score"]').forEach((b) => restart(b, "is-ping"));
  }

  // ---- simulated players -------------------------------------------------
  function aiTurn() {
    if (solved) return;
    setTyping("La IA está analizando el dibujo…");
    body.classList.add("is-ai-thinking");
    setTimeout(() => {
      setTyping("");
      body.classList.remove("is-ai-thinking");
      if (solved) return;
      const guesses = [...AI_GUESSES].sort(() => Math.random() - 0.5).slice(0, 3);
      const conf = [30 + Math.random() * 35, 10 + Math.random() * 20, 5 + Math.random() * 12].map(Math.round);
      addMsg("ai", "IA", `¿${guesses[0]}?`);
      $$("[data-ai-last]").forEach((el) => (el.textContent = guesses[0]));
      $$("[data-ai-bars]").forEach((box) => {
        box.textContent = "";
        guesses.forEach((g, i) => {
          const row = document.createElement("div");
          row.className = "ai-bar";
          row.style.setProperty("--w", `${conf[i]}%`);
          row.innerHTML = `<span class="ai-bar__label"></span><span class="ai-bar__track"><i></i></span><b class="ai-bar__pct">${conf[i]}%</b>`;
          row.querySelector(".ai-bar__label").textContent = g;
          box.appendChild(row);
        });
      });
    }, 1400);
  }
  setTimeout(aiTurn, 2500);
  setInterval(aiTurn, 7000);

  setInterval(() => {
    if (solved) return;
    const who = role === "draw" ? pick(["Ana", "Marta"]) : "Marta";
    setTyping(`${who} está escribiendo…`);
    setTimeout(() => {
      setTyping("");
      if (!solved) addMsg("peer", who, pick(PEER_GUESSES));
    }, 1100);
  }, 11000);

  // ---- toast -------------------------------------------------------------
  let toastTimer = 0;
  function toast(text) {
    $$("[data-toast]").forEach((el) => {
      el.textContent = text;
      el.classList.add("is-on");
    });
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => $$("[data-toast]").forEach((el) => el.classList.remove("is-on")), 2200);
  }

  // ---- effects -----------------------------------------------------------
  const fx = $("[data-fx]");
  const fxColors = () => (fx?.dataset.fxColors || "#22d3ee,#f472b6,#facc15,#a78bfa").split(",");
  function confetti(n) {
    if (!fx || motion() === "off") return;
    const count = motion() === "soft" ? Math.round(n / 3) : n;
    const colors = fxColors();
    for (let i = 0; i < count; i++) {
      const p = document.createElement("span");
      p.className = "lab-confetti";
      const a = Math.random() * Math.PI * 2;
      const d = 120 + Math.random() * Math.min(window.innerWidth, 900) * 0.5;
      p.style.setProperty("--x", `${Math.cos(a) * d}px`);
      p.style.setProperty("--y", `${Math.sin(a) * d - 80}px`);
      p.style.setProperty("--r", `${Math.random() * 720 - 360}deg`);
      p.style.setProperty("--c", pick(colors));
      p.style.setProperty("--d", `${Math.random() * 0.15}s`);
      fx.appendChild(p);
      setTimeout(() => p.remove(), 1900);
    }
  }
  function floatIcon(btn) {
    if (!fx || motion() !== "full") return;
    const svg = btn.querySelector("svg");
    if (!svg) return;
    const f = document.createElement("span");
    f.className = "lab-float";
    f.style.left = `${10 + Math.random() * 80}%`;
    f.style.setProperty("--drift", `${Math.random() * 60 - 30}px`);
    f.style.color = getComputedStyle(btn).color;
    f.appendChild(svg.cloneNode(true));
    fx.appendChild(f);
    setTimeout(() => f.remove(), 2300);
  }
  $$("[data-react]").forEach((btn) =>
    btn.addEventListener("click", () => {
      floatIcon(btn);
      restart(btn, "is-ping");
    }),
  );
  setInterval(() => {
    const btns = $$("[data-react]");
    if (btns.length && !document.hidden) floatIcon(pick(btns));
  }, 9000);

  // ---- canvas ------------------------------------------------------------
  const tool = { color: null, size: 8, erase: false };

  function circle(cx, cy, r, n = 28) {
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * Math.PI * 2 - Math.PI / 2;
      pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
    }
    return pts;
  }
  // A guitar doodle in a 300x200 sketch space, scaled to the 900x600 board.
  const DOODLE = [
    circle(88, 148, 38),
    circle(128, 120, 27),
    circle(100, 136, 10, 16),
    [[142, 112], [250, 50]],
    [[150, 124], [258, 62]],
    [[250, 50], [266, 36], [280, 48], [258, 62]],
    [[92, 146], [262, 54]],
    [[68, 160], [84, 168]],
  ].map((s) => s.map(([x, y]) => [x * 3, y * 3]));

  function setupBoard(cv) {
    const W = 900, H = 600;
    const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    cv.width = W * dpr;
    cv.height = H * dpr;
    const ctx = cv.getContext("2d");
    ctx.scale(dpr, dpr);
    const bg = cv.dataset.bg || "#ffffff";
    const glow = cv.dataset.glow === "true";
    if (!tool.color) tool.color = cv.dataset.ink || "#111111";
    let strokes = [];
    let current = null;
    let replayTimer = 0;

    const paintBg = () => {
      ctx.save();
      ctx.shadowBlur = 0;
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
    };
    const seg = (s, a, b) => {
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.lineWidth = s.size;
      ctx.strokeStyle = s.erase ? bg : s.color;
      ctx.shadowColor = s.color;
      ctx.shadowBlur = glow && !s.erase ? s.size * 2.4 : 0;
      ctx.beginPath();
      ctx.moveTo(a[0], a[1]);
      ctx.lineTo(b[0], b[1]);
      ctx.stroke();
    };
    const drawStroke = (s) => {
      if (s.points.length === 1) seg(s, s.points[0], [s.points[0][0] + 0.1, s.points[0][1]]);
      for (let i = 1; i < s.points.length; i++) seg(s, s.points[i - 1], s.points[i]);
    };
    const redraw = () => {
      paintBg();
      strokes.forEach(drawStroke);
    };
    const local = (e) => {
      const r = cv.getBoundingClientRect();
      return [((e.clientX - r.left) / r.width) * W, ((e.clientY - r.top) / r.height) * H];
    };

    cv.addEventListener("pointerdown", (e) => {
      if (role !== "draw") {
        toast("Cambia a «Dibujar» para probar el lienzo");
        return;
      }
      clearTimeout(replayTimer);
      cv.setPointerCapture(e.pointerId);
      current = { color: tool.color, size: tool.size, erase: tool.erase, points: [local(e)] };
      strokes.push(current);
      drawStroke(current);
      body.classList.add("is-drawing-now");
    });
    cv.addEventListener("pointermove", (e) => {
      const p = local(e);
      $$("[data-coords]").forEach((el) => (el.textContent = `X ${String(Math.round(p[0])).padStart(3, "0")} · Y ${String(Math.round(p[1])).padStart(3, "0")}`));
      if (!current) return;
      const last = current.points[current.points.length - 1];
      current.points.push(p);
      seg(current, last, p);
    });
    const end = () => {
      current = null;
      body.classList.remove("is-drawing-now");
    };
    cv.addEventListener("pointerup", end);
    cv.addEventListener("pointercancel", end);

    return {
      clear() {
        clearTimeout(replayTimer);
        strokes = [];
        redraw();
      },
      undo() {
        strokes.pop();
        redraw();
      },
      // Plays the doodle back stroke by stroke. `force` lets the demo "draw" as the drawer.
      replay(force) {
        clearTimeout(replayTimer);
        strokes = [];
        redraw();
        let si = 0, pi = 1;
        const color = cv.dataset.ink || "#111111";
        const step = () => {
          if ((role !== "guess" && !force) || si >= DOODLE.length) {
            body.classList.remove("is-drawing-now");
            return;
          }
          if (force) body.classList.add("is-drawing-now");
          const src = DOODLE[si];
          if (pi === 1) strokes.push({ color, size: 7, erase: false, points: [src[0]] });
          const s = strokes[strokes.length - 1];
          for (let k = 0; k < 2 && pi < src.length; k++, pi++) {
            s.points.push(src[pi]);
            seg(s, src[pi - 1], src[pi]);
          }
          if (pi >= src.length) {
            si += 1;
            pi = 1;
            replayTimer = setTimeout(step, 280);
          } else {
            replayTimer = setTimeout(step, 28);
          }
        };
        replayTimer = setTimeout(step, 400);
      },
    };
  }

  // Theme ink must be on the canvas before boards read it.
  applyPrefs(true);
  const boards = $$("canvas[data-board]").map(setupBoard);

  // ---- tools -------------------------------------------------------------
  const pressGroup = (sel, btn) => $$(sel).forEach((b) => b.setAttribute("aria-pressed", String(b === btn)));
  $$("[data-color]").forEach((b) =>
    b.addEventListener("click", () => {
      tool.color = b.dataset.color;
      tool.erase = false;
      pressGroup("[data-color]", b);
      $$('[data-tool="pen"]').forEach((p) => p.setAttribute("aria-pressed", "true"));
      $$('[data-tool="eraser"]').forEach((p) => p.setAttribute("aria-pressed", "false"));
    }),
  );
  $$("[data-size]").forEach((b) =>
    b.addEventListener("click", () => {
      tool.size = Number(b.dataset.size);
      pressGroup("[data-size]", b);
    }),
  );
  $$("[data-tool]").forEach((b) =>
    b.addEventListener("click", () => {
      tool.erase = b.dataset.tool === "eraser";
      pressGroup("[data-tool]", b);
    }),
  );
  $$('[data-action="clear"]').forEach((b) => b.addEventListener("click", () => boards.forEach((x) => x.clear())));
  $$('[data-action="undo"]').forEach((b) => b.addEventListener("click", () => boards.forEach((x) => x.undo())));
  $$('[data-action="skip"]').forEach((b) =>
    b.addEventListener("click", () => {
      toast("Palabra cambiada (en el lab siempre es «guitarra»)");
      boards.forEach((x) => x.clear());
    }),
  );
  $$('[data-action="end"]').forEach((b) =>
    b.addEventListener("click", () => {
      addMsg("system", null, `Ronda terminada. Era «${WORD}».`);
      newRound();
    }),
  );
  $$('[data-action="hint"]').forEach((b) =>
    b.addEventListener("click", () => {
      if (role !== "guess" || solved) return;
      if (revealed.size >= MAX_HINTS) {
        toast("Ya no quedan pistas en esta ronda");
        return;
      }
      const hidden = [...WORD].map((_, i) => i).filter((i) => !revealed.has(i));
      revealed.add(pick(hidden));
      renderWord();
      addMsg("system", null, "Pista: se reveló una letra.");
    }),
  );

  // ---- role + tabs -------------------------------------------------------
  function setRole(r, quiet) {
    role = r;
    body.dataset.role = r;
    $$("[data-role-btn]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.roleBtn === r)));
    renderWord();
    makePlan();
    renderRank();
    boards.forEach((b) => (r === "guess" ? b.replay() : b.clear()));
    if (!quiet) toast(r === "draw" ? "Vista de quien dibuja: usa el lienzo" : "Vista de quien adivina: prueba escribir «guitarra»");
  }
  $$("[data-role-btn]").forEach((b) => b.addEventListener("click", () => setRole(b.dataset.roleBtn)));

  function setTab(t) {
    body.dataset.tab = t;
    $$("[data-tab-btn]").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tabBtn === t)));
    if (t === "chat") {
      unread = 0;
      paintUnread();
    }
    if (t === "score") renderRank();
  }
  $$("[data-tab-btn]").forEach((b) => b.addEventListener("click", () => setTab(b.dataset.tabBtn)));

  // ---- theme: apply + customizer sheet ------------------------------------
  function currentTheme() {
    return themes.find((t) => t.id === prefs.theme) || themes[0];
  }
  function applyPrefs(silent) {
    themes.forEach((t) => Object.keys(t.vars || {}).forEach((k) => root.style.removeProperty(k)));
    const t = currentTheme();
    if (t) Object.entries(t.vars || {}).forEach(([k, v]) => root.style.setProperty(k, v));
    if (prefs.custom && cfg.primaryVar) root.style.setProperty(cfg.primaryVar, prefs.custom);
    const accent = prefs.custom || t?.swatch?.[0] || "#8b9cff";
    root.style.setProperty("--lab-accent", accent);
    const ink = cfg.inkFollowsPrimary ? accent : t?.ink;
    if (ink) $$("canvas[data-board]").forEach((c) => (c.dataset.ink = ink));
    if (t?.fx && fx) fx.dataset.fxColors = t.fx;
    root.dataset.motion = prefs.motion;
    root.dataset.ambient = prefs.ambient ? "on" : "off";
    savePrefs();
    if (!silent) paintSheet();
  }

  const top = $(".top");
  const themeBtn = document.createElement("button");
  themeBtn.type = "button";
  themeBtn.className = "lab-theme-btn";
  themeBtn.setAttribute("aria-label", "Personalizar tema");
  themeBtn.setAttribute("aria-haspopup", "dialog");
  themeBtn.setAttribute("aria-expanded", "false");
  themeBtn.innerHTML = ICON.palette;
  top?.appendChild(themeBtn);

  const sheet = document.createElement("div");
  sheet.className = "lab-sheet";
  sheet.setAttribute("role", "dialog");
  sheet.setAttribute("aria-label", "Personaliza tu tema");
  sheet.hidden = true;
  sheet.innerHTML = `
    <div class="lab-sheet__head">
      <div><h2>Personaliza tu tema</h2><p>Se guarda en este navegador.</p></div>
      <button type="button" class="lab-x" data-sheet-close aria-label="Cerrar">${ICON.close}</button>
    </div>
    <h3>Estilo</h3>
    <div class="lab-styles" data-sheet-styles></div>
    <h3>Paleta de color</h3>
    <div class="lab-themes" data-sheet-themes></div>
    <label class="lab-custom"><span>Color propio</span><input type="color" data-sheet-custom aria-label="Elegir un color de acento propio"></label>
    <h3>Animaciones</h3>
    <div class="lab-seg" role="group" aria-label="Nivel de animaciones" data-sheet-motion>
      <button type="button" data-motion="full">Completas</button>
      <button type="button" data-motion="soft">Suaves</button>
      <button type="button" data-motion="off">Ninguna</button>
    </div>
    <h3>Ambiente</h3>
    <label class="lab-switch"><span>Fondo animado</span><input type="checkbox" data-sheet-ambient></label>
    <label class="lab-switch"><span>Partida automática (demo)</span><input type="checkbox" data-sheet-demo></label>
    <button type="button" class="lab-reset" data-sheet-reset>Restablecer</button>`;
  body.appendChild(sheet);

  const stylesBox = $("[data-sheet-styles]", sheet);
  STYLES.forEach((s) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "lab-style";
    b.dataset.styleId = s.id;
    b.innerHTML = `<span class="lab-style__pv" style="--c0:${s.colors[0]};--c1:${s.colors[1]};--c2:${s.colors[2]}" aria-hidden="true"></span>${s.name}`;
    b.addEventListener("click", () => {
      if (s.id === cfg.style) return;
      const q = new URLSearchParams();
      q.set("role", role);
      if (demo) q.set("demo", "1");
      q.set("motion", prefs.motion);
      location.href = `${s.file}?${q}`;
    });
    stylesBox.appendChild(b);
  });
  const themesBox = $("[data-sheet-themes]", sheet);
  themes.forEach((t) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "lab-chip";
    b.dataset.themeId = t.id;
    b.innerHTML = `<span class="lab-dots" aria-hidden="true">${(t.swatch || []).map((c) => `<i style="--c:${c}"></i>`).join("")}</span><span></span>`;
    b.lastElementChild.textContent = t.name;
    b.addEventListener("click", () => {
      prefs.theme = t.id;
      prefs.custom = null;
      applyPrefs();
      boards.forEach((x) => role === "guess" && x.replay());
    });
    themesBox.appendChild(b);
  });
  $("[data-sheet-custom]", sheet).addEventListener("input", (e) => {
    prefs.custom = e.target.value;
    applyPrefs();
  });
  $$("[data-sheet-motion] button", sheet).forEach((b) =>
    b.addEventListener("click", () => {
      prefs.motion = b.dataset.motion;
      applyPrefs();
    }),
  );
  $("[data-sheet-ambient]", sheet).addEventListener("change", (e) => {
    prefs.ambient = e.target.checked;
    applyPrefs();
  });
  $("[data-sheet-demo]", sheet).addEventListener("change", (e) => (e.target.checked ? startDemo() : stopDemo()));
  $("[data-sheet-reset]", sheet).addEventListener("click", () => {
    Object.assign(prefs, DEFAULT_PREFS);
    applyPrefs();
  });

  function paintSheet() {
    $$("[data-style-id]", sheet).forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.styleId === cfg.style)));
    $$("[data-theme-id]", sheet).forEach((b) => b.setAttribute("aria-pressed", String(!prefs.custom && b.dataset.themeId === currentTheme()?.id)));
    $("[data-sheet-custom]", sheet).value = prefs.custom || currentTheme()?.swatch?.[0] || "#8b9cff";
    $$("[data-sheet-motion] button", sheet).forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.motion === prefs.motion)));
    $("[data-sheet-ambient]", sheet).checked = !!prefs.ambient;
    $("[data-sheet-demo]", sheet).checked = demo;
  }
  function openSheet(open) {
    sheet.hidden = !open;
    themeBtn.setAttribute("aria-expanded", String(open));
    if (open) {
      paintSheet();
      $("[data-sheet-close]", sheet).focus();
    } else {
      themeBtn.focus({ preventScroll: true });
    }
  }
  themeBtn.addEventListener("click", () => openSheet(sheet.hidden));
  $("[data-sheet-close]", sheet).addEventListener("click", () => openSheet(false));
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !sheet.hidden) openSheet(false);
  });
  document.addEventListener("pointerdown", (e) => {
    if (!sheet.hidden && !sheet.contains(e.target) && !themeBtn.contains(e.target)) openSheet(false);
  });

  // ---- demo: an animated mockup that plays a whole round by itself ---------
  const pill = document.createElement("div");
  pill.className = "lab-demo-pill";
  pill.textContent = "Demo en vivo";
  pill.setAttribute("aria-hidden", "true");
  body.appendChild(pill);
  let demoTimers = [];
  const later = (ms, fn) => demoTimers.push(setTimeout(fn, ms));
  function typeInto(text) {
    const input = $("form[data-chat-form] input");
    if (!input || role !== "guess") return;
    input.value = "";
    let i = 0;
    const step = () => {
      if (!demo) return;
      input.value = text.slice(0, ++i);
      if (i < text.length) later(110, step);
      else later(380, () => input.form.requestSubmit());
    };
    step();
  }
  function demoLoop() {
    if (!demo) return;
    setRole("guess", true);
    setTab("chat");
    later(4500, () => typeInto("¿violín?"));
    later(9500, () => typeInto("guitarra"));
    later(12500, () => setTab("score"));
    later(16500, () => {
      setTab("chat");
      setRole("draw", true);
      boards.forEach((b) => b.replay(true));
    });
    later(24500, () => peerWin("Ana"));
    later(27000, () => setTab("score"));
    later(31000, () => setTab("players"));
    later(34500, demoLoop);
  }
  function startDemo() {
    demo = true;
    body.classList.add("is-demo");
    demoTimers.forEach(clearTimeout);
    demoTimers = [];
    demoLoop();
  }
  function stopDemo(silent) {
    if (!demo) return;
    demo = false;
    body.classList.remove("is-demo");
    demoTimers.forEach(clearTimeout);
    demoTimers = [];
    paintSheet();
    if (!silent) toast("Demo en pausa: ahora juegas tú");
  }
  // Any real interaction outside the theme sheet hands control back to the player.
  ["pointerdown", "keydown"].forEach((type) =>
    document.addEventListener(
      type,
      (e) => {
        if (demo && e.isTrusted && !sheet.contains(e.target) && !themeBtn.contains(e.target)) stopDemo();
      },
      true,
    ),
  );

  // ---- boot --------------------------------------------------------------
  if (params.get("role") === "draw" || params.get("role") === "guess") role = params.get("role");
  body.dataset.role = role;
  $$("[data-role-btn]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.roleBtn === role)));
  setTab(["chat", "players", "score"].includes(params.get("tab")) ? params.get("tab") : body.dataset.tab || "chat");
  renderWord();
  paintTimer();
  paintUnread();
  renderRank();
  makePlan();
  paintSheet();
  if (role === "guess") boards.forEach((b) => b.replay());
  addMsg("system", null, `Ronda ${round}: le toca dibujar a Luis.`);
  setTimeout(() => addMsg("peer", "Marta", "¿una pera?"), 1200);
  if (demo) startDemo();
})();
