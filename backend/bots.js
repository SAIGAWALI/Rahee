// Computer players in online rooms. The host can fill empty seats with bots in
// the lobby; once the game starts the server plays their turns itself, a beat
// apart so people can follow what happened. A bot sees only what its own seat
// would see (the redacted state), decides with frontend/src/ai.js, and its move
// goes through applyAction() — the very same checks as a human's message.
import * as E from "../frontend/src/engine.js";
import { chooseAction, BOT_NAMES, BOT_LEVELS } from "../frontend/src/ai.js";
import { applyAction } from "./actions.js";
import { redact } from "./redact.js";
import { persistRoom } from "./rooms.js";

// How long a computer player "thinks" before each kind of move, in ms — slow
// enough that people can follow what it did. BOT_DELAY_MS scales all of them
// (it is the pause for an ordinary decision; the tests set it to a few ms).
const BASE = Number(process.env.BOT_DELAY_MS ?? 1500);
const PAUSE = {
  playCard: 2.0,            // a beat before a bot starts its turn
  layRoadTripCard: 1.2,
  stepTo: 0.65,             // each step along the route, so you can watch it travel
  endMovement: 1.0,
  visitTourist: 1.2,
  offerRoadTrip: 1.2, proposeRoadTrip: 1.2, respondRoadTrip: 1.2, confirmRoadTrip: 1.0,
  endRoadTrip: 1.0,
  endTurn: 1.6,             // time to read what happened before the next player goes
};
const delayFor = (name) => BASE * (PAUSE[name] ?? 1);

export async function addBot(room, level = "greedy") {
  if (room.state) throw new Error("that game has already started");
  if (room.seats.length >= room.board.characters.length) throw new Error("room is full");
  const used = new Set(room.seats.map((s) => s.name));
  const name = `${BOT_NAMES.find((n) => !used.has(`${n} (AI)`)) ?? `Bot ${room.seats.length + 1}`} (AI)`;
  const taken = new Set(room.seats.map((s) => s.characterId).filter(Boolean));
  const free = room.board.characters.filter((c) => !taken.has(c.id));
  const characterId = free[Math.floor(Math.random() * free.length)]?.id ?? null;
  room.seats.push({ name, characterId, ws: null, tokenHash: null, isBot: true, botLevel: BOT_LEVELS.some((l) => l.id === level) ? level : "greedy" });
  await persistRoom(room);
}

/** Removes a bot from the lobby. Seats after it move up one, so live sockets are told their new index. */
export async function removeBot(room, seatIndex) {
  if (room.state) throw new Error("that game has already started");
  const seat = room.seats[seatIndex];
  if (!seat?.isBot) throw new Error("that seat is not a computer player");
  room.seats.splice(seatIndex, 1);
  room.seats.forEach((s, i) => { if (s.ws?._identity) s.ws._identity.seatIndex = i; });
  await persistRoom(room);
}

/**
 * If any bot has something to do, does it after a short pause, then looks
 * again. At most one timer per room; humans' moves simply reschedule it.
 * `broadcast` sends the new state to every connected seat.
 */
export function scheduleBots(room, graph, broadcast) {
  if (!room.state || room.botTimer || room.state.phase === "over") return;
  const next = nextBotMove(room, graph);
  if (!next) return;
  room.botTimer = setTimeout(async () => {
    room.botTimer = null;
    // The state may have moved on while we waited — decide again, now.
    const move = nextBotMove(room, graph);
    if (!move) return;
    try {
      applyAction(room.state, graph, move.seat, move.action.name, move.action.args);
    } catch (err) {
      console.warn(`bot ${room.seats[move.seat]?.name} in ${room.code}: "${move.action.name}" refused (${err.message}) — using a safe fallback`);
      if (!fallback(room, graph, move.seat)) return;
    }
    try { await persistRoom(room); } catch (err) { console.error("persist failed after a bot move:", err.message); }
    broadcast();
    scheduleBots(room, graph, broadcast);
  }, delayFor(next.action.name));
}

function nextBotMove(room, graph) {
  const s = room.state;
  for (let seat = 0; seat < room.seats.length; seat++) {
    if (!room.seats[seat].isBot) continue;
    const view = { ...redact(s, seat), board: s.board };
    const action = chooseAction(view, graph, seat, { level: room.seats[seat].botLevel });
    if (action) return { seat, action };
  }
  return null;
}

/** When a bot's first choice is refused (it shouldn't be), never leave the table stuck. */
function fallback(room, graph, seat) {
  const s = room.state, t = s.turn;
  const tries = [];
  if (t?.stage === "roadtrip-pending") tries.push(["respondRoadTrip", { type: "decline" }]);
  if (E.currentPlayer(s).id === seat) {
    if (s.phase === "setup-roadtrip-card") tries.push(["layRoadTripCard", { cardId: s.players[seat].hand[0]?.id }]);
    if (!t) tries.push(["playCard", { cardId: s.players[seat].hand[0]?.id }]);
    if (t?.stage === "moving") tries.push(t.stepsUsed ? ["endMovement", {}] : ["stepTo", { cityId: E.movementOptions(s, graph)[0]?.to }]);
    if (t?.stage === "roadtrip-moving") tries.push(t.roadTrip.stepsUsed ? ["endRoadTrip", {}] : ["stepTo", { cityId: E.movementOptions(s, graph)[0]?.to }]);
    if (["roadtrip-invite", "roadtrip-review"].includes(t?.stage)) tries.push(["cancelRoadTripInvite", {}]);
    if (t?.stage === "resolve") tries.push(["endTurn", {}]);
  }
  for (const [name, args] of tries) {
    try { applyAction(s, graph, seat, name, args); return true; } catch { /* try the next */ }
  }
  return false;
}
