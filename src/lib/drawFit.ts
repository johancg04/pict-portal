// Post-processing for the AI's doodles: the model often draws small, off-centre
// or lopsided, which makes the word much harder to guess. Pure functions, used
// by /api/draw for fresh and cached drawings alike.

export type Pt = { x: number; y: number };
export type Stroke = { points: Pt[] };

// The board is landscape (≈3:2). Coordinates are normalised per axis, so a
// "round" shape only looks round if we reason in pixel-like units.
const ASPECT = 1.5;
const MARGIN = 0.1; // keep 10% free on every side

/** Scales (uniformly, so shapes keep their proportions) and centres the drawing to fill the board. */
export function fitToCanvas(strokes: Stroke[]): Stroke[] {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const s of strokes)
    for (const p of s.points) {
      const x = p.x * ASPECT;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
  const w = maxX - minX;
  const h = maxY - minY;
  if (!isFinite(w) || !isFinite(h) || (w < 1e-3 && h < 1e-3)) return strokes;

  const scale = Math.min(((1 - 2 * MARGIN) * ASPECT) / Math.max(w, 1e-3), (1 - 2 * MARGIN) / Math.max(h, 1e-3));
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const clamp = (v: number) => Math.max(0, Math.min(1, v));
  return strokes.map((s) => ({
    points: s.points.map((p) => ({
      x: clamp(((p.x * ASPECT - cx) * scale + ASPECT / 2) / ASPECT),
      y: clamp((p.y - cy) * scale + 0.5),
    })),
  }));
}

/** Rough "is this a real drawing?" check, before fitting: enough strokes/points and not a speck. */
export function looksUsable(strokes: Stroke[], minStrokes: number): boolean {
  if (strokes.length < minStrokes) return false;
  const pts = strokes.reduce((n, s) => n + s.points.length, 0);
  if (pts < minStrokes * 3) return false;
  let minX = 1, minY = 1, maxX = 0, maxY = 0;
  for (const s of strokes)
    for (const p of s.points) {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
    }
  // Degenerate: everything on one line, or a tiny blob.
  return maxX - minX > 0.15 && maxY - minY > 0.15;
}
