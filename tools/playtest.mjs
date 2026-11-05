// AI play-test runner. Plays many complete games between computer players —
// every seat decides from its own redacted view, every move goes through the
// server's own applyAction() — checks the rules after every single move, and
// writes a report of how the games went (balance per character, game length,
// money, road trips, flights, …) for the design team.
//
//   node tools/playtest.mjs [games=300] [--players=2-6] [--levels=greedy,easy] [--seed=1] [--out=docs/test-results/playtest]
//
// Exit code 1 if any game breaks a rule, stalls, or a bot move is refused.
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

const argv = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith("--")).map((a) => { const [k, v] = a.slice(2).split("="); return [k, v ?? "1"]; }));
const games = Number(process.argv.slice(2).find((a) => !a.startsWith("--")) || 300);
const [pMin, pMax] = (argv.players || "2-6").split("-").map(Number).concat([]).map((x, i, a) => x || a[0]);
const levels = (argv.levels || "greedy,goals,easy").split(",");
const baseSeed = Number(argv.seed || 1);
const outDir = path.resolve(argv.out || path.join(root, "docs", "test-results", "playtest"));

const problems = [];
const problem = (g, msg) => { if (problems.length < 200) problems.push(`game ${g}: ${msg}`); };

function playGame(g) {
  const rand = E.rng(baseSeed * 7919 + g * 104729);
  const n = pMin + Math.floor(rand() * (pMax - pMin + 1));
  const chars = board.characters.map((c) => c.id).sort(() => rand() - 0.5).slice(0, n);
  const seatLevel = chars.map((_, i) => levels[(g + i) % levels.length]);
  const s = E.newGame({ board, seed: (baseSeed * 1000003 + g) >>> 0, firstPlayer: Math.floor(rand() * n),
    players: chars.map((characterId, i) => ({ name: `${board.characters.find((c) => c.id === characterId).name} (${seatLevel[i]})`, characterId, isBot: true })) });

  const st = { flights: 0, ships: 0, roadSteps: 0, tripsOffered: 0, tripsTaken: 0, invites: 0, declines: 0, aceSwaps: 0, reshuffles: 0, aceBoost: 0, aceMemory: 0, actions: 0, refused: 0 };
  let guard = 0, sinceTurn = 0, lastTurnKey = "";
  while (s.phase !== "over") {
    if (++guard > 6000) { problem(g, `did not finish (stuck at round ${s.round}, ${s.turn?.stage ?? s.phase})`); return null; }
    // whoever has something to do: the active seat first, then anyone answering/visiting
    let move = null;
    const order = [E.currentPlayer(s).id, ...s.players.map((p) => p.id)];
    for (const seat of order) {
      const view = { ...redact(s, seat), board };
      const a = chooseAction(view, graph, seat, { level: seatLevel[seat], rand });
      if (a) { move = { seat, a }; break; }
    }
    if (!move) { problem(g, `nobody can act (round ${s.round}, stage ${s.turn?.stage ?? s.phase})`); return null; }
    const turnKey = `${s.round}:${s.turnIndex}`;
    sinceTurn = turnKey === lastTurnKey ? sinceTurn + 1 : 0; lastTurnKey = turnKey;
    if (sinceTurn > 80) { problem(g, `one turn took over 80 actions — a bot is looping (${move.a.name} at stage ${s.turn?.stage})`); return null; }

    const before = s.players.map((p) => ({ spent: p.spent, mem: E.SUITS.reduce((t, x) => t + p.memories[x], 0), hand: p.hand.length }));
    const { name, args } = move.a;
    if (name === "stepTo") {
      const opt = E.movementOptions(s, graph).find((o) => o.to === args.cityId);
      if (opt?.route.type === "flight") st.flights++; else if (opt?.route.type === "ship") st.ships++; else st.roadSteps++;
    }
    if (name === "offerRoadTrip") st.tripsOffered++;
    if (name === "proposeRoadTrip") st.invites += args.companions.length;
    if (name === "respondRoadTrip" && args.type === "decline") st.declines++;
    if (name === "confirmRoadTrip") st.tripsTaken++;
    if (name === "swapAce") st.aceSwaps++;
    if (name === "requestReshuffle") st.reshuffles++;
    if (name === "playCard" && args.ace?.mode === "boost") st.aceBoost++;
    if (name === "playCard" && args.ace?.mode === "memory") st.aceMemory++;
    try {
      applyAction(s, graph, move.seat, name, args);
      st.actions++;
    } catch (err) {
      st.refused++;
      problem(g, `bot ${move.seat} "${name}" refused: ${err.message}`);
      return null;
    }
    // --- rules that must hold after every move
    s.players.forEach((p, i) => {
      if (p.memories && E.SUITS.reduce((t, x) => t + p.memories[x], 0) < before[i].mem) problem(g, `${p.name} lost a memory`);
      if (p.hand.length > before[i].hand && name !== "requestReshuffle") problem(g, `${p.name}'s hand grew`);
      if (p.reached.some((c) => !p.visited.includes(c))) problem(g, `${p.name} completed a destination without visiting it`);
      if (new Set(p.visited).size !== p.visited.length) problem(g, `${p.name} visited a place twice`);
    });
    if (s.turn?.stage === "moving" && s.turn.stepsUsed > s.turn.allowance) problem(g, "moved further than the card allows");
    if (s.turn?.roadTrip && !s.turn.together && s.turn.roadTrip.owner === E.currentPlayer(s).id) problem(g, "the driver flipped their own card");
  }

  const scores = E.finalScores(s);
  for (const r of scores) if (r.total !== r.tourist + r.destinations + r.bonus + r.memories + r.penalty) problem(g, "score does not add up");
  const trigger = s.log.find((l) => /triggers the end/.test(l.text))?.text ?? "";
  const top = scores[0].total;
  return {
    n, rounds: s.round, trigger: /destinations completed/.test(trigger) ? "destinations" : /last card/.test(trigger) ? "cards" : "other",
    players: s.players.map((p, i) => {
      const r = scores.find((x) => x.player.id === p.id);
      return {
        character: p.characterId, level: seatLevel[i], total: r.total, won: r.total === top,
        tourist: r.touristCount, destinations: r.reachedCount, memories: E.SUITS.reduce((t, x) => t + p.memories[x], 0),
        memoryPts: r.memories, spent: p.spent, over: r.over > 0, penalty: r.penalty,
      };
    }),
    ...st,
  };
}

// ---------------------------------------------------------------------------
const t0 = Date.now();
const results = [];
for (let g = 0; g < games; g++) {
  const r = playGame(g);
  if (r) results.push(r);
  if (process.stdout.isTTY && g % 25 === 24) process.stdout.write(`\r  ${g + 1}/${games} games…`);
}
if (process.stdout.isTTY) process.stdout.write("\r");
const secs = (Date.now() - t0) / 1000;

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const pct = (x) => `${(100 * x).toFixed(0)}%`;
const f1 = (x) => x.toFixed(1);
const allP = results.flatMap((r) => r.players.map((p) => ({ ...p, n: r.n })));

const byChar = board.characters.map((c) => {
  const ps = allP.filter((p) => p.character === c.id);
  // a fair win rate compares against 1/n for the table size each was in
  const expected = mean(ps.map((p) => 1 / p.n));
  return {
    id: c.id, name: c.name, games: ps.length,
    winRate: mean(ps.map((p) => (p.won ? 1 : 0))), expected,
    avgScore: mean(ps.map((p) => p.total)), avgDest: mean(ps.map((p) => p.destinations)),
    avgStamps: mean(ps.map((p) => p.tourist)), overBudget: mean(ps.map((p) => (p.over ? 1 : 0))),
  };
});
const byLevel = levels.map((l) => {
  const ps = allP.filter((p) => p.level === l);
  return { level: l, players: ps.length, avgScore: mean(ps.map((p) => p.total)), winRate: mean(ps.map((p) => (p.won ? 1 : 0))), expected: mean(ps.map((p) => 1 / p.n)),
    avgDest: mean(ps.map((p) => p.destinations)), avgStamps: mean(ps.map((p) => p.tourist)), avgMem: mean(ps.map((p) => p.memories)) };
});
const byCount = [2, 3, 4, 5, 6].map((n) => {
  const rs = results.filter((r) => r.n === n);
  return { n, games: rs.length, rounds: mean(rs.map((r) => r.rounds)), avgWinner: mean(rs.map((r) => Math.max(...r.players.map((p) => p.total)))), avgScore: mean(rs.flatMap((r) => r.players.map((p) => p.total))), endByDest: mean(rs.map((r) => (r.trigger === "destinations" ? 1 : 0))) };
}).filter((x) => x.games);

const summary = {
  generated: new Date().toISOString(), games, completed: results.length, seconds: secs,
  settings: { players: `${pMin}-${pMax}`, levels, seed: baseSeed, budget: board.economy.startingBudget },
  problems,
  perGame: {
    rounds: mean(results.map((r) => r.rounds)), actions: mean(results.map((r) => r.actions)),
    flights: mean(results.map((r) => r.flights)), ships: mean(results.map((r) => r.ships)),
    tripsOffered: mean(results.map((r) => r.tripsOffered)), tripsTaken: mean(results.map((r) => r.tripsTaken)),
    declineRate: results.reduce((t, r) => t + r.declines, 0) / Math.max(1, results.reduce((t, r) => t + r.invites, 0)),
    aceSwaps: results.reduce((t, r) => t + r.aceSwaps, 0), reshuffles: results.reduce((t, r) => t + r.reshuffles, 0),
    endByDestinations: mean(results.map((r) => (r.trigger === "destinations" ? 1 : 0))),
  },
  perPlayer: {
    score: mean(allP.map((p) => p.total)), stamps: mean(allP.map((p) => p.tourist)), destinations: mean(allP.map((p) => p.destinations)),
    memories: mean(allP.map((p) => p.memories)), spent: mean(allP.map((p) => p.spent)), overBudget: mean(allP.map((p) => (p.over ? 1 : 0))),
    allFiveDestinations: mean(allP.map((p) => (p.destinations >= board.scoring.destinationsForBonus ? 1 : 0))),
  },
  byCharacter: byChar, byLevel, byPlayerCount: byCount,
};

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, "report.json"), JSON.stringify({ summary, games: results }, null, 1));
const md = [
  `# RAHEE — AI play-test report`,
  ``,
  `${results.length} of ${games} games completed in ${f1(secs)} s · ${pMin}–${pMax} players · bots: ${levels.join(", ")} · budget ₹${board.economy.startingBudget.toLocaleString("en-IN")} · seed ${baseSeed}`,
  ``,
  problems.length ? `## ⚠ Problems (${problems.length})\n\n${problems.slice(0, 40).map((p) => `- ${p}`).join("\n")}\n` : `**No rule violations, stalls or refused moves.** Every move of every game was checked.`,
  ``,
  `## A typical game`,
  ``,
  `| | per game |`, `|---|---:|`,
  `| Rounds | ${f1(summary.perGame.rounds)} |`,
  `| Actions sent | ${f1(summary.perGame.actions)} |`,
  `| Flights taken | ${f1(summary.perGame.flights)} |`,
  `| Ship crossings | ${f1(summary.perGame.ships)} |`,
  `| Road trips offered / taken | ${f1(summary.perGame.tripsOffered)} / ${f1(summary.perGame.tripsTaken)} |`,
  `| Invitations declined | ${pct(summary.perGame.declineRate)} |`,
  `| Games ended by 5 destinations (rest: last card) | ${pct(summary.perGame.endByDestinations)} |`,
  `| Ace swaps / reshuffles (all games) | ${summary.perGame.aceSwaps} / ${summary.perGame.reshuffles} |`,
  ``,
  `## A typical player`,
  ``,
  `| | per player |`, `|---|---:|`,
  `| Final score | ${f1(summary.perPlayer.score)} |`,
  `| Stamps | ${f1(summary.perPlayer.stamps)} |`,
  `| Destinations completed | ${f1(summary.perPlayer.destinations)} |`,
  `| Completed all 5 | ${pct(summary.perPlayer.allFiveDestinations)} |`,
  `| Memories | ${f1(summary.perPlayer.memories)} |`,
  `| Money spent | ₹${Math.round(summary.perPlayer.spent).toLocaleString("en-IN")} |`,
  `| Went over budget | ${pct(summary.perPlayer.overBudget)} |`,
  ``,
  `## Balance by character`,
  ``,
  `Win rate is compared with a fair share (1 ÷ players at the table). Large gaps on many games suggest a character's destinations are easier or harder than the others'.`,
  ``,
  `| Character | Seats | Win rate | Fair share | Avg score | Destinations | Stamps | Over budget |`,
  `|---|---:|---:|---:|---:|---:|---:|---:|`,
  ...byChar.map((c) => `| ${c.name} | ${c.games} | ${pct(c.winRate)} | ${pct(c.expected)} | ${f1(c.avgScore)} | ${f1(c.avgDest)} | ${f1(c.avgStamps)} | ${pct(c.overBudget)} |`),
  ``,
  `## By bot level`,
  ``,
  `| Level | Seats | Win rate | Fair share | Avg score | Destinations | Stamps | Memories |`, `|---|---:|---:|---:|---:|---:|---:|---:|`,
  ...byLevel.map((l) => `| ${l.level} | ${l.players} | ${pct(l.winRate)} | ${pct(l.expected)} | ${f1(l.avgScore)} | ${f1(l.avgDest)} | ${f1(l.avgStamps)} | ${f1(l.avgMem)} |`),
  ``,
  `## By number of players`,
  ``,
  `| Players | Games | Rounds | Winner's score | Avg score | Ended by destinations |`, `|---:|---:|---:|---:|---:|---:|`,
  ...byCount.map((c) => `| ${c.n} | ${c.games} | ${f1(c.rounds)} | ${f1(c.avgWinner)} | ${f1(c.avgScore)} | ${pct(c.endByDest)} |`),
  ``,
  `---`,
  `Bots: "greedy" plans each turn for the most points, "goals" chases its character's destinations, "easy" plays random legal moves. They are a play-testing aid, not a model of how people play. Full per-game data: report.json.`,
].join("\n");
fs.writeFileSync(path.join(outDir, "report.md"), md + "\n");

console.log(`${results.length}/${games} games completed in ${f1(secs)}s — avg ${f1(summary.perGame.rounds)} rounds, avg score ${f1(summary.perPlayer.score)}`);
console.log(`${results.reduce((t, r) => t + r.actions, 0).toLocaleString("en-US")} moves checked, ${allP.length.toLocaleString("en-US")} player seats, ${results.reduce((t, r) => t + r.refused, 0)} moves refused`);
console.log(problems.length ? `${problems.length} PROBLEMS:\n  ${problems.slice(0, 15).join("\n  ")}` : "no rule violations, stalls or refused moves");
console.log(`report: ${path.relative(process.cwd(), path.join(outDir, "report.md"))}`);
process.exit(problems.length ? 1 : 0);
