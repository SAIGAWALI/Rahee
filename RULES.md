# RAHEE — Rules Understanding

> My reading of the game before we build it. **Please check the "Open questions" section at the end — those are the places where I had to guess.**

## Sources I worked from

| Source | What it gave me |
|---|---|
| `Games Software Developement Projects.pdf` | The CS 202 requirements sheet (scope, architecture, deliverable). Not the rules. |
| `RaheeA-Fincurve.pdf` | The printed board plate: map, 6 character cards, 51 tourist stamps, cost banner, 4 memory suits. |
| QR code on the board → `canvaqr.com/RGHKkBUktF` → `gamesweplay-ccl.github.io/games/rahee.html` | Link to the official material. |
| **`manual.pdf` (8 pages, "Rahee – A Traveller's Journey Across India")** | **The complete official ruleset.** Downloaded from the Drive link on that page and saved next to this file. |

Design: Jyothi Krishnan & CCL, IIT Gandhinagar. Art: Parvathy Subramanian.

---

## 1. The game in one paragraph

2–6 players, ~40 minutes. Each player is a *rahee* (traveller) with a character, a starting city, and six destination goals. Your **starting hand of playing cards is your entire itinerary** — nothing is ever drawn or replaced after setup. You spend those cards to move across a map of India, paying ₹200 per step out of a ₹25,000 budget, and score by visiting tourist places, reaching your character's destinations, and collecting sets of themed memories. The game is short and tight: 6–7 cards each means 6–7 turns each.

## 2. Components

- **Board** — map of India. Cities are dots joined by route lines. 51 cities are numbered — those are the **tourist places** and each has a matching stamp in the right-hand column.
- **Deck** — one standard deck of playing cards, with 7s, 8s and 9s removed.
- **Tokens** — minimum 2 per player: one on the map, one on the character card. More for marking tourist stamps.
- **Pen and paper** — for tracking spending. (In our version: all automated.)

### Card movement values

| Card | A | 2–6 | 10 | J | Q | K |
|---|---|---|---|---|---|---|
| Steps | 1 | face value | 10 | 10 | 5 | 5 |

### The four memory suits

| Suit | Memory |
|---|---|
| ♠ Spades | **Bazaar** — shopping |
| ♥ Hearts | **Food** — eating something new |
| ♣ Clubs | **Language** — hearing a language |
| ♦ Diamonds | **Festival** — celebrating |

### Money constants (printed on the board)

| Item | Amount |
|---|---|
| Starting budget | ₹25,000 |
| Travel | ₹200 per step |
| Flight surcharge | ₹4,000 (on top of step cost) |
| Kochi–Kavaratti ship surcharge | ₹1,000 (on top of step cost) |
| Tourist visit ("Stay cost") | ₹2,000 |
| Shared tourist visit on a road trip | ₹1,000 each |
| Road-trip companion pays the driver | ₹100 per step travelled together |

Leftover money scores **nothing**. Overspending **is allowed** but penalised at scoring.

## 3. Setup

1. **Budget** — every player starts with ₹25,000.
2. **First player** — whoever travelled furthest recently. Turn order then runs **clockwise**.
3. **Character selection** — runs the *other* way: start with the player to the first player's **right** and go **anticlockwise**. Each player claims a character by putting a token on it.
4. **Place your traveller** — put a token on your character's printed starting city.
5. **Build the deck for the player count** (below), deal hands, and each player lays **one card from their dealt hand face-up** in front of them as their first **road-trip card**. The rest of the hand stays hidden.

### Deck and dealing

| Players | Cards used | Total | Dealt |
|---|---|---|---|
| 2–4 | A, 2–6, 10 of all four suits | 28 | **one 10** + 6 more each |
| 5 | add J (10), Q (5), K (5) of all four suits | 40 | **one J or 10** + 6 more each |
| 6 | same 40-card deck | 40 | **one J or 10** + 5 more each |

Every player is *guaranteed* one high-movement card. Then the rest is shuffled and dealt. Unused cards are set aside; **no card is ever drawn after setup**.

## 4. A turn

You play a card, then:

1. **Move** — move at least 1 step and up to the card's value along connected routes; pay travel costs.
2. **Note memories and tourism** — record memories earned, and optionally pay to visit the tourist place you ended on.
3. **Offer a road trip** — if you ended on a city containing other players, you may invite them.
4. **End your turn** — lay the card(s) you played face-up in front of you. These accumulate and become future road-trip cards.

### Movement details

- You may move **fewer** steps than the card's value (but never zero).
- One step = one route segment between two adjacent cities.
- A **flight** between two airports on the mainland, or a marked flight to an island, counts as **one step** — plus the ₹4,000 surcharge.
- The **Kochi–Kavaratti ship** likewise counts as steps plus the ₹1,000 surcharge.

## 5. Memories

You earn memories **of the played card's suit**. Three ways, and they stack in a single turn:

1. **Efficient travel** — you moved *exactly* the card's full value → 1 memory of that suit.
2. **Meeting a traveller** — you finished movement in a city where another player already was → 1 memory of that suit.
3. **Road trip** — every traveller on the trip gains 1 memory of the **road-trip card's** suit.

Memories are **free**.

*Worked example from the manual:* Green plays 2♦ and moves exactly two steps into Blue's city → two Festival memories (one for efficiency, one for meeting Blue).

## 6. Tourist places

The **numbered** cities are tourist places. When you finish movement on one you **may** pay **₹2,000** to visit it and mark its stamp with your token. **Each tourist place scores only once per player** — but different players can each visit the same place.

## 7. Road trips

**At most one road trip per turn.**

1. **Invite** — if you end movement in a city with other players, you may invite them. Flip one participating player's face-up road-trip card to **face-down**; that card's value is the trip's movement allowance, and its suit is the trip's memory suit.
2. **Travel together** — the active player proposes a route, travellers may negotiate direction. All tokens move together, at least 1 step, up to the card's value. Players may travel part of the way.
3. **Pay** — the active player pays the normal travel cost for the whole group's route. Each companion pays **their own** flight and ferry surcharges, **plus ₹100 per step** to the active player, offsetting their cost.
4. **Memories** — every traveller on the trip gains 1 memory of the road-trip card's suit. If the group moves **exactly** the card's full value, the active player gains **one additional** memory of that suit.
5. **Shared tourism** — if the trip ends in a tourist place, each traveller may visit it for **₹1,000** instead of ₹2,000.
6. **Drop-off** — a companion may leave partway. They pay ₹100 per step actually travelled, and **forfeit the shared-tourism discount**.
7. If the trip ends in a city holding a player who **wasn't** on the trip, **everyone there makes a memory**.

*Worked example from the manual:* Green ends with Blue, flips Blue's 4♦, they move 4 steps to Bhopal. Green pays 4 × ₹200 = ₹800; Blue pays Green 4 × ₹100 = ₹400; Green's net is ₹400. Green gets 2 Festival memories (trip + efficiency), Blue gets 1. Each pays ₹1,000 for the Bhopal stamp.

## 8. Aces

An Ace can be played in exactly one of three ways:

1. **Alone** — move one step.
2. **As a booster** — with another card, adding **+1** to its movement value. "Full value" for efficient travel then *includes* the +1.
3. **For a memory** — with another card, creating **one extra memory of either card's suit** (your choice).

*Worked example:* Green plays 2♦ + A♠. Either (i) move 3 steps and make 2 memories, or (ii) move up to 2 steps and take 2 memories.

**Setup exception:** if you start with two or more Aces you may discard one from the game and draw a replacement, if cards remain; if none remain you may request a reshuffle.

## 9. Ending and scoring

**Trigger:** as soon as any player either **plays the last card from their hand**, or **reaches five of their character's destination goals**. Then **finish the current round** so everyone has taken the same number of turns.

**Scoring:**

| # | Points |
|---|---|
| 1 | **10** per tourist place visited |
| 2 | **5** per character destination visited |
| 3 | **10** bonus for reaching 5 of your destinations |
| 4 | **15** per set of three memories of the same suit |
| 5 | **20** per set of four memories, one of every suit |
| 6 | **−5** per ₹500 (or part of ₹500) spent over ₹25,000 |

**Memory set rule:** a single memory may count in **one** same-suit set **and** one four-suit set. The manual's example: 3 Bazaar + 1 Festival + 1 Language + 1 Food = **35** points (15 for the Bazaar triple, 20 for the four-suit set).

---

## 10. Board data on the plate

### The six characters

| Character | Start | Destination goals (tourist-place numbers) |
|---|---|---|
| **Pilgrim** | 23 Varanasi, UP | 41 Nagapattinam · 5 Amritsar · 4 Srinagar · 17 Daman · 25 Giridih · 34 Agartala |
| **Conservationist** | 12 Sawai Madhopur, RJ | 15 Veraval · 3 Leh · 45 Wayanad · 29 Guwahati · 35 Bhubaneswar · 51 Great Nicobar |
| **Riverkeeper** | 9 Agra, UP | 22 Jabalpur · 23 Varanasi · 29 Guwahati · 46 Madikeri · 3 Leh · 39 Amaravati |
| **Musician** | 11 Gwalior, MP | 31 Ziro · 7 Jodhpur · 44 Kochi · 40 Chennai · 18 Mumbai · 34 Kolkata |
| **Historian** | 1 New Delhi, DL | 26 Patna · 48 Hampi · 50 Sri Vijaya Puram · 42 Thanjavur · 32 Charaideo · 21 Bhopal |
| **Explorer** | 2 Rishikesh, UK | 28 Gangtok · 48 Hampi · 50 Sri Vijaya Puram · 6 Jaisalmer · 30 Shillong · 49 Kavaratti |

Note: the same numbered city can be a goal for two characters with different flavour text (48 Hampi is "Vijayanagara ruins" for the Historian, "Bouldering" for the Explorer). **Careful:** goal 34 is *Agartala* on the Pilgrim card but *Kolkata* on the Musician card — the stamp list says 33 = Agartala, 34 = Kolkata, so the Pilgrim's Agartala entry is number **33**. Flagged below.

### The 51 tourist places

1 New Delhi · 2 Rishikesh · 3 Leh · 4 Srinagar · 5 Amritsar · 6 Jaisalmer · 7 Jodhpur · 8 Jaipur · 9 Agra · 10 Lucknow · 11 Gwalior · 12 Ranthambore · 13 Gandhinagar · 14 Bhuj · 15 Gir · 16 Vadodara · 17 Daman · 18 Mumbai · 19 Aurangabad · 20 Nagpur · 21 Bhopal · 22 Jabalpur · 23 Varanasi · 24 Ranchi · 25 Giridih · 26 Patna · 27 Madhubani · 28 Gangtok · 29 Guwahati · 30 Shillong · 31 Ziro · 32 Charaideo · 33 Agartala · 34 Kolkata · 35 Bhubaneshwar · 36 Sambalpur · 37 Bastar · 38 Hyderabad · 39 Amaravati · 40 Chennai · 41 Nagapattinam · 42 Thanjavur · 43 Kanniyakumari · 44 Kochi · 45 Wayanad · 46 Madikeri · 47 Udupi · 48 Hampi · 49 Kavaratti · 50 Sri Vijayapuram · 51 Great Nicobar

### Non-tourist cities on the map (plain dots — waypoints only)

Kargil, Jammu, Dharamshala, Khirganga, Shimla, Chandigarh, Gangotri, Badrinath, Hisar, Bikaner, Udaipur, Indore, Akola, Pune, Nizamabad, Warangal, Gulbarga, Ratnagiri, Panaji, Chitradurga, Kurnool, Kadapa, Bengaluru, Salem, Puducherry, Coimbatore, Madurai, Thiruvananthapuram, Ongole, Visakhapatnam, Srikakulam, Raipur, Bastar*, Bilaspur, Rourkela, Jamshedpur, Asansol, Behrampore, Prayagraj, Gorakhpur, Siliguri, Itanagar, Dibang Valley, Kohima, Imphal, Silchar, Aizwal, Porbandar, Veraval, Agatti, Digligur, Pench, Sambalpur*, Penchmore…

*(This list is read off the artwork and is **not** yet exhaustive or verified — see below.)*

### Special routes

- **Airports** (blue plane icons) — flights connect airport-to-airport for 1 step + ₹4,000.
- **Dashed white lines** — the island air routes (Kochi/Bengaluru/Chennai ↔ Agatti–Kavaratti, and Chennai/Kolkata ↔ Sri Vijayapuram ↔ Digligur ↔ Great Nicobar).
- **Blue wavy line, "Rs. 1000"** — the Kochi–Kavaratti ship.

---

## 11. Open questions — I need your call on these

These are the places where the manual is silent or the board and the manual disagree. I've marked my assumption for each; correct any you disagree with.

1. **Does a destination goal require paying the ₹2,000 tourist visit, or just ending movement there?** Every destination is also a numbered tourist place, so the two could be coupled or independent. This changes the whole economy. **My assumption: they are independent — you score the 5 destination points just by ending your movement on the city, and the ₹2,000 is only for the 10-point tourist stamp.**
2. **Pilgrim's sixth goal "34 Agartala".** The stamp list has 33 = Agartala and 34 = Kolkata. **My assumption: the number is a typo on the board and the city name wins — the Pilgrim's goal is Agartala (33).**
3. **"Meeting a traveller" — does the player who was already standing there also get a memory?** The manual says "*you* gain one memory", but the road-trip clause says "everyone there makes a memory". **My assumption: only the moving player gains the memory on a normal move; the "everyone" rule applies only at the end of a road trip.**
4. **Whose road-trip card gets flipped?** "A participating player's face-up road-trip card" — the active player is also a participant. **My assumption: any participant's, including the active player's own.**
5. **What if a player has no face-up road-trip card left?** **My assumption: they can still join a trip flipped from someone else's card, they just can't supply one.**
6. **Can you decline to play a card / pass a turn?** **My assumption: no — you must play a card and move at least one step, until your hand is empty.**
7. **The Ace setup rule "request a reshuffle"** is undefined, and in a 4-player game the whole deck is dealt so there is nothing to draw. **My assumption: implement it only as "discard an extra Ace and draw from the set-aside pile if one exists"; skip the reshuffle.**
8. **The connection data does not exist yet.** The requirements sheet says CCL will hand over "which cities join, route types, step counts, and surcharges" at kickoff, and it isn't in this folder. The manual implies **1 route segment = 1 step**, but the requirements sheet says routes carry an explicit *step count*, which suggests some edges may be worth more than one. **I need either that file from CCL, or your go-ahead for me to trace the edges off the board artwork and set every road segment to 1 step.**

---

## 12. What this means for the build

The requirements sheet is emphatic that this must be **data-driven**: cities, coordinates, routes, route types, step counts, surcharges, tourist places, characters and destination goals all live in an editable data file that the engine reads at load time and renders over the supplied background plate. The engine holds **only** rules and mechanisms — no board knowledge. Adding a city or retyping a route must change the game with zero engine edits.

Minimum screens: Setup → private Handover → Board/play → Turn actions → Scoreboard. Local hotseat, 2–4 players, full rule enforcement, save/resume, transparent final score breakdown. Stretch: 5–6 players, visual map editor, greedy AI, route hints, undo.

For the UI you described — the board as the centrepiece, with a sidebar showing collected memories and visited places, and the current player's character destinations highlighted inside that visited list — that maps cleanly onto the Board/play screen. I'll design it once you've signed off on the rules above.
