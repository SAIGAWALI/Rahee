# RAHEE — AI play-test report

300 of 300 games completed in 9.2 s · 2–6 players · bots: greedy, goals, easy · budget ₹20,000 · seed 1

**No rule violations, stalls or refused moves.** Every move of every game was checked.

## A typical game

| | per game |
|---|---:|
| Rounds | 5.6 |
| Actions sent | 166.3 |
| Flights taken | 3.5 |
| Ship crossings | 0.3 |
| Road trips offered / taken | 1.7 / 3.8 |
| Invitations declined | 11% |
| Games ended by 5 destinations (rest: last card) | 23% |
| Ace swaps / reshuffles (all games) | 146 / 19 |

## A typical player

| | per player |
|---|---:|
| Final score | 61.7 |
| Stamps | 4.6 |
| Destinations completed | 2.4 |
| Completed all 5 | 10% |
| Memories | 4.6 |
| Money spent | ₹14,911 |
| Went over budget | 11% |

## Balance by character

Win rate is compared with a fair share (1 ÷ players at the table). Large gaps on many games suggest a character's destinations are easier or harder than the others'.

| Character | Seats | Win rate | Fair share | Avg score | Destinations | Stamps | Over budget |
|---|---:|---:|---:|---:|---:|---:|---:|
| Pilgrim | 191 | 25% | 26% | 63.5 | 2.2 | 4.5 | 10% |
| Conservationist | 225 | 25% | 26% | 64.3 | 2.3 | 4.6 | 10% |
| Riverkeeper | 188 | 32% | 25% | 60.6 | 2.8 | 4.8 | 8% |
| Musician | 214 | 30% | 26% | 69.6 | 2.8 | 4.7 | 10% |
| Historian | 175 | 28% | 24% | 48.7 | 2.2 | 4.6 | 21% |
| Explorer | 182 | 24% | 25% | 60.7 | 1.9 | 4.4 | 10% |

## By bot level

| Level | Seats | Win rate | Fair share | Avg score | Destinations | Stamps | Memories |
|---|---:|---:|---:|---:|---:|---:|---:|
| greedy | 387 | 52% | 25% | 104.0 | 2.9 | 6.4 | 6.5 |
| goals | 396 | 30% | 26% | 89.5 | 4.0 | 5.4 | 4.8 |
| easy | 392 | 0% | 26% | -8.2 | 0.2 | 2.1 | 2.4 |

## By number of players

| Players | Games | Rounds | Winner's score | Avg score | Ended by destinations |
|---:|---:|---:|---:|---:|---:|
| 2 | 66 | 6.1 | 90.7 | 56.5 | 15% |
| 3 | 60 | 5.8 | 105.3 | 57.7 | 25% |
| 4 | 65 | 5.4 | 111.6 | 61.2 | 12% |
| 5 | 51 | 5.7 | 128.6 | 70.5 | 49% |
| 6 | 58 | 4.9 | 118.5 | 59.6 | 19% |

---
Bots: "greedy" plans each turn for the most points, "goals" chases its character's destinations, "easy" plays random legal moves. They are a play-testing aid, not a model of how people play. Full per-game data: report.json.
