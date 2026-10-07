// The one place per-player secrecy is enforced. Everything reachable from the
// state object is public to every seat *except* what's listed here — nothing
// is ever filtered in the browser, only here, before a message leaves the
// server for a given socket.
//
//   board    — never sent at all; the client already has its own copy from
//              fetch("data/board.json"), so resending ~70KB on every move
//              would be pure waste.
//   seed     — server-internal replay info, not gameplay-relevant to anyone.
//   leftover — the undealt remainder of the deck; secret from every player,
//              including the recipient.
//   hand     — secret per player; everyone except the recipient gets a count.
export function redact(state, forSeatIndex) {
  if (!state) return null;
  const { board, seed, leftover, ...rest } = state;
  return {
    ...rest,
    players: state.players.map((p, i) => (
      i === forSeatIndex ? p : { ...p, hand: undefined, handCount: p.hand.length }
    )),
  };
}
