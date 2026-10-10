"""Locating the Steam install, installing the in-game plugin and launching the game."""
import json
import os
import pkgutil
import re
import shutil
import webbrowser

from typing import List, Optional

from .data import STEAM_APP_ID

PLUGIN_NAME = "LostChapterAP"
PLUGIN_FILE = f"{PLUGIN_NAME}.js"
BACKUP_SUFFIX = ".ap_backup"
SESSION_FILE = "archipelago_session.json"

_ENTRY_PATTERN = re.compile(r',?\r?\n\{"name":"' + PLUGIN_NAME + r'".*?\}\}(?=\r?\n)')


def steam_library_paths() -> List[str]:
    try:
        import winreg

        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, r"Software\Valve\Steam") as key:
            steam_path: str = winreg.QueryValueEx(key, "SteamPath")[0]
    except (ImportError, OSError):
        return []

    paths: List[str] = [steam_path]

    try:
        with open(os.path.join(steam_path, "steamapps", "libraryfolders.vdf"), encoding="utf-8") as f:
            paths += [path.replace("\\\\", "\\") for path in re.findall(r'"path"\s+"([^"]+)"', f.read())]
    except OSError:
        pass

    return paths


def find_game_path(configured_path: str = "") -> Optional[str]:
    if configured_path:
        return configured_path if is_game_path(configured_path) else None

    for library in steam_library_paths():
        manifest = os.path.join(library, "steamapps", f"appmanifest_{STEAM_APP_ID}.acf")

        try:
            with open(manifest, encoding="utf-8") as f:
                match = re.search(r'"installdir"\s+"([^"]+)"', f.read())
        except OSError:
            continue

        if match:
            game_path = os.path.join(library, "steamapps", "common", match.group(1))

            if is_game_path(game_path):
                return os.path.normpath(game_path)

    return None


def is_game_path(game_path: str) -> bool:
    return os.path.isfile(os.path.join(game_path, "js", "plugins.js"))


def is_plugin_installed(game_path: str) -> bool:
    if not os.path.isfile(os.path.join(game_path, "js", "plugins", PLUGIN_FILE)):
        return False

    with open(os.path.join(game_path, "js", "plugins.js"), encoding="utf-8") as f:
        return _ENTRY_PATTERN.search(f.read()) is not None


def install_plugin(game_path: str, port: int) -> None:
    """Copies the plugin into js/plugins and registers it in js/plugins.js (the original is backed up once)."""
    plugin_source = pkgutil.get_data(__package__, f"game_plugin/{PLUGIN_FILE}")

    with open(os.path.join(game_path, "js", "plugins", PLUGIN_FILE), "wb") as f:
        f.write(plugin_source)

    plugins_js = os.path.join(game_path, "js", "plugins.js")

    if not os.path.exists(plugins_js + BACKUP_SUFFIX):
        shutil.copyfile(plugins_js, plugins_js + BACKUP_SUFFIX)

    with open(plugins_js, encoding="utf-8", newline="") as f:
        content = _ENTRY_PATTERN.sub("", f.read())

    entry = (
        f'{{"name":"{PLUGIN_NAME}","status":true,"description":"Archipelago bridge",'
        f'"parameters":{{"port":"{port}"}}}}'
    )

    content, count = re.subn(r"(\r?\n)\];\s*$", lambda m: f",{m.group(1)}{entry}{m.group(1)}];\n", content)

    if count != 1:
        raise RuntimeError("Unexpected js/plugins.js layout, the plugin was not registered")

    with open(plugins_js, "w", encoding="utf-8", newline="") as f:
        f.write(content)


def uninstall_plugin(game_path: str) -> None:
    plugins_js = os.path.join(game_path, "js", "plugins.js")

    with open(plugins_js, encoding="utf-8", newline="") as f:
        content = f.read()

    with open(plugins_js, "w", encoding="utf-8", newline="") as f:
        f.write(_ENTRY_PATTERN.sub("", content))

    plugin_file = os.path.join(game_path, "js", "plugins", PLUGIN_FILE)

    if os.path.exists(plugin_file):
        os.remove(plugin_file)

    clear_session(game_path)


def save_folder(seed: str, slot: int) -> str:
    return f"save_ap_{re.sub(r'[^A-Za-z0-9]', '', str(seed))}_{slot}"


def write_session(game_path: str, seed: str, slot: int) -> str:
    """
    Tells the plugin which multiworld slot the next game start belongs to. The game then saves into a folder of
    its own for that slot instead of its normal save folder.
    """
    folder = save_folder(seed, slot)
    save_path = os.path.join(game_path, folder)
    os.makedirs(save_path, exist_ok=True)

    # Carry the player's volume and other options over
    config = os.path.join(game_path, "save", "config.rmmzsave")

    if os.path.isfile(config) and not os.path.exists(os.path.join(save_path, "config.rmmzsave")):
        shutil.copyfile(config, os.path.join(save_path, "config.rmmzsave"))

    with open(os.path.join(game_path, SESSION_FILE), "w", encoding="utf-8") as f:
        json.dump({"seed": seed, "slot": slot, "save": folder}, f)

    return folder


def clear_session(game_path: str) -> None:
    session_file = os.path.join(game_path, SESSION_FILE)

    if os.path.exists(session_file):
        os.remove(session_file)


def launch_game() -> None:
    webbrowser.open(f"steam://rungameid/{STEAM_APP_ID}")
