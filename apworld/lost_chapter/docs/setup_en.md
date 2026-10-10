# Lost Chapter Setup Guide

## Required Software

- [Archipelago](https://github.com/ArchipelagoMW/Archipelago/releases) 0.6.7 or later
- Lost Chapter on Steam (Windows), without the DLC and the separate patch
- `lost_chapter.apworld`
- Optional: [Universal Tracker](https://github.com/FarisTheAncient/Archipelago/releases) for the in-logic counts in
  the client tab

## Installation

1. Double-click `lost_chapter.apworld` to install it, then restart the Archipelago Launcher.
2. Open **Lost Chapter Client** from the launcher.
3. Type `/patch` in the client (`/run` also does this when needed). This copies `LostChapterAP.js` into the game's `js/plugins`
   folder and registers it in `js/plugins.js` (the original is kept as `plugins.js.ap_backup`).

The game is located through Steam. If it is not found, set `lost_chapter_options.game_path` in `host.yaml`.

## Joining a Multiworld

1. Connect the client to the server.
2. Type `/run` in the client. The **Lost Chapter** tab shows `Game: connected` once the game has found the client,
   and the bottom left corner of the game's title screen shows `Archipelago: connected as <your name>`.
3. Start a new game.

The game only plays the multiworld when it is started with `/run`. It then keeps its save in a folder of its
own for the slot (`save_ap_<seed>_<slot>` in the game folder), so your normal save in `save` is never touched.

Started from Steam directly, or after the client is closed, it is the normal game with your normal save.

## Uninstalling

Type `/unpatch` in the client, or verify the game files in Steam.
