// Bootstraps the board data, connects to the server, owns the screen the
// player is looking at, and wires the board view and sidebar to the
// (server-redacted) state. No game rule ever runs in this file or in the
// browser at all — every mutation is a message to the server, and the
// screen only ever updates once the server's own "state" broadcast arrives.
import * as E from "./engine.js";
import * as net from "./net.js";
import { createBoardView } from "./board-view.js";
import { renderSidebar, renderDestinationsPanel, h, money, cardChip } from "./sidebar.js";
import { landingScreen, lobbyScreen, waitingScreen, layCardScreen, scoreboardScreen } from "./screens.js";

const app = document.getElementById("app");
let board, graph, view = null, mounted = null;

// Connection / room identity — who this device is, not part of game state.
let connected = false, you = null, roomCode = null, seats = [];
// The authoritative game state, as last broadcast by the server. Never
// mutated locally — only ever replaced wholesale by net.js's onState.
let state = null;

// The left-hand "other players' destinations" panel. Kept apart from `local`
// because blankLocal() is reset at the end of every turn, and a panel the
// player opened should stay open while the game moves on around it.
let destPanel = blankDestPanel();
// playerId: undefined = pick a default, null = everyone collapsed, number = that player expanded.
function blankDestPanel() { return { open: false, playerId: undefined }; }

// Per-turn interface state that is not part of the game itself.
let local = blankLocal();
function blankLocal() {
  return {
    selectedCardId: null, aceId: null, aceMode: "boost", aceSuit: null, invite: null, focus: null,
    // A click-to-route walk in progress: the remaining edges to send as
    // stepTo actions, one per server round-trip, plus how many have already
    // landed (so clicking the destination again can undo the whole walk).
    autoWalk: null,
    // A single "pick a city within N steps, with a live preview" interaction,
    // shared by three places: the driver choosing a road-trip destination
    // before sending the invite, and a companion choosing their accept-stop
    // or counter-destination while responding to one. `purpose` says which.
    picking: null,
    // Which sub-flow a companion is in while responding to an invite: null
    // (not yet answered), "accept" or "counter" (mid-pick, see `picking`).
    respondMode: null,
  };
}

// ---------------------------------------------------------------------------

(async function boot() {
  try {
    board = await (await fetch("data/board.json")).json();
  } catch (err) {
    app.innerHTML = `<div class="boot">Could not load <code>data/board.json</code>.<br>
      Make sure the server is running — <code>node server/app.js</code> — rather than opening this file directly.</div>`;
    console.error(err);
    return;
  }
  graph = E.buildGraph(board);
  connectToServer();
})();

function connectToServer() {
  net.connect({
    onOpen: () => { connected = true; render(); },
    onClose: () => { connected = false; render(); },
    onRoomCreated: (msg) => { you = msg.seatIndex; roomCode = msg.code; render(); },
    onJoined: (msg) => { you = msg.seatIndex; roomCode = msg.code; seats = msg.seats; render(); },
    onLobby: (msg) => { if (msg.code === roomCode) { seats = msg.seats; render(); } },
    // The server never sends `board` (the client already has its own copy —
    // see boot() — and resending ~70KB on every move would be wasteful).
    // engine.js's read-only accessors (characterOf, cityOf, ...) and
    // sidebar.js's cardChip all expect it on the state object, exactly as
    // it was in the old single-device build, so it's reattached here from
    // the client's own copy before anything renders.
    onState: (s) => { state = { ...s, board }; render(); },
    onError: (msg) => flashError(msg.message),
  });
  render();
}

function commit(name, args) {
  net.action(name, args ?? {});
}

function restart() {
  you = null; roomCode = null; seats = []; state = null; mounted = null; view = null; local = blankLocal(); destPanel = blankDestPanel();
  render();
  connectToServer(); // fresh socket, fresh room — the old one stays live server-side but this device leaves it
}

let errorTimer = null;
function flashError(message) {
  let el = document.getElementById("neterr");
  if (!el) { el = document.createElement("div"); el.id = "neterr"; el.className = "toast-error"; document.body.append(el); }
  el.textContent = message;
  el.style.display = "block";
  clearTimeout(errorTimer);
  errorTimer = setTimeout(() => { el.style.display = "none"; }, 4000);
}

// ---------------------------------------------------------------------------

function render() {
  if (!connected) return swap(h("div", { class: "boot" }, "Connecting to the server…"));

  if (!state) {
    if (roomCode === null) return swap(landingScreen(
      (name) => net.createRoom(name),
      (code, name) => net.joinRoom(code, name),
    ));
    return swap(lobbyScreen(board, {
      code: roomCode, seats, you,
      onPickCharacter: (id) => net.pickCharacter(id),
      onStart: () => net.startGame(),
    }));
  }

  if (state.phase === "over") return swap(scoreboardScreen(state, restart));

  if (state.phase === "setup-roadtrip-card") {
    const p = E.currentPlayer(state);
    if (p.id === you) {
      return swap(layCardScreen(state, state.players[you], (id) => commit("layRoadTripCard", { cardId: id })));
    }
    return swap(waitingScreen("Waiting for the table…", `${p.name} is laying their first road-trip card.`));
  }

  renderPlay();
}

function swap(node) {
  app.innerHTML = "";
  app.append(node);
  mounted = null;
  view = null;
}

// ---------------------------------------------------------------------------
// Play screen
// ---------------------------------------------------------------------------

function renderPlay() {
  const viewer = state.players[you];
  const viewerCh = E.characterOf(state, viewer);

  if (!mounted) {
    app.innerHTML = "";
    const stage = h("div", { class: "stage" });
    const topbar = h("div", { class: "topbar" });
    const hint = h("div", { class: "hint" });
    stage.append(topbar, hint);
    const wrap = h("div", { class: "play" }, stage);
    app.append(wrap);
    const boardHost = h("div", { style: "position:absolute;inset:0" });
    stage.prepend(boardHost);
    const destHost = h("div", { class: "destwrap" });
    stage.append(destHost);
    view = createBoardView(boardHost, board, { onCityClick: onCityClick });
    mounted = { wrap, stage, topbar, hint, boardHost, destHost, sidebar: null };
    view.focusOn(viewer.city, { zoom: 900 });
  }

  const p = E.currentPlayer(state);
  const t = state.turn;
  const ch = E.characterOf(state, p);
  const isMyTurn = p.id === you;
  const awaitingMyResponse = t?.stage === "roadtrip-pending"
    && t.pendingTrip.companions.includes(you) && !(you in t.pendingTrip.responses);

  // A picking/respond session can't outlive the context that started it —
  // e.g. the driver cancels the invite while a companion is mid-pick.
  if (local.picking) {
    const stillValid =
      (local.picking.purpose === "invite-destination" && t?.stage === "roadtrip-invite" && isMyTurn) ||
      ((local.picking.purpose === "accept-stop" || local.picking.purpose === "counter-destination") && awaitingMyResponse);
    if (!stillValid) local.picking = null;
  }
  if (local.respondMode && !awaitingMyResponse) local.respondMode = null;

  // --- top bar — a shared status ticker: whose turn it is right now.
  mounted.topbar.innerHTML = "";
  mounted.topbar.append(...[
    h("div", { class: "turnchip" },
      h("div", { class: "dot", style: `background:${p.colour}` }),
      h("div", {}, h("b", {}, isMyTurn ? "Your turn" : `${p.name}'s turn`), h("div", { class: "tiny muted" }, ch.name)),
      h("div", { class: "sep" }),
      h("div", { class: "stat" }, "Round", h("b", {}, String(state.round))),
      h("div", { class: "sep" }),
      h("div", { class: "stat" }, "Their budget left", h("b", {}, money(Math.max(0, board.economy.startingBudget - p.spent))))),
    state.endTriggeredBy !== null
      ? h("div", { class: "turnchip", style: "background:#fff4d6;border-color:#e8cf95" },
          h("div", { class: "stat", style: "padding:0 8px" }, "Final round",
            h("b", {}, `${state.players[state.endTriggeredBy].name} triggered the end`)))
      : null,
    h("div", { class: "mapctl" },
      h("button", { title: "Zoom in", onClick: () => view.zoomIn() }, "＋"),
      h("button", { title: "Zoom out", onClick: () => view.zoomOut() }, "−"),
      h("button", { class: "wide", title: "Fit the whole board", onClick: () => view.fitAll() }, "Fit"),
      h("button", { class: "wide", title: "Centre on your traveller", onClick: () => view.focusOn(viewer.city, { zoom: 800 }) }, "Me"),
      h("button", { class: "wide", title: "Leave and start a new game", onClick: () => { if (confirm("Leave this game and start a new one?")) restart(); } }, "New")),
  ].filter(Boolean));

  // --- hint line
  mounted.hint.innerHTML = "";
  const hintText = currentHint(t, p, isMyTurn, you);
  mounted.hint.hidden = !hintText;
  if (hintText) mounted.hint.innerHTML = hintText;

  // --- board layer
  const moving = t && (t.stage === "moving" || t.stage === "roadtrip-moving");
  const options = moving ? E.movementOptions(state, graph) : [];
  const walked = t ? [...t.legs, ...(t.roadTrip?.legs ?? [])] : [];
  const goalCities = new Set(viewerCh.goals.map((g) => g.city));
  view.render({
    legalRoutes: options.map((o) => o.route),
    walked,
    preview: local.picking?.route ? local.picking.route.edges.map((e) => e.route) : [],
    pulse: new Set(options.map((o) => o.to)),
    goals: goalCities,
    visited: new Set(viewer.visited),
    reached: new Set(viewer.reached),
    tokens: state.players.map((pl) => ({ city: pl.city, colour: pl.colour, active: pl.id === p.id })),
    hover: (cityId) => {
      const here = state.players.filter((pl) => pl.city === cityId).map((pl) => pl.name);
      const opt = options.find((o) => o.to === cityId);
      const bits = [];
      if (opt) bits.push(`${opt.route.type} · ${money(E.routeCost(board, opt.route))}`);
      if (goalCities.has(cityId)) bits.push(viewer.reached.includes(cityId) ? "your destination ✓" : "your destination");
      if (here.length) bits.push(`here: ${here.join(", ")}`);
      return bits.join(" · ");
    },
  });

  // --- sidebar — always your own hand, budget and progress, whoever's turn it is.
  // An invited companion gets their own accept/counter/decline prompt
  // regardless of whose turn it is — everyone else's device just watches.
  const sidebar = renderSidebar(state, {
    viewPlayer: viewer,
    showHand: true,
    canPlay: isMyTurn && !t,
    selectedCardId: local.selectedCardId,
    selectedAceId: local.aceId,
    onPickCard: pickCard,
    onFocusCity: (id) => view.focusOn(id, { zoom: 620 }),
    actions: awaitingMyResponse ? respondActions(t) : isMyTurn ? buildActions() : waitingActionsPanel(p, t),
  });
  if (mounted.sidebar) mounted.sidebar.replaceWith(sidebar);
  else mounted.wrap.append(sidebar);
  mounted.sidebar = sidebar;

  renderDest();
}

/** Redraws just the left-hand destinations panel — cheap, and called both on
 * every state broadcast and when the player opens/closes it. */
function renderDest() {
  if (!mounted?.destHost || !state) return;
  const others = state.players.filter((pl) => pl.id !== you);
  // Open on a sensible player by default: the one whose turn it is, if that
  // is somebody else, otherwise the first other player at the table.
  if (destPanel.playerId === undefined || (destPanel.playerId !== null && !others.some((pl) => pl.id === destPanel.playerId))) {
    const cur = E.currentPlayer(state);
    destPanel.playerId = (cur.id !== you ? cur : others[0])?.id ?? null;
  }
  mounted.destHost.replaceChildren(renderDestinationsPanel(state, {
    viewerId: you,
    open: destPanel.open,
    openPlayerId: destPanel.playerId,
    onToggle: () => { destPanel.open = !destPanel.open; renderDest(); },
    onTogglePlayer: (id) => { destPanel.playerId = destPanel.playerId === id ? null : id; renderDest(); },
    onFocusCity: (id) => view.focusOn(id, { zoom: 620 }),
  }));
}

function currentHint(t, p, isMyTurn, you) {
  if (!t) return isMyTurn
    ? "Pick a card from your hand — it is both your movement and the suit of the memories you can make."
    : `Waiting for ${p.name} to pick a card.`;
  if (t.stage === "moving") {
    const left = t.allowance - t.stepsUsed;
    return left > 0
      ? `Click a highlighted city to travel. <b>${left}</b> step${left === 1 ? "" : "s"} left — stopping on exactly ${t.allowance} earns an efficient-travel memory.`
      : "The whole card has been used. Finishing the move next.";
  }
  if (t.stage === "roadtrip-moving") {
    const rt = t.roadTrip;
    const left = rt.allowance - rt.stepsUsed;
    return `Road trip on ${rt.card.id}. <b>${left}</b> step${left === 1 ? "" : "s"} left — everyone aboard travels together.`;
  }
  if (t.stage === "roadtrip-pending") {
    return t.pendingTrip.companions.includes(you) && !(you in t.pendingTrip.responses)
      ? "You've been invited on a road trip — accept, counter, or decline below."
      : "A road trip has been proposed — waiting for everyone invited to answer.";
  }
  if (t.stage === "roadtrip-review") {
    return isMyTurn
      ? "Everyone has answered — review the responses below and confirm or cancel the trip."
      : "Waiting for the driver to confirm the road trip.";
  }
  return "";
}

// ---------------------------------------------------------------------------
// Interactions
// ---------------------------------------------------------------------------

function pickCard(id) {
  const p = E.currentPlayer(state);
  const card = p.hand.find((c) => c.id === id);
  if (local.selectedCardId === id) { local.selectedCardId = null; local.aceId = null; }
  else if (local.aceId === id) { local.aceId = null; }
  else if (!local.selectedCardId) { local.selectedCardId = id; local.aceId = null; }
  else if (E.isAce(card)) { local.aceId = id; local.aceSuit = card.suit; }
  else { local.selectedCardId = id; local.aceId = null; }
  renderPlay();
}

// Current position of whatever's moving this turn (the player, or the whole
// road-trip party) — the same stage-dependent lookup engine.js's own
// movementOptions uses.
function moverCity(t) {
  return t.stage === "moving" ? t.path[t.path.length - 1] : t.roadTrip.path[t.roadTrip.path.length - 1];
}
function stepsLeft(t) {
  return t.stage === "moving" ? t.allowance - t.stepsUsed : t.roadTrip.allowance - t.roadTrip.stepsUsed;
}

function onCityClick(cityId) {
  // Picking a destination/stop for a road-trip proposal or response takes
  // priority over ordinary movement — the two never overlap in practice
  // (picking only happens outside the "moving"/"roadtrip-moving" stages),
  // but checking it first keeps the two interactions cleanly separate.
  if (local.picking) { pickForPicking(cityId); return; }

  const t = state.turn;
  if (!t || E.currentPlayer(state).id !== you) return;
  if (t.stage !== "moving" && t.stage !== "roadtrip-moving") return;

  // Clicking the city you just auto-walked to, while still standing on it,
  // undoes the whole walk at once rather than doing nothing.
  if (local.autoWalk && local.autoWalk.destCity === cityId && cityId === moverCity(t)) {
    for (let i = 0; i < local.autoWalk.steps; i++) commit("undoStep");
    local.autoWalk = null;
    return;
  }

  if (E.movementOptions(state, graph).some((o) => o.to === cityId)) {
    local.autoWalk = null; // a manual step supersedes any remembered walk
    commit("stepTo", { cityId });
    return;
  }

  // Not an immediate neighbour — walk the shortest route there, if it fits
  // what's left on the card. The server re-validates every one of these
  // steps exactly as if they'd been clicked one at a time.
  const left = stepsLeft(t);
  const route = E.shortestPath(graph, moverCity(t), cityId, left);
  if (!route) { flashError(`No route there within ${left} step${left === 1 ? "" : "s"}.`); return; }
  for (const edge of route.edges) commit("stepTo", { cityId: edge.to });
  local.autoWalk = { destCity: cityId, steps: route.edges.length };
}

/** Advances a `local.picking` session — clicking a reachable city previews
 * the route to it; clicking the origin city again clears the pick. Nothing
 * is sent to the server here; the caller's "confirm" button does that. */
function pickForPicking(cityId) {
  const pk = local.picking;
  if (cityId === pk.fromCity) { pk.selected = null; pk.route = null; renderPlay(); return; }
  const route = E.shortestPath(graph, pk.fromCity, cityId, pk.maxSteps);
  if (!route) { flashError(`No route there within ${pk.maxSteps} step${pk.maxSteps === 1 ? "" : "s"}.`); return; }
  pk.selected = cityId;
  pk.route = route;
  renderPlay();
}

// ---------------------------------------------------------------------------
// Action panel — shown only on the device whose turn it is.
// ---------------------------------------------------------------------------

function waitingActionsPanel(p, t) {
  let text = t ? `Waiting for ${p.name} to finish their move…` : `Waiting for ${p.name} to play a card…`;
  if (t?.stage === "roadtrip-pending") {
    const pt = t.pendingTrip;
    const waitingOn = pt.companions.filter((id) => !(id in pt.responses)).map((id) => state.players[id].name);
    text = `${p.name} invited ${pt.companions.map((id) => state.players[id].name).join(", ")} on a road trip — waiting on ${waitingOn.join(", ")}.`;
  } else if (t?.stage === "roadtrip-review") {
    text = `${p.name} is deciding whether to confirm the road trip.`;
  }
  return h("div", { class: "actions" }, h("div", { class: "row" }, h("span", { class: "tiny muted" }, text)));
}

/**
 * Shown on an invited companion's own device until they answer. Three
 * flows: decline outright, accept (then optionally pick a different
 * drop-off than the proposed destination), or counter with somewhere else
 * entirely — both of the latter use the shared `local.picking` interaction,
 * previewed on the map from the driver's current city.
 */
function respondActions(t) {
  const pt = t.pendingTrip;
  const driver = E.currentPlayer(state);
  const owner = state.players[pt.owner];
  const card = owner.faceUp.find((f) => f.card.id === pt.cardId)?.card;
  const allowance = card ? E.cardValue(board, card) : 0;
  const destCity = E.cityOf(state, pt.destination);

  const box = h("div", { class: "actions" });
  box.append(h("div", { class: "row" },
    h("span", { class: "tiny" }, h("b", {}, driver.name), " wants to drive to ", h("b", {}, destCity.name),
      card ? ` — flipping ${pt.owner === driver.id ? "their" : `${owner.name}'s`} ${card.id}, ${allowance} step${allowance === 1 ? "" : "s"}` : "")));

  if (!local.respondMode) {
    box.append(h("div", { class: "row", style: "margin-top:10px" },
      h("button", { class: "btn ghost", onClick: () => commit("respondRoadTrip", { type: "decline" }) }, "Decline"),
      h("button", {
        class: "btn",
        onClick: () => {
          local.respondMode = "counter";
          local.picking = { purpose: "counter-destination", fromCity: driver.city, maxSteps: allowance, selected: null, route: null };
          renderPlay();
        },
      }, "Suggest somewhere else"),
      h("button", {
        class: "btn primary", style: "margin-left:auto",
        onClick: () => {
          local.respondMode = "accept";
          local.picking = { purpose: "accept-stop", fromCity: driver.city, maxSteps: allowance, selected: pt.destination, route: null };
          renderPlay();
        },
      }, "Join the trip")));
    return box;
  }

  if (local.respondMode === "accept") {
    box.append(h("div", { class: "row", style: "margin-top:10px" },
      h("span", { class: "tiny muted" }, "Click where you'd like to get off — defaults to ", h("b", {}, destCity.name), ".")));
    if (local.picking.selected) {
      const stopCity = E.cityOf(state, local.picking.selected);
      box.append(h("div", { class: "row", style: "margin-top:6px" },
        h("span", { class: "tiny" }, "Getting off at ", h("b", {}, stopCity.name),
          local.picking.route ? ` (${local.picking.route.totalSteps} step${local.picking.route.totalSteps === 1 ? "" : "s"})` : " — the planned stop")));
    }
    box.append(h("div", { class: "row", style: "margin-top:10px" },
      h("button", { class: "btn ghost", onClick: () => { local.respondMode = null; local.picking = null; renderPlay(); } }, "Back"),
      h("button", {
        class: "btn primary", style: "margin-left:auto", disabled: !local.picking.selected,
        onClick: () => {
          const stop = local.picking.selected;
          local.respondMode = null; local.picking = null;
          commit("respondRoadTrip", { type: "accept", stop });
        },
      }, "Confirm")));
    return box;
  }

  // counter
  box.append(h("div", { class: "row", style: "margin-top:10px" },
    h("span", { class: "tiny muted" }, `Click where you'd rather go — up to ${allowance} step${allowance === 1 ? "" : "s"} from ${driver.name}'s position.`)));
  if (local.picking.selected) {
    const altCity = E.cityOf(state, local.picking.selected);
    box.append(h("div", { class: "row", style: "margin-top:6px" },
      h("span", { class: "tiny" }, "Suggesting ", h("b", {}, altCity.name), ` (${local.picking.route.totalSteps} step${local.picking.route.totalSteps === 1 ? "" : "s"})`)));
  }
  box.append(h("div", { class: "row", style: "margin-top:10px" },
    h("button", { class: "btn ghost", onClick: () => { local.respondMode = null; local.picking = null; renderPlay(); } }, "Back"),
    h("button", {
      class: "btn primary", style: "margin-left:auto", disabled: !local.picking.selected,
      onClick: () => {
        const destination = local.picking.selected;
        local.respondMode = null; local.picking = null;
        commit("respondRoadTrip", { type: "counter", destination });
      },
    }, "Send suggestion")));
  return box;
}

function buildActions() {
  const p = E.currentPlayer(state);
  const t = state.turn;
  const box = h("div", { class: "actions" });

  if (!t) return chooseCardActions(box, p);
  if (t.stage === "moving" || t.stage === "roadtrip-moving") return movingActions(box, p, t);
  if (t.stage === "roadtrip-invite") return inviteActions(box, p, t);
  if (t.stage === "roadtrip-pending") return pendingTripActions(box, t);
  if (t.stage === "roadtrip-review") return reviewActions(box, t);
  return resolveActions(box, p, t);
}

function chooseCardActions(box, p) {
  const main = p.hand.find((c) => c.id === local.selectedCardId);
  if (!main) {
    box.append(h("div", { class: "row" },
      h("span", { class: "tiny muted" }, "Select a card above to begin your turn.")));
    return box;
  }
  const ace = local.aceId ? p.hand.find((c) => c.id === local.aceId) : null;
  const spareAces = p.hand.filter((c) => E.isAce(c) && c.id !== main.id);
  const allowance = E.cardValue(board, main) + (ace && local.aceMode === "boost" ? 1 : 0);

  box.append(h("div", { class: "row" },
    h("span", { class: "tiny" }, h("b", {}, main.id),
      ace ? ` + ${ace.id}` : "", ` — up to `, h("b", {}, String(allowance)), ` step${allowance === 1 ? "" : "s"}`),
    h("span", { class: "spend" }, "at most ", h("b", {}, money(allowance * board.economy.costPerStep)), " by road")));

  if (ace) {
    const modes = h("div", { class: "choice", style: "margin-top:9px" });
    modes.append(h("button", {
      class: "optbtn", "aria-pressed": local.aceMode === "boost" ? "true" : "false",
      onClick: () => { local.aceMode = "boost"; renderPlay(); },
    }, "Booster — one extra step",
      h("span", { class: "sub" }, `Moves ${E.cardValue(board, main)} + 1. Efficient travel then means exactly ${E.cardValue(board, main) + 1} steps.`)));
    modes.append(h("button", {
      class: "optbtn", "aria-pressed": local.aceMode === "memory" ? "true" : "false",
      onClick: () => { local.aceMode = "memory"; local.aceSuit = local.aceSuit ?? ace.suit; renderPlay(); },
    }, "Extra memory",
      h("span", { class: "sub" }, "One more memory, of either card's suit.")));
    box.append(modes);
    if (local.aceMode === "memory") {
      const suits = [...new Set([main.suit, ace.suit])];
      const row = h("div", { class: "row", style: "margin-top:8px;gap:6px" },
        h("span", { class: "tiny muted" }, "Memory suit:"));
      for (const s of suits)
        row.append(h("button", {
          class: `btn small${local.aceSuit === s ? " primary" : ""}`,
          onClick: () => { local.aceSuit = s; renderPlay(); },
        }, `${E.SUIT_SYMBOL[s]} ${E.memoryName(board, s)}`));
      box.append(row);
    }
  } else if (spareAces.length) {
    box.append(h("div", { class: "row", style: "margin-top:8px" },
      h("span", { class: "tiny muted" }, "Hold an Ace? Click it above to add it as a booster or an extra memory.")));
  }

  box.append(h("div", { class: "row", style: "margin-top:10px" },
    h("button", { class: "btn ghost", onClick: () => { local.selectedCardId = null; local.aceId = null; renderPlay(); } }, "Clear"),
    h("button", {
      class: "btn primary", style: "margin-left:auto",
      onClick: () => {
        local.autoWalk = null;
        commit("playCard", { cardId: main.id, ace: ace ? { cardId: ace.id, mode: local.aceMode, suit: local.aceSuit } : null });
        view.focusOn(p.city, { zoom: 900 });
      },
    }, "Play and travel")));
  return box;
}

function movingActions(box, p, t) {
  const rt = t.stage === "roadtrip-moving" ? t.roadTrip : null;
  const allowance = rt ? rt.allowance : t.allowance;
  const used = rt ? rt.stepsUsed : t.stepsUsed;
  const base = E.cardValue(board, t.card);

  const pips = h("div", { class: "pips" });
  for (let i = 0; i < allowance; i++)
    pips.append(h("div", { class: `pip${i < used ? " used" : ""}${!rt && i >= base ? " bonus" : ""}` }));
  box.append(h("div", { class: "row" },
    h("div", { class: "steps" }, pips, h("span", {}, `${used} / ${allowance} steps`)),
    h("span", { class: "spend" }, "spent this turn ", h("b", {}, money(rt ? rt.driverPaid : t.spent)))));

  if (rt && rt.riders.length) {
    const riders = h("div", { class: "choice", style: "margin-top:9px" });
    for (const r of rt.riders) {
      const pl = state.players[r.id];
      riders.append(r.droppedAt
        ? h("div", { class: "tiny muted", style: "padding:4px 2px" },
            `${pl.name} left at ${E.cityOf(state, r.droppedAt).name} after ${r.stepsTravelled} step${r.stepsTravelled === 1 ? "" : "s"}.`)
        : h("button", { class: "btn small", onClick: () => commit("dropOff", { riderId: r.id }) },
            `Drop ${pl.name} off here`));
    }
    box.append(riders);
  }

  box.append(h("div", { class: "row", style: "margin-top:10px" },
    !rt ? h("button", { class: "btn", disabled: used === 0, onClick: () => { local.autoWalk = null; commit("undoStep"); } }, "Undo step") : null,
    h("button", {
      class: "btn primary", style: "margin-left:auto", disabled: used === 0,
      onClick: () => { local.autoWalk = null; commit(rt ? "endRoadTrip" : "endMovement"); },
    }, rt ? "End the road trip" : used === allowance ? "Finish move (efficient!)" : "Finish move here")));
  return box;
}

function inviteActions(box, p, t) {
  local.invite ??= { companions: [], owner: null, card: null };
  const here = E.playersAt(state, p.city, p.id);
  box.append(h("div", { class: "row" }, h("span", { class: "tiny muted" }, "Who is coming along?")));
  const who = h("div", { class: "row", style: "flex-wrap:wrap;gap:6px" });
  for (const o of here) {
    const on = local.invite.companions.includes(o.id);
    who.append(h("button", {
      class: `btn small${on ? " primary" : ""}`,
      onClick: () => {
        local.invite.companions = on
          ? local.invite.companions.filter((x) => x !== o.id)
          : [...local.invite.companions, o.id];
        local.invite.owner = null; local.invite.card = null; local.picking = null;
        renderPlay();
      },
    }, o.name));
  }
  box.append(who);

  const participants = [p.id, ...local.invite.companions];
  const cards = E.roadTripCards(state, participants);
  if (local.invite.companions.length) {
    box.append(h("div", { class: "row", style: "margin-top:10px" },
      h("span", { class: "tiny muted" }, "Flip one face-up card — its value is how far you all travel, its suit is the memory.")));
    const row = h("div", { class: "hand", style: "margin-top:6px" });
    for (const c of cards) {
      row.append(cardChip(state, c.card, {
        faceUp: true,
        selected: local.invite.owner === c.owner && local.invite.card === c.card.id,
        onClick: () => {
          local.invite.owner = c.owner; local.invite.card = c.card.id;
          local.picking = { purpose: "invite-destination", fromCity: p.city, maxSteps: E.cardValue(board, c.card), selected: null, route: null };
          renderPlay();
        },
        title: `${c.card.id} — ${state.players[c.owner].name}'s card, ${E.cardValue(board, c.card)} steps`,
      }));
    }
    if (!cards.length) row.append(h("div", { class: "empty" }, "Nobody here has an unflipped road-trip card."));
    box.append(row);
  }

  if (local.invite.card) {
    const allowance = local.picking?.maxSteps ?? 0;
    box.append(h("div", { class: "row", style: "margin-top:10px" },
      h("span", { class: "tiny muted" }, "Click your destination on the map — up to ", h("b", {}, String(allowance)), ` step${allowance === 1 ? "" : "s"}.`)));
    if (local.picking?.selected) {
      const city = E.cityOf(state, local.picking.selected);
      box.append(h("div", { class: "row", style: "margin-top:6px" },
        h("span", { class: "tiny" }, "Destination: ", h("b", {}, city.name), ` (${local.picking.route.totalSteps} step${local.picking.route.totalSteps === 1 ? "" : "s"})`),
        h("button", {
          class: "btn small ghost", style: "margin-left:auto",
          onClick: () => { local.picking.selected = null; local.picking.route = null; renderPlay(); },
        }, "Clear")));
    }
  }

  box.append(h("div", { class: "row", style: "margin-top:10px" },
    h("button", { class: "btn ghost", onClick: () => { local.invite = null; local.picking = null; commit("cancelRoadTripInvite"); } }, "Never mind"),
    h("button", {
      class: "btn primary", style: "margin-left:auto",
      disabled: !local.invite.companions.length || !local.invite.card || !local.picking?.selected,
      onClick: () => {
        const { companions, owner, card } = local.invite;
        const destination = local.picking.selected;
        local.invite = null; local.picking = null;
        commit("proposeRoadTrip", { companions, owner, cardId: card, destination });
      },
    }, "Send the invitation")));
  return box;
}

/** The driver's own view while the invited companions haven't all answered yet. */
function pendingTripActions(box, t) {
  const pt = t.pendingTrip;
  const waitingOn = pt.companions.filter((id) => !(id in pt.responses));
  const answered = pt.companions.filter((id) => id in pt.responses);
  box.append(h("div", { class: "row" },
    h("span", { class: "tiny muted" }, `Waiting on ${waitingOn.map((id) => state.players[id].name).join(", ")} to respond…`)));
  if (answered.length) {
    const bits = answered.map((id) => {
      const r = pt.responses[id];
      const name = state.players[id].name;
      if (r.type === "accept") return `${name} is in (off at ${E.cityOf(state, r.stop).name})`;
      if (r.type === "counter") return `${name} suggests ${E.cityOf(state, r.destination).name}`;
      return `${name} said no`;
    });
    box.append(h("div", { class: "row", style: "margin-top:6px" }, h("span", { class: "tiny" }, bits.join(" · "))));
  }
  box.append(h("div", { class: "row", style: "margin-top:10px" },
    h("button", { class: "btn ghost", onClick: () => commit("cancelRoadTripInvite") }, "Withdraw the invitation")));
  return box;
}

/** The driver's final review once everyone invited has answered: who's in
 * (and where they'll get off), who countered (and with what), who declined
 * — then confirm (flips the card and sets off) or cancel outright. */
function reviewActions(box, t) {
  const pt = t.pendingTrip;
  const destCity = E.cityOf(state, pt.destination);
  box.append(h("div", { class: "row" },
    h("span", { class: "tiny" }, "Everyone has answered — heading to ", h("b", {}, destCity.name), "?")));

  const rows = h("div", { class: "choice", style: "margin-top:9px" });
  for (const id of pt.companions) {
    const name = state.players[id].name;
    const r = pt.responses[id];
    const text = r.type === "accept" ? `${name} is in — off at ${E.cityOf(state, r.stop).name}`
      : r.type === "counter" ? `${name} would rather go to ${E.cityOf(state, r.destination).name}`
      : `${name} declines`;
    rows.append(h("div", { class: "tiny", style: "padding:4px 2px" }, text));
  }
  box.append(rows);

  box.append(h("div", { class: "row", style: "margin-top:10px" },
    h("button", { class: "btn ghost", onClick: () => commit("cancelRoadTripInvite") }, "Cancel the trip"),
    h("button", { class: "btn primary", style: "margin-left:auto", onClick: () => commit("confirmRoadTrip") }, "Confirm & set off")));
  return box;
}

function resolveActions(box, p, t) {
  const gained = t.gained.filter((g) => g.player === p.id);
  if (t.gained.length) {
    const bits = t.gained.map((g) => {
      const who = g.player === p.id ? "" : `${state.players[g.player].name}: `;
      return `${who}${E.SUIT_SYMBOL[g.suit]} ${E.memoryName(board, g.suit)} (${g.why})`;
    });
    box.append(h("div", { class: "row" }, h("span", { class: "tiny" }, h("b", {}, "Memories: "), bits.join(" · "))));
  } else {
    box.append(h("div", { class: "row" }, h("span", { class: "tiny muted" }, "No memories from that move.")));
  }

  // Tourism — discounted when a road trip has just finished here.
  const didTrip = !!t.roadTrip;
  const price = didTrip ? board.economy.sharedTouristVisit : board.economy.touristVisit;
  const candidates = didTrip
    ? E.sharedVisitors(state)
    : (E.touristHere(state, p) ? [p.id] : []);
  if (candidates.length) {
    const city = E.cityOf(state, p.city);
    box.append(h("div", { class: "row", style: "margin-top:9px" },
      h("span", { class: "tiny" }, `Stay at `, h("b", {}, city.name), ` — ${city.attraction} · `, h("b", {}, money(price)), " each")));
    const row = h("div", { class: "row", style: "flex-wrap:wrap;gap:6px;margin-top:6px" });
    for (const id of candidates)
      row.append(h("button", {
        class: "btn small primary",
        onClick: () => commit("visitTourist", { playerId: id, discounted: didTrip }),
      }, `${id === p.id ? "Visit" : `${state.players[id].name} visits`} · ${money(price)}`));
    box.append(row);
  }

  const others = E.playersAt(state, p.city, p.id);
  const canTrip = !didTrip && others.length > 0 && E.roadTripCards(state, [p.id, ...others.map((o) => o.id)]).length > 0;

  box.append(h("div", { class: "row", style: "margin-top:10px" },
    canTrip
      ? h("button", { class: "btn", onClick: () => { local.invite = null; local.picking = null; commit("offerRoadTrip"); } },
          `Offer a road trip (${others.map((o) => o.name).join(", ")})`)
      : null,
    h("button", {
      class: "btn primary", style: "margin-left:auto",
      onClick: () => { commit("endTurn"); local = blankLocal(); },
    }, "End turn")));
  return box;
}
