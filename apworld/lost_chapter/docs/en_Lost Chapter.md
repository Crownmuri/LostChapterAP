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

- `ending_normal`: any win over the last boss, or freeing the Monster and leaving this world at the Sea.
- `ending_true`: the same in a run that would get ENDING 1, which takes a climax count of 20 or less. The standby
  screen and the tracker show the count.
- `dlc_normal`: defeat Magislilia, the last boss of the DLC. She waits behind **The Last Door**, behind the hallway
  of a boss floor, once Migwarners (White Door, takes the White Key) and Bordosegeia (Black Door, takes the Black
  Key) are both defeated in the same run. Needs the `include_dlc` option.
- `dlc_true`: defeat her in a run that gets ENDING 3 "Lost Chapter" and not ENDING 4. That takes one of LEWD of 20
  or less, VIRTUE of 70 or more, the Monster freed at the Sea, or the White Key used in the Corridor. The standby
  screen and the tracker say which ending the run would get.

The `virgin_mode` option adds to any of these that the Virginity status has to be intact. Losing it then ends the
run on the spot and the "Seed of Origin" title check (Lose Virginity) only holds filler. It has no story
difference and is only there for those who want the challenge.

## Which locations are checks?

- Defeating each of the four Heavenly Kings
- Meeting the condition of each title
- The first victory against each regular enemy
- Reaching every 10th floor
- The first visit of each floor event
- Relics found in events
- Soul milestones, counted from 0 in every run

## Which items can be in another player's world?

Floor event unlocks, door keys, title effects, card sets, relics and gold.
