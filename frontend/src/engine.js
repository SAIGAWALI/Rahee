// RAHEE game engine.
//
// Holds only rules and mechanisms: every fact about *this* board — cities,
// routes, costs, tourist places, characters and their destination goals — is
// read from the board data passed in, so editing that data changes the game
// without touching this file.

export const SUITS = ["spades", "hearts", "clubs", "diamonds"];
export const SUIT_SYMBOL = { spades: "♠", hearts: "♥", clubs: "♣", diamonds: "♦" };
export const SUIT_IS_RED = { spades: false, hearts: true, clubs: false, diamonds: true };

// Fallback only — a board may define its own token colours (board.playerColours).
export const PLAYER_COLOURS = ["#f0563e", "#3fb8dc", "#f5b800", "#4fae4d", "#d472ac", "#8e4c20"];
export const playerColours = (board) => board?.playerColours?.length ? board.playerColours : PLAYER_COLOURS;

/** Small seeded PRNG so a game can be replayed from its seed. */
export function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

const shuffle = (arr, rand) => {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

export const cardId = (c) => `${c.rank}${SUIT_SYMBOL[c.suit]}`;
export const cardValue = (board, c) => board.cards.values[c.rank];
export const isAce = (c) => c.rank === "A";

/** Adjacency list keyed by city id. Both directions of every route. */
export function buildGraph(board) {
  const g = new Map(board.cities.map((c) => [c.id, []]));
  board.routes.forEach((r, i) => {
    g.get(r.from).push({ to: r.to, route: r, index: i, reversed: false });
    g.get(r.to).push({ to: r.from, route: r, index: i, reversed: true });
  });
  return g;
}

export const routeCost = (board, route) =>
  route.steps * board.economy.costPerStep + (route.surcharge || 0);

/**
 * Shortest route from one city to another, within a steps budget. Weight is
 * route.steps (the movement-allowance cost that a card actually spends), not
 * money — see routeCost for that separate concern. 101 cities is small enough
 * that a heap-free O(V²) Dijkstra is plenty fast. Returns `null` if the city
 * isn't reachable within `maxSteps` (or at all).
 *
 * Flights are a last resort: a route that stays on roads (and ships) is always
 * preferred, even when it is longer than a flight, as long as it fits within
 * `maxSteps`. A flight is only used when no road/ship route fits the budget.
 * Reachability is unchanged — only which route is chosen.
 */
export function shortestPath(graph, fromCityId, toCityId, maxSteps) {
  return (
    dijkstra(graph, fromCityId, toCityId, maxSteps, (route) => route.type !== "flight") ||
    dijkstra(graph, fromCityId, toCityId, maxSteps, () => true)
  );
}

function dijkstra(graph, fromCityId, toCityId, maxSteps, allowed) {
  if (fromCityId === toCityId) return { edges: [], totalSteps: 0 };
  const dist = new Map([[fromCityId, 0]]);
  const prev = new Map(); // cityId -> { from, edge }
  const visited = new Set();
  for (;;) {
    let u = null, best = Infinity;
    for (const [id, d] of dist) if (!visited.has(id) && d < best) { best = d; u = id; }
    if (u === null || u === toCityId) break;
    visited.add(u);
    for (const edge of graph.get(u) || []) {
      if (!allowed(edge.route)) continue;
      const nd = best + edge.route.steps;
      if (nd > maxSteps) continue;
      if (!dist.has(edge.to) || nd < dist.get(edge.to)) { dist.set(edge.to, nd); prev.set(edge.to, { from: u, edge }); }
    }
  }
  if (!dist.has(toCityId)) return null;
  const edges = [];
  for (let cur = toCityId; cur !== fromCityId;) {
    const { from, edge } = prev.get(cur);
    edges.unshift({ to: edge.to, route: edge.route });
    cur = from;
  }
  return { edges, totalSteps: dist.get(toCityId) };
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

/** The deck for this player count, per the board's `cards.deals` table. */
export function dealSpec(board, playerCount) {
  const spec = board.cards.deals.find((d) => d.players.includes(playerCount));
  if (!spec) throw new Error(`no deal defined for ${playerCount} players`);
  return spec;
}

export function buildDeck(board, playerCount) {
  const spec = dealSpec(board, playerCount);
  const deck = [];
  for (const rank of spec.ranks) for (const suit of SUITS) deck.push({ rank, suit });
  return deck;
}

/**
 * Deals hands. Every player is first guaranteed one high-movement card (a 10,
 * or a J once the face cards are in). Any other 10s/Js are then set aside, and
 * the remainder of each hand is dealt from the rest of the shuffled deck.
 * Nothing is drawn after this.
 */
export function deal(board, playerCount, seed) {
  const spec = dealSpec(board, playerCount);
  const rand = rng(seed);
  const deck = shuffle(buildDeck(board, playerCount), rand);

  const guaranteed = [];
  for (let i = 0; i < playerCount; i++) {
    const at = deck.findIndex((c) => spec.guaranteed.includes(c.rank));
    if (at < 0) throw new Error("not enough high cards to guarantee one each");
    guaranteed.push(deck.splice(at, 1)[0]);
  }
  // Every other high-movement card (the spare 10s / Js) is set aside, not
  // shuffled back in: only the guaranteed card of each player is high-value.
  const setAside = deck.filter((c) => spec.guaranteed.includes(c.rank));
  const rest = deck.filter((c) => !spec.guaranteed.includes(c.rank));
  deck.length = 0;
  deck.push(...rest);
  const hands = guaranteed.map((c) => [c]);
  for (let n = 0; n < spec.dealt; n++)
    for (let p = 0; p < playerCount; p++) hands[p].push(deck.pop());

  return { hands, leftover: deck, setAside };
}

export function newGame({ board, players, firstPlayer = 0, seed = Date.now() & 0xffffffff }) {
  const { hands, leftover } = deal(board, players.length, seed);
  const colours = playerColours(board);
  const state = {
    board,
    seed,
    leftover,
    players: players.map((p, i) => {
      const character = board.characters.find((c) => c.id === p.characterId);
      return {
        id: i,
        name: p.name,
        colour: colours[i % colours.length],
        characterId: p.characterId,
        city: character.start,
        spent: 0,
        hand: hands[i].map((c) => ({ ...c, id: cardId(c) })),
        faceUp: [],            // played cards, available as road-trip cards
        memories: { spades: 0, hearts: 0, clubs: 0, diamonds: 0 },
        visited: [],           // tourist city ids this player has paid to visit
        reached: [],           // destination goals completed (visited and paid for)
        aceSwapped: false,     // the one-time "two Aces" swap at setup has been used
        isBot: !!p.isBot,      // a computer player (see ai.js) — purely informational
      };
    }),
    firstPlayer,
    turnIndex: 0,              // 0..players-1 offset from firstPlayer
    round: 1,
    phase: "setup-roadtrip-card",
    endTriggeredBy: null,
    endTriggerRound: null,
    turn: null,
    log: [],
  };
  return state;
}

export const currentPlayer = (s) => s.players[(s.firstPlayer + s.turnIndex) % s.players.length];
export const characterOf = (s, p) => s.board.characters.find((c) => c.id === p.characterId);
export const cityOf = (s, id) => s.board.cities.find((c) => c.id === id);
export const playersAt = (s, cityId, exceptId) =>
  s.players.filter((p) => p.city === cityId && p.id !== exceptId);

/** Adds a line to the game log. `who` is the player the line is about (default: whoever's turn it is). */
function log(s, text, who) {
  s.log.push({ round: s.round, player: (who ?? currentPlayer(s))?.name ?? null, text });
  if (s.log.length > 240) s.log.shift();
}

/**
 * Records a completed destination goal. Per the rules, a destination counts
 * only once the player has *visited* it — ended there and paid the tourist
 * visit (₹2,000, or ₹1,000 shared on a road trip). Just passing through or
 * stopping there does not complete it. Called from visitTourist only.
 */
function noteDestination(s, p, cityId) {
  const ch = characterOf(s, p);
  if (ch.goals.some((g) => g.city === cityId) && !p.reached.includes(cityId)) {
    p.reached.push(cityId);
    return true;
  }
  return false;
}

/** True when this city is one of the player's destination goals not yet completed. */
export const isOpenGoal = (s, p, cityId) =>
  characterOf(s, p).goals.some((g) => g.city === cityId) && !p.reached.includes(cityId);

// ---------------------------------------------------------------------------
// Turn: playing a card and moving
// ---------------------------------------------------------------------------

/**
 * Begins a turn. `ace` is optional and describes how a second, Ace card is
 * being spent alongside the main one: as a +1 movement booster, or to create
 * one extra memory of either card's suit.
 */
export function playCard(s, { cardId: mainId, ace }) {
  const p = currentPlayer(s);
  const main = p.hand.find((c) => c.id === mainId);
  if (!main) throw new Error("card not in hand");
  const aceCard = ace ? p.hand.find((c) => c.id === ace.cardId) : null;
  if (ace && (!aceCard || !isAce(aceCard))) throw new Error("ace not in hand");

  const base = cardValue(s.board, main);
  const allowance = base + (ace?.mode === "boost" ? 1 : 0);
  s.turn = {
    card: main,
    ace: ace ? { card: aceCard, mode: ace.mode, suit: ace.suit ?? main.suit } : null,
    allowance,
    from: p.city,
    path: [p.city],
    legs: [],
    stepsUsed: 0,
    spent: 0,
    stage: "moving",
    gained: [],
    roadTrip: null,
    pendingTrip: null,
  };
  log(s, `plays ${main.id}${aceCard ? ` with ${aceCard.id} (${ace.mode})` : ""} — up to ${allowance} step${allowance > 1 ? "s" : ""}`);
  return s;
}

/** Routes the mover may legally take next, given the steps left on the card. */
export function movementOptions(s, graph) {
  const t = s.turn;
  if (!t || (t.stage !== "moving" && t.stage !== "roadtrip-moving")) return [];
  const at = t.stage === "moving" ? t.path[t.path.length - 1] : t.roadTrip.path[t.roadTrip.path.length - 1];
  const left = t.stage === "moving"
    ? t.allowance - t.stepsUsed
    : t.roadTrip.allowance - t.roadTrip.stepsUsed;
  return (graph.get(at) || []).filter((e) => e.route.steps <= left);
}

export function stepTo(s, graph, cityId) {
  const t = s.turn;
  const opt = movementOptions(s, graph).find((e) => e.to === cityId);
  if (!opt) throw new Error("not a legal step");
  const p = currentPlayer(s);
  const cost = routeCost(s.board, opt.route);

  if (t.stage === "moving") {
    t.path.push(cityId);
    t.legs.push(opt.route);
    t.stepsUsed += opt.route.steps;
    t.spent += cost;
    p.spent += cost;
    p.city = cityId;
  } else {
    const rt = t.roadTrip;
    rt.path.push(cityId);
    rt.legs.push(opt.route);
    rt.stepsUsed += opt.route.steps;
    // Who rode this leg (and so paid for it) — needed to undo the step exactly.
    (rt.legRiders ??= []).push(rt.riders.filter((c) => c.droppedAt === null).map((c) => c.id));
    // The driver pays the travel cost for the leg; companions still aboard pay
    // their own flight and ferry surcharge and owe the driver per step.
    p.spent += cost;
    rt.driverPaid += cost;
    for (const c of rt.riders) {
      if (c.droppedAt !== null) continue;
      const rider = s.players[c.id];
      rider.spent += opt.route.surcharge || 0;
      rider.spent += s.board.economy.roadTripSharePerStep * opt.route.steps;
      p.spent -= s.board.economy.roadTripSharePerStep * opt.route.steps;
      c.stepsTravelled += opt.route.steps;
      rider.city = cityId;
      // Reaching their pre-agreed stop drops them off automatically; the
      // manual "drop off" action still exists for anyone who wants off
      // somewhere the drive doesn't end up passing through, or earlier.
      if (c.stopAt === cityId) {
        c.droppedAt = cityId;
        log(s, `gets off at ${cityOf(s, cityId).name} as planned`, rider);
      }
    }
    p.city = cityId;
  }
  return s;
}

/**
 * Takes back the last step — of your own move, or of a road trip under way.
 * On a road trip every rider who travelled that leg goes back with the group:
 * their ₹100 a step and any surcharge are refunded (and the driver gives back
 * what they received), and a rider who got off at the city being left is
 * back on board.
 */
export function undoStep(s) {
  const t = s.turn;
  if (!t) return s;
  const p = currentPlayer(s);
  if (t.stage === "moving") {
    if (t.path.length < 2) return s;
    const route = t.legs.pop();
    t.path.pop();
    t.stepsUsed -= route.steps;
    const cost = routeCost(s.board, route);
    t.spent -= cost;
    p.spent -= cost;
    p.city = t.path[t.path.length - 1];
    return s;
  }
  if (t.stage !== "roadtrip-moving") return s;
  const rt = t.roadTrip;
  if (rt.path.length < 2) return s;
  const leaving = rt.path.pop();
  const route = rt.legs.pop();
  const aboard = rt.legRiders?.pop() ?? [];
  const back = rt.path[rt.path.length - 1];
  const cost = routeCost(s.board, route);
  const share = s.board.economy.roadTripSharePerStep * route.steps;
  rt.stepsUsed -= route.steps;
  p.spent -= cost;
  rt.driverPaid -= cost;
  for (const c of rt.riders) {
    if (!aboard.includes(c.id)) continue;
    const rider = s.players[c.id];
    rider.spent -= (route.surcharge || 0) + share;
    p.spent += share;
    c.stepsTravelled -= route.steps;
    if (c.droppedAt === leaving) c.droppedAt = null;
    rider.city = back;
  }
  p.city = back;
  return s;
}

/**
 * Calls off a road trip that has been confirmed but not yet moved: the card is
 * turned face-up again and the turn goes back to where it was before the trip.
 */
export function cancelRoadTrip(s) {
  const t = s.turn;
  if (t?.stage !== "roadtrip-moving") throw new Error("there is no road trip to call off");
  const rt = t.roadTrip;
  if (rt.stepsUsed > 0) throw new Error("undo the steps first — the road trip has already moved");
  const entry = s.players[rt.owner].faceUp.find((f) => f.card.id === rt.card.id);
  if (entry) entry.flipped = false;
  t.roadTrip = null;
  t.stage = "resolve";
  t.tripsCalledOff = (t.tripsCalledOff || 0) + 1;
  log(s, `calls off the road trip — ${rt.card.id} is face-up again`);
  return s;
}

/** Ends movement: awards memories, then offers tourism and a road trip. */
export function endMovement(s) {
  const t = s.turn;
  const p = currentPlayer(s);
  if (t.stepsUsed < 1) throw new Error("must move at least one step");

  const suit = t.card.suit;
  if (t.stepsUsed === t.allowance) award(s, p, suit, "efficient travel");
  const others = playersAt(s, p.city, p.id);
  if (others.length) award(s, p, suit, `meeting ${others.map((o) => o.name).join(" & ")}`);
  if (t.ace?.mode === "memory") award(s, p, t.ace.suit, `Ace ${t.ace.card.id}`);

  t.stage = "resolve";
  return s;
}

function award(s, p, suit, why) {
  p.memories[suit]++;
  s.turn.gained.push({ player: p.id, suit, why });
  log(s, `makes a ${memoryName(s.board, suit)} memory (${why})`, p);
}

export const memoryName = (board, suit) => board.suits.find((x) => x.id === suit).memory;

// ---------------------------------------------------------------------------
// Tourism
// ---------------------------------------------------------------------------

export function touristHere(s, player) {
  const city = cityOf(s, player.city);
  if (!city.tourist) return null;
  if (player.visited.includes(city.id)) return null;
  return city;
}

/**
 * Who may pay for a tourist visit right now, and at what price. Only after a
 * move has finished (stage "resolve"): the active player at the full price —
 * or, once a road trip has ended, every traveller still aboard at the shared
 * price. The price is always decided here, never taken from the caller.
 */
export function visitOptions(s) {
  const t = s.turn;
  if (!t || t.stage !== "resolve") return [];
  if (t.roadTrip) return sharedVisitors(s).map((id) => ({ playerId: id, price: s.board.economy.sharedTouristVisit, shared: true }));
  const p = currentPlayer(s);
  return touristHere(s, p) ? [{ playerId: p.id, price: s.board.economy.touristVisit, shared: false }] : [];
}

/** `_discounted` is accepted for backward compatibility and ignored — see visitOptions. */
export function visitTourist(s, playerId, _discounted) {
  const opt = visitOptions(s).find((o) => o.playerId === playerId);
  if (!opt) throw new Error("nothing to visit here right now");
  const p = s.players[playerId];
  const city = cityOf(s, p.city);
  p.spent += opt.price;
  p.visited.push(city.id);
  log(s, `visits ${city.name} — ${city.attraction} (₹${opt.price.toLocaleString("en-IN")})`, p);
  if (noteDestination(s, p, city.id)) {
    log(s, `completes a destination goal — ${city.name} (${p.reached.length} of ${characterOf(s, p).goals.length})`, p);
    const need = s.board.scoring.destinationsForBonus;
    if (s.endTriggeredBy === null && p.reached.length >= need) {
      s.endTriggeredBy = p.id;
      s.endTriggerRound = s.round;
      log(s, `triggers the end of the game (${need} destinations completed) — the round is played out`, p);
    }
  }
  return s;
}

// ---------------------------------------------------------------------------
// Road trips
// ---------------------------------------------------------------------------

/**
 * Face-up cards that could be flipped for a road trip. The road-trip card must
 * belong to another participating player — never the active player (the
 * driver) — so the driver's own id is always left out, even if passed in.
 */
export function roadTripCards(s, participantIds) {
  const driver = s.turn ? currentPlayer(s).id : null;
  const out = [];
  for (const id of participantIds) {
    if (id === driver) continue;
    for (const f of s.players[id].faceUp)
      if (!f.flipped) out.push({ owner: id, card: f.card });
  }
  return out;
}

/** Enter the invite step so companions and a face-up card can be chosen. */
export function offerRoadTrip(s) {
  const t = s.turn;
  if (!t || t.stage !== "resolve") throw new Error("no move to offer a road trip from");
  const p = currentPlayer(s);
  const others = playersAt(s, p.city, p.id);
  if (!others.length) throw new Error("nobody here to invite");
  if (!roadTripCards(s, others.map((o) => o.id)).length) throw new Error("nobody here has a face-up road-trip card to flip");
  t.stage = "roadtrip-invite";
  return s;
}

/** Back out of the invite step, a pending invitation, or the review step — anywhere before a trip actually starts. */
export function cancelRoadTripInvite(s) {
  const t = s.turn;
  const cancellableStages = ["roadtrip-invite", "roadtrip-pending", "roadtrip-review"];
  if (!t || !cancellableStages.includes(t.stage)) throw new Error("not offering a road trip");
  t.pendingTrip = null;
  t.stage = "resolve";
  t.tripsCalledOff = (t.tripsCalledOff || 0) + 1;
  return s;
}

/**
 * Sends the invitation — the driver names companions, a face-up card to
 * flip, and the destination they intend to drive to. Each companion now
 * needs to accept (with their own drop-off stop), counter with a different
 * destination, or decline, before the trip actually starts (see
 * respondRoadTrip). Nothing moves and no card is flipped yet.
 */
export function proposeRoadTrip(s, graph, { companions, owner, cardId: rtCardId, destination }) {
  const t = s.turn;
  if (!t || t.stage !== "roadtrip-invite") throw new Error("not offering a road trip");
  if (!companions.length) throw new Error("invite at least one companion");
  const p0 = currentPlayer(s);
  if (new Set(companions).size !== companions.length) throw new Error("a companion was listed twice");
  for (const id of companions) {
    if (!s.players[id] || id === p0.id) throw new Error("not a valid companion");
    if (s.players[id].city !== p0.city) throw new Error(`${s.players[id].name} is not in your city`);
  }
  if (owner === p0.id) throw new Error("the road-trip card must belong to one of your companions, not to you");
  if (!companions.includes(owner)) throw new Error("the road-trip card must belong to someone coming on the trip");
  const holder = s.players[owner];
  const entry = holder.faceUp.find((f) => f.card.id === rtCardId && !f.flipped);
  if (!entry) throw new Error("that road-trip card is not available");
  const allowance = cardValue(s.board, entry.card);
  const p = currentPlayer(s);
  if (!shortestPath(graph, p.city, destination, allowance)) throw new Error("that destination is out of reach on this card");

  t.pendingTrip = { companions, owner, cardId: rtCardId, destination, responses: {} };
  t.stage = "roadtrip-pending";
  log(s, `invites ${companions.map((id) => s.players[id].name).join(" & ")} to ${cityOf(s, destination).name} — proposing to flip ${entry.card.id}`);
  return s;
}

/**
 * One invited companion answers: `{type:"accept", stop}` (ride along, get
 * dropped at `stop` — any city reachable on the proposed card, not
 * necessarily on one exact path), `{type:"counter", destination}` (would
 * come, but only to a different destination — recorded for the driver to
 * see, not acted on automatically), or `{type:"decline"}`. Once everyone
 * invited has answered, the driver gets the final say (see
 * confirmRoadTrip) — unless nobody accepted, in which case it's simply off.
 */
export function respondRoadTrip(s, graph, playerId, response) {
  const t = s.turn;
  const pt = t?.pendingTrip;
  if (!pt) throw new Error("no road-trip invitation to respond to");
  if (!pt.companions.includes(playerId)) throw new Error("you were not invited on this road trip");
  if (playerId in pt.responses) throw new Error("you already responded");

  const driver = currentPlayer(s);
  const entry = s.players[pt.owner].faceUp.find((f) => f.card.id === pt.cardId);
  if (!entry) throw new Error("that road-trip card is no longer available");
  const allowance = cardValue(s.board, entry.card);
  if (response.type === "accept") {
    const stop = response.stop ?? pt.destination;
    if (!shortestPath(graph, driver.city, stop, allowance)) throw new Error("that stop is out of reach on this card");
    pt.responses[playerId] = { type: "accept", stop };
    log(s, `joins the road trip, getting off at ${cityOf(s, stop).name}`, s.players[playerId]);
  } else if (response.type === "counter") {
    if (!shortestPath(graph, driver.city, response.destination, allowance)) throw new Error("that destination is out of reach on this card");
    pt.responses[playerId] = { type: "counter", destination: response.destination };
    log(s, `would rather go to ${cityOf(s, response.destination).name}`, s.players[playerId]);
  } else {
    pt.responses[playerId] = { type: "decline" };
    log(s, "declines the road trip", s.players[playerId]);
  }

  if (!pt.companions.every((id) => id in pt.responses)) return s; // still waiting on others

  const accepted = pt.companions.filter((id) => pt.responses[id].type === "accept");
  if (!accepted.length) {
    log(s, "nobody wanted to come along — the road trip is off");
    t.pendingTrip = null;
    t.stage = "resolve";
    t.tripsCalledOff = (t.tripsCalledOff || 0) + 1;
    return s;
  }
  // The flipped card has to belong to a participant: if its owner isn't coming, it can't be used.
  if (!accepted.includes(pt.owner)) {
    log(s, "isn't coming, so their card can't be flipped — the road trip is off", s.players[pt.owner]);
    t.pendingTrip = null;
    t.stage = "resolve";
    t.tripsCalledOff = (t.tripsCalledOff || 0) + 1;
    return s;
  }
  t.stage = "roadtrip-review"; // the driver confirms or cancels next — see confirmRoadTrip
  return s;
}

/**
 * The driver's final word once every invited companion has answered: starts
 * the trip with whoever accepted (flipping the card only now), each given a
 * `stopAt` so stepTo can drop them automatically when the drive passes
 * through it — or cancels the whole thing (same as cancelRoadTripInvite).
 */
export function confirmRoadTrip(s) {
  const t = s.turn;
  const pt = t?.pendingTrip;
  if (!pt || t.stage !== "roadtrip-review") throw new Error("nothing to confirm");
  const p = currentPlayer(s);
  const holder = s.players[pt.owner];
  const entry = holder.faceUp.find((f) => f.card.id === pt.cardId && !f.flipped);
  if (!entry) throw new Error("that road-trip card is no longer available");
  entry.flipped = true;

  const accepted = pt.companions.filter((id) => pt.responses[id].type === "accept");
  t.roadTrip = {
    card: entry.card,
    owner: pt.owner,
    allowance: cardValue(s.board, entry.card),
    stepsUsed: 0,
    driverPaid: 0,
    start: p.city,
    destination: pt.destination, // the proposed destination (the driver may still stop sooner)
    path: [p.city],
    legs: [],
    riders: accepted.map((id) => ({ id, stopAt: pt.responses[id].stop, stepsTravelled: 0, droppedAt: null })),
  };
  t.pendingTrip = null;
  t.stage = "roadtrip-moving";
  log(s, `sets off with ${accepted.map((id) => s.players[id].name).join(" & ")} — flips ${entry.card.id}`);
  return s;
}

export function dropOff(s, riderId) {
  if (s.turn?.stage !== "roadtrip-moving") throw new Error("nobody can get off — the road trip is not under way");
  const rt = s.turn.roadTrip;
  const rider = rt.riders.find((r) => r.id === riderId);
  if (!rider || rider.droppedAt !== null) return s;
  rider.droppedAt = rt.path[rt.path.length - 1];
  log(s, `gets off at ${cityOf(s, rider.droppedAt).name}`, s.players[riderId]);
  return s;
}

export function endRoadTrip(s) {
  const t = s.turn;
  const rt = t.roadTrip;
  const p = currentPlayer(s);
  if (rt.stepsUsed < 1) throw new Error("a road trip must cover at least one step");

  const suit = rt.card.suit;
  award(s, p, suit, "road trip");
  for (const r of rt.riders) award(s, s.players[r.id], suit, "road trip");
  if (rt.stepsUsed === rt.allowance) award(s, p, suit, "efficient travel");

  // A player already standing where the trip ends, who was not on it, does
  // NOT get the road-trip memory — only the travellers who took part do.

  t.stage = "resolve";
  return s;
}

/** Riders still aboard at the end of the trip get the shared tourism price. */
export function sharedVisitors(s) {
  const rt = s.turn?.roadTrip;
  if (!rt) return [];
  const p = currentPlayer(s);
  // A rider whose chosen stop *is* the place the trip ends was aboard for the
  // whole trip (stepTo marks them "dropped" on arrival) and keeps the discount;
  // anyone who got off earlier forfeits it.
  const end = rt.path[rt.path.length - 1];
  const rodeToEnd = (r) => r.droppedAt === null || (r.droppedAt === end && r.stepsTravelled === rt.stepsUsed);
  return [p.id, ...rt.riders.filter(rodeToEnd).map((r) => r.id)]
    .filter((id) => s.players[id].city === p.city && touristHere(s, s.players[id]));
}

// ---------------------------------------------------------------------------
// Ending a turn, and the game
// ---------------------------------------------------------------------------

export function endTurn(s) {
  const t = s.turn;
  const p = currentPlayer(s);

  // Played cards go face-up in front of the player and stay available as future
  // road-trip cards.
  const played = [t.card, ...(t.ace ? [t.ace.card] : [])];
  for (const c of played) {
    p.hand = p.hand.filter((h) => h.id !== c.id);
    p.faceUp.push({ card: c, flipped: false });
  }

  // (Completing the fifth destination triggers the end straight away, in visitTourist.)
  if (s.endTriggeredBy === null && p.hand.length === 0) {
    s.endTriggeredBy = p.id;
    s.endTriggerRound = s.round;
    log(s, "triggers the end of the game (last card played) — the round is played out", p);
  }

  s.turn = null;
  s.turnIndex++;
  if (s.turnIndex >= s.players.length) { s.turnIndex = 0; s.round++; }

  // The trigger round is finished so that everyone has had the same number of turns.
  if (s.endTriggeredBy !== null && s.turnIndex === 0 && s.round > s.endTriggerRound) {
    s.phase = "over";
    return s;
  }
  // A player with no cards left cannot take a turn; skip to the next who can.
  let guard = 0;
  while (currentPlayer(s).hand.length === 0 && guard++ < s.players.length * 2) {
    s.turnIndex++;
    if (s.turnIndex >= s.players.length) { s.turnIndex = 0; s.round++; }
    if (s.endTriggeredBy !== null && s.turnIndex === 0 && s.round > s.endTriggerRound) { s.phase = "over"; return s; }
  }
  if (s.players.every((pl) => pl.hand.length === 0)) s.phase = "over";
  else s.phase = "handover";
  return s;
}

/**
 * The Ace setup rule: a player dealt two or more Aces may, once, discard one
 * of them from the game and draw a replacement from the undealt cards. Only
 * before they have laid their first road-trip card.
 */
export function swapAce(s, playerId, aceId) {
  if (s.phase !== "setup-roadtrip-card") throw new Error("Aces can only be swapped during setup");
  const p = s.players[playerId];
  if (p.aceSwapped) throw new Error("you have already swapped an Ace");
  if (p.faceUp.length) throw new Error("swap before laying your road-trip card");
  if (p.hand.filter(isAce).length < 2) throw new Error("you need two or more Aces to swap one");
  const ace = p.hand.find((c) => c.id === aceId && isAce(c));
  if (!ace) throw new Error("that Ace is not in your hand");
  if (!s.leftover?.length) throw new Error("no cards are left to draw — ask for a reshuffle instead");
  const drawn = s.leftover.pop();
  p.hand = p.hand.filter((c) => c.id !== aceId).concat({ ...drawn, id: cardId(drawn) });
  p.aceSwapped = true;
  (s.discarded ??= []).push(ace);
  s.log.push({ round: s.round, player: p.name, text: `discards ${ace.id} (two Aces) and draws a replacement` });
  return s;
}

/**
 * When a player holds two or more Aces and there is nothing left to draw from,
 * they may ask for a reshuffle: every hand is dealt again from a fresh shuffle.
 * Only allowed before anyone has laid a road-trip card, so nothing is undone.
 */
export function requestReshuffle(s, playerId) {
  if (s.phase !== "setup-roadtrip-card") throw new Error("a reshuffle can only be asked for during setup");
  const p = s.players[playerId];
  if (p.hand.filter(isAce).length < 2) throw new Error("only a player holding two or more Aces can ask for a reshuffle");
  if (s.leftover?.length) throw new Error("there are still cards to draw — swap an Ace instead");
  if (s.players.some((pl) => pl.faceUp.length)) throw new Error("too late — a road-trip card has already been laid");
  s.seed = (Math.imul(s.seed >>> 0 || 1, 1103515245) + 12345) >>> 0;
  const { hands, leftover } = deal(s.board, s.players.length, s.seed);
  s.players.forEach((pl, i) => { pl.hand = hands[i].map((c) => ({ ...c, id: cardId(c) })); pl.aceSwapped = false; });
  s.leftover = leftover;
  s.log.push({ round: s.round, player: p.name, text: "holds two Aces with nothing left to draw — asks for a reshuffle; every hand is dealt again" });
  return s;
}

/** Lays a player's first face-up road-trip card during setup. */
export function layRoadTripCard(s, playerId, id) {
  const p = s.players[playerId];
  const card = p.hand.find((c) => c.id === id);
  if (!card) throw new Error("card not in hand");
  p.hand = p.hand.filter((c) => c.id !== id);
  p.faceUp.push({ card, flipped: false });
  if (s.players.every((pl) => pl.faceUp.length > 0)) { s.phase = "handover"; s.turnIndex = 0; }
  else s.turnIndex++;
  return s;
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

export function scorePlayer(s, p) {
  const sc = s.board.scoring;
  const ch = characterOf(s, p);
  const goalCities = new Set(ch.goals.map((g) => g.city));

  const tourist = p.visited.length * sc.touristPlace;
  const destinations = p.reached.filter((c) => goalCities.has(c)).length * sc.destination;
  const reachedCount = p.reached.filter((c) => goalCities.has(c)).length;
  const bonus = reachedCount >= sc.destinationsForBonus ? sc.allDestinationsBonus : 0;

  // A memory may count once in a same-suit set and once in a four-suit set.
  const counts = SUITS.map((x) => p.memories[x]);
  const sameSuitSets = counts.reduce((n, c) => n + Math.floor(c / 3), 0);
  const fourSuitSets = Math.min(...counts);
  const memories = sameSuitSets * sc.sameSuitSet + fourSuitSets * sc.fourSuitSet;

  const over = Math.max(0, p.spent - s.board.economy.startingBudget);
  const penalty = -Math.ceil(over / sc.overBudgetBlock) * sc.overBudgetPenalty;

  return {
    tourist, touristCount: p.visited.length,
    destinations, reachedCount, bonus,
    sameSuitSets, fourSuitSets, memories,
    over, penalty,
    total: tourist + destinations + bonus + memories + penalty,
  };
}

export const finalScores = (s) =>
  s.players.map((p) => ({ player: p, ...scorePlayer(s, p) })).sort((a, b) => b.total - a.total);

// ---------------------------------------------------------------------------
// Save / resume
// ---------------------------------------------------------------------------

const SAVE_KEY = "rahee.save.v1";

export function save(s) {
  const { board, ...rest } = s;
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(rest)); } catch { /* storage may be unavailable */ }
}
export function loadSave(board) {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    s.board = board;
    // Route objects inside a suspended turn must point back at the live board.
    const find = (r) => board.routes.find((x) => x.from === r.from && x.to === r.to && x.type === r.type);
    if (s.turn) {
      s.turn.legs = (s.turn.legs || []).map(find);
      if (s.turn.roadTrip) s.turn.roadTrip.legs = (s.turn.roadTrip.legs || []).map(find);
    }
    return s;
  } catch { return null; }
}
export function clearSave() {
  try { localStorage.removeItem(SAVE_KEY); } catch { /* ignore */ }
}
