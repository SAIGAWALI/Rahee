// Traces the printed road network on the board plate into a city adjacency list.
//
//   node trace-routes.mjs <plateDir> <citiesTsv> [--debug]
//
// The printed roads are a flat brown ribbon. From every city we find the
// directions in which a road leaves, then walk each one along the ribbon centre
// until it arrives at another city, stepping over the vehicle and tree artwork
// that is drawn on top of the roads.
import fs from "node:fs";
import path from "node:path";
import { decodePNG, encodePNG } from "./png.mjs";

const plateDir = process.argv[2];
const citiesTsv = process.argv[3];
const debug = process.argv.includes("--debug");
const debugDir = path.join(plateDir, "verify");
if (debug) fs.mkdirSync(debugDir, { recursive: true });

const { width: W, height: H, data } = decodePNG(fs.readFileSync(path.join(plateDir, "board-plate.png")));

const cities = fs.readFileSync(citiesTsv, "utf8").trim().split("\n").slice(1).map((line) => {
  const [id, name, state, x, y, tourist, attraction] = line.split("\t");
  return { id, name, state, x: +x, y: +y, tourist: tourist ? +tourist : null, attraction: attraction || null };
});

// ---- Road mask -------------------------------------------------------------
// The road ribbon is a desaturated brown; the land behind it is green or khaki.
const road = new Uint8Array(W * H);
for (let i = 0, n = W * H; i < n; i++) {
  const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
  if (r > g && g > b && r - b >= 34 && r >= 150 && r <= 230 && g >= 125 && g <= 205 && b >= 95 && b <= 170)
    road[i] = 1;
}

if (debug) {
  const out = { width: W, height: H, data: Buffer.alloc(W * H * 4) };
  for (let i = 0, n = W * H; i < n; i++) {
    const v = road[i] ? 0 : 255;
    out.data[i * 4] = road[i] ? 200 : data[i * 4] * 0.35 + 160;
    out.data[i * 4 + 1] = v ? data[i * 4 + 1] * 0.35 + 160 : 40;
    out.data[i * 4 + 2] = v ? data[i * 4 + 2] * 0.35 + 160 : 40;
    out.data[i * 4 + 3] = 255;
  }
  fs.writeFileSync(path.join(debugDir, "dbg-roadmask.png"), encodePNG(out));
  console.log("dbg-roadmask.png written");
}

// ---- Airports --------------------------------------------------------------
// Flight hubs are marked with a solid blue aeroplane glyph next to the city.
const plane = new Uint8Array(W * H);
for (let i = 0, n = W * H; i < n; i++) {
  const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
  if (b > 130 && b - r > 55 && b - g > 45) plane[i] = 1;
}
const seen = new Uint8Array(W * H);
const blobs = [];
const st = new Int32Array(W * H);
for (let s = 0, n = W * H; s < n; s++) {
  if (!plane[s] || seen[s]) continue;
  let sp = 0, area = 0, sx = 0, sy = 0, x0 = W, y0 = H, x1 = 0, y1 = 0;
  st[sp++] = s; seen[s] = 1;
  while (sp) {
    const p = st[--sp], x = p % W, y = (p / W) | 0;
    area++; sx += x; sy += y;
    if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y;
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const q = ny * W + nx;
        if (plane[q] && !seen[q]) { seen[q] = 1; st[sp++] = q; }
      }
  }
  const w = x1 - x0 + 1, h = y1 - y0 + 1;
  if (area > 220 && area < 2600 && w > 24 && w < 90 && h > 16 && h < 70) blobs.push({ x: sx / area, y: sy / area, area });
}
const airports = new Set();
for (const b of blobs) {
  let best = null;
  for (const c of cities) {
    const d = Math.hypot(c.x - b.x, c.y - b.y);
    if (!best || d < best.d) best = { c, d };
  }
  if (best && best.d < 90) airports.add(best.c.id);
}
console.log(`airports (${airports.size}): ${[...airports].join(", ")}`);

// ---- Route tracing ---------------------------------------------------------
const CITY_R = 21;          // ignore road pixels this close to a marker centre
const START_R = 26;         // ring on which a departing road is first sampled
const STEP = 4;             // walk length per iteration
const MAX_JUMP = 70;        // how far to coast across artwork drawn over a road
const ARRIVE_JUMP = 30;     // ...but only a short coast may end at a city, so that
                            // a blind jump cannot invent a road across open land
const ARRIVE_R = 24;        // distance at which we count as having arrived

const cityAt = (x, y, notId) => {
  for (const c of cities) {
    if (c.id === notId) continue;
    if (Math.hypot(c.x - x, c.y - y) < ARRIVE_R) return c;
  }
  return null;
};
const isRoad = (x, y) => x >= 0 && y >= 0 && x < W && y < H && road[(y | 0) * W + (x | 0)] === 1;

// Road density in a small disc, used to re-centre the walk on the ribbon.
const density = (x, y, r) => {
  let n = 0, t = 0;
  for (let dy = -r; dy <= r; dy++)
    for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dy * dy > r * r) continue;
      t++;
      if (isRoad(x + dx, y + dy)) n++;
    }
  return t ? n / t : 0;
};

function departures(c) {
  // Angles at which road pixels cross the START_R ring, grouped into runs.
  const hit = [];
  const N = 360;
  for (let k = 0; k < N; k++) {
    const a = (k / N) * 2 * Math.PI;
    let on = false;
    for (let r = START_R - 4; r <= START_R + 4; r++)
      if (isRoad(c.x + r * Math.cos(a), c.y + r * Math.sin(a))) { on = true; break; }
    hit.push(on);
  }
  const runs = [];
  let k = 0;
  while (k < N && hit[k]) k++;            // start scanning from a gap
  if (k === N) return [];                 // fully surrounded: nothing to split
  for (let n = 0; n < N; n++) {
    const i = (k + n) % N;
    if (!hit[i]) continue;
    let len = 0;
    while (len < N && hit[(i + len) % N]) len++;
    runs.push(((i + len / 2) % N) * (Math.PI * 2 / N));
    n += len;
  }
  return runs;
}

function walk(from, angle) {
  let x = from.x + START_R * Math.cos(angle), y = from.y + START_R * Math.sin(angle);
  let dx = Math.cos(angle), dy = Math.sin(angle);
  const trail = [[x, y]];
  for (let iter = 0; iter < 500; iter++) {
    // Choose the heading within +/-40 degrees that keeps the most road under it.
    let best = null;
    for (let t = -40; t <= 40; t += 4) {
      const a = Math.atan2(dy, dx) + (t * Math.PI) / 180;
      const nx = x + STEP * Math.cos(a), ny = y + STEP * Math.sin(a);
      if (!isRoad(nx, ny)) continue;
      const score = density(nx, ny, 5) - Math.abs(t) / 400;
      if (!best || score > best.score) best = { score, a, nx, ny };
    }
    if (!best) {
      // Artwork over the road: coast straight ahead and try to pick it up again.
      let found = null;
      for (let j = STEP; j <= MAX_JUMP; j += 2) {
        const nx = x + j * dx, ny = y + j * dy;
        if (j <= ARRIVE_JUMP) {
          const c = cityAt(nx, ny, from.id);
          if (c) return { city: c, trail };
        }
        if (isRoad(nx, ny) && density(nx, ny, 5) > 0.5) { found = { nx, ny }; break; }
      }
      if (!found) return { city: null, trail };
      x = found.nx; y = found.ny;
    } else {
      dx = Math.cos(best.a); dy = Math.sin(best.a);
      x = best.nx; y = best.ny;
    }
    trail.push([x, y]);
    const c = cityAt(x, y, from.id);
    if (c) return { city: c, trail };
  }
  return { city: null, trail };
}

// Ramer-Douglas-Peucker, so a route keeps the shape of the printed road without
// carrying hundreds of points into the board data.
function simplify(pts, eps) {
  if (pts.length < 3) return pts;
  let far = 0, dmax = 0;
  const [ax, ay] = pts[0], [bx, by] = pts[pts.length - 1];
  const len = Math.hypot(bx - ax, by - ay) || 1;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = Math.abs((bx - ax) * (ay - pts[i][1]) - (ax - pts[i][0]) * (by - ay)) / len;
    if (d > dmax) { dmax = d; far = i; }
  }
  if (dmax <= eps) return [pts[0], pts[pts.length - 1]];
  return [...simplify(pts.slice(0, far + 1), eps).slice(0, -1), ...simplify(pts.slice(far), eps)];
}

const edges = new Map();
const trails = [];
for (const c of cities) {
  for (const a of departures(c)) {
    const { city, trail } = walk(c, a);
    trails.push(trail);
    if (!city) continue;
    const key = [c.id, city.id].sort().join("|");
    const [from, to] = key.split("|");
    // Store the walk oriented from -> to so the polyline can be drawn directly.
    const path = c.id === from ? trail : trail.slice().reverse();
    const full = c.id === from
      ? [[c.x, c.y], ...path, [city.x, city.y]]
      : [[city.x, city.y], ...path, [c.x, c.y]];
    const e = edges.get(key);
    if (!e) edges.set(key, { from, to, hits: 1, path: full });
    // Keep the walk that actually followed the road, not a shortcut.
    else { e.hits++; if (full.length > e.path.length) e.path = full; }
  }
}
const list = [...edges.values()]
  .sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to))
  .map((e) => ({ ...e, path: simplify(e.path, 2.5).map(([x, y]) => [Math.round(x), Math.round(y)]) }));
console.log(`${list.length} routes traced (${list.filter((e) => e.hits > 1).length} confirmed from both ends)`);

// The opposite error to a missing road: a route whose path does not actually lie
// on the printed ribbon, which would mean the walk cut across open land.
const offRoad = [];
const TRIM = 26;   // city markers are not road-coloured, so ignore both ends
for (const e of list) {
  const pts = [];
  for (let i = 0; i < e.path.length - 1; i++) {
    const [x0, y0] = e.path[i], [x1, y1] = e.path[i + 1];
    const n = Math.max(1, Math.round(Math.hypot(x1 - x0, y1 - y0) / 4));
    for (let k = 0; k < n; k++) pts.push([x0 + ((x1 - x0) * k) / n, y0 + ((y1 - y0) * k) / n]);
  }
  pts.push(e.path[e.path.length - 1]);
  const a = e.path[0], b = e.path[e.path.length - 1];
  const middle = pts.filter(([x, y]) => Math.hypot(x - a[0], y - a[1]) > TRIM && Math.hypot(x - b[0], y - b[1]) > TRIM);
  if (middle.length < 3) continue;   // too short to judge
  const on = middle.filter(([x, y]) => density(x, y, 6) > 0.35).length;
  const frac = on / middle.length;
  if (frac < 0.8) offRoad.push({ e, frac });
}
offRoad.sort((a, b) => a.frac - b.frac);
console.log(`routes not following the printed road: ${offRoad.length}`);
for (const o of offRoad.slice(0, 15))
  console.log(`  ${(o.frac * 100).toFixed(0)}% on road  ${o.e.from} -- ${o.e.to} (hits ${o.e.hits})`);
fs.writeFileSync(path.join(plateDir, "routes-traced.json"), JSON.stringify(
  { airports: [...airports], routes: list }, null, 1));

if (debug) {
  // Verification overlay: the derived graph drawn back over a faded plate, so a
  // route that wandered onto the wrong road is visible at a glance.
  const v = Buffer.alloc(W * H * 4);
  for (let i = 0, n = W * H; i < n; i++) {
    v[i * 4] = 60 + data[i * 4] * 0.72;
    v[i * 4 + 1] = 60 + data[i * 4 + 1] * 0.72;
    v[i * 4 + 2] = 60 + data[i * 4 + 2] * 0.72;
    v[i * 4 + 3] = 255;
  }
  const dot = (x, y, r, g, b, rad) => {
    for (let dy = -rad; dy <= rad; dy++)
      for (let dx = -rad; dx <= rad; dx++) {
        if (dx * dx + dy * dy > rad * rad) continue;
        const px = (x | 0) + dx, py = (y | 0) + dy;
        if (px < 0 || py < 0 || px >= W || py >= H) continue;
        const d = (py * W + px) * 4;
        v[d] = r; v[d + 1] = g; v[d + 2] = b;
      }
  };
  for (const e of list) {
    const [r, g, b] = e.hits > 1 ? [200, 20, 90] : [255, 150, 0];
    for (let i = 0; i < e.path.length - 1; i++) {
      const [x0, y0] = e.path[i], [x1, y1] = e.path[i + 1];
      const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0));
      for (let k = 0; k <= n; k++) dot(x0 + ((x1 - x0) * k) / n, y0 + ((y1 - y0) * k) / n, r, g, b, 2);
    }
  }
  for (const c of cities) dot(c.x, c.y, c.tourist ? 255 : 255, c.tourist ? 255 : 255, c.tourist ? 0 : 255, 7);
  fs.writeFileSync(path.join(debugDir, "dbg-graph.png"), encodePNG({ width: W, height: H, data: v }));
  console.log("dbg-graph.png written");

  // Coverage check: any printed road the traced graph does not account for is a
  // missing route. Paint the uncovered stretches so they can be read off.
  const covered = new Uint8Array(W * H);
  const paint = (x, y, r) => {
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy > r * r) continue;
        const px = (x | 0) + dx, py = (y | 0) + dy;
        if (px >= 0 && py >= 0 && px < W && py < H) covered[py * W + px] = 1;
      }
  };
  for (const e of list) {
    if (e.type === "flight") continue;
    for (let i = 0; i < e.path.length - 1; i++) {
      const [x0, y0] = e.path[i], [x1, y1] = e.path[i + 1];
      const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0));
      for (let k = 0; k <= n; k++) paint(x0 + ((x1 - x0) * k) / n, y0 + ((y1 - y0) * k) / n, 11);
    }
  }
  for (const c of cities) paint(c.x, c.y, 22);

  const gap = new Uint8Array(W * H);
  for (let i = 0, n = W * H; i < n; i++) if (road[i] && !covered[i]) gap[i] = 1;
  // Only report gaps that form a substantial blob, not stray brown speckle.
  const gseen = new Uint8Array(W * H);
  const blobsOut = [];
  for (let s0 = 0, n = W * H; s0 < n; s0++) {
    if (!gap[s0] || gseen[s0]) continue;
    let sp = 0, area = 0, sx = 0, sy = 0, x0 = W, y0 = H, x1 = 0, y1 = 0;
    st[sp++] = s0; gseen[s0] = 1;
    while (sp) {
      const q = st[--sp], x = q % W, y = (q / W) | 0;
      area++; sx += x; sy += y;
      if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y;
      for (let dy = -2; dy <= 2; dy++)
        for (let dx = -2; dx <= 2; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          const qq = ny * W + nx;
          if (gap[qq] && !gseen[qq]) { gseen[qq] = 1; st[sp++] = qq; }
        }
    }
    if (area > 450 && Math.max(x1 - x0, y1 - y0) > 40) blobsOut.push({ x: Math.round(sx / area), y: Math.round(sy / area), area, box: [x0, y0, x1, y1] });
  }
  blobsOut.sort((a, b) => b.area - a.area);
  console.log(`uncovered road blobs: ${blobsOut.length}`);
  for (const b of blobsOut.slice(0, 25)) {
    const near = cities.map((c) => ({ c, d: Math.hypot(c.x - b.x, c.y - b.y) })).sort((p, q) => p.d - q.d).slice(0, 3);
    console.log(`  ~${b.x},${b.y} area=${b.area} near ${near.map((n) => `${n.c.id}(${Math.round(n.d)})`).join(" ")}`);
  }
  const g2 = Buffer.from(v);
  for (let i = 0, n = W * H; i < n; i++) if (gseen[i] && gap[i]) { g2[i * 4] = 255; g2[i * 4 + 1] = 30; g2[i * 4 + 2] = 30; }
  fs.writeFileSync(path.join(debugDir, "dbg-gaps.png"), encodePNG({ width: W, height: H, data: g2 }));
  console.log("dbg-gaps.png written");
}

if (debug) {
  const out = Buffer.from(data);
  const put = (x, y, r, g, b) => {
    x |= 0; y |= 0;
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const d = (y * W + x) * 4;
    out[d] = r; out[d + 1] = g; out[d + 2] = b;
  };
  for (const t of trails) for (const [x, y] of t) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) put(x + dx, y + dy, 255, 0, 255);
  for (const c of cities) for (let a = 0; a < 360; a += 2) {
    const r = (a * Math.PI) / 180;
    for (const rr of [CITY_R, CITY_R + 1]) put(c.x + rr * Math.cos(r), c.y + rr * Math.sin(r), 0, 90, 255);
  }
  fs.writeFileSync(path.join(debugDir, "dbg-trails.png"), encodePNG({ width: W, height: H, data: out }));
  console.log("dbg-trails.png written");
}
