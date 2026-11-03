// Test Phase 2. Robustness of the rules engine against bad input, while real
// games are being played.
//
// Computer players play complete games through the server's own applyAction().
// Before EVERY move, the test throws bad actions at a copy of the game:
//
//   - out of turn:   a turn-only action sent by a seat whose turn it is not
//   - fuzzed:        a random action name with random, broken or hostile
//                    arguments (wrong cities, other players' cards, nulls,
//                    numbers, huge strings, arrays, "__proto__" keys, ...)
//   - unknown:       an action name that does not exist
//   - wrong moment:  "finish move", "end road trip" and "end turn" sent by the
//                    player whose turn it is, at every stage of the turn
//   - replay:        the move just played, sent a second time
//
// Each one must either be refused with a clear error message (not an internal
// crash such as "Cannot read properties of null"), leaving the game EXACTLY as
// it was, or be a legal move that keeps the game consistent. The three "end"
// actions are legal only at their own stage, and a replayed move must never
// hand out a second memory, stamp or destination.
// Then the real move is played and the game goes on.
//
// It also checks determinism: the same seed always deals the same cards, and
// replaying a game with the same seed and the same moves ends in the same state.
//
//   node tools/test-robustness.mjs [games=60]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const imp = (p) => import(pathToFileURL(path.join(root, p)).href);
const E = await imp("frontend/src/engine.js");
const { chooseAction } = await imp("frontend/src/ai.js");
const { applyAction, ACTIONS } = await imp("backend/actions.js");
const { redact } = await imp("backend/redact.js");
const T = await imp("backend/protocol.js");
const board = JSON.parse(fs.readFileSync(path.join(root, "frontend/data/board.json"), "utf8"));
const graph = E.buildGraph(board);
const games = Number(process.argv[2] || 60);

let failures = 0, total = 0;
const sections = [];
const section = (name) => sections.push({ name, checks: 0, failed: 0 });
const check = (cond, msg) => {
  total++;
  const cur = sections[sections.length - 1];
  cur.checks++;
  if (!cond) { failures++; cur.failed++; if (cur.failed <= 5) console.log("  FAIL:", msg); }
};
const stats = { refused: 0, accepted: 0, outOfTurn: 0, wrongStage: 0, replays: 0, typeErrors: 0, typeErrorSamples: new Map() };
// The stage of the turn at which each "end" action is legal.
const LEGAL_STAGE = { endMovement: "moving", endRoadTrip: "roadtrip-moving", endTurn: "resolve" };
const gains = (s) => JSON.stringify(s.players.map((p) => [E.SUITS.map((x) => p.memories[x]), p.visited, p.reached]));

const snapshot = (s) => JSON.stringify({ ...s, board: undefined });
const copyOf = (s) => ({ ...structuredClone({ ...s, board: undefined }), board });
const levels = ["greedy", "goals", "easy"];

/** Random, broken and hostile argument values. */
function junkArgs(s, rand) {
  const pick = (xs) => xs[Math.floor(rand() * xs.length)];
  const cities = board.cities.map((c) => c.id);
  const anyCard = () => { const p = pick(s.players); const all = [...p.hand, ...(p.faceUp || [])]; return all.length ? pick(all).id : "10♠"; };
  const value = () => pick([
    undefined, null, 0, -1, 1, 7, 99, NaN, Infinity, true, false, "", " ", "x".repeat(5000), "10♠", "A♥", "Z♣",
    pick(cities), "atlantis", anyCard(), [], [1, 2], {}, { type: "accept" }, { __proto__: { polluted: true } },
    JSON.parse('{"__proto__": {"polluted": true}}'), { mode: "boost" }, { mode: "nonsense" },
  ]);
  const args = {};
  for (const k of ["cardId", "cityId", "ace", "companions", "owner", "destination", "type", "stop", "riderId", "playerId", "aceId"])
    if (rand() < 0.5) args[k] = value();
  if (rand() < 0.3) args.companions = [pick([0, 1, 2, 5, -1, 99, "0", null])];
  if (rand() < 0.3) args.cityId = pick(cities);
  if (rand() < 0.3) args.cardId = anyCard();
  return pick([args, args, args, null, undefined, "not an object", 42]);
}

/** One complete game. Returns the list of moves played and the final snapshot. */
function playGame(g, { fuzz, moves: replay } = {}) {
  const rand = E.rng(9001 + g * 7717);
  const n = 2 + (g % 5);
  const chars = board.characters.map((c) => c.id).slice(g % 6).concat(board.characters.map((c) => c.id)).slice(0, n);
  const seatLevel = chars.map((_, i) => levels[(g + i) % 3]);
  const s = E.newGame({ board, seed: 5000 + g, firstPlayer: g % n, players: chars.map((characterId, i) => ({ name: `P${i}`, characterId, isBot: true })) });
  const fuzzRand = E.rng(77 + g);
  const moves = [];
  let guard = 0;
  while (s.phase !== "over" && guard++ < 6000) {
    let move = replay ? replay[moves.length] : null;
    if (!move) {
      for (const seat of [E.currentPlayer(s).id, ...s.players.map((p) => p.id)]) {
        const a = chooseAction({ ...redact(s, seat), board }, graph, seat, { level: seatLevel[seat], rand });
        if (a) { move = { seat, name: a.name, args: a.args }; break; }
      }
    }
    if (!move) break;

    if (fuzz) {
      const before = snapshot(s);
      const attempts = [];
      // Out of turn: the real move's arguments, sent by every other seat.
      if (T.TURN_GATED_ACTIONS.has(move.name) && s.phase !== "setup-roadtrip-card")
        for (const p of s.players) if (p.id !== E.currentPlayer(s).id) attempts.push({ seat: p.id, name: move.name, args: move.args, kind: "outOfTurn" });
      // Fuzzed: random action names with junk arguments, from random seats (always a real
      // seat number, as the server only ever passes the sender's own seat).
      const names = Object.keys(ACTIONS);
      for (let k = 0; k < 6; k++)
        attempts.push({ seat: Math.floor(fuzzRand() * n), name: names[Math.floor(fuzzRand() * names.length)], args: junkArgs(s, fuzzRand), kind: "fuzz" });
      attempts.push({ seat: E.currentPlayer(s).id, name: ["__proto__", "constructor", "deleteEverything", ""][guard % 4], args: {}, kind: "unknown" });
      // Wrong moment: each "end" action from the player whose turn it is, whatever the stage.
      if (s.phase !== "setup-roadtrip-card") for (const name of Object.keys(LEGAL_STAGE)) attempts.push({ seat: E.currentPlayer(s).id, name, args: {}, kind: "stage" });

      for (const at of attempts) {
        const copy = copyOf(s);
        let err = null;
        try { applyAction(copy, graph, at.seat, at.name, at.args); } catch (e) { err = e; }
        if (at.kind === "outOfTurn") {
          stats.outOfTurn++;
          check(err && /isn't your turn/.test(err.message) && snapshot(copy) === before, `game ${g}: seat ${at.seat} played "${at.name}" out of turn`);
        } else if (at.kind === "stage") {
          stats.wrongStage++;
          const legal = s.turn?.stage === LEGAL_STAGE[at.name];
          check(legal || err, `game ${g}: "${at.name}" was accepted at stage "${s.turn?.stage ?? "no card played"}"`);
          if (err) check(!(err instanceof TypeError) && snapshot(copy) === before, `game ${g}: "${at.name}" at the wrong stage gave "${err.message}" or changed the game`);
        } else if (at.kind === "unknown") {
          check(err && snapshot(copy) === before, `game ${g}: unknown action "${at.name}" was accepted`);
        } else if (err) {
          stats.refused++;
          if (err instanceof TypeError) {
            stats.typeErrors++;
            const key = `${at.name}: ${err.message}`;
            stats.typeErrorSamples.set(key, (stats.typeErrorSamples.get(key) || 0) + 1);
          }
          check(!(err instanceof TypeError), `game ${g}: "${at.name}" was refused with an internal error instead of a clear message: ${err.message}`);
          check(snapshot(copy) === before, `game ${g}: refused "${at.name}" (${err.message}) but changed the game anyway`);
        } else {
          stats.accepted++;
          // A fuzzed action that happened to be legal must still leave a sane game.
          const ok = copy.players.every((p) => Array.isArray(p.hand) && Number.isFinite(p.spent) && p.reached.every((c) => p.visited.includes(c)))
            && !Object.prototype.polluted;
          check(ok, `game ${g}: fuzzed "${at.name}" ${JSON.stringify(at.args)?.slice(0, 120)} was accepted and left the game inconsistent`);
        }
      }
      check(snapshot(s) === before, `game ${g}: the real game changed while only copies were being fuzzed`);
    }

    applyAction(s, graph, move.seat, move.name, move.args);
    moves.push(move);

    if (fuzz && s.phase !== "over") {
      // Replay: the same move again, straight away.
      stats.replays++;
      const copy = copyOf(s), before = gains(s);
      let err = null;
      try { applyAction(copy, graph, move.seat, move.name, move.args); } catch (e) { err = e; }
      check(err ? !(err instanceof TypeError) : true, `game ${g}: replaying "${move.name}" gave an internal error: ${err?.message}`);
      if (!err && move.name !== "stepTo") check(gains(copy) === before, `game ${g}: replaying "${move.name}" handed out a second memory, stamp or destination`);
    }
  }
  return { moves, final: snapshot(s), over: s.phase === "over" };
}

// --- 1. bad input during real games ----------------------------------------------------
section("Bad actions during real games (refused, game unchanged)");
const played = [];
for (let g = 0; g < games; g++) {
  const r = playGame(g, { fuzz: true });
  check(r.over, `game ${g} did not reach the end`);
  played.push(r);
}

// --- 2. determinism -------------------------------------------------------------
section("Determinism (same seed, same deal; same moves, same end)");
for (const n of [2, 3, 4, 5, 6])
  for (let seed = 1; seed <= 40; seed++) {
    const a = E.deal(board, n, seed), b = E.deal(board, n, seed);
    check(JSON.stringify(a) === JSON.stringify(b), `${n} players, seed ${seed}: two different deals`);
  }
{
  const deals = new Set(Array.from({ length: 40 }, (_, i) => JSON.stringify(E.deal(board, 4, i + 1).hands)));
  check(deals.size === 40, `40 seeds gave only ${deals.size} different deals`);
}
for (let g = 0; g < Math.min(games, 30); g++) {
  const again = playGame(g, { moves: played[g].moves });
  check(again.final === played[g].final, `game ${g}: replaying the same moves ended differently`);
}

console.log(`${games} games played with bad input before every move`);
console.log(`  ${stats.wrongStage.toLocaleString("en-US")} "end" actions at every stage, ${stats.replays.toLocaleString("en-US")} replayed moves`);
console.log(`  ${stats.outOfTurn.toLocaleString("en-US")} out-of-turn actions, ${stats.refused.toLocaleString("en-US")} fuzzed actions refused, ${stats.accepted.toLocaleString("en-US")} fuzzed actions that happened to be legal`);
if (stats.typeErrors) {
  console.log(`  ${stats.typeErrors.toLocaleString("en-US")} refusals were internal errors rather than a clear message:`);
  for (const [k, c] of [...stats.typeErrorSamples].sort((a, b) => b[1] - a[1]).slice(0, 6)) console.log(`    ${String(c).padStart(5)} x  ${k}`);
}
console.log("\nChecks by section:");
for (const sec of sections)
  console.log(`  ${sec.name.padEnd(62, ".")} ${sec.checks.toLocaleString("en-US").padStart(7)}${sec.failed ? `  (${sec.failed} FAILED)` : ""}`);
console.log(`  ${"Total".padEnd(62, ".")} ${total.toLocaleString("en-US").padStart(7)}`);
console.log(failures ? `\n${failures} of ${total.toLocaleString("en-US")} checks FAILED` : `\nall ${total.toLocaleString("en-US")} checks passed`);
process.exit(failures ? 1 : 0);
