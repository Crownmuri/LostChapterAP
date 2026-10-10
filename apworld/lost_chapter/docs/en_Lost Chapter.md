# Lost Chapter

## Where is the options page?

The [player options page for this game](../player-options) contains all the options you need to configure and export
a config file.

## What does randomization do to this game?

Floor events are locked. Every floor is a fight until you receive event unlocks; from then on each floor lets you
pick between a battle and two events rolled from all the events of the game. The ones you have not unlocked are
grayed out. You start with a few events unlocked: two
random ones by default, which the `starting_event_count` and `starting_events` options change.

Each Heavenly King needs his door key, his door is grayed out without it. Every 20th floor leads to the doors, and
the climb only goes on once a king is defeated there. Until then the doors let you turn back, which repeats the
last 20 floors. From floor 100 on, with all four kings defeated, the doors let you pick freely every 20 floors:
any king again, the final boss, or keep going without a fight.

Relics normally handed out by events are shuffled into the multiworld. Finding one in an event sends a check instead,
and the relic arrives when someone finds it for you. Received relics are kept between runs.

Meeting the condition of a title sends a check. To release the title in the Title Collection and get its reward
you also need its Unlock Title Effect item; the Title Collection says so under the title's description until you
have it. With the `shuffle_title_effects` option off those items do not exist and titles release as in the normal
game.

A run starts on the standby screen, and the opening questions are replaced by a list of the nine origins.

The bonus shop is gone. Starting sets (Boxer, Fighter, Mage, Knight, Merchant, Succubus) are items instead:
once received, a set can be picked at the start of each run.

Souls, the score the bonus shop used to spend, are counted from 0 in every run and send checks at milestones. The
screen between floors shows your total.

The game counts as cleared from the start, so defeating the last boss does not end it. The climb continues and
the remaining checks stay reachable.

## What is the goal?

Defeating the last boss, which needs all four Heavenly Kings defeated first. The `goal` option picks one of:

- `normal_end`: any win over the last boss.
- `true_end`: a win in a run that would get ENDING 1, which takes a climax count of 20 or less.
- `true_virgin`: the true end with the Virginity status intact.
- `dlc_end`: defeat Magislilia, the last boss of the DLC. She waits behind **The Last Door**, behind the hallway
  of a boss floor, once Migwarners (White Door, takes the White Key) and Bordosegeia (Black Door, takes the Black
  Key) are both defeated in the same run. Needs the `include_dlc` option.
- `dlc_virgin`: the DLC end with the Virginity status intact. Needs the `include_dlc` option.

With one of the two virgin goals, losing the Virginity status ends the run on the spot and the "Lose Virginity"
title check only holds filler. They have no story difference and are only there for those who want the challenge.

## Which locations are checks?

- Defeating each of the four Heavenly Kings
- Meeting the condition of each title
- The first victory against each regular enemy
- Reaching every 10th floor
- The first visit of each floor event
- Relics found in events
- Soul milestones, counted from 0 in every run

## Which items can be in another player's world?

Floor event unlocks, door keys, title effects, starting sets, relics and gold.
