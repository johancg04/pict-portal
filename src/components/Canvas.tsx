"use client";

import { MutableRefObject, useCallback, useEffect, useRef, useState } from "react";
import { useChannel } from "@/lib/realtime";
import Cursors, { CursorReporter, CursorTip } from "./Cursors";
import { DrawMsg, StrokePoint, drawChannel } from "@/lib/types";
import { penMove, penStop, playSound } from "@/lib/sound";

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

// ---- Network pacing --------------------------------------------------------
// One broadcast every FLUSH_MS while the pen is down (~12/s, was ~25/s plus a
// separate cursor stream). Viewers replay each batch over a few frames, so the
// line still grows smoothly on their screens instead of jumping in steps.
const FLUSH_MS = 80;
// Points closer than this (board pixels) add bytes, not detail.
const MIN_WIRE_DIST = 2;
// A received batch is drawn over roughly this many animation frames.
const PLAYBACK_FRAMES = 4;

type Queued =
  | { kind: "stroke"; pts: StrokePoint[]; color: string; size: number; i: number }
  | { kind: "clear" };

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const dist2 = (a: StrokePoint, b: StrokePoint) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
const mid = (a: StrokePoint, b: StrokePoint): StrokePoint => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

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
  roomCode: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null);
  const cursorReportRef = useRef<CursorReporter | null>(null);
  const cursorTipRef = useRef<CursorTip | null>(null);

  // ---- Page-scroll lock during an active stroke ------------------------------
  // On phones the whole page scrolls, so anything that scrolls the document
  // mid-gesture would slide the canvas out from under the pen. While a stroke
  // is live we pin the scroll position and undo every window scroll event.
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
  useEffect(() => () => releasePageScroll(), [releasePageScroll]);

  // Start dark (matches the server-rendered default) and correct to the real
  // theme once mounted. `bgRef`/`inkRef` hold the live values for painting.
  const bgRef = useRef(DARK_BG);
  const inkRef = useRef(DARK_INK);
  const hasContentRef = useRef(false);
  const [colors, setColors] = useState<string[]>([DARK_INK, ...REST_COLORS]);
  const [color, setColor] = useState(DARK_INK);
  const [size, setSize] = useState(SIZES[1]);
  // Eraser paints in the canvas background color. Over the wire it's the
  // "erase" sentinel so each viewer erases against their own background.
  const [erasing, setErasing] = useState(false);

  const canDraw = isDrawer && !aiDrawing;

  // The pointer handlers are native listeners bound once; they read the
  // current tool through refs instead of re-binding on every state change.
  const toolRef = useRef({ color, size, erasing, colors, canDraw });
  toolRef.current = { color, size, erasing, colors, canDraw };

  const getCtx = useCallback(() => {
    const c = canvasRef.current;
    if (!c) return null;
    if (!ctxRef.current) {
      // `desynchronized` lets the browser show strokes without waiting for the
      // page compositor (noticeably lower pen latency on Chrome/Android);
      // `alpha: false` skips blending against the page since we always paint
      // an opaque background.
      const ctx = c.getContext("2d", { desynchronized: true, alpha: false });
      if (ctx) {
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctxRef.current = ctx;
      }
    }
    return ctxRef.current;
  }, []);

  // Draws a polyline smoothed through the midpoints of its segments.
  const strokePath = useCallback(
    (pts: StrokePoint[], strokeColor: string, strokeSize: number) => {
      const ctx = getCtx();
      if (!ctx || pts.length === 0) return;
      hasContentRef.current = true;
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = strokeSize;
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      if (pts.length === 1) {
        ctx.lineTo(pts[0].x + 0.1, pts[0].y + 0.1); // a tap draws a dot
      } else if (pts.length === 2) {
        ctx.lineTo(pts[1].x, pts[1].y);
      } else {
        for (let i = 1; i < pts.length - 1; i++) {
          const m = mid(pts[i], pts[i + 1]);
          ctx.quadraticCurveTo(pts[i].x, pts[i].y, m.x, m.y);
        }
        const last = pts[pts.length - 1];
        ctx.lineTo(last.x, last.y);
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

  // Pick up the current theme on mount, and again live if it's toggled. An
  // empty board just repaints; a board with strokes gets its old background
  // and old "auto" ink pixels recolored in place.
  useEffect(() => {
    function applyTheme(theme: string | null) {
      const light = theme === "light";
      // Skins (and the classic light/dark theme) publish the board colors as
      // CSS variables; fall back to the classic pair if they're missing.
      const cs = getComputedStyle(document.documentElement);
      const isHex = (v: string) => /^#[0-9a-f]{6}$/i.test(v);
      const cssBg = cs.getPropertyValue("--pp-canvas-bg").trim();
      const cssInk = cs.getPropertyValue("--pp-canvas-ink").trim();
      const newBg = isHex(cssBg) ? cssBg.toLowerCase() : light ? LIGHT_BG : DARK_BG;
      const newInk = isHex(cssInk) ? cssInk.toLowerCase() : light ? LIGHT_INK : DARK_INK;
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

  // ---- Playback queue: received (and AI) strokes grow over a few frames ------
  const queueRef = useRef<Queued[]>([]);
  const rafRef = useRef(0);
  const pump = useCallback(() => {
    rafRef.current = 0;
    const q = queueRef.current;
    // If the network delivered a burst, catch up instantly on all but the
    // newest batch so playback never lags behind the live drawing.
    while (q.length > 2) {
      const item = q.shift()!;
      if (item.kind === "clear") clearCanvas();
      else strokePath(item.pts.slice(Math.max(0, item.i - 1)), item.color, item.size);
    }
    const head = q[0];
    if (!head) return;
    if (head.kind === "clear") {
      q.shift();
      clearCanvas();
    } else {
      const step = Math.max(1, Math.ceil(head.pts.length / PLAYBACK_FRAMES));
      const from = Math.max(0, head.i - 1);
      const to = Math.min(head.pts.length, head.i + step);
      strokePath(head.pts.slice(from, to), head.color, head.size);
      head.i = to;
      if (head.i >= head.pts.length) q.shift();
    }
    if (q.length) rafRef.current = requestAnimationFrame(pump);
  }, [clearCanvas, strokePath]);
  const enqueue = useCallback(
    (item: Queued) => {
      queueRef.current.push(item);
      if (!rafRef.current) rafRef.current = requestAnimationFrame(pump);
    },
    [pump],
  );
  useEffect(() => () => cancelAnimationFrame(rafRef.current), []);

  const resolveColor = useCallback((c: string) => (c === "auto" ? inkRef.current : c === "erase" ? bgRef.current : c), []);

  const { send, me } = useChannel<DrawMsg>({
    channelId: drawChannel(roomCode),
    history: "none",
    onMessage: (msg) => {
      // Ignore our own echoes — the drawer already painted locally.
      if (msg.sender?.id && me?.id && msg.sender.id === me.id) return;
      const c = msg.content;
      if (c.kind === "clear") {
        enqueue({ kind: "clear" });
        playSound("clear");
        return;
      }
      if (!c.points.length) return;
      // The scratch of someone else's pen: speed = distance covered per flush.
      let len = 0;
      for (let i = 1; i < c.points.length; i++) len += Math.sqrt(dist2(c.points[i], c.points[i - 1]));
      penMove(len / FLUSH_MS / 1.5, true);
      enqueue({ kind: "stroke", pts: c.points, color: resolveColor(c.color), size: c.size, i: 0 });
      // While drawing, the pen tip *is* the cursor: move it from the stroke
      // instead of paying for a separate cursor stream.
      const tip = c.points[c.points.length - 1];
      if (msg.sender?.id) cursorTipRef.current?.(msg.sender.id, { x: tip.x / W, y: tip.y / H });
    },
  });
  const sendRef = useRef(send);
  sendRef.current = send;

  // Init + expose snapshot getter.
  useEffect(() => {
    clearCanvas();
    if (snapshotRef) {
      snapshotRef.current = () => {
        const c = canvasRef.current;
        if (!c) return null;
        // Nothing drawn since the last clear: no snapshot, so the AI stays quiet.
        if (!hasContentRef.current) return null;
        // Downscale to a small JPEG before sending to the AI.
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

  // Imperative hook for AI-drawn strokes: animate locally and fan out, using
  // the theme-relative "auto" ink so every viewer sees it on their background.
  useEffect(() => {
    if (!drawStrokeRef) return;
    drawStrokeRef.current = (points: StrokePoint[]) => {
      if (points.length === 0) return;
      enqueue({ kind: "stroke", pts: points, color: inkRef.current, size, i: 0 });
      let len = 0;
      for (let i = 1; i < points.length; i++) len += Math.sqrt(dist2(points[i], points[i - 1]));
      penMove(len / 240 / 1.5, true); // the AI's pace (see AI_STROKE_MS in Game.tsx)
      void send({ content: { kind: "stroke", points, color: "auto", size } });
    };
    return () => {
      drawStrokeRef.current = null;
    };
  }, [drawStrokeRef, enqueue, send, size]);

  // ---- Pen input: native, coalesced, low-latency ---------------------------
  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    // pointerrawupdate delivers moves as soon as the OS has them (Chrome),
    // ahead of the frame-aligned pointermove. Fall back where unsupported.
    const raw = "onpointerrawupdate" in cv;
    let rect = cv.getBoundingClientRect();
    let pointer: number | null = null;
    let prev: StrokePoint | null = null; // last raw point painted
    let midPt: StrokePoint | null = null; // where the smoothed line currently ends
    let wire: StrokePoint[] = []; // points waiting to be broadcast
    let tail: StrokePoint | null = null; // last point already broadcast (overlap)
    let lastWire: StrokePoint | null = null;
    let lastMoveAt = 0; // for the pen's scratch: how fast the stroke is going
    let timer: ReturnType<typeof setTimeout> | null = null;

    const toPt = (e: PointerEvent): StrokePoint => ({
      x: ((e.clientX - rect.left) / rect.width) * W,
      y: ((e.clientY - rect.top) / rect.height) * H,
    });
    const paintColor = () => (toolRef.current.erasing ? bgRef.current : toolRef.current.color);
    const wireColor = () => {
      const t = toolRef.current;
      // The default swatch is theme-relative: send "auto" and let each viewer
      // resolve it against their own background.
      return t.erasing ? "erase" : t.color === t.colors[0] ? "auto" : t.color;
    };

    const flush = () => {
      timer = null;
      if (!wire.length) return;
      // Each batch starts at the previous batch's last point, so viewers get
      // one continuous line instead of tiny gaps between batches.
      const points = tail ? [tail, ...wire] : wire;
      tail = points[points.length - 1];
      wire = [];
      void sendRef.current({ content: { kind: "stroke", points, color: wireColor(), size: toolRef.current.size } });
    };
    const scheduleFlush = () => {
      if (!timer) timer = setTimeout(flush, FLUSH_MS);
    };
    const queueWire = (p: StrokePoint, force = false) => {
      if (!force && lastWire && dist2(p, lastWire) < MIN_WIRE_DIST * MIN_WIRE_DIST) return;
      const r = { x: Math.round(p.x), y: Math.round(p.y) };
      wire.push(r);
      lastWire = r;
      scheduleFlush();
    };

    const start = (p: StrokePoint) => {
      const ctx = getCtx();
      if (!ctx) return;
      hasContentRef.current = true;
      prev = p;
      midPt = p;
      ctx.strokeStyle = paintColor();
      ctx.lineWidth = toolRef.current.size;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x + 0.1, p.y + 0.1);
      ctx.stroke();
      tail = null;
      lastWire = null;
      wire = [];
      lastMoveAt = performance.now();
      queueWire(p, true);
    };
    const extend = (p: StrokePoint) => {
      if (!prev || !midPt) return;
      if (dist2(p, prev) < 0.25) return;
      const ctx = getCtx();
      if (!ctx) return;
      const t = performance.now();
      penMove(Math.sqrt(dist2(p, prev)) / Math.max(1, t - lastMoveAt) / 1.5);
      lastMoveAt = t;
      const m = mid(prev, p);
      ctx.strokeStyle = paintColor();
      ctx.lineWidth = toolRef.current.size;
      ctx.beginPath();
      ctx.moveTo(midPt.x, midPt.y);
      ctx.quadraticCurveTo(prev.x, prev.y, m.x, m.y);
      ctx.stroke();
      midPt = m;
      prev = p;
      queueWire(p);
    };
    const end = () => {
      if (pointer === null) return;
      pointer = null;
      const ctx = getCtx();
      if (ctx && prev && midPt) {
        ctx.beginPath();
        ctx.moveTo(midPt.x, midPt.y);
        ctx.lineTo(prev.x, prev.y);
        ctx.stroke();
        queueWire(prev, true);
      }
      if (timer) clearTimeout(timer);
      flush();
      prev = midPt = null;
      tail = null;
      penStop();
      releasePageScroll();
    };

    const onDown = (e: PointerEvent) => {
      if (!toolRef.current.canDraw || pointer !== null) return;
      if (e.pointerType === "mouse" && e.button !== 0) return;
      e.preventDefault();
      rect = cv.getBoundingClientRect();
      cv.setPointerCapture(e.pointerId);
      pointer = e.pointerId;
      holdPageScroll();
      start(toPt(e));
    };
    const onStrokeMove = (e: PointerEvent) => {
      if (pointer !== e.pointerId) return;
      const list = typeof e.getCoalescedEvents === "function" ? e.getCoalescedEvents() : [];
      if (list.length) for (const ev of list) extend(toPt(ev));
      else extend(toPt(e));
    };
    const onHover = (e: PointerEvent) => {
      if (!toolRef.current.canDraw) return;
      if (pointer === null) {
        // Only report the hovering pen; while drawing, viewers follow the stroke tip.
        rect = cv.getBoundingClientRect();
        const p = toPt(e);
        cursorReportRef.current?.({ x: p.x / W, y: p.y / H });
      } else if (!raw) {
        onStrokeMove(e);
      }
    };
    const onLeave = () => {
      if (pointer === null) cursorReportRef.current?.(null);
    };

    cv.addEventListener("pointerdown", onDown);
    cv.addEventListener("pointermove", onHover);
    if (raw) cv.addEventListener("pointerrawupdate" as "pointermove", onStrokeMove);
    cv.addEventListener("pointerup", end);
    cv.addEventListener("pointercancel", end);
    cv.addEventListener("lostpointercapture", end);
    cv.addEventListener("pointerleave", onLeave);
    return () => {
      cv.removeEventListener("pointerdown", onDown);
      cv.removeEventListener("pointermove", onHover);
      if (raw) cv.removeEventListener("pointerrawupdate" as "pointermove", onStrokeMove);
      cv.removeEventListener("pointerup", end);
      cv.removeEventListener("pointercancel", end);
      cv.removeEventListener("lostpointercapture", end);
      cv.removeEventListener("pointerleave", onLeave);
      if (timer) clearTimeout(timer);
    };
  }, [getCtx, holdPageScroll, releasePageScroll]);

  function onClear() {
    queueRef.current = [];
    playSound("clear");
    clearCanvas();
    void send({ content: { kind: "clear" } });
  }

  return (
    <div className="pp-board-wrap flex flex-col gap-3">
      <div className="pp-board relative overflow-hidden rounded-xl border border-edge bg-ink">
        <canvas
          ref={canvasRef}
          width={W}
          height={H}
          className="aspect-[3/2] w-full touch-none select-none"
          style={{ cursor: canDraw ? "crosshair" : "not-allowed", WebkitTouchCallout: "none" }}
          aria-label={canDraw ? "Lienzo: dibuja aquí" : "Lienzo del dibujante"}
        />
        <Cursors roomCode={roomCode} name={name} enabled={canDraw} reportRef={cursorReportRef} tipRef={cursorTipRef} />
        {(aiDrawing || !isDrawer) && (
          <div className="pp-board-tag pointer-events-none absolute right-3 top-3 rounded-full bg-black/50 px-3 py-1 text-xs text-white/70">
            {aiDrawing ? "🤖 La IA está dibujando" : "mirando"}
          </div>
        )}
      </div>

      {canDraw && (
        <div className="pp-toolbar flex flex-wrap items-center gap-3">
          <div className="flex gap-2">
            {colors.map((c) => (
              <button
                key={c}
                onClick={() => {
                  setColor(c);
                  setErasing(false);
                }}
                aria-label={`color ${c}`}
                aria-pressed={color === c && !erasing}
                className={`pp-swatch h-9 w-9 rounded-full border-2 sm:h-7 sm:w-7 ${
                  color === c && !erasing ? "border-fg" : "border-transparent"
                }`}
                style={{ background: c }}
              />
            ))}
            <button
              onClick={() => setErasing((v) => !v)}
              aria-label="borrador"
              aria-pressed={erasing}
              title="Borrador"
              className={`pp-tool grid h-9 w-9 place-items-center rounded-full border-2 text-sm sm:h-7 sm:w-7 ${
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
                aria-label={`grosor ${s}`}
                aria-pressed={size === s}
                className={`pp-tool grid h-9 w-9 place-items-center rounded-md border sm:h-8 sm:w-8 ${
                  size === s ? "border-accent bg-accent/20" : "border-edge"
                }`}
              >
                <span className="rounded-full bg-fg" style={{ width: s, height: s }} />
              </button>
            ))}
          </div>
          <button
            onClick={onClear}
            className="pp-tool ml-auto rounded-md border border-edge px-3 py-1.5 text-sm text-fg/80 hover:bg-fg/5"
          >
            Limpiar
          </button>
        </div>
      )}
    </div>
  );
}
