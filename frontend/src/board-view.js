// The board: the printed plate with a thin interaction layer drawn over it.
//
// The artwork already shows the cities and the roads, so this layer deliberately
// adds only what the paper cannot: which steps are legal right now, where each
// traveller is, which places this player has visited, and which cities are their
// destination goals.
const NS = "http://www.w3.org/2000/svg";
// Pawn size multiplier (1 = original). Professor asked us to trial bigger pieces.
const PAWN_SCALE = 1.35;

const el = (name, attrs = {}) => {
  const n = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  return n;
};

/** Darkens a #rrggbb colour by factor k (0..1). */
export function shade(hex, k) {
  const n = parseInt(hex.slice(1), 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => Math.round(v * k));
  return `#${c.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

/** The marker cube from the printed set, drawn isometrically in a player's colour. */
export function cube(x, y, colour, s = 9) {
  const g = el("g", { transform: `translate(${x},${y})` });
  const h = s * 0.58, d = s * 1.15;
  const face = (pts, fill) => el("path", { d: `M${pts.join(" L")} Z`, fill, stroke: "#20444c", "stroke-width": 1.1, "stroke-linejoin": "round" });
  g.append(face([`0,${-2 * h}`, `${s},${-h}`, "0,0", `${-s},${-h}`], colour));
  g.append(face([`${-s},${-h}`, "0,0", `0,${d}`, `${-s},${d - h}`], shade(colour, 0.5)));
  g.append(face([`${s},${-h}`, "0,0", `0,${d}`, `${s},${d - h}`], shade(colour, 0.78)));
  return g;
}

export function createBoardView(host, board, handlers = {}) {
  host.innerHTML = "";
  const { width: W, height: H } = board.plate;

  const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: "xMidYMid meet" });
  svg.style.cursor = "grab";
  const defs = el("defs");
  defs.innerHTML = `
    <filter id="tokenShadow" x="-60%" y="-60%" width="220%" height="220%">
      <feDropShadow dx="0" dy="2.5" stdDeviation="2.5" flood-color="#2f3640" flood-opacity="0.45"/>
    </filter>
    <filter id="softGlow" x="-70%" y="-70%" width="240%" height="240%">
      <feDropShadow dx="0" dy="0" stdDeviation="5" flood-color="#ffffff" flood-opacity="0.95"/>
    </filter>`;
  svg.append(defs);

  const world = el("g");
  const image = el("image", { href: board.plate.image, x: 0, y: 0, width: W, height: H });
  image.setAttributeNS("http://www.w3.org/1999/xlink", "href", board.plate.image);
  const gRoutes = el("g");
  const gLive = el("g");     // legal steps + the path walked this turn
  const gRings = el("g");
  const gTokens = el("g");
  const gHit = el("g");
  world.append(image, gRoutes, gLive, gRings, gTokens, gHit);
  svg.append(world);
  host.append(svg);

  const tip = document.createElement("div");
  tip.className = "tipbox";
  tip.hidden = true;
  host.append(tip);

  const cityById = new Map(board.cities.map((c) => [c.id, c]));
  const pathOf = (r) => (r.path || [[cityById.get(r.from).x, cityById.get(r.from).y], [cityById.get(r.to).x, cityById.get(r.to).y]])
    .map(([x, y]) => `${x},${y}`).join(" ");

  // --- static layer: a faint sheen along every road, so the graph the engine
  // uses is visibly the same network the artwork draws.
  for (const r of board.routes) {
    if (r.type !== "road") continue;
    gRoutes.append(el("polyline", {
      points: pathOf(r), fill: "none", stroke: "#4a3b22", "stroke-opacity": ".14",
      "stroke-width": 3.5, "stroke-linecap": "round", "stroke-linejoin": "round",
    }));
  }

  // --- hit targets, one per city.
  // These carry the hover tooltip only. Selecting a city is resolved on pointer
  // up against the map coordinates instead of by a DOM click, because panning
  // takes pointer capture and a captured pointer never delivers a click to the
  // element underneath it.
  const hits = new Map();
  for (const c of board.cities) {
    const h = el("circle", { cx: c.x, cy: c.y, r: 20, fill: "transparent", "pointer-events": "all", "data-city": c.id });
    h.style.cursor = "pointer";
    h.addEventListener("pointerenter", () => showTip(c));
    h.addEventListener("pointerleave", () => { tip.hidden = true; });
    gHit.append(h);
    hits.set(c.id, h);
  }

  let hoverInfo = () => null;
  // Hovering a tourist place shows its stamp (the artwork from the printed
  // stamp column) above the usual facts. Stamps are preloaded once the board
  // is idle so the first hover doesn't pop in empty.
  function showTip(c) {
    const extra = hoverInfo(c.id);
    tip.className = `tipbox${c.stamp ? " has-stamp" : ""}`;
    tip.innerHTML =
      `${c.stamp ? `<img class="stamp" src="${c.stamp}" alt="Stamp ${c.tourist}: ${c.name}" width="200" height="160">` : ""}` +
      `<div class="tipbody">${c.tourist ? `<span class="n">${c.tourist}</span> ` : ""}<b>${c.name}</b>` +
      `${c.attraction ? `<div class="sub">${c.attraction}</div>` : ""}` +
      `${c.airport ? `<div class="sub">✈ airport</div>` : ""}` +
      `${extra ? `<div class="sub extra">${extra}</div>` : ""}</div>`;
    tip.hidden = false;
    const p = toScreen(c.x, c.y);
    const hostBox = host.getBoundingClientRect();
    const tipH = c.stamp ? 250 : 90;
    const below = p.y - 14 - tipH < 56; // too close to the top bar: open below the city instead
    const half = (c.stamp ? 216 : 140) / 2;
    tip.style.left = `${Math.max(half + 6, Math.min(hostBox.width - half - 6, p.x))}px`;
    tip.style.top = below ? `${p.y + 18}px` : `${p.y - 14}px`;
    tip.style.transform = below ? "translate(-50%,0)" : "translate(-50%,-100%)";
  }
  const preload = () => { for (const c of board.cities) if (c.stamp) { const i = new Image(); i.src = c.stamp; } };
  (window.requestIdleCallback || ((f) => setTimeout(f, 1500)))(preload);

  // --- pan and zoom -------------------------------------------------------
  const view = { x: 0, y: 0, w: W, h: H };
  const MIN_W = 380, MAX_W = W * 1.15;
  let viewQueued = false;
  const applyView = () => {
    svg.setAttribute("viewBox", `${view.x} ${view.y} ${view.w} ${view.h}`);
    // Tell whoever is listening (the left map panel's viewport box), at most once a frame.
    if (handlers.onViewChange && !viewQueued) {
      viewQueued = true;
      requestAnimationFrame(() => { viewQueued = false; handlers.onViewChange(visibleRect()); });
    }
  };
  /** The part of the board actually on screen, in board coordinates (the viewBox letterboxes). */
  function visibleRect(coveredLeftPx = 0) {
    const b = box(), s = fit();
    if (!b.width || !s) return { x: view.x, y: view.y, w: view.w, h: view.h };
    const w = b.width / s, h = b.height / s;
    const cut = Math.min(coveredLeftPx, b.width * 0.8) / s;
    return { x: view.x - (w - view.w) / 2 + cut, y: view.y - (h - view.h) / 2, w: w - cut, h };
  }

  function box() { return svg.getBoundingClientRect(); }
  // The viewBox letterboxes inside the element, so screen<->world needs the scale.
  function fit() {
    const b = box();
    return Math.min(b.width / view.w, b.height / view.h);
  }
  function toScreen(wx, wy) {
    const b = box(), s = fit();
    return {
      x: (wx - view.x) * s + (b.width - view.w * s) / 2,
      y: (wy - view.y) * s + (b.height - view.h * s) / 2,
    };
  }
  function toWorld(cx, cy) {
    const b = box(), s = fit();
    return {
      x: (cx - b.left - (b.width - view.w * s) / 2) / s + view.x,
      y: (cy - b.top - (b.height - view.h * s) / 2) / s + view.y,
    };
  }
  function clamp() {
    view.w = Math.max(MIN_W, Math.min(MAX_W, view.w));
    view.h = view.w * (H / W);
    view.x = Math.max(-W * 0.15, Math.min(W * 1.15 - view.w, view.x));
    view.y = Math.max(-H * 0.15, Math.min(H * 1.15 - view.h, view.y));
  }
  function zoomBy(factor, anchorClient) {
    const b = box();
    const a = anchorClient ?? { x: b.left + b.width / 2, y: b.top + b.height / 2 };
    const before = toWorld(a.x, a.y);
    view.w /= factor;
    clamp();
    const after = toWorld(a.x, a.y);
    view.x += before.x - after.x;
    view.y += before.y - after.y;
    clamp();
    applyView();
  }

  svg.addEventListener("wheel", (e) => {
    e.preventDefault();
    zoomBy(Math.exp(-e.deltaY * 0.0016), { x: e.clientX, y: e.clientY });
  }, { passive: false });

  /** The city under a screen point, if one is close enough to have been aimed at. */
  function cityAtScreen(clientX, clientY) {
    const w = toWorld(clientX, clientY);
    const reach = Math.min(46, Math.max(18, 24 / fit()));
    let best = null;
    for (const c of board.cities) {
      const d = Math.hypot(c.x - w.x, c.y - w.y);
      if (d <= reach && (!best || d < best.d)) best = { c, d };
    }
    return best?.c ?? null;
  }

  // Pointer capture is taken only once a drag actually starts, so a plain click
  // still lands, and the click itself is resolved on pointer up.
  const DRAG_SLOP = 4;
  let drag = null;
  svg.addEventListener("pointerdown", (e) => {
    if (e.button !== undefined && e.button !== 0) return;
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY, vx: view.x, vy: view.y, moved: false, captured: false };
  });
  svg.addEventListener("pointermove", (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    if (!drag.moved) {
      if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < DRAG_SLOP) return;
      drag.moved = true;
      tip.hidden = true;
      svg.style.cursor = "grabbing";
      try { svg.setPointerCapture(e.pointerId); drag.captured = true; } catch { /* capture is optional */ }
    }
    const s = fit();
    view.x = drag.vx - (e.clientX - drag.x) / s;
    view.y = drag.vy - (e.clientY - drag.y) / s;
    clamp();
    applyView();
  });
  const endDrag = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const tapped = !drag.moved;
    if (drag.captured) { try { svg.releasePointerCapture(e.pointerId); } catch { /* pointer already gone */ } }
    drag = null;
    svg.style.cursor = "grab";
    if (tapped && e.type === "pointerup") {
      const c = cityAtScreen(e.clientX, e.clientY);
      if (c) handlers.onCityClick?.(c.id);
    }
  };
  svg.addEventListener("pointerup", endDrag);
  svg.addEventListener("pointercancel", endDrag);

  function focusOn(cityId, { zoom = 720, animate = true } = {}) {
    const c = cityById.get(cityId);
    if (!c) return;
    const target = { w: Math.min(view.w, zoom) };
    target.h = target.w * (H / W);
    target.x = c.x - target.w / 2;
    target.y = c.y - target.h / 2;
    if (!animate) { Object.assign(view, target); clamp(); applyView(); return; }
    const from = { ...view }, t0 = performance.now(), dur = 420;
    const tick = (now) => {
      const k = Math.min(1, (now - t0) / dur);
      const e = 1 - Math.pow(1 - k, 3);
      view.w = from.w + (target.w - from.w) * e;
      view.h = view.w * (H / W);
      view.x = from.x + (target.x - from.x) * e;
      view.y = from.y + (target.y - from.y) * e;
      clamp();
      applyView();
      if (k < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }
  /** Centres the board on a board-coordinate point without changing the zoom. */
  function centreOn({ x, y }) {
    view.x = x - view.w / 2; view.y = y - view.h / 2; clamp(); applyView();
  }
  function fitAll() { Object.assign(view, { x: 0, y: 0, w: W, h: W * (H / W) }); clamp(); applyView(); }
  fitAll();

  // --- dynamic layer ------------------------------------------------------
  function render(model) {
    const {
      legalRoutes = [], walked = [], preview = [], tokens = [], goals = new Set(),
      visited = new Set(), reached = new Set(), pulse = new Set(), hover, visitedColour = "#4d7038", flash = null,
    } = model;
    hoverInfo = hover ?? (() => null);
    gLive.innerHTML = "";
    gRings.innerHTML = "";
    gTokens.innerHTML = "";

    // the route walked so far this turn
    for (const r of walked) {
      gLive.append(el("polyline", {
        points: pathOf(r), fill: "none", stroke: "#ffffff", "stroke-opacity": ".85",
        "stroke-width": 11, "stroke-linecap": "round", "stroke-linejoin": "round",
      }));
      gLive.append(el("polyline", {
        points: pathOf(r), fill: "none", stroke: "#4d7038",
        "stroke-width": 6, "stroke-linecap": "round", "stroke-linejoin": "round",
        "stroke-dasharray": r.type === "flight" ? "2 14" : "none",
      }));
    }
    // routes that may be taken next
    for (const r of legalRoutes) {
      const dash = r.type === "road" ? "none" : "3 16";
      gLive.append(el("polyline", {
        points: pathOf(r), fill: "none", stroke: "#ffffff", "stroke-opacity": ".8",
        "stroke-width": 10, "stroke-linecap": "round", "stroke-linejoin": "round",
      }));
      const line = el("polyline", {
        points: pathOf(r), fill: "none", stroke: "#2f6fd0", "stroke-width": 5,
        "stroke-linecap": "round", "stroke-linejoin": "round", "stroke-dasharray": dash,
      });
      gLive.append(line);
    }

    // a destination/stop being picked but not yet sent anywhere — orange so
    // it reads as "proposed," distinct from the already-committed walked
    // route (green) and the currently-clickable next steps (blue)
    for (const r of preview) {
      gLive.append(el("polyline", {
        points: pathOf(r), fill: "none", stroke: "#ffffff", "stroke-opacity": ".8",
        "stroke-width": 9, "stroke-linecap": "round", "stroke-linejoin": "round",
      }));
      gLive.append(el("polyline", {
        points: pathOf(r), fill: "none", stroke: "#d97f2f", "stroke-width": 4,
        "stroke-linecap": "round", "stroke-linejoin": "round", "stroke-dasharray": "1 10",
      }));
    }

    // per-city status rings
    for (const c of board.cities) {
      const isGoal = goals.has(c.id);
      const isVisited = visited.has(c.id);
      const isReached = reached.has(c.id);
      const canStep = pulse.has(c.id);
      if (!isGoal && !isVisited && !canStep) continue;

      if (isGoal) {
        gRings.append(el("circle", {
          cx: c.x, cy: c.y, r: 21, fill: "none",
          stroke: isReached ? "#4d7038" : "#d99a1e", "stroke-width": 4,
          "stroke-dasharray": isReached ? "none" : "7 5", filter: "url(#softGlow)",
        }));
      }
      if (isVisited) gRings.append(cube(c.x + 17, c.y - 14, visitedColour));
      if (canStep) {
        const ring = el("circle", { cx: c.x, cy: c.y, r: 17, fill: "#2f6fd0", "fill-opacity": ".18", stroke: "#2f6fd0", "stroke-width": 3.5, "data-step": c.id });
        ring.append(el("animate", { attributeName: "r", values: "16;21;16", dur: "1.7s", repeatCount: "indefinite" }));
        gRings.append(ring);
      }
    }

    // traveller tokens — the pawn from the printed set — fanned out when several share a city
    const pawn = board.pawn;
    const PAWN_K = 0.76 * PAWN_SCALE, S = PAWN_SCALE;
    const byCity = new Map();
    for (const t of tokens) {
      if (!byCity.has(t.city)) byCity.set(t.city, []);
      byCity.get(t.city).push(t);
    }
    for (const [cityId, list] of byCity) {
      const c = cityById.get(cityId);
      if (!c) continue;
      list.forEach((t, i) => {
        const spread = list.length > 1 ? 17 * S : 0;
        const x = c.x + (i - (list.length - 1) / 2) * spread, y = c.y + 4;
        const g = el("g", { transform: `translate(${x},${y})`, filter: "url(#tokenShadow)" });
        if (pawn) {
          // Foot of the pawn on the city; ~38 board px tall.
          const k = PAWN_K;
          g.append(el("path", {
            d: pawn.d, fill: t.colour, stroke: pawn.outline || "#20444c", "stroke-width": 2.2 / k, "stroke-linejoin": "round",
            transform: `scale(${k}) translate(${-pawn.footX},${-pawn.footY})`,
          }));
          if (t.label) {
            const tx = el("text", { x: 0, y: -26.5 * S, "text-anchor": "middle", "font-size": 11, "font-weight": 700, fill: "#20444c" });
            tx.textContent = t.label;
            g.append(tx);
          }
        } else {
          g.append(el("path", { d: "M0,7 C-9,-3 -12,-8 -12,-13 A12,12 0 1 1 12,-13 C12,-8 9,-3 0,7 Z", fill: t.colour, stroke: "#fff", "stroke-width": 2.6 }));
        }
        if (t.active) {
          const halo = el("circle", { cx: 0, cy: -26 * S, r: 17 * S, fill: "none", stroke: t.colour, "stroke-width": 3, "stroke-opacity": ".85" });
          halo.append(el("animate", { attributeName: "r", values: `${16 * S};${22 * S};${16 * S}`, dur: "2s", repeatCount: "indefinite" }));
          halo.append(el("animate", { attributeName: "stroke-opacity", values: ".8;0;.8", dur: "2s", repeatCount: "indefinite" }));
          g.append(halo);
        }
        gTokens.append(g);
      });
    }
  }

  /** Briefly rings a city — used when it is picked from the left map panel. */
  function flashCity(cityId) {
    const c = cityById.get(cityId);
    if (!c) return;
    const ring = el("circle", { cx: c.x, cy: c.y, r: 26, fill: "none", stroke: "#20444c", "stroke-width": 4 });
    ring.append(el("animate", { attributeName: "r", values: "18;44", dur: "0.9s", repeatCount: "3" }));
    ring.append(el("animate", { attributeName: "stroke-opacity", values: "1;0", dur: "0.9s", repeatCount: "3" }));
    gTokens.append(ring);
    setTimeout(() => ring.remove(), 2800);
  }

  return {
    render, focusOn, centreOn, fitAll, flashCity, visibleRect, showTipFor: (id) => { const c = cityById.get(id); if (c) showTip(c); },
    hideTip: () => { tip.hidden = true; },
    zoomIn: () => zoomBy(1.35), zoomOut: () => zoomBy(1 / 1.35), svg,
  };
}
