// One WebSocket connection handler: parses each inbound message, validates
// it, calls into src/engine.js (the sole rules authority), and broadcasts
// the result. Every real legality check (movement, costs, turn contents)
// lives in engine.js itself, which already throws on bad input — this file
// only adds the one check engine.js has no way to make on its own: which
// *seat* is allowed to act as the current player.
import * as E from "../frontend/src/engine.js";
import { createRoom, findRoom, addSeat, pickCharacter, startGame, persistRoom, seatForToken, presenceOf, reclaimSeat } from "./rooms.js";
import { redact } from "./redact.js";
import { applyAction } from "./actions.js";
import { scheduleBots, addBot, removeBot } from "./bots.js";
import * as T from "./protocol.js";

function send(ws, type, data) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type, ...data }));
}

function lobbySeats(room) {
  return room.seats.map((s) => ({ name: s.name, characterId: s.characterId, isBot: !!s.isBot, botLevel: s.botLevel }));
}

// Each seat is also told its own index, because removing a computer player
// from the lobby moves the seats after it up by one.
function broadcastLobby(room) {
  const seats = lobbySeats(room);
  room.seats.forEach((seat, seatIndex) => { if (seat.ws) send(seat.ws, T.LOBBY_UPDATE, { code: room.code, seats, seatIndex }); });
  broadcastPresence(room);
}

/** Lets any computer players at this table take their next move (see bots.js). */
export function kickBots(room, graph) {
  scheduleBots(room, graph, () => broadcastState(room));
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
          // Typing the room code and the SAME name again gives a disconnected
          // player their old seat back (and a new token); see reclaimSeat().
          const back = await reclaimSeat(room, msg.name, ws);
          if (back) {
            detach();
            ws._identity = { code: room.code, seatIndex: back.seatIndex };
            send(ws, T.RESUMED, {
              code: room.code, seatIndex: back.seatIndex, seats: lobbySeats(room),
              state: redact(room.state, back.seatIndex), online: presenceOf(room), token: back.token,
            });
            broadcastPresence(room);
            break;
          }
          if (room.state) throw new Error("that game has already started — to rejoin, enter the room code and exactly the name you played under (and that seat must be disconnected)");
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
          kickBots(room, graph);
          break;
        }
        case T.ADD_BOT: {
          const { room, seatIndex } = requireSeat();
          if (seatIndex !== 0) throw new Error("only the player who created the room can add computer players");
          await addBot(room, msg.level);
          broadcastLobby(room);
          break;
        }
        case T.REMOVE_BOT: {
          const { room, seatIndex } = requireSeat();
          if (seatIndex !== 0) throw new Error("only the player who created the room can remove computer players");
          await removeBot(room, Number(msg.seatIndex));
          broadcastLobby(room);
          break;
        }
        case T.ACTION: {
          const { room, seatIndex } = requireSeat();
          if (!room.state) throw new Error("the game hasn't started yet");
          applyAction(room.state, graph, seatIndex, msg.name, msg.args);
          await persistRoom(room); // durable before the table hears about it — a crash right after still remembers this move
          broadcastState(room);
          kickBots(room, graph);
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
