"use client";

import {
  MutableRefObject,
  PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { useChannel } from "@portalsdk/react";
import Cursors, { CursorReporter } from "./Cursors";
import { DrawMsg, StrokePoint, drawChannel } from "@/lib/types";

const W = 900;
const H = 600;
const DARK_BG = "#0f1115";
const LIGHT_BG = "#ffffff";
const DARK_INK = "#e6e8ec";
const LIGHT_INK = "#1f2328";
// The rest of the palette reads fine against either a near-black or a white
// canvas; only the "default ink" swatch needs to flip with the theme.
const REST_COLORS = ["#6366f1", "#ef4444", "#22c55e", "#eab308", "#f97316"];
const SIZES = [3, 6, 12, 22];

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export default function Canvas({
  isDrawer,
  snapshotRef,
  drawStrokeRef,
  aiDrawing = false,
  roomCode,
  name,
}: {
  isDrawer: boolean;
  /** Nombre propio, para etiquetar el cursor que ven los demás. */
  name: string;
  // Parent stores a function here to grab a PNG data URL of the current canvas.
  snapshotRef?: MutableRefObject<(() => string | null) | null>;
  // Parent stores a function here to paint AND publish a stroke it didn't get
  // from the pointer — used to play back the AI's drawing. It has to go
  // through the canvas rather than Game publishing directly, because the
  // draw channel lives here and remote echoes of our own sends are ignored.
  drawStrokeRef?: MutableRefObject<((points: StrokePoint[]) => void) | null>;
  // The AI holds the pen this round: no manual drawing, no toolbar.
  aiDrawing?: boolean;
  roomCode: string
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null);
  const drawing = useRef(false);
  const lastSent = useRef<StrokePoint | null>(null);
  const buffer = useRef<StrokePoint[]>([]);
  const lastFlush = useRef(0);
  const cursorReportRef = useRef<CursorReporter | null>(null);

  // ---- Page-scroll lock during an active stroke ------------------------------
  // On phones the whole page scrolls (the layout is one tall column below
  // `lg`), so anything that scrolls the document mid-gesture — a chat-driven
  // reflow, a stray focus(), the browser itself — would slide the canvas out
  // from under the pen and ruin the stroke. While a stroke is live we pin the
  // scroll position and undo every window scroll event until the gesture
  // ends. Event-driven: fires exactly when something tries to scroll, no
  // polling/timers, and works the same on Safari iOS and Chrome Android.
  const scrollPinRef = useRef<{ x: number; y: number } | null>(null);
  const restoreScrollPin = useCallback(() => {
    const pin = scrollPinRef.current;
    if (pin) window.scrollTo(pin.x, pin.y);
  }, []);
  const holdPageScroll = useCallback(() => {
    if (scrollPinRef.current) return;
    scrollPinRef.current = { x: window.scrollX, y: window.scrollY };
    window.addEventListener("scroll", restoreScrollPin);
  }, [restoreScrollPin]);
  const releasePageScroll = useCallback(() => {
    if (!scrollPinRef.current) return;
    scrollPinRef.current = null;
    window.removeEventListener("scroll", restoreScrollPin);
  }, [restoreScrollPin]);
  // Canvas remounts per round (`key={round.id}`) — drop the listener even if
  // the component goes away mid-stroke.
  useEffect(() => () => releasePageScroll(), [releasePageScroll]);

  // Start dark (matches the server-rendered default, avoiding a hydration
  // mismatch) and correct to the real theme once mounted — see the effect
  // below, same pattern as ThemeToggle. The canvas paint itself has no such
  // constraint (it's imperative, never part of SSR output), so `bgRef` can
  // just hold the live value directly.
  const bgRef = useRef(DARK_BG);
  // Tracks the theme's "auto" ink color, so a toggle can also swap any
  // already-drawn strokes that used it — otherwise a stroke drawn in the
  // dark theme's near-white default would stay near-white after the
  // background flips to white too, and vanish.
  const inkRef = useRef(DARK_INK);
  // Whether anything has been painted since the last clear — a toggle can
  // safely repaint the background live if the board is still blank (nothing
  // to lose); once there's a stroke on it, we leave pixels alone (see the
  // theme-sync effect below, placed after clearCanvas/paintSegment exist).
  const hasContentRef = useRef(false);
  const [colors, setColors] = useState<string[]>([DARK_INK, ...REST_COLORS]);
  const [color, setColor] = useState(DARK_INK);
  const [size, setSize] = useState(SIZES[1]);
  // Eraser paints in the canvas background color. Over the wire it's the
  // "erase" sentinel (like "auto") so each viewer erases against *their own*
  // theme background rather than a literal hex that could smear a visible
  // rectangle on a mismatched theme.
  const [erasing, setErasing] = useState(false);

  const { send, me } = useChannel<DrawMsg>({
    channelId: drawChannel(roomCode),
    history: "none",
    onMessage: (msg) => {
      // Ignore our own echoes — the drawer already painted locally.
      if (msg.sender?.id && me?.id && msg.sender.id === me.id) return;
      applyRemote(msg.content);
    },
  });

  const getCtx = useCallback(() => {
    const c = canvasRef.current;
    if (!c) return null;
    if (!ctxRef.current) {
      const ctx = c.getContext("2d");
      if (ctx) {
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctxRef.current = ctx;
      }
    }
    return ctxRef.current;
  }, []);

  const paintSegment = useCallback(
    (points: StrokePoint[], strokeColor: string, strokeSize: number) => {
      const ctx = getCtx();
      if (!ctx || points.length === 0) return;
      hasContentRef.current = true;
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = strokeSize;
      ctx.beginPath();
      ctx.moveTo(points[0].x, points[0].y);
      for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
      if (points.length === 1) {
        // A single tap — draw a dot.
        ctx.lineTo(points[0].x + 0.1, points[0].y + 0.1);
      }
      ctx.stroke();
    },
    [getCtx],
  );

  const clearCanvas = useCallback(() => {
    const ctx = getCtx();
    if (!ctx) return;
    hasContentRef.current = false;
    ctx.fillStyle = bgRef.current;
    ctx.fillRect(0, 0, W, H);
  }, [getCtx]);

  // Pick up the current theme on mount, and again live if it's toggled
  // mid-session. An empty board just gets a plain repaint. A board with
  // strokes on it gets a smarter swap instead: there's no stored stroke
  // history to redraw from, but every pixel that's still *exactly* the old
  // background color, or the old "auto" ink color (a stroke drawn with the
  // theme-default swatch — otherwise it'd stay near-white on a now-white
  // background and vanish), gets recolored in place via getImageData.
  // Explicitly-picked colors (red, indigo, ...) never match either and are
  // left alone. Anti-aliased stroke edges are a blend and won't match
  // exactly either, so they keep a faint tint toward the old colors —
  // unnoticeable for a doodle.
  useEffect(() => {
    function applyTheme(theme: string | null) {
      const light = theme === "light";
      const newBg = light ? LIGHT_BG : DARK_BG;
      const newInk = light ? LIGHT_INK : DARK_INK;
      const oldBg = bgRef.current;
      const oldInk = inkRef.current;
      setColors([newInk, ...REST_COLORS]);
      setColor((c) => (c === oldInk ? newInk : c));
      if (newBg === oldBg && newInk === oldInk) return;
      bgRef.current = newBg;
      inkRef.current = newInk;

      if (!hasContentRef.current) {
        clearCanvas();
        return;
      }
      const ctx = getCtx();
      if (!ctx) return;
      const [obr, obg, obb] = hexToRgb(oldBg);
      const [nbr, nbg, nbb] = hexToRgb(newBg);
      const [oir, oig, oib] = hexToRgb(oldInk);
      const [nir, nig, nib] = hexToRgb(newInk);
      const img = ctx.getImageData(0, 0, W, H);
      const data = img.data;
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        if (r === obr && g === obg && b === obb) {
          data[i] = nbr;
          data[i + 1] = nbg;
          data[i + 2] = nbb;
        } else if (r === oir && g === oig && b === oib) {
          data[i] = nir;
          data[i + 1] = nig;
          data[i + 2] = nib;
        }
      }
      ctx.putImageData(img, 0, 0);
    }
    applyTheme(document.documentElement.getAttribute("data-theme"));
    function onThemeChange(e: Event) {
      applyTheme((e as CustomEvent<string>).detail);
    }
    window.addEventListener("pictportal-theme", onThemeChange);
    return () => window.removeEventListener("pictportal-theme", onThemeChange);
  }, [clearCanvas, getCtx]);

  const applyRemote = useCallback(
    (msg: DrawMsg) => {
      if (msg.kind === "clear") clearCanvas();
      else {
        const resolved =
          msg.color === "auto"
            ? inkRef.current
            : msg.color === "erase"
              ? bgRef.current
              : msg.color;
        paintSegment(msg.points, resolved, msg.size);
      }
    },
    [clearCanvas, paintSegment],
  );

  // Init + expose snapshot getter.
  useEffect(() => {
    clearCanvas();
    if (snapshotRef) {
      snapshotRef.current = () => {
        const c = canvasRef.current;
        if (!c) return null;
        // Nothing drawn since the last clear/round start: report "no snapshot"
        // so the AI stays quiet instead of burning quota guessing at an empty
        // board — which just spams the chat with "night", "blank", "nothing".
        if (!hasContentRef.current) return null;
        // Downscale to a small JPEG before sending to the AI — cuts the input
        // token cost (and quota usage) massively vs. a full 900x600 PNG.
        const scaled = document.createElement("canvas");
        scaled.width = 320;
        scaled.height = 213;
        const sctx = scaled.getContext("2d");
        if (!sctx) return c.toDataURL("image/jpeg", 0.6);
        sctx.fillStyle = bgRef.current;
        sctx.fillRect(0, 0, scaled.width, scaled.height);
        sctx.drawImage(c, 0, 0, scaled.width, scaled.height);
        return scaled.toDataURL("image/jpeg", 0.6);
      };
    }
    return () => {
      if (snapshotRef) snapshotRef.current = null;
    };
  }, [clearCanvas, snapshotRef]);

  // Imperative hook for AI-drawn strokes: paint locally and fan out, using
  // the theme-relative "auto" ink so every viewer sees it against their own
  // background (same reason the pointer path sends "auto").
  useEffect(() => {
    if (!drawStrokeRef) return;
    drawStrokeRef.current = (points: StrokePoint[]) => {
      if (points.length === 0) return;
      paintSegment(points, colors[0], size);
      void send({ content: { kind: "stroke", points, color: "auto", size } });
    };
    return () => {
      drawStrokeRef.current = null;
    };
  }, [drawStrokeRef, paintSegment, send, colors, size]);

  function toCanvasPoint(e: ReactPointerEvent<HTMLCanvasElement>): StrokePoint {
    const rect = e.currentTarget.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * W,
      y: ((e.clientY - rect.top) / rect.height) * H,
    };
  }

  function flush(force = false) {
    const now = performance.now();
    if (!force && now - lastFlush.current < 40) return;
    if (buffer.current.length === 0) return;
    const points = buffer.current;
    buffer.current = [];
    lastFlush.current = now;
    // The "auto" ink swatch (colors[0]) is only meaningful relative to
    // *your own* canvas background — sending its literal hex would paint a
    // near-black stroke on a light-theme viewer as near-black-on-black if
    // they're in dark mode (or the reverse). Send the sentinel instead, and
    // let each viewer resolve it against their own local theme on receipt.
    const wireColor = erasing ? "erase" : color === colors[0] ? "auto" : color;
    void send({ content: { kind: "stroke", points, color: wireColor, size } });
  }

  const canDraw = isDrawer && !aiDrawing;

  function onPointerDown(e: ReactPointerEvent<HTMLCanvasElement>) {
    if (!canDraw) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drawing.current = true;
    // The gesture belongs to the canvas from here on: pin the page scroll
    // until the stroke ends (see the scroll-lock block above).
    holdPageScroll();
    const p = toCanvasPoint(e);
    lastSent.current = p;
    buffer.current = [p];
    paintSegment([p], erasing ? bgRef.current : color, size);
  }

  function onPointerMove(e: ReactPointerEvent<HTMLCanvasElement>) {
    if (!canDraw) return;
    const p = toCanvasPoint(e);
    // El cursor se reporta aunque no se esté trazando: la gracia es ver el
    // lápiz moverse y dudar antes de dibujar, no solo mientras pinta.
    cursorReportRef.current?.({ x: p.x / W, y: p.y / H });
    if (!drawing.current) return;
    // Paint locally through the last point for a continuous line.
    if (lastSent.current) paintSegment([lastSent.current, p], erasing ? bgRef.current : color, size);
    buffer.current.push(p);
    lastSent.current = p;
    flush();
  }

  function onPointerLeaveCanvas() {
    cursorReportRef.current?.(null);
    endStroke();
  }

  function endStroke() {
    if (!canDraw || !drawing.current) return;
    drawing.current = false;
    flush(true);
    lastSent.current = null;
    releasePageScroll();
  }

  function onClear() {
    clearCanvas();
    void send({ content: { kind: "clear" } });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="relative overflow-hidden rounded-xl border border-edge bg-ink">
        <canvas
          ref={canvasRef}
          width={W}
          height={H}
          className="aspect-[3/2] w-full touch-none select-none"
          style={{ cursor: canDraw ? "crosshair" : "not-allowed" }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endStroke}
          onPointerLeave={onPointerLeaveCanvas}
          onPointerCancel={onPointerLeaveCanvas}
        />
        <Cursors
          roomCode={roomCode}
          name={name}
          enabled={canDraw}
          reportRef={cursorReportRef}
        />
        {(aiDrawing || !isDrawer) && (
          <div className="pointer-events-none absolute right-3 top-3 rounded-full bg-black/50 px-3 py-1 text-xs text-white/70">
            {aiDrawing ? "🤖 La IA está dibujando" : "mirando"}
          </div>
        )}
      </div>

      {canDraw && (
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex gap-2">
            {colors.map((c) => (
              <button
                key={c}
                onClick={() => {
                  setColor(c);
                  setErasing(false);
                }}
                aria-label={`color ${c}`}
                className={`h-7 w-7 rounded-full border-2 ${
                  color === c && !erasing ? "border-fg" : "border-transparent"
                }`}
                style={{ background: c }}
              />
            ))}
            <button
              onClick={() => setErasing((v) => !v)}
              aria-label="borrador"
              title="Borrador"
              className={`grid h-7 w-7 place-items-center rounded-full border-2 text-sm ${
                erasing ? "border-fg bg-fg/10" : "border-edge"
              }`}
            >
              🧽
            </button>
          </div>
          <div className="flex items-center gap-2">
            {SIZES.map((s) => (
              <button
                key={s}
                onClick={() => setSize(s)}
                className={`grid h-8 w-8 place-items-center rounded-md border ${
                  size === s ? "border-accent bg-accent/20" : "border-edge"
                }`}
              >
                <span
                  className="rounded-full bg-fg"
                  style={{ width: s, height: s }}
                />
              </button>
            ))}
          </div>
          <button
            onClick={onClear}
            className="ml-auto rounded-md border border-edge px-3 py-1.5 text-sm text-fg/80 hover:bg-fg/5"
          >
            Limpiar
          </button>
        </div>
      )}
    </div>
  );
}
