// Adds the online-version artwork (from Prof. Parvathy Subramanian's
// "Rahee elements for online version" folder) to frontend/data/board.json.
// Idempotent — safe to run again after tools/build-board.mjs rebuilds the file.
//
//   node tools/add-artwork.mjs .
//
// What it writes, all as plain data the engine never looks at:
//   cities[].stamp          the stamp shown when hovering a tourist place
//   characters[].card       the new character-card artwork
//   suits[].card            the memory card for each suit
//   maps[]                  the two clean maps for the left-hand map panel, each
//                           with `fromPlate`, the affine transform (SVG matrix
//                           order a,b,c,d,e,f) from board-plate coordinates to
//                           that image's pixels. It was fitted by
//                           tools/align-maps.py: all 101 cities sit within
//                           2 px of a detected node (Pune 13 px), so no city
//                           needs coordinates of its own on the new maps.
//   pawn                    the player-token outline from "PLAYERS FC.svg"
//   playerColours           the six token colours from the same file
import fs from "node:fs";
import path from "node:path";

const root = process.argv[2] || ".";
const file = path.join(root, "frontend/data/board.json");
const board = JSON.parse(fs.readFileSync(file, "utf8"));

for (const c of board.cities) {
  if (c.tourist) c.stamp = `assets/stamps/${c.tourist}.webp`;
  else delete c.stamp;
}
for (const ch of board.characters) ch.card = `assets/cards/${ch.id}.webp`;
// Text that changed on the new character cards.
const pilgrim = board.characters.find((c) => c.id === "pilgrim");
if (pilgrim) pilgrim.startBlurb = "Kashi Vishwanath Temple";

for (const s of board.suits) s.card = `assets/memories/${s.id}.webp`;

board.maps = [
  {
    id: "names", label: "With names", image: "assets/maps/names.webp", width: 2200, height: 2199,
    fromPlate: [0.947579, -0.152541, 0.1527, 0.947605, -193.73, 97.36],
  },
  {
    id: "nodes", label: "Nodes only", image: "assets/maps/nodes.webp", width: 2200, height: 2194,
    fromPlate: [0.951364, -0.153151, 0.15331, 0.951391, -209.77, 92.19],
  },
];

// Pawn outline, 34 x 50 units, origin at its top-left; its foot is at (16.7, 49.8).
board.pawn = {
  d: "M33.34,16.81C33.1,7.6,25.45.33,16.25.57,7.04.8-.23,8.45,0,17.66c.2,7.86,5.82,14.31,13.19,15.88l-7.72,16.29,20.83-.53-6.83-15.63c8.05-1.36,14.08-8.46,13.86-16.86Z",
  width: 34, height: 50, footX: 16.7, footY: 49.8, outline: "#20444c",
};
board.playerColours = ["#f0563e", "#3fb8dc", "#f5b800", "#4fae4d", "#d472ac", "#8e4c20"];

fs.writeFileSync(file, JSON.stringify(board, null, 1) + "\n");
console.log(`artwork added: ${board.cities.filter((c) => c.stamp).length} stamps, ${board.characters.length} cards, ${board.suits.length} memory cards, ${board.maps.length} maps`);
