// Scenario tests for the rules clarified in RULES.md, one small hand-built
// situation per rule, so a regression names the exact rule it broke.
//
//   node tools/test-rules.mjs [projectDir]
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = process.argv[2] || path.join(path.dirname(new URL(import.meta.url).pathname), "..");
const board = JSON.parse(fs.readFileSync(path.join(root, "frontend/data/board.json"), "utf8"));
const E = await import(pathToFileURL(path.join(root, "frontend/src/engine.js")).href);
const graph = E.buildGraph(board);

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok   ${name}`); }
  catch (e) { failed++; console.log(`  FAIL ${name}\n       ${e.message}`); }
}
const assert = (c, m) => { if (!c) throw new Error(m); };
const throws = (fn, m) => { try { fn(); } catch { return; } throw new Error(m); };
const card = (rank, suit) => ({ rank, suit, id: E.cardId({ rank, suit }) });
const econ = board.economy;

/** A game already past setup, with the given characters; hands overridden when given. */
function game(chars, { hands, at } = {}) {
  const s = E.newGame({ board, seed: 7, players: chars.map((c, i) => ({ name: `P${i}`, characterId: c })) });
  s.phase = "play";
  s.players.forEach((p, i) => {
    if (hands?.[i]) p.hand = hands[i].map(([r, su]) => card(r, su));
    p.faceUp = [];
    if (at?.[i]) p.city = at[i];
  });
  return s;
}
/** Plays `cardId` and walks the shortest path to `dest`, then ends the move. */
function moveTo(s, cardIdStr, dest) {
  E.playCard(s, { cardId: cardIdStr });
  const p = E.currentPlayer(s);
  const r = E.shortestPath(graph, p.city, dest, s.turn.allowance);
  assert(r, `no route to ${dest}`);
  for (const e of r.edges) E.stepTo(s, graph, e.to);
  E.endMovement(s);
}

console.log("Destinations");
test("ending a move on a destination does not complete it", () => {
  const s = game(["pilgrim", "musician"], { hands: [[["2", "hearts"], ["3", "clubs"]], [["2", "spades"]]], at: ["new-delhi"] });
  moveTo(s, "2♥", "amritsar"); // a Pilgrim goal, but 2 steps away? use shortest path
  assert(!s.players[0].reached.includes("amritsar"), "Amritsar was marked complete without a visit");
});
test("paying the ₹2,000 visit completes the destination", () => {
  const s = game(["pilgrim", "musician"], { hands: [[["2", "hearts"], ["3", "clubs"]], [["2", "spades"]]], at: ["new-delhi"] });
  moveTo(s, "2♥", "amritsar");
  const before = s.players[0].spent;
  E.visitTourist(s, 0);
  assert(s.players[0].reached.includes("amritsar"), "visit did not complete the destination");
  assert(s.players[0].spent - before === econ.touristVisit, "full visit price not charged");
  assert(E.scorePlayer(s, s.players[0]).destinations === board.scoring.destination, "destination not scored");
});
test("the fifth completed destination triggers the end at once", () => {
  const s = game(["pilgrim", "musician"], { hands: [[["2", "hearts"], ["3", "clubs"]], [["2", "spades"]]], at: ["new-delhi"] });
  const pl = s.players[0];
  pl.reached = ["nagapattinam", "srinagar", "daman", "giridih"];
  moveTo(s, "2♥", "amritsar");
  E.visitTourist(s, 0);
  assert(s.endTriggeredBy === 0, "end not triggered by the fifth destination");
});

console.log("Tourist visits");
test("the client cannot claim the shared price on an ordinary visit", () => {
  const s = game(["pilgrim", "musician"], { hands: [[["2", "hearts"]], [["2", "spades"]]], at: ["new-delhi"] });
  moveTo(s, "2♥", "agra");
  const before = s.players[0].spent;
  E.visitTourist(s, 0, true); // tries to ask for the discount
  assert(s.players[0].spent - before === econ.touristVisit, "discount was granted without a road trip");
});
test("no visit while still moving, and not for someone else's city", () => {
  const s = game(["pilgrim", "musician"], { hands: [[["2", "hearts"]], [["2", "spades"]]], at: ["new-delhi", "agra"] });
  E.playCard(s, { cardId: "2♥" });
  throws(() => E.visitTourist(s, 0), "visited mid-move");
  throws(() => E.visitTourist(s, 1), "an idle player visited on someone else's turn");
});
test("a place scores once per player", () => {
  const s = game(["pilgrim", "musician"], { hands: [[["2", "hearts"], ["2", "clubs"]], [["2", "spades"]]], at: ["new-delhi"] });
  moveTo(s, "2♥", "agra");
  E.visitTourist(s, 0);
  throws(() => E.visitTourist(s, 0), "visited the same place twice");
});

console.log("Road trips");
function tripSetup() {
  // P0 (driver) and P1 meet in Agra. P1 has a face-up 4♦; P0 has a face-up 6♠ of its own.
  const s = game(["pilgrim", "musician", "historian"], {
    hands: [[["2", "hearts"], ["3", "clubs"]], [["2", "spades"]], [["3", "spades"]]],
    at: ["new-delhi", "agra", "bhopal"],
  });
  s.players[0].faceUp = [{ card: card("6", "spades"), flipped: false }];
  s.players[1].faceUp = [{ card: card("4", "diamonds"), flipped: false }];
  s.players[2].faceUp = [{ card: card("5", "clubs"), flipped: false }];
  moveTo(s, "2♥", "agra");
  return s;
}
test("the driver's own face-up card is never offered", () => {
  const s = tripSetup();
  const cards = E.roadTripCards(s, [0, 1]);
  assert(cards.length === 1 && cards[0].owner === 1, `expected only P1's card, got ${cards.map((c) => c.card.id)}`);
});
test("the driver cannot flip their own card", () => {
  const s = tripSetup();
  E.offerRoadTrip(s);
  throws(() => E.proposeRoadTrip(s, graph, { companions: [1], owner: 0, cardId: "6♠", destination: "gwalior" }), "driver's own card accepted");
});
test("the card must belong to someone on the trip", () => {
  const s = tripSetup();
  E.offerRoadTrip(s);
  throws(() => E.proposeRoadTrip(s, graph, { companions: [1], owner: 2, cardId: "5♣", destination: "gwalior" }), "a non-participant's card was flipped");
});
test("road trip off when the card's owner declines", () => {
  const s = tripSetup();
  E.offerRoadTrip(s);
  E.proposeRoadTrip(s, graph, { companions: [1], owner: 1, cardId: "4♦", destination: "gwalior" });
  E.respondRoadTrip(s, graph, 1, { type: "decline" });
  assert(s.turn.stage === "resolve" && !s.turn.roadTrip, "trip went ahead without the card's owner");
});
test("manual worked example: 4 steps, costs shared, memories", () => {
  const s = tripSetup();
  E.offerRoadTrip(s);
  const dest = Object.keys(Object.fromEntries(board.cities.map((c) => [c.id, 1])))
    .find((id) => { const r = E.shortestPath(graph, "agra", id, 4); return r && r.totalSteps === 4 && r.edges.every((e) => e.route.type === "road"); });
  E.proposeRoadTrip(s, graph, { companions: [1], owner: 1, cardId: "4♦", destination: dest });
  E.respondRoadTrip(s, graph, 1, { type: "accept", stop: dest });
  E.confirmRoadTrip(s);
  const d0 = s.players[0].spent, d1 = s.players[1].spent;
  for (const e of E.shortestPath(graph, "agra", dest, 4).edges) E.stepTo(s, graph, e.to);
  E.endRoadTrip(s);
  assert(s.players[0].spent - d0 === 4 * econ.costPerStep - 4 * econ.roadTripSharePerStep, `driver net ${s.players[0].spent - d0}, expected 400`);
  assert(s.players[1].spent - d1 === 4 * econ.roadTripSharePerStep, "companion did not pay ₹100/step");
  const g0 = s.turn.gained.filter((g) => g.player === 0 && g.suit === "diamonds").length;
  const g1 = s.turn.gained.filter((g) => g.player === 1 && g.suit === "diamonds").length;
  assert(g0 === 2 && g1 === 1, `memories: driver ${g0} (want 2), companion ${g1} (want 1)`);
  assert(s.players[1].faceUp[0].flipped, "card not turned face-down");
});
test("a player already at the trip's end gets no road-trip memory", () => {
  const s = tripSetup();
  s.players[2].city = "gwalior";
  E.offerRoadTrip(s);
  E.proposeRoadTrip(s, graph, { companions: [1], owner: 1, cardId: "4♦", destination: "gwalior" });
  E.respondRoadTrip(s, graph, 1, { type: "accept", stop: "gwalior" });
  E.confirmRoadTrip(s);
  E.stepTo(s, graph, "gwalior");
  const before = { ...s.players[2].memories };
  E.endRoadTrip(s);
  assert(JSON.stringify(before) === JSON.stringify(s.players[2].memories), "the bystander received a memory");
});
test("shared tourism ₹1,000 for those still aboard; none for a rider dropped off", () => {
  const s = tripSetup();
  E.offerRoadTrip(s);
  E.proposeRoadTrip(s, graph, { companions: [1], owner: 1, cardId: "4♦", destination: "gwalior" });
  E.respondRoadTrip(s, graph, 1, { type: "accept", stop: "gwalior" });
  E.confirmRoadTrip(s);
  E.stepTo(s, graph, "gwalior");
  E.endRoadTrip(s);
  const opts = E.visitOptions(s);
  assert(opts.length === 2 && opts.every((o) => o.price === econ.sharedTouristVisit), "shared price not offered to both");
});
test("a rider who got off partway forfeits the shared price", () => {
  const s = tripSetup();
  E.offerRoadTrip(s);
  const r = E.shortestPath(graph, "agra", "bhopal", 4);
  E.proposeRoadTrip(s, graph, { companions: [1], owner: 1, cardId: "4♦", destination: "bhopal" });
  E.respondRoadTrip(s, graph, 1, { type: "accept", stop: "bhopal" });
  E.confirmRoadTrip(s);
  E.stepTo(s, graph, r.edges[0].to);
  E.dropOff(s, 1);
  for (const e of r.edges.slice(1)) E.stepTo(s, graph, e.to);
  E.endRoadTrip(s);
  assert(!E.visitOptions(s).some((o) => o.playerId === 1), "dropped rider still offered the shared price");
});

test("undo on a road trip refunds everyone exactly and brings riders back", () => {
  const s = tripSetup();
  E.offerRoadTrip(s);
  E.proposeRoadTrip(s, graph, { companions: [1], owner: 1, cardId: "4♦", destination: "gwalior" });
  E.respondRoadTrip(s, graph, 1, { type: "accept", stop: "gwalior" });
  E.confirmRoadTrip(s);
  const before = s.players.map((p) => ({ spent: p.spent, city: p.city }));
  E.stepTo(s, graph, "gwalior"); // rider auto-drops here (their stop)
  assert(s.turn.roadTrip.riders[0].droppedAt === "gwalior", "rider should have got off at their stop");
  E.undoStep(s);
  const after = s.players.map((p) => ({ spent: p.spent, city: p.city }));
  assert(JSON.stringify(before) === JSON.stringify(after), `undo did not restore money/positions: ${JSON.stringify(before)} vs ${JSON.stringify(after)}`);
  assert(s.turn.roadTrip.riders[0].droppedAt === null && s.turn.roadTrip.stepsUsed === 0, "rider not back on board after undo");
});
test("a confirmed road trip that hasn't moved can be called off; the card goes face-up again", () => {
  const s = tripSetup();
  E.offerRoadTrip(s);
  E.proposeRoadTrip(s, graph, { companions: [1], owner: 1, cardId: "4♦", destination: "gwalior" });
  E.respondRoadTrip(s, graph, 1, { type: "accept", stop: "gwalior" });
  E.confirmRoadTrip(s);
  E.stepTo(s, graph, "gwalior");
  throws(() => E.cancelRoadTrip(s), "called off after moving");
  E.undoStep(s);
  E.cancelRoadTrip(s);
  assert(s.turn.stage === "resolve" && !s.turn.roadTrip, "trip not called off");
  assert(!s.players[1].faceUp[0].flipped, "card still face-down");
});
test("log lines name the player they are about", () => {
  const s = tripSetup();
  E.offerRoadTrip(s);
  E.proposeRoadTrip(s, graph, { companions: [1], owner: 1, cardId: "4♦", destination: "gwalior" });
  E.respondRoadTrip(s, graph, 1, { type: "accept", stop: "gwalior" });
  E.confirmRoadTrip(s);
  E.stepTo(s, graph, "gwalior");
  E.endRoadTrip(s);
  E.visitTourist(s, 1);
  const visit = s.log.find((l) => /visits Gwalior/.test(l.text));
  assert(visit.player === "P1" && !visit.text.includes("P1"), `visit line: ${visit.player} | ${visit.text}`);
  const mem = s.log.filter((l) => /memory \(road trip\)/.test(l.text)).map((l) => l.player).sort();
  assert(JSON.stringify(mem) === JSON.stringify(["P0", "P1"]), `memory lines name ${mem}`);
});

test("a road-trip companion can take or turn down the shared stamp themselves", () => {
  const s = tripSetup();
  E.offerRoadTrip(s);
  E.proposeRoadTrip(s, graph, { companions: [1], owner: 1, cardId: "4♦", destination: "gwalior" });
  E.respondRoadTrip(s, graph, 1, { type: "accept", stop: "gwalior" });
  E.confirmRoadTrip(s);
  E.stepTo(s, graph, "gwalior");
  E.endRoadTrip(s);
  assert(JSON.stringify(E.ridersStillDeciding(s)) === "[1]", "companion should still be deciding");
  E.passVisit(s, 1);
  assert(E.ridersStillDeciding(s).length === 0, "companion still listed after saying no thanks");
  assert(!E.visitOptions(s).some((o) => o.playerId === 1), "companion offered the visit again after passing");
  throws(() => E.passVisit(s, 1), "passed twice");
  assert(E.visitOptions(s).some((o) => o.playerId === 0), "the driver lost their own visit");
});

console.log("Start-of-turn road trips");
function startSetup() {
  // It's P0's turn; P1 is in the same city (Agra) with a face-up 4♦.
  const s = game(["pilgrim", "musician", "historian"], {
    hands: [[["2", "hearts"], ["3", "clubs"]], [["2", "spades"]], [["3", "spades"]]],
    at: ["agra", "agra", "bhopal"],
  });
  s.players[1].faceUp = [{ card: card("4", "diamonds"), flipped: false }];
  s.players[2].faceUp = [{ card: card("5", "clubs"), flipped: false }];
  return s;
}
const fourStepRoad = (from) => board.cities.map((c) => c.id).find((id) => { const r = E.shortestPath(graph, from, id, 4); return r && r.totalSteps === 4 && r.edges.every((e) => e.route.type === "road"); });
test("offered only when someone here has a face-up card", () => {
  const s = startSetup();
  assert(E.canStartRoadTrip(s), "should be offered with P1 here");
  s.players[1].city = "bhopal";
  assert(!E.canStartRoadTrip(s), "offered with nobody in the city");
});
test("no road-trip memory; driver gets efficient travel only; costs as normal", () => {
  const s = startSetup();
  const dest = fourStepRoad("agra");
  E.offerStartRoadTrip(s);
  E.proposeRoadTrip(s, graph, { companions: [1], owner: 1, cardId: "4♦", destination: dest });
  E.respondRoadTrip(s, graph, 1, { type: "accept", stop: dest });
  E.confirmRoadTrip(s);
  const d0 = s.players[0].spent, d1 = s.players[1].spent;
  for (const e of E.shortestPath(graph, "agra", dest, 4).edges) E.stepTo(s, graph, e.to);
  E.endRoadTrip(s);
  const g = s.turn.gained.map((x) => `${x.player}:${x.why}`);
  assert(JSON.stringify(g) === JSON.stringify(["0:efficient travel"]), `memories ${JSON.stringify(g)}`);
  assert(s.players[0].spent - d0 === 4 * econ.costPerStep - 4 * econ.roadTripSharePerStep, "driver cost not as a normal trip");
  assert(s.players[1].spent - d1 === 4 * econ.roadTripSharePerStep, "rider cost not as a normal trip");
});
test("not exact value: no memory at all", () => {
  const s = startSetup();
  E.offerStartRoadTrip(s);
  E.proposeRoadTrip(s, graph, { companions: [1], owner: 1, cardId: "4♦", destination: "gwalior" });
  E.respondRoadTrip(s, graph, 1, { type: "accept", stop: "gwalior" });
  E.confirmRoadTrip(s);
  E.stepTo(s, graph, "gwalior");
  E.endRoadTrip(s);
  assert(s.turn.gained.length === 0, `memories given: ${JSON.stringify(s.turn.gained)}`);
});
test("then the driver plays a card and moves; no second road trip that turn", () => {
  const s = startSetup();
  E.offerStartRoadTrip(s);
  E.proposeRoadTrip(s, graph, { companions: [1], owner: 1, cardId: "4♦", destination: "gwalior" });
  E.respondRoadTrip(s, graph, 1, { type: "accept", stop: "gwalior" });
  E.confirmRoadTrip(s);
  E.stepTo(s, graph, "gwalior");
  E.endRoadTrip(s);
  assert(E.visitOptions(s).every((o) => o.price === econ.sharedTouristVisit) && E.visitOptions(s).length === 2, "shared ₹1,000 stamp not offered to both");
  E.finishStartTrip(s);
  assert(!s.turn, "turn should be back at 'play a card'");
  E.playCard(s, { cardId: "2♥" });
  E.stepTo(s, graph, E.movementOptions(s, graph)[0].to);
  E.endMovement(s);
  s.players[2].city = s.players[0].city; // someone with a card is here now
  throws(() => E.offerRoadTrip(s), "a second road trip was allowed in the same turn");
  E.endTurn(s);
  assert(!s.turnFlags, "turn flags not cleared for the next player");
});
test("declined or called off: back to the start of the turn, card still to play", () => {
  const s = startSetup();
  E.offerStartRoadTrip(s);
  E.proposeRoadTrip(s, graph, { companions: [1], owner: 1, cardId: "4♦", destination: "gwalior" });
  E.respondRoadTrip(s, graph, 1, { type: "decline" });
  assert(!s.turn && !s.players[1].faceUp[0].flipped, "not back at the start of the turn");
  E.offerStartRoadTrip(s);
  E.cancelRoadTripInvite(s);
  assert(!s.turn, "cancel did not return to the start");
  E.playCard(s, { cardId: "2♥" });
  assert(s.turn.stage === "moving", "could not play a card afterwards");
});

console.log("Aces");
test("two Aces: swap one for a card from the undealt pile", () => {
  const s = E.newGame({ board, seed: 3, players: [{ name: "A", characterId: "pilgrim" }, { name: "B", characterId: "musician" }] });
  const p = s.players[0];
  p.hand = [card("A", "spades"), card("A", "hearts"), card("3", "clubs")];
  const pile = s.leftover.length;
  assert(pile > 0, "2 players should leave undealt cards");
  E.swapAce(s, 0, "A♠");
  assert(p.hand.length === 3 && p.hand.filter(E.isAce).length >= 1 && !p.hand.some((c) => c.id === "A♠"), "swap did not replace the Ace");
  assert(s.leftover.length === pile - 1, "nothing was drawn");
  throws(() => E.swapAce(s, 0, "A♥"), "swapped twice");
});
test("one Ace cannot be swapped", () => {
  const s = E.newGame({ board, seed: 3, players: [{ name: "A", characterId: "pilgrim" }, { name: "B", characterId: "musician" }] });
  s.players[0].hand = [card("A", "spades"), card("3", "clubs")];
  throws(() => E.swapAce(s, 0, "A♠"), "a single Ace was swapped");
});
test("no cards left: reshuffle deals every hand again", () => {
  const s = E.newGame({ board, seed: 3, players: ["pilgrim", "musician", "historian", "explorer"].map((c, i) => ({ name: `P${i}`, characterId: c })) });
  assert(s.leftover.length === 0, "a 4-player game deals the whole deck");
  s.players[1].hand[0] = card("A", "spades"); s.players[1].hand[1] = card("A", "hearts");
  throws(() => E.swapAce(s, 1, "A♠"), "swap allowed with nothing to draw");
  const before = JSON.stringify(s.players.map((p) => p.hand));
  E.requestReshuffle(s, 1);
  assert(JSON.stringify(s.players.map((p) => p.hand)) !== before, "hands unchanged after reshuffle");
  const spec = E.dealSpec(board, 4);
  assert(s.players.every((p) => p.hand.filter((c) => spec.guaranteed.includes(c.rank)).length === 1), "reshuffle broke the one-high-card rule");
});
test("Ace as booster: efficient travel needs the +1", () => {
  const s = game(["pilgrim", "musician"], { hands: [[["2", "hearts"], ["A", "clubs"]], [["2", "spades"]]], at: ["new-delhi"] });
  E.playCard(s, { cardId: "2♥", ace: { cardId: "A♣", mode: "boost" } });
  assert(s.turn.allowance === 3, "booster did not add a step");
  const r = E.shortestPath(graph, "new-delhi", "gwalior", 3);
  for (const e of r.edges) E.stepTo(s, graph, e.to);
  E.endMovement(s);
  const eff = s.turn.gained.filter((g) => g.why === "efficient travel").length;
  assert(eff === (r.totalSteps === 3 ? 1 : 0), "efficient-travel memory wrong with a booster");
});

console.log("Budget and scoring");
test(`starting budget is ₹${econ.startingBudget.toLocaleString("en-IN")} (RULES.md)`, () => {
  assert(econ.startingBudget === 20000, `board.json has ${econ.startingBudget}`);
});
test("manual turn example: Jaipur, 5♣ to Gwalior costs ₹1,000 + ₹2,000 stay", () => {
  const s = game(["pilgrim", "musician"], { hands: [[["5", "clubs"]], [["2", "spades"]]], at: ["jaipur"] });
  E.playCard(s, { cardId: "5♣" });
  const r = E.shortestPath(graph, "jaipur", "gwalior", 5);
  for (const e of r.edges) E.stepTo(s, graph, e.to);
  E.endMovement(s);
  E.visitTourist(s, 0);
  assert(s.players[0].spent === r.totalSteps * econ.costPerStep + econ.touristVisit, `spent ${s.players[0].spent}`);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
