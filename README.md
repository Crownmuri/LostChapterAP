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
| `tools/dump_game_data.py` | Dumps switch/variable/event outlines into `dump/` for reverse engineering |

AP ids are derived from the game's database ids (`data.py`), mirrored by the constants at the top of the plugin.

## Development

```
python tools/build_apworld.py --install "D:\Games\Randomizer\Archipelago\custom_worlds"
```

Restart the launcher, open **Lost Chapter Client**, press **Install plugin**, then **Launch game (Steam)**.

To get the Chromium devtools (F12) for plugin debugging, remove `--disable-devtools` from `chromium-args` in the
game's `package.json`.

## Game notes

Everything the game does runs through common events, switches and variables:

| Thing | Where |
| --- | --- |
| Current floor | variable 11, advanced in common event 86. Every 20th floor is a Heavenly King |
| Heavenly Kings defeated | switches 71-74, count in variable 68 (common event 63) |
| Ending / TRUE END | switches 1 / 200, set by Map011 |
| Titles | common event 420 hands out armor n when the condition of title n is met. Releasing it in the Title Collection (common event 400+n) grants the reward and sets switch 200+n. Reset every run |
| Origin ("You are a...") | variable 2 (1-9), asked and applied by Map001 |
| Run start | Map004 (first playthrough) or Map006 calls common event 86 |
| Standby screen | common event 11 "Next Floor" turns on switch 87 |
| Quest chain flags | switches 271-290, set by the floor events (common events 21-61) |
| Regular fights | common event 65, troops 1-21 |
| Bonus shop | Map009, executes common event 418 with the bonus id in variable 85 |
| Bonus ids | 1-22 stat/card boosts, 101-116 starter packs and passive flags (switches 231-235) |
| New run reset | common event 430 "---Game Initialization---" |

## Status

Generates and fills; the client, installer and bridge are tested outside the game. The plugin is tested against the
real `CommonEvents.json` in a headless browser with a stubbed engine, but has not been run in the game yet.

Checks: Heavenly Kings, title conditions, first victories, every 10th floor, first visit of each floor event,
relics from events.

Items: floor event unlocks, boss unlocks, title effects, relics, gold.

Game changes on a save bound to a multiworld (the plugin patches the event data in memory at load, the game files
stay untouched and other saves play as usual):

- Every floor is a fight until floor events are unlocked. With unlocked events the player picks between Battle and
  up to two random unlocked events. The game's own conditions for an event still apply (floor 41+ for Locksmith,
  Corridor, Throne and Hill, torn clothes for the Seamstress, ...).
- The door of a Heavenly King only shows with his boss unlock. A boss floor with no available king is played as a
  normal floor. The last boss still appears once all four are defeated.
- Meeting the condition of a title sends its check. Releasing the title in the Title Collection, which is what
  grants the reward and counts for the row and column bonuses, also needs its title effect item.
- A run starts on the standby screen at floor 1 instead of inside the first event.
- The "Once upon a time" questions are replaced by one list of the nine origins with their effects. The
  description and the Correct / Wrong confirmation are unchanged.

Logic: first visits need the event unlock, kings and their four titles need the boss unlock, relics need their
source events, the ending needs all four boss unlocks. Fights, floors and the other titles have no rules yet.

## Roadmap

1. Run the plugin in the game and confirm each hook fires (devtools console, `/game` in the client).
2. Bonuses as items: an AP item sets variable 85 and runs common event 418 at the start of every run, replacing the
   bonus shop (Map009) and its currency.
3. Map which enemies appear when and give first victories real rules. Decide whether the stat-based titles need
   rules.
4. Quest chain rewards beyond relics, using switches 271-290.
5. In-game notification for sent and received items.
6. DLC and the separate patch as YAML options.
