// Plays complete random games against the engine to check that the rules hold
// together: legal moves only, costs and memories accounted for, an end trigger
// that fires, and a score that adds up.
//
//   node test-engine.mjs <projectDir> [games]
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = process.argv[2];
const games = +(process.argv[3] || 40);
const board = JSON.parse(fs.readFileSync(path.join(root, "frontend/data/board.json"), "utf8"));
const E = await import(pathToFileURL(path.join(root, "frontend/src/engine.js")).href);

let failures = 0;
const check = (cond, msg) => { if (!cond) { failures++; console.log("  FAIL:", msg); } };

const graph = E.buildGraph(board);

// --- board sanity -----------------------------------------------------------
{
  const ids = new Set(board.cities.map((c) => c.id));
  check(ids.size === board.cities.length, "duplicate city ids");
  const degree = new Map([...ids].map((id) => [id, 0]));
  for (const r of board.routes) { degree.set(r.from, degree.get(r.from) + 1); degree.set(r.to, degree.get(r.to) + 1); }
  const isolated = [...degree].filter(([, d]) => d === 0).map(([id]) => id);
  check(isolated.length === 0, `cities with no route: ${isolated.join(", ")}`);
  for (const ch of board.characters) {
    check(new Set(ch.goals.map((g) => g.city)).size === ch.goals.length, `${ch.id} has a duplicated goal`);
    check(!ch.goals.some((g) => g.city === ch.start), `${ch.id} starts on one of its own goals`);
  }
  const nums = board.cities.filter((c) => c.tourist).map((c) => c.tourist);
  check(new Set(nums).size === 51, "tourist place numbers are not 1..51 exactly once");
}

// --- deals ------------------------------------------------------------------
for (let n = 2; n <= 6; n++) {
  const spec = E.dealSpec(board, n);
  const { hands, leftover, setAside } = E.deal(board, n, 12345 + n);
  check(hands.length === n, `${n}p: wrong number of hands`);
  for (const hand of hands) {
    check(hand.length === spec.dealt + 1, `${n}p: hand size ${hand.length}, expected ${spec.dealt + 1}`);
    check(hand.some((c) => spec.guaranteed.includes(c.rank)), `${n}p: hand without a guaranteed high card`);
  }
  // B3: spare high cards are set aside — never dealt and never left in the draw deck.
  check(!leftover.some((c) => spec.guaranteed.includes(c.rank)), `${n}p: spare high card shuffled back into the deck`);
  check(setAside.every((c) => spec.guaranteed.includes(c.rank)), `${n}p: set-aside pile holds a non-high card`);
  check(hands.every((h) => h.filter((c) => spec.guaranteed.includes(c.rank)).length === 1), `${n}p: a hand holds more than one high card`);
  const all = [...hands.flat(), ...leftover, ...setAside].map((c) => `${c.rank}${c.suit}`);
  check(new Set(all).size === all.length, `${n}p: a card was dealt twice`);
  check(all.length === spec.ranks.length * 4, `${n}p: deck size wrong`);
}

// --- B3 across many seeds ---------------------------------------------------
for (let n = 2; n <= 6; n++) {
  const spec = E.dealSpec(board, n);
  for (let seed = 1; seed <= 200; seed++) {
    const { hands } = E.deal(board, n, seed);
    if (!hands.every((h) => h.filter((c) => spec.guaranteed.includes(c.rank)).length === 1)) { check(false, `${n}p seed ${seed}: hand with !=1 high card`); break; }
  }
}

// --- B2: roads before flights ------------------------------------------------
{
  const route = E.shortestPath(graph, "new-delhi", "mumbai", 99);
  check(route && route.edges.every((e) => e.route.type !== "flight"), "B2: New Delhi -> Mumbai should be by road, not a flight");
  const tight = E.shortestPath(graph, "new-delhi", "mumbai", 1);
  check(tight && tight.edges.length === 1 && tight.edges[0].route.type === "flight", "B2: with only 1 step allowed, the flight is the fallback");
  // reachability must be unchanged: anything reachable with flights is still reachable
  for (const a of ["new-delhi", "sawai-madhopur"]) for (const b of board.cities.map((c) => c.id)) {
    const r = E.shortestPath(graph, a, b, 4);
    if (r) check(r.totalSteps <= 4, `B2: ${a}->${b} exceeds budget`);
  }
}

// --- B1: no road may jump over a city that the printed board links through ----
{
  const has = (a, b) => board.routes.some((r) => (r.from === a && r.to === b) || (r.from === b && r.to === a));
  check(!has("bhopal", "lucknow"), "B1: there is no printed Bhopal-Lucknow road (it is Bhopal-Gwalior + Gwalior-Lucknow)");
  check(has("bhopal", "gwalior") && has("gwalior", "lucknow"), "B1: Bhopal-Gwalior and Gwalior-Lucknow roads must exist");
  // roads that merely run end to end through the city between them (checked against the plate)
  for (const [a, c, m] of [["kochi","madikeri","wayanad"],["badrinath","rishikesh","new-delhi"],["bengaluru","wayanad","udupi"],["daman","pune","mumbai"],["madurai","thiruvananthapuram","kanniyakumari"],["coimbatore","wayanad","kochi"]]) {
    check(!has(a, c), `B1: ${a}-${c} is not a printed road (it is ${a}-${m} + ${m}-${c})`);
    check(has(a, m) && has(m, c), `B1: ${a}-${m} and ${m}-${c} must exist`);
  }
  check(!has("dharamshala","jammu"), "no printed Dharamshala-Jammu road");
  check(!has("kadapa","chitradurga"), "no printed Kadapa-Chitradurga road");
  { const w = E.shortestPath(graph, "wayanad", "coimbatore", 4); check(w && w.edges.map((e) => e.to).includes("kochi"), "Wayanad -> Coimbatore must pass through Kochi"); }
  // real printed roads that happen to pass near another city — must stay
  for (const [a, c] of [["amritsar","jammu"],["aizwal","imphal"],["nagapattinam","madurai"],["kochi","coimbatore"]])
    check(has(a, c), `printed road ${a}-${c} is missing`);
  const r = E.shortestPath(graph, "sawai-madhopur", "madikeri", 4);
  const stops = r ? r.edges.map((e) => e.to) : [];
  check(stops.includes("gwalior"), `B1: Sawai Madhopur -> Madikeri (4 steps) should pass through Gwalior, got ${stops.join(" > ")}`);
}

// --- scoring worked example from the manual --------------------------------
{
  const fake = {
    board,
    players: [{ memories: { spades: 3, diamonds: 1, clubs: 1, hearts: 1 }, visited: [], reached: [], spent: 0, characterId: "pilgrim" }],
  };
  const sc = E.scorePlayer(fake, fake.players[0]);
  check(sc.memories === 35, `manual example: 3 Bazaar + one of each should score 35, got ${sc.memories}`);
}
{
  const fake = { board, players: [{ memories: { spades: 0, diamonds: 0, clubs: 0, hearts: 0 }, visited: [], reached: [], spent: board.economy.startingBudget + 1100, characterId: "pilgrim" }] };
  const sc = E.scorePlayer(fake, fake.players[0]);
  // 1100 over budget = 3 blocks of 500 (part counts) = -15
  check(sc.penalty === -15, `budget penalty for 1100 over should be -15, got ${sc.penalty}`);
}

// --- full random games ------------------------------------------------------
function randomGame(seed) {
  const rand = E.rng(seed);
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];
  const count = 2 + Math.floor(rand() * 5);
  const chars = board.characters.map((c) => c.id).sort(() => rand() - 0.5).slice(0, count);
  const s = E.newGame({
    board, seed,
    players: chars.map((characterId, i) => ({ name: `P${i + 1}`, characterId })),
    firstPlayer: Math.floor(rand() * count),
  });

  while (s.phase === "setup-roadtrip-card") {
    const p = E.currentPlayer(s);
    E.layRoadTripCard(s, p.id, pick(p.hand).id);
  }

  const turnsTaken = {};
  let guard = 0;
  while (s.phase !== "over" && guard++ < 400) {
    if (s.phase === "handover") { s.phase = "play"; continue; }
    const p = E.currentPlayer(s);
    if (!p.hand.length) { failures++; console.log("  FAIL: a player with no cards was asked to move"); break; }

    const main = pick(p.hand);
    const aces = p.hand.filter((c) => E.isAce(c) && c.id !== main.id);
    const useAce = aces.length && rand() < 0.4;
    const ace = useAce ? { cardId: pick(aces).id, mode: rand() < 0.5 ? "boost" : "memory", suit: main.suit } : null;
    E.playCard(s, { cardId: main.id, ace });

    const before = p.spent;
    let moved = 0;
    while (true) {
      const opts = E.movementOptions(s, graph);
      if (!opts.length) break;
      if (moved >= 1 && rand() < 0.35) break;
      E.stepTo(s, graph, pick(opts).to);
      moved++;
      if (s.turn.stepsUsed >= s.turn.allowance) break;
    }
    check(moved >= 1, "a turn ended with no movement available");
    check(s.turn.stepsUsed <= s.turn.allowance, "moved further than the card allows");
    check(p.spent >= before, "movement reduced the amount spent");
    E.endMovement(s);

    if (E.visitOptions(s).length && rand() < 0.6) E.visitTourist(s, p.id);

    const others = E.playersAt(s, p.city, p.id);
    const cards = others.length ? E.roadTripCards(s, others.map((o) => o.id)) : [];
    check(cards.every((c) => c.owner !== p.id), "the driver's own card was offered for a road trip");
    if (cards.length && rand() < 0.7) {
      const chosen = pick(cards);
      const allowance = E.cardValue(board, chosen.card);
      // Find some city the proposed card can actually reach, same way a
      // player would via the click-to-route feature.
      let destination = null;
      for (let tries = 0; tries < 20 && !destination; tries++) {
        const candidate = pick(board.cities).id;
        if (E.shortestPath(graph, p.city, candidate, allowance)) destination = candidate;
      }
      if (destination) {
        E.offerRoadTrip(s);
        E.proposeRoadTrip(s, graph, { companions: others.map((o) => o.id), owner: chosen.owner, cardId: chosen.card.id, destination });
        // Each invited companion answers on their own — accept (riding to
        // the proposed destination) or decline; the driver reviews once
        // everyone has, same as a real player would.
        for (const o of others) E.respondRoadTrip(s, graph, o.id, rand() < 0.8 ? { type: "accept" } : { type: "decline" });
        if (s.turn.stage === "roadtrip-review") {
          if (rand() < 0.05) {
            E.cancelRoadTripInvite(s); // occasionally the driver backs out even after everyone answered
          } else {
            E.confirmRoadTrip(s);
            let rtMoved = 0;
            while (true) {
              const opts = E.movementOptions(s, graph);
              if (!opts.length) break;
              if (rtMoved >= 1 && rand() < 0.4) break;
              E.stepTo(s, graph, pick(opts).to);
              rtMoved++;
              if (s.turn.roadTrip.stepsUsed >= s.turn.roadTrip.allowance) break;
            }
            if (rtMoved >= 1) {
              if (rand() < 0.25 && s.turn.roadTrip.riders.length) E.dropOff(s, pick(s.turn.roadTrip.riders).id);
              E.endRoadTrip(s);
              for (const o of E.visitOptions(s)) if (rand() < 0.5) { check(o.price === board.economy.sharedTouristVisit, "shared visit not discounted"); E.visitTourist(s, o.playerId); }
            } else {
              s.turn.stage = "resolve";
            }
          }
        }
      }
    }
    turnsTaken[p.id] = (turnsTaken[p.id] || 0) + 1;
    E.endTurn(s);
  }

  check(s.phase === "over", `game ${seed} did not finish (guard ${guard})`);
  // The trigger round is played out, so everyone must have had the same number of turns.
  const counts = s.players.map((p) => turnsTaken[p.id] || 0);
  check(Math.max(...counts) - Math.min(...counts) === 0,
    `unequal turns: ${counts.join("/")} (game ${seed})`);
  for (const p of s.players) {
    check(new Set(p.visited).size === p.visited.length, "a tourist place was visited twice by one player");
    check(p.spent >= 0, "negative spend");
    const ch = E.characterOf(s, p);
    const goals = new Set(ch.goals.map((g) => g.city));
    check(p.reached.every((c) => goals.has(c)), "recorded a goal that is not on the character card");
    check(p.reached.every((c) => p.visited.includes(c)), "a destination was completed without paying to visit it");
  }
  const scores = E.finalScores(s);
  for (const r of scores) {
    const expect = r.tourist + r.destinations + r.bonus + r.memories + r.penalty;
    check(r.total === expect, `score does not add up: ${r.total} vs ${expect}`);
  }
  return { rounds: s.round, top: scores[0].total };
}

let rounds = 0, best = 0;
for (let i = 0; i < games; i++) {
  const r = randomGame(1000 + i * 7);
  rounds += r.rounds;
  best = Math.max(best, r.top);
}
console.log(`${games} random games, average ${(rounds / games).toFixed(1)} rounds, best score ${best}`);
console.log(failures ? `${failures} FAILURES` : "all checks passed");
process.exit(failures ? 1 : 0);
