# Computer players and play-testing

> "An AI or two would be nice so that we could run some play test cases. Are you running any sort of test suites on the game?" — Prof. Jyothi Krishnan

## What was asked

1. **Computer players** — so a game can be play-tested without gathering 2–6 people: fill empty seats with bots, or let the computer take over a seat.
2. **Play-test cases** — let the computer play many complete games so the team can see how the game behaves (does it end properly, is any character too strong, how often do players overspend, are road trips used…).
3. **Test suites** — an answer to "are you testing the game?", i.e. automated checks that run every time and show the rules still hold.

## What was built

### 1. Computer players (`frontend/src/ai.js`)

`chooseAction(state, seat)` looks at the game **exactly as that seat sees it** (its own hand + the public table — the same redacted state the server sends a browser) and returns the next move in the same `{name, args}` form a browser sends. So a bot can't cheat, and every bot move goes through the same server checks as a person's.

Three personalities:

| Level | How it plays | Use it for |
|---|---|---|
| **planner** (`greedy`) | Scores every card × every reachable city: stamps, destinations, memory sets, efficient travel, road-trip chances, money only where it would push it over budget, and distance to its remaining destinations. Joins road trips when worth it. | A realistic opponent |
| **goal-chaser** (`goals`) | The same planner, but finishing its character's destinations comes first | Testing destinations and the end trigger |
| **easy** | Random but always legal moves | Shaking out rule edge cases |

Where they appear:
- **Lobby** — the host can add computer players ("+ Computer (planner / goal-chaser / easy)") and remove them. The server plays their turns a beat apart (`backend/bots.js`). One person + bots is a full game.
- **"Auto" button** on the board — the computer plays *your* seat (for play-testing alone, or stepping away). Click again to take over.

### 2. Play-test runner (`tools/playtest.mjs`)

```bash
node tools/playtest.mjs 1000                      # 1000 games, 2–6 players, all three levels
node tools/playtest.mjs 500 --players=4 --levels=greedy --seed=7
```

Plays complete games between bots (about 25 ms a game), checks the rules after **every move**, and writes `docs/test-results/playtest/report.md` (+ `report.json` with every game). The report covers: game length, flights/ships, road trips offered/taken/declined, Ace swaps and reshuffles, how games end, score/stamps/destinations/memories/money per player, win rate per character against a fair share, per bot level, and per table size.

Latest run (1000 games): **no rule violations, stalls or refused moves.** Points worth discussing with the POC:
- Planner bots (memory sets) score ~166 vs ~127 for goal-chasers, even though goal-chasers complete twice as many destinations (3.6 vs 1.8). With sets worth 15/20 and a destination worth 5, meeting up and road-tripping pays more than following your character card.
- Only ~13% of games end by someone completing 5 destinations; the rest end when a hand runs out.
- Character win rates are within a few points of a fair share — no character looks clearly over- or under-powered.

### 3. Test suites (`npm test`)

| Suite | What it checks |
|---|---|
| `tools/test-engine.mjs` | Board sanity, deals for 2–6 players (200 shuffles each), route-search regressions B1–B4, the manual's worked examples, and 80 random games checked rule by rule |
| `tools/test-rules.mjs` | 20 hand-built scenarios, one per rule clarified in RULES.md (destination needs a paid visit, companion's card only, no memory for bystanders, shared price, Aces swap/reshuffle, budget…) |
| `tools/playtest.mjs` | 300 bot games, every move checked |
| `tools/test-server.mjs` | The real backend end to end over WebSockets (in-memory database): 2 clients + bots play a whole game for 3 and 6 players; hands stay private, deck/seed never sent, out-of-turn moves refused, only the host can add bots, a dropped player resumes with the same hand, a wrong token is refused, scores add up |

```bash
cd backend && npm install && cd ..
npm test
```

`.github/workflows/test.yml` runs the same on every push to GitHub and keeps the play-test report as a download.

## How it was implemented (steps)

1. Make the rules engine the only judge (already true) and pull the server's "who may act" check into `backend/actions.js`, so humans, bots and tests share one path.
2. Write the bot as a pure function over a seat's view: setup (Ace swap, which card to lay), choosing a card and destination, stepping, visiting, offering/answering road trips, driving, confirming.
3. Server: bot seats in the room (saved to the database like any seat), host-only add/remove in the lobby, and a scheduler that lets bots move after every state change (and after a restart).
4. Play-test runner: bots vs bots in-process, invariants after each move, statistics and a report.
5. End-to-end server test with an in-memory database (`DB_DRIVER=memory`), so no MySQL is needed to test or to play locally.
6. One `npm test` + GitHub Actions.
