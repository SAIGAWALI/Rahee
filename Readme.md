# RAHEE — a digital version of the board game

A web version of **RAHEE**, the travel board game by Jyothi Krishnan & the CCL team at IIT Gandhinagar (art by Parvathy Subramanian). 2–6 players, each on their own device — a small Node backend is the sole authority on the rules, persists every room to a MySQL-compatible database (MySQL, MariaDB, or TiDB) so a crash or restart never loses a game in progress, and every player's hand stays private to them. No build step for the game itself; the frontend is plain ES modules with zero dependencies of its own, and the backend has three (`ws`, `mysql2`, `dotenv`).

The project is a plain three-tier split, each piece independently deployable: **`frontend/`** (static files — e.g. Netlify) talks over WebSocket to **`backend/`** (the Node API/rules server — e.g. Render), which is the only thing that talks to the **database** (e.g. TiDB Cloud). See [Deploying it](#deploying-it) below.

> **New this week:** Prof. Parvathy's artwork is in the game (stamps on hover, clickable map panel, new character and memory cards, pawns, font, one-page rules), the engine now follows every rule in RULES.md, and there are **computer players**, an **AI play-test runner** and a full **`npm test`** suite. See [docs/WEEK5-CHANGES.md](docs/WEEK5-CHANGES.md) and [docs/AI-PLAYTESTING.md](docs/AI-PLAYTESTING.md).

**[PROJECT-UNDERSTANDING.md](PROJECT-UNDERSTANDING.md)** is the course deliverable: our understanding of the project, the input/output, and the methodology.

The rules I implemented are written up in **[RULES.md](RULES.md)**, taken from the official 8-page manual ([manual.pdf](manual.pdf)) and the printed board. The assumptions I had to make are listed at the end of that file and are still awaiting your confirmation.

## Running it

A MySQL-compatible database first — any of these work unmodified, since `backend/db.js` only ever speaks the MySQL wire protocol:

- **Local MySQL or MariaDB** — point `backend/.env` at it (see below).
- **TiDB**, including a free **TiDB Cloud** cluster — the intended production target; TiDB *is* the MySQL protocol, so nothing in the code is TiDB-specific.

**No database handy?** `DB_DRIVER=memory node app.js` (or `npm run dev` from the project root) keeps rooms in memory — fine for local play and testing, but rooms are lost on restart, so never in production.

Copy `backend/.env.example` to `backend/.env` and fill in the connection details (`DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`, `DB_SSL`). The backend creates the one table it needs on its own the first time it starts (`backend/schema.sql` has the same statement, for setting it up by hand instead).

Then start the backend:

```bash
cd "CS 202/Rahee/backend"
npm install       # one-time
node app.js       # or: node app.js <port>, default 8712
```

It prints the addresses to open, restores any rooms left over from a previous run ("restored N room(s) from the database"), and — as a local-dev convenience — also serves the frontend as static files on the same port, alongside the game's WebSocket protocol. One player creates a room from the landing screen and shares the 4-character code; everyone else joins with it.

The frontend itself is plain ES modules with no build step and no dependencies of its own. For local development, `backend/app.js` serves `frontend/index.html`, `frontend/src/`, `frontend/data/` and `frontend/assets/` as static files — one process is enough to play from a single machine. In production the frontend is deployed separately (see [Deploying it](#deploying-it)) and doesn't need the backend to serve it at all.

### Playing across devices (local network, no deployment)

Everyone just needs to be on the same Wi-Fi as whoever runs `node app.js`, and open one of the `http://<lan-ip>:<port>/` addresses it prints.

If you develop inside **WSL2** (as this project does): WSL2's own IP sits behind an internal NAT that only forwards `localhost`, so a server bound inside WSL is **not** reachable from another device on the Wi-Fi. Run the server with **Windows' own `node.exe`** instead of WSL's (same project files, just invoked from a native PowerShell/cmd window) — it then binds directly to the Windows machine's real network adapter and other devices can reach it with no extra configuration. (The alternative is enabling WSL2 "mirrored" networking in `.wslconfig` and restarting WSL, which works too but needs that one-time config change.)

Two browser tabs on the same machine work just as well for trying it out without a second physical device — each tab is its own connection, its own seat, its own hidden hand.

## Deploying it

The three tiers deploy independently, each to its own host:

1. **Database (TiDB Cloud, or any MySQL-compatible host).** Create a cluster/database and note its host/port/user/password; set `DB_SSL=true` if the host requires TLS (TiDB Cloud does). No manual schema setup needed — the backend creates its one table on first boot (`backend/schema.sql` is there if you'd rather run it by hand first).
2. **Backend (Render, or any Node host).** Root directory: `backend/`. Build command: `npm install`. Start command: `npm start`. Set the `DB_*` environment variables from `backend/.env.example` in the host's dashboard (never commit a real `.env`) — Render sets `PORT` itself, which `app.js` already reads. Note the backend's public URL once deployed; the WebSocket URL is the same host with `wss://` in place of `https://`.
3. **Frontend (Netlify, or any static host).** Base/publish directory: `frontend/`. No build command needed — it's static files as-is. Before deploying, set `window.RAHEE_SERVER_URL` in `frontend/index.html` to the backend's `wss://` URL from step 2 (there's a commented example line already in the file).

A dropped player rejoins their seat automatically (or by typing the room code and the same name). Computer players can fill empty seats from the lobby.

## What is here

```
frontend/
  index.html            the app
  src/
    engine.js           rules and mechanisms only — no board knowledge — runs unmodified on the backend too
    ai.js               computer players: picks a seat's next move from what that seat can see
    map-panel.js        the clickable left panel: clean map overview + other players' destinations
    config.js           the backend's WebSocket URL — same-origin by default, overridable for separate deploys
    net.js              the one WebSocket connection to the backend
    board-view.js       the map: pan/zoom, legal steps, tokens, goal rings
    sidebar.js          the travel journal — memories, places visited, destinations
    screens.js          landing, lobby, laying a road-trip card, scoreboard
    main.js             screen routing and the turn action panel
    styles.css
  data/board.json       the whole board as data (see below) — fetched once by the client, never sent over the socket
  assets/board-plate.png  the map plate, rendered from the printed artwork
  assets/cards/<id>.webp each character's card (new artwork), shown in the lobby, setup and sidebar
  assets/stamps/<n>.webp the 51 stamps — shown on hover, in the stamp album and on the scoreboard
  assets/memories/       the four memory cards;  assets/maps/  the two clean maps for the left panel
  assets/fonts/          Old Newspaper Types, the display face from the cards
backend/
  app.js               WebSocket/API server; also serves frontend/ locally as a dev convenience
  db.js                the MySQL-compatible connection pool + one-table schema bootstrap
  schema.sql           the same table, for setting the database up by hand instead
  rooms.js             room creation/joining, seat assignment, DB persistence; imports engine.js as-is
  redact.js             strips what each player must not see before every broadcast
  handlers.js           the one dispatcher: inbound message → engine.js → persist → broadcast
  actions.js            every gameplay action + who may send it (shared by handlers, bots and tests)
  bots.js               computer-player seats: add/remove in the lobby, play their turns
  protocol.js           message type names and the gameplay action allowlist
tools/                the pipeline that produced frontend/data/board.json, plus tests and the play-test runner
docs/                 this week's changes, and the computer players / play-testing write-up
playtest-report/      the latest 1000-game AI play-test (report.md, report.json)
RULES.md              my reading of the ruleset, with open questions
manual.pdf            the official rulebook
```

## The multiplayer architecture

The backend is the sole authority on the rules: `backend/handlers.js` receives a message, calls straight into `frontend/src/engine.js` (imported completely unmodified — it has no browser dependency in its gameplay/query functions, and it's the same single copy of the file the frontend ships to the browser, so the rules never have a second, drifting implementation), persists the result, and broadcasts it. `backend/rooms.js` keeps one authoritative game `state` object per room in memory for fast synchronous access on the hot path, but every change is written through to the database before the new state reaches any client — and every room still in progress is reloaded from the database the moment the backend process starts, so a crash or a restart never loses a game. `backend/redact.js` is the one place secrecy is enforced: it runs once per outgoing message, per recipient, and strips the board (the client already has its own copy), the undealt deck, and every *other* player's hand (replaced with just a count) before anything leaves the backend. `frontend/src/main.js` never calls any engine function to change state directly — every action becomes a `{type:"action", name, args}` WebSocket message, and the screen only ever updates when the backend's own `state` broadcast comes back.

Computer players (`backend/bots.js`) are seats the server plays itself: each decides with `frontend/src/ai.js` from its own redacted view, and its move goes through `backend/actions.js` — the same path and checks as a human's message.

## The data-driven part

`frontend/data/board.json` holds everything about *this* board: 101 cities with their coordinates, 209 routes with type, step count and surcharge, the 51 tourist places, the six characters and their destination goals, every price, the deck composition per player count, and the scoring table. `frontend/src/engine.js` reads it at load time and contains no board-specific knowledge — adding a city, retyping a route or editing a destination goal changes the game with no code change.

Route polylines are stored too, so the digital board draws each route along the shape of the printed road rather than as a straight chord.

| | |
|---|---|
| Cities | 101 (51 tourist places, 50 plain) |
| Routes | 209 — 158 road, 48 flight, 3 ship |
| Airports | 11 (10 mainland + Agatti) |
| Characters | 6, with 36 destination goals |

### Regenerating the board data

Everything in `frontend/data/` and `frontend/assets/` is derived from `Rahee-gameboard.pdf`. The pipeline is reproducible:

```bash
node tools/make-plate.mjs   <dirWithMupdf> Rahee-gameboard.pdf frontend/assets   # crop the map out of the print PDF
node tools/make-cards.mjs   <dirWithMupdf> Rahee-A-fincurve.pdf frontend/assets/cards  # crop the 6 character cards
node tools/detect-cities.mjs frontend/assets --tiles                      # find city markers on the plate
node tools/trace-routes.mjs  frontend/assets tools/cities.tsv --debug     # walk the printed roads into a graph
node tools/build-board.mjs   .                                           # assemble and validate frontend/data/board.json
node tools/add-artwork.mjs   .                                           # add stamps, cards, memory cards, clean maps, pawns (online-version art)
python3 tools/align-maps.py "Raheemap-only nodes.png" frontend/data/board.json   # (only if the clean maps change) refit maps[].fromPlate
node tools/test-engine.mjs   . 80                                        # play random games against the rules
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

- The Andaman city printed **Diglipur** was misread as "Digligur" and is now corrected throughout (`tools/cities.tsv`, `frontend/data/board.json`).
- The Sri Vijayapuram–Great Nicobar ship is now legibly labelled **"Rs. 200"**; that route's `surcharge` was `0` (unlabelled) and is now `200`.

Regenerating the plate against the corrected print also surfaced two pre-existing bugs in `make-plate.mjs` itself, now fixed: the "Learn to play" QR block was erased 45px too wide, clipping the small fir tree beside it in Ladakh, and the erase fill colour ([250,247,233]) didn't quite match the plate's actual background ([250,243,212]), leaving a faint seam around both erased blocks.

## Testing

One command runs everything (after `npm install` in `backend/` once):

```bash
npm test
```

| Suite | What it checks |
|---|---|
| `tools/test-engine.mjs` | board sanity, deals for every player count (200 shuffles each), route-search regressions B1–B4, the manual's worked examples, 80 random complete games checked rule by rule |
| `tools/test-rules.mjs` | 20 hand-built scenarios, one per rule clarified in RULES.md |
| `tools/playtest.mjs` | 300 complete games between computer players, every move checked (`node tools/playtest.mjs 1000` for a full report in `playtest-report/`) |
| `tools/test-server.mjs` | the real backend over WebSockets with an in-memory database: two clients and computer players play whole 3- and 6-player games — privacy, turn order, host-only bots, reconnection, scores |

GitHub Actions (`.github/workflows/test.yml`) runs the same on every push. See [docs/AI-PLAYTESTING.md](docs/AI-PLAYTESTING.md).

`tools/shot.mjs` and `tools/walkthrough.mjs` are the older single-device screenshot scripts and still need updating for the lobby flow.

## Status against the requirements sheet

**Done.** Data-driven engine; the board drawn from data over the printed plate; full rules for 2–6 players on their own devices, server-authoritative and matching RULES.md; road trips with invitations, companion-chosen stops, cost sharing and shared tourism; Aces (including the two-Aces swap); destinations completed by visiting; end trigger and transparent score breakdown; reconnection; persistence; the online-version artwork (stamps on hover, clickable map panel, cards, pawns, font, one-page rules); computer players (stretch goal "greedy AI"); route hints via click-to-route; play-test statistics (stretch); automated tests.

**Not done.** Visual map editor; undo of a whole turn; movement animation; road-trip discussion between two players (dropped — no chat, as agreed with the POC).

## Confirmed with CCL

1. **Budget** is ₹20,000 (`economy.startingBudget` in board.json). RULES.md is final: it was written with the POC from the printed manual, so where the two differ, RULES.md wins.
2. **No city between Siliguri and Guwahati.** The dot on the new clean map there is part of the image only and is not in the game data.
3. **Spellings** stay as they are in the board data.
4. **The one-page rules PNG** has not arrived yet. When it does, set `"rulesImage"` in board.json.

Board artwork © CCL, IITGN, representative and for educational purposes.
