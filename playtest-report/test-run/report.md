# RAHEE — AI play-test report

300 of 300 games completed in 12.7 s · 2–6 players · bots: greedy, goals, easy · budget ₹20,000 · seed 1

**No rule violations, stalls or refused moves.** Every move of every game was checked.

## A typical game

| | per game |
|---|---:|
| Rounds | 5.5 |
| Actions sent | 222.0 |
| Flights taken | 3.7 |
| Ship crossings | 0.3 |
| Road trips offered / taken | 5.3 / 6.7 |
| Invitations declined | 43% |
| Games ended by 5 destinations (rest: last card) | 20% |
| Ace swaps / reshuffles (all games) | 146 / 19 |

## A typical player

| | per player |
|---|---:|
| Final score | 97.3 |
| Stamps | 5.6 |
| Destinations completed | 2.0 |
| Completed all 5 | 7% |
| Memories | 8.6 |
| Money spent | ₹16,554 |
| Went over budget | 16% |

## Balance by character

Win rate is compared with a fair share (1 ÷ players at the table). Large gaps on many games suggest a character's destinations are easier or harder than the others'.

| Character | Seats | Win rate | Fair share | Avg score | Destinations | Stamps | Over budget |
|---|---:|---:|---:|---:|---:|---:|---:|
| Pilgrim | 191 | 24% | 26% | 96.5 | 1.8 | 5.5 | 13% |
| Conservationist | 225 | 24% | 26% | 100.4 | 1.8 | 5.5 | 16% |
| Riverkeeper | 188 | 28% | 25% | 100.0 | 2.3 | 5.6 | 14% |
| Musician | 214 | 35% | 26% | 110.0 | 2.5 | 5.8 | 14% |
| Historian | 175 | 27% | 24% | 79.3 | 1.8 | 5.6 | 27% |
| Explorer | 182 | 21% | 25% | 93.8 | 1.6 | 5.2 | 10% |

## By bot level

| Level | Seats | Win rate | Fair share | Avg score | Destinations | Stamps | Memories |
|---|---:|---:|---:|---:|---:|---:|---:|
| greedy | 387 | 52% | 25% | 157.4 | 1.9 | 7.1 | 12.8 |
| goals | 396 | 28% | 26% | 133.4 | 3.8 | 6.7 | 9.3 |
| easy | 392 | 0% | 26% | 1.4 | 0.2 | 2.9 | 3.8 |

## By number of players

| Players | Games | Rounds | Winner's score | Avg score | Ended by destinations |
|---:|---:|---:|---:|---:|---:|
| 2 | 66 | 6.0 | 124.8 | 79.7 | 18% |
| 3 | 60 | 5.8 | 169.8 | 100.2 | 15% |
| 4 | 65 | 5.4 | 177.2 | 103.7 | 11% |
| 5 | 51 | 5.7 | 192.2 | 104.5 | 39% |
| 6 | 58 | 4.8 | 172.8 | 92.3 | 22% |

---
Bots: "greedy" plans each turn for the most points, "goals" chases its character's destinations, "easy" plays random legal moves. They are a play-testing aid, not a model of how people play. Full per-game data: report.json.
