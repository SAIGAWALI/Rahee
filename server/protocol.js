// Message type names shared by client and server. Kept as plain string
// constants (not an enum library) to match the rest of the project's
// zero-dependency style.

// client -> server
export const CREATE_ROOM = "create_room";
export const JOIN_ROOM = "join_room";
export const PICK_CHARACTER = "pick_character";
export const START_GAME = "start_game";
export const ACTION = "action";

// server -> client
export const ROOM_CREATED = "room_created";
export const JOINED = "joined";
export const LOBBY_UPDATE = "lobby_update";
export const STATE = "state";
export const ERROR = "error";

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
export const OPEN_ACTIONS = new Set(["visitTourist", "dropOff", "respondRoadTrip"]);
