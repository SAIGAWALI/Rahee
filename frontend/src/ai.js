// Computer players for RAHEE.
//
// One function, chooseAction(), looks at the game exactly as a seat sees it —
// its own hand plus the public table (the same redacted state the server sends
// a browser) — and returns the next action that seat should send, in the very
// same {name, args} shape a human's browser sends. So a bot can never do
// anything a person couldn't, every bot move goes through the same rules engine
// checks, and the same code drives:
//   - computer players filling empty seats in an online room (backend/bots.js),
//   - the headless play-test runner (tools/playtest.mjs),
//   - the server end-to-end test (tools/test-server.mjs).
//
// Two levels:
//   "easy"   — random but legal: any card, any reachable city, visits and road
//              trips on a coin toss. Good for finding rule edge cases.
//   "greedy" — a one-turn planner: scores every card × every reachable city by
//              points it would earn now (stamps, destinations, memory sets,
//              efficient travel, road-trip chances) minus money (only what would
//              push it over budget really hurts) plus how much closer it gets
//              to its remaining destinations. Plays a sensible game; not a
//              deep search.
//
// Nothing here changes state: it only reads, and returns an action or null.
import * as E from "./engine.js";

const distCache = new WeakMap();
/** All-pairs step distances (BFS per city; every route costs route.steps). */
function distances(graph) {
  let d = distCache.get(graph);
  if (d) return d;
  d = new Map();
  for (const src of graph.keys()) {
    const dist = new Map([[src, 0]]);
    const queue = [src];
    while (queue.length) {
      const u = queue.shift();
      for (const e of graph.get(u)) {
        const nd = dist.get(u) + e.route.steps;
        if (!dist.has(e.to) || nd < dist.get(e.to)) { dist.set(e.to, nd); queue.push(e.to); }
      }
    }
    d.set(src, dist);
  }
  distCache.set(graph, d);
  return d;
}

const treeCache = new WeakMap();
/** Shortest-path tree from `from` (Dijkstra on route.steps), optionally without flights. */
function tree(graph, from, noFlights) {
  let per = treeCache.get(graph);
  if (!per) { per = new Map(); treeCache.set(graph, per); }
  const key = `${from}|${noFlights ? 1 : 0}`;
  if (per.has(key)) return per.get(key);
  const dist = new Map([[from, 0]]), prev = new Map(), done = new Set();
  for (;;) {
    let u = null, best = Infinity;
    for (const [id, d] of dist) if (!done.has(id) && d < best) { best = d; u = id; }
    if (u === null) break;
    done.add(u);
    for (const e of graph.get(u)) {
      if (noFlights && e.route.type === "flight") continue;
      const nd = best + e.route.steps;
      if (!dist.has(e.to) || nd < dist.get(e.to)) { dist.set(e.to, nd); prev.set(e.to, { from: u, route: e.route }); }
    }
  }
  const t = { dist, prev };
  per.set(key, t);
  return t;
}
function pathFrom(t, from, to) {
  const edges = [];
  for (let cur = to; cur !== from;) { const p = t.prev.get(cur); edges.unshift({ to: cur, route: p.route }); cur = p.from; }
  return { edges, totalSteps: t.dist.get(to) };
}

/**
 * Every city reachable from `from` within `maxSteps`, with the route the game
 * would pick (roads and ships first, a flight only when nothing else fits —
 * the same preference as engine.shortestPath).
 */
function reachable(graph, from, maxSteps) {
  const out = [];
  const road = tree(graph, from, true), any = tree(graph, from, false);
  for (const [to, d] of any.dist) {
    if (to === from || d > maxSteps) continue;
    const rd = road.dist.get(to);
    out.push({ to, route: rd !== undefined && rd <= maxSteps ? pathFrom(road, from, to) : pathFrom(any, from, to) });
  }
  return out;
}

const routeMoney = (board, route) => route.edges.reduce((t, e) => t + E.routeCost(board, e.route), 0);

/** Points this player's memory sets are worth with these counts. */
function memoryPoints(board, m) {
  const c = E.SUITS.map((s) => m[s]);
  return c.reduce((n, x) => n + Math.floor(x / 3), 0) * board.scoring.sameSuitSet + Math.min(...c) * board.scoring.fourSuitSet;
}
/** Marginal value of one more memory of `suit`: the score it adds now, plus a little for progress towards a set. */
function memoryValue(board, mem, suit, extra = 0) {
  const m = { ...mem }; m[suit] += extra;
  const before = memoryPoints(board, m);
  m[suit] += 1;
  return memoryPoints(board, m) - before + 3.5;
}

/** What a rupee is worth in points for this player right now. Money only scores when you go over budget. */
function moneyWeight(board, p, handLeft) {
  const sc = board.scoring;
  const perRupee = sc.overBudgetPenalty / sc.overBudgetBlock; // 0.01 pts per rupee once over
  const left = board.economy.startingBudget - p.spent;
  // Expect roughly ₹1,600 of travel per turn still to come.
  const headroom = left - handLeft * 1600;
  if (headroom <= 0) return perRupee * 1.1;
  if (headroom < 4000) return perRupee * 0.7;
  return perRupee * 0.35;
}

const ownGoals = (s, p) => E.characterOf(s, p).goals.map((g) => g.city);
const openGoals = (s, p) => ownGoals(s, p).filter((c) => !p.reached.includes(c));

/** How far (in steps) the nearest open destination is from a city. */
function goalDistance(s, graph, p, city, without = null) {
  const dist = distances(graph).get(city);
  let best = Infinity;
  for (const g of openGoals(s, p)) if (g !== without) best = Math.min(best, dist.get(g) ?? Infinity);
  return best;
}

/**
 * Score of ending a move at `to` for player p — points earned (assuming it
 * pays to visit when worthwhile), minus money, plus positional value.
 * opts: { suit, allowance, stepsTotal, route, shared, handLeft, extraMem }
 */
function placeValue(s, graph, p, to, o) {
  const board = s.board;
  const sc = board.scoring;
  const w = moneyWeight(board, p, o.handLeft);
  let v = 0;
  const travel = o.route ? routeMoney(board, o.route) : 0;
  v -= travel * w;

  const city = E.cityOf(s, to);
  const isGoal = openGoals(s, p).includes(to);
  if (city.tourist && !p.visited.includes(to)) {
    const price = o.shared ? board.economy.sharedTouristVisit : board.economy.touristVisit;
    let gain = sc.touristPlace;
    if (isGoal) {
      gain += sc.destination + P.goalDone;
      if (p.reached.length + 1 === sc.destinationsForBonus) gain += sc.allDestinationsBonus;
    }
    const net = gain - price * w;
    if (net > 0) v += net;
  }
  // memories
  let extra = o.extraMem || 0;
  if (o.allowance && o.stepsTotal === o.allowance) { v += memoryValue(board, p.memories, o.suit, extra); extra++; }
  if (s.players.some((q) => q.id !== p.id && q.city === to)) {
    // no memory for meeting someone — only the chance to take a road trip from there
    const cards = E.roadTripCards({ ...s, turn: null }, s.players.filter((q) => q.id !== p.id && q.city === to).map((q) => q.id));
    if (cards.length) v += 2.5;
  }
  // getting closer to what is still left to do
  const gd = goalDistance(s, graph, p, to, isGoal ? to : null);
  if (Number.isFinite(gd)) v -= gd * P.pull;
  // any unvisited stamp a short hop away is worth something too
  return v;
}

function legalHandCombos(s, p) {
  const combos = [];
  for (const c of p.hand) {
    combos.push({ main: c, ace: null, allowance: E.cardValue(s.board, c) });
    if (E.isAce(c)) continue;
    for (const a of p.hand.filter((x) => E.isAce(x) && x.id !== c.id)) {
      combos.push({ main: c, ace: { cardId: a.id, mode: "boost", suit: c.suit }, allowance: E.cardValue(s.board, c) + 1 });
      combos.push({ main: c, ace: { cardId: a.id, mode: "memory", suit: c.suit }, allowance: E.cardValue(s.board, c), memSuit: c.suit });
      if (a.suit !== c.suit) combos.push({ main: c, ace: { cardId: a.id, mode: "memory", suit: a.suit }, allowance: E.cardValue(s.board, c), memSuit: a.suit });
    }
  }
  return combos;
}

/** Best (to, route, value) for a mover at `from`, with steps left and steps already used. */
function bestDestination(s, graph, p, from, left, used, ctx) {
  let best = null;
  for (const { to, route } of reachable(graph, from, left)) {
    const v = placeValue(s, graph, p, to, { ...ctx, route, stepsTotal: used + route.totalSteps });
    if (!best || v > best.v) best = { to, route, v };
  }
  return best;
}

// Personality knobs, per level (set at the start of each chooseAction call):
//   pull     — points per step of distance to the nearest remaining destination
//   goalDone — extra worth of ticking a destination off. Play-testing showed
//              that pure point-chasing bots (goalDone 0) huddle together for
//              road-trip memories and rarely finish destinations;
//              the "goals" personality chases its character card instead.
const LEVELS = {
  greedy: { pull: 0.9, goalDone: 0 },
  goals: { pull: 1.2, goalDone: 12 },
};
let P = LEVELS.greedy;
/** The levels a computer player can be given (ids, for the lobby and the play-test runner). */
export const BOT_LEVELS = [
  { id: "greedy", label: "planner", blurb: "plans each turn for the most points" },
  { id: "goals", label: "goal-chaser", blurb: "races to its character's destinations" },
  { id: "easy", label: "easy", blurb: "random but legal moves" },
];

const pick = (rand, arr) => arr[Math.floor(rand() * arr.length)];

/**
 * The next action for `seat`, or null if this seat has nothing to do right now.
 * `s` may be the full server state or a seat's redacted view — only public
 * fields and this seat's own hand are read.
 */
export function chooseAction(s, graph, seat, { level = "greedy", rand = Math.random } = {}) {
  if (!s || s.phase === "over") return null;
  const me = s.players[seat];
  const cur = E.currentPlayer(s);
  const t = s.turn;
  const easy = level === "easy";
  P = LEVELS[level] ?? LEVELS.greedy;

  // ---- setup: maybe swap an Ace, then lay the first road-trip card
  if (s.phase === "setup-roadtrip-card") {
    if (!me.faceUp.length && !me.aceSwapped && me.hand.filter(E.isAce).length >= 2) {
      const pile = s.leftover ? s.leftover.length : (s.leftoverCount ?? 0);
      const ace = me.hand.find(E.isAce);
      if (pile > 0) return { name: "swapAce", args: { cardId: ace.id } };
      if (!s.players.some((q) => q.faceUp.length)) return { name: "requestReshuffle", args: {} };
    }
    if (cur.id !== seat) return null;
    const high = new Set(E.dealSpec(s.board, s.players.length).guaranteed);
    const options = me.hand.filter((c) => !high.has(c.rank) && !E.isAce(c));
    const pool = options.length ? options : me.hand;
    // Lay a middling card: it is what others will flip to take you along.
    const card = easy ? pick(rand, pool) : pool.slice().sort((a, b) => Math.abs(E.cardValue(s.board, a) - 4) - Math.abs(E.cardValue(s.board, b) - 4))[0];
    return { name: "layRoadTripCard", args: { cardId: card.id } };
  }

  // ---- answering a road-trip invitation (any seat, any time)
  if (t?.stage === "roadtrip-pending" && t.pendingTrip.companions.includes(seat) && !(seat in t.pendingTrip.responses)) {
    return respondToInvite(s, graph, me, easy, rand);
  }

  // ---- a rider who came along may pay the shared stamp price after the trip
  if (t?.stage === "resolve" && cur.id !== seat) {
    const v = E.visitOptions(s).find((o) => o.playerId === seat);
    if (!v) return null;
    // Decide either way, so a driver waiting on the riders can carry on.
    return worthVisiting(s, me, v.price, easy, rand)
      ? { name: "visitTourist", args: { playerId: seat } }
      : { name: "passVisit", args: {} };
  }

  if (cur.id !== seat) return null;

  // ---- my turn
  if (!t) {
    if (!me.hand.length) return null;
    // Start the turn with a road trip from here, if someone here has a card worth flipping.
    if (E.canStartRoadTrip(s) && !s.turnFlags?.startTripsCalledOff && planRoadTrip(s, graph, me, easy, rand, false, true))
      return { name: "offerStartRoadTrip", args: {} };
    if (easy) {
      const c = pick(rand, me.hand);
      return { name: "playCard", args: { cardId: c.id, ace: null } };
    }
    const handLeft = me.hand.length - 1;
    let best = null;
    for (const combo of legalHandCombos(s, me)) {
      const suit = combo.main.suit;
      const extraMem = combo.memSuit ? 1 : 0;
      const dest = bestDestination(s, graph, me, me.city, combo.allowance, 0, { suit, allowance: combo.allowance, handLeft, extraMem });
      if (!dest) continue;
      let v = dest.v + (combo.memSuit ? memoryValue(s.board, me.memories, combo.memSuit) : 0);
      // Cards are the whole itinerary: spending a big card on a short hop wastes it.
      v -= Math.max(0, combo.allowance - dest.route.totalSteps) * 0.55;
      if (combo.ace) v -= 1.2; // an Ace is a card too
      if (!best || v > best.v) best = { v, combo };
    }
    const c = best?.combo ?? { main: me.hand[0], ace: null };
    return { name: "playCard", args: { cardId: c.main.id, ace: c.ace } };
  }

  if (t.stage === "moving") {
    const left = t.allowance - t.stepsUsed;
    const at = t.path[t.path.length - 1];
    if (left <= 0) return { name: "endMovement", args: {} };
    if (easy) {
      if (t.stepsUsed >= 1 && rand() < 0.3) return { name: "endMovement", args: {} };
      const opts = E.movementOptions(s, graph);
      return opts.length ? { name: "stepTo", args: { cityId: pick(rand, opts).to } } : { name: "endMovement", args: {} };
    }
    const ctx = { suit: t.card.suit, allowance: t.allowance, handLeft: me.hand.length - 1, extraMem: t.ace?.mode === "memory" ? 1 : 0 };
    const go = bestDestination(s, graph, me, at, left, t.stepsUsed, ctx);
    const stay = t.stepsUsed >= 1 ? placeValue(s, graph, me, at, { ...ctx, route: null, stepsTotal: t.stepsUsed }) : -Infinity;
    if (!go || stay >= go.v) return { name: "endMovement", args: {} };
    return { name: "stepTo", args: { cityId: go.route.edges[0].to } };
  }

  if (t.stage === "resolve" && t.preTrip) {
    const v = E.visitOptions(s).find((o) => o.playerId === seat);
    if (v && worthVisiting(s, me, v.price, easy, rand)) return { name: "visitTourist", args: { playerId: seat } };
    if (E.ridersStillDeciding(s).length) return null; // let the companions decide on the stamp first
    return { name: "finishStartTrip", args: {} };
  }

  if (t.stage === "resolve") {
    const v = E.visitOptions(s).find((o) => o.playerId === seat);
    if (v && worthVisiting(s, me, v.price, easy, rand)) return { name: "visitTourist", args: { playerId: seat } };
    // After a road trip, give the companions their chance at the shared stamp before ending the turn.
    if (t.roadTrip && E.ridersStillDeciding(s).length) return null;
    // Don't keep inviting people who have just said no (or a trip already called off) this turn.
    if (!t.roadTrip && !t.tripsCalledOff && !s.turnFlags?.tripTaken) {
      const plan = planRoadTrip(s, graph, me, easy, rand);
      if (plan) return { name: "offerRoadTrip", args: {} };
    }
    return { name: "endTurn", args: {} };
  }

  if (t.stage === "roadtrip-invite") {
    const plan = planRoadTrip(s, graph, me, easy, rand, true, !!t.preTrip);
    if (!plan) return { name: "cancelRoadTripInvite", args: {} };
    return { name: "proposeRoadTrip", args: plan };
  }
  if (t.stage === "roadtrip-pending") return null; // waiting on the invited
  if (t.stage === "roadtrip-review") return { name: "confirmRoadTrip", args: {} };

  if (t.stage === "roadtrip-moving") {
    const rt = t.roadTrip;
    const at = rt.path[rt.path.length - 1];
    const left = rt.allowance - rt.stepsUsed;
    if (left <= 0 || at === rt.destination) return { name: "endRoadTrip", args: {} };
    const route = rt.destination ? E.shortestPath(graph, at, rt.destination, left) : null;
    if (!route || !route.edges.length) return rt.stepsUsed >= 1 ? { name: "endRoadTrip", args: {} } : { name: "stepTo", args: { cityId: E.movementOptions(s, graph)[0].to } };
    return { name: "stepTo", args: { cityId: route.edges[0].to } };
  }
  return null;
}

function worthVisiting(s, me, price, easy, rand) {
  if (easy) return rand() < 0.6;
  const city = E.cityOf(s, me.city);
  const sc = s.board.scoring;
  let gain = sc.touristPlace;
  if (openGoals(s, me).includes(city.id)) gain += sc.destination + P.goalDone + (me.reached.length + 1 === sc.destinationsForBonus ? sc.allDestinationsBonus : 0);
  return gain > price * moneyWeight(s.board, me, me.hand.length);
}

/**
 * A road trip worth taking from here, as proposeRoadTrip args — or null.
 * Everyone here who holds an unflipped card is a candidate owner; we invite
 * everyone present (more riders = more ₹100s back and more memories made).
 */
function planRoadTrip(s, graph, me, easy, rand, committed = false, startOfTurn = false) {
  const others = E.playersAt(s, me.city, me.id);
  if (!others.length) return null;
  const cards = E.roadTripCards(s, others.map((o) => o.id));
  if (!cards.length) return null;
  if (easy) {
    if (!committed && rand() < 0.5) return null;
    const c = pick(rand, cards);
    const dests = reachable(graph, me.city, E.cardValue(s.board, c.card));
    if (!dests.length) return null;
    return { companions: others.map((o) => o.id), owner: c.owner, cardId: c.card.id, destination: pick(rand, dests).to };
  }
  let best = null;
  for (const c of cards) {
    const allowance = E.cardValue(s.board, c.card);
    for (const { to, route } of reachable(graph, me.city, allowance)) {
      let v = placeValue(s, graph, me, to, { suit: c.card.suit, allowance, stepsTotal: route.totalSteps, route, shared: true, handLeft: me.hand.length });
      // road-trip memory (none on a start-of-turn trip), and the riders' ₹100 a step coming back
      if (!startOfTurn) v += memoryValue(s.board, me.memories, c.card.suit);
      v += route.totalSteps * s.board.economy.roadTripSharePerStep * others.length * moneyWeight(s.board, me, me.hand.length);
      if (!best || v > best.v) best = { v, plan: { companions: others.map((o) => o.id), owner: c.owner, cardId: c.card.id, destination: to } };
    }
  }
  // Only worth it if it beats simply ending the turn here.
  const stay = placeValue(s, graph, me, me.city, { suit: "spades", route: null, handLeft: me.hand.length });
  return best && best.v > stay + 2 ? best.plan : null;
}

function respondToInvite(s, graph, me, easy, rand) {
  const pt = s.turn.pendingTrip;
  const driver = E.currentPlayer(s);
  const owner = s.players[pt.owner];
  const card = owner.faceUp.find((f) => f.card.id === pt.cardId)?.card;
  if (!card) return { name: "respondRoadTrip", args: { type: "decline" } };
  const allowance = E.cardValue(s.board, card);
  if (easy) {
    const r = rand();
    if (r < 0.2) return { name: "respondRoadTrip", args: { type: "decline" } };
    return { name: "respondRoadTrip", args: { type: "accept", stop: pt.destination } };
  }
  // If my card is the one being flipped, my coming along is what makes the trip happen.
  const route = E.shortestPath(graph, driver.city, pt.destination, allowance);
  if (!route) return { name: "respondRoadTrip", args: { type: "decline" } };
  // Best place to get off along the driver's route (the end keeps the shared stamp price).
  const stops = route.edges.map((e, i) => ({ to: e.to, steps: i + 1 }));
  const w = moneyWeight(s.board, me, me.hand.length);
  let best = null;
  for (const st of stops) {
    const atEnd = st.to === pt.destination;
    let v = placeValue(s, graph, me, st.to, { suit: card.suit, route: null, shared: atEnd, handLeft: me.hand.length });
    if (!s.turn.preTrip) v += memoryValue(s.board, me.memories, card.suit); // the road-trip memory (riders get none on a start-of-turn trip)
    v -= st.steps * s.board.economy.roadTripSharePerStep * w;
    const surcharges = route.edges.slice(0, st.steps).reduce((t, e) => t + (e.route.surcharge || 0), 0);
    v -= surcharges * w;
    if (!best || v > best.v) best = { v, stop: st.to };
  }
  const stayHere = placeValue(s, graph, me, me.city, { suit: card.suit, route: null, handLeft: me.hand.length });
  if (best && best.v > stayHere - 1) return { name: "respondRoadTrip", args: { type: "accept", stop: best.stop } };
  return { name: "respondRoadTrip", args: { type: "decline" } };
}

/** Which seats have something to do right now (for whoever is driving bots). */
export function seatsToAct(s, graph, seats, opts) {
  const out = [];
  for (const seat of seats) {
    const a = chooseAction(s, graph, seat, opts?.[seat]);
    if (a) out.push({ seat, action: a });
  }
  return out;
}

/** Friendly names for computer players. */
export const BOT_NAMES = ["Meera", "Arjun", "Kavya", "Rohan", "Ishita", "Dev", "Tara", "Kabir"];
