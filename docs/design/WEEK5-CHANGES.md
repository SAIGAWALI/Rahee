# Week 5 — what changed

Two parts: (A) Prof. Parvathy's artwork for the online version, plus the rule gaps still open against RULES.md; (B) Prof. Jyothi's request for computer players and test suites.

## A. Artwork from "Rahee elements for online version"

| Element supplied | Where it is used now |
|---|---|
| 51 stamps (PNG) | **Hover any numbered city on the board** and its stamp appears with the place's facts. They also show in the left map panel's hover and in the city card there, in the sidebar's new **stamp album** (replaces the old text list), on the "Stay at…" step when you decide whether to visit, in the "Stamp collected!" pop-up, and on the final scoreboard (each player's stamps). |
| Map with nodes + city/state names, map with only nodes | **The clickable left panel.** "Map & destinations" opens an overview of India (toggle *With names* / *Nodes only*, and ⤢ to enlarge). It shows every pawn, your destinations (gold rings), the destinations of whichever other player you pick (their colour), and a dashed box for the part of the board you're looking at. Click a city to jump the board there and get its stamp card; click open ground to pan there. The Week 4 "Where everyone is heading" list sits under the map. |
| 6 character cards | Replace the old crops in the lobby, the setup screen, and a new thumbnail in the sidebar header (click to see it full size). The Pilgrim's start text now matches the new card ("Kashi Vishwanath Temple"). |
| 4 memory cards (Bazaar, Food, Language, Festival) | The sidebar's memory tiles (with a count badge), the "Memories made" strip after each move, and the rules sheet. |
| PLAYERS FC.svg (pawns) | Player tokens on the board and the mini-map are now the printed pawn shape, in the six pawn colours. |
| TOKENS-FC.svg (cubes) | Your visited places are marked with a small cube in your colour. |
| OldNewspaperTypes.ttf | Display font for the wordmark, headings and the rules sheet (it's the face on the cards). |
| One-page rules sheet | **Not in the folder yet.** A one-page "How to play" sheet is built into the game meanwhile (landing page "How to play", in-game "Rules" button); every number in it is read from board.json. When the PNG arrives, set `"rulesImage": "assets/rules.png"` in board.json and it is shown at the top of that sheet. |

How the new maps were placed: the clean maps are the printed board redrawn without illustrations and rotated ~9°. `tools/align-maps.py` finds all 102 nodes on the "only nodes" map and fits one affine transform; every one of the 101 cities lands within 2 px of its node (Pune 13 px). That transform is stored once per map in board.json (`maps[].fromPlate`), so no city needed new coordinates. `tools/add-artwork.mjs` writes all the artwork paths into board.json (re-run it after `build-board.mjs`).

Images were converted to WebP and resized for the web (stamps 320 px wide, cards 640 px, maps 2200 px): about 2.3 MB in all instead of ~23 MB.

## A2. Rules now enforced as RULES.md states them

These were written into RULES.md after the POC meetings but the engine still did the older thing. Each now has its own scenario test in `tools/test-rules.mjs`.

| Rule (RULES.md) | Before | Now |
|---|---|---|
| A destination is completed only when you **visit and pay** (§6) | Ending a move there counted | Counted only by the ₹2,000 (or shared ₹1,000) visit; the 5th one triggers the end immediately |
| The road-trip card must belong to **another participant**, not the driver (§7) | Driver could flip their own card; the server didn't check the owner was on the trip | Only companions' cards are offered and accepted; if the card's owner declines, the trip is off |
| A player already at the trip's end who wasn't on it gets **no** road-trip memory (§5, §7.8) | They got one | They don't |
| Two or more Aces: discard one and draw, or ask for a reshuffle (§8) | Not implemented | Offered on the setup screen to whoever holds 2+ Aces |
| Starting budget ₹20,000 (§2, §3) | ₹25,000 (the printed manual's figure) | ₹20,000 (confirmed by the POC) |

Bugs found while doing this, also fixed:
- A road-trip rider whose chosen stop *was* the destination lost the ₹1,000 shared stamp price (they were marked "dropped off" on arrival).
- The browser decided whether a visit was discounted (`discounted: true`) and the server believed it — any player could pay ₹1,000 instead of ₹2,000. The price is now decided by the engine.
- Any seat could make another player visit (spending their money) or drop another rider off. Now only yourself — or the driver, for their companions.
- Visiting was allowed at any time, even mid-move or on someone else's turn.

## B. Computer players and test suites (Prof. Jyothi's request)

See [AI-PLAYTESTING.md](AI-PLAYTESTING.md).

## Confirmed with CCL

1. **Budget:** ₹20,000. RULES.md is final: it was agreed with the POC, and where it differs from the printed manual, RULES.md wins.
2. **No city between Siliguri and Guwahati.** The dot on the new map is in the image only and is not in the game data.
3. **Spellings:** they stay as they are in the board data.

Still open: the one-page rules PNG has not arrived, and the scoring balance (memory sets vs destinations) needs discussing with the POC; see AI-PLAYTESTING.md.

## Screenshots

`docs/screenshots/` — rules sheet, lobby with computer players, setup with the new card, map panel with a city's stamp card, stamp on hover, the visit step, "Destination completed", the enlarged nodes-only map, and the scoreboard with everyone's stamps. All taken from a real game against computer players.
