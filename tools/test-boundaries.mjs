// Test Phase 2. Equivalence partitioning, boundary-value analysis and pairwise
// testing of the rules, as in the CS 202 testing lecture.
//
//   1. Boundary values: for each input that has a range, test the minimum, just
//      inside, the maximum and just outside it:
//        - movement: every card value (A=1 ... 10/J=10, and the Ace boost)
//          moves exactly that many steps, not one more, and never zero
//        - over-budget penalty around ₹20,000 and each ₹500 block
//        - memory sets around 3 of a suit and 1 of every suit
//        - the destination bonus around 5 completed destinations
//        - player counts 1 (invalid), 2 (min) ... 6 (max), 7 (invalid)
//   2. Equivalence classes: one representative of each kind of route (road,
//      flight, each ship) charged correctly; each Ace use (boost, memory, not
//      an Ace, not in hand) handled correctly.
//   3. Pairwise: the game settings below are combined so that every PAIR of
//      values appears in at least one game (an all-pairs covering array), and
//      every one of those games is played to the end with the rules checked
//      after every move. This covers in a few dozen games what would take
//      hundreds to cover exhaustively.
//
//   node tools/test-boundaries.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const imp = (p) => import(pathToFileURL(path.join(root, p)).href);
const E = await imp("frontend/src/engine.js");
const { chooseAction } = await imp("frontend/src/ai.js");
const { applyAction } = await imp("backend/actions.js");
const { redact } = await imp("backend/redact.js");
const board = JSON.parse(fs.readFileSync(path.join(root, "frontend/data/board.json"), "utf8"));
const graph = E.buildGraph(board);
const econ = board.economy, sc = board.scoring;

let failures = 0, total = 0;
const sections = [];
const section = (name) => sections.push({ name, checks: 0, failed: 0 });
const check = (cond, msg) => {
  total++;
  const cur = sections[sections.length - 1];
  cur.checks++;
  if (!cond) { failures++; cur.failed++; if (cur.failed <= 5) console.log("  FAIL:", msg); }
};
const throws = (fn) => { try { fn(); return false; } catch { return true; } };
const card = (rank, suit) => ({ rank, suit, id: E.cardId({ rank, suit }) });

/** A game already past setup; hands and positions overridden when given. */
function game(n, { hands, at } = {}) {
  const chars = board.characters.map((c) => c.id).slice(0, n);
  const s = E.newGame({ board, seed: 7, players: chars.map((c, i) => ({ name: `P${i}`, characterId: c })) });
  s.phase = "handover";
  s.players.forEach((p, i) => {
    if (hands?.[i]) p.hand = hands[i].map(([r, su]) => card(r, su));
    p.faceUp = [];
    if (at?.[i]) p.city = at[i];
  });
  return s;
}

// A long road-only route to walk along: New Delhi to the far south.
const longRoad = E.shortestPath(graph, "new-delhi", "kanniyakumari", 40);

// --- 1. Boundary values ------------------------------------------------------------------
section("Boundary: movement for every card value (k-1, k, k+1 steps)");
{
  check(longRoad && longRoad.edges.length >= 12 && longRoad.edges.every((e) => e.route.type === "road"), "no long road route to test movement on");
  const cases = [["A", 1], ["2", 2], ["3", 3], ["4", 4], ["5", 5], ["6", 6], ["10", 10], ["J", 10], ["Q", 5], ["K", 5]];
  for (const [rank, k] of cases) {
    const s = game(2, { hands: [[[rank, "clubs"], ["2", "hearts"]], [["3", "spades"]]], at: ["new-delhi"] });
    E.playCard(s, { cardId: card(rank, "clubs").id });
    check(s.turn.allowance === k, `${rank}: allowance ${s.turn.allowance}, expected ${k}`);
    check(throws(() => E.endMovement(s)), `${rank}: ending a move after 0 steps was allowed`);
    let ok = true;
    for (let i = 0; i < k; i++) ok = ok && !throws(() => E.stepTo(s, graph, longRoad.edges[i].to));
    check(ok && s.turn.stepsUsed === k, `${rank}: could not walk all ${k} steps`);
    check(throws(() => E.stepTo(s, graph, longRoad.edges[k].to)), `${rank}: step ${k + 1} was allowed`);
    check(s.players[0].spent === k * econ.costPerStep, `${rank}: spent ${s.players[0].spent} for ${k} road steps`);
  }
  // Ace as a booster: value + 1.
  const s = game(2, { hands: [[["3", "clubs"], ["A", "hearts"]], [["3", "spades"]]], at: ["new-delhi"] });
  E.playCard(s, { cardId: "3♣", ace: { cardId: "A♥", mode: "boost" } });
  check(s.turn.allowance === 4, `3 + Ace boost: allowance ${s.turn.allowance}, expected 4`);
  for (let i = 0; i < 4; i++) E.stepTo(s, graph, longRoad.edges[i].to);
  check(throws(() => E.stepTo(s, graph, longRoad.edges[4].to)), "3 + Ace boost: a 5th step was allowed");
}

section("Boundary: over-budget penalty around ₹20,000 and each ₹500");
{
  const B = econ.startingBudget, blk = sc.overBudgetBlock, pen = sc.overBudgetPenalty;
  const cases = [[0, 0], [B - 1, 0], [B, 0], [B + 1, -pen], [B + blk - 1, -pen], [B + blk, -pen], [B + blk + 1, -2 * pen], [B + 2 * blk, -2 * pen], [B + 2 * blk + 1, -3 * pen], [B + 10 * blk, -10 * pen]];
  for (const [spent, want] of cases) {
    const s = game(2);
    s.players[0].spent = spent;
    const r = E.scorePlayer(s, s.players[0]);
    check(r.penalty === want, `spent ₹${spent}: penalty ${r.penalty}, expected ${want}`);
  }
}

section("Boundary: memory sets around 3 of a suit and 1 of each suit");
{
  // [spades, hearts, clubs, diamonds] -> points
  const S3 = sc.sameSuitSet, S4 = sc.fourSuitSet;
  const cases = [
    [[0, 0, 0, 0], 0], [[2, 0, 0, 0], 0], [[3, 0, 0, 0], S3], [[4, 0, 0, 0], S3], [[5, 0, 0, 0], S3], [[6, 0, 0, 0], 2 * S3],
    [[1, 1, 1, 0], 0], [[1, 1, 1, 1], S4], [[2, 2, 2, 2], 2 * S4], [[3, 1, 1, 1], S3 + S4], // the manual's example: 35
    [[3, 3, 3, 3], 4 * S3 + 3 * S4], [[2, 2, 2, 1], S4],
  ];
  for (const [m, want] of cases) {
    const s = game(2);
    E.SUITS.forEach((x, i) => { s.players[0].memories[x] = m[i]; });
    check(E.scorePlayer(s, s.players[0]).memories === want, `memories ${m}: ${E.scorePlayer(s, s.players[0]).memories} points, expected ${want}`);
  }
}

section("Boundary: destination bonus around 5 completed");
{
  for (const done of [0, 1, 4, 5, 6]) {
    const s = game(2);
    const p = s.players[0];
    const goals = board.characters.find((c) => c.id === p.characterId).goals.map((g) => g.city).slice(0, done);
    p.reached = [...goals]; p.visited = [...goals];
    const r = E.scorePlayer(s, p);
    check(r.destinations === done * sc.destination, `${done} destinations: ${r.destinations} points`);
    check(r.bonus === (done >= sc.destinationsForBonus ? sc.allDestinationsBonus : 0), `${done} destinations: bonus ${r.bonus}`);
  }
}

section("Boundary: player counts 1 to 7");
{
  for (const n of [1, 2, 3, 4, 5, 6, 7]) {
    const chars = Array.from({ length: n }, (_, i) => board.characters[i % 6].id);
    const bad = throws(() => E.newGame({ board, seed: 1, players: chars.map((c, i) => ({ name: `P${i}`, characterId: c })) }));
    check(bad === (n < 2 || n > 6), `${n} players: game ${bad ? "refused" : "created"}`);
  }
}

// --- 2. Equivalence classes ------------------------------------------------------------------
section("Equivalence classes: route kinds and Ace uses");
{
  // One route of each kind, walked as a 1-step move: cost = step cost + its surcharge.
  const kinds = [["road", "new-delhi", "agra"], ["flight", "new-delhi", "mumbai"], ["ship", "kochi", "kavaratti"], ["ship", "sri-vijayapuram", "great-nicobar"]];
  for (const [type, from, to] of kinds) {
    const r = board.routes.find((x) => x.type === type && [x.from, x.to].sort().join() === [from, to].sort().join());
    check(r, `no ${type} route ${from}-${to}`);
    if (!r) continue;
    const s = game(2, { hands: [[["A", "clubs"], ["2", "hearts"]], [["3", "spades"]]], at: [from] });
    E.playCard(s, { cardId: "A♣" });
    E.stepTo(s, graph, to);
    check(s.players[0].spent === econ.costPerStep + (r.surcharge || 0), `${type} ${from}-${to}: spent ${s.players[0].spent}`);
  }
  const fresh = () => game(2, { hands: [[["3", "clubs"], ["A", "hearts"], ["4", "spades"]], [["3", "spades"]]], at: ["new-delhi"] });
  let s = fresh(); E.playCard(s, { cardId: "3♣", ace: { cardId: "A♥", mode: "boost" } });
  check(s.turn.allowance === 4, "Ace boost: allowance is not card + 1");
  s = fresh(); E.playCard(s, { cardId: "3♣", ace: { cardId: "A♥", mode: "memory", suit: "diamonds" } });
  check(s.turn.allowance === 3 && s.turn.ace.mode === "memory", "Ace for a memory: allowance changed");
  check(throws(() => E.playCard(fresh(), { cardId: "3♣", ace: { cardId: "4♠", mode: "boost" } })), "a 4 was accepted as an Ace");
  check(throws(() => E.playCard(fresh(), { cardId: "3♣", ace: { cardId: "A♠", mode: "boost" } })), "an Ace not in hand was accepted");
  check(throws(() => E.playCard(fresh(), { cardId: "9♣" })), "a card not in hand was played");
  s = fresh(); E.playCard(s, { cardId: "3♣" });
  check(throws(() => E.playCard(s, { cardId: "4♠" })), "a second card was played in the same turn");
}

// --- 3. Pairwise ----------------------------------------------------------------------------
section("Pairwise: all-pairs game settings, each played to the end");
const factors = {
  players: [2, 3, 4, 5, 6],
  bots: ["greedy", "goals", "easy", "mixed"],
  firstSeat: ["first", "middle", "last"],
  characters: [0, 2, 4], // which character the table starts from
};
/** Greedy all-pairs covering array: keep adding the combination that covers the most uncovered pairs. */
function allPairs(f) {
  const keys = Object.keys(f);
  const combos = keys.reduce((acc, k) => acc.flatMap((c) => f[k].map((v) => ({ ...c, [k]: v }))), [{}]);
  const pairKey = (c, a, b) => `${a}=${c[a]}|${b}=${c[b]}`;
  const uncovered = new Set();
  for (const c of combos) for (let i = 0; i < keys.length; i++) for (let j = i + 1; j < keys.length; j++) uncovered.add(pairKey(c, keys[i], keys[j]));
  const pairsTotal = uncovered.size;
  const chosen = [];
  while (uncovered.size) {
    let best = null, bestN = -1;
    for (const c of combos) {
      let n = 0;
      for (let i = 0; i < keys.length; i++) for (let j = i + 1; j < keys.length; j++) if (uncovered.has(pairKey(c, keys[i], keys[j]))) n++;
      if (n > bestN) { best = c; bestN = n; }
    }
    chosen.push(best);
    for (let i = 0; i < keys.length; i++) for (let j = i + 1; j < keys.length; j++) uncovered.delete(pairKey(best, keys[i], keys[j]));
  }
  return { chosen, exhaustive: combos.length, pairsTotal };
}
const { chosen, exhaustive, pairsTotal } = allPairs(factors);
for (const [i, c] of chosen.entries()) {
  const n = c.players;
  const ids = board.characters.map((x) => x.id);
  const chars = Array.from({ length: n }, (_, k) => ids[(c.characters + k) % 6]);
  const levels = chars.map((_, k) => (c.bots === "mixed" ? ["greedy", "goals", "easy"][k % 3] : c.bots));
  const first = { first: 0, middle: Math.floor(n / 2), last: n - 1 }[c.firstSeat];
  const s = E.newGame({ board, seed: 300 + i, firstPlayer: first, players: chars.map((characterId, k) => ({ name: `P${k}`, characterId, isBot: true })) });
  const rand = E.rng(11 + i);
  let guard = 0, refused = null, firstMover = null;
  while (s.phase !== "over" && guard++ < 6000 && !refused) {
    let move = null;
    for (const seat of [E.currentPlayer(s).id, ...s.players.map((p) => p.id)]) {
      const a = chooseAction({ ...redact(s, seat), board }, graph, seat, { level: levels[seat], rand });
      if (a) { move = { seat, a }; break; }
    }
    if (!move) break;
    if (move.a.name === "playCard" && firstMover === null) firstMover = move.seat;
    try { applyAction(s, graph, move.seat, move.a.name, move.a.args); } catch (e) { refused = e.message; }
    for (const p of s.players) {
      check(p.reached.every((x) => p.visited.includes(x)) && new Set(p.visited).size === p.visited.length && p.hand.length <= 7,
        `pairwise game ${i} (${JSON.stringify(c)}): a rule broke after "${move.a.name}"`);
    }
  }
  check(!refused, `pairwise game ${i} (${JSON.stringify(c)}): a legal move was refused: ${refused}`);
  check(s.phase === "over", `pairwise game ${i} (${JSON.stringify(c)}) did not finish`);
  check(firstMover === first, `pairwise game ${i}: the first move was not made by seat ${first}`);
  for (const r of E.finalScores(s)) check(r.total === r.tourist + r.destinations + r.bonus + r.memories + r.penalty, `pairwise game ${i}: score does not add up`);
}

console.log(`pairwise: ${chosen.length} games cover all ${pairsTotal} pairs of setting values (exhaustive testing would need ${exhaustive} games)`);
console.log("\nChecks by section:");
for (const sec of sections)
  console.log(`  ${sec.name.padEnd(62, ".")} ${sec.checks.toLocaleString("en-US").padStart(7)}${sec.failed ? `  (${sec.failed} FAILED)` : ""}`);
console.log(`  ${"Total".padEnd(62, ".")} ${total.toLocaleString("en-US").padStart(7)}`);
console.log(failures ? `\n${failures} of ${total.toLocaleString("en-US")} checks FAILED` : `\nall ${total.toLocaleString("en-US")} checks passed`);
process.exit(failures ? 1 : 0);
