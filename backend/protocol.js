// Message type names shared by client and server. Kept as plain string
// constants (not an enum library) to match the rest of the project's
// zero-dependency style.

// client -> server
export const CREATE_ROOM = "create_room";
export const JOIN_ROOM = "join_room";
export const PICK_CHARACTER = "pick_character";
export const START_GAME = "start_game";
export const ACTION = "action";
// {type:"add_bot", level:"greedy"|"easy"} / {type:"remove_bot", seatIndex} — host only, lobby only.
export const ADD_BOT = "add_bot";
export const REMOVE_BOT = "remove_bot";
// {type:"resume", code, token} — a browser that already holds a seat (it was
// given a token when it created or joined the room) asks to be re-attached to it
// after a refresh, a dropped connection, or a server restart.
export const RESUME = "resume";

// server -> client
// room_created and joined are the ONLY messages that carry a seat's `token`, and
// each goes only to the seat it belongs to. The token is the seat's password:
// whoever presents it owns the seat, so it is never broadcast and never stored
// in the clear on the server (see rooms.js).
export const ROOM_CREATED = "room_created";
export const JOINED = "joined";
export const LOBBY_UPDATE = "lobby_update";
export const STATE = "state";
export const ERROR = "error";
// {type:"resumed", code, seatIndex, seats, state, online} — the answer to a
// successful resume: the same lobby list or (redacted) game state a seat would
// have been sent live, so the page can draw itself from this one message.
export const RESUMED = "resumed";
// {type:"resume_failed", reason} — unknown room, unknown token, or no token. All
// three get the same answer, so a guesser learns nothing about which rooms exist.
export const RESUME_FAILED = "resume_failed";
// {type:"presence", online:[bool per seat]} — who currently has a live connection.
export const PRESENCE = "presence";

// Close code used when a seat is taken over by a newer connection. Clients treat
// it as "don't reconnect on your own" — otherwise two windows would fight for the seat.
export const REPLACED_CLOSE_CODE = 4001;

// The gameplay actions a client may send inside `{type: "action", name, args}`.
// One entry per src/engine.js mutator that main.js used to call directly.
// Turn-gated ones may only be sent by the seat whose turn it currently is;
// engine.js itself performs every other legality check and throws on misuse.
export const TURN_GATED_ACTIONS = new Set([
  "layRoadTripCard", "playCard", "stepTo", "undoStep", "endMovement",
  "offerRoadTrip", "proposeRoadTrip", "cancelRoadTripInvite", "confirmRoadTrip", "endRoadTrip", "endTurn",
]);
// visitTourist, dropOff and respondRoadTrip are actions any seated player may
// send for themselves — engine.js validates the target itself (touristHere,
// rider lookup, or that the responder was actually invited).
export const OPEN_ACTIONS = new Set(["visitTourist", "dropOff", "respondRoadTrip", "swapAce", "requestReshuffle"]);
