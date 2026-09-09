// Setup, private handover, and the final scoreboard.
import { h, money, cardChip } from "./sidebar.js";
import {
  PLAYER_COLOURS, SUIT_SYMBOL, dealSpec, characterOf, cityOf, finalScores, SUITS,
} from "./engine.js";

/** Character choice runs anticlockwise from the player to the first player's right. */
export const pickOrder = (n, first) =>
  Array.from({ length: n }, (_, i) => ((first - 1 - i) % n + n) % n);

export function setupScreen(board, onStart) {
  const draft = {
    count: 3,
    first: 0,
    names: ["Player 1", "Player 2", "Player 3", "Player 4", "Player 5", "Player 6"],
    characters: {},   // player index -> character id
  };

  const root = h("div", { class: "sheet-wrap" });
  const sheet = h("div", { class: "sheet" });
  root.append(sheet);

  function draw() {
    sheet.innerHTML = "";
    sheet.append(h("div", { class: "masthead" },
      h("h1", { class: "wordmark" }, "RAHEE"),
      h("p", {}, "A traveller's journey across India — local hotseat for 2–6 players")));

    // players
    const countSeg = h("div", { class: "seg" });
    for (let n = 2; n <= 6; n++) {
      countSeg.append(h("button", {
        "aria-pressed": draft.count === n ? "true" : "false",
        onClick: () => { draft.count = n; draft.first = Math.min(draft.first, n - 1); draft.characters = {}; draw(); },
      }, String(n)));
    }
    const rows = h("div", {});
    for (let i = 0; i < draft.count; i++) {
      const input = h("input", { type: "text", value: draft.names[i], maxlength: "18" });
      input.addEventListener("input", () => { draft.names[i] = input.value; });
      rows.append(h("div", { class: "playerrow" },
        h("div", { class: "swatch", style: `background:${PLAYER_COLOURS[i]}` }),
        input,
        h("button", {
          class: `btn small${draft.first === i ? " primary" : ""}`,
          onClick: () => { draft.first = i; draft.characters = {}; draw(); },
        }, draft.first === i ? "First player" : "Go first")));
    }
    const spec = dealSpec(board, draft.count);
    sheet.append(h("section", { class: "panel" },
      h("h3", {}, "Travellers"),
      h("div", { class: "field" }, h("label", {}, "How many"), countSeg),
      rows,
      h("p", { class: "tiny muted", style: "margin:12px 0 0" },
        `The player who most recently travelled furthest goes first; turns then pass clockwise. ` +
        `With ${draft.count} players the deck is ${spec.ranks.join(", ")} in all four suits, and everyone is dealt ` +
        `one ${spec.guaranteed.join(" or ")} plus ${spec.dealt} more cards.`)));

    // characters, chosen in the printed order
    const order = pickOrder(draft.count, draft.first);
    const nextIdx = order.find((i) => !draft.characters[i]);
    const taken = new Set(Object.values(draft.characters));
    const grid = h("div", { class: "chargrid" });
    for (const ch of board.characters) {
      const owner = Object.entries(draft.characters).find(([, id]) => id === ch.id)?.[0];
      grid.append(h("button", {
        class: "charcard",
        "aria-pressed": owner !== undefined ? "true" : "false",
        disabled: nextIdx === undefined || (taken.has(ch.id) && owner === undefined),
        onClick: () => {
          if (owner !== undefined) delete draft.characters[owner];
          else if (nextIdx !== undefined) draft.characters[nextIdx] = ch.id;
          draw();
        },
      },
        h("h4", {}, ch.name),
        h("div", { class: "start" }, `Starts at ${cityOf({ board }, ch.start).name} — ${ch.startBlurb}`),
        h("ul", {}, ch.goals.map((g) => h("li", {},
          h("b", {}, cityOf({ board }, g.city).name), h("span", {}, `· ${g.blurb}`)))),
        owner !== undefined
          ? h("div", { style: "margin-top:9px" },
              h("span", { class: "tag", style: `background:${PLAYER_COLOURS[owner]}22;color:${PLAYER_COLOURS[owner]}` }, draft.names[owner]))
          : null));
    }
    sheet.append(h("section", { class: "panel" },
      h("h3", {}, "Characters"),
      h("p", { class: "tiny muted", style: "margin:-4px 0 12px" },
        nextIdx === undefined
          ? "Everyone has a character."
          : `${draft.names[nextIdx]} chooses — selection runs anticlockwise from the player to the first player's right.`),
      grid));

    const ready = Object.keys(draft.characters).length === draft.count;
    sheet.append(h("div", { style: "display:flex;justify-content:flex-end;gap:10px;margin-top:18px" },
      h("button", { class: "btn primary", disabled: !ready, onClick: () => onStart({
        players: Array.from({ length: draft.count }, (_, i) => ({
          name: draft.names[i].trim() || `Player ${i + 1}`,
          characterId: draft.characters[i],
        })),
        firstPlayer: draft.first,
      }) }, ready ? "Deal the cards" : "Choose every character first")));
  }

  draw();
  return root;
}

export function handoverScreen(player, subtitle, onContinue) {
  return h("div", { class: "sheet-wrap centre" },
    h("div", { class: "sheet narrow" },
      h("div", { class: "panel handover" },
        h("div", { class: "dot", style: `background:${player.colour}` }),
        h("h2", {}, `Pass the device to ${player.name}`),
        h("p", {}, subtitle),
        h("button", { class: "btn primary", onClick: onContinue }, `I'm ${player.name} — show my cards`))));
}

/** Private screen where a player lays their first face-up road-trip card. */
export function layCardScreen(state, player, onLay) {
  const hand = h("div", { class: "hand", style: "justify-content:center" });
  for (const c of player.hand)
    hand.append(cardChip(state, c, { onClick: () => onLay(c.id) }));
  return h("div", { class: "sheet-wrap centre" },
    h("div", { class: "sheet narrow" },
      h("div", { class: "panel", style: "text-align:center" },
        h("div", { class: "dot", style: `background:${player.colour};width:44px;height:44px;border-radius:50%;margin:0 auto 14px;border:3px solid #fff;box-shadow:var(--shadow)` }),
        h("h2", { style: "font:600 26px/1.2 var(--serif)" }, `${player.name}, lay a road-trip card`),
        h("p", { class: "muted", style: "max-width:420px;margin:8px auto 20px" },
          "One card from your hand goes face-up in front of you. Others can flip it to take you on a road trip — " +
          "and its value is how far that trip can go. The rest of your hand stays hidden."),
        hand)));
}

export function scoreboardScreen(state, onRestart) {
  const rows = finalScores(state);
  const sc = state.board.scoring;
  const table = h("table", { class: "scoretable" });
  table.append(h("thead", {}, h("tr", {},
    h("th", {}, "Traveller"),
    h("th", {}, "Tourism"),
    h("th", {}, "Destinations"),
    h("th", {}, "Bonus"),
    h("th", {}, "Memories"),
    h("th", {}, "Budget"),
    h("th", {}, "Total"))));
  const body = h("tbody", {});
  rows.forEach((r, i) => {
    body.append(h("tr", { class: i === 0 ? "winner" : "" },
      h("td", {},
        h("div", { style: "display:flex;align-items:center;gap:9px" },
          h("span", { class: "swatch", style: `background:${r.player.colour}` }),
          h("div", {},
            h("div", { style: "font-weight:600" }, r.player.name),
            h("div", { class: "tiny muted" }, characterOf(state, r.player).name)))),
      h("td", {}, `${r.tourist}`, h("div", { class: "tiny muted" }, `${r.touristCount} place${r.touristCount === 1 ? "" : "s"}`)),
      h("td", {}, `${r.destinations}`, h("div", { class: "tiny muted" }, `${r.reachedCount} reached`)),
      h("td", {}, `${r.bonus}`),
      h("td", {}, `${r.memories}`, h("div", { class: "tiny muted" },
        `${r.sameSuitSets} suit · ${r.fourSuitSets} full`)),
      h("td", { class: r.penalty ? "neg" : "" }, `${r.penalty}`,
        h("div", { class: "tiny muted" }, r.over ? `over by ${money(r.over)}` : "in budget")),
      h("td", { class: "total" }, String(r.total))));
  });
  table.append(body);

  const breakdown = h("div", { class: "panel" },
    h("h3", {}, "How it was scored"),
    h("ul", { class: "tiny muted", style: "margin:0;padding-left:18px;line-height:1.9" },
      h("li", {}, `${sc.touristPlace} points for each tourist place visited`),
      h("li", {}, `${sc.destination} points for each of your character's destinations reached`),
      h("li", {}, `${sc.allDestinationsBonus} points for reaching ${sc.destinationsForBonus} destinations`),
      h("li", {}, `${sc.sameSuitSet} points per set of three memories of the same suit`),
      h("li", {}, `${sc.fourSuitSet} points per set of four memories, one of every suit`),
      h("li", {}, `−${sc.overBudgetPenalty} points for every ${money(sc.overBudgetBlock)}, or part of it, over ${money(state.board.economy.startingBudget)}`)));

  const memRows = h("div", { class: "panel" },
    h("h3", {}, "Memories collected"),
    ...rows.map((r) => h("div", { style: "display:flex;align-items:center;gap:12px;padding:7px 0;border-bottom:1px solid var(--line)" },
      h("span", { class: "swatch", style: `background:${r.player.colour}` }),
      h("span", { style: "width:110px;font-weight:550" }, r.player.name),
      ...SUITS.map((s) => h("span", { class: "tiny", style: `min-width:44px;color:${["hearts", "diamonds"].includes(s) ? "var(--red)" : "var(--ink)"}` },
        `${SUIT_SYMBOL[s]} ${r.player.memories[s]}`)))));

  return h("div", { class: "sheet-wrap" },
    h("div", { class: "sheet" },
      h("div", { class: "masthead" },
        h("h1", { class: "wordmark" }, "Journey's End"),
        h("p", {}, `${rows[0].player.name} made the richest journey with ${rows[0].total} points.`)),
      h("div", { class: "panel" }, table),
      memRows,
      breakdown,
      h("div", { style: "display:flex;justify-content:center;margin-top:20px" },
        h("button", { class: "btn primary", onClick: onRestart }, "New game"))));
}
