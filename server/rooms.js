// Room lifecycle: creation, joining by code, character picks, starting a
// game. Rooms live only in memory (`Map<code, Room>`) — a server restart
// loses every game in progress. That's an accepted limitation of this
// minimal slice, not something this file tries to work around.
//
//   Room = { code, board, state: <engine state>|null,
//            seats: [{ name, characterId, ws }] }
//
// A seat's index in `seats` IS its engine player id (engine.js's newGame
// assigns `player.id = i` in array order), so "seatIndex" and "player.id"
// are the same number throughout the server.
import * as E from "../src/engine.js";

export const rooms = new Map();

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O, 1/I
function generateCode() {
  let code;
  do {
    code = Array.from({ length: 4 }, () => CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]).join("");
  } while (rooms.has(code));
  return code;
}

export function createRoom(board) {
  const room = { code: generateCode(), board, state: null, seats: [] };
  rooms.set(room.code, room);
  return room;
}

export function findRoom(code) {
  return rooms.get(String(code || "").trim().toUpperCase());
}

/** Adds a seat for a newly-connecting socket; returns its seat index. */
export function addSeat(room, name, ws) {
  if (room.state) throw new Error("that game has already started");
  if (room.seats.length >= room.board.characters.length) throw new Error("room is full");
  room.seats.push({ name: String(name || "Player").slice(0, 18) || "Player", characterId: null, ws });
  return room.seats.length - 1;
}

/**
 * Picking a character is not turn-ordered online (unlike the printed board's
 * face-to-face setup) — seats join asynchronously over time, so there is no
 * single well-defined "whose turn to choose" while the lobby is still
 * filling. Any open seat may pick any character nobody else already holds.
 */
export function pickCharacter(room, seatIndex, characterId) {
  if (room.state) throw new Error("that game has already started");
  if (!room.board.characters.some((c) => c.id === characterId)) throw new Error("unknown character");
  const takenByOther = room.seats.some((s, i) => i !== seatIndex && s.characterId === characterId);
  if (takenByOther) throw new Error("that character is already taken");
  room.seats[seatIndex].characterId = characterId;
  return room;
}

export function startGame(room, seed = Date.now() & 0xffffffff) {
  if (room.state) throw new Error("that game has already started");
  if (room.seats.length < 2) throw new Error("need at least 2 players");
  if (room.seats.some((s) => !s.characterId)) throw new Error("everyone needs a character first");
  room.state = E.newGame({
    board: room.board,
    players: room.seats.map((s) => ({ name: s.name, characterId: s.characterId })),
    firstPlayer: 0,
    seed,
  });
  return room;
}
