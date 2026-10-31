/**
 * Starless's logo, drawn from nothing but maths.
 *
 * "Wave over equalizer": a ring, eight bars that fade from light grey to almost
 * black — the sound going out into silence — and a sine wave that draws an S over
 * them. No stars anywhere: the name is *Starless* and the mark keeps its word.
 * The logo is grey only; the Ember accent lives in the interface, not in the mark.
 *
 *   bun run logo          writes public/starless*.svg (and site/public), and every app icon
 *   bun run logo:icons    just the app icons
 *   bun run logo:invert   the development mark (light plate), into icons-dev/
 *
 * Why this file exists instead of a checked-in PNG: an icon nobody can regenerate
 * is an icon nobody can change. The approved artwork lives in `brand-kit/`; this
 * script is the same geometry, so both can be checked against each other.
 *
 * No image library. The whole mark is circles, rounded bars and one cubic curve,
 * so the rasterizer is a handful of signed distance functions, a three-box
 * approximation of a gaussian blur for the glass, and a hand-rolled PNG.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const PUBLIC = join(ROOT, "public");
/** The landing serves the same marks: favicon, header and hero. */
const SITE_PUBLIC = join(ROOT, "site", "public");

/** Where the icons land. Development writes somewhere else so it cannot clobber a release. */
const ICONS = join(ROOT, "src-tauri", "icons");
const ICONS_DEV = join(ROOT, "src-tauri", "icons-dev");

// ---------------------------------------------------------------------------
// Geometry, on a 100×100 viewBox — the same numbers as brand-kit/README.md
// ---------------------------------------------------------------------------

const RING = { r: 43, width: 5 };
const BAR_WIDTH = 5;
const BAR_HEIGHTS = [30, 52, 62, 52, 38, 26, 16, 8];
const barX = (n: number) => 19.5 + 8 * n;
const barY = (n: number) => 50 - (BAR_HEIGHTS[n] ?? 0) / 2;

/** Light to almost black, left to right: the sound fading into the night. */
const RAMP_DARK = [
  "#DAD7DD",
  "#C4C1C8",
  "#A8A5AD",
  "#8C8992",
  "#706E77",
  "#55535C",
  "#3A3941",
  "#2E2D35",
];
/** The same ramp reversed, for light grounds. */
const RAMP_LIGHT = [
  "#24242C",
  "#3A3941",
  "#55535C",
  "#706E77",
  "#8C8992",
  "#A8A5AD",
  "#C4C1C8",
  "#DAD7DD",
];

const WAVE = "M16 50 C 27 20, 39 20, 50 50 S 73 80, 84 50";
const WAVE_SPECULAR = "M16 48.4 C 27 18.4, 39 18.4, 50 48.4 S 73 78.4, 84 48.4";
const WAVE_WIDTH = 7;
/** The halo the wave cuts out of the bars, so it reads as passing *over* them. */
const WAVE_HALO = 14;

type Point = [number, number];

/** The wave's two cubic segments; the `S` reflects the first's last control point. */
function waveSegments(dy = 0): [Point, Point, Point, Point][] {
  return [
    [
      [16, 50 + dy],
      [27, 20 + dy],
      [39, 20 + dy],
      [50, 50 + dy],
    ],
    [
      [50, 50 + dy],
      [61, 80 + dy],
      [73, 80 + dy],
      [84, 50 + dy],
    ],
  ];
}

function flatten(segments: [Point, Point, Point, Point][], steps = 48): Point[] {
  const out: Point[] = [];
  for (const [a, b, c, d] of segments) {
    for (let i = out.length === 0 ? 0 : 1; i <= steps; i++) {
      const t = i / steps;
      const m = 1 - t;
      out.push([
        m * m * m * a[0] + 3 * m * m * t * b[0] + 3 * m * t * t * c[0] + t * t * t * d[0],
        m * m * m * a[1] + 3 * m * m * t * b[1] + 3 * m * t * t * c[1] + t * t * t * d[1],
      ]);
    }
  }
  return out;
}

const WAVE_POINTS = flatten(waveSegments());
const WAVE_SPECULAR_POINTS = flatten(waveSegments(-1.6));

// ---------------------------------------------------------------------------
// The vector marks
// ---------------------------------------------------------------------------

function svg(body: string, defs = ""): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="512" height="512" role="img" aria-label="Starless">
  <title>Starless</title>${defs ? `\n  <defs>\n${defs}\n  </defs>` : ""}
${body}
</svg>
`;
}

const bars = (attrs: (n: number) => string) =>
  BAR_HEIGHTS.map(
    (h, n) =>
      `  <rect x="${barX(n)}" y="${barY(n)}" width="${BAR_WIDTH}" height="${h}" rx="2.5" ${attrs(n)}/>`,
  ).join("\n");

/** Flat grey for dark grounds, or its inverse for light ones. Below ~64px, where glass turns to mush. */
function flatMark(light: boolean): string {
  const ramp = light ? RAMP_LIGHT : RAMP_DARK;
  return svg(
    [
      `  <circle cx="50" cy="50" r="${RING.r}" fill="none" stroke="${light ? "#706E77" : "#8C8992"}" stroke-width="${RING.width}"/>`,
      bars((n) => `fill="${ramp[n]}"`),
      `  <path d="${WAVE}" fill="none" stroke="${light ? "#EDEAE3" : "#15151B"}" stroke-width="${WAVE_HALO}" stroke-linecap="round"/>`,
      `  <path d="${WAVE}" fill="none" stroke="${light ? "#0B0B0F" : "#EDEAE3"}" stroke-width="${WAVE_WIDTH}" stroke-linecap="round"/>`,
    ].join("\n"),
  );
}

/** One ink, following `currentColor`; the wave is cut out of the bars with a mask. */
function monoMark(): string {
  return svg(
    [
      `  <g fill="currentColor" mask="url(#sl-cut)">`,
      bars(() => "").replace(/^ {2}/gm, "    "),
      "  </g>",
      `  <circle cx="50" cy="50" r="${RING.r}" fill="none" stroke="currentColor" stroke-width="${RING.width}"/>`,
      `  <path d="${WAVE}" fill="none" stroke="currentColor" stroke-width="${WAVE_WIDTH}" stroke-linecap="round"/>`,
    ].join("\n"),
    `    <mask id="sl-cut">
      <rect width="100" height="100" fill="#fff"/>
      <path d="${WAVE}" fill="none" stroke="#000" stroke-width="${WAVE_HALO}" stroke-linecap="round"/>
    </mask>`,
  );
}

/** Opacity of each bar's colour, and of each glass tube over it: both thin out with the sound. */
const BAR_ALPHA = [0.85, 0.82, 0.8, 0.78, 0.76, 0.74, 0.72, 0.7];
const TUBE_STROKE = [0.35, 0.32, 0.28, 0.24, 0.2, 0.16, 0.12, 0.1];
const TUBE_OPACITY = [1, 1, 1, 0.85, 0.7, 0.55, 0.4, 0.3];
const barAlpha = (n: number) => BAR_ALPHA[n] ?? 1;
const tubeStroke = (n: number) => TUBE_STROKE[n] ?? 0;
const tubeOpacity = (n: number) => TUBE_OPACITY[n] ?? 1;

/** The main mark: liquid glass. Hero, splash, and every icon from 64px up. */
function glassMark(): string {
  const stops = (list: [number, string, number][]) =>
    list
      .map(([o, c, a]) => `      <stop offset="${o}" stop-color="${c}" stop-opacity="${a}"/>`)
      .join("\n");
  const fixed = (n: number) => Number(n.toFixed(2));
  return svg(
    [
      `  <circle cx="50" cy="50" r="${RING.r}" fill="none" stroke="url(#sl-ring)" stroke-width="${RING.width}"/>`,
      `  <circle cx="50" cy="50" r="44.6" fill="none" stroke="#FFFFFF" stroke-width="0.9" stroke-opacity="0.7" stroke-dasharray="67 300" stroke-linecap="round" transform="rotate(180 50 50)"/>`,
      bars((n) => `fill="${RAMP_DARK[n]}" fill-opacity="${fixed(barAlpha(n))}"`),
      bars(
        (n) =>
          `fill="url(#sl-tube)" stroke="#FFFFFF" stroke-opacity="${fixed(tubeStroke(n))}" stroke-width="0.5"${tubeOpacity(n) < 1 ? ` opacity="${fixed(tubeOpacity(n))}"` : ""}`,
      ),
      `  <path d="${WAVE}" fill="none" stroke="#0B0B0F" stroke-opacity="0.85" stroke-width="${WAVE_HALO}" stroke-linecap="round" filter="url(#sl-soft)"/>`,
      `  <path d="${WAVE}" fill="none" stroke="#FFFFFF" stroke-opacity="0.35" stroke-width="8" stroke-linecap="round" filter="url(#sl-glow)"/>`,
      `  <path d="${WAVE}" fill="none" stroke="url(#sl-wave)" stroke-width="${WAVE_WIDTH}" stroke-linecap="round"/>`,
      `  <path d="${WAVE_SPECULAR}" fill="none" stroke="#FFFFFF" stroke-opacity="0.9" stroke-width="1.3" stroke-linecap="round"/>`,
    ].join("\n"),
    [
      `    <linearGradient id="sl-ring" x1="0" y1="0" x2="1" y2="1">\n${stops(RING_STOPS)}\n    </linearGradient>`,
      `    <linearGradient id="sl-tube" x1="0" y1="0" x2="1" y2="0">\n${stops(TUBE_STOPS)}\n    </linearGradient>`,
      `    <linearGradient id="sl-wave" x1="0" y1="0" x2="1" y2="1">\n${stops(WAVE_STOPS)}\n    </linearGradient>`,
      `    <filter id="sl-soft" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="1.6"/></filter>`,
      `    <filter id="sl-glow" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="3"/></filter>`,
    ].join("\n"),
  );
}

type Stop = [number, string, number];
const RING_STOPS: Stop[] = [
  [0, "#FFFFFF", 0.95],
  [0.45, "#C4C1C8", 0.45],
  [0.75, "#FFFFFF", 0.12],
  [1, "#DAD7DD", 0.6],
];
const TUBE_STOPS: Stop[] = [
  [0, "#FFFFFF", 0.85],
  [0.35, "#FFFFFF", 0.15],
  [0.7, "#FFFFFF", 0],
  [1, "#FFFFFF", 0.45],
];
const WAVE_STOPS: Stop[] = [
  [0, "#FFFFFF", 1],
  [0.5, "#DAD7DD", 0.8],
  [1, "#FFFFFF", 0.55],
];

// ---------------------------------------------------------------------------
// Rasterizer
// ---------------------------------------------------------------------------

type RGBA = [number, number, number, number];
/** A signed distance in the shape's own units: negative inside, positive outside. */
type Sdf = (x: number, y: number) => number;
type Paint = (x: number, y: number) => RGBA;

function hex(color: string, alpha = 1): RGBA {
  const n = Number.parseInt(color.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, alpha];
}

const solid =
  (color: string, alpha = 1): Paint =>
  () =>
    hex(color, alpha);

/**
 * A linear gradient in objectBoundingBox units, like the SVG one. `xy` is
 * x1=0 y1=0 x2=1 y2=1, measured in the box — which is why it is the mean of the
 * two normalised coordinates rather than a projection in user space.
 */
function gradient(
  box: [number, number, number, number],
  stops: Stop[],
  axis: "x" | "y" | "xy",
): Paint {
  const parsed = stops.map(([o, c, a]) => [o, ...hex(c, a)] as [number, ...RGBA]);
  const [bx, by, bw, bh] = box;
  return (x, y) => {
    const u = (x - bx) / bw;
    const v = (y - by) / bh;
    const t = Math.min(1, Math.max(0, axis === "x" ? u : axis === "y" ? v : (u + v) / 2));
    for (let i = 1; i < parsed.length; i++) {
      const b = parsed[i] as [number, ...RGBA];
      const a = parsed[i - 1] as [number, ...RGBA];
      if (t <= b[0]) {
        const k = b[0] === a[0] ? 0 : (t - a[0]) / (b[0] - a[0]);
        return [
          a[1] + (b[1] - a[1]) * k,
          a[2] + (b[2] - a[2]) * k,
          a[3] + (b[3] - a[3]) * k,
          a[4] + (b[4] - a[4]) * k,
        ];
      }
    }
    const last = parsed[parsed.length - 1] as [number, ...RGBA];
    return [last[1], last[2], last[3], last[4]];
  };
}

const disc =
  (cx: number, cy: number, r: number): Sdf =>
  (x, y) =>
    Math.hypot(x - cx, y - cy) - r;

const ring =
  (cx: number, cy: number, r: number, width: number): Sdf =>
  (x, y) =>
    Math.abs(Math.hypot(x - cx, y - cy) - r) - width / 2;

function roundRect(x0: number, y0: number, w: number, h: number, r: number): Sdf {
  const cx = x0 + w / 2;
  const cy = y0 + h / 2;
  return (x, y) => {
    const qx = Math.abs(x - cx) - w / 2 + r;
    const qy = Math.abs(y - cy) - h / 2 + r;
    return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
  };
}

const outline =
  (shape: Sdf, width: number): Sdf =>
  (x, y) =>
    Math.abs(shape(x, y)) - width / 2;

/** A stroked polyline with round caps. */
function stroke(points: Point[], width: number): Sdf {
  return (x, y) => {
    let best = Number.POSITIVE_INFINITY;
    for (let i = 1; i < points.length; i++) {
      const [ax, ay] = points[i - 1] as Point;
      const [bx, by] = points[i] as Point;
      const dx = bx - ax;
      const dy = by - ay;
      const t = Math.min(1, Math.max(0, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)));
      const ex = x - ax - t * dx;
      const ey = y - ay - t * dy;
      const d = ex * ex + ey * ey;
      if (d < best) best = d;
    }
    return Math.sqrt(best) - width / 2;
  };
}

/**
 * A round-capped arc from `from` to `to` radians, clockwise on screen.
 *
 * The glass ring's reflection is `stroke-dasharray="67 300"` rotated 180°: one
 * 67-unit dash starting at nine o'clock and running up the upper-left quarter.
 */
function arc(cx: number, cy: number, r: number, from: number, to: number, width: number): Sdf {
  const ends: Point[] = [from, to].map((a) => [cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  return (x, y) => {
    let a = Math.atan2(y - cy, x - cx);
    while (a < from) a += Math.PI * 2;
    if (a <= to) return Math.abs(Math.hypot(x - cx, y - cy) - r) - width / 2;
    const [e0, e1] = ends as [Point, Point];
    return Math.min(Math.hypot(x - e0[0], y - e0[1]), Math.hypot(x - e1[0], y - e1[1])) - width / 2;
  };
}

/** Premultiplied RGBA in floats, so blur and compositing stay honest. */
class Canvas {
  readonly data: Float32Array;
  constructor(readonly size: number) {
    this.data = new Float32Array(size * size * 4);
  }

  /**
   * Fill a shape given in its own units, placed with `scale` and `offset` (px).
   *
   * Coverage is the signed distance in pixels through a one-pixel ramp: it
   * antialiases every edge for free and needs no supersampling. Shapes thinner
   * than a pixel fade instead of vanishing, which is what a 16px icon wants.
   */
  fill(shape: Sdf, paint: Paint, place: Place, opacity = 1): void {
    const { scale, offset } = place;
    const n = this.size;
    for (let py = 0; py < n; py++) {
      const y = (py + 0.5 - offset) / scale;
      for (let px = 0; px < n; px++) {
        const x = (px + 0.5 - offset) / scale;
        const d = shape(x, y) * scale;
        if (d >= 0.5) continue;
        const cover = Math.min(1, 0.5 - d);
        const [r, g, b, a] = paint(x, y);
        const alpha = a * cover * opacity;
        if (alpha <= 0) continue;
        const i = (py * n + px) * 4;
        const keep = 1 - alpha;
        const out = this.data;
        out[i] = r * alpha + (out[i] ?? 0) * keep;
        out[i + 1] = g * alpha + (out[i + 1] ?? 0) * keep;
        out[i + 2] = b * alpha + (out[i + 2] ?? 0) * keep;
        out[i + 3] = alpha + (out[i + 3] ?? 0) * keep;
      }
    }
  }

  /** Paint another canvas over this one, optionally through a mask shape. */
  over(top: Canvas, mask?: { shape: Sdf; place: Place }): void {
    const n = this.size;
    for (let py = 0; py < n; py++) {
      for (let px = 0; px < n; px++) {
        let m = 1;
        if (mask) {
          const { scale, offset } = mask.place;
          const d = mask.shape((px + 0.5 - offset) / scale, (py + 0.5 - offset) / scale) * scale;
          m = Math.min(1, Math.max(0, 0.5 - d));
          if (m === 0) continue;
        }
        const i = (py * n + px) * 4;
        const a = (top.data[i + 3] ?? 0) * m;
        if (a <= 0) continue;
        const keep = 1 - a;
        for (let c = 0; c < 4; c++) {
          this.data[i + c] = (top.data[i + c] ?? 0) * m + (this.data[i + c] ?? 0) * keep;
        }
      }
    }
  }

  /**
   * Gaussian blur, approximated by three box blurs of running sums.
   *
   * A true kernel at the app icon's 90-unit haze is a 540-tap convolution per
   * pixel per pass; three boxes cost the same at any radius and are within a
   * percent of the real curve, which nothing at icon size can tell apart.
   */
  blur(sigma: number): void {
    if (sigma < 0.3) return;
    // Box widths whose sum of variances matches the gaussian's (Kovesi's method).
    const ideal = Math.sqrt((12 * sigma * sigma) / 3 + 1);
    let low = Math.floor(ideal);
    if (low % 2 === 0) low--;
    const high = low + 2;
    const m = Math.round((12 * sigma * sigma - 3 * low * low - 12 * low - 9) / (-4 * low - 4));
    for (let k = 0; k < 3; k++) {
      const radius = ((k < m ? low : high) - 1) / 2;
      this.boxPass(radius, true);
      this.boxPass(radius, false);
    }
  }

  private boxPass(radius: number, horizontal: boolean): void {
    const n = this.size;
    const src = this.data.slice();
    const width = radius * 2 + 1;
    const at = (line: number, k: number) =>
      (horizontal
        ? line * n + Math.min(n - 1, Math.max(0, k))
        : Math.min(n - 1, Math.max(0, k)) * n + line) * 4;
    for (let line = 0; line < n; line++) {
      for (let c = 0; c < 4; c++) {
        // Outside the canvas is transparent, not a repeat of the edge.
        const value = (k: number) => (k < 0 || k >= n ? 0 : (src[at(line, k) + c] ?? 0));
        let sum = 0;
        for (let k = -radius; k <= radius; k++) sum += value(k);
        for (let k = 0; k < n; k++) {
          this.data[at(line, k) + c] = sum / width;
          sum += value(k + radius + 1) - value(k - radius);
        }
      }
    }
  }

  /** Straight-alpha RGBA rows, which is what PNG and ICO both store. */
  rows(): Uint8Array[] {
    const n = this.size;
    return Array.from({ length: n }, (_, y) => {
      const row = new Uint8Array(n * 4);
      for (let x = 0; x < n; x++) {
        const i = (y * n + x) * 4;
        const a = Math.min(1, this.data[i + 3] ?? 0);
        for (let c = 0; c < 3; c++) {
          row[x * 4 + c] = a > 0 ? Math.round(Math.min(1, (this.data[i + c] ?? 0) / a) * 255) : 0;
        }
        row[x * 4 + 3] = Math.round(a * 255);
      }
      return row;
    });
  }
}

/** Where a shape's units land in pixels. */
type Place = { scale: number; offset: number };

/** Draw into a scratch layer, blur it, then lay it down — SVG's `filter` on one element. */
function blurred(canvas: Canvas, sigmaPx: number, draw: (layer: Canvas) => void): void {
  const layer = new Canvas(canvas.size);
  draw(layer);
  layer.blur(sigmaPx);
  canvas.over(layer);
}

function paintFlat(canvas: Canvas, place: Place, light: boolean): void {
  const ramp = light ? RAMP_LIGHT : RAMP_DARK;
  canvas.fill(ring(50, 50, RING.r, RING.width), solid(light ? "#706E77" : "#8C8992"), place);
  BAR_HEIGHTS.forEach((h, n) => {
    canvas.fill(roundRect(barX(n), barY(n), BAR_WIDTH, h, 2.5), solid(ramp[n] ?? "#000000"), place);
  });
  canvas.fill(stroke(WAVE_POINTS, WAVE_HALO), solid(light ? "#EDEAE3" : "#15151B"), place);
  canvas.fill(stroke(WAVE_POINTS, WAVE_WIDTH), solid(light ? "#0B0B0F" : "#EDEAE3"), place);
}

function paintGlass(canvas: Canvas, place: Place): void {
  // The bounding box SVG measures a stroke's gradient in is the geometry's, not the ink's.
  const ringBox: [number, number, number, number] = [
    50 - RING.r,
    50 - RING.r,
    2 * RING.r,
    2 * RING.r,
  ];
  canvas.fill(ring(50, 50, RING.r, RING.width), gradient(ringBox, RING_STOPS, "xy"), place);
  canvas.fill(arc(50, 50, 44.6, Math.PI, Math.PI + 67 / 44.6, 0.9), solid("#FFFFFF", 0.7), place);

  BAR_HEIGHTS.forEach((h, n) => {
    canvas.fill(
      roundRect(barX(n), barY(n), BAR_WIDTH, h, 2.5),
      solid(RAMP_DARK[n] ?? "#000000", barAlpha(n)),
      place,
    );
  });
  BAR_HEIGHTS.forEach((h, n) => {
    const bar = roundRect(barX(n), barY(n), BAR_WIDTH, h, 2.5);
    const box: [number, number, number, number] = [barX(n), barY(n), BAR_WIDTH, h];
    canvas.fill(bar, gradient(box, TUBE_STOPS, "x"), place, tubeOpacity(n));
    canvas.fill(outline(bar, 0.5), solid("#FFFFFF", tubeStroke(n)), place, tubeOpacity(n));
  });

  blurred(canvas, 1.6 * place.scale, (layer) =>
    layer.fill(stroke(WAVE_POINTS, WAVE_HALO), solid("#0B0B0F", 0.85), place),
  );
  blurred(canvas, 3 * place.scale, (layer) =>
    layer.fill(stroke(WAVE_POINTS, 8), solid("#FFFFFF", 0.35), place),
  );
  canvas.fill(
    stroke(WAVE_POINTS, WAVE_WIDTH),
    gradient([16, 27.5, 68, 45], WAVE_STOPS, "xy"),
    place,
  );
  canvas.fill(stroke(WAVE_SPECULAR_POINTS, 1.3), solid("#FFFFFF", 0.9), place);
}

/**
 * The app icon at one size.
 *
 * From 64px up it is brand-kit/starless-app-icon.svg: a glass plate over blurred
 * grey light with the glass mark on top. Below that the filters blur into
 * nothing, so it is the flat grey mark on a plain Night plate — the halo the wave
 * cuts is Night too, so the cut reads as clean. The development build is the
 * light mark on a Bone plate at every size: the opposite of the release from
 * across the desk, and the same drawing.
 */
function renderIcon(size: number, dev: boolean): Uint8Array[] {
  const canvas = new Canvas(size);
  const unit = size / 1024;
  const plateUnits: Place = { scale: unit, offset: 0 };
  const plate = roundRect(0, 0, 1024, 1024, 230);

  if (dev || size < 64) {
    canvas.fill(plate, solid(dev ? "#EDEAE3" : "#15151B"), plateUnits);
    // Bigger in the plate than the glass mark is: at 16px every pixel of mark counts.
    const inset = size * 0.06;
    paintFlat(canvas, { scale: (size - 2 * inset) / 100, offset: inset }, dev);
    return canvas.rows();
  }

  const inside = new Canvas(size);
  inside.fill(plate, solid("#101015"), plateUnits);
  blurred(inside, 90 * unit, (haze) => {
    haze.fill(disc(300, 320, 260), solid("#A8A5AD", 0.55), plateUnits);
    haze.fill(disc(760, 760, 220), solid("#DAD7DD", 0.32), plateUnits);
    haze.fill(disc(740, 260, 170), solid("#55535C", 0.7), plateUnits);
  });
  inside.fill(plate, solid("#FFFFFF", 0.06), plateUnits);
  const sheen: Stop[] = [
    [0, "#FFFFFF", 0.16],
    [0.5, "#FFFFFF", 0],
  ];
  inside.fill(roundRect(0, 0, 1024, 512, 0), gradient([0, 0, 1024, 512], sheen, "y"), plateUnits);
  paintGlass(inside, { scale: (720 / 100) * unit, offset: 152 * unit });
  canvas.over(inside, { shape: plate, place: plateUnits });
  canvas.fill(outline(roundRect(2, 2, 1020, 1020, 228), 4), solid("#FFFFFF", 0.18), plateUnits);
  return canvas.rows();
}

// ---------------------------------------------------------------------------
// PNG
// ---------------------------------------------------------------------------

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of bytes) {
    const table = CRC_TABLE[(c ^ byte) & 0xff];
    if (table === undefined) continue;
    c = table ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/**
 * Adler-32, the checksum zlib stores at the end of its stream.
 *
 * PNG's `IDAT` is a zlib stream, not a raw deflate one — two-byte header, deflate
 * payload, four-byte checksum. `Bun.deflateSync` emits the bare payload, so the
 * wrapper is assembled here; a PNG without it has the right chunks and still
 * renders as nothing.
 */
function adler32(bytes: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (const byte of bytes) {
    a = (a + byte) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

/** Wrap raw deflate in the zlib container PNG expects. */
function zlibWrap(raw: Uint8Array, deflated: Uint8Array): Uint8Array {
  // 0x78 0x9C: deflate, 32K window, default compression. The pair is divisible by
  // 31, which is what makes it a valid zlib header.
  const out = new Uint8Array(2 + deflated.length + 4);
  out[0] = 0x78;
  out[1] = 0x9c;
  out.set(deflated, 2);
  const sum = adler32(raw);
  new DataView(out.buffer).setUint32(out.length - 4, sum);
  return out;
}

/** RGBA rows, filter 0 on every one. */
function encodePng(rows: Uint8Array[], size: number): Uint8Array {
  const raw = new Uint8Array((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    const row = rows[y];
    raw[y * (size * 4 + 1)] = 0;
    if (row) raw.set(row, y * (size * 4 + 1) + 1);
  }

  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, size);
  view.setUint32(4, size);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  // 10..12 stay zero: deflate, adaptive filtering, no interlace.

  const signature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const parts = [
    signature,
    chunk("IHDR", ihdr),
    chunk("IDAT", zlibWrap(raw, new Uint8Array(Bun.deflateSync(raw, { level: 9 })))),
    chunk("IEND", new Uint8Array(0)),
  ];

  const total = parts.reduce((n, p) => n + p.length, 0);
  const png = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    png.set(part, at);
    at += part.length;
  }
  return png;
}

// ---------------------------------------------------------------------------
// Icon and container formats
// ---------------------------------------------------------------------------

/**
 * One ICO entry as a DIB.
 *
 * `RC.EXE` rejects the file outright — `RC2175: not in 3.00 format` — if the
 * small sizes are PNG-encoded, so 16 through 64 have to be real bitmaps. Only the
 * 256 entry may be PNG, which is why an all-PNG ICO passes every image viewer
 * and still fails to build.
 *
 * The trick that makes it fiddly is that a DIB in an icon declares `biHeight`
 * *twice* the picture: the XOR bitmap and the 1-bit AND mask are stored as one
 * bottom-up image, and the mask has to be padded to a 4-byte boundary per row.
 * The mask is derived from the alpha channel — in a 1-bit mask a set bit means
 * *transparent* — so the rounded corners survive instead of being flattened into
 * a square.
 */
function bmpEntry(rows: Uint8Array[], size: number): Uint8Array {
  const xorSize = size * size * 4;
  // One bit per pixel, rounded up to whole bytes, padded to a 4-byte boundary.
  const maskStride = Math.ceil(size / 32) * 4;
  const andSize = maskStride * size;
  const out = new Uint8Array(40 + xorSize + andSize);
  const view = new DataView(out.buffer);

  view.setUint32(0, 40, true); // biSize
  view.setInt32(4, size, true); // biWidth
  view.setInt32(8, size * 2, true); // biHeight — image plus mask
  view.setUint16(12, 1, true); // biPlanes
  view.setUint16(14, 32, true); // biBitCount
  view.setUint32(16, 0, true); // biCompression: BI_RGB
  view.setUint32(20, xorSize + andSize, true); // biSizeImage

  // XOR bitmap: bottom-up, BGRA.
  let at = 40;
  for (let y = size - 1; y >= 0; y--) {
    const row = rows[y];
    if (!row) continue;
    for (let x = 0; x < size; x++) {
      const i = x * 4;
      out[at] = row[i + 2] ?? 0;
      out[at + 1] = row[i + 1] ?? 0;
      out[at + 2] = row[i] ?? 0;
      out[at + 3] = row[i + 3] ?? 0;
      at += 4;
    }
  }

  // AND mask: bottom-up, 1 bit per pixel, a set bit meaning transparent.
  at = 40 + xorSize;
  for (let y = size - 1; y >= 0; y--) {
    const row = rows[y];
    const bits = new Uint8Array(maskStride);
    if (row) {
      for (let x = 0; x < size; x++) {
        const alpha = row[x * 4 + 3] ?? 0;
        if (alpha < 128) bits[x >> 3] = (bits[x >> 3] ?? 0) | (0x80 >> (x & 7));
      }
    }
    out.set(bits, at);
    at += maskStride;
  }

  return out;
}

/**
 * ICO holding bitmap entries, with the 256px one as PNG.
 *
 * A BMP would also be legal at 256 and would break on a handful of older shells,
 * which is precisely the size an app icon spends most of its life at.
 */
function ico(entries: { size: number; data: Uint8Array }[]): Uint8Array {
  const header = new Uint8Array(6);
  const h = new DataView(header.buffer);
  // Every write here is explicitly little-endian. `DataView`'s default is
  // big-endian and the whole file silently comes out byte-swapped — which still
  // looks like a valid ICO to anything that reads it the same wrong way, and
  // then `RC.EXE` rejects it with RC2175 and no useful message. PNG is the
  // opposite convention, which is why only this part needs saying out loud.
  h.setUint16(0, 0, true); // reserved
  h.setUint16(2, 1, true); // type: icon
  h.setUint16(4, entries.length, true);

  const dir = new Uint8Array(16 * entries.length);
  let offset = header.length + dir.length;
  entries.forEach((entry, i) => {
    const d = new DataView(dir.buffer, i * 16, 16);
    d.setUint8(0, entry.size >= 256 ? 0 : entry.size);
    d.setUint8(1, entry.size >= 256 ? 0 : entry.size);
    d.setUint8(2, 0); // palette
    d.setUint8(3, 0); // reserved
    d.setUint16(4, 1, true); // colour planes
    d.setUint16(6, 32, true); // bits per pixel
    d.setUint32(8, entry.data.length, true);
    d.setUint32(12, offset, true);
    offset += entry.data.length;
  });

  const total = offset;
  const out = new Uint8Array(total);
  out.set(header, 0);
  out.set(dir, header.length);
  let at = header.length + dir.length;
  for (const entry of entries) {
    out.set(entry.data, at);
    at += entry.data.length;
  }
  return out;
}

/**
 * ICNS, built only from the PNG-flavoured `ic0N` types.
 *
 * The classic bitmap types (`ic01`…`ic09`) would also be legal and carry no
 * benefit; these are the same images with the alpha channel intact.
 */
function icns(entries: { type: string; data: Uint8Array }[]): Uint8Array {
  const body = entries.map(({ type, data }) => {
    const chunk = new Uint8Array(8 + data.length);
    const view = new DataView(chunk.buffer);
    for (let i = 0; i < 4; i++) chunk[i] = type.charCodeAt(i);
    // ICNS chunk lengths are big-endian, unlike ICO.
    view.setUint32(4, chunk.length);
    chunk.set(data, 8);
    return chunk;
  });

  const total = 8 + body.reduce((n, b) => n + b.length, 0);
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  for (let i = 0; i < 4; i++) out[i] = "icns".charCodeAt(i);
  view.setUint32(4, total);
  let at = 8;
  for (const chunk of body) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

/** The PNG sizes Tauri and Windows actually ask for. */
const PNG_JOBS: [string, number][] = [
  ["32x32.png", 32],
  ["128x128.png", 128],
  ["128x128@2x.png", 256],
  ["icon.png", 512],
  ["Square30x30Logo.png", 30],
  ["Square44x44Logo.png", 44],
  ["Square71x71Logo.png", 71],
  ["Square89x89Logo.png", 89],
  ["Square107x107Logo.png", 107],
  ["Square142x142Logo.png", 142],
  ["Square150x150Logo.png", 150],
  ["Square284x284Logo.png", 284],
  ["Square310x310Logo.png", 310],
  ["StoreLogo.png", 50],
];

const only = process.argv[2];
// Write next door rather than on top. Overwriting `icons/` would be the worst
// version of this idea: a stray run would leave the next release carrying the
// development mark, and nothing about that is visible until someone installs it.
const invert = only === "--invert";
const target = invert ? ICONS_DEV : ICONS;

mkdirSync(target, { recursive: true });
mkdirSync(PUBLIC, { recursive: true });

if (only !== "--icons") {
  // The favicon and anything under 64px take the flat grey; the glass is for the
  // places with room for it. The development page gets the light mark.
  const marks: [string, string][] = invert
    ? [["starless-dev.svg", flatMark(true)]]
    : [
        ["starless.svg", flatMark(false)],
        ["starless-glass.svg", glassMark()],
        ["starless-light.svg", flatMark(true)],
        ["starless-mono.svg", monoMark()],
      ];
  const dirs = invert ? [PUBLIC] : [PUBLIC, SITE_PUBLIC];
  for (const dir of dirs) mkdirSync(dir, { recursive: true });
  for (const [name, body] of marks) {
    for (const dir of dirs) writeFileSync(join(dir, name), body, "utf8");
    console.log(join("public", name));
  }
}

if (only !== "--svg") {
  const cache = new Map<number, Uint8Array[]>();
  const rowsAt = (size: number) => {
    let hit = cache.get(size);
    if (!hit) {
      hit = renderIcon(size, invert);
      cache.set(size, hit);
    }
    return hit;
  };
  const at = (size: number) => encodePng(rowsAt(size), size);

  for (const [name, size] of PNG_JOBS) {
    writeFileSync(join(target, name), at(size));
  }
  console.log(`${PNG_JOBS.length} PNG en ${invert ? "src-tauri/icons-dev" : "src-tauri/icons"}`);

  const icoSizes = [16, 24, 32, 48, 64, 128, 256];
  writeFileSync(
    join(target, "icon.ico"),
    // Every entry is a bitmap, 256 included. A PNG entry at 256 is the modern
    // convention and `RC.EXE` in the bundled Windows SDK still rejects the file
    // with RC2175 for it, which is a build failure with no useful message.
    ico(icoSizes.map((size) => ({ size, data: bmpEntry(rowsAt(size), size) }))),
  );
  console.log(`icon.ico (${icoSizes.join(", ")})`);

  const icnsEntries: [string, number][] = [
    ["ic07", 128],
    ["ic08", 256],
    ["ic09", 512],
    ["ic10", 1024],
    ["ic11", 32],
    ["ic12", 64],
    ["ic13", 256],
    ["ic14", 512],
  ];
  writeFileSync(
    join(target, "icon.icns"),
    icns(icnsEntries.map(([type, size]) => ({ type, data: at(size) }))),
  );
  console.log(`icon.icns (${icnsEntries.length} entradas)`);
}
