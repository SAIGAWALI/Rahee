// Landing (create/join a room), the online lobby, laying a road-trip card,
// waiting for another seat's turn, and the final scoreboard.
import { h, money, cardChip } from "./sidebar.js";
import { PLAYER_COLOURS, SUIT_SYMBOL, characterOf, cityOf, finalScores, SUITS } from "./engine.js";

/** Create a room, or join one by its 4-character code. */
export function landingScreen(onCreate, onJoin) {
  let name = "";
  let code = "";
  const nameInput = h("input", { type: "text", placeholder: "Your name", maxlength: "18" });
  nameInput.addEventListener("input", () => { name = nameInput.value; });
  const codeInput = h("input", {
    type: "text", placeholder: "Room code", maxlength: "4",
    style: "text-transform:uppercase;letter-spacing:.08em;max-width:120px",
  });
  codeInput.addEventListener("input", () => { code = codeInput.value.toUpperCase(); });

  const sheet = h("div", { class: "sheet narrow" },
    h("div", { class: "masthead" },
      h("h1", { class: "wordmark" }, "RAHEE"),
      h("p", {}, "A traveller's journey across India — play with friends on their own devices")),
    h("section", { class: "panel" },
      h("div", { class: "field" }, h("label", {}, "Your name"), nameInput),
      h("div", { style: "display:flex;flex-direction:column;gap:10px;margin-top:16px" },
        h("button", { class: "btn primary", onClick: () => onCreate(name) }, "Create a room"),
        h("div", { style: "display:flex;gap:8px;align-items:center" },
          codeInput,
          h("button", { class: "btn", style: "flex:1", onClick: () => onJoin(code, name) }, "Join with a code")))));
  return h("div", { class: "sheet-wrap centre" }, sheet);
}

/** The room's own colour+character picker, reusable once seats change shape (lobby, or read-only after the game starts). */
function characterGrid(board, seats, you, onPick) {
  const taken = seats.map((s) => s.characterId);
  const grid = h("div", { class: "chargrid" });
  for (const ch of board.characters) {
    const ownerIdx = taken.indexOf(ch.id);
    const mine = ownerIdx === you;
    grid.append(h("button", {
      class: "charcard",
      "aria-pressed": mine ? "true" : "false",
      "aria-label": `${ch.name} — starts at ${cityOf({ board }, ch.start).name}, ${ch.startBlurb}`,
      disabled: !onPick || (ownerIdx !== -1 && !mine),
      onClick: onPick ? () => onPick(ch.id) : null,
    },
      h("img", { class: "charcard-art", src: ch.card, alt: `${ch.name}'s printed character card`, loading: "lazy" }),
      ownerIdx !== -1
        ? h("span", {
            class: "tag charcard-owner",
            style: `background:${PLAYER_COLOURS[ownerIdx % PLAYER_COLOURS.length]}22;color:${PLAYER_COLOURS[ownerIdx % PLAYER_COLOURS.length]}`,
          }, seats[ownerIdx].name)
        : null));
  }
  return grid;
}

/** Waiting room: who's here, pick a character, the host starts once everyone has. */
export function lobbyScreen(board, { code, seats, you, online = [], onPickCharacter, onStart }) {
  const rows = h("div", {});
  seats.forEach((s, i) => {
    rows.append(h("div", { class: "playerrow" },
      h("div", { class: "swatch", style: `background:${PLAYER_COLOURS[i % PLAYER_COLOURS.length]}` }),
      h("div", { style: "flex:1" }, s.name, i === you ? h("span", { class: "tiny muted" }, "  (you)") : null,
        online[i] === false ? h("span", { class: "tag offline", style: "margin-left:8px" }, "offline") : null),
      h("span", { class: "tiny muted" }, s.characterId ? board.characters.find((c) => c.id === s.characterId)?.name : "choosing…")));
  });

  const ready = seats.length >= 2 && seats.every((s) => s.characterId);
  const startRow = you === 0
    ? h("button", {
        class: "btn primary", disabled: !ready, onClick: onStart,
      }, ready ? "Deal the cards" : seats.length < 2 ? "Waiting for more players…" : "Waiting for everyone to choose…")
    : h("span", { class: "tiny muted" }, ready ? "Waiting for the host to start…" : "Waiting for everyone to choose…");

  return h("div", { class: "sheet-wrap" },
    h("div", { class: "sheet" },
      h("div", { class: "masthead" },
        h("h1", { class: "wordmark" }, "RAHEE"),
        h("p", {}, "Room code ", h("b", { style: "letter-spacing:.1em" }, code), " — share it with the other players")),
      h("section", { class: "panel" },
        h("h3", {}, "Players"), rows,
        h("p", { class: "tiny muted", style: "margin:12px 0 0" }, `${seats.length} joined — up to ${board.characters.length}.`)),
      h("section", { class: "panel" },
        h("h3", {}, "Characters"),
        h("p", { class: "tiny muted", style: "margin:-4px 0 12px" }, "Pick any character nobody else here has taken."),
        characterGrid(board, seats, you, onPickCharacter)),
      h("div", { style: "display:flex;justify-content:flex-end;margin-top:18px" }, startRow)));
}

/** A plain placeholder shown while it's some other seat's turn to act. */
export function waitingScreen(title, subtitle) {
  return h("div", { class: "sheet-wrap centre" },
    h("div", { class: "sheet narrow" },
      h("div", { class: "panel", style: "text-align:center;padding:56px 24px" },
        h("h2", { style: "font:600 26px/1.2 var(--serif)" }, title),
        subtitle ? h("p", { class: "muted", style: "max-width:380px;margin:10px auto 0" }, subtitle) : null)));
}

/** Shown only to the seat that currently owes a face-up road-trip card. */
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
