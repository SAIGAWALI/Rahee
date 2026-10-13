// Owns the one WebSocket connection to the server, keeps it alive, and turns the
// gameplay actions main.js used to call on engine.js directly into one uniform
// `action(name, args)` message, mirroring backend/protocol.js's envelope.
//
// Staying in the game when the connection goes away:
//  - On creating or joining a room the server hands this page a secret seat
//    token. It is kept in sessionStorage (a reload keeps it, closing the tab forgets it) and never reaches main.js.
//  - Every time a socket opens and a saved seat exists, the first thing sent is
//    {type:"resume"}; the server answers "resumed" (with the lobby or the current
//    game, exactly as that seat should see it) or "resume_failed".
//  - If the socket closes for any reason except being taken over by another
//    window, it is reopened by itself with a growing delay — and straight away
//    when the network returns or the tab is shown again.
//
import { SERVER_URL } from "./config.js";

const SESSION_KEY = "rahee.session"; // {code, token}
const REPLACED = 4001;               // backend/protocol.js: REPLACED_CLOSE_CODE

let ws = null;
let handlers = {};
let wantOpen = false; // false once the player has left on purpose, or been replaced
let attempt = 0;
let timer = null;

// The seat token is kept in sessionStorage: it survives a page reload (so a
// refresh puts the player straight back in their seat) but is forgotten when the
// tab or browser is closed. Someone who closes the page and comes back lands on
// the start page and gets their seat back deliberately, by typing the room code
// and the same name again (see "join_room" in backend/handlers.js).
// sessionStorage can throw (privacy modes) - the game still works without it,
// a reload just can't rejoin by itself.
function readSession() {
  try {
    const s = JSON.parse(sessionStorage.getItem(SESSION_KEY));
    return s && typeof s.code === "string" && typeof s.token === "string" ? s : null;
  } catch { return null; }
}
function writeSession(s) { try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(s)); } catch { /* ignore */ } }
export function clearSession() { try { sessionStorage.removeItem(SESSION_KEY); } catch { /* ignore */ } }
export const hasSession = () => readSession() !== null;

export function connect(h) {
  handlers = h;
  wantOpen = true;
  attempt = 0;
  open();
}

/** Open a socket now (used after being replaced by another window, when the player chooses to take the seat back). */
export function reconnect() {
  wantOpen = true;
  attempt = 0;
  open();
}

/** Leave for good: forget the seat and close the socket without reconnecting. */
export function leave() {
  wantOpen = false;
  clearTimeout(timer);
  timer = null;
  clearSession();
  const sock = ws;
  ws = null;
  sock?.close();
}

function open() {
  clearTimeout(timer);
  timer = null;
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;

  const sock = new WebSocket(SERVER_URL);
  ws = sock;
  sock.addEventListener("open", () => {
    if (ws !== sock) return;
    attempt = 0;
    const session = readSession();
    if (session) sock.send(JSON.stringify({ type: "resume", code: session.code, token: session.token }));
    handlers.onOpen?.({ resuming: !!session });
  });
  // "error" is always followed by "close", so only "close" needs handling.
  sock.addEventListener("close", (ev) => {
    if (ws !== sock) return; // a socket we already replaced or left
    ws = null;
    handlers.onClose?.();
    if (ev.code === REPLACED) { wantOpen = false; handlers.onReplaced?.(); return; }
    if (wantOpen) scheduleReconnect();
  });
  sock.addEventListener("message", (ev) => {
    if (ws !== sock) return;
    const { token, ...msg } = JSON.parse(ev.data); // the token stays in here
    if (msg.type === "room_created") { writeSession({ code: msg.code, token }); handlers.onRoomCreated?.(msg); }
    else if (msg.type === "joined") { writeSession({ code: msg.code, token }); handlers.onJoined?.(msg); }
    else if (msg.type === "resumed") { if (token) writeSession({ code: msg.code, token }); handlers.onResumed?.(msg); }
    else if (msg.type === "resume_failed") { clearSession(); handlers.onResumeFailed?.(msg); }
    else if (msg.type === "presence") handlers.onPresence?.(msg.online);
    else if (msg.type === "lobby_update") handlers.onLobby?.(msg);
    else if (msg.type === "state") handlers.onState?.(msg.state);
    else if (msg.type === "error") handlers.onError?.(msg);
  });
}

function scheduleReconnect() {
  if (timer) return;
  const delay = Math.min(500 * 2 ** attempt, 8000) + Math.random() * 300;
  attempt++;
  timer = setTimeout(open, delay);
}

// Don't wait out the backoff when there is a good reason to think we can connect now.
function nudge() {
  if (wantOpen && !ws) { attempt = 0; open(); }
}
addEventListener("online", nudge);
document.addEventListener("visibilitychange", () => { if (!document.hidden) nudge(); });

/** Sends one message; false if there is no open connection to send it on. */
function send(obj) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return false;
  ws.send(JSON.stringify(obj));
  return true;
}

export const createRoom = (name) => send({ type: "create_room", name });
export const joinRoom = (code, name) => send({ type: "join_room", code, name });
export const pickCharacter = (characterId) => send({ type: "pick_character", characterId });
export const startGame = () => send({ type: "start_game" });
export const action = (name, args) => send({ type: "action", name, args });
