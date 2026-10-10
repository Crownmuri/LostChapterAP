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
3. In the **Lost Chapter** tab press **Install plugin**. This copies `LostChapterAP.js` into the game's `js/plugins`
   folder and registers it in `js/plugins.js` (the original is kept as `plugins.js.ap_backup`).

The game is located through Steam. If it is not found, set `lost_chapter_options.game_path` in `host.yaml`.

## Joining a Multiworld

1. Connect the client to the server.
2. Press **Launch game (Steam)**, or start the game yourself. The tab shows `Game: connected` once the game has
   found the client.
3. Start a new game. A save is tied to the multiworld it was first played in.

## Uninstalling

Type `/uninstall` in the client, or verify the game files in Steam.
