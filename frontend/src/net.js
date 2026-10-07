// Owns the one WebSocket connection to the server and turns the gameplay
// actions main.js used to call on engine.js directly into one uniform
// `action(name, args)` message, mirroring backend/protocol.js's envelope.
import { SERVER_URL } from "./config.js";

let ws = null;

export function connect(handlers) {
  ws = new WebSocket(SERVER_URL);
  ws.addEventListener("open", () => handlers.onOpen?.());
  ws.addEventListener("close", () => handlers.onClose?.());
  ws.addEventListener("error", () => handlers.onClose?.());
  ws.addEventListener("message", (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.type === "room_created") handlers.onRoomCreated?.(msg);
    else if (msg.type === "joined") handlers.onJoined?.(msg);
    else if (msg.type === "lobby_update") handlers.onLobby?.(msg);
    else if (msg.type === "state") handlers.onState?.(msg.state);
    else if (msg.type === "error") handlers.onError?.(msg);
  });
  return ws;
}

const send = (obj) => ws.send(JSON.stringify(obj));

export const createRoom = (name) => send({ type: "create_room", name });
export const joinRoom = (code, name) => send({ type: "join_room", code, name });
export const pickCharacter = (characterId) => send({ type: "pick_character", characterId });
export const startGame = () => send({ type: "start_game" });
export const action = (name, args) => send({ type: "action", name, args });
