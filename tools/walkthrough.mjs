// A scripted play-through used with shot.mjs to exercise the interface end to
// end: setup, private handover, movement, tourism, road trips and the scoreboard.
const clickText = (sel, text) =>
  `(() => { const e = [...document.querySelectorAll(${JSON.stringify(sel)})].find(x => x.textContent.includes(${JSON.stringify(text)}) && !x.disabled); if(!e) return "no ${text}"; e.click(); return "clicked ${text}"; })()`;
const click = (sel, n = 0) =>
  `(() => { const e = document.querySelectorAll(${JSON.stringify(sel)})[${n}]; if(!e) return "missing ${sel}"; e.click(); return "clicked ${sel}"; })()`;

// Aim a real mouse click at the centre of the first city that is a legal step.
// Deliberately a native tap rather than element.click(): the map takes pointer
// capture while panning, and only a real press/release sequence proves that a
// click on a city still reaches the game.
const tapLegalStep = { tap: `(() => {
  const ring = document.querySelector(".stage svg circle[data-step]");
  if (!ring) return null;
  const b = ring.getBoundingClientRect();
  return { x: b.left + b.width / 2, y: b.top + b.height / 2, label: "step " + ring.getAttribute("data-step") };
})()` };

// One complete turn, driven through the same buttons a player would press.
const turn = (steps = 3) => [
  clickText(".btn", "show my cards"), 260,
  click(".sidebar .pcard", 0), 160,
  clickText(".actions .btn", "Play and travel"), 320,
  ...Array.from({ length: steps }, () => [tapLegalStep, 130]).flat(),
  clickText(".actions .btn", "Finish move"), 300,
  clickText(".actions .btn", "Visit ·"), 200,
  clickText(".actions .btn", "End turn"), 320,
];

export default [
  { shot: "01-setup" },
  clickText(".seg button", "3"),
  click(".charcard", 0), click(".charcard", 1), click(".charcard", 2),
  { shot: "02-setup-chosen" },
  clickText(".btn", "Deal the cards"), 400,
  { shot: "03-handover" },
  clickText(".btn", "show my cards"), 300,
  { shot: "04-lay-card" },
  click(".pcard", 0), 250,
  clickText(".btn", "show my cards"), 250, click(".pcard", 0), 250,
  clickText(".btn", "show my cards"), 250, click(".pcard", 0), 420,
  { shot: "05-handover-turn1" },

  // --- turn 1, inspected step by step
  clickText(".btn", "show my cards"), 500,
  { shot: "06-play-board" },
  click(".sidebar .pcard", 0), 220,
  { shot: "07-card-selected" },
  clickText(".actions .btn", "Play and travel"), 500,
  { shot: "08-moving" },
  // Dragging must pan the map without being mistaken for picking a city.
  `window.__before = { box: document.querySelector(".stage svg").getAttribute("viewBox"), steps: document.querySelector(".actions .steps span").textContent }; "noted " + window.__before.steps`,
  { drag: `(() => { const b = document.querySelector(".stage").getBoundingClientRect();
      return { x: Math.round(b.left + b.width * 0.55), y: Math.round(b.top + b.height * 0.5), dx: -140, dy: -90 }; })()` },
  `(() => {
     const box = document.querySelector(".stage svg").getAttribute("viewBox");
     const steps = document.querySelector(".actions .steps span").textContent;
     const panned = box !== window.__before.box;
     const stayed = steps === window.__before.steps;
     return (panned ? "PAN OK" : "PAN FAILED") + " / " + (stayed ? "no accidental step" : "DRAG SELECTED A CITY: " + steps);
   })()`,
  tapLegalStep, 400,
  { shot: "09-stepped" },
  tapLegalStep, 250, tapLegalStep, 250,
  clickText(".actions .btn", "Finish move"), 450,
  { shot: "10-resolve" },
  clickText(".actions .btn", "Visit ·"), 300,
  { shot: "11-after-visit" },
  clickText(".actions .btn", "End turn"), 400,

  // --- run the rest of the game
  ...turn(4), ...turn(2), ...turn(5), ...turn(3), ...turn(4), ...turn(2),
  { shot: "12-midgame" },
  ...turn(3), ...turn(5), ...turn(2), ...turn(4), ...turn(3), ...turn(3),
  ...turn(6), ...turn(2), ...turn(4), ...turn(3), ...turn(5), ...turn(2),
  ...turn(3), ...turn(4), ...turn(3), ...turn(2), ...turn(4), ...turn(3),
  600,
  `document.querySelector(".wordmark") ? document.querySelector(".wordmark").textContent : "still playing: " + (document.querySelector(".turnchip b")||{}).textContent`,
  { shot: "13-scoreboard" },
];
