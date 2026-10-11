# Endings in the base game

Read from the event data (common events 62-64, 86, 493-499, troop 30, Map005, Map011), not from play. Where the
randomizer changes something it says so at the end.

## Getting to the last boss

1. Every 20th floor is a boss floor (common event 86).
2. On a boss floor the player picks a door, one per Heavenly King still alive (common event 63):

   | Door | Heavenly King | Switch |
   | --- | --- | --- |
   | Crimson | Granisso | 71 |
   | Azure | Orgenbein | 72 |
   | Emerald | Hielohude | 73 |
   | Gold | Spisnix | 74 |

3. Once all four are defeated, the next boss floor is the last boss, Magisdusk (common event 64, troop 30). That is
   floor 100 at the earliest.

Losing to a boss is a normal game over. There is no other requirement to meet the last boss: no relic, title or
quest flag is checked.

## Which ending plays

One number decides it: the climax count of the run (variable 232, raised by 1 on every climax, reset at the start
of a run).

| Ending | Condition |
| --- | --- |
| ENDING 1 "Beyond the Blue Sky" | Climax count of 20 or less |
| ENDING 2 "Deeper Into the Darkness" | Climax count of 21 or more |

The count is read twice, with the same threshold:

- During the last battle, when Magisdusk falls to 80% LP (first clear only), common event 493 sets the "END 2"
  flag (switch 280). The flag changes Magisdusk's lines, the special card the player is handed in each phase and
  the boss's final move.
- On the ending map (Map011), which picks the ending to show.

The count can still change between the two, so they can disagree in theory.

Both endings set "game cleared" (switch 1). Only ENDING 1 also sets "TRUE END seen" (switch 200).

Defeating Magisdusk while still having the Virginity state gives a separate Steam achievement. It does not change
the ending.

## After the first clear

With "game cleared" on:

- Defeating Magisdusk no longer rolls an ending. The run continues as a new lap: the four Heavenly Kings come back,
  Max LP and Max RP go up by 10, and the next last boss is four boss floors later.
- Magisdusk's introduction and the scripted phases of the first fight are skipped.
- The Prison floor event can appear (floor 41 and later).
- Recollection opens on the title screen.
- A new run goes through the bonus shop first.

## Seeing ENDING 1 after an ENDING 2 clear

The last boss never rolls an ending again, so the game has a second way in. It only exists while "TRUE END seen" is
still off:

1. Prison (cleared saves only) starts the Monster quest (switch 275).
2. Sea, with that quest active, finishes it (switch 276, VIRTUE +20) and offers "Leave This World".
3. Leaving goes to the ending map, which again picks by the climax count of the current run.

## In the randomizer

- The plugin keeps "game cleared" on from the start, so no ending ever rolls from the last boss and every run is in
  the lap state described above.
- The goal is sent when Magisdusk is defeated. `goal: normal_end` accepts any win. `goal: true_end` needs a win
  with a climax count of 20 or less. `goal: dlc_end` is a win over Magislilia. With `virgin_run: true` the win
  also needs the Virginity state intact, whichever goal it is. Losing the state then sets LP to 0, so the run
  ends the way it does without LP, and the "Lose Virginity" title check only ever holds filler.
- The Sea route still works and plays an ending, but it does not count as the goal.
