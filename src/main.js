// Bootstraps the board data, owns the screen the player is looking at, and
// wires the board view and sidebar to the engine.
import * as E from "./engine.js";
import { createBoardView } from "./board-view.js";
import { renderSidebar, h, money, cardChip } from "./sidebar.js";
import { setupScreen, handoverScreen, layCardScreen, scoreboardScreen } from "./screens.js";

const app = document.getElementById("app");
let board, graph, state = null, view = null, mounted = null;

// Per-turn interface state that is not part of the game itself.
let local = blankLocal();
function blankLocal() {
  return {
    selectedCardId: null, aceId: null, aceMode: "boost", aceSuit: null,
    handoverAck: false, invite: null, focus: null,
  };
}

// ---------------------------------------------------------------------------

(async function boot() {
  try {
    board = await (await fetch("data/board.json")).json();
  } catch (err) {
    app.innerHTML = `<div class="boot">Could not load <code>data/board.json</code>.<br>
      Serve this folder over HTTP — for example <code>python3 -m http.server</code> — rather than opening the file directly.</div>`;
    console.error(err);
    return;
  }
  graph = E.buildGraph(board);
  const resumed = E.loadSave(board);
  if (resumed) {
    state = resumed;
    local.handoverAck = false;
  }
  render();
})();

function commit(fn) {
  try { fn(); } catch (err) { console.warn(err); }
  if (state) E.save(state);
  render();
}

function newGame(config) {
  state = E.newGame({ board, ...config });
  local = blankLocal();
  commit(() => {});
}

function restart() {
  E.clearSave();
  state = null;
  mounted = null;
  view = null;
  local = blankLocal();
  render();
}

// ---------------------------------------------------------------------------

function render() {
  if (!state) return swap(setupScreen(board, newGame));
  if (state.phase === "over") return swap(scoreboardScreen(state, restart));

  if (state.phase === "setup-roadtrip-card") {
    const p = E.currentPlayer(state);
    if (!local.handoverAck) {
      return swap(handoverScreen(p, "Everyone has been dealt their hand. Lay one card face-up as your first road-trip card.",
        () => { local.handoverAck = true; render(); }));
    }
    return swap(layCardScreen(state, p, (id) => commit(() => {
      E.layRoadTripCard(state, p.id, id);
      local.handoverAck = false;
    })));
  }

  if (state.phase === "handover" && !local.handoverAck) {
    const p = E.currentPlayer(state);
    const ch = E.characterOf(state, p);
    const endNote = state.endTriggeredBy !== null ? " This is the final round." : "";
    mounted = null;
    return swap(handoverScreen(p, `Round ${state.round} · ${ch.name} · ${p.hand.length} cards in hand.${endNote}`,
      () => { local = blankLocal(); local.handoverAck = true; state.phase = "play"; render(); }));
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
    view = createBoardView(boardHost, board, { onCityClick: onCityClick });
    mounted = { wrap, stage, topbar, hint, boardHost, sidebar: null };
    if (state.turn) view.focusOn(E.currentPlayer(state).city, { zoom: 900 });
  }

  const p = E.currentPlayer(state);
  const t = state.turn;
  const ch = E.characterOf(state, p);

  // --- top bar
  mounted.topbar.innerHTML = "";
  mounted.topbar.append(...[
    h("div", { class: "turnchip" },
      h("div", { class: "dot", style: `background:${p.colour}` }),
      h("div", {}, h("b", {}, p.name), h("div", { class: "tiny muted" }, ch.name)),
      h("div", { class: "sep" }),
      h("div", { class: "stat" }, "Round", h("b", {}, String(state.round))),
      h("div", { class: "sep" }),
      h("div", { class: "stat" }, "Budget left", h("b", {}, money(Math.max(0, board.economy.startingBudget - p.spent))))),
    state.endTriggeredBy !== null
      ? h("div", { class: "turnchip", style: "background:#fff4d6;border-color:#e8cf95" },
          h("div", { class: "stat", style: "padding:0 8px" }, "Final round",
            h("b", {}, `${state.players[state.endTriggeredBy].name} triggered the end`)))
      : null,
    h("div", { class: "mapctl" },
      h("button", { title: "Zoom in", onClick: () => view.zoomIn() }, "＋"),
      h("button", { title: "Zoom out", onClick: () => view.zoomOut() }, "−"),
      h("button", { class: "wide", title: "Fit the whole board", onClick: () => view.fitAll() }, "Fit"),
      h("button", { class: "wide", title: "Centre on your traveller", onClick: () => view.focusOn(p.city, { zoom: 800 }) }, "Me"),
      h("button", { class: "wide", title: "Start a new game", onClick: () => { if (confirm("Abandon this game and start a new one?")) restart(); } }, "New")),
  ].filter(Boolean));

  // --- hint line
  mounted.hint.innerHTML = "";
  const hintText = currentHint(t, p);
  mounted.hint.hidden = !hintText;
  if (hintText) mounted.hint.innerHTML = hintText;

  // --- board layer
  const moving = t && (t.stage === "moving" || t.stage === "roadtrip-moving");
  const options = moving ? E.movementOptions(state, graph) : [];
  const walked = t ? [...t.legs, ...(t.roadTrip?.legs ?? [])] : [];
  const goalCities = new Set(ch.goals.map((g) => g.city));
  view.render({
    legalRoutes: options.map((o) => o.route),
    walked,
    pulse: new Set(options.map((o) => o.to)),
    goals: goalCities,
    visited: new Set(p.visited),
    reached: new Set(p.reached),
    tokens: state.players.map((pl) => ({ city: pl.city, colour: pl.colour, active: pl.id === p.id })),
    hover: (cityId) => {
      const here = state.players.filter((pl) => pl.city === cityId).map((pl) => pl.name);
      const opt = options.find((o) => o.to === cityId);
      const bits = [];
      if (opt) bits.push(`${opt.route.type} · ${money(E.routeCost(board, opt.route))}`);
      if (goalCities.has(cityId)) bits.push(p.reached.includes(cityId) ? "your destination ✓" : "your destination");
      if (here.length) bits.push(`here: ${here.join(", ")}`);
      return bits.join(" · ");
    },
  });

  // --- sidebar
  const sidebar = renderSidebar(state, {
    viewPlayer: p,
    showHand: true,
    canPlay: !t,
    selectedCardId: local.selectedCardId,
    selectedAceId: local.aceId,
    onPickCard: pickCard,
    onFocusCity: (id) => view.focusOn(id, { zoom: 620 }),
    actions: buildActions(),
  });
  if (mounted.sidebar) mounted.sidebar.replaceWith(sidebar);
  else mounted.wrap.append(sidebar);
  mounted.sidebar = sidebar;
}

function currentHint(t, p) {
  if (!t) return "Pick a card from your hand — it is both your movement and the suit of the memories you can make.";
  if (t.stage === "moving") {
    const left = t.allowance - t.stepsUsed;
    return left > 0
      ? `Click a highlighted city to travel. <b>${left}</b> step${left === 1 ? "" : "s"} left — stopping on exactly ${t.allowance} earns an efficient-travel memory.`
      : "You have used the whole card. Finish your move.";
  }
  if (t.stage === "roadtrip-moving") {
    const rt = t.roadTrip;
    const left = rt.allowance - rt.stepsUsed;
    return `Road trip on ${rt.card.id}. <b>${left}</b> step${left === 1 ? "" : "s"} left — everyone aboard travels together.`;
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

function onCityClick(cityId) {
  const t = state.turn;
  if (!t) return;
  if (t.stage !== "moving" && t.stage !== "roadtrip-moving") return;
  if (!E.movementOptions(state, graph).some((o) => o.to === cityId)) return;
  commit(() => E.stepTo(state, graph, cityId));
}

// ---------------------------------------------------------------------------
// Action panel
// ---------------------------------------------------------------------------

function buildActions() {
  const p = E.currentPlayer(state);
  const t = state.turn;
  const box = h("div", { class: "actions" });

  if (!t) return chooseCardActions(box, p);
  if (t.stage === "moving" || t.stage === "roadtrip-moving") return movingActions(box, p, t);
  if (t.stage === "roadtrip-invite") return inviteActions(box, p, t);
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
      onClick: () => commit(() => {
        E.playCard(state, {
          cardId: main.id,
          ace: ace ? { cardId: ace.id, mode: local.aceMode, suit: local.aceSuit } : null,
        });
        view.focusOn(p.city, { zoom: 900 });
      }),
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
        : h("button", { class: "btn small", onClick: () => commit(() => E.dropOff(state, r.id)) },
            `Drop ${pl.name} off here`));
    }
    box.append(riders);
  }

  box.append(h("div", { class: "row", style: "margin-top:10px" },
    !rt ? h("button", { class: "btn", disabled: used === 0, onClick: () => commit(() => E.undoStep(state)) }, "Undo step") : null,
    h("button", {
      class: "btn primary", style: "margin-left:auto", disabled: used === 0,
      onClick: () => commit(() => (rt ? E.endRoadTrip(state) : E.endMovement(state))),
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
        local.invite.owner = null; local.invite.card = null;
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
        onClick: () => { local.invite.owner = c.owner; local.invite.card = c.card.id; renderPlay(); },
        title: `${c.card.id} — ${state.players[c.owner].name}'s card, ${E.cardValue(board, c.card)} steps`,
      }));
    }
    if (!cards.length) row.append(h("div", { class: "empty" }, "Nobody here has an unflipped road-trip card."));
    box.append(row);
  }

  box.append(h("div", { class: "row", style: "margin-top:10px" },
    h("button", { class: "btn ghost", onClick: () => { local.invite = null; state.turn.stage = "resolve"; renderPlay(); } }, "Never mind"),
    h("button", {
      class: "btn primary", style: "margin-left:auto",
      disabled: !local.invite.companions.length || !local.invite.card,
      onClick: () => commit(() => {
        E.startRoadTrip(state, { companions: local.invite.companions, owner: local.invite.owner, cardId: local.invite.card });
        local.invite = null;
      }),
    }, "Set off together")));
  return box;
}

function resolveActions(box, p, t) {
  const board_ = board;
  const gained = t.gained.filter((g) => g.player === p.id);
  if (t.gained.length) {
    const bits = t.gained.map((g) => {
      const who = g.player === p.id ? "" : `${state.players[g.player].name}: `;
      return `${who}${E.SUIT_SYMBOL[g.suit]} ${E.memoryName(board_, g.suit)} (${g.why})`;
    });
    box.append(h("div", { class: "row" }, h("span", { class: "tiny" }, h("b", {}, "Memories: "), bits.join(" · "))));
  } else {
    box.append(h("div", { class: "row" }, h("span", { class: "tiny muted" }, "No memories from that move.")));
  }

  // Tourism — discounted when a road trip has just finished here.
  const didTrip = !!t.roadTrip;
  const price = didTrip ? board_.economy.sharedTouristVisit : board_.economy.touristVisit;
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
        onClick: () => commit(() => E.visitTourist(state, id, didTrip)),
      }, `${id === p.id ? "Visit" : `${state.players[id].name} visits`} · ${money(price)}`));
    box.append(row);
  }

  const others = E.playersAt(state, p.city, p.id);
  const canTrip = !didTrip && others.length > 0 && E.roadTripCards(state, [p.id, ...others.map((o) => o.id)]).length > 0;

  box.append(h("div", { class: "row", style: "margin-top:10px" },
    canTrip
      ? h("button", { class: "btn", onClick: () => { state.turn.stage = "roadtrip-invite"; local.invite = null; renderPlay(); } },
          `Offer a road trip (${others.map((o) => o.name).join(", ")})`)
      : null,
    h("button", {
      class: "btn primary", style: "margin-left:auto",
      onClick: () => commit(() => {
        E.endTurn(state);
        local = blankLocal();
      }),
    }, "End turn")));
  return box;
}
