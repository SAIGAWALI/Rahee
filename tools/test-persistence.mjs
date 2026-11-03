// Test Phase 2. Server restart and persistence.
//
// The server keeps every room in the database and rebuilds its in-memory copy
// from the database when it starts (rooms.js loadRooms, called by app.js). This
// test plays complete games through the server's own room functions and
// applyAction(), and after EVERY move it simulates a server restart: the
// in-memory rooms are thrown away and rebuilt from the database rows, exactly as
// at boot. It then checks that:
//
//   - the restored game is identical to the one before the restart
//   - seats keep their names, characters and computer-player levels
//   - every player's reconnection token still works after the restart, and
//     nobody shows as connected until they reconnect
//   - the game can be played on to the end from the restored copy, with scores
//     that add up
//
// It also covers a restart in the lobby, and reclaiming a seat by room code and
// name after a restart (new token issued, old token stops working).
//
// Uses the in-memory database driver (DB_DRIVER=memory), which stores each room
// as the same JSON text the MySQL/TiDB table holds.
//
//   node tools/test-persistence.mjs [games=40]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

process.env.DB_DRIVER = "memory";
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const imp = (p) => import(pathToFileURL(path.join(root, p)).href);
const E = await imp("frontend/src/engine.js");
const { chooseAction } = await imp("frontend/src/ai.js");
const { applyAction } = await imp("backend/actions.js");
const { redact } = await imp("backend/redact.js");
const { pool, migrate } = await imp("backend/db.js");
const R = await imp("backend/rooms.js");
const { addBot } = await imp("backend/bots.js");
const board = JSON.parse(fs.readFileSync(path.join(root, "frontend/data/board.json"), "utf8"));
const graph = E.buildGraph(board);
const games = Number(process.argv[2] || 40);

let failures = 0, total = 0;
const sections = [];
const section = (name) => sections.push({ name, checks: 0, failed: 0 });
const check = (cond, msg) => {
  total++;
  const cur = sections[sections.length - 1];
  cur.checks++;
  if (!cond) { failures++; cur.failed++; if (cur.failed <= 5) console.log("  FAIL:", msg); }
};

const snap = (room) => JSON.stringify({ state: room.state && { ...room.state, board: undefined }, seats: room.seats.map((s) => ({ name: s.name, characterId: s.characterId, isBot: !!s.isBot, botLevel: s.botLevel ?? null, tokenHash: s.tokenHash ?? null })) });
/** What app.js does at boot: forget every in-memory room and load them all from the database. */
async function restart(code) {
  R.rooms.clear();
  await R.loadRooms(board);
  return R.rooms.get(code);
}
const fakeSocket = () => ({ readyState: 1, OPEN: 1 });

await migrate();
const quiet = console.log;
console.log = (...a) => { if (!/restored \d+ room/.test(String(a[0]))) quiet(...a); }; // loadRooms logs on every restart

let restarts = 0, moves = 0;
section("Restart after every move: game identical, seats and tokens kept");
for (let g = 0; g < games; g++) {
  const humans = 1 + (g % 2), bots = 1 + (g % 5) - (g % 5 >= 5 - humans ? 1 : 0);
  let room = await R.createRoom(board);
  const code = room.code;
  const tokens = [];
  for (let i = 0; i < humans; i++) tokens.push((await R.addSeat(room, `Human ${i}`, fakeSocket())).token);
  const chars = board.characters.map((c) => c.id);
  for (let i = 0; i < humans; i++) await R.pickCharacter(room, i, chars[(g + i) % 6]);
  for (let i = 0; i < bots; i++) await addBot(room, ["greedy", "goals", "easy"][(g + i) % 3]);

  // Restart while still in the lobby.
  let before = snap(room);
  room = await restart(code); restarts++;
  check(room && snap(room) === before, `game ${g}: the lobby changed across a restart`);
  check(room.seats.every((s) => !s.ws), `game ${g}: a seat shows a live connection right after a restart`);
  tokens.forEach((t, i) => check(R.seatForToken(room, t) === i, `game ${g}: seat ${i}'s token stopped working after a restart`));

  await R.startGame(room, 4242 + g);
  const n = room.seats.length;
  const rand = E.rng(31 + g);
  let guard = 0;
  while (room.state.phase !== "over" && guard++ < 6000) {
    let move = null;
    for (const seat of [E.currentPlayer(room.state).id, ...room.state.players.map((p) => p.id)]) {
      const level = room.seats[seat].botLevel || "greedy";
      const a = chooseAction({ ...redact(room.state, seat), board }, graph, seat, { level, rand });
      if (a) { move = { seat, a }; break; }
    }
    if (!move) break;
    applyAction(room.state, graph, move.seat, move.a.name, move.a.args);
    await R.persistRoom(room); moves++;

    before = snap(room);
    room = await restart(code); restarts++;
    check(room && snap(room) === before, `game ${g}: state changed across a restart after "${move.a.name}"`);
    check(room.state.board === board, `game ${g}: restored game has no board attached`);
  }
  check(room.state.phase === "over", `game ${g} (${n} players) did not finish after restarts`);
  for (const r of E.finalScores(room.state)) check(r.total === r.tourist + r.destinations + r.bonus + r.memories + r.penalty, `game ${g}: score does not add up after restarts`);
  tokens.forEach((t, i) => check(R.seatForToken(room, t) === i, `game ${g}: seat ${i}'s token stopped working by the end`));
  await pool.query("DELETE FROM rooms WHERE code = ?", [code]);
}

section("Reclaiming a seat after a restart");
{
  let room = await R.createRoom(board);
  const code = room.code;
  const { token } = await R.addSeat(room, "Asha", fakeSocket());
  await R.addSeat(room, "Bilal", fakeSocket());
  await R.pickCharacter(room, 0, "pilgrim");
  await R.pickCharacter(room, 1, "musician");
  await R.startGame(room, 99);
  room = await restart(code);
  const again = await R.reclaimSeat(room, "  asha ", fakeSocket()); // other case and spaces
  check(again && again.seatIndex === 0, "Asha could not reclaim her seat by code and name after a restart");
  check(again && again.token !== token && R.seatForToken(room, again.token) === 0, "reclaiming did not issue a new working token");
  check(R.seatForToken(room, token) === -1, "the old token still works after the seat was reclaimed");
  room = await restart(code);
  check(R.seatForToken(room, again.token) === 0 && R.seatForToken(room, token) === -1, "the new token was not saved to the database");
  check(await R.reclaimSeat(room, "Asha", fakeSocket()) !== null, "a seat with no live connection after a restart could not be reclaimed");
  check(await R.reclaimSeat(room, "Asha", fakeSocket()) === null, "a seat that is connected again was taken by a second claim");
  check(await R.reclaimSeat(room, "Nobody", fakeSocket()) === null, "a made-up name got a seat");
}

console.log = quiet;
console.log(`${games} games, ${moves.toLocaleString("en-US")} moves, ${restarts.toLocaleString("en-US")} simulated server restarts`);
console.log("\nChecks by section:");
for (const sec of sections)
  console.log(`  ${sec.name.padEnd(62, ".")} ${sec.checks.toLocaleString("en-US").padStart(7)}${sec.failed ? `  (${sec.failed} FAILED)` : ""}`);
console.log(`  ${"Total".padEnd(62, ".")} ${total.toLocaleString("en-US").padStart(7)}`);
console.log(failures ? `\n${failures} of ${total.toLocaleString("en-US")} checks FAILED` : `\nall ${total.toLocaleString("en-US")} checks passed`);
process.exit(failures ? 1 : 0);
