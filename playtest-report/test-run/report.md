# RAHEE — AI play-test report

300 of 300 games completed in 9.7 s · 2–6 players · bots: greedy, goals, easy · budget ₹20,000 · seed 1

**No rule violations, stalls or refused moves.** Every move of every game was checked.

## A typical game

| | per game |
|---|---:|
| Rounds | 5.5 |
| Actions sent | 171.7 |
| Flights taken | 3.5 |
| Ship crossings | 0.3 |
| Road trips offered / taken | 2.1 / 3.1 |
| Invitations declined | 20% |
| Games ended by 5 destinations (rest: last card) | 32% |
| Ace swaps / reshuffles (all games) | 146 / 19 |

## A typical player

| | per player |
|---|---:|
| Final score | 65.2 |
| Stamps | 4.5 |
| Destinations completed | 2.4 |
| Completed all 5 | 14% |
| Memories | 5.0 |
| Money spent | ₹15,360 |
| Went over budget | 13% |

## Balance by character

Win rate is compared with a fair share (1 ÷ players at the table). Large gaps on many games suggest a character's destinations are easier or harder than the others'.

| Character | Seats | Win rate | Fair share | Avg score | Destinations | Stamps | Over budget |
|---|---:|---:|---:|---:|---:|---:|---:|
| Pilgrim | 191 | 25% | 26% | 66.1 | 2.3 | 4.5 | 12% |
| Conservationist | 225 | 24% | 26% | 66.2 | 2.3 | 4.5 | 9% |
| Riverkeeper | 188 | 38% | 25% | 70.0 | 2.9 | 4.7 | 13% |
| Musician | 214 | 29% | 26% | 69.6 | 2.9 | 4.5 | 11% |
| Historian | 175 | 27% | 24% | 57.4 | 2.2 | 4.5 | 23% |
| Explorer | 182 | 18% | 25% | 60.2 | 1.9 | 4.2 | 9% |

## By bot level

| Level | Seats | Win rate | Fair share | Avg score | Destinations | Stamps | Memories |
|---|---:|---:|---:|---:|---:|---:|---:|
| greedy | 387 | 48% | 25% | 106.5 | 3.0 | 6.1 | 7.0 |
| goals | 396 | 33% | 26% | 93.1 | 4.1 | 5.3 | 5.4 |
| easy | 392 | 0% | 26% | -3.9 | 0.2 | 2.2 | 2.6 |

## By number of players

| Players | Games | Rounds | Winner's score | Avg score | Ended by destinations |
|---:|---:|---:|---:|---:|---:|
| 2 | 66 | 6.1 | 90.5 | 56.3 | 15% |
| 3 | 60 | 5.7 | 108.0 | 65.1 | 30% |
| 4 | 65 | 5.3 | 120.0 | 67.0 | 31% |
| 5 | 51 | 5.5 | 137.7 | 71.5 | 51% |
| 6 | 58 | 4.7 | 125.3 | 62.6 | 40% |

---
Bots: "greedy" plans each turn for the most points, "goals" chases its character's destinations, "easy" plays random legal moves. They are a play-testing aid, not a model of how people play. Full per-game data: report.json.
