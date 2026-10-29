// Landing (create/join a room), the online lobby, laying a road-trip card,
// waiting for another seat's turn, and the final scoreboard.
import { h, money, cardChip } from "./sidebar.js";
import { playerColours, SUIT_SYMBOL, characterOf, cityOf, finalScores, SUITS, isAce } from "./engine.js";
import { BOT_LEVELS } from "./ai.js";

/** Opens a dismissible modal over everything. Returns a function that closes it. */
export function showModal(content, { wide = false } = {}) {
  const close = () => { bg.remove(); removeEventListener("keydown", onKey); };
  const onKey = (e) => { if (e.key === "Escape") close(); };
  const bg = h("div", { class: "modal-bg", onClick: (e) => { if (e.target === bg) close(); } },
    h("div", { class: `modal${wide ? " wide" : ""}`, role: "dialog", "aria-modal": "true" },
      h("button", { class: "modal-x", title: "Close", "aria-label": "Close", onClick: close }, "×"),
      content));
  addEventListener("keydown", onKey);
  document.body.append(bg);
  return close;
}

/**
 * The rules on one page. Every number comes from the board data, so it always
 * matches the game being played. If the board data names a rules image
 * (board.rulesImage — Prof. Parvathy's one-page rules sheet), it is shown first.
 */
export function rulesSheet(board) {
  const e = board.economy, sc = board.scoring, rs = (n) => `₹${n.toLocaleString("en-IN")}`;
  const suit = (id) => board.suits.find((x) => x.id === id);
  return h("div", { class: "rules" },
    h("h2", { class: "display" }, "How to play RAHEE"),
    board.rulesImage ? h("img", { class: "rules-img", src: board.rulesImage, alt: "The one-page rules sheet" }) : null,
    h("p", { class: "lead" }, `2–6 travellers cross India. Your dealt hand is your whole itinerary — nothing is drawn later. Spend it well, stay inside ${rs(e.startingBudget)}, and come home with the richest journey.`),
    h("div", { class: "rules-grid" },
      h("section", {},
        h("h3", {}, "1 · Each turn"),
        h("ol", {},
          h("li", {}, "Play a card and move ", h("b", {}, "1 step up to its value"), " (A=1, 2–6 face value, 10/J=10, Q/K=5). You can't pass."),
          h("li", {}, `Pay ${rs(e.costPerStep)} a step. A flight is 1 step + ${rs(e.flightSurcharge)}; ships add their printed fare.`),
          h("li", {}, "Make memories, maybe visit, maybe offer a road trip, then end your turn — the card goes face-up as a future road-trip card."))),
      h("section", {},
        h("h3", {}, "2 · Memories (free)"),
        h("ul", {},
          h("li", {}, "Moved exactly the card's value → 1 memory of its suit."),
          h("li", {}, "Ended where another traveller already is → 1 memory."),
          h("li", {}, "Took part in a road trip → 1 memory of the trip card's suit.")),
        h("div", { class: "rules-mem" }, ...SUITS.map((id) => h("figure", {},
          suit(id).card ? h("img", { src: suit(id).card, alt: "", width: "60", height: "77" }) : null,
          h("figcaption", {}, `${SUIT_SYMBOL[id]} ${suit(id).memory}`))))),
      h("section", {},
        h("h3", {}, "3 · Stamps & destinations"),
        h("ul", {},
          h("li", {}, `End on a numbered place and pay ${rs(e.touristVisit)} to collect its stamp (once each).`),
          h("li", {}, h("b", {}, "A destination on your character card counts only when you visit it"), " — ending there is not enough."),
          h("li", {}, "Hover any numbered city to see its stamp."))),
      h("section", {},
        h("h3", {}, "4 · Road trips"),
        h("ul", {},
          h("li", {}, "End where others are and invite them. Flip a ", h("b", {}, "companion's"), " face-up card — never your own."),
          h("li", {}, `You pay the travel; each companion pays you ${rs(e.roadTripSharePerStep)} a step plus their own surcharges.`),
          h("li", {}, `Everyone aboard gets a memory; the driver gets one more for using the full value. Stamps cost ${rs(e.sharedTouristVisit)} each at the end.`),
          h("li", {}, "Companions choose where they get off. Getting off early loses the shared price."))),
      h("section", {},
        h("h3", {}, "5 · Aces"),
        h("ul", {},
          h("li", {}, "Alone: 1 step. With a card: +1 step, or one extra memory of either suit."),
          h("li", {}, "Dealt two or more Aces? Before laying your first card you may swap one for a new card (or ask for a reshuffle if none are left)."))),
      h("section", {},
        h("h3", {}, "6 · The end & scoring"),
        h("p", { class: "tiny" }, `The game ends after the round in which someone plays their last card or completes ${sc.destinationsForBonus} destinations.`),
        h("table", { class: "rules-score" },
          h("tr", {}, h("td", {}, "Each stamp"), h("td", {}, `${sc.touristPlace}`)),
          h("tr", {}, h("td", {}, "Each destination completed"), h("td", {}, `${sc.destination}`)),
          h("tr", {}, h("td", {}, `${sc.destinationsForBonus} destinations bonus`), h("td", {}, `${sc.allDestinationsBonus}`)),
          h("tr", {}, h("td", {}, "Three memories of one suit"), h("td", {}, `${sc.sameSuitSet}`)),
          h("tr", {}, h("td", {}, "One memory of every suit"), h("td", {}, `${sc.fourSuitSet}`)),
          h("tr", {}, h("td", {}, `Every ${rs(sc.overBudgetBlock)} (or part) over ${rs(e.startingBudget)}`), h("td", {}, `−${sc.overBudgetPenalty}`))))));
}

/** Create a room, or join one by its 4-character code. */
export function landingScreen(onCreate, onJoin, board) {
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
      h("p", {}, "A traveller's journey across India — play with friends on their own devices"),
      board ? h("button", { class: "btn small ghost", style: "margin-top:10px", onClick: () => showModal(rulesSheet(board), { wide: true }) }, "How to play") : null),
    h("section", { class: "panel" },
      h("div", { class: "field" }, h("label", {}, "Your name"), nameInput),
      h("div", { style: "display:flex;flex-direction:column;gap:10px;margin-top:16px" },
        h("button", { class: "btn primary", onClick: () => onCreate(name) }, "Create a room"),
        h("div", { style: "display:flex;gap:8px;align-items:center" },
          codeInput,
          h("button", { class: "btn", style: "flex:1", onClick: () => onJoin(code, name) }, "Join with a code")),
        h("p", { class: "tiny muted", style: "margin:2px 0 0" }, "Left a game by accident? Enter its room code and the same name you played under to get your seat back."))));
  return h("div", { class: "sheet-wrap centre" }, sheet);
}

/** The room's own colour+character picker, reusable once seats change shape (lobby, or read-only after the game starts). */
function characterGrid(board, seats, you, onPick) {
  const PLAYER_COLOURS = playerColours(board);
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
            style: `border-color:${PLAYER_COLOURS[ownerIdx % PLAYER_COLOURS.length]}`,
          }, seats[ownerIdx].name)
        : null));
  }
  return grid;
}

/** Waiting room: who's here, pick a character, the host starts once everyone has. */
export function lobbyScreen(board, { code, seats, you, online = [], onPickCharacter, onStart, onAddBot, onRemoveBot }) {
  const PLAYER_COLOURS = playerColours(board);
  const rows = h("div", {});
  seats.forEach((s, i) => {
    rows.append(h("div", { class: "playerrow" },
      h("div", { class: "swatch", style: `background:${PLAYER_COLOURS[i % PLAYER_COLOURS.length]}` }),
      h("div", { style: "flex:1" }, s.name, i === you ? h("span", { class: "tiny muted" }, "  (you)") : null,
        s.isBot ? h("span", { class: "tag bot", style: "margin-left:8px" }, `computer · ${BOT_LEVELS.find((l) => l.id === s.botLevel)?.label ?? "planner"}`) : null,
        online[i] === false && !s.isBot ? h("span", { class: "tag offline", style: "margin-left:8px" }, "offline") : null),
      h("span", { class: "tiny muted" }, s.characterId ? board.characters.find((c) => c.id === s.characterId)?.name : "choosing…"),
      s.isBot && you === 0 && onRemoveBot ? h("button", { class: "btn small ghost", title: "Remove this computer player", onClick: () => onRemoveBot(i) }, "Remove") : null));
  });
  const full = seats.length >= board.characters.length;
  const botRow = you === 0 && onAddBot
    ? h("div", { class: "botrow" },
        h("span", { class: "tiny muted" }, "Short of players, or play-testing? Fill a seat with a computer player:"),
        ...BOT_LEVELS.map((l, i) => h("button", { class: `btn small${i ? " ghost" : ""}`, disabled: full, title: l.blurb, onClick: () => onAddBot(l.id) }, `+ Computer (${l.label})`)))
    : null;

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
        h("p", { class: "tiny muted", style: "margin:12px 0 0" }, `${seats.length} joined — up to ${board.characters.length}.`),
        botRow),
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

/**
 * Setup, for one seat: lay your first face-up road-trip card (when it's your
 * turn to), and — if you were dealt two or more Aces — swap one for a fresh
 * card or ask for a reshuffle (any time before you lay).
 * opts: { canLay, waitingFor, onLay(id), onSwapAce(id), onReshuffle() }
 */
export function layCardScreen(state, player, opts) {
  const { canLay, waitingFor, onLay, onSwapAce, onReshuffle } = opts;
  const aces = player.hand.filter(isAce);
  const laid = player.faceUp.length > 0;
  const hand = h("div", { class: "hand", style: "justify-content:center" });
  for (const c of player.hand)
    hand.append(cardChip(state, c, { onClick: canLay && !laid ? () => onLay(c.id) : null }));
  const ch = characterOf(state, player);

  let aceBox = null;
  if (aces.length >= 2 && !laid && !player.aceSwapped) {
    const pile = state.leftoverCount ?? 0;
    const anyLaid = state.players.some((p) => p.faceUp.length);
    aceBox = h("div", { class: "acebox" },
      h("b", {}, `You were dealt ${aces.length} Aces.`),
      pile > 0
        ? h("div", {}, h("span", { class: "tiny muted" }, "You may discard one from the game and draw a replacement: "),
            ...aces.map((a) => h("button", { class: "btn small", onClick: () => onSwapAce(a.id) }, `Swap ${a.id}`)))
        : anyLaid
          ? h("div", { class: "tiny muted" }, "No cards are left to draw, and a road-trip card has already been laid, so it's too late to reshuffle.")
          : h("div", {}, h("span", { class: "tiny muted" }, "No cards are left to draw — you may ask for a reshuffle (every hand is dealt again). "),
              h("button", { class: "btn small", onClick: onReshuffle }, "Ask for a reshuffle")));
  }

  return h("div", { class: "sheet-wrap centre" },
    h("div", { class: "sheet narrow" },
      h("div", { class: "panel", style: "text-align:center" },
        ch.card ? h("img", { src: ch.card, alt: `${ch.name}'s card`, class: "setupcard" }) : null,
        h("h2", { class: "display", style: "font-size:28px" },
          laid ? `${player.name}, your card is down` : canLay ? `${player.name}, lay a road-trip card` : `${player.name}, here is your hand`),
        h("p", { class: "muted", style: "max-width:440px;margin:8px auto 18px" },
          laid ? `Waiting for ${waitingFor} to lay theirs.`
            : canLay ? "One card from your hand goes face-up in front of you. Others can flip it to take you on a road trip — and its value is how far that trip can go. The rest of your hand stays hidden."
              : `${waitingFor} is laying their first road-trip card — you'll lay yours when it's your turn.`),
        hand,
        aceBox)));
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
      h("td", {}, `${r.destinations}`, h("div", { class: "tiny muted" }, `${r.reachedCount} completed`)),
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
      h("li", {}, `${sc.destination} points for each of your character's destinations completed (visited and paid for)`),
      h("li", {}, `${sc.allDestinationsBonus} points for completing ${sc.destinationsForBonus} destinations`),
      h("li", {}, `${sc.sameSuitSet} points per set of three memories of the same suit`),
      h("li", {}, `${sc.fourSuitSet} points per set of four memories, one of every suit`),
      h("li", {}, `−${sc.overBudgetPenalty} points for every ${money(sc.overBudgetBlock)}, or part of it, over ${money(state.board.economy.startingBudget)}`)));

  const stampRows = h("div", { class: "panel" },
    h("h3", {}, "Stamps collected"),
    ...rows.map((r) => h("div", { class: "stamprow" },
      h("div", { class: "pwho" }, h("span", { class: "swatch", style: `background:${r.player.colour}` }), h("b", {}, r.player.name)),
      h("div", { class: "stamps" }, ...(r.player.visited.length ? r.player.visited.map((id) => {
        const c = cityOf(state, id);
        return c.stamp ? h("img", { src: c.stamp, alt: c.name, title: `${c.tourist}. ${c.name}`, width: "80", height: "64", loading: "lazy" }) : h("span", { class: "tag" }, c.name);
      }) : [h("span", { class: "tiny muted" }, "none")])))));

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
      stampRows,
      memRows,
      breakdown,
      h("div", { style: "display:flex;justify-content:center;margin-top:20px" },
        h("button", { class: "btn primary", onClick: onRestart }, "New game"))));
}
