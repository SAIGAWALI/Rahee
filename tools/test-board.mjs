// Test Phase 2. Checks the board data against the rulebook, and the route
// search against an independent implementation.
//
//   1. RULES.md conformance — the money table, the scoring table, the deck table
//      and the six character cards are read from RULES.md itself and compared
//      with board.json, so the two documents can never drift apart unnoticed.
//   2. Board structure — every route joins two real cities, no duplicates, every
//      flight is airport-to-airport or one of the island air routes, every city
//      reachable, and exactly the five island cities need a flight or ship.
//   3. Route search — for EVERY ordered pair of cities and every card value from
//      1 to 10, the engine's shortestPath() is compared with a plain breadth-first
//      search written here from scratch: same reachability, a connected path that
//      ends at the destination, the shortest length, and no flight whenever a
//      road/ship route fits the card (bug B2).
//
//   node tools/test-board.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const board = JSON.parse(fs.readFileSync(path.join(root, "frontend/data/board.json"), "utf8"));
const rules = fs.readFileSync(path.join(root, "RULES.md"), "utf8");
const E = await import(pathToFileURL(path.join(root, "frontend/src/engine.js")).href);
const graph = E.buildGraph(board);

let failures = 0, total = 0;
const sections = [];
const section = (name) => sections.push({ name, checks: 0, failed: 0 });
const check = (cond, msg) => {
  total++;
  const cur = sections[sections.length - 1];
  cur.checks++;
  if (!cond) { failures++; cur.failed++; if (cur.failed <= 5) console.log("  FAIL:", msg); }
};

const city = new Map(board.cities.map((c) => [c.id, c]));
const byTourist = new Map(board.cities.filter((c) => c.tourist).map((c) => [c.tourist, c]));
const rupees = (s) => Number(String(s).replace(/[^\d]/g, ""));
/** Rows of the markdown table that follows the given heading in RULES.md. */
function tableAfter(heading) {
  const at = rules.indexOf(heading);
  if (at < 0) throw new Error(`RULES.md has no "${heading}" section`);
  const lines = rules.slice(at).split("\n").slice(1);
  const start = lines.findIndex((l) => l.trim().startsWith("|"));
  const rows = [];
  for (const l of lines.slice(start)) { if (!l.trim().startsWith("|")) break; rows.push(l.split("|").slice(1, -1).map((x) => x.trim())); }
  return rows.slice(2); // drop the header and the |---| line
}

// --- 1. RULES.md conformance ----------------------------------------------------
section("RULES.md money table vs board.json");
{
  const money = Object.fromEntries(tableAfter("### Money constants").map(([k, v]) => [k.replace(/\*/g, ""), rupees(v)]));
  const econ = board.economy;
  check(econ.startingBudget === money["Starting budget"], `starting budget ${econ.startingBudget} vs RULES.md ${money["Starting budget"]}`);
  check(econ.costPerStep === money["Travel"], `cost per step ${econ.costPerStep} vs ${money["Travel"]}`);
  check(econ.flightSurcharge === money["Flight surcharge"], `flight surcharge ${econ.flightSurcharge} vs ${money["Flight surcharge"]}`);
  check(econ.touristVisit === money['Tourist visit ("Stay cost")'], `tourist visit ${econ.touristVisit} vs ${money['Tourist visit ("Stay cost")']}`);
  check(econ.sharedTouristVisit === money["Shared tourist visit on a road trip"], `shared visit ${econ.sharedTouristVisit} vs ${money["Shared tourist visit on a road trip"]}`);
  check(econ.roadTripSharePerStep === money["Road-trip companion pays the driver"], `road-trip share ${econ.roadTripSharePerStep} vs ${money["Road-trip companion pays the driver"]}`);
  // Each named ship in the table, on the board, with that surcharge.
  const ships = [["kochi", "kavaratti", "Kochi–Kavaratti ship surcharge"], ["sri-vijayapuram", "great-nicobar", "Sri Vijayapuram–Great Nicobar ship surcharge"]];
  for (const [a, b, row] of ships) {
    const r = board.routes.find((x) => x.type === "ship" && ((x.from === a && x.to === b) || (x.from === b && x.to === a)));
    check(r && r.surcharge === money[row], `${row}: board has ${r?.surcharge}, RULES.md says ${money[row]}`);
  }
  // The only other ship is the short Agatti–Kavaratti hop inside Lakshadweep (no surcharge, see build-board.mjs).
  const others = board.routes.filter((x) => x.type === "ship" && !ships.some(([a, b]) => [x.from, x.to].sort().join() === [a, b].sort().join()));
  check(others.length === 1 && [others[0].from, others[0].to].sort().join() === "agatti,kavaratti" && others[0].surcharge === 0, "an unexpected ship route is on the board");
  check(board.routes.filter((x) => x.type === "flight").every((x) => x.surcharge === econ.flightSurcharge), "a flight with a surcharge other than the flight surcharge");
}

section("RULES.md scoring table vs board.json");
{
  // | # | Points |  e.g. "**10** per tourist place visited", "**−5** per ₹500 ... spent over ₹20,000"
  const rows = tableAfter("### Scoring").map(([, pts]) => Number(pts.replace(/\*/g, "").replace("−", "-").match(/^-?\d+/)[0]));
  const sc = board.scoring;
  check(sc.touristPlace === rows[0], `tourist place ${sc.touristPlace} vs ${rows[0]}`);
  check(sc.destination === rows[1], `destination ${sc.destination} vs ${rows[1]}`);
  check(sc.allDestinationsBonus === rows[2] && sc.destinationsForBonus === 5, `bonus ${sc.allDestinationsBonus} for ${sc.destinationsForBonus} vs ${rows[2]} for 5`);
  check(sc.sameSuitSet === rows[3], `same-suit set ${sc.sameSuitSet} vs ${rows[3]}`);
  check(sc.fourSuitSet === rows[4], `four-suit set ${sc.fourSuitSet} vs ${rows[4]}`);
  check(-sc.overBudgetPenalty === rows[5] && sc.overBudgetBlock === 500, `over-budget -${sc.overBudgetPenalty} per ${sc.overBudgetBlock} vs ${rows[5]} per 500`);
}

section("RULES.md deck table vs the deal");
{
  // | Players | Cards used | Total | Dealt |
  const want = { 2: [28, 7], 3: [28, 7], 4: [28, 7], 5: [40, 7], 6: [40, 6] };
  for (const row of tableAfter("### Deck and dealing")) {
    const total = Number(row[2]);
    const [lo, hi] = row[0].split(/[–-]/).map(Number);
    for (let n = lo; n <= (hi || lo); n++) check(want[n][0] === total, `RULES.md deck size for ${n} players`);
  }
  for (const n of [2, 3, 4, 5, 6]) {
    check(E.buildDeck(board, n).length === want[n][0], `${n} players: deck has ${E.buildDeck(board, n).length} cards, RULES.md says ${want[n][0]}`);
    for (let seed = 1; seed <= 20; seed++) {
      const { hands } = E.deal(board, n, seed);
      check(hands.length === n && hands.every((h) => h.length === want[n][1]), `${n} players, seed ${seed}: hands of ${hands.map((h) => h.length)}`);
      const all = hands.flat().map(E.cardId);
      check(new Set(all).size === all.length, `${n} players, seed ${seed}: the same card dealt twice`);
    }
  }
  check(E.cardValue(board, { rank: "A" }) === 1 && E.cardValue(board, { rank: "J" }) === 10 && E.cardValue(board, { rank: "Q" }) === 5 && E.cardValue(board, { rank: "K" }) === 5, "card values A=1, J=10, Q=5, K=5");
}

section("RULES.md character cards vs board.json");
{
  const rows = tableAfter("### The six characters");
  check(rows.length === board.characters.length, `RULES.md lists ${rows.length} characters, board has ${board.characters.length}`);
  for (const [nameCell, startCell, goalsCell] of rows) {
    const name = nameCell.replace(/\*/g, "");
    const ch = board.characters.find((c) => c.name === name);
    check(ch, `${name} is not on the board`);
    if (!ch) continue;
    const startNo = Number(startCell.match(/\d+/)[0]);
    check(city.get(ch.start)?.tourist === startNo, `${name} starts at ${ch.start} (#${city.get(ch.start)?.tourist}), RULES.md says #${startNo}`);
    const goalNos = goalsCell.replace(/\*/g, "").split("·").map((g) => Number(g.trim().match(/^\d+/)[0]));
    const boardNos = ch.goals.map((g) => city.get(g.city)?.tourist);
    check(goalNos.length === 6 && JSON.stringify([...goalNos].sort((a, b) => a - b)) === JSON.stringify([...boardNos].sort((a, b) => a - b)),
      `${name}'s destinations: board ${boardNos}, RULES.md ${goalNos}`);
  }
}

// --- 2. Board structure -----------------------------------------------------------
section("Board structure");
{
  check(board.cities.length === 101 && city.size === 101, `${board.cities.length} cities`);
  const nos = board.cities.filter((c) => c.tourist).map((c) => c.tourist).sort((a, b) => a - b);
  check(nos.length === 51 && nos.every((n, i) => n === i + 1), "tourist places are not exactly 1 to 51");
  for (const c of board.cities.filter((x) => x.tourist)) check(c.attraction && c.stamp, `tourist place ${c.name} has no attraction or stamp`);
  const seen = new Set();
  for (const r of board.routes) {
    check(city.has(r.from) && city.has(r.to), `route ${r.from}-${r.to} names a city that does not exist`);
    check(r.from !== r.to, `route from ${r.from} to itself`);
    // Never two routes of the same kind between two cities. (Bengaluru and Chennai have a
    // road and, since both have airports, a flight.)
    const key = [r.from, r.to].sort().join("|") + "|" + r.type;
    check(!seen.has(key), `two ${r.type} routes between ${r.from} and ${r.to}`);
    seen.add(key);
    check(r.steps === 1, `${r.from}-${r.to} is ${r.steps} steps (every printed segment is one step)`);
    check(["road", "flight", "ship"].includes(r.type), `${r.from}-${r.to} has type ${r.type}`);
    check(E.routeCost(board, r) === board.economy.costPerStep * r.steps + (r.surcharge || 0), `${r.from}-${r.to} cost`);
    if (r.type === "road") check(!r.surcharge, `road ${r.from}-${r.to} has a surcharge`);
  }
  // Flights: airport to airport, or one of the island air routes in RULES.md §10.
  const islandAir = new Set(["agatti|bengaluru", "agatti|chennai", "agatti|kochi", "chennai|sri-vijayapuram", "kolkata|sri-vijayapuram"]);
  for (const r of board.routes.filter((x) => x.type === "flight")) {
    const ok = (city.get(r.from).airport && city.get(r.to).airport) || islandAir.has([r.from, r.to].sort().join("|"));
    check(ok, `flight ${r.from}-${r.to} is not airport-to-airport or an island air route`);
  }
  for (const ch of board.characters) {
    check(city.has(ch.start), `${ch.name}'s start city does not exist`);
    check(ch.goals.every((g) => city.get(g.city)?.tourist), `${ch.name} has a destination that is not a tourist place`);
  }
}

/** Plain breadth-first search (every route is one step). allow(route) filters routes. */
function bfs(from, allow) {
  const dist = new Map([[from, 0]]);
  const queue = [from];
  while (queue.length) {
    const u = queue.shift();
    for (const r of board.routes) {
      if (!allow(r)) continue;
      const v = r.from === u ? r.to : r.to === u ? r.from : null;
      if (v && !dist.has(v)) { dist.set(v, dist.get(u) + r.steps); queue.push(v); }
    }
  }
  return dist;
}

section("Every city reachable; only the islands need a flight or ship");
{
  const all = bfs("new-delhi", () => true);
  check(all.size === 101, `only ${all.size} of 101 cities reachable from New Delhi`);
  const byRoad = bfs("new-delhi", (r) => r.type === "road");
  const notByRoad = board.cities.filter((c) => !byRoad.has(c.id)).map((c) => c.id).sort();
  check(byRoad.size === 96, `${byRoad.size} cities reachable by road alone (expected 96)`);
  check(JSON.stringify(notByRoad) === JSON.stringify(["agatti", "diglipur", "great-nicobar", "kavaratti", "sri-vijayapuram"]), `cities not reachable by road: ${notByRoad}`);
}

// --- 3. Route search against the independent BFS ----------------------------------------
section("Route search vs independent BFS (all pairs, card values 1-10)");
{
  const ids = board.cities.map((c) => c.id);
  const distAll = new Map(ids.map((id) => [id, bfs(id, () => true)]));
  const distNoFlight = new Map(ids.map((id) => [id, bfs(id, (r) => r.type !== "flight")]));
  const edgeOk = (from, to, route) => (graph.get(from) || []).some((e) => e.to === to && e.route === route);
  for (const a of ids) for (const b of ids) {
    if (a === b) continue;
    const dAll = distAll.get(a).get(b), dRoad = distNoFlight.get(a).get(b) ?? Infinity;
    for (let k = 1; k <= 10; k++) {
      const p = E.shortestPath(graph, a, b, k);
      const label = `${a} -> ${b} with a ${k}`;
      if (dAll > k) { check(p === null, `${label}: found a route although the shortest is ${dAll} steps`); continue; }
      let ok = !!p, at = a, steps = 0, flights = 0;
      for (const e of p?.edges || []) { ok = ok && edgeOk(at, e.to, e.route); at = e.to; steps += e.route.steps; if (e.route.type === "flight") flights++; }
      ok = ok && at === b && steps === p.totalSteps && steps <= k;
      if (dRoad <= k) ok = ok && flights === 0 && steps === dRoad; // B2: roads first, and the shortest road route
      else ok = ok && steps === dAll;
      check(ok, `${label}: got ${p ? p.edges.map((e) => e.to).join(">") + ` (${p.totalSteps} steps, ${flights} flights)` : "nothing"}, BFS says ${dAll} (road/ship ${dRoad})`);
    }
  }
}

console.log("Checks by section:");
for (const sec of sections)
  console.log(`  ${sec.name.padEnd(64, ".")} ${sec.checks.toLocaleString("en-US").padStart(7)}${sec.failed ? `  (${sec.failed} FAILED)` : ""}`);
console.log(`  ${"Total".padEnd(64, ".")} ${total.toLocaleString("en-US").padStart(7)}`);
console.log(failures ? `\n${failures} of ${total.toLocaleString("en-US")} checks FAILED` : `\nall ${total.toLocaleString("en-US")} checks passed`);
process.exit(failures ? 1 : 0);
