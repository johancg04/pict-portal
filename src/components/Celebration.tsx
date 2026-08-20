"use client";

import { useCallback, useEffect, useRef } from "react";
import { playCorrect } from "@/lib/sound";

// Confetti + a short chime when someone nails the word. Both are generated at
// runtime (canvas particles, Web Audio oscillators) so there's no library and
// no audio file to ship.

// Leads with the app's accent, then the same hues the player badges use, so
// the burst reads as part of the product rather than a generic rainbow.
const COLORS = [
  "#6366f1", "#818cf8", "#a855f7", "#ec4899",
  "#f97316", "#eab308", "#22c55e", "#14b8a6", "#0ea5e9",
];

const COUNT = 150;
const GRAVITY = 0.12;
const DRAG = 0.988;

type Shape = "rect" | "ribbon" | "dot";

type Particle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  tilt: number; // fixed lean of the piece
  spin: number; // phase of the edge-on flip
  spinSpeed: number;
  sway: number; // phase of the horizontal drift
  swaySpeed: number;
  swayAmp: number;
  w: number;
  h: number;
  color: string;
  shape: Shape;
  life: number; // 1 → 0
  decay: number;
};

const rand = (min: number, max: number) => min + Math.random() * (max - min);
const pick = <T,>(arr: readonly T[]) => arr[Math.floor(Math.random() * arr.length)];

export default function Celebration({
  trigger,
  muted,
  armed,
}: {
  /** Id of the most recent win; a change fires the celebration. */
  trigger: string | null;
  muted: boolean;
  /**
   * Only start watching once the feed is fully loaded. Without this the
   * baseline is taken while `messages` is still empty, so the first win that
   * history backfill pulls in reads as brand new and throws confetti at
   * someone who just walked into the room.
   */
  armed: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const particles = useRef<Particle[]>([]);
  const rafRef = useRef(0);
  const seenRef = useRef<string | null>(null);
  const primedRef = useRef(false);

  // Match the backing store to the device pixel ratio, otherwise every piece
  // is soft and slightly smeared on a retina/high-DPI screen — the single
  // biggest thing that makes canvas effects look cheap.
  const resize = useCallback(() => {
    const c = canvasRef.current;
    if (!c) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    c.width = Math.floor(window.innerWidth * dpr);
    c.height = Math.floor(window.innerHeight * dpr);
    c.style.width = `${window.innerWidth}px`;
    c.style.height = `${window.innerHeight}px`;
    const ctx = c.getContext("2d");
    if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }, []);

  const loop = useCallback(() => {
    const c = canvasRef.current;
    const ctx = c?.getContext("2d");
    if (!c || !ctx) return;

    const vw = window.innerWidth;
    const vh = window.innerHeight;
    ctx.clearRect(0, 0, vw, vh);

    let alive = 0;
    for (const p of particles.current) {
      if (p.life <= 0) continue;

      p.life -= p.decay;
      p.vy = (p.vy + GRAVITY) * DRAG;
      p.vx *= DRAG;
      p.sway += p.swaySpeed;
      p.x += p.vx + Math.sin(p.sway) * p.swayAmp;
      p.y += p.vy;
      p.spin += p.spinSpeed;

      if (p.y > vh + 60) {
        p.life = 0;
        continue;
      }
      alive++;

      // cos(spin) flattens the piece as it turns edge-on, which is what sells
      // it as tumbling paper instead of a sliding rectangle. Dimming it at the
      // same time reads as light catching the surface.
      const flip = Math.cos(p.spin);
      const fade = p.life > 0.25 ? 1 : Math.max(0, p.life / 0.25);

      ctx.save();
      ctx.globalAlpha = fade * (0.55 + 0.45 * Math.abs(flip));
      ctx.translate(p.x, p.y);
      ctx.rotate(p.tilt);
      ctx.fillStyle = p.color;

      if (p.shape === "dot") {
        ctx.beginPath();
        ctx.ellipse(0, 0, (p.w / 2) * Math.abs(flip) || 0.1, p.w / 2, 0, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.scale(flip || 0.01, 1);
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      }
      ctx.restore();
    }

    if (alive > 0) {
      rafRef.current = requestAnimationFrame(loop);
    } else {
      particles.current = [];
      ctx.clearRect(0, 0, vw, vh);
    }
  }, []);

  const burst = useCallback(() => {
    if (!canvasRef.current) return;
    resize();
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    const next: Particle[] = [];
    for (let i = 0; i < COUNT; i++) {
      const shape: Shape = Math.random() < 0.18 ? "dot" : Math.random() < 0.3 ? "ribbon" : "rect";
      const w = shape === "ribbon" ? rand(3, 6) : shape === "dot" ? rand(5, 9) : rand(8, 14);
      next.push({
        x: rand(-0.05, 1.05) * vw,
        // Spread well above the viewport (and staggered by more than a screen
        // height) so pieces keep arriving while the first ones are still
        // falling — a continuous shower rather than one tight sheet that
        // sweeps past and leaves the screen empty behind it.
        y: rand(-1.15, -0.02) * vh,
        vx: rand(-0.7, 0.7),
        // Wide velocity spread breaks up the "rigid sheet" look.
        vy: rand(1.2, 3.8),
        tilt: rand(0, Math.PI),
        spin: rand(0, Math.PI * 2),
        spinSpeed: rand(0.06, 0.16) * (Math.random() < 0.5 ? -1 : 1),
        sway: rand(0, Math.PI * 2),
        swaySpeed: rand(0.02, 0.05),
        swayAmp: rand(0.4, 1.6),
        w,
        h: shape === "ribbon" ? rand(16, 26) : shape === "dot" ? w : rand(10, 18),
        color: pick(COLORS),
        shape,
        life: 1,
        // Slower decay so a piece born high up still survives its longer fall.
        decay: rand(0.0022, 0.0042),
      });
    }
    particles.current = next;
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(loop);
  }, [loop, resize]);

  useEffect(() => {
    if (!armed) return;
    // Whatever win is already in the feed once we're armed is the baseline,
    // not something to celebrate.
    if (!primedRef.current) {
      primedRef.current = true;
      seenRef.current = trigger;
      return;
    }
    if (!trigger || trigger === seenRef.current) return;
    seenRef.current = trigger;

    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (!reduced) burst();
    if (!muted) playCorrect();
  }, [trigger, muted, armed, burst]);

  // Keep the canvas matched to the window if it changes mid-flight.
  useEffect(() => {
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, [resize]);

  useEffect(() => () => cancelAnimationFrame(rafRef.current), []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className="pointer-events-none fixed inset-0 z-50"
    />
  );
}
