// Every gameplay action a seat can send, and the one check engine.js cannot
// make on its own: which seat may act. Shared by the WebSocket handler, the
// computer players (bots.js) and the play-test tools, so a bot's move takes
// exactly the same path as a human's.
import * as E from "../frontend/src/engine.js";
import * as T from "./protocol.js";

// name -> (state, graph, seatIndex, args) => void — mutates state in place.
export const ACTIONS = {
  layRoadTripCard: (s, g, seatIndex, a) => E.layRoadTripCard(s, seatIndex, a.cardId),
  playCard: (s, g, seatIndex, a) => E.playCard(s, { cardId: a.cardId, ace: a.ace ?? null }),
  stepTo: (s, g, seatIndex, a) => E.stepTo(s, g, a.cityId),
  undoStep: (s) => E.undoStep(s),
  endMovement: (s) => E.endMovement(s),
  offerRoadTrip: (s) => E.offerRoadTrip(s),
  offerTravelTogether: (s, g, seatIndex, a) => E.offerTravelTogether(s, { cardId: a.cardId, ace: a.ace ?? null }),
  proposeRoadTrip: (s, g, seatIndex, a) => E.proposeRoadTrip(s, g, { companions: a.companions, owner: a.owner, cardId: a.cardId, destination: a.destination }),
  // The responder is always the sending seat's own id, never a client-supplied
  // one — a player may only accept, counter, or decline for themselves. `a`
  // is passed through as-is: {type:"accept", stop} | {type:"counter", destination} | {type:"decline"}.
  respondRoadTrip: (s, g, seatIndex, a) => E.respondRoadTrip(s, g, seatIndex, a),
  confirmRoadTrip: (s) => E.confirmRoadTrip(s),
  cancelRoadTripInvite: (s) => E.cancelRoadTripInvite(s),
  // A rider may get off themselves, or the driver may drop them off.
  dropOff: (s, g, seatIndex, a) => {
    if (a.riderId !== seatIndex && E.currentPlayer(s).id !== seatIndex) throw new Error("only the rider or the driver can do that");
    return E.dropOff(s, a.riderId);
  },
  endRoadTrip: (s) => E.endRoadTrip(s),
  cancelRoadTrip: (s) => E.cancelRoadTrip(s),
  endTurn: (s) => E.endTurn(s),
  // A seat may pay for its own visit, and the active player may also click
  // "visit" on behalf of a road-trip companion (the shared-price button on the
  // driver's screen). The price itself is decided by the engine, never the client.
  visitTourist: (s, g, seatIndex, a) => {
    const target = a.playerId ?? seatIndex;
    if (target !== seatIndex && E.currentPlayer(s).id !== seatIndex) throw new Error("you can only pay for your own visit");
    return E.visitTourist(s, target);
  },
  // Ace setup rule — any seat, for itself, while cards are being laid.
  swapAce: (s, g, seatIndex, a) => E.swapAce(s, seatIndex, a.cardId),
  // A road-trip companion turning down the shared stamp — for themselves only.
  passVisit: (s, g, seatIndex) => E.passVisit(s, seatIndex),
  requestReshuffle: (s, g, seatIndex) => E.requestReshuffle(s, seatIndex),
};


/** Validates who may act, then applies one action to `state` in place. Throws on anything illegal. */
export function applyAction(state, graph, seatIndex, name, args = {}) {
  const fn = ACTIONS[name];
  if (!fn) throw new Error(`unknown action "${name}"`);
  if (T.TURN_GATED_ACTIONS.has(name) && E.currentPlayer(state).id !== seatIndex)
    throw new Error("it isn't your turn");
  fn(state, graph, seatIndex, args ?? {});
}
