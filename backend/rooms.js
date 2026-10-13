// Room lifecycle: creation, joining by code, character picks, starting a
// game. The authoritative copy of every room lives in MySQL/TiDB (see
// db.js) — this in-memory Map is a hot read-through cache, rebuilt from the
// database once at boot (see loadRooms below), so a crash or restart never
// loses a game in progress. Every function that changes a room awaits
// persistRoom() before returning; findRoom() itself stays synchronous,
// since handlers.js calls it constantly on the hot path and it only ever
// needs the already-loaded in-memory copy.
//
//   Room = { code, board, state: <engine state>|null,
//            seats: [{ name, characterId, tokenHash, ws }] }
//
// A seat's index in `seats` IS its engine player id (engine.js's newGame
// assigns `player.id = i` in array order), so "seatIndex" and "player.id"
// are the same number throughout the server. `ws` is never persisted — it's
// a live socket, meaningless once the process restarts; a seat just has no
// `ws` until that player's browser reconnects and resumes it with its token
// (`tokenHash` is persisted, so that still works after a restart).
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import * as E from "../frontend/src/engine.js";
import { pool } from "./db.js";

export const rooms = new Map();

// A seat's reconnection token is a random 192-bit secret handed to its owner
// once (see handlers.js). Only its SHA-256 hash is kept on the seat and written
// to the database, so a leaked database row cannot be used to take over a seat.
const newToken = () => randomBytes(24).toString("hex");
const hashToken = (token) => createHash("sha256").update(token).digest("hex");

/** The seat index this token belongs to, or -1. Constant-time compare. */
export function seatForToken(room, token) {
  if (typeof token !== "string" || token.length === 0 || token.length > 200) return -1;
  const want = Buffer.from(hashToken(token));
  return room.seats.findIndex((s) => {
    if (typeof s.tokenHash !== "string") return false; // seats saved before tokens existed can't be resumed
    const have = Buffer.from(s.tokenHash);
    return have.length === want.length && timingSafeEqual(have, want);
  });
}

/** Which seats currently have a live connection, by seat index. */
export const presenceOf = (room) => room.seats.map((s) => !!s.ws && s.ws.readyState === s.ws.OPEN);

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O, 1/I
function generateCode() {
  let code;
  do {
    code = Array.from({ length: 4 }, () => CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]).join("");
  } while (rooms.has(code));
  return code;
}

// mysql2 hands a JSON column back already parsed on most setups, but a
// plain string on some drivers/configurations — accept either rather than
// assume one.
function asObject(value) {
  return typeof value === "string" ? JSON.parse(value) : value;
}

// `state.board` is the same ~70KB of static board data on every single
// room — redact.js already knows not to resend it to clients that have
// their own copy (see main.js's onState); the same idea applies to
// storage, so it's stripped before writing and reattached on load instead
// of duplicating it in every row.
function seatsForStorage(room) {
  return room.seats.map((s) => ({ name: s.name, characterId: s.characterId, tokenHash: s.tokenHash }));
}
function stateForStorage(room) {
  if (!room.state) return null;
  const { board, ...rest } = room.state;
  return rest;
}

export async function persistRoom(room) {
  await pool.query(
    "INSERT INTO rooms (code, seats, state) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE seats = VALUES(seats), state = VALUES(state)",
    [room.code, JSON.stringify(seatsForStorage(room)), room.state ? JSON.stringify(stateForStorage(room)) : null],
  );
}

/** Rebuilds the in-memory cache from the database — called once at boot so
 * a restarted server picks back up every room that was still in progress. */
export async function loadRooms(board) {
  const [rows] = await pool.query("SELECT code, seats, state FROM rooms");
  for (const row of rows) {
    const seats = asObject(row.seats).map((s) => ({ ...s, ws: null }));
    const storedState = row.state === null ? null : asObject(row.state);
    const state = storedState ? { ...storedState, board } : null;
    rooms.set(row.code, { code: row.code, board, state, seats });
  }
  if (rows.length) console.log(`restored ${rows.length} room(s) from the database`);
}

export async function createRoom(board) {
  const room = { code: generateCode(), board, state: null, seats: [] };
  rooms.set(room.code, room);
  await persistRoom(room);
  return room;
}

export function findRoom(code) {
  return rooms.get(String(code || "").trim().toUpperCase());
}

/**
 * Adds a seat for a newly-connecting socket. Returns its seat index and the
 * seat's reconnection token — the one and only time the token exists in the
 * clear on the server; the caller sends it to that socket and nobody else.
 */
export async function addSeat(room, name, ws) {
  if (room.state) throw new Error("that game has already started");
  if (room.seats.length >= room.board.characters.length) throw new Error("room is full");
  const token = newToken();
  room.seats.push({ name: String(name || "Player").slice(0, 18) || "Player", characterId: null, ws, tokenHash: hashToken(token) });
  await persistRoom(room);
  return { seatIndex: room.seats.length - 1, token };
}

const sameName = (a, b) => String(a ?? "").trim().toLowerCase() === String(b ?? "").trim().toLowerCase();

/**
 * Hands an already-existing seat back to a player who left (closed the page,
 * refreshed, lost signal) and has now typed the room code and their name again.
 * Only a seat with NO live connection can be reclaimed this way, so nobody can
 * knock a connected player out of their seat. Returns {seatIndex, token} with a
 * fresh token (the old one stops working), or null when no such seat exists.
 */
export async function reclaimSeat(room, name, ws) {
  const i = room.seats.findIndex((s) => sameName(s.name, String(name ?? "").slice(0, 18)) && !(s.ws && s.ws.readyState === s.ws.OPEN));
  if (i === -1) return null;
  const token = newToken();
  room.seats[i].tokenHash = hashToken(token);
  room.seats[i].ws = ws;
  await persistRoom(room);
  return { seatIndex: i, token };
}

/**
 * Picking a character is not turn-ordered online (unlike the printed board's
 * face-to-face setup) — seats join asynchronously over time, so there is no
 * single well-defined "whose turn to choose" while the lobby is still
 * filling. Any open seat may pick any character nobody else already holds.
 */
export async function pickCharacter(room, seatIndex, characterId) {
  if (room.state) throw new Error("that game has already started");
  if (!room.board.characters.some((c) => c.id === characterId)) throw new Error("unknown character");
  const takenByOther = room.seats.some((s, i) => i !== seatIndex && s.characterId === characterId);
  if (takenByOther) throw new Error("that character is already taken");
  room.seats[seatIndex].characterId = characterId;
  await persistRoom(room);
  return room;
}

export async function startGame(room, seed = Date.now() & 0xffffffff) {
  if (room.state) throw new Error("that game has already started");
  if (room.seats.length < 2) throw new Error("need at least 2 players");
  if (room.seats.some((s) => !s.characterId)) throw new Error("everyone needs a character first");
  room.state = E.newGame({
    board: room.board,
    players: room.seats.map((s) => ({ name: s.name, characterId: s.characterId })),
    firstPlayer: 0,
    seed,
  });
  await persistRoom(room);
  return room;
}
