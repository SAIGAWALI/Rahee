// Browser end-to-end test (Test Phase 2). Starts the backend with the
// in-memory database, opens the game in headless Chromium (Playwright), and
// plays a whole 3-player game through the real interface: create a room, add
// two computer players, pick a character, deal, lay the road-trip card, let
// "Auto" play our seat, reload the page mid-game, and reach Journey's End.
// Fails on any check or any browser error.
//
//   node tools/test-browser.cjs        (needs Playwright + Chromium installed)
//   SHOTS=some/folder node tools/test-browser.cjs   (also saves screenshots)
const { spawn } = require("node:child_process");
const path = require("node:path");
const { chromium } = require("playwright");

const root = path.join(__dirname, "..");
const PORT = 8790 + (process.pid % 100);
const URL = `http://localhost:${PORT}/`;
const shots = process.env.SHOTS || "";
const results = [];
const ok = (name, cond, extra = "") => {
  results.push({ name, pass: !!cond });
  console.log(`  ${cond ? "ok  " : "FAIL"} ${name}${extra ? " — " + extra : ""}`);
};
const btns = (p) => p.evaluate(() => [...document.querySelectorAll("button")]
  .filter((e) => e.offsetParent && !e.disabled).map((e) => e.textContent.trim().replace(/\s+/g, " ")));
const text = (p) => p.evaluate(() => document.body.innerText);
const shot = async (p, name) => { if (shots) await p.screenshot({ path: path.join(shots, name) }); };

(async () => {
  const server = spawn(process.execPath, ["backend/app.js", String(PORT)], { cwd: root, env: { ...process.env, DB_DRIVER: "memory", BOT_DELAY_MS: "200" }, stdio: "ignore" });
  await new Promise((r) => setTimeout(r, 1500));
  const browser = await chromium.launch();
  const p = await browser.newPage({ viewport: { width: 1366, height: 850 } });
  const errs = [];
  p.on("pageerror", (e) => errs.push(e.message));
  p.on("console", (m) => m.type() === "error" && errs.push(m.text()));
  const t0 = Date.now();
  try {
    await p.goto(URL);
    ok("landing page loads with name field and Create button", await p.locator("text=Create a room").count());
    await p.click("text=How to play"); await p.waitForTimeout(400);
    ok('"How to play" opens the one-page rules sheet', await p.locator("text=How to play RAHEE").count());
    await p.keyboard.press("Escape"); await p.waitForTimeout(300);
    ok("the rules sheet closes with Escape", !(await p.locator("text=How to play RAHEE").count()));
    await p.fill('input[placeholder="Your name"]', "Kshitij");
    await p.click("text=Create a room");
    await p.waitForTimeout(800);
    const code = (await text(p)).match(/Room code (\w{4})/)?.[1];
    ok("room created and a 4-letter room code shown", code, code);
    await p.click("text=+ Computer (planner)"); await p.waitForTimeout(400);
    await p.click("text=+ Computer (goal-chaser)"); await p.waitForTimeout(800);
    ok("host can add two computer players", (await p.locator("text=(AI)").count()) >= 2);
    const picked = await p.evaluate(() => {
      const c = [...document.querySelectorAll("button")].filter((e) => e.offsetParent && !e.disabled && !e.textContent.trim());
      if (!c.length) return false; c[0].click(); return true;
    });
    await p.waitForTimeout(800);
    ok("character card can be picked; host can deal", picked && (await btns(p)).some((t) => /Deal the cards/.test(t)));
    await shot(p, "ui-1-lobby.png");
    await p.click("text=Deal the cards"); await p.waitForTimeout(1500);
    ok("cards dealt: setup screen asks to lay a road-trip card", await p.locator("text=lay a road-trip card").count());
    await p.evaluate(() => {
      const c = [...document.querySelectorAll("button")].filter((e) => e.offsetParent && !e.disabled && /^(\d+|[AJQK])/.test(e.textContent.trim()));
      c[c.length - 1]?.click();
    });
    await p.waitForTimeout(2000);

    let auto = false, reloaded = false, ended = false, lastRound = "", labelChecked = false, panelChecked = false;
    for (let t = 0; t < 900 && !ended; t++) {
      if (!auto && (await btns(p)).some((x) => /^Auto/.test(x))) {
        await p.locator("button", { hasText: /^Auto/ }).first().click(); auto = true;
      }
      const txt = await text(p);
      if (/Journey.s End/i.test(txt)) { ended = true; break; }
      const round = txt.match(/Round\s*(\d+)/)?.[1];
      if (round && round !== lastRound) { console.log(`       [${((Date.now() - t0) / 1000).toFixed(0)}s] round ${round}`); lastRound = round; }
      if (!labelChecked && /Your turn/.test(txt)) {
        ok('top bar says "Your budget left" on your own turn', /Your budget left/.test(txt) && !/Their budget left/.test(txt));
        labelChecked = true;
      }
      if (!panelChecked && round === "2") {
        await p.locator(".lp-tab").first().click(); await p.waitForTimeout(500);
        const t = await text(p);
        ok('"Map & destinations" panel opens and lists the other players', /Where everyone is heading/i.test(t) && /\(AI\)/.test(t));
        await shot(p, "ui-map-panel.png");
        await p.locator(".lp-tab, .lp-close, [title*='lose']").first().click().catch(() => {});
        panelChecked = true;
      }
      if (auto && !reloaded && Number(round) >= 3) {
        await shot(p, "ui-2-midgame.png");
        await p.reload(); await p.waitForTimeout(2500); reloaded = true;
        const back = await text(p);
        ok("page reload mid-game returns to the same seat", !/Create a room/.test(back) && /Kshitij/.test(back));
        auto = false;
      }
      await p.waitForTimeout(500);
    }
    ok('"Auto" let the computer play our seat', reloaded || auto);
    ok("game played to the Journey's End scoreboard", ended, `${((Date.now() - t0) / 1000).toFixed(0)}s`);
    if (ended) {
      await shot(p, "ui-3-scoreboard.png");
      ok("scoreboard lists all three travellers", (await p.locator("text=(AI)").count()) >= 2 && /Kshitij/.test(await text(p)));
    }
    ok("no browser errors during the whole game", errs.length === 0, errs.slice(0, 3).join(" | "));
  } catch (e) {
    ok("test ran without crashing", false, e.message);
  } finally {
    await browser.close(); server.kill();
  }
  const pass = results.filter((r) => r.pass).length;
  console.log(`\n${pass} passed, ${results.length - pass} failed`);
  process.exit(pass === results.length ? 0 : 1);
})();
