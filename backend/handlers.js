// One WebSocket connection handler: parses each inbound message, validates
// it, calls into src/engine.js (the sole rules authority), and broadcasts
// the result. Every real legality check (movement, costs, turn contents)
// lives in engine.js itself, which already throws on bad input — this file
// only adds the one check engine.js has no way to make on its own: which
// *seat* is allowed to act as the current player.
import * as E from "../frontend/src/engine.js";
import { createRoom, findRoom, addSeat, pickCharacter, startGame, persistRoom, seatForToken, presenceOf } from "./rooms.js";
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

// Tell everyone at the table who is connected right now (not secret: it is only
// "this seat has a live socket"), so a stalled game can be explained on screen.
function broadcastPresence(room) {
  const online = presenceOf(room);
  for (const seat of room.seats) if (seat.ws) send(seat.ws, T.PRESENCE, { online });
}

export function handleConnection(ws, { board, graph }) {
  // The heartbeat in app.js pings every socket and drops any that stopped
  // answering; these two lines are the answering side. Any traffic at all also
  // counts as proof of life, so a busy-but-slow client is never dropped.
  ws.isAlive = true;
  ws.on("pong", () => { ws.isAlive = true; });
  // ws emits "error" for malformed frames and the like; with no listener Node
  // would treat it as uncaught and take the whole server (and every game) down.
  // The "close" that always follows does the cleanup.
  ws.on("error", () => {});

  function requireSeat() {
    const id = ws._identity;
    if (!id) throw new Error("join a room first");
    const room = findRoom(id.code);
    if (!room) throw new Error("room no longer exists");
    return { room, seatIndex: id.seatIndex };
  }

  // Let go of whichever seat this socket holds — but only if the seat still
  // points at *this* socket. When a newer connection has taken the seat over,
  // the old socket's late "close" must not unplug the new one.
  function detach() {
    const id = ws._identity;
    if (!id) return;
    ws._identity = null;
    const room = findRoom(id.code);
    const seat = room?.seats[id.seatIndex];
    if (seat && seat.ws === ws) {
      seat.ws = null; // the seat stays reserved; its token can resume it
      broadcastPresence(room);
    }
  }

  ws.on("message", async (raw) => {
    ws.isAlive = true;
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return send(ws, T.ERROR, { message: "malformed message" });
    }
    try {
      switch (msg.type) {
        case T.CREATE_ROOM: {
          const room = await createRoom(board);
          const { seatIndex, token } = await addSeat(room, msg.name, ws);
          detach(); // a socket holds one seat: leave any earlier one, once the new one is certain
          ws._identity = { code: room.code, seatIndex };
          send(ws, T.ROOM_CREATED, { code: room.code, seatIndex, token });
          broadcastLobby(room);
          broadcastPresence(room);
          break;
        }
        case T.JOIN_ROOM: {
          const room = findRoom(msg.code);
          if (!room) throw new Error("no room with that code");
          const { seatIndex, token } = await addSeat(room, msg.name, ws);
          detach();
          ws._identity = { code: room.code, seatIndex };
          send(ws, T.JOINED, { code: room.code, seatIndex, seats: lobbySeats(room), token });
          broadcastLobby(room);
          broadcastPresence(room);
          break;
        }
        case T.RESUME: {
          const room = findRoom(msg.code);
          const seatIndex = room ? seatForToken(room, msg.token) : -1;
          // Unknown room, wrong token and no token are deliberately indistinguishable.
          if (seatIndex === -1) { send(ws, T.RESUME_FAILED, { reason: "that game or seat is no longer available" }); break; }

          const seat = room.seats[seatIndex];
          const previous = seat.ws;
          const held = ws._identity;
          if (held && !(held.code === room.code && held.seatIndex === seatIndex)) detach(); // was sitting elsewhere
          seat.ws = ws;
          ws._identity = { code: room.code, seatIndex };

          // The newest connection wins. Tell the old one why, then close it with the
          // code that tells a browser not to reconnect on its own (see protocol.js).
          if (previous && previous !== ws) {
            send(previous, T.ERROR, { message: "This seat was taken over by another window, so this one has been disconnected." });
            previous.close(T.REPLACED_CLOSE_CODE, "replaced");
          }

          send(ws, T.RESUMED, {
            code: room.code, seatIndex, seats: lobbySeats(room),
            state: redact(room.state, seatIndex), // null while still in the lobby
            online: presenceOf(room),
          });
          broadcastPresence(room);
          break;
        }
        case T.PICK_CHARACTER: {
          const { room, seatIndex } = requireSeat();
          await pickCharacter(room, seatIndex, msg.characterId);
          broadcastLobby(room);
          break;
        }
        case T.START_GAME: {
          const { room, seatIndex } = requireSeat();
          if (seatIndex !== 0) throw new Error("only the player who created the room can start it");
          await startGame(room);
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
          await persistRoom(room); // durable before the table hears about it — a crash right after still remembers this move
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

  ws.on("close", detach);
}
