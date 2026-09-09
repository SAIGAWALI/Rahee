# RAHEE — a digital version of the board game

A web version of **RAHEE**, the travel board game by Jyothi Krishnan & the CCL team at IIT Gandhinagar (art by Parvathy Subramanian). Local hotseat for 2–6 players, no build step, no dependencies.

**[PROJECT-UNDERSTANDING.md](PROJECT-UNDERSTANDING.md)** is the course deliverable: our understanding of the project, the input/output, and the methodology.

The rules I implemented are written up in **[RULES.md](RULES.md)**, taken from the official 8-page manual ([manual.pdf](manual.pdf)) and the printed board. The assumptions I had to make are listed at the end of that file and are still awaiting your confirmation.

## Running it

The app is plain ES modules, so it needs to be served over HTTP (opening `index.html` from the filesystem will not work — the browser blocks `fetch` on `file://`):

```bash
cd "CS 202/Rahee"
python3 -m http.server 8712
# then open http://localhost:8712/
```

## What is here

```
index.html            the app
src/
  engine.js           rules and mechanisms only — no board knowledge
  board-view.js       the map: pan/zoom, legal steps, tokens, goal rings
  sidebar.js          the travel journal — memories, places visited, destinations
  screens.js          setup, private handover, scoreboard
  main.js             screen routing and the turn action panel
  styles.css
data/board.json       the whole board as data (see below)
assets/board-plate.png  the map plate, rendered from the printed artwork
tools/                the pipeline that produced board.json, plus tests
RULES.md              my reading of the ruleset, with open questions
manual.pdf            the official rulebook
```

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

Everything in `data/` and `assets/board-plate.png` is derived from `RaheeA-Fincurve.pdf`. The pipeline is reproducible:

```bash
node tools/make-plate.mjs   <dirWithMupdf> RaheeA-Fincurve.pdf assets   # crop the map out of the print PDF
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

## Testing

`tools/test-engine.mjs` plays 80 complete random games and checks the deck composition for every player count, that no move exceeds its card, that spending only ever increases, that no tourist place is visited twice by one player, that the end trigger fires and every player ends with the same number of turns, and that each final score adds up. It also checks the two worked examples in the manual: 3 Bazaar + one of each suit scores 35, and ₹1,100 over budget costs 15 points.

`tools/shot.mjs` drives headless Chrome over the DevTools protocol to click through the interface and screenshot it; `tools/walkthrough.mjs` plays a whole game that way. Moves on the map are sent as **real mouse press/release events** rather than synthetic `element.click()` calls, because only real input exercises pointer capture and hit testing — a synthetic click once hid a bug where panning the map swallowed the click on a city. The walkthrough also drags the map and asserts that it pans without selecting anything. Screenshots land in `shots/`.

## Status against the requirements sheet

**Done (v1 must-haves).** Data-driven engine; cities, routes and tokens rendered over the supplied plate from that data; editing the data changes the game with no engine change; full rule enforcement for 2–6 players; local hotseat with a private handover screen; movement with step costs and flight/ship surcharges; cards, hidden hands and per-player-count deck composition; memories across the four suits; tourist visits with one-time per-player marking; road trips with invitation, route choice, cost sharing, the shared-tourism discount and intermediate drop-off; Aces in all three uses; character starting cities and destination goals; end-game trigger, final round, budget penalty and a transparent final score breakdown; save and resume; tests.

**Not done (stretch).** Visual map editor, greedy AI opponent, route hints, undo of a whole action (only the last movement step can be undone), movement animation, playtest statistics.

## Two things to check before this is final

1. **The rule assumptions in [RULES.md](RULES.md)** — in particular whether reaching a destination goal requires paying the ₹2,000 tourist visit. I assumed it does not.
2. **Step counts.** The manual implies one printed road segment = one step, so every route in the data has `steps: 1`. The requirements sheet says routes carry an explicit step count, which suggests some may be worth more. If CCL supplies the real connection data, drop it into `data/board.json` and nothing else needs to change.

Board artwork © CCL, IITGN, representative and for educational purposes.
