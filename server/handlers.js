// One WebSocket connection handler: parses each inbound message, validates
// it, calls into src/engine.js (the sole rules authority), and broadcasts
// the result. Every real legality check (movement, costs, turn contents)
// lives in engine.js itself, which already throws on bad input — this file
// only adds the one check engine.js has no way to make on its own: which
// *seat* is allowed to act as the current player.
import * as E from "../src/engine.js";
import { createRoom, findRoom, addSeat, pickCharacter, startGame } from "./rooms.js";
import { redact } from "./redact.js";
import * as T from "./protocol.js";

// name -> (state, graph, seatIndex, args) => void — mutates state in place.
const ACTIONS = {
  layRoadTripCard: (s, g, seatIndex, a) => E.layRoadTripCard(s, seatIndex, a.cardId),
  playCard: (s, g, seatIndex, a) => E.playCard(s, { cardId: a.cardId, ace: a.ace ?? null }),
  stepTo: (s, g, seatIndex, a) => E.stepTo(s, g, a.cityId),
  undoStep: (s) => E.undoStep(s),
  endMovement: (s) => E.endMovement(s),
  offerRoadTrip: (s) => E.offerRoadTrip(s),
  proposeRoadTrip: (s, g, seatIndex, a) => E.proposeRoadTrip(s, g, { companions: a.companions, owner: a.owner, cardId: a.cardId, destination: a.destination }),
  // The responder is always the sending seat's own id, never a client-supplied
  // one — a player may only accept, counter, or decline for themselves. `a`
  // is passed through as-is: {type:"accept", stop} | {type:"counter", destination} | {type:"decline"}.
  respondRoadTrip: (s, g, seatIndex, a) => E.respondRoadTrip(s, g, seatIndex, a),
  confirmRoadTrip: (s) => E.confirmRoadTrip(s),
  cancelRoadTripInvite: (s) => E.cancelRoadTripInvite(s),
  dropOff: (s, g, seatIndex, a) => E.dropOff(s, a.riderId),
  endRoadTrip: (s) => E.endRoadTrip(s),
  endTurn: (s) => E.endTurn(s),
  visitTourist: (s, g, seatIndex, a) => E.visitTourist(s, a.playerId, !!a.discounted),
};

function send(ws, type, data) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type, ...data }));
}

function lobbySeats(room) {
  return room.seats.map((s) => ({ name: s.name, characterId: s.characterId }));
}

function broadcastLobby(room) {
  const seats = lobbySeats(room);
  for (const seat of room.seats) if (seat.ws) send(seat.ws, T.LOBBY_UPDATE, { code: room.code, seats });
}

function broadcastState(room) {
  room.seats.forEach((seat, seatIndex) => {
    if (seat.ws) send(seat.ws, T.STATE, { state: redact(room.state, seatIndex) });
  });
}

export function handleConnection(ws, { board, graph }) {
  function requireSeat() {
    const id = ws._identity;
    if (!id) throw new Error("join a room first");
    const room = findRoom(id.code);
    if (!room) throw new Error("room no longer exists");
    return { room, seatIndex: id.seatIndex };
  }

  ws.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return send(ws, T.ERROR, { message: "malformed message" });
    }
    try {
      switch (msg.type) {
        case T.CREATE_ROOM: {
          const room = createRoom(board);
          const seatIndex = addSeat(room, msg.name, ws);
          ws._identity = { code: room.code, seatIndex };
          send(ws, T.ROOM_CREATED, { code: room.code, seatIndex });
          broadcastLobby(room);
          break;
        }
        case T.JOIN_ROOM: {
          const room = findRoom(msg.code);
          if (!room) throw new Error("no room with that code");
          const seatIndex = addSeat(room, msg.name, ws);
          ws._identity = { code: room.code, seatIndex };
          send(ws, T.JOINED, { code: room.code, seatIndex, seats: lobbySeats(room) });
          broadcastLobby(room);
          break;
        }
        case T.PICK_CHARACTER: {
          const { room, seatIndex } = requireSeat();
          pickCharacter(room, seatIndex, msg.characterId);
          broadcastLobby(room);
          break;
        }
        case T.START_GAME: {
          const { room, seatIndex } = requireSeat();
          if (seatIndex !== 0) throw new Error("only the player who created the room can start it");
          startGame(room);
          broadcastState(room);
          break;
        }
        case T.ACTION: {
          const { room, seatIndex } = requireSeat();
          if (!room.state) throw new Error("the game hasn't started yet");
          const fn = ACTIONS[msg.name];
          if (!fn) throw new Error(`unknown action "${msg.name}"`);
          if (T.TURN_GATED_ACTIONS.has(msg.name) && E.currentPlayer(room.state).id !== seatIndex)
            throw new Error("it isn't your turn");
          fn(room.state, graph, seatIndex, msg.args ?? {});
          broadcastState(room);
          break;
        }
        default:
          throw new Error(`unknown message type "${msg.type}"`);
      }
    } catch (err) {
      send(ws, T.ERROR, { inReplyTo: msg?.type, message: err.message });
    }
  });

  ws.on("close", () => {
    const id = ws._identity;
    if (!id) return;
    const room = findRoom(id.code);
    const seat = room?.seats[id.seatIndex];
    if (seat) seat.ws = null; // seat stays reserved; nothing rejoins it this slice
  });
}
