// The travel journal beside the board: what the current player is carrying,
// what they have collected, and where they still have to get to.
import { SUIT_SYMBOL, SUIT_IS_RED, SUITS, characterOf, cityOf, cardValue, scorePlayer } from "./engine.js";

const h = (tag, props = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "class") n.className = v;
    else if (k === "html") n.innerHTML = v;
    else if (k.startsWith("on")) n.addEventListener(k.slice(2).toLowerCase(), v);
    else if (v !== null && v !== false && v !== undefined) n.setAttribute(k, v === true ? "" : v);
  }
  for (const kid of kids.flat()) if (kid != null) n.append(kid.nodeType ? kid : document.createTextNode(kid));
  return n;
};
const money = (n) => `₹${Math.round(n).toLocaleString("en-IN")}`;

export function cardChip(state, card, opts = {}) {
  const { selected, disabled, faceUp, spent, onClick, title } = opts;
  const b = h("button", {
    class: `pcard${SUIT_IS_RED[card.suit] ? " red" : ""}${faceUp ? " faceup" : ""}${spent ? " spent" : ""}`,
    "aria-pressed": selected ? "true" : "false",
    disabled: disabled || !onClick,
    title: title || `${card.rank}${SUIT_SYMBOL[card.suit]} — moves ${cardValue(state.board, card)}`,
    onClick: onClick || null,
  });
  b.append(h("div", { class: "r" }, card.rank));
  b.append(h("div", { class: "s" }, SUIT_SYMBOL[card.suit]));
  b.append(h("div", { class: "big" }, SUIT_SYMBOL[card.suit]));
  return b;
}

export function renderSidebar(state, ui) {
  const p = ui.viewPlayer;
  const ch = characterOf(state, p);
  const board = state.board;
  const goals = ch.goals;
  const goalCities = new Set(goals.map((g) => g.city));
  const budget = board.economy.startingBudget;
  const pct = Math.min(100, (p.spent / budget) * 100);
  const over = p.spent > budget;
  const sc = scorePlayer(state, p);

  const head = h("div", { class: "sb-head" },
    h("div", { class: "who" },
      ch.card
        ? h("button", { class: "mycard", title: `Your character card — ${ch.name}`, onClick: () => ui.onShowCard?.(ch) },
            h("img", { src: ch.card, alt: `${ch.name} card`, width: "44", height: "51" }),
            h("i", { style: `background:${p.colour}` }))
        : h("div", { class: "dot", style: `background:${p.colour}` }),
      h("div", {},
        h("div", { class: "nmrow" },
          h("h2", {}, p.name),
          ui.roomCode ? h("span", { class: "roomcode", title: "Share this code with anyone who needs to rejoin" }, "Room ", h("b", {}, ui.roomCode)) : null),
        h("div", { class: "role" }, `${ch.name} · at ${cityOf(state, p.city).name}`)),
    ),
    h("div", { class: "budget" },
      h("div", { class: "nums" },
        h("span", { class: "muted" }, over ? "Over budget by" : "Left to spend"),
        h("b", { class: over ? "rupee" : "rupee", style: over ? "color:var(--red)" : "" },
          money(over ? p.spent - budget : budget - p.spent))),
      h("div", { class: "bar" }, h("i", { class: over ? "over" : "", style: `width:${pct}%` })),
      h("div", { class: "nums tiny muted", style: "margin-top:4px" },
        h("span", {}, `spent ${money(p.spent)}`),
        h("span", {}, `of ${money(budget)}`))),
  );

  const body = h("div", { class: "sb-body scroll" });

  // ---- hand ---------------------------------------------------------------
  if (ui.showHand) {
    const hand = h("div", { class: "hand" });
    for (const c of p.hand) {
      hand.append(cardChip(state, c, {
        selected: ui.selectedCardId === c.id || ui.selectedAceId === c.id,
        disabled: !ui.canPlay,
        onClick: ui.canPlay ? () => ui.onPickCard(c.id) : null,
      }));
    }
    if (!p.hand.length) hand.append(h("div", { class: "empty" }, "Hand empty — this traveller's journey is done."));
    body.append(h("section", { class: "sect" },
      h("h3", {}, "Hand", h("span", { class: "count" }, `${p.hand.length} card${p.hand.length === 1 ? "" : "s"}`)),
      hand));
  }

  // ---- road-trip cards ----------------------------------------------------
  if (p.faceUp.length) {
    const row = h("div", { class: "hand" });
    for (const f of p.faceUp)
      row.append(cardChip(state, f.card, { faceUp: true, spent: f.flipped, title: f.flipped ? `${f.card.id} — already used for a road trip` : `${f.card.id} — available as a road-trip card` }));
    body.append(h("section", { class: "sect" },
      h("h3", {}, "Road-trip cards",
        h("span", { class: "count" }, `${p.faceUp.filter((f) => !f.flipped).length} available`)),
      row));
  }

  // ---- memories -----------------------------------------------------------
  const grid = h("div", { class: "memgrid" });
  for (const suit of SUITS) {
    const meta = board.suits.find((x) => x.id === suit);
    const n = p.memories[suit];
    grid.append(h("div", { class: `memtile${SUIT_IS_RED[suit] ? " red" : ""}${n ? "" : " zero"}${meta.card ? " art" : ""}`, title: `${meta.memory} — ${meta.blurb}` },
      meta.card ? h("img", { src: meta.card, alt: `${meta.memory} memory card`, width: "90", height: "115", loading: "lazy" }) : h("div", { class: "sym" }, SUIT_SYMBOL[suit]),
      h("div", { class: "n" }, String(n)),
      meta.card ? null : h("div", { class: "lbl" }, meta.memory)));
  }
  const memTotal = SUITS.reduce((t, s) => t + p.memories[s], 0);
  const setBits = [];
  if (sc.sameSuitSets) setBits.push(`${sc.sameSuitSets} × three-of-a-suit`);
  if (sc.fourSuitSets) setBits.push(`${sc.fourSuitSets} × one-of-each`);
  body.append(h("section", { class: "sect" },
    h("h3", {}, "Memories", h("span", { class: "count" }, `${memTotal} collected`)),
    grid,
    h("div", { class: "setline", html: setBits.length
      ? `<b>${setBits.join(" + ")}</b> — worth <b>${sc.memories}</b> points so far`
      : "No sets yet. Three of one suit scores 15; one of every suit scores 20." })));

  // ---- places visited -----------------------------------------------------
  const visited = p.visited
    .map((id) => cityOf(state, id))
    .sort((a, b) => a.tourist - b.tourist);
  // A stamp album: the actual stamp artwork for every place visited.
  const places = h("div", { class: "album" });
  for (const c of visited) {
    const isGoal = goalCities.has(c.id);
    places.append(h("button", {
      class: `stampbtn${isGoal ? " is-goal" : ""}`,
      onClick: () => ui.onFocusCity(c.id),
      title: `${c.tourist}. ${c.name} — ${c.attraction}${isGoal ? " (destination ★)" : ""}. Show on the map.`,
    },
      c.stamp ? h("img", { src: c.stamp, alt: `Stamp ${c.tourist}: ${c.name}`, width: "160", height: "128", loading: "lazy" })
        : h("div", { class: "nostamp" }, `${c.tourist} ${c.name}`),
      isGoal ? h("span", { class: "star" }, "★") : null));
  }
  if (!visited.length) places.append(h("div", { class: "empty" }, "No stamps yet. End a move on a numbered city and pay the stay cost to collect its stamp."));
  body.append(h("section", { class: "sect" },
    h("h3", {}, "Stamps collected", h("span", { class: "count" }, `${visited.length} of ${board.cities.filter((c) => c.tourist).length} · ${visited.length * board.scoring.touristPlace} pts`)),
    places));

  // ---- destination goals --------------------------------------------------
  const dest = h("div", { class: "places" });
  const reached = new Set(p.reached);
  for (const g of goals) {
    const c = cityOf(state, g.city);
    const done = reached.has(g.city);
    dest.append(h("button", {
      class: `place${done ? " is-goal" : " pending"}`,
      onClick: () => ui.onFocusCity(c.id),
      title: `Show ${c.name} on the map`,
    },
      h("div", { class: "num" }, String(c.tourist ?? "•")),
      h("div", {},
        h("div", { class: "nm" }, c.name),
        h("div", { class: "sub" }, g.blurb)),
      done ? h("span", { class: "tag done" }, "✓ completed") : h("span", { class: "tag" }, "5 pts")));
  }
  const need = board.scoring.destinationsForBonus;
  body.append(h("section", { class: "sect" },
    h("h3", {}, `${ch.name}'s destinations`, h("span", { class: "count" }, `${sc.reachedCount} of ${goals.length}`)),
    dest,
    h("div", { class: "setline", html: sc.reachedCount >= need
      ? `<b>Bonus earned.</b> Reaching ${need} destinations is worth an extra ${board.scoring.allDestinationsBonus} points.`
      : `A destination counts once you <b>visit</b> it (end there and pay the stay). ${need - sc.reachedCount} more earns the ${board.scoring.allDestinationsBonus}-point bonus — and ends the game.` })));

  // ---- running score ------------------------------------------------------
  body.append(h("section", { class: "sect" },
    h("h3", {}, "If the game ended now"),
    h("div", { class: "setline", html:
      `<b>${sc.total}</b> points — ${sc.tourist} stamps, ${sc.destinations + sc.bonus} destinations, ` +
      `${sc.memories} memories${sc.penalty ? `, <span style="color:var(--red)">${sc.penalty} budget</span>` : ""}` })));

  // ---- log ----------------------------------------------------------------
  if (state.log.length) {
    const log = h("div", { class: "log" });
    for (const e of state.log.slice(-15).reverse())
      log.append(h("div", { html: `${e.player ? `<b>${e.player}</b> ` : ""}${e.text}` }));
    body.append(h("section", { class: "sect" }, h("h3", {}, "Recent"), log));
  }

  return h("aside", { class: "sidebar" }, head, body, ui.actions ?? null);
}

export { h, money };
