// The clickable panel on the left of the board: Prof. Parvathy's clean map of
// India (with or without names) as an overview, with every traveller's pawn,
// the destinations of whichever player you pick, and a box showing the part of
// the board you are looking at. Click anywhere on it to jump the board there;
// hover a node to see its stamp. Below the map, each other player's six
// destinations (the Week 3 "where everyone is heading" list).
//
// Everything here is public game state — positions, completed destinations —
// so nothing is asked of the server. The map images are placed with the affine
// transform stored in board.json (maps[].fromPlate), so no city needs separate
// coordinates on them.
import { characterOf, cityOf, currentPlayer } from "./engine.js";
import { h } from "./sidebar.js";

const NS = "http://www.w3.org/2000/svg";
const svgEl = (name, attrs = {}) => {
  const n = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  return n;
};
const PREF_KEY = "rahee.mapPanel";
const loadPref = () => { try { return JSON.parse(localStorage.getItem(PREF_KEY)) || {}; } catch { return {}; } };
const savePref = (p) => { try { localStorage.setItem(PREF_KEY, JSON.stringify(p)); } catch { /* storage may be unavailable */ } };

/**
 * handlers: { onPickCity(cityId), onHoverCity(cityId|null) }
 * Returns { update(state, opts), setViewport(rect) }.
 */
export function createMapPanel(host, board, handlers = {}) {
  const maps = board.maps?.length ? board.maps : null;
  const pref = loadPref();
  const ui = {
    open: pref.open ?? false,
    expanded: false,
    mapId: maps?.some((m) => m.id === pref.mapId) ? pref.mapId : maps?.[0]?.id,
    playerId: undefined, // undefined = choose a default, null = none
    cityId: null,
  };
  let state = null, opts = {}, viewport = null;
  const cityById = new Map(board.cities.map((c) => [c.id, c]));

  const tab = h("button", { class: "lp-tab", onClick: () => toggle(true) }, "›", h("span", {}, "Map & destinations"));
  const panel = h("aside", { class: "lp", role: "region", "aria-label": "Map and other players' destinations" });
  const wrap = h("div", { class: "lp-wrap" }, tab, panel);
  host.replaceChildren(wrap);

  // --- persistent map pieces (the image is never re-created, so it never flickers)
  const img = h("img", { class: "mm-img", alt: "Map of India with every city on the board", draggable: "false" });
  const overlay = svgEl("svg", { class: "mm-svg" });
  const gStatic = svgEl("g"), gDyn = svgEl("g"), gView = svgEl("g");
  overlay.append(gStatic, gDyn, gView);
  const mmTip = h("div", { class: "mm-tip", hidden: true });
  const mm = h("div", { class: "mm" }, img, overlay, mmTip);
  const segNames = h("div", { class: "seg" });
  const cityCard = h("div", { class: "lp-city" });
  const players = h("div", { class: "lp-players" });

  const map = () => maps?.find((m) => m.id === ui.mapId) ?? maps?.[0];
  const toMap = (x, y) => {
    const [a, b, c, d, e, f] = map().fromPlate;
    return [a * x + c * y + e, b * x + d * y + f];
  };
  const fromClient = (cx, cy) => {
    const r = overlay.getBoundingClientRect(), m = map();
    return [((cx - r.left) / r.width) * m.width, ((cy - r.top) / r.height) * m.height];
  };
  function nearestCity(mx, my, reach) {
    let best = null;
    for (const c of board.cities) {
      const [x, y] = toMap(c.x, c.y);
      const d = Math.hypot(x - mx, y - my);
      if (d <= reach && (!best || d < best.d)) best = { c, d };
    }
    return best?.c ?? null;
  }
  // Reach in map pixels that equals ~14 screen pixels, whatever the panel's size.
  const reachPx = () => (14 * map().width) / Math.max(1, overlay.getBoundingClientRect().width);

  overlay.addEventListener("click", (e) => {
    const [mx, my] = fromClient(e.clientX, e.clientY);
    const c = nearestCity(mx, my, reachPx() * 1.6);
    if (c) { ui.cityId = c.id; handlers.onPickCity?.(c.id); draw(); }
    else handlers.onPanTo?.(planeAt(mx, my));
  });
  overlay.addEventListener("pointermove", (e) => {
    const [mx, my] = fromClient(e.clientX, e.clientY);
    const c = nearestCity(mx, my, reachPx());
    overlay.style.cursor = c ? "pointer" : "crosshair";
    if (!c) { mmTip.hidden = true; return; }
    showMiniTip(c);
  });
  overlay.addEventListener("pointerleave", () => { mmTip.hidden = true; });

  /** Map pixel -> board-plate coordinate (inverse of fromPlate). */
  function planeAt(mx, my) {
    const [a, b, c, d, e, f] = map().fromPlate;
    const det = a * d - b * c;
    const X = mx - e, Y = my - f;
    return { x: (d * X - c * Y) / det, y: (-b * X + a * Y) / det };
  }

  function showMiniTip(c) {
    const [x, y] = toMap(c.x, c.y);
    const r = overlay.getBoundingClientRect(), m = map();
    const px = (x / m.width) * r.width, py = (y / m.height) * r.height;
    const here = state ? state.players.filter((p) => p.city === c.id).map((p) => p.name) : [];
    mmTip.innerHTML =
      (c.stamp ? `<img src="${c.stamp}" alt="" width="150" height="120">` : "") +
      `<div>${c.tourist ? `<b class="n">${c.tourist}</b> ` : ""}<b>${c.name}</b>${c.attraction ? `<div class="sub">${c.attraction}</div>` : ""}` +
      (here.length ? `<div class="sub">here: ${here.join(", ")}</div>` : "") + "</div>";
    mmTip.hidden = false;
    const tipW = c.stamp ? 166 : 140;
    mmTip.style.left = `${Math.max(tipW / 2, Math.min(r.width - tipW / 2, px))}px`;
    const above = py > (c.stamp ? 190 : 70);
    mmTip.style.top = above ? `${py - 12}px` : `${py + 14}px`;
    mmTip.style.transform = above ? "translate(-50%,-100%)" : "translate(-50%,0)";
  }

  function toggle(open) {
    ui.open = open;
    savePref({ ...loadPref(), open });
    draw();
    handlers.onToggle?.(open);
  }

  function buildStatic() {
    const m = map();
    img.src = m.image;
    img.width = m.width; img.height = m.height;
    overlay.setAttribute("viewBox", `0 0 ${m.width} ${m.height}`);
    gStatic.replaceChildren();
  }

  function drawViewport() {
    gView.replaceChildren();
    if (!viewport || !maps) return;
    const { x, y, w, h: hh } = viewport;
    const pts = [[x, y], [x + w, y], [x + w, y + hh], [x, y + hh]].map(([px, py]) => toMap(px, py).join(","));
    gView.append(svgEl("polygon", { points: pts.join(" "), fill: "rgba(32,68,76,.08)", stroke: "#20444c", "stroke-width": 7, "stroke-dasharray": "22 12", "vector-effect": "none" }));
  }

  function drawOverlay() {
    gDyn.replaceChildren();
    if (!state) return;
    const viewer = state.players[opts.viewerId];
    const ringR = 34;
    // the picked player's destinations, in their colour
    const sel = state.players.find((p) => p.id === ui.playerId);
    if (sel) {
      const reached = new Set(sel.reached);
      for (const g of characterOf(state, sel).goals) {
        const c = cityById.get(g.city); const [x, y] = toMap(c.x, c.y);
        gDyn.append(svgEl("circle", { cx: x, cy: y, r: ringR + 10, fill: reached.has(g.city) ? sel.colour : "none", "fill-opacity": ".35", stroke: sel.colour, "stroke-width": 10 }));
      }
    }
    // your own destinations: gold dashed while open, green once completed
    if (viewer) {
      const reached = new Set(viewer.reached);
      for (const g of characterOf(state, viewer).goals) {
        const c = cityById.get(g.city); const [x, y] = toMap(c.x, c.y);
        const done = reached.has(g.city);
        gDyn.append(svgEl("circle", { cx: x, cy: y, r: ringR, fill: "none", stroke: done ? "#4d7038" : "#d99a1e", "stroke-width": 9, "stroke-dasharray": done ? "none" : "20 12" }));
      }
    }
    if (ui.cityId) {
      const c = cityById.get(ui.cityId); const [x, y] = toMap(c.x, c.y);
      gDyn.append(svgEl("circle", { cx: x, cy: y, r: 52, fill: "none", stroke: "#20444c", "stroke-width": 8 }));
    }
    // pawns, side by side when sharing a city
    const pawn = board.pawn;
    const byCity = new Map();
    for (const p of state.players) { if (!byCity.has(p.city)) byCity.set(p.city, []); byCity.get(p.city).push(p); }
    const cur = currentPlayer(state).id;
    for (const [cityId, list] of byCity) {
      const c = cityById.get(cityId); const [x, y] = toMap(c.x, c.y);
      list.forEach((p, i) => {
        const k = 2.0;
        const gx = x + (i - (list.length - 1) / 2) * 42;
        const g = svgEl("g", { transform: `translate(${gx},${y + 6})` });
        if (p.id === cur) g.append(svgEl("circle", { cx: 0, cy: -52, r: 46, fill: "#fff", "fill-opacity": ".55", stroke: p.colour, "stroke-width": 8 }));
        g.append(svgEl("path", { d: pawn?.d ?? "M0,0", fill: p.colour, stroke: pawn?.outline ?? "#20444c", "stroke-width": 1.6, transform: `scale(${k}) translate(${-(pawn?.footX ?? 0)},${-(pawn?.footY ?? 0)})` }));
        gDyn.append(g);
      });
    }
  }

  function drawCityCard() {
    cityCard.replaceChildren();
    if (!ui.cityId || !state) return;
    const c = cityById.get(ui.cityId);
    const here = state.players.filter((p) => p.city === c.id);
    const goalOf = state.players.filter((p) => characterOf(state, p).goals.some((g) => g.city === c.id));
    const visitors = state.players.filter((p) => p.visited.includes(c.id));
    cityCard.append(
      c.stamp ? h("img", { class: "lp-stamp", src: c.stamp, alt: `Stamp ${c.tourist}: ${c.name} — ${c.attraction}`, width: "320", height: "256" }) : null,
      h("div", { class: "lp-city-body" },
        h("div", { class: "nm" }, c.tourist ? h("span", { class: "num" }, String(c.tourist)) : null, h("span", {}, c.name, c.state ? h("span", { class: "tiny muted" }, `, ${c.state}`) : null)),
        c.attraction ? h("div", { class: "tiny muted" }, c.attraction) : h("div", { class: "tiny muted" }, "Not a tourist place — a stop along the roads."),
        c.airport ? h("div", { class: "tiny" }, "✈ Airport — flights cost 1 step + ₹4,000") : null,
        here.length ? h("div", { class: "tiny" }, "Here now: ", ...here.map((p) => h("span", { class: "pchip", style: `--c:${p.colour}` }, p.name))) : null,
        goalOf.length ? h("div", { class: "tiny" }, "Destination for: ", ...goalOf.map((p) => h("span", { class: "pchip", style: `--c:${p.colour}` }, `${p.name}${p.reached.includes(c.id) ? " ✓" : ""}`))) : null,
        visitors.length ? h("div", { class: "tiny" }, "Stamp collected by: ", visitors.map((p) => p.name).join(", ")) : null,
        h("div", { class: "row" },
          h("button", { class: "btn small", onClick: () => handlers.onPickCity?.(c.id) }, "Show on the board"),
          h("button", { class: "btn small ghost", onClick: () => { ui.cityId = null; draw(); } }, "Close"))));
  }

  function drawPlayers() {
    players.replaceChildren();
    if (!state) return;
    const others = state.players.filter((p) => p.id !== opts.viewerId);
    if (!others.length) { players.append(h("div", { class: "empty" }, "There are no other travellers in this game.")); return; }
    const cur = currentPlayer(state).id;
    for (const pl of others) {
      const ch = characterOf(state, pl);
      const reached = new Set(pl.reached);
      const isOpen = pl.id === ui.playerId;
      const card = h("div", { class: `dp-player${isOpen ? " is-open" : ""}` });
      card.append(h("button", {
        class: "dp-row", "aria-expanded": isOpen ? "true" : "false",
        onClick: () => { ui.playerId = isOpen ? null : pl.id; draw(); },
      },
        h("div", { class: "dot", style: `background:${pl.colour}` }),
        h("div", { class: "dp-who" },
          h("div", { class: "nm" }, pl.name,
            pl.isBot ? h("span", { class: "tag bot" }, "computer") : null,
            pl.id === cur ? h("span", { class: "tag" }, "playing") : null,
            opts.online?.[pl.id] === false && !pl.isBot ? h("span", { class: "tag offline" }, "offline") : null),
          h("div", { class: "sub" }, `${ch.name} · at ${cityOf(state, pl.city).name}`)),
        h("div", { class: "dp-count", title: "destinations completed" }, `${reached.size}/${ch.goals.length}`),
        h("div", { class: "dp-chev" }, isOpen ? "▾" : "▸")));
      if (isOpen) {
        const list = h("div", { class: "places" });
        for (const g of ch.goals) {
          const c = cityOf(state, g.city);
          const done = reached.has(g.city);
          list.append(h("button", {
            class: `place${done ? " is-goal" : " pending"}`,
            onClick: () => { ui.cityId = c.id; handlers.onPickCity?.(c.id); draw(); },
            title: `Show ${c.name} on the map`,
          },
            h("div", { class: "num" }, done ? "✓" : String(c.tourist ?? "•")),
            h("div", {}, h("div", { class: "nm" }, c.name), h("div", { class: "sub" }, g.blurb)),
            done ? h("span", { class: "tag done" }, "completed") : null));
        }
        card.append(list);
      }
      players.append(card);
    }
  }

  function drawHeader() {
    segNames.replaceChildren(...(maps ?? []).map((m) => h("button", {
      "aria-pressed": m.id === ui.mapId ? "true" : "false",
      onClick: () => { ui.mapId = m.id; savePref({ ...loadPref(), mapId: m.id }); buildStatic(); draw(); },
    }, m.label)));
  }

  function draw() {
    wrap.classList.toggle("is-open", ui.open);
    wrap.classList.toggle("is-expanded", ui.expanded);
    tab.hidden = ui.open;
    if (!ui.open) { panel.replaceChildren(); return; }
    if (!panel.firstChild) {
      panel.append(
        h("div", { class: "lp-head" },
          h("h3", {}, "Map"),
          segNames,
          h("button", { class: "lp-iconbtn", title: "Bigger / smaller map", onClick: () => { ui.expanded = !ui.expanded; draw(); handlers.onToggle?.(true); } }, "⤢"),
          h("button", { class: "lp-iconbtn", title: "Close the panel", onClick: () => toggle(false) }, "‹")),
        maps ? mm : h("div", { class: "empty" }, "No overview map in the board data."),
        h("div", { class: "mm-legend" },
          h("span", {}, h("i", { class: "lg gold" }), "your destinations"),
          h("span", {}, h("i", { class: "lg box" }), "what the board shows"),
          h("span", { class: "muted" }, "click to jump there")),
        cityCard,
        h("h4", { class: "lp-sub" }, "Where everyone is heading"),
        h("div", { class: "tiny muted", style: "margin:-4px 0 8px" }, "Pick a traveller to ring their six destinations on the map."),
        players);
    }
    drawHeader();
    drawOverlay();
    drawViewport();
    drawCityCard();
    drawPlayers();
  }

  if (maps) buildStatic();

  return {
    update(s, o = {}) {
      state = s; opts = o;
      const others = s.players.filter((p) => p.id !== o.viewerId);
      if (ui.playerId === undefined || (ui.playerId !== null && !others.some((p) => p.id === ui.playerId))) {
        const cur = currentPlayer(s);
        ui.playerId = (cur.id !== o.viewerId ? cur : others[0])?.id ?? null;
      }
      draw();
    },
    setViewport(rect) { viewport = rect; if (ui.open) drawViewport(); },
    /** Screen pixels of the board hidden behind the open panel. */
    coveredWidth() { return ui.open ? panel.getBoundingClientRect().width : 0; },
    showCity(cityId) { ui.cityId = cityId; if (!ui.open) ui.open = true; draw(); },
  };
}
