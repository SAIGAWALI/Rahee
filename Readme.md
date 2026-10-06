# RAHEE — a digital version of the board game

A web version of **RAHEE**, the travel board game by Jyothi Krishnan & the CCL team at IIT Gandhinagar (art by Parvathy Subramanian). 2–6 players, each on their own device over a local network — a small Node server is the sole authority on the rules, and every player's hand stays private to them. No build step for the game itself; the server has exactly one dependency (`ws`).

**[PROJECT-UNDERSTANDING.md](PROJECT-UNDERSTANDING.md)** is the course deliverable: our understanding of the project, the input/output, and the methodology.

The rules I implemented are written up in **[RULES.md](RULES.md)**, taken from the official 8-page manual ([manual.pdf](manual.pdf)) and the printed board. The assumptions I had to make are listed at the end of that file and are still awaiting your confirmation.

## Running it

Start the server (Node.js, one dependency — `ws` — installed once):

```bash
cd "CS 202/Rahee/server"
npm install       # one-time
node app.js       # or: node app.js <port>, default 8712
```

It prints the addresses to open — `http://localhost:<port>/` on the same machine, and one `http://<lan-ip>:<port>/` per network interface for other devices on the same Wi-Fi. One player creates a room from the landing screen and shares the 4-character code; everyone else joins with it. No deployment needed — see [Playing across devices](#playing-across-devices) below for how to actually reach the server from a phone or second laptop.

The client itself is still plain ES modules with no build step and no dependencies of its own — `server/app.js` just serves `index.html`, `src/`, `data/` and `assets/` as static files, exactly as a plain HTTP server would, and additionally speaks the game's WebSocket protocol on the same port.

### Playing across devices

No deployment is needed — everyone just needs to be on the same Wi-Fi as whoever runs `node app.js`, and open one of the `http://<lan-ip>:<port>/` addresses it prints.

If you develop inside **WSL2** (as this project does): WSL2's own IP sits behind an internal NAT that only forwards `localhost`, so a server bound inside WSL is **not** reachable from another device on the Wi-Fi. Run the server with **Windows' own `node.exe`** instead of WSL's (same project files, just invoked from a native PowerShell/cmd window) — it then binds directly to the Windows machine's real network adapter and other devices can reach it with no extra configuration. (The alternative is enabling WSL2 "mirrored" networking in `.wslconfig` and restarting WSL, which works too but needs that one-time config change.)

Two browser tabs on the same machine work just as well for trying it out without a second physical device — each tab is its own connection, its own seat, its own hidden hand.

## What is here

```
index.html            the app
src/
  engine.js           rules and mechanisms only — no board knowledge — runs unmodified on the server
  net.js               the one WebSocket connection to the server
  board-view.js       the map: pan/zoom, legal steps, tokens, goal rings
  sidebar.js          the travel journal — memories, places visited, destinations
  screens.js          landing, lobby, laying a road-trip card, scoreboard
  main.js             screen routing and the turn action panel
  styles.css
server/
  app.js               static file server + WebSocket server, one process, one port
  rooms.js             room creation/joining, seat assignment; imports engine.js as-is
  redact.js             strips what each player must not see before every broadcast
  handlers.js           the one dispatcher: inbound message → engine.js → broadcast
  protocol.js           message type names and the gameplay action allowlist
data/board.json       the whole board as data (see below) — fetched once by the client, never sent over the socket
assets/board-plate.png  the map plate, rendered from the printed artwork
assets/cards/<id>.png  each character's printed card, shown when choosing or playing them
tools/                the pipeline that produced board.json, plus tests
RULES.md              my reading of the ruleset, with open questions
manual.pdf            the official rulebook
```

## The multiplayer architecture

The server is the sole authority on the rules: `server/handlers.js` receives a message, calls straight into `src/engine.js` (imported completely unmodified — it has no browser dependency in its gameplay/query functions), and broadcasts the result. `server/rooms.js` holds one authoritative game `state` object per room, in memory only — a server restart loses in-progress games; there is no reconnection, chat, or persistence yet. `server/redact.js` is the one place secrecy is enforced: it runs once per outgoing message, per recipient, and strips the board (the client already has its own copy), the undealt deck, and every *other* player's hand (replaced with just a count) before anything leaves the server. `src/main.js` no longer calls any engine function directly — every action becomes a `{type:"action", name, args}` WebSocket message, and the screen only ever updates when the server's own `state` broadcast comes back.

This is a deliberately minimal slice of the fuller design in [DESIGN-PLAN.md](DESIGN-PLAN.md) — chat, reconnection tokens, and persistent (SQLite) storage are sketched there but not built here.

## The data-driven part

`data/board.json` holds everything about *this* board: 101 cities with their coordinates, 209 routes with type, step count and surcharge, the 51 tourist places, the six characters and their destination goals, every price, the deck composition per player count, and the scoring table. `src/engine.js` reads it at load time and contains no board-specific knowledge — adding a city, retyping a route or editing a destination goal changes the game with no code change.

Route polylines are stored too, so the digital board draws each route along the shape of the printed road rather than as a straight chord.

| | |
|---|---|
| Cities | 101 (51 tourist places, 50 plain) |
| Routes | 209 — 158 road, 48 flight, 3 ship |
| Airports | 11 (10 mainland + Agatti) |
| Characters | 6, with 36 destination goals |

### Regenerating the board data

Everything in `data/` and `assets/` is derived from `Rahee-A-fincurve.pdf`. The pipeline is reproducible:

```bash
node tools/make-plate.mjs   <dirWithMupdf> Rahee-A-fincurve.pdf assets   # crop the map out of the print PDF
node tools/make-cards.mjs   <dirWithMupdf> Rahee-A-fincurve.pdf assets/cards  # crop the 6 character cards
node tools/detect-cities.mjs assets --tiles                             # find city markers on the plate
node tools/trace-routes.mjs  assets tools/cities.tsv --debug            # walk the printed roads into a graph
node tools/build-board.mjs   .                                          # assemble and validate data/board.json
node tools/test-engine.mjs   . 80                                       # play random games against the rules
```

Only `make-plate.mjs` needs a dependency (`mupdf`, to rasterise the PDF); it is a one-time asset step and the resulting PNG is checked in. Everything else is zero-dependency Node.

City names and tourist-place numbers live in `tools/cities.tsv` — a plain table, edit it and rebuild.

## How the board data was verified

The city positions were found automatically (solid dark discs for plain cities, a radial ring detector for the numbered tourist circles) and every one of the 101 was then checked by eye against labelled overlay tiles. Three markers the detector missed — Shillong, Thanjavur and Pune, each obscured by a label or an illustration — were placed by hand.

The road network was traced by walking the printed brown ribbon outward from each city. To catch what that missed, `trace-routes.mjs` also runs two checks and reports both:

- **uncovered road** — printed road that no traced route accounts for. This found six real missing links, all hidden under vehicle or tree artwork: Kolkata–Behrampore, Aurangabad–Bhopal, Gulbarga–Ratnagiri, Lucknow–Gorakhpur, Sambalpur–Srikakulam and Srinagar–Jammu. They are added explicitly in `build-board.mjs` with their polylines read off the plate.
- **routes not following a road** — a traced route whose path does not lie on the printed ribbon, which would mean the walk cut across open land. The eleven that remain were checked individually; all are real roads whose stored polyline is a straighter chord than the printed curve, which affects only the faint overlay, not the game.

`build-board.mjs` then asserts: no unknown city in any route or goal, tourist numbers exactly 1–51, every city reachable, and every city reachable *without flying* except the Andamans, which the board joins to the mainland only by its drawn flight lines.

Verification images are in `assets/verify/` (`dbg-graph.png` is the derived graph drawn back over the map; `dbg-gaps.png` paints uncovered road in red).

### Picked up from the corrected print

`Rahee-A-fincurve.pdf` replaced an earlier scan of the same board. The map itself — city positions, routes, tourist numbers, character destinations — is unchanged; the only real differences are two things the earlier scan left illegible:

- The Andaman city printed **Diglipur** was misread as "Digligur" and is now corrected throughout (`tools/cities.tsv`, `data/board.json`).
- The Sri Vijayapuram–Great Nicobar ship is now legibly labelled **"Rs. 200"**; that route's `surcharge` was `0` (unlabelled) and is now `200`.

Regenerating the plate against the corrected print also surfaced two pre-existing bugs in `make-plate.mjs` itself, now fixed: the "Learn to play" QR block was erased 45px too wide, clipping the small fir tree beside it in Ladakh, and the erase fill colour ([250,247,233]) didn't quite match the plate's actual background ([250,243,212]), leaving a faint seam around both erased blocks.

## Testing

`tools/test-engine.mjs` plays 80 complete random games and checks the deck composition for every player count, that no move exceeds its card, that spending only ever increases, that no tourist place is visited twice by one player, that the end trigger fires and every player ends with the same number of turns, and that each final score adds up. It also checks the two worked examples in the manual: 3 Bazaar + one of each suit scores 35, and ₹1,100 over budget costs 15 points.

`tools/shot.mjs` drives headless Chrome over the DevTools protocol to click through the interface and screenshot it; moves on the map are sent as **real mouse press/release events** rather than synthetic `element.click()` calls, because only real input exercises pointer capture and hit testing. It was written for the single-device build's setup screen and needs updating for the lobby flow before it drives a full game again — `tools/walkthrough.mjs` is in the same position. Screenshots land in `shots/`.

Multiplayer correctness (room join, redaction, turn gating) was verified with a small two-client WebSocket script exercising the server protocol directly, rather than a checked-in tool.

## Status against the requirements sheet

**Done (v1 must-haves).** Data-driven engine; cities, routes and tokens rendered over the supplied plate from that data; editing the data changes the game with no engine change; full rule enforcement for 2–6 players, each on their own device, server-authoritative; movement with step costs and flight/ship surcharges; cards, hidden hands and per-player-count deck composition; memories across the four suits; tourist visits with one-time per-player marking; road trips with invitation, route choice, cost sharing, the shared-tourism discount and intermediate drop-off; Aces in all three uses; character starting cities and destination goals, shown with each character's own printed card; end-game trigger, final round, budget penalty and a transparent final score breakdown; tests.

**Not done (stretch).** Visual map editor, greedy AI opponent, route hints, undo of a whole action (only the last movement step can be undone), movement animation, playtest statistics, chat, reconnection, persistent storage (see [The multiplayer architecture](#the-multiplayer-architecture)), save/resume (dropped along with the single-device build — the server's in-memory room *is* the save now, until persistence is added).

## Two things to check before this is final

1. **The rule assumptions in [RULES.md](RULES.md)** — in particular whether reaching a destination goal requires paying the ₹2,000 tourist visit. I assumed it does not.
2. **Step counts.** The manual implies one printed road segment = one step, so every route in the data has `steps: 1`. The requirements sheet says routes carry an explicit step count, which suggests some may be worth more. If CCL supplies the real connection data, drop it into `data/board.json` and nothing else needs to change.

Board artwork © CCL, IITGN, representative and for educational purposes.
