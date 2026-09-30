// Entry point: serves the existing static game files exactly as
// `python3 -m http.server` does today, and shares the same port with a
// WebSocket server for game traffic. One process, one port — the simplest
// thing that lets a browser load the page *and* reach the socket with no
// separate address to configure.
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
import * as E from "../src/engine.js";
import { handleConnection } from "./handlers.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, ".."); // project root, one level up from server/
const PORT = Number(process.argv[2] || process.env.PORT || 8712);

const board = JSON.parse(fs.readFileSync(path.join(root, "data/board.json"), "utf8"));
const graph = E.buildGraph(board);

const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".png": "image/png", ".svg": "image/svg+xml", ".pdf": "application/pdf",
  ".ico": "image/x-icon",
};

function serveStatic(req, res) {
  const reqPath = decodeURIComponent(new URL(req.url, "http://x").pathname);
  const rel = reqPath === "/" ? "index.html" : reqPath.replace(/^\/+/, "");
  const full = path.normalize(path.join(root, rel));
  if (!full.startsWith(root)) { res.writeHead(403); return res.end("forbidden"); }
  fs.readFile(full, (err, data) => {
    if (err) { res.writeHead(404); return res.end("not found"); }
    res.writeHead(200, { "Content-Type": MIME[path.extname(full)] || "application/octet-stream" });
    res.end(data);
  });
}

const server = http.createServer(serveStatic);
const wss = new WebSocketServer({ server });
wss.on("connection", (ws) => handleConnection(ws, { board, graph }));

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
