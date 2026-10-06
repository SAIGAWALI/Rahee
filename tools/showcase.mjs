// Plays a few turns and then captures the play screen mid-journey, so the board
// and the travel journal are both showing real accumulated state.
const clickText = (sel, text) =>
  `(() => { const e = [...document.querySelectorAll(${JSON.stringify(sel)})].find(x => x.textContent.includes(${JSON.stringify(text)}) && !x.disabled); if(!e) return "no ${text}"; e.click(); return "ok"; })()`;
const click = (sel, n = 0) =>
  `(() => { const e = document.querySelectorAll(${JSON.stringify(sel)})[${n}]; if(!e) return "missing"; e.click(); return "ok"; })()`;
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
const turn = (steps) => [
  clickText(".btn", "show my cards"), 200,
  click(".sidebar .pcard", 0), 120,
  clickText(".actions .btn", "Play and travel"), 220,
  ...Array.from({ length: steps }, () => [tapLegalStep, 110]).flat(),
  clickText(".actions .btn", "Finish move"), 220,
  clickText(".actions .btn", "Visit ·"), 160,
  clickText(".actions .btn", "End turn"), 240,
];

export default [
  clickText(".seg button", "4"),
  click(".charcard", 0), click(".charcard", 1), click(".charcard", 2), click(".charcard", 3),
  clickText(".btn", "Deal the cards"), 300,
  ...Array.from({ length: 4 }, () => [clickText(".btn", "show my cards"), 200, click(".pcard", 0), 220]).flat(),
  ...turn(6), ...turn(5), ...turn(4), ...turn(6),
  ...turn(5), ...turn(6), ...turn(4), ...turn(5),
  // stop at a handover, step into the turn, and photograph the board
  clickText(".btn", "show my cards"), 700,
  { shot: "board-midgame" },
  click(".sidebar .pcard", 0), 200,
  clickText(".actions .btn", "Play and travel"), 700,
  { shot: "board-moving" },
  `(() => { const el = document.querySelector(".mapctl button.wide"); el.click(); return "fit"; })()`, 700,
  { shot: "board-fit" },
];
