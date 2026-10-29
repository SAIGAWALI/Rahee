# RAHEE — AI play-test report

1000 of 1000 games completed in 24.1 s · 2–6 players · bots: greedy, goals, easy · budget ₹20,000 · seed 1

**No rule violations, stalls or refused moves.** Every move of every game was checked.

## A typical game

| | per game |
|---|---:|
| Rounds | 5.6 |
| Actions sent | 202.7 |
| Flights taken | 3.5 |
| Ship crossings | 0.2 |
| Road trips offered / taken | 7.5 / 6.1 |
| Invitations declined | 20% |
| Games ended by 5 destinations (rest: last card) | 13% |
| Ace swaps / reshuffles (all games) | 504 / 76 |

## A typical player

| | per player |
|---|---:|
| Final score | 98.2 |
| Stamps | 4.4 |
| Destinations completed | 1.8 |
| Completed all 5 | 5% |
| Memories | 9.7 |
| Money spent | ₹15,457 |
| Went over budget | 12% |

## Balance by character

Win rate is compared with a fair share (1 ÷ players at the table). Large gaps on many games suggest a character's destinations are easier or harder than the others'.

| Character | Seats | Win rate | Fair share | Avg score | Destinations | Stamps | Over budget |
|---|---:|---:|---:|---:|---:|---:|---:|
| Pilgrim | 695 | 22% | 26% | 94.9 | 1.8 | 4.4 | 11% |
| Conservationist | 757 | 27% | 25% | 100.7 | 1.7 | 4.4 | 8% |
| Riverkeeper | 656 | 29% | 25% | 103.3 | 2.2 | 4.6 | 13% |
| Musician | 716 | 25% | 25% | 99.5 | 2.2 | 4.4 | 12% |
| Historian | 594 | 25% | 24% | 91.9 | 1.6 | 4.3 | 16% |
| Explorer | 608 | 26% | 24% | 97.9 | 1.5 | 4.4 | 10% |

## By bot level

| Level | Seats | Win rate | Fair share | Avg score | Destinations | Stamps | Memories |
|---|---:|---:|---:|---:|---:|---:|---:|
| greedy | 1344 | 58% | 25% | 165.7 | 1.8 | 6.3 | 14.5 |
| goals | 1337 | 20% | 25% | 126.9 | 3.6 | 5.3 | 10.4 |
| easy | 1345 | 0% | 25% | 2.2 | 0.1 | 1.7 | 4.3 |

## By number of players

| Players | Games | Rounds | Winner's score | Avg score | Ended by destinations |
|---:|---:|---:|---:|---:|---:|
| 2 | 194 | 6.1 | 134.5 | 83.7 | 13% |
| 3 | 191 | 5.9 | 171.5 | 97.7 | 16% |
| 4 | 216 | 5.4 | 180.4 | 100.8 | 7% |
| 5 | 193 | 5.9 | 203.9 | 109.9 | 22% |
| 6 | 206 | 5.0 | 180.5 | 92.0 | 6% |

---
Bots: "greedy" plans each turn for the most points, "goals" chases its character's destinations, "easy" plays random legal moves. They are a play-testing aid, not a model of how people play. Full per-game data: report.json.
