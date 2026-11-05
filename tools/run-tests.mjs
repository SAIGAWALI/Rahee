// The whole test suite, one command: `npm test` (from the project root).
//
//   1. engine   — board sanity, deals, route-search regressions (B1–B4), manual
//                 examples, and 80 random complete games checked rule by rule
//   2. rules    — one hand-built scenario per rule clarified in RULES.md
//   3. playtest — 300 complete games between the computer players, every move
//                 checked; its report goes to docs/test-results/playtest/test-run/
//   4. server   — the real backend end to end: two clients + computer players
//                 play a whole game over WebSockets (privacy, turn order,
//                 reconnection, bots), for 3 and 6 players
//
// Added in Test Phase 2:
//   5. board       — board.json against the RULES.md tables, and the route
//                    search against an independent search on every city pair
//   6. boundaries  — boundary values, equivalence classes and all-pairs games
//   7. robustness  — fuzzed and out-of-turn actions during real games must be
//                    refused without changing anything; determinism by seed
//   8. persistence — a simulated server restart after every move
//   9. protocol    — lobby limits, reconnection edge cases, mutation fuzzing of
//                    the WebSocket messages, static-file path tricks
//  10. load        — 20 games at once on one server, with response times
//
// The browser test (tools/test-browser.cjs) needs Playwright and runs separately:
// npm run test:browser
//
// Needs `npm install` in backend/ once (for the server test's WebSocket client).
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const suites = [
  ["engine", ["tools/test-engine.mjs", ".", "80"]],
  ["rules", ["tools/test-rules.mjs", "."]],
  ["playtest", ["tools/playtest.mjs", "300", "--out=docs/test-results/playtest/test-run"]],
  ["server (3 players)", ["tools/test-server.mjs", "3"]],
  ["server (6 players)", ["tools/test-server.mjs", "6"]],
  ["board", ["tools/test-board.mjs"]],
  ["boundaries", ["tools/test-boundaries.mjs"]],
  ["robustness", ["tools/test-robustness.mjs", "60"]],
  ["persistence", ["tools/test-persistence.mjs", "40"]],
  ["protocol", ["tools/test-protocol.mjs", "4000"]],
  ["load (20 games at once)", ["tools/test-load.mjs", "20"]],
];
const results = [];
for (const [name, args] of suites) {
  console.log(`\n=== ${name} ===`);
  const t0 = Date.now();
  const r = spawnSync(process.execPath, args, { cwd: root, stdio: "inherit" });
  results.push({ name, ok: r.status === 0, secs: (Date.now() - t0) / 1000 });
}
console.log("\n=== summary ===");
for (const r of results) console.log(`  ${r.ok ? "PASS" : "FAIL"}  ${r.name}  (${r.secs.toFixed(1)}s)`);
process.exit(results.every((r) => r.ok) ? 0 : 1);
