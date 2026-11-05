# RAHEE — Project Understanding, Input/Output and Methodology

**CS 202 · Software Development Project**
Project: *RAHEE — a digital version of a travel board game*
Client: Centre for Creative Learning, IIT Gandhinagar
Author: SAIGAWALI (23110114)

---

## 1. What the project is

RAHEE is an existing board game by CCL, IIT Gandhinagar. Two to six players travel across a map of India. Your hand of playing cards is your itinerary: you play a card, move up to its value along connected routes, and pay ₹200 for every step out of a ₹25,000 budget. You score by visiting tourist places, reaching the destination goals printed on your character card, and collecting sets of themed memories.

We have to build a **web version of it for one device (local hotseat)**.

The main requirement is not the game but how it is built. The engine must contain **only the rules**. The whole board — cities, their positions, routes, route types, step counts, surcharges, tourist places, characters and their destination goals — must live in an **editable data file** that the program reads when it starts and draws over the supplied map image. Adding a city, changing a route or editing a character's goals must change the game **without changing any code**.

The rules themselves, taken from the official manual, are:

- **Cards.** 7s, 8s and 9s are removed. A=1, 2–6 face value, 10=10, J=10, Q=K=5. Each player is dealt a fixed hand at the start and nothing is ever drawn again, so the whole game is about 7 turns each.
- **Movement.** Play a card, move at least 1 and at most its value. ₹200 per step, +₹4,000 for a flight, +₹1,000 for the Kochi–Kavaratti ship.
- **Memories.** Of the played card's suit — ♠ Bazaar, ♥ Food, ♣ Language, ♦ Festival. Earned for moving exactly the card's full value, for ending where another player is, and for a road trip.
- **Tourism.** 51 cities are numbered tourist places. End a move on one and you may pay ₹2,000 to mark it. Once per player.
- **Road trips.** End a move where other players are and invite them. Flip a participant's face-up card, everyone moves together on it, companions pay you ₹100 per step, tourism costs ₹1,000 each instead of ₹2,000, and everyone gains a memory.
- **Aces.** Play alone (1 step), as a +1 booster, or for one extra memory.
- **End and scoring.** Ends when someone empties their hand or reaches 5 goals; the round is finished first. 10 per tourist place, 5 per destination, 10 bonus for 5 destinations, 15 per same-suit triple, 20 per set of all four suits, −5 for every ₹500 over budget.

**Scope.** Must have: the data-driven engine, the board drawn from data, full rules for 2–4 players, hotseat with a private handover screen, save/resume, and a clear final score. Stretch: 5–6 players, a visual map editor, a greedy AI, route hints, undo. Out of scope: online play, real-world maps or geocoding, reading cities off a scanned map, and any new AI or pathfinding algorithm.

---

## 2. Input and output

### Input 1 — the board data file (`data/board.json`)

One JSON file holding the whole board. A city:

```json
{ "id": "new-delhi", "name": "New Delhi", "x": 663, "y": 687,
  "tourist": 1, "attraction": "Qutb Minar", "airport": true }
```

`x` and `y` are pixel positions on the map image. `tourist` is the printed stamp number (1–51), or absent for an ordinary city.

A route:

```json
{ "from": "new-delhi", "to": "lucknow", "type": "flight", "steps": 1, "surcharge": 4000 }
```

A character, so that editing a character's goals is a data change:

```json
{ "id": "pilgrim", "start": "varanasi",
  "goals": [ { "city": "amritsar", "blurb": "Harmandir Sahib" } ] }
```

The same file also holds all the prices, the deck recipe for each player count, and the scoring values. It currently contains:

| | |
|---|---|
| Cities | 101 (51 tourist places, 50 ordinary) |
| Routes | 209 (158 road, 48 flight, 3 ship) |
| Characters | 6, with 36 destination goals |

### Input 2 — the map image

The background plate supplied by CCL, drawn under the cities and routes.

### Input 3 — what the player does

At setup: how many players, their names, who goes first, and a character each.

During a turn: play a card (optionally with an Ace), take a step to a chosen city, undo a step, finish moving, pay to visit a tourist place, invite a road trip, and end the turn. Between turns, confirm the handover so the next player's hand stays hidden.

### Output

- **The board** — the map with cities, routes and tokens drawn from the data, the legal next steps highlighted, and the current player's destination goals ringed.
- **The sidebar** — budget spent and left, the hidden hand, memories collected per suit, places visited, and the character's destinations highlighted inside that list.
- **The handover screen** between turns.
- **The scoreboard** — every player's score broken into its lines (tourist places, destinations, bonus, memory sets, budget penalty) so the total can be checked.
- **A saved game** in the browser, restored on reload.
- **An error message** if the data file is invalid (unknown city in a route, duplicate tourist number, unreachable city).

### Example

Green is at Jaipur and plays the 5♣.

| Input | Output |
|---|---|
| play `5♣`, move 5 steps to Gwalior, visit, end turn | −₹1,000 travel; +1 ♣ Language memory (moved exactly the card's value); −₹2,000 stay; Gwalior stamp marked; 5♣ laid face-up for future road trips. Turn cost ₹3,000. |

This is the worked example from the manual, so it is also a test case.

---

## 3. Methodology

### Architecture

Four parts, arranged so that board knowledge cannot get into the rules:

```
data/board.json  ──►  engine.js   (rules only, no map knowledge, no DOM)
                          │
                          ▼
                   board-view.js, sidebar.js, screens.js   (drawing only)
                          │
                          ▼
                       main.js    (screens and buttons)
```

`engine.js` takes the board data and the game state and returns the new state. It contains no city, no price and no score of its own — everything comes from the data file. This makes it easy to test on its own and is what makes the "change the data, not the code" requirement true.

| File | Does |
|---|---|
| `src/engine.js` | dealing, legal moves, costs, memories, tourism, road trips, Aces, end trigger, scoring |
| `src/board-view.js` | the map: pan/zoom, routes, tokens, highlighting |
| `src/sidebar.js` | memories, places visited, destinations |
| `src/screens.js` | setup, handover, scoreboard |
| `src/main.js` | screen routing and the turn buttons |

### Getting the board data

CCL will supply the connection data (which cities join, route types, step counts, surcharges). It has not arrived yet, so we produced a first version from the printed board with a small set of scripts: crop the map out of the print PDF, find the 101 city markers on it, walk the printed brown roads outward from each city to find which cities they join, then assemble and check the data file. Every city was verified by eye afterwards.

When the real connection data arrives, those scripts are thrown away and the file is replaced. Nothing else changes — which is itself a check that the design is properly data-driven.

### Algorithms

Standard ones only, as the requirements sheet asks.

- The board is an undirected graph, built once when the data loads.
- Legal next steps are the neighbours whose step cost fits the movement left.
- Breadth-first search for "everywhere reachable in N steps".
- Dijkstra for route hints (stretch).
- Scoring memory sets: make as many four-suit sets as possible, then same-suit triples from what is left.

### A turn

```
Setup → Handover → choose card → move (step / undo) → finish move
      → resolve (visit, road trip) → end turn → Handover → ...
      → last round → Scoreboard
```

The game does not stop the instant the end is triggered; the round is completed so everyone has had the same number of turns.

### Technology

Plain HTML, CSS and JavaScript modules, with SVG for the board. No framework and no build step, so the game runs from any static web host and does not break as libraries age. The only dependency in the project is a PDF reader used once to make the map image.

### Testing

1. Play many random complete games and check the rules held: deck is right for the player count, no move is longer than its card, spending never decreases, no tourist place is visited twice by one player, the game ends properly, and every score adds up.
2. Use the manual's own examples as fixtures (the Gwalior turn; the Bhopal road trip; "3 Bazaar plus one of each other suit = 35"; "₹1,100 over budget = −15").
3. Drive the interface in a headless browser through a whole game and screenshot it, using real mouse events rather than fake clicks.

### Plan

| Step | Work |
|---|---|
| 1 | Understand the rules; agree the data file format |
| 2 | Build the board data and validate it |
| 3 | Draw the board from the data |
| 4 | One complete turn: cards, movement, costs, memories, tourism |
| 5 | The rest of the rules: road trips, Aces, destinations, end, scoring |
| 6 | Setup, handover, scoreboard, save/resume |
| 7 | Tests and documentation |
| 8 | Stretch goals |

### Main risks

- **Connection data not yet supplied** — we built a stand-in in the same format, so swapping it in is a data change.
- **Gaps in the manual** — every assumption we made is listed below for the client to confirm, and each is kept in one place in the code.
- **Road trips are the trickiest rule** — built last, with the manual's own example as a test.

---

## 4. Assumptions to confirm

The manual is silent on these, so we chose an answer and wrote it down. The first two affect the design most.

1. Reaching a destination goal does **not** need the ₹2,000 tourist visit — the 5 points are for ending your move there; the ₹2,000 buys the separate 10-point stamp.
2. One printed road segment = one step, so every route has `steps: 1`.
3. The Pilgrim's goal printed as "34 Agartala" is read as Agartala (33), since the stamp list has 33 = Agartala and 34 = Kolkata.
4. On "meeting a traveller", only the moving player gains the memory.
5. Any participant's face-up card may be flipped for a road trip, including the active player's own.
6. A player with no face-up card left can still join someone else's road trip.
7. You may not pass — you must play a card while you still have one.
8. The Ace setup rule "request a reshuffle" is not implemented, since in a 4-player game the whole deck is dealt.

## References

1. CS 202 Project — Requirements Sheet: *RAHEE, a digital version of a travel board game*, CCL, IIT Gandhinagar.
2. *Rahee — A Traveller's Journey Across India*, official manual. Design: Jyothi Krishnan & CCL, IITGN. Art: Parvathy Subramanian.
3. The printed board, `Rahee-A-fincurve.pdf`. Artwork © CCL, IITGN.
