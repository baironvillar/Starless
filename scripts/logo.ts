/**
 * Starless's logo, drawn from nothing but maths.
 *
 * A five-pointed star whose points go out to the right — the name is *Starless*,
 * so the mark is a star that is not there anymore. The falloff is a smoothstep
 * along the horizontal axis, which keeps the left points solid and the right ones
 * gone, and reads as a star at 16px rather than as a smudge.
 *
 *   bun run logo          writes public/starless.svg and every app icon
 *   bun run logo:svg      just the vector mark
 *
 * Why this file exists instead of a checked-in PNG: an icon nobody can regenerate
 * is an icon nobody can change. The geometry is ~30 lines, so it stays source.
 *
 * No image library. Bun can deflate, and a star is ten straight lines — so the
 * whole pipeline is point-in-polygon, a smoothstep, and a hand-rolled PNG.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const ICONS = join(ROOT, "src-tauri", "icons");
const PUBLIC = join(ROOT, "public");

/** The palette, from DESIGN.md. Nothing outside these two colours is in the mark. */
const ACCENT = { r: 0xc9, g: 0xf7, b: 0x3c };
const GROUND = { r: 0x0a, g: 0x0a, b: 0x12 };

/** Where the star sits and how far it reaches. */
const RADIUS = 0.4;
/** 0.382 is the pentagram's inner ratio — the classic five-pointed star. */
const INNER_RADIUS = RADIUS * 0.382;

/** Samples per pixel, per axis. 4 keeps the edges clean without being slow. */
const SUPERSAMPLE = 4;

/**
 * The ten corners of the star, first point straight up.
 *
 * Screen coordinates put y downwards, so the `-90°` offset is what makes "up" mean
 * up rather than right.
 */
function starPoints(size: number): [number, number][] {
  const c = size / 2;
  return Array.from({ length: 10 }, (_, i) => {
    const angle = (-90 + i * 36) * (Math.PI / 180);
    const r = (i % 2 === 0 ? RADIUS : INNER_RADIUS) * size;
    return [c + r * Math.cos(angle), c + r * Math.sin(angle)];
  });
}

/** Crossing number: is this point inside the polygon? */
function inside(points: [number, number][], x: number, y: number): boolean {
  let hit = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const from = points[i];
    const to = points[j];
    if (!from || !to) continue;
    const [xi, yi] = from;
    const [xj, yj] = to;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

/**
 * How solid the star is at this x, from 1 down to 0.
 *
 * `smoothstep` rather than a linear ramp because a straight ramp has a visible
 * crease where it crosses the star's middle, and the crease is the one thing that
 * makes a fade look like a mistake.
 *
 * The two cut-offs are the whole design. Starting the falloff too early leaves a
 * five-pixel sliver at full opacity — a star that is barely there anywhere, which
 * is not "going out", it is "was never lit". Holding full opacity to a third of
 * the way across keeps the left points solid enough to read as a star at 16px,
 * and spends the rest of the width dissolving them.
 */
function falloff(t: number): number {
  if (t <= 0.34) return 1;
  if (t >= 0.92) return 0;
  const u = (t - 0.34) / (0.92 - 0.34);
  return 1 - u * u * (3 - 2 * u);
}

/** One row of RGBA, in `size`. `plate` fills the rounded square behind the star. */
function renderRow(size: number, y: number, plate: boolean): Uint8Array {
  const points = starPoints(size);
  const row = new Uint8Array(size * 4);
  const radius = size * 0.22;

  for (let x = 0; x < size; x++) {
    // Plain weighted sums, averaged after the loop.
    //
    // The obvious alternative — accumulating with `prev + a(1-prev)`, the "over"
    // operator — is the wrong tool and it fails silently: that stacks *layers*, so
    // sixteen identical subsamples converge to fully opaque and the fade vanishes
    // entirely. Subsamples are sixteen measurements of one pixel, not sixteen
    // things piled on it, and the arithmetic has to say so.
    let sumR = 0;
    let sumG = 0;
    let sumB = 0;
    let sumA = 0;

    for (let sy = 0; sy < SUPERSAMPLE; sy++) {
      for (let sx = 0; sx < SUPERSAMPLE; sx++) {
        const px = x + (sx + 0.5) / SUPERSAMPLE;
        const py = y + (sy + 0.5) / SUPERSAMPLE;

        // Bottom layer: the plate, or nothing at all.
        let r = 0;
        let g = 0;
        let b = 0;
        let a = 0;

        if (plate) {
          const cx = Math.min(Math.max(px, radius), size - radius);
          const cy = Math.min(Math.max(py, radius), size - radius);
          if (Math.hypot(px - cx, py - cy) <= radius) {
            r = GROUND.r;
            g = GROUND.g;
            b = GROUND.b;
            a = 1;
          }
        }

        // Top layer: the star, as translucent as the fade says it is. Compositing
        // it rather than replacing it is what makes it go *out* — the plate shows
        // through the thinning star instead of the star turning grey on the way.
        if (inside(points, px, py)) {
          const fade = falloff(px / size);
          if (fade > 0) {
            r = ACCENT.r * fade + r * a * (1 - fade);
            g = ACCENT.g * fade + g * a * (1 - fade);
            b = ACCENT.b * fade + b * a * (1 - fade);
            a = fade + a * (1 - fade);
          }
        }

        sumR += r * a;
        sumG += g * a;
        sumB += b * a;
        sumA += a;
      }
    }

    const samples = SUPERSAMPLE * SUPERSAMPLE;
    const o = x * 4;
    row[o] = sumA > 0 ? Math.round(sumR / sumA) : 0;
    row[o + 1] = sumA > 0 ? Math.round(sumG / sumA) : 0;
    row[o + 2] = sumA > 0 ? Math.round(sumB / sumA) : 0;
    row[o + 3] = Math.round((sumA / samples) * 255);
  }
  return row;
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

function png(size: number, plate: boolean): Uint8Array {
  return encodePng(renderRows(size, plate), size);
}

/** The rows once, so both containers can be built from the same pixels. */
function renderRows(size: number, plate: boolean): Uint8Array[] {
  const rows: Uint8Array[] = [];
  for (let y = 0; y < size; y++) rows.push(renderRow(size, y, plate));
  return rows;
}

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
// The mark itself
// ---------------------------------------------------------------------------

/**
 * The vector, as a path.
 *
 * Five points, but the right-hand ones fade to nothing — so the *outline* is the
 * full star and the fill is what dissolves. Keeping the geometry whole means the
 * shape is still a star to anything reading the path rather than the pixels.
 */
function starPath(size: number): string {
  const path = starPoints(size)
    .map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(2)} ${y.toFixed(2)}`)
    .join(" ");
  return `${path} Z`;
}

function svgMark(): string {
  const size = 64;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img" aria-label="Starless">
  <title>Starless</title>
  <defs>
    <!-- The dissolve. Holds full opacity across the left points and lets the
         right-hand ones go, which is the whole idea of the name. -->
    <linearGradient id="fade" x1="0" y1="0" x2="1" y2="0">
      <stop offset="14%" stop-color="#C9F73C" stop-opacity="1" />
      <stop offset="90%" stop-color="#C9F73C" stop-opacity="0" />
    </linearGradient>
    <mask id="fadeMask">
      <rect width="${size}" height="${size}" fill="url(#fade)" />
    </mask>
  </defs>
  <path d="${starPath(size)}" fill="#C9F73C" mask="url(#fadeMask)" />
</svg>
`;
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

mkdirSync(ICONS, { recursive: true });
mkdirSync(PUBLIC, { recursive: true });

if (only !== "--icons") {
  writeFileSync(join(PUBLIC, "starless.svg"), svgMark(), "utf8");
  console.log("public/starless.svg");
}

if (only !== "--svg") {
  const cache = new Map<number, Uint8Array>();
  const at = (size: number) => {
    let hit = cache.get(size);
    if (!hit) {
      hit = png(size, true);
      cache.set(size, hit);
    }
    return hit;
  };

  for (const [name, size] of PNG_JOBS) {
    writeFileSync(join(ICONS, name), at(size));
  }
  console.log(`${PNG_JOBS.length} PNG en src-tauri/icons`);

  const icoSizes = [16, 24, 32, 48, 64, 128, 256];
  writeFileSync(
    join(ICONS, "icon.ico"),
    // Every entry is a bitmap, 256 included. A PNG entry at 256 is the modern
    // convention and `RC.EXE` in the bundled Windows SDK still rejects the file
    // with RC2175 for it, which is a build failure with no useful message.
    ico(icoSizes.map((size) => ({ size, data: bmpEntry(renderRows(size, true), size) }))),
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
    join(ICONS, "icon.icns"),
    icns(icnsEntries.map(([type, size]) => ({ type, data: at(size) }))),
  );
  console.log(`icon.icns (${icnsEntries.length} entradas)`);
}
