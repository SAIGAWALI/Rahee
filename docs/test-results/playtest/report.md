# RAHEE — AI play-test report

1000 of 1000 games completed in 47.1 s · 2–6 players · bots: greedy, goals, easy · budget ₹20,000 · seed 1

**No rule violations, stalls or refused moves.** Every move of every game was checked.

## A typical game

| | per game |
|---|---:|
| Rounds | 5.6 |
| Actions sent | 171.4 |
| Flights taken | 3.5 |
| Ship crossings | 0.2 |
| Road trips offered / taken | 1.8 / 4.1 |
| Invitations declined | 12% |
| Games ended by 5 destinations (rest: last card) | 25% |
| Ace swaps / reshuffles (all games) | 504 / 76 |

## A typical player

| | per player |
|---|---:|
| Final score | 63.1 |
| Stamps | 4.7 |
| Destinations completed | 2.4 |
| Completed all 5 | 10% |
| Memories | 4.5 |
| Money spent | ₹14,769 |
| Went over budget | 12% |

## Balance by character

Win rate is compared with a fair share (1 ÷ players at the table). Large gaps on many games suggest a character's destinations are easier or harder than the others'.

| Character | Seats | Win rate | Fair share | Avg score | Destinations | Stamps | Over budget |
|---|---:|---:|---:|---:|---:|---:|---:|
| Pilgrim | 695 | 25% | 26% | 63.7 | 2.3 | 4.5 | 9% |
| Conservationist | 757 | 24% | 25% | 64.9 | 2.3 | 4.6 | 10% |
| Riverkeeper | 656 | 37% | 25% | 67.7 | 2.8 | 5.0 | 10% |
| Musician | 716 | 28% | 25% | 66.1 | 2.7 | 4.6 | 12% |
| Historian | 594 | 25% | 24% | 52.7 | 2.2 | 4.9 | 19% |
| Explorer | 608 | 23% | 24% | 62.0 | 1.9 | 4.6 | 10% |

## By bot level

| Level | Seats | Win rate | Fair share | Avg score | Destinations | Stamps | Memories |
|---|---:|---:|---:|---:|---:|---:|---:|
| greedy | 1344 | 52% | 25% | 103.9 | 3.0 | 6.4 | 6.4 |
| goals | 1337 | 29% | 25% | 90.7 | 4.0 | 5.5 | 4.8 |
| easy | 1345 | 0% | 25% | -5.0 | 0.2 | 2.1 | 2.3 |

## By number of players

| Players | Games | Rounds | Winner's score | Avg score | Ended by destinations |
|---:|---:|---:|---:|---:|---:|
| 2 | 194 | 6.1 | 93.6 | 57.9 | 19% |
| 3 | 191 | 5.9 | 107.3 | 60.0 | 27% |
| 4 | 216 | 5.4 | 111.6 | 63.6 | 17% |
| 5 | 193 | 5.7 | 129.0 | 69.5 | 50% |
| 6 | 206 | 4.9 | 115.2 | 61.0 | 14% |

---
Bots: "greedy" plans each turn for the most points, "goals" chases its character's destinations, "easy" plays random legal moves. They are a play-testing aid, not a model of how people play. Full per-game data: report.json.
