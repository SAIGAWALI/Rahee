// Test Phase 2. The real backend over WebSockets: lobby limits, reconnection
// edge cases, mutation-based fuzzing of the message protocol, and the static
// file server.
//
//   1. Lobby rules and limits — name length (17/18/19 characters), empty names,
//      6 seats then "room is full", joining a started game, host-only controls,
//      taken/unknown characters, starting with too few players or no character.
//   2. Reconnection — resume with the token (same seat, same hand); a wrong
//      token, an unknown room and no token all get the SAME answer; a second
//      window takes the seat over and the first is closed with code 4001;
//      reclaiming by room code + name works only for a disconnected seat, issues
//      a new token and retires the old one; other players see "offline".
//   3. Mutation-based fuzzing (radamsa-style) — thousands of valid messages
//      mutated with bit flips, inserted/deleted/duplicated chunks, JSON symbols,
//      protocol keywords and "interesting" values, plus raw binary frames and an
//      oversized message. The server must never crash, must keep answering, and
//      a normal game must still work afterwards.
//   4. Static files — the game page is served; "../" path tricks never leak a
//      file from outside frontend/.
//
//   node tools/test-protocol.mjs [fuzzMessages=4000]
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(root, "backend/package.json"));
const WebSocket = require("ws");
const E = await import(pathToFileURL(path.join(root, "frontend/src/engine.js")).href);
const fuzzCount = Number(process.argv[2] || 4000);

let failures = 0, total = 0;
const sections = [];
const section = (name) => { sections.push({ name, checks: 0, failed: 0 }); };
const check = (cond, msg) => {
  total++;
  const cur = sections[sections.length - 1];
  cur.checks++;
  if (!cond) { failures++; cur.failed++; if (cur.failed <= 5) console.log("  FAIL:", msg); }
};

const port = 20000 + Math.floor(Math.random() * 20000);
const server = spawn(process.execPath, [path.join(root, "backend/app.js"), String(port)], {
  env: { ...process.env, DB_DRIVER: "memory", BOT_DELAY_MS: "5", BOT_RIDER_WAIT_MS: "300", HEARTBEAT_MS: "60000" },
  stdio: ["ignore", "pipe", "pipe"],
});
let serverLog = "", serverExited = null;
server.stdout.on("data", (d) => { serverLog += d; });
server.stderr.on("data", (d) => { serverLog += d; });
server.on("exit", (code, sig) => { serverExited = `${code ?? sig}`; });
const finish = (code) => { server.kill(); process.exit(code); };
setTimeout(() => { console.log("  FAIL: timed out\n", serverLog.slice(-1500)); finish(1); }, 180000);
await new Promise((res) => { const iv = setInterval(() => { if (serverLog.includes("listening")) { clearInterval(iv); res(); } }, 50); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** A small client that records every message and can wait for one. */
function client() {
  const c = { msgs: [], closed: null };
  c.ws = new WebSocket(`ws://127.0.0.1:${port}`);
  c.ready = new Promise((res, rej) => { c.ws.on("open", res); c.ws.on("error", rej); });
  c.ws.on("message", (raw) => { try { c.msgs.push(JSON.parse(raw)); } catch { c.msgs.push({ type: "unparsable" }); } });
  c.ws.on("close", (code) => { c.closed = code; });
  c.ws.on("error", () => {});
  c.send = (m) => c.ws.send(typeof m === "string" || Buffer.isBuffer(m) ? m : JSON.stringify(m));
  /** Waits for the next message (after `from`) matching pred; resolves null after `ms`. */
  c.next = async (pred, ms = 3000, from = c.msgs.length) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      const m = c.msgs.slice(from).find(pred);
      if (m) return m;
      await sleep(10);
    }
    return null;
  };
  c.ask = async (m, pred, ms) => { const from = c.msgs.length; c.send(m); return c.next(pred, ms, from); };
  return c;
}
const isErr = (m) => m.type === "error";
async function newRoom(name = "Host") {
  const h = client(); await h.ready;
  const r = await h.ask({ type: "create_room", name }, (m) => m.type === "room_created");
  h.code = r.code; h.token = r.token; h.seat = r.seatIndex;
  return h;
}
async function join(code, name) {
  const c = client(); await c.ready;
  const r = await c.ask({ type: "join_room", code, name }, (m) => m.type === "joined" || m.type === "resumed" || isErr(m));
  c.reply = r; c.token = r?.token; c.seat = r?.seatIndex;
  return c;
}
const lastLobby = (c) => [...c.msgs].reverse().find((m) => m.type === "lobby_update");

// --- 1. Lobby rules and limits --------------------------------------------------------------
section("Lobby rules and limits");
{
  const h = await newRoom("H".repeat(19));
  check(/^[A-Z2-9]{4}$/.test(h.code), `room code ${h.code}`);
  await sleep(100);
  check(lastLobby(h)?.seats[0].name.length === 18, `a 19-character name was kept as ${lastLobby(h)?.seats[0].name.length} characters (limit 18)`);
  const a = await join(h.code, "A".repeat(18));
  const b = await join(h.code, "B".repeat(17));
  const e = await join(h.code, "");
  await sleep(150);
  const names = lastLobby(h).seats.map((s) => s.name);
  check(names[1].length === 18 && names[2].length === 17, "an 18- or 17-character name was changed");
  check(names[3] === "Player", `an empty name became "${names[3]}"`);
  check((await join("ZZZZ", "Nobody")).reply?.message?.includes("no room"), "an unknown room code was accepted");
  check(isErr(await a.ask({ type: "add_bot", level: "greedy" }, (m) => isErr(m) || m.type === "lobby_update")), "a guest could add a computer player");
  check(isErr(await a.ask({ type: "start_game" }, (m) => isErr(m) || m.type === "state")), "a guest could start the game");
  check(isErr(await h.ask({ type: "start_game" }, (m) => isErr(m) || m.type === "state")), "the game started before everyone had a character");
  check(isErr(await h.ask({ type: "pick_character", characterId: "wizard" }, (m) => isErr(m) || m.type === "lobby_update")), "an unknown character was accepted");
  await h.ask({ type: "pick_character", characterId: "pilgrim" }, (m) => m.type === "lobby_update");
  check(isErr(await a.ask({ type: "pick_character", characterId: "pilgrim" }, (m) => isErr(m) || m.type === "lobby_update")), "two players got the same character");
  await h.ask({ type: "add_bot", level: "easy" }, (m) => m.type === "lobby_update");
  check((await join(h.code, "Sixth")).seat === 5, "the 6th seat could not be taken");
  check((await join(h.code, "Seventh")).reply?.message?.includes("full"), "a 7th player got into a 6-seat room");
  check(isErr(await h.ask({ type: "add_bot", level: "easy" }, (m) => isErr(m) || m.type === "lobby_update")), "a 7th seat was added as a computer player");
  for (const c of [h, a, b, e]) c.ws.close();

  const solo = await newRoom("Solo");
  await solo.ask({ type: "pick_character", characterId: "historian" }, (m) => m.type === "lobby_update");
  check((await solo.ask({ type: "start_game" }, (m) => isErr(m) || m.type === "state"))?.message?.includes("at least 2"), "a 1-player game was started");
  check(isErr(await solo.ask({ type: "action", name: "playCard", args: {} }, (m) => isErr(m))), "an action was accepted before the game started");
  const lone = client(); await lone.ready;
  check((await lone.ask({ type: "action", name: "endTurn", args: {} }, isErr))?.message?.includes("join a room first"), "an action from a socket with no seat was accepted");
  lone.ws.close(); solo.ws.close();
}

// --- 2. Reconnection --------------------------------------------------------------------------
section("Reconnection and seat takeover");
{
  const h = await newRoom("Asha");
  const g = await join(h.code, "Bilal");
  await h.ask({ type: "pick_character", characterId: "pilgrim" }, (m) => m.type === "lobby_update");
  await g.ask({ type: "pick_character", characterId: "musician" }, (m) => m.type === "lobby_update");
  const st = await h.ask({ type: "start_game" }, (m) => m.type === "state");
  check(st, "the game did not start");
  await g.next((m) => m.type === "state");
  const handOf = (c) => JSON.stringify([...c.msgs].reverse().find((m) => m.type === "state" || m.type === "resumed")?.state?.players[c.seat].hand);
  const bilalHand = handOf(g);

  // Bilal drops; Asha sees him offline.
  const mark = h.msgs.length;
  g.ws.close(); await sleep(200);
  check(h.msgs.slice(mark).some((m) => m.type === "presence" && m.online[1] === false), "a dropped player was not shown offline");

  // Resume with the token: same seat, same hand.
  const g2 = client(); await g2.ready;
  const res = await g2.ask({ type: "resume", code: h.code, token: g.token }, (m) => m.type === "resumed" || m.type === "resume_failed");
  check(res?.type === "resumed" && res.seatIndex === 1, "resuming with the token did not give the same seat");
  check(JSON.stringify(res?.state?.players[1].hand) === bilalHand, "the resumed hand is different");
  check(res?.state?.players[0].hand === undefined, "the resumed state showed another player's hand");

  // Wrong token, unknown room, no token: the same answer every time.
  const answers = [];
  for (const m of [{ code: h.code, token: "f".repeat(48) }, { code: "QQQQ", token: g.token }, { code: h.code }, { code: h.code, token: "x".repeat(5000) }]) {
    const c = client(); await c.ready;
    answers.push(JSON.stringify(await c.ask({ type: "resume", ...m }, (x) => x.type === "resumed" || x.type === "resume_failed")));
    c.ws.close();
  }
  check(answers.every((x) => x === answers[0]) && JSON.parse(answers[0]).type === "resume_failed", `bad resumes got different answers: ${[...new Set(answers)].join(" / ")}`);

  // A second window with the same token takes the seat; the first is told and closed with 4001.
  const g3 = client(); await g3.ready;
  const res3 = await g3.ask({ type: "resume", code: h.code, token: g.token }, (m) => m.type === "resumed");
  await sleep(200);
  check(res3?.seatIndex === 1, "the second window did not get the seat");
  check(g2.msgs.some((m) => isErr(m) && /taken over/.test(m.message)) && g2.closed === 4001, `the first window was not told and closed with 4001 (closed: ${g2.closed})`);

  // Reclaim by code + name: refused while connected, allowed once disconnected (any case), new token.
  const busy = await join(h.code, "bilal");
  check(busy.reply?.type === "error", "a connected seat was taken by typing its name");
  busy.ws.close();
  g3.ws.close(); await sleep(150);
  const back = await join(h.code, "  BILAL ");
  check(back.reply?.type === "resumed" && back.seat === 1 && back.token && back.token !== g.token, "reclaiming a disconnected seat by name failed or kept the old token");
  const old = client(); await old.ready;
  check((await old.ask({ type: "resume", code: h.code, token: g.token }, (m) => m.type === "resumed" || m.type === "resume_failed"))?.type === "resume_failed", "the old token still worked after the seat was reclaimed");
  check((await join(h.code, "Stranger")).reply?.message?.includes("already started"), "a new player joined a game in progress");
  // Moves out of turn are refused; the unknown-action fix holds over the wire too.
  const cur = res.state.firstPlayer;
  const other = cur === 0 ? back : h;
  check((await other.ask({ type: "action", name: "endTurn", args: {} }, isErr))?.message?.includes("isn't your turn"), "a move out of turn was accepted");
  for (const name of ["constructor", "toString", "__proto__", "hasOwnProperty"])
    check((await h.ask({ type: "action", name, args: {} }, isErr, 1500))?.message?.includes("unknown action"), `action "${name}" was not refused as unknown`);
  for (const c of [h, back, old]) c.ws.close();
}

// --- 3. Mutation-based fuzzing ------------------------------------------------------------------
section("Mutation-based fuzzing of the message protocol");
const fuzzStats = { sent: 0, answered: 0, binary: 0 };
{
  const host = await newRoom("Fuzz");
  const seeds = [
    { type: "create_room", name: "Asha" }, { type: "join_room", code: host.code, name: "Bilal" },
    { type: "resume", code: host.code, token: host.token }, { type: "pick_character", characterId: "pilgrim" },
    { type: "add_bot", level: "greedy" }, { type: "remove_bot", seatIndex: 1 }, { type: "start_game" },
    { type: "action", name: "playCard", args: { cardId: "10♠", ace: { cardId: "A♥", mode: "boost" } } },
    { type: "action", name: "stepTo", args: { cityId: "new-delhi" } },
    { type: "action", name: "proposeRoadTrip", args: { companions: [1], owner: 1, cardId: "4♦", destination: "gwalior" } },
    { type: "action", name: "respondRoadTrip", args: { type: "accept", stop: "agra" } },
  ];
  const keywords = ["create_room", "join_room", "resume", "action", "start_game", "__proto__", "constructor", "null", "true", "NaN", "-1", "1e309", "9007199254740993", "\"\"", "[]", "{}"];
  const interesting = [0, -1, 1, 2147483647, -2147483648, 1e309, null, "", "A".repeat(2000), [], {}, true];
  const rand = E.rng(2026);
  const pick = (xs) => xs[Math.floor(rand() * xs.length)];
  function mutate(text) {
    let s = text;
    const ops = 1 + Math.floor(rand() * 4);
    for (let i = 0; i < ops; i++) {
      const at = Math.floor(rand() * (s.length + 1));
      switch (Math.floor(rand() * 8)) {
        case 0: { const c = s.charCodeAt(at) || 65; s = s.slice(0, at) + String.fromCharCode(c ^ (1 << Math.floor(rand() * 7))) + s.slice(at + 1); break; } // bit flip
        case 1: s = s.slice(0, at) + s.slice(at + 1 + Math.floor(rand() * 6)); break; // delete a chunk
        case 2: s = s.slice(0, at) + pick(['{', '}', '[', ']', '"', ':', ',', '\\', '\u0000', '\ud800']) + s.slice(at); break; // JSON symbol
        case 3: s = s.slice(0, at) + pick(keywords) + s.slice(at); break; // dictionary keyword
        case 4: { const len = Math.floor(rand() * 10); s = s.slice(0, at) + s.slice(at, at + len).repeat(2 + Math.floor(rand() * 3)) + s.slice(at + len); break; } // duplicate a chunk
        case 5: s = s.slice(0, at); break; // truncate
        case 6: { // replace one value with an interesting one (structure-aware)
          try { const o = JSON.parse(s); const keys = Object.keys(o); if (keys.length) o[pick(keys)] = pick(interesting); s = JSON.stringify(o); } catch { /* already broken */ }
          break;
        }
        default: s = s.slice(0, at) + String.fromCharCode(Math.floor(rand() * 0xffff)) + s.slice(at); // random character
      }
    }
    return s;
  }
  const fuzzers = [];
  for (let k = 0; k < 4; k++) { const c = client(); await c.ready; fuzzers.push(c); }
  fuzzers.push(host);
  for (let i = 0; i < fuzzCount; i++) {
    const c = pick(fuzzers);
    if (c.closed !== null) continue;
    if (i % 50 === 0) { c.send(Buffer.from(Array.from({ length: 1 + Math.floor(rand() * 300) }, () => Math.floor(rand() * 256)))); fuzzStats.binary++; }
    else c.send(mutate(JSON.stringify(pick(seeds))));
    fuzzStats.sent++;
    if (i % 200 === 0) await sleep(5);
  }
  host.send(JSON.stringify({ type: "create_room", name: "x".repeat(2_000_000) })); // oversized (~2 MB) message
  await sleep(1500);
  fuzzStats.answered = fuzzers.reduce((n, c) => n + c.msgs.length, 0);
  check(serverExited === null, `the server crashed during fuzzing (exit ${serverExited})`);
  check(!/Uncaught|TypeError|ReferenceError|at .*\.js:\d+/.test(serverLog), `the server logged an error while fuzzing:\n${serverLog.split("\n").filter((l) => /Error|at /.test(l)).slice(0, 4).join("\n")}`);
  check(fuzzers.every((c) => c.msgs.every((m) => m.type !== "unparsable")), "the server sent something that is not JSON");
  // Still answering normally afterwards: a fresh 2-player game starts and a first card is laid.
  const h = await newRoom("After");
  const g = await join(h.code, "Fuzz-proof");
  check(h.code && g.seat === 1, "a normal room could not be created after fuzzing");
  await h.ask({ type: "pick_character", characterId: "explorer" }, (m) => m.type === "lobby_update");
  await g.ask({ type: "pick_character", characterId: "historian" }, (m) => m.type === "lobby_update");
  const st = await h.ask({ type: "start_game" }, (m) => m.type === "state");
  const card = st?.state.players[0].hand[0].id;
  const laid = await h.ask({ type: "action", name: "layRoadTripCard", args: { cardId: card } }, (m) => m.type === "state" && m.state.players[0].faceUp.length === 1);
  check(laid, "a normal move failed after fuzzing");
  for (const c of [...fuzzers, h, g]) c.ws.close();
}

// --- 4. Static files ------------------------------------------------------------------------
section("Static file server");
{
  const get = (p) => new Promise((res) => {
    const req = http.request({ host: "127.0.0.1", port, path: p, method: "GET" }, (r) => { let body = ""; r.on("data", (d) => { body += d; }); r.on("end", () => res({ status: r.statusCode, body })); });
    req.on("error", () => res({ status: 0, body: "" }));
    req.end();
  });
  const home = await get("/");
  check(home.status === 200 && /<html/i.test(home.body), "the game page is not served at /");
  check((await get("/data/board.json")).status === 200, "board.json is not served");
  const secrets = [fs.readFileSync(path.join(root, "backend/app.js"), "utf8").slice(0, 60), fs.readFileSync(path.join(root, "backend/.env.example"), "utf8").slice(0, 40), "rahee-backend"];
  for (const p of ["/../backend/app.js", "/..%2fbackend%2fapp.js", "/%2e%2e/%2e%2e/backend/.env.example", "/....//backend/package.json", "/..\\backend\\app.js", "/%2e%2e%2fbackend/package.json", "/assets/../../backend/app.js"]) {
    const r = await get(p);
    check(r.status !== 200 || !secrets.some((s) => r.body.includes(s)), `${p} leaked a file from outside frontend/ (status ${r.status})`);
  }
  check((await get("/no-such-file.js")).status === 404, "a missing file did not return 404");
}

check(serverExited === null, "the server is no longer running at the end");
console.log(`fuzzing: ${fuzzStats.sent.toLocaleString("en-US")} mutated messages (${fuzzStats.binary} raw binary frames) + one 2 MB message, ${fuzzStats.answered.toLocaleString("en-US")} replies; server still running: ${serverExited === null ? "yes" : "NO"}`);
console.log("\nChecks by section:");
for (const sec of sections)
  console.log(`  ${sec.name.padEnd(62, ".")} ${sec.checks.toLocaleString("en-US").padStart(7)}${sec.failed ? `  (${sec.failed} FAILED)` : ""}`);
console.log(`  ${"Total".padEnd(62, ".")} ${total.toLocaleString("en-US").padStart(7)}`);
console.log(failures ? `\n${failures} of ${total.toLocaleString("en-US")} checks FAILED` : `\nall ${total.toLocaleString("en-US")} checks passed`);
finish(failures ? 1 : 0);
