// Assembles data/board.json from the traced artwork plus the printed card and
// cost data. Everything the engine needs about *this* board lives in that file;
// the engine itself holds only rules and mechanisms.
//
//   node build-board.mjs <projectDir>
import fs from "node:fs";
import path from "node:path";

const root = process.argv[2];
const traced = JSON.parse(fs.readFileSync(path.join(root, "frontend/assets/routes-traced.json"), "utf8"));

const cities = fs.readFileSync(path.join(root, "tools/cities.tsv"), "utf8")
  .trim().split("\n").slice(1).map((line) => {
    const [id, name, state, x, y, tourist, attraction] = line.split("\t");
    const c = { id, name, state, x: +x, y: +y };
    if (tourist) { c.tourist = +tourist; c.attraction = attraction; }
    return c;
  });
const byId = new Map(cities.map((c) => [c.id, c]));
for (const id of traced.airports) byId.get(id).airport = true;

// Island airports are reached only by the flight lines drawn on the board, so
// they are not part of the mainland airport-to-airport network.
const ISLAND_AIRPORTS = ["agatti"];
for (const id of ISLAND_AIRPORTS) byId.get(id).airport = true;

// Traced "roads" that are not printed roads: the tracer followed two real roads
// end to end through the node between them and reported one long edge. Dropping
// them leaves the real two-road link in place (bhopal-gwalior, gwalior-lucknow),
// so a path from one end to the other now passes through the middle city.
// Each is two printed roads run end to end through the city between them. Every
// one was checked against the plate: the removed line lies on the two real roads
// (or, for Madurai-Thiruvananthapuram, on no printed road at all).
const SPURIOUS = [
  ["bhopal", "lucknow"],          // Bhopal-Gwalior + Gwalior-Lucknow
  ["kochi", "madikeri"],          // Kochi-Wayanad + Wayanad-Madikeri
  ["badrinath", "rishikesh"],     // Badrinath-New Delhi + New Delhi-Rishikesh
  ["bengaluru", "wayanad"],       // Bengaluru-Udupi + Udupi-Wayanad
  ["daman", "pune"],              // Daman-Mumbai + Mumbai-Pune
  ["madurai", "thiruvananthapuram"], // no printed road between them
  ["dharamshala", "jammu"],       // no printed road between them
  ["coimbatore", "wayanad"],      // really Wayanad-Kochi + Kochi-Coimbatore (the road bends through Kochi)
];
// NOT in this list on purpose: Amritsar-Jammu and Aizwal-Imphal. Both pass near
// Dharamshala / Silchar but are separate printed roads in their own right.
const isSpurious = (e) => SPURIOUS.some(([a, b]) => (e.from === a && e.to === b) || (e.from === b && e.to === a));

// Real roads whose drawn line is wrong, and printed roads the tracer missed
// (usually hidden behind a bus or tree). tools/route-fixes.json holds polylines
// that were traced along the printed ribbon; see tools/test-engine.mjs for the
// checks that keep them honest.
const FIXES = JSON.parse(fs.readFileSync(path.join(root, "tools/route-fixes.json"), "utf8"));
const PATH_FIXES = new Map(Object.entries({ "bhopal|indore": [[716, 1100], [650, 1100], [583, 1100]], ...FIXES.fixes }));
const fixPath = (e) => PATH_FIXES.get(`${e.from}|${e.to}`) || PATH_FIXES.get(`${e.to}|${e.from}`)?.slice().reverse() || e.path;

const routes = traced.routes.filter((e) => !isSpurious(e)).map((e) => ({
  from: e.from, to: e.to, type: "road", steps: 1, surcharge: 0, path: fixPath(e),
}));

// Every mainland airport pair is a legal flight; the board draws no line for
// these, so they get a straight path.
const mainlandAirports = traced.airports.filter((id) => !ISLAND_AIRPORTS.includes(id));
for (let i = 0; i < mainlandAirports.length; i++)
  for (let j = i + 1; j < mainlandAirports.length; j++) {
    const a = byId.get(mainlandAirports[i]), b = byId.get(mainlandAirports[j]);
    routes.push({ from: a.id, to: b.id, type: "flight", steps: 1, surcharge: 4000, path: [[a.x, a.y], [b.x, b.y]] });
  }

// Printed roads the tracer could not follow because a bus, tree or other piece of
// artwork is drawn across them. Each was confirmed against the plate by eye and
// its polyline read off the artwork. (Kolkata-Behrampore, the sixth such gap on
// the previous map source, traces cleanly on this one and needs no entry here.)
const EXTRA_ROADS = [
  ["aurangabad", "bhopal", [[548, 1344], [620, 1280], [650, 1220], [680, 1150], [716, 1100]]],
  ["gulbarga", "ratnagiri", [[398, 1560], [480, 1570], [540, 1555], [644, 1532]]],
  ["lucknow", "gorakhpur", [[941, 847], [990, 840], [1035, 835], [1070, 850], [1100, 863]]],
  ["sambalpur", "srikakulam", [[1149, 1266], [1140, 1310], [1135, 1350], [1125, 1400], [1119, 1464]]],
  ["srinagar", "jammu", [[594, 300], [600, 330], [610, 355], [600, 380], [587, 407]]],
  // The only ground link into the whole Northeast cluster — without it, every
  // city from Guwahati onward is reachable only by air. Hidden under a
  // decorative houseboat icon.
  ["siliguri", "guwahati", [[1447, 865], [1500, 862], [1560, 870], [1610, 878], [1662, 881]]],
];
for (const [from, to, pth] of [...EXTRA_ROADS, ...FIXES.add])
  routes.push({ from, to, type: "road", steps: 1, surcharge: 0, path: fixPath({ from, to, path: pth }) });

// Routes the tracer cannot see, because they are drawn as dotted flight paths or
// blue water lines rather than the brown road ribbon.
const SPECIAL = [
  ["agatti", "bengaluru", "flight", 4000],          // dotted line across the peninsula
  ["chennai", "sri-vijayapuram", "flight", 4000],   // dotted line east from Chennai
  ["kolkata", "sri-vijayapuram", "flight", 4000],   // dotted line south-east from Kolkata
  ["kochi", "kavaratti", "ship", 1000],             // the "Rs. 1000" boat line
  ["agatti", "kavaratti", "ship", 0],               // short link inside Lakshadweep
  ["sri-vijayapuram", "great-nicobar", "ship", 200], // the "Rs. 200" line down the Nicobar chain
];
for (const [from, to, type, surcharge] of SPECIAL) {
  const a = byId.get(from), b = byId.get(to);
  routes.push({ from, to, type, steps: 1, surcharge, path: [[a.x, a.y], [b.x, b.y]] });
}

const CHARACTERS = [
  ["pilgrim", "Pilgrim", "varanasi", "Kashi Vishwanath",
    [["nagapattinam", "Velankanni Church"], ["amritsar", "Harmandir Sahib"], ["srinagar", "Dargah Hazratbal"],
     ["daman", "Iranshah, Udvada"], ["giridih", "Sammed Shikharji"], ["agartala", "Chaturdasha Devata Temple"]]],
  ["conservationist", "Conservationist", "sawai-madhopur", "Tigers of Ranthambore",
    [["veraval", "Lions of Gir"], ["leh", "Shan of Hemis"], ["wayanad", "Elephants of Muthanga"],
     ["guwahati", "Rhinos of Kaziranga"], ["bhubaneshwar", "Turtles of Gahirmatha"], ["great-nicobar", "Biosphere Reserve"]]],
  ["riverkeeper", "Riverkeeper", "agra", "Yamuna",
    [["jabalpur", "Narmada"], ["varanasi", "Ganga"], ["guwahati", "Brahmaputra"],
     ["madikeri", "Kaveri"], ["leh", "Indus"], ["amaravati", "Krishna"]]],
  ["musician", "Musician", "gwalior", "Dhrupad tradition",
    [["ziro", "Festival of Music"], ["jodhpur", "Folk Music"], ["kochi", "Sopanam Sangeetham"],
     ["chennai", "Carnatic Music"], ["mumbai", "Desi Hip-Hop"], ["kolkata", "Baul Sangeet"]]],
  ["historian", "Historian", "new-delhi", "Mughal capital",
    [["patna", "Mauryan capital"], ["hampi", "Vijayanagara ruins"], ["sri-vijayapuram", "Colonial prison"],
     ["thanjavur", "Chola temple"], ["charaideo", "Ahom tombs"], ["bhopal", "Stone Age art"]]],
  ["explorer", "Explorer", "rishikesh", "Ganga rafting",
    [["gangtok", "Kanchenjunga Trek"], ["hampi", "Bouldering"], ["sri-vijayapuram", "Snorkeling"],
     ["jaisalmer", "Desert Dune Surfing"], ["shillong", "Spelunking"], ["kavaratti", "Scuba diving"]]],
];

const board = {
  version: 1,
  name: "RAHEE",
  subtitle: "A Traveller's Journey Across India",
  credits: {
    design: "Jyothi Krishnan & CCL, IIT Gandhinagar",
    art: "Parvathy Subramanian",
    note: "Board artwork is representative, for educational purposes. © CCL, IITGN",
  },
  plate: {
    image: "assets/board-plate.png",
    width: 2147,
    height: 2457,
    source: { pdf: "Rahee-gameboard.pdf", regionPt: [0, 0, 1073.26, 1228.62], scale: 2 },
  },
  suits: [
    { id: "spades", symbol: "♠", memory: "Bazaar", blurb: "shopping at a bazaar", colour: "#2f3640" },
    { id: "hearts", symbol: "♥", memory: "Food", blurb: "eating something new", colour: "#c0392b" },
    { id: "clubs", symbol: "♣", memory: "Language", blurb: "hearing a language", colour: "#2f3640" },
    { id: "diamonds", symbol: "♦", memory: "Festival", blurb: "celebrating a festival", colour: "#c0392b" },
  ],
  economy: {
    startingBudget: 25000,
    costPerStep: 200,
    flightSurcharge: 4000,
    shipSurcharge: 1000,
    touristVisit: 2000,
    sharedTouristVisit: 1000,
    roadTripSharePerStep: 100,
  },
  cards: {
    values: { A: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6, 10: 10, J: 10, Q: 5, K: 5 },
    deals: [
      { players: [2, 3, 4], ranks: ["A", "2", "3", "4", "5", "6", "10"], guaranteed: ["10"], dealt: 6 },
      { players: [5], ranks: ["A", "2", "3", "4", "5", "6", "10", "J", "Q", "K"], guaranteed: ["J", "10"], dealt: 6 },
      { players: [6], ranks: ["A", "2", "3", "4", "5", "6", "10", "J", "Q", "K"], guaranteed: ["J", "10"], dealt: 5 },
    ],
  },
  scoring: {
    touristPlace: 10,
    destination: 5,
    allDestinationsBonus: 10,
    destinationsForBonus: 5,
    sameSuitSet: 15,
    fourSuitSet: 20,
    overBudgetBlock: 500,
    overBudgetPenalty: 5,
  },
  cities,
  routes,
  characters: CHARACTERS.map(([id, name, start, startBlurb, goals]) => ({
    id, name, start, startBlurb,
    card: `assets/cards/${id}.png`,
    goals: goals.map(([city, blurb]) => ({ city, blurb })),
  })),
};

// ---- Validation ------------------------------------------------------------
const problems = [];
const ids = new Set(cities.map((c) => c.id));
for (const r of board.routes) {
  if (!ids.has(r.from)) problems.push(`route from unknown city ${r.from}`);
  if (!ids.has(r.to)) problems.push(`route to unknown city ${r.to}`);
}
for (const ch of board.characters) {
  if (!ids.has(ch.start)) problems.push(`${ch.id}: unknown start ${ch.start}`);
  for (const g of ch.goals) if (!ids.has(g.city)) problems.push(`${ch.id}: unknown goal ${g.city}`);
}
const touristNums = cities.filter((c) => c.tourist).map((c) => c.tourist).sort((a, b) => a - b);
for (let i = 1; i <= 51; i++) if (touristNums[i - 1] !== i) { problems.push(`tourist place ${i} missing or duplicated`); break; }
// Every city must be reachable, or a player could be stranded.
const adj = new Map(cities.map((c) => [c.id, []]));
for (const r of board.routes) { adj.get(r.from).push(r.to); adj.get(r.to).push(r.from); }
const seen = new Set(["new-delhi"]);
for (const q = ["new-delhi"]; q.length; ) {
  for (const n of adj.get(q.pop())) if (!seen.has(n)) { seen.add(n); q.push(n); }
}
for (const c of cities) if (!seen.has(c.id)) problems.push(`${c.id} is unreachable`);
// Every city should also be reachable without flying, except the Andamans, which
// the board joins to the mainland only by its drawn flight lines.
const ground = new Map(cities.map((c) => [c.id, []]));
for (const r of board.routes) {
  if (r.type === "flight") continue;
  ground.get(r.from).push(r.to); ground.get(r.to).push(r.from);
}
const gseen = new Set(["new-delhi"]);
for (const q = ["new-delhi"]; q.length; ) {
  for (const n of ground.get(q.pop())) if (!gseen.has(n)) { gseen.add(n); q.push(n); }
}
const ANDAMANS = new Set(["sri-vijayapuram", "diglipur", "great-nicobar"]);
const stranded = cities.filter((c) => !gseen.has(c.id) && !ANDAMANS.has(c.id)).map((c) => c.id);
if (stranded.length) problems.push(`reachable only by air: ${stranded.join(", ")}`);

fs.mkdirSync(path.join(root, "frontend/data"), { recursive: true });
fs.writeFileSync(path.join(root, "frontend/data/board.json"), JSON.stringify(board, null, 1));
console.log(`board.json: ${cities.length} cities (${touristNums.length} tourist), ${board.routes.length} routes ` +
  `(${board.routes.filter((r) => r.type === "road").length} road, ${board.routes.filter((r) => r.type === "flight").length} flight, ` +
  `${board.routes.filter((r) => r.type === "ship").length} ship), ${board.characters.length} characters`);
console.log(problems.length ? "PROBLEMS:\n  " + problems.join("\n  ") : "validation clean");
