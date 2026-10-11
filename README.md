# Lost Chapter Archipelago

[Archipelago](https://archipelago.gg) integration for Lost Chapter (Steam app 2356470), base game without the DLC
and the separate patch.

## How it fits together

```
Archipelago server  <-- AP protocol -->  Lost Chapter Client  <-- ws://127.0.0.1:38472 -->  LostChapterAP.js
                                         (launcher component,                              (RPG Maker MZ plugin
                                          Universal Tracker tab)                            inside the game)
```

Lost Chapter is an RPG Maker MZ game running on NW.js with plain JSON data, so nothing is done through memory
editing. The game side is a regular MZ plugin that hooks switches, variables, battle victories and item gains and
reports them. Everything Archipelago-related lives in the Python client, which:

- adds a **Lost Chapter Client** button to the Archipelago Launcher,
- finds the install through the Steam registry and `appmanifest_2356470.acf`, installs the plugin into the game and
  launches it with `steam://rungameid/2356470`,
- uses Universal Tracker's client context when `tracker.apworld` is installed, for in-logic counts.

## Layout

| Path | What |
| --- | --- |
| `apworld/lost_chapter/world.py`, `options.py`, `data.py` | Generation: locations, items, options |
| `apworld/lost_chapter/client.py`, `gui.py` | Launcher client and its tab |
| `apworld/lost_chapter/bridge.py` | WebSocket server and the message protocol with the game |
| `apworld/lost_chapter/game_install.py` | Steam lookup, plugin install/uninstall, launch |
| `apworld/lost_chapter/game_plugin/LostChapterAP.js` | The in-game plugin (shipped inside the apworld) |
| `tools/build_apworld.py` | Packs `build/lost_chapter.apworld` |
| `docs/endings.md` | How the base game decides its endings |
| `tools/dump_events.py` | Regenerates `docs/events.md`: every floor event, its decisions and what they change |
| `tools/dump_game_data.py` | Dumps switch/variable/event outlines into `dump/` for reverse engineering |
| `tools/snapshot_game_data.py` | Copies the game's data files into `dump/<name>/`, one copy for each version of the game |
| `tools/check_patches.py` | Runs the plugin's data patches against every such copy and lists what failed |

AP ids are derived from the game's database ids (`data.py`), mirrored by the constants at the top of the plugin.

## Development

```
python tools/build_apworld.py --install "D:\Games\Randomizer\Archipelago\custom_worlds"
```

Restart the launcher, open **Lost Chapter Client**, connect to a multiworld, then type `/run` (it installs
the plugin if needed). `yaml/Lost Chapter.yaml` is a ready-made player file for testing.

To get the Chromium devtools (F12) for plugin debugging, remove `--disable-devtools` from `chromium-args` in the
game's `package.json`.

### Dev mode

Set `lost_chapter_options.dev_mode: true` in `host.yaml`, then type `/dev help` in the client while the game is
connected. The same commands work in the game's console as `LostChapterAP.dev("floor 19")`.

| Command | Effect |
| --- | --- |
| `/dev floor N` | Set the current floor. The next floor is N + 1, so `floor 19` puts a boss floor next |
| `/dev event NAME` | Force the next floor's event (name, common event id, or `fight`) |
| `/dev gold N`, `/dev heal` | Set gold, restore LP and RP |
| `/dev souls N` | Set the souls there are to spend |
| `/dev next` | Leave the standby screen, as a click on it does |
| `/dev stuck` | What the game is doing right now, for a screen that takes no input |
| `/dev stat NAME N` | Set `maxlp`, `maxrp`, `str`, `def`, `mag`, `agl`, `faith`, `virtue` or `lewd` |
| `/dev card NAME [COUNT]`, `/dev relic NAME [COUNT]` | Give a card or relic, a negative count takes it away |
| `/dev title N` | Meet the condition of title N |
| `/dev unlock` | Own every event, boss, title effect and card set unlock on this save |
| `/dev var ID [VALUE]`, `/dev switch ID [on\|off]` | Read or write a game variable or switch |
| `/dev god [on\|off]` | LP and RP cannot go down |
| `/dev speed N` | Game speed 1-4 |

The game ships without the developer console, so the plugin keeps a log of each session in
`archipelago_log.txt` in the game folder: errors of the game, the plugin's own messages, the standby trace and
what the dev commands answered. It starts anew with every launch.

Setting the floor, a title or a switch sends the matching checks like normal play would.

Speed needs no dev mode: F7 in the game toggles 1x and 2x, and `/speed N` in the client sets 1-4.

## Game notes

Everything the game does runs through common events, switches and variables:

| Thing | Where |
| --- | --- |
| Current floor | variable 11, advanced in common event 86. Every 20th floor is a Heavenly King |
| Heavenly Kings defeated | switches 71-74, count in variable 68 (common event 63) |
| Game cleared / TRUE END | switches 1 / 200, set by the ending (Map011). With switch 1 on, common event 64 continues the climb after the last boss instead of rolling the ending. Map011 plays the TRUE END unless the climax count (variable 232) is 21 or more |
| New run | Map003 (title) runs common event 430, then goes to the bonus shop (Map008) from the second playthrough on (variable 67), otherwise to the opening (Map001) |
| Titles | common event 420 hands out armor n when the condition of title n is met. Releasing it in the Title Collection (common event 400+n) grants the reward and sets switch 200+n. Reset every run |
| Origin ("You are a...") | variable 2 (1-9), asked and applied by Map001 |
| Run start | Map004 (first playthrough) or Map006 calls common event 86 |
| Standby screen | common event 11 "Next Floor" turns on switch 87 |
| Quest chain flags | switches 271-290, set by the floor events (common events 21-61) |
| Regular fights | common event 65, troops 1-21 |
| Bonus shop | Map009, executes common event 418 with the bonus id in variable 85 |
| Bonus ids | 1-22 small boosts (stats, regen, gold, single cards, states). 101-106 starting sets of three cards: Boxer, Fighter, Mage, Knight, Merchant, Succubus. 108-116 rich bonuses: passive flags (switches 231-235), all stats +2, LP/RP +20, LEWD +10 |
| Souls (score) | common event 72 computes the score of the run into variable 77. Game over (common event 66) adds it to the shop currency, variable 292 |
| Forget-Me-Not | weapon 74 with its count in variable 74. Removes a card, usable from the standby screen |
| New run reset | common event 430 "---Game Initialization---" |

## Status

Generates and fills; the client, installer and bridge are tested outside the game. The plugin is tested against the
real `CommonEvents.json` in a headless browser with a stubbed engine, but has not been run in the game yet.

Checks: Heavenly Kings, title conditions, first victories, every 10th floor, first visit of each floor event,
relics from events, soul milestones.

Items: floor event unlocks, door keys, title effects, card sets, relics, gold.

The plugin only acts in a session: the client's `/run` writes `archipelago_session.json`
into the game folder, and the plugin reads it at boot. In a session the game saves into `save_ap_<seed>_<slot>/`
instead of `save/`. Without the file (game started from Steam, or the client closed) the plugin changes nothing and
the normal save is used. The client removes the file when it closes.

Game changes in a session (the plugin patches the event data in memory at load, the game files stay untouched):

- Every floor is a fight until floor events are unlocked. Each floor rolls two of all the events it could hold
  and the player picks between Battle and those two; an event without its unlock is grayed out. The game's own conditions for an event still apply (floor 41+ for Locksmith,
  Corridor, Throne and Hill, torn clothes for the Seamstress, ...).
- The door of a Heavenly King is grayed out without his door key. Every boss floor leads to the hallway, and
  the doors also offer **Turn Back**, which repeats the last 20 floors: the climb only goes on once a king is
  defeated there.
- From floor 100 on (all four kings defeated) the doors are a free choice on every boss floor: fight any king
  again, fight the last boss (**Final Boss**), or **Keep Going** without a fight. Nothing has to be beaten again
  to climb further.
- Meeting the condition of a title sends its check. Releasing the title in the Title Collection, which is what
  grants the reward and counts for the row and column bonuses, also needs its Unlock Title Effect item (the Title Collection names it under the description while it is
  missing). The `shuffle_title_effects` option turns that off.
- A run starts on the standby screen at floor 1 instead of inside the first event.
- The game counts as cleared from the start. Defeating the last boss is the goal, and the climb continues
  afterwards (the Heavenly Kings come back, as in the game's own later laps) instead of rolling the ending.
  The Prison event is a normal event unlock and the Recollection menu is open.
- The bonus shop and its currency are skipped. Received card sets (Boxer Card Set, ...) are taken in the deck
  screen with the received cards, each once a run and for free.
- With the `battle_rewards` option each stretch of 20 floors up to `final_boss_floor` has that many battle reward
  checks (5 with the final boss on floor 160 are 40):
  while one is open, one of the three cards of a won fight is an Archipelago card (Shift shows what it sends),
  and taking it sends the check in place of a card.
- Souls are counted live with the game's own score formula, less what the run started with (the origin, the
  starting set and received relics are worth nothing, so every run starts at 0) and less what a received item or
  a card taken from the multiworld adds to it. The best score the current run reached, times the
  `soul_multiplier` option, is its souls: they add up over the runs of a seed and are spent in the soul shop, the last entry of the floor choice: a new set of floor
  events (10), a floor event of your choice among the unlocked ones (50), a Forget-Me-Not (150, two a run), a Pieris (300, one a run, DLC),
  10 LP or 10 RP (20 each). While the three cards of a won fight are up, W buys three other ones (20). The prices double with every 20 floors. Souls no longer send checks. The standby screen shows the total and the next milestone.
- A later run of a seed can start further up: once the floor after a boss floor was reached (21, 41, 61, ...),
  a new run asks which of those floors to start from. The bosses below it are not fought in that run.
- The soul shop also sells a Yellow Vial (50) that ends the Regression State, and "Back" in the floor choice
  returns to the standby screen with the same floor events.
- Next to the soul shop the floor choice has a Boon Shop with the boons of the game's bonus shop at fixed prices:
  Small Boons (200: stats, regen, FAITH and VIRTUE, "Acquired Gold +100 G"), Medium Boons (300: Gold +200,
  LEWD +5, Rare Drop Rate +3), Body (400), Combat (600: dealt damage +10%, received damage -10%) and Large Boons
  (800: all stats +2, Max LP or RP +20, LEWD +10, Double LEWD Rate). The four single cards of the bonus shop (Healing, Inspiration, Refresh, Psych Up) are items, bought into
  the deck for 100 G like the other received cards.
- `/offline` in the client launches the game with the plugin but nothing shuffled and no server: every floor event
  is open, relics and cards are where the game has them, and the game's own bonus shop is back (the Boons menu
  is left out). The origin questions, the doors of the boss floors, the last boss and the ending are the game's
  own too, and events are not revisited or reset. The floor choice, the soul shop, the card reroll and the
  choice effects stay. It has a save of its own (`save_ap_offline_0`).
- The "Once upon a time" questions are replaced by one list of the nine origins with their effects. The
  description and the Correct / Wrong confirmation are unchanged.

Logic: first visits need the event unlock, kings and their four titles need the door key, relics need their
source events, the ending needs all four door keys. Every boss floor passed takes one more door key: floors
21-40 need one, 41-60 two, 61-80 three, which also applies to the floor 41+ events and their relics. The titles about
FAITH, VIRTUE, LEWD and the stats need one of the events that move them (`TITLE_EVENTS` in `data.py`). Those and
the titles about cards are also only in logic from the floor they are expected by (`TITLE_FLOORS`): LEWD 15, 7 cards
in a turn, 15 cards, the stats over 30 and FAITH or VIRTUE 70 or more from floor 21, FAITH or VIRTUE 30 or less from
floor 41. Earlier is possible by taking the same events over and over, which is out of logic. A first victory
needs the floor its enemy first shows up on (`ENEMY_FLOORS`): three new enemies every 20 floors, the last six on
floors 101 and 121, which are past the last boss. How hard a fight is and the remaining titles have no rules yet.

Five pairs of events that start out alike share one unlock and one name in the floor choice (`EVENT_GROUPS`):
Desert (Desert, Desert 2), Temple (Goddess Temple, Devil Temple), Hot Spring (Hot Spring, Pond of Acid), Market
(Market, Market 2) and Small Room (Small Room, Small Room 2). Each event keeps its own first visit check, named after
what sets the two apart ("First Visit: Desert - Heal" and "First Visit: Desert - Trap", `EVENT_VISITS`), which is
sent when the event ends. A choice inside an event whose condition is not met is shown grayed out with what it
requires instead of being hidden.

### DLC

The plugin works on the game with and without its DLC: every patch is checked against a copy of the event data of
each version. `tools/snapshot_game_data.py` keeps such a copy in `dump/<name>/` and `tools/check_patches.py` runs
the plugin's patches against all of them. The DLC took the switches
261 and up for its quests, so the plugin's own scratch switches are 182-190 and 193, which neither version uses.

`include_dlc` adds the DLC to a seed:

- its eleven floor events (switches 161-171, common events 591-601, floor 41 and up), each with an unlock and a
  first visit,
- the first victories over Stubborn, Integrity and Transgression (floor 161 and up),
- "Defeat Migwarners" and "Defeat Bordosegeia", the bosses behind the White Door and the Black Door,
- the relics Old Iron Hammer, Memento Chisel, Crown of Forget-Me-Not and Crown of Pieris.

Without it the floor events of the DLC are not offered, whether it is installed or not. Which events and relics a
seed has travels in its slot data (`events`, `relics`), and the plugin reads the game's own conditions for offering
an event from common event 86, so both follow the installed version.

The White Door and the Black Door are at the doors of the kings for whoever holds the White Key or the Black Key,
and again behind the hallway. There the game opens them without a key and walks away once both bosses are
defeated, to start Magislilia on the next boss floor. In a multiworld the doors behind the hallway take their keys
too and Magislilia is a third door there (**The Last Door**). Defeating her is the `dlc_end` goal.

`shuffle_keys` (needs relicsanity) makes the two keys items, and having the Locksmith make one a check.

### The patch of the game

The game has a patch that restores content cut from the Steam release, one for the base game and one for the DLC.
The plugin is checked against all four combinations. The patch adds no events, enemies or relics, but it is what
makes the White Key possible: it gives two enemies a Regression Spell, and the Girl event hands the Moon Hair
Ornament to a player in that Regression State. Without the patch nothing in the game hands the
ornament out, so neither it nor the White Key can be had.

So that every version plays the same, the plugin has the girl hand the ornament out on any visit while its check
is open (`patchGirl`), adding the gift to the event where the game does not have it. The Moon Hair Ornament and
the White Key are relics like the others in every seed, and there is no option for the patch.

`finisher_move` decides about Kick Balls, the card drawn the turn after the enemy climaxes: `vanilla`, `shuffle`
(only once the useful item Kick Balls is found) or `remove`.

`field_exploration` (0 to 5, default 5) puts that many Progressive Field Exploration items into the pool. Each
adds a floor event to the two a floor lets you choose from. Logic expects one by floor 21, two by 41, three by 61,
four by 81 and five by 101; nothing in the game holds the climb up for them.

The choices of the floor events say what they do, in gray behind their text.

`death_link`: every game over is sent to the other DeathLink players, and a death of theirs ends your run, in the
fight that is on or before the next floor.

An event that plays one short scene from then on once its relic or card is found (Collapse, Amusement Center, Girl,
Battlefield, Cat, Throne) asks on every later visit instead: "Revisit Event" for that scene, "Reset Event" for the
event as it was before. Both choices say what they are worth.

A seed starts with `starting_event_count` floor events unlocked (2 by default), random ones from the first 40
floors on top of the ones named in `starting_events`.

## Roadmap

1. Run the plugin in the game and confirm each hook fires (devtools console, `/game` in the client).
2. The remaining shop bonuses as items (stats, regen, passive flags), applied at the start of every run.
3. An Archipelago inventory on the standby screen for consumable items such as Forget-Me-Nots (card removal),
   claimed when the player wants them instead of on arrival.
4. Rewards of event decisions (`docs/events.md`) as checks, with the reward moved into the item pool. Some as
   run-only items, some as permanent stat increases.
5. Map which enemies appear when and give first victories real rules. Decide whether the stat-based titles need
   rules.
6. Quest chain rewards beyond relics, using switches 271-290.
7. In-game notification for sent and received items.
8. DLC and the separate patch as YAML options.
