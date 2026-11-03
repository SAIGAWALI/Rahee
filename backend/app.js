// Entry point: the API/WebSocket backend, on its own. The frontend
// (frontend/) is a separate, independently deployable static site — in
// production it's served by Netlify, not this process — but in local
// development this still answers plain HTTP requests for it too, purely as
// a convenience so one `node app.js` is enough to play the game from a
// single machine without standing up a second static server.
//
//   node app.js [port]
//
// Binds 0.0.0.0 (not 127.0.0.1) so other devices on the same Wi-Fi can
// reach it. See the project Readme for the WSL2 LAN-testing note — run this
// with Windows' own node.exe, not WSL's, or phones on the LAN can't reach it.
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import * as E from "../frontend/src/engine.js";
import { handleConnection, kickBots } from "./handlers.js";
import { migrate, pool } from "./db.js";
import { loadRooms, rooms } from "./rooms.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, ".."); // project root, one level up from backend/
const frontendRoot = path.join(root, "frontend");
const PORT = Number(process.argv[2] || process.env.PORT || 8712);

const board = JSON.parse(fs.readFileSync(path.join(root, "frontend/data/board.json"), "utf8"));
const graph = E.buildGraph(board);

const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".png": "image/png", ".svg": "image/svg+xml", ".pdf": "application/pdf",
  ".ico": "image/x-icon", ".webp": "image/webp", ".ttf": "font/ttf", ".md": "text/markdown; charset=utf-8",
};

function serveStatic(req, res) {
  const reqPath = decodeURIComponent(new URL(req.url, "http://x").pathname);
  const rel = reqPath === "/" ? "index.html" : reqPath.replace(/^\/+/, "");
  const full = path.normalize(path.join(frontendRoot, rel));
  if (!full.startsWith(frontendRoot)) { res.writeHead(403); return res.end("forbidden"); }
  fs.readFile(full, (err, data) => {
    if (err) { res.writeHead(404); return res.end("not found — this is the API/WebSocket backend; the game itself is served separately (see Readme)"); }
    res.writeHead(200, { "Content-Type": MIME[path.extname(full)] || "application/octet-stream" });
    res.end(data);
  });
}

const server = http.createServer(serveStatic);
const wss = new WebSocketServer({ server });
wss.on("connection", (ws) => handleConnection(ws, { board, graph }));

// Heartbeat. A phone that walks out of signal or a laptop that goes to sleep
// often never says goodbye, so without this its seat would read "online" forever.
// Every tick, any socket that did not answer the previous ping is dropped (which
// marks its seat offline and lets the owner resume it); the rest are pinged again.
// The traffic also keeps idle connections from being closed by a host's proxy.
const HEARTBEAT_MS = Number(process.env.HEARTBEAT_MS || 25000);
const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.isAlive === false) { ws.terminate(); continue; }
    ws.isAlive = false;
    ws.ping();
  }
}, HEARTBEAT_MS);
wss.on("close", () => clearInterval(heartbeat));

// Exit cleanly when asked to stop (hosts send SIGTERM on redeploy; the tests do the
// same), so the process ends normally instead of being cut off mid-way.
for (const sig of ["SIGTERM", "SIGINT"]) process.on(sig, () => { server.close(); process.exit(0); });

async function main() {
  await migrate();
  await loadRooms(board);
  // Games restored mid-way may be waiting on a computer player.
  for (const room of rooms.values()) kickBots(room, graph);

  server.listen(PORT, "0.0.0.0", () => {
    const lanIps = Object.values(os.networkInterfaces())
      .flat()
      .filter((i) => i && i.family === "IPv4" && !i.internal)
      .map((i) => i.address);
    console.log(`RAHEE server listening on port ${PORT}`);
    console.log(`  on this machine:  http://localhost:${PORT}/`);
    for (const ip of lanIps) console.log(`  on the same Wi-Fi: http://${ip}:${PORT}/`);
    if (!lanIps.length) console.log("  (no LAN-facing network interface found — other devices won't be able to reach this)");
  });
}

main().catch((err) => {
  console.error("failed to start:", err);
  pool.end();
  process.exit(1);
});
