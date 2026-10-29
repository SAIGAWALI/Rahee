# RAHEE — AI play-test report

300 of 300 games completed in 21.3 s · 2–6 players · bots: greedy, goals, easy · budget ₹20,000 · seed 1

**No rule violations, stalls or refused moves.** Every move of every game was checked.

## A typical game

| | per game |
|---|---:|
| Rounds | 5.7 |
| Actions sent | 196.4 |
| Flights taken | 3.4 |
| Ship crossings | 0.2 |
| Road trips offered / taken | 7.2 / 5.8 |
| Invitations declined | 21% |
| Games ended by 5 destinations (rest: last card) | 9% |
| Ace swaps / reshuffles (all games) | 146 / 19 |

## A typical player

| | per player |
|---|---:|
| Final score | 95.9 |
| Stamps | 4.4 |
| Destinations completed | 1.8 |
| Completed all 5 | 4% |
| Memories | 9.6 |
| Money spent | ₹15,417 |
| Went over budget | 12% |

## Balance by character

Win rate is compared with a fair share (1 ÷ players at the table). Large gaps on many games suggest a character's destinations are easier or harder than the others'.

| Character | Seats | Win rate | Fair share | Avg score | Destinations | Stamps | Over budget |
|---|---:|---:|---:|---:|---:|---:|---:|
| Pilgrim | 191 | 23% | 26% | 91.0 | 1.8 | 4.2 | 10% |
| Conservationist | 225 | 31% | 26% | 103.5 | 1.8 | 4.5 | 8% |
| Riverkeeper | 188 | 27% | 25% | 96.1 | 2.1 | 4.5 | 12% |
| Musician | 214 | 29% | 26% | 103.0 | 2.2 | 4.5 | 7% |
| Historian | 175 | 24% | 24% | 84.7 | 1.6 | 4.3 | 22% |
| Explorer | 182 | 25% | 25% | 93.5 | 1.5 | 4.2 | 13% |

## By bot level

| Level | Seats | Win rate | Fair share | Avg score | Destinations | Stamps | Memories |
|---|---:|---:|---:|---:|---:|---:|---:|
| greedy | 387 | 58% | 25% | 161.6 | 1.8 | 6.2 | 14.3 |
| goals | 396 | 22% | 26% | 126.0 | 3.5 | 5.2 | 10.3 |
| easy | 392 | 0% | 26% | 0.6 | 0.2 | 1.7 | 4.2 |

## By number of players

| Players | Games | Rounds | Winner's score | Avg score | Ended by destinations |
|---:|---:|---:|---:|---:|---:|
| 2 | 66 | 6.1 | 129.2 | 83.6 | 11% |
| 3 | 60 | 5.9 | 174.7 | 97.5 | 8% |
| 4 | 65 | 5.5 | 177.6 | 98.8 | 5% |
| 5 | 51 | 5.9 | 199.0 | 107.6 | 20% |
| 6 | 58 | 4.9 | 177.5 | 88.9 | 3% |

---
Bots: "greedy" plans each turn for the most points, "goals" chases its character's destinations, "easy" plays random legal moves. They are a play-testing aid, not a model of how people play. Full per-game data: report.json.
