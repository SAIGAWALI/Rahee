// Test Phase 2. Load and performance: many games at once on one server.
//
// Starts the real backend (in-memory database) and opens ROOMS rooms at the same
// time. In each room a WebSocket client plays one seat from what it is sent (the
// same computer-player logic a browser's "Auto" button uses) and three computer
// players fill the other seats on the server. Every game must reach the
// scoreboard, every state message must keep other hands hidden, and the test
// reports how fast the server answered:
//
//   - response time per move (send -> the next state for that client): median,
//     95th percentile and worst
//   - moves handled per second across all rooms
//   - server memory before and after (Linux / WSL only)
//
//   node tools/test-load.mjs [rooms=20]
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(root, "backend/package.json"));
const WebSocket = require("ws");
const E = await import(pathToFileURL(path.join(root, "frontend/src/engine.js")).href);
const { chooseAction } = await import(pathToFileURL(path.join(root, "frontend/src/ai.js")).href);
const board = JSON.parse(fs.readFileSync(path.join(root, "frontend/data/board.json"), "utf8"));
const graph = E.buildGraph(board);
const ROOMS = Number(process.argv[2] || 20);

let failures = 0, checks = 0;
const check = (c, m) => { checks++; if (!c) { failures++; if (failures <= 8) console.log("  FAIL:", m); } };

const port = 20000 + Math.floor(Math.random() * 20000);
const server = spawn(process.execPath, [path.join(root, "backend/app.js"), String(port)], {
  env: { ...process.env, DB_DRIVER: "memory", BOT_DELAY_MS: "5", BOT_RIDER_WAIT_MS: "300", HEARTBEAT_MS: "60000" },
  stdio: ["ignore", "pipe", "pipe"],
});
let serverLog = "", exited = null;
server.stdout.on("data", (d) => { serverLog += d; });
server.stderr.on("data", (d) => { serverLog += d; });
server.on("exit", (c) => { exited = c; });
const stop = (code) => { server.kill(); process.exit(code); };
setTimeout(() => { console.log("  FAIL: timed out"); stop(1); }, 240000);
await new Promise((res) => { const iv = setInterval(() => { if (serverLog.includes("listening")) { clearInterval(iv); res(); } }, 50); });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const rssMB = () => { try { return Number(fs.readFileSync(`/proc/${server.pid}/status`, "utf8").match(/VmRSS:\s+(\d+)/)[1]) / 1024; } catch { return null; } };

const latencies = [];
let movesSent = 0, stateMsgs = 0;
function player(i) {
  const c = { seat: null, code: null, state: null, busy: false, sentAt: 0, lastKey: null, done: false };
  c.ws = new WebSocket(`ws://127.0.0.1:${port}`);
  c.ready = new Promise((r) => c.ws.on("open", r));
  c.send = (o) => c.ws.send(JSON.stringify(o));
  c.play = () => {
    if (c.busy || !c.state || c.state.phase === "over") return;
    const a = chooseAction(c.state, graph, c.seat, { level: "greedy" });
    if (!a) return;
    // Don't resend a move already in flight. Our own hand is part of the key, so asking
    // again after a reshuffle (a new hand, perhaps with two Aces again) is a new move.
    const hand = c.state.players[c.seat].hand.map((x) => x.id).join();
    const key = `${c.state.round}:${c.state.turnIndex}:${c.state.turn?.stage}:${c.state.turn?.stepsUsed}:${hand}:${JSON.stringify(a)}`;
    if (key === c.lastKey) return;
    c.lastKey = key; c.busy = true; c.sentAt = performance.now(); movesSent++;
    c.send({ type: "action", name: a.name, args: a.args });
  };
  c.ws.on("message", (raw) => {
    const m = JSON.parse(raw);
    if (m.type === "room_created") { c.seat = m.seatIndex; c.code = m.code; }
    if (m.type === "lobby_update" && Number.isInteger(m.seatIndex)) c.seat = m.seatIndex;
    if (m.type === "state") {
      stateMsgs++;
      m.state.players.forEach((p, k) => { if (k !== c.seat) check(p.hand === undefined, `room ${i}: saw seat ${k}'s hand`); });
      if (c.busy) latencies.push(performance.now() - c.sentAt);
      c.state = { ...m.state, board }; c.busy = false;
      if (c.state.phase === "over") c.done = true; else c.play();
    }
    if (m.type === "error" && c.busy) { c.busy = false; c.lastKey = null; setTimeout(() => c.play(), 20); }
  });
  return c;
}

const rssBefore = rssMB();
const players = Array.from({ length: ROOMS }, (_, i) => player(i));
await Promise.all(players.map((c) => c.ready));
// Every room: create, add three computer players, pick a character, start — all at the same time.
for (const c of players) c.send({ type: "create_room", name: "Load" });
await wait(300);
for (const c of players) for (const lvl of ["greedy", "goals", "easy"]) c.send({ type: "add_bot", level: lvl });
await wait(300);
for (const [i, c] of players.entries()) {
  // pick a character no computer player took
  c.send({ type: "pick_character", characterId: board.characters[i % 6].id });
}
await wait(300);
for (const c of players) {
  // if that character was taken, try the others until one sticks
  for (const ch of board.characters) c.send({ type: "pick_character", characterId: ch.id });
}
await wait(300);
const t0 = performance.now();
for (const c of players) c.send({ type: "start_game" });

const tEnd = performance.now() + 200000;
while (players.some((c) => !c.done) && performance.now() < tEnd) await wait(100);
const secs = (performance.now() - t0) / 1000;
const rssAfter = rssMB();

const finished = players.filter((c) => c.done).length;
if (process.env.DEBUG_LOAD) for (const [i, c] of players.entries()) if (!c.done) {
  const st = c.state;
  console.log(`  room ${i} ${c.code}: ${st ? `phase ${st.phase}, round ${st.round}, stage ${st.turn?.stage}, current seat ${E.currentPlayer(st).id} (${E.currentPlayer(st).name}), my seat ${c.seat}, busy ${c.busy}, last log: ${st.log.slice(-3).map((l) => l.text).join(" | ")}` : "never started"}`);
}
check(finished === ROOMS, `only ${finished} of ${ROOMS} games reached the scoreboard`);
check(exited === null, "the server stopped during the load test");
check(!/refused/.test(serverLog), "a computer player's move was refused under load");
for (const c of players) if (c.done) for (const r of E.finalScores(c.state))
  check(r.total === r.tourist + r.destinations + r.bonus + r.memories + r.penalty, "a score does not add up");
latencies.sort((a, b) => a - b);
const pct = (q) => latencies[Math.min(latencies.length - 1, Math.floor(q * latencies.length))] ?? 0;
check(pct(0.95) < 500, `95% of moves should be answered within 500 ms (got ${pct(0.95).toFixed(0)} ms)`);

console.log(`${ROOMS} games at once (4 players each: 1 WebSocket client + 3 computer players)`);
console.log(`  finished: ${finished}/${ROOMS} in ${secs.toFixed(1)} s`);
console.log(`  client moves: ${movesSent.toLocaleString("en-US")}, state messages received: ${stateMsgs.toLocaleString("en-US")} (${Math.round(stateMsgs / secs).toLocaleString("en-US")} per second)`);
console.log(`  response time per move: median ${pct(0.5).toFixed(1)} ms, 95th percentile ${pct(0.95).toFixed(1)} ms, worst ${latencies.at(-1)?.toFixed(1)} ms`);
if (rssBefore !== null) console.log(`  server memory: ${rssBefore.toFixed(0)} MB before, ${rssAfter?.toFixed(0)} MB after`);
console.log(failures ? `\n${failures} of ${checks.toLocaleString("en-US")} checks FAILED` : `\nall ${checks.toLocaleString("en-US")} checks passed`);
stop(failures ? 1 : 0);
