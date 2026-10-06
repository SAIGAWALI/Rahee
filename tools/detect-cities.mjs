// Finds city markers on the board plate so their positions can be read straight
// off the artwork instead of being eyeballed.
//
// The printed map uses two marker shapes:
//   - a solid dark disc for an ordinary city
//   - a light disc inside a dark ring, holding a number, for a tourist place
//
//   node detect-cities.mjs <plateDir> [--tiles]
//
// Writes markers.json (candidate positions) and, with --tiles, numbered overlay
// tiles used to attach the printed city names to each candidate.
import fs from "node:fs";
import path from "node:path";
import { decodePNG, encodePNG } from "./png.mjs";

const plateDir = process.argv[2];
const wantTiles = process.argv.includes("--tiles");
const img = decodePNG(fs.readFileSync(path.join(plateDir, "board-plate.png")));
const { width: W, height: H, data } = img;

const lum = new Uint8Array(W * H);
for (let i = 0, n = W * H; i < n; i++)
  lum[i] = (data[i * 4] * 77 + data[i * 4 + 1] * 151 + data[i * 4 + 2] * 28) >> 8;

const DARK = 95;
const dark = new Uint8Array(W * H);
for (let i = 0, n = W * H; i < n; i++) dark[i] = lum[i] < DARK ? 1 : 0;

// Label connected dark components (8-connected), collecting bbox and area.
const label = new Int32Array(W * H).fill(-1);
const comps = [];
const stack = new Int32Array(W * H);
for (let seed = 0, n = W * H; seed < n; seed++) {
  if (!dark[seed] || label[seed] >= 0) continue;
  const id = comps.length;
  const c = { id, x0: W, y0: H, x1: 0, y1: 0, area: 0 };
  let sp = 0;
  stack[sp++] = seed;
  label[seed] = id;
  while (sp) {
    const p = stack[--sp];
    const x = p % W, y = (p / W) | 0;
    c.area++;
    if (x < c.x0) c.x0 = x;
    if (y < c.y0) c.y0 = y;
    if (x > c.x1) c.x1 = x;
    if (y > c.y1) c.y1 = y;
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const q = ny * W + nx;
        if (dark[q] && label[q] < 0) { label[q] = id; stack[sp++] = q; }
      }
  }
  comps.push(c);
}

const markers = [];

// Ordinary city: a solid dark disc. pi/4 = 0.785 box fill for a perfect circle.
for (const c of comps) {
  const w = c.x1 - c.x0 + 1, h = c.y1 - c.y0 + 1;
  if (Math.min(w, h) / Math.max(w, h) < 0.8) continue;
  if (w >= 14 && w <= 30 && h >= 14 && h <= 30 && c.area / (w * h) > 0.68)
    markers.push({ kind: "city", x: (c.x0 + c.x1) / 2, y: (c.y0 + c.y1) / 2, w, h });
}

// Tourist place: a dark ring around a light disc holding a numeral. Connected
// components are unreliable here because rings routinely touch the city label or
// a road, so score every pixel as a candidate centre instead: the ring radius
// must be dark all the way round, and the gap just inside it must be light.
// The ring is a thin mid-grey stroke (luminance ~110-150) over a cream disc
// (~241) on a green ground (~209), so it needs a looser threshold than the
// solid black city dots.
const RADII = [14.5, 15.0], GAP = 11, STEPS = 48, RING_DARK = 175, GAP_LIGHT = 200;
const ringScore = new Float32Array(W * H);
const ringSets = RADII.map((r) => {
  const pts = [];
  for (let k = 0; k < STEPS; k++) {
    const a = (k / STEPS) * 2 * Math.PI;
    pts.push([Math.round(r * Math.cos(a)), Math.round(r * Math.sin(a))]);
  }
  return pts;
});
const gapPts = [];
for (let k = 0; k < STEPS; k++) {
  const a = (k / STEPS) * 2 * Math.PI;
  gapPts.push([Math.round(GAP * Math.cos(a)), Math.round(GAP * Math.sin(a))]);
}
const MARGIN = Math.ceil(Math.max(...RADII)) + 1;
for (let y = MARGIN; y < H - MARGIN; y++)
  for (let x = MARGIN; x < W - MARGIN; x++) {
    let onRing = 0;
    for (const pts of ringSets) {
      let n = 0;
      for (const [dx, dy] of pts) if (lum[(y + dy) * W + x + dx] < RING_DARK) n++;
      if (n > onRing) onRing = n;
    }
    if (onRing < STEPS * 0.78) continue;
    let inGap = 0;
    for (const [dx, dy] of gapPts) if (lum[(y + dy) * W + x + dx] > GAP_LIGHT) inGap++;
    if (inGap < STEPS * 0.5) continue;
    // Interior purity: a real marker holds only the cream disc and the dark
    // numeral. Decorative artwork (foliage, vehicles) has saturated colour there
    // and produces most of the false ring hits.
    let pure = 0, seen = 0;
    for (let dy = -9; dy <= 9; dy++)
      for (let dx = -9; dx <= 9; dx++) {
        if (dx * dx + dy * dy > 81) continue;
        const d = ((y + dy) * W + x + dx) * 4;
        const r = data[d], g = data[d + 1], b = data[d + 2];
        seen++;
        // Cream paper and dark ink are both near-neutral; map artwork is not.
        if (Math.max(r, g, b) - Math.min(r, g, b) < 52) pure++;
      }
    if (pure / seen < 0.9) continue;
    ringScore[y * W + x] = onRing / STEPS + inGap / STEPS + pure / seen;
  }
// Non-maximum suppression: keep the best centre in each neighbourhood.
for (let y = 0; y < H; y++)
  for (let x = 0; x < W; x++) {
    const s = ringScore[y * W + x];
    if (!s) continue;
    let best = true;
    for (let dy = -MARGIN; dy <= MARGIN && best; dy++)
      for (let dx = -MARGIN; dx <= MARGIN; dx++) {
        const q = (y + dy) * W + x + dx;
        if (q < 0 || q >= W * H) continue;
        if (ringScore[q] > s || (ringScore[q] === s && q < y * W + x)) { best = false; break; }
      }
    if (best) markers.push({ kind: "tourist", x, y, w: 29, h: 29 });
  }

// The ring detector can fire twice on one marker (outer ring + inner outline).
markers.sort((a, b) => a.y - b.y || a.x - b.x);
const kept = [];
for (const m of markers) {
  const dup = kept.find((k) => Math.hypot(k.x - m.x, k.y - m.y) < 16);
  if (dup) { if (m.kind === "tourist") { dup.kind = "tourist"; dup.x = m.x; dup.y = m.y; dup.w = m.w; dup.h = m.h; } continue; }
  kept.push(m);
}
kept.sort((a, b) => a.y - b.y || a.x - b.x);
kept.forEach((m, i) => { m.i = i; m.x = Math.round(m.x); m.y = Math.round(m.y); });

console.log(`${comps.length} dark components -> ${kept.length} markers ` +
  `(${kept.filter((m) => m.kind === "tourist").length} tourist, ${kept.filter((m) => m.kind === "city").length} plain)`);
fs.writeFileSync(path.join(plateDir, "markers.json"), JSON.stringify(kept, null, 1));

if (!wantTiles) process.exit(0);

// ---- Debug tiles: the plate, each marker ringed and captioned with its index ----
const FONT = { // 3x5 bitmaps, rows top to bottom, bit 2 = leftmost pixel
  0: [7, 5, 5, 5, 7], 1: [2, 6, 2, 2, 7], 2: [7, 1, 7, 4, 7], 3: [7, 1, 7, 1, 7],
  4: [5, 5, 7, 1, 1], 5: [7, 4, 7, 1, 7], 6: [7, 4, 7, 5, 7], 7: [7, 1, 1, 1, 1],
  8: [7, 5, 7, 5, 7], 9: [7, 5, 7, 1, 7],
};
const put = (o, x, y, r, g, b) => {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const d = (y * W + x) * 4;
  o[d] = r; o[d + 1] = g; o[d + 2] = b;
};
const out = Buffer.from(data);
for (const m of kept) {
  const [r, g, b] = m.kind === "tourist" ? [255, 0, 255] : [255, 0, 0];
  for (let a = 0; a < 360; a += 2) {           // ring around the marker
    const rad = (a * Math.PI) / 180;
    for (const rr of [17, 18]) put(out, Math.round(m.x + rr * Math.cos(rad)), Math.round(m.y + rr * Math.sin(rad)), r, g, b);
  }
  const s = String(m.i), scale = 3;            // index caption, above-left
  const bx = Math.round(m.x) - s.length * 2 * scale, by = Math.round(m.y) - 19 - 5 * scale;
  for (let dy = -1; dy <= 5 * scale; dy++)     // white plate behind the digits
    for (let dx = -1; dx <= s.length * 4 * scale; dx++) put(out, bx + dx, by + dy, 255, 255, 255);
  for (let ci = 0; ci < s.length; ci++) {
    const rows = FONT[s[ci]];
    for (let ry = 0; ry < 5; ry++)
      for (let rx = 0; rx < 3; rx++)
        if (rows[ry] & (1 << (2 - rx)))
          for (let sy = 0; sy < scale; sy++)
            for (let sx = 0; sx < scale; sx++) put(out, bx + (ci * 4 + rx) * scale + sx, by + ry * scale + sy, 0, 0, 160);
  }
}

const COLS = 3, ROWS = 4, tw = Math.ceil(W / COLS), th = Math.ceil(H / ROWS);
const tileDir = path.join(plateDir, "verify", "tiles");
fs.mkdirSync(tileDir, { recursive: true });
for (let ty = 0; ty < ROWS; ty++)
  for (let tx = 0; tx < COLS; tx++) {
    const x0 = tx * tw, y0 = ty * th;
    const w = Math.min(tw, W - x0), h = Math.min(th, H - y0);
    const tile = { width: w, height: h, data: Buffer.alloc(w * h * 4) };
    for (let y = 0; y < h; y++) out.copy(tile.data, y * w * 4, ((y0 + y) * W + x0) * 4, ((y0 + y) * W + x0 + w) * 4);
    fs.writeFileSync(path.join(tileDir, `tile-r${ty}c${tx}.png`), encodePNG(tile));
  }
console.log(`tiles/ ${COLS}x${ROWS} written`);
