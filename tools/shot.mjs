// Drives headless Chrome over the DevTools protocol to screenshot the app while
// clicking through a scripted sequence. Used to eyeball the interface without a
// desktop session.
//
//   node shot.mjs <chromeExe> <url> <outDir> <scriptFile>
//
// The script file exports an array of steps; each is either a string of JS to
// evaluate in the page, a number of milliseconds to wait, { shot: "name" }, or
// { tap: "<expression returning {x,y} client coordinates>" } which sends a real
// mouse press and release there. Taps go through the browser's own input path,
// so they exercise pointer capture, hit testing and click dispatch exactly as a
// player's mouse would - a synthetic element.click() bypasses all of that.
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";

const [chromeExe, url, outDir, scriptFile] = process.argv.slice(2);
const steps = (await import(pathToFileURL(scriptFile).href)).default;
const PORT = 9333 + (process.pid % 200);
const userDir = path.join(process.env.TEMP || "/tmp", `rahee-chrome-${PORT}`);

const chrome = spawn(chromeExe, [
  "--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDir}`,
  "--window-size=1560,1000", "--hide-scrollbars", "--no-first-run", "--no-default-browser-check",
  "--disable-gpu", "--force-device-scale-factor=1", "about:blank",
], { stdio: "ignore" });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function endpoint() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (r.ok) return (await r.json()).webSocketDebuggerUrl;
    } catch { /* not up yet */ }
    await sleep(250);
  }
  throw new Error("Chrome did not expose a debugging endpoint");
}

const ws = new WebSocket(await endpoint());
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let nextId = 1;
const waiting = new Map();
const events = [];
ws.onmessage = (m) => {
  const msg = JSON.parse(m.data);
  if (msg.id && waiting.has(msg.id)) {
    const { res, rej } = waiting.get(msg.id);
    waiting.delete(msg.id);
    msg.error ? rej(new Error(msg.error.message)) : res(msg.result);
  } else if (msg.method) events.push(msg);
};
const send = (method, params = {}, sessionId) => new Promise((res, rej) => {
  const id = nextId++;
  waiting.set(id, { res, rej });
  ws.send(JSON.stringify({ id, method, params, sessionId }));
});

const { targetId } = await send("Target.createTarget", { url: "about:blank" });
const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
const call = (m, p) => send(m, p, sessionId);

await call("Page.enable");
await call("Runtime.enable");
await call("Log.enable");
const consoleErrors = [];
ws.addEventListener("message", (m) => {
  const msg = JSON.parse(m.data);
  if (msg.method === "Log.entryAdded" && msg.params.entry.level === "error") consoleErrors.push(msg.params.entry.text);
  if (msg.method === "Runtime.exceptionThrown") consoleErrors.push(msg.params.exceptionDetails.text + " " + (msg.params.exceptionDetails.exception?.description || ""));
});

// Start from a clean slate: a saved game in localStorage would be resumed.
await call("Page.navigate", { url });
await sleep(700);
await call("Runtime.evaluate", { expression: "try { localStorage.clear(); } catch {}" });
await call("Page.reload", { ignoreCache: true });
await sleep(1400);

fs.mkdirSync(outDir, { recursive: true });
for (const step of steps) {
  if (typeof step === "number") { await sleep(step); continue; }
  if (typeof step === "string") {
    const r = await call("Runtime.evaluate", { expression: step, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) console.log("  eval error:", r.exceptionDetails.text, r.result?.description || "");
    else if (r.result?.value !== undefined && r.result.value !== null) console.log("  →", JSON.stringify(r.result.value).slice(0, 400));
    await sleep(160);
    continue;
  }
  if (step.tap) {
    const r = await call("Runtime.evaluate", { expression: step.tap, returnByValue: true });
    const at = r.result?.value;
    if (!at || typeof at.x !== "number") { console.log("  tap: no target", JSON.stringify(at)); continue; }
    for (const type of ["mousePressed", "mouseReleased"]) {
      await call("Input.dispatchMouseEvent", {
        type, x: Math.round(at.x), y: Math.round(at.y), button: "left", clickCount: 1, buttons: type === "mousePressed" ? 1 : 0,
      });
      await sleep(30);
    }
    console.log("  tap:", at.label ?? `${Math.round(at.x)},${Math.round(at.y)}`);
    await sleep(180);
    continue;
  }
  if (step.drag) {
    const r = await call("Runtime.evaluate", { expression: step.drag, returnByValue: true });
    const d = r.result?.value;
    if (!d) { console.log("  drag: no target"); continue; }
    await call("Input.dispatchMouseEvent", { type: "mousePressed", x: d.x, y: d.y, button: "left", clickCount: 1, buttons: 1 });
    for (let k = 1; k <= 6; k++) {
      await call("Input.dispatchMouseEvent", {
        type: "mouseMoved", x: Math.round(d.x + (d.dx * k) / 6), y: Math.round(d.y + (d.dy * k) / 6),
        button: "left", buttons: 1,
      });
      await sleep(20);
    }
    await call("Input.dispatchMouseEvent", { type: "mouseReleased", x: Math.round(d.x + d.dx), y: Math.round(d.y + d.dy), button: "left", clickCount: 1, buttons: 0 });
    console.log("  drag:", `${d.dx},${d.dy}`);
    await sleep(200);
    continue;
  }
  if (step.shot) {
    const { data } = await call("Page.captureScreenshot", { format: "png" });
    fs.writeFileSync(path.join(outDir, `${step.shot}.png`), Buffer.from(data, "base64"));
    console.log("  shot:", step.shot);
  }
}

if (consoleErrors.length) {
  console.log("PAGE ERRORS:");
  for (const e of [...new Set(consoleErrors)].slice(0, 12)) console.log("  " + e);
} else console.log("no page errors");

ws.close();
chrome.kill();
setTimeout(() => process.exit(consoleErrors.length ? 1 : 0), 300);
