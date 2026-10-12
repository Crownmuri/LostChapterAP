"""
Runs the data patches of the in-game plugin against every snapshot of the game's data in dump/*/data
(tools/snapshot_game_data.py) and prints what could not be patched in each of them.

The plugin is loaded into a headless Edge or Chrome with the game's classes stubbed out, then handed the common
events and the maps the way the game does when it loads them.

    python tools/check_patches.py
    python tools/check_patches.py base dlc
"""
import html
import json
import re
import subprocess
import sys
import tempfile

from pathlib import Path
from typing import List, Optional

REPO = Path(__file__).resolve().parent.parent
PLUGIN = REPO / "apworld" / "lost_chapter" / "game_plugin" / "LostChapterAP.js"
SNAPSHOTS = REPO / "dump"

BROWSERS = (
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
)

# What the plugin touches while it loads, and what its dev commands read
STUBS = """
var errors = [];
console.error = function() { errors.push(Array.from(arguments).join(" ")); };
var require = function(name) {
    if (name === "path") {
        return { dirname: function() { return "g"; }, join: function() { return Array.from(arguments).join("/"); } };
    }
    return { readFileSync: function() { return JSON.stringify({ seed: "s", slot: 1, save: "save_ap_1_1" }); } };
};
var process = { mainModule: { filename: "g/index.html" } };
var PluginManager = { parameters: function() { return {}; } };
var SceneManager = {}, AudioManager = {}, SoundManager = {}, Input = {}, ImageManager = {}, TextManager = {};
var Graphics = { width: 1280, height: 720, frameCount: 0 };
var StorageManager = {};
var DataManager = { onLoad: function() {} };
var BattleManager = { processVictory: function() {} };
var WebSocket = function() { this.readyState = 0; };
WebSocket.OPEN = 1;
var $gameSwitches = { value: function() { return false; } };
var $gameVariables = { value: function() { return 0; } };
var $gameParty = { hasItem: function() { return false; }, members: function() { return []; } };
var $gameActors = { actor: function() { return { isStateAffected: function() { return false; } }; } };
var $gameSystem = {};
var $dataWeapons = [];
"""

# Loads the data, then reports the errors, the door choices, what became of the Girl (41) and the Locksmith (57),
# and the events a fresh run could be offered
REPORT = """
var lines = [];
try {
    DataManager.onLoad($dataCommonEvents);
    DataManager.onLoad($dataTroops);
    Object.keys(MAPS).forEach(function(name) { $dataMap = MAPS[name]; DataManager.onLoad($dataMap); });
    lines.push(errors.length + " patches failed");
    errors.forEach(function(error) { lines.push("  " + error); });
    $dataCommonEvents[63].list.forEach(function(command) {
        if (command.code === 102 && /Door/.test(command.parameters[0].join())) {
            lines.push("doors: " + command.parameters[0].join(" | "));
        }
    });
    [41, 57].forEach(function(id) {
        var list = $dataCommonEvents[id].list;
        var scripts = list.filter(function(command) { return command.code === 111 && command.parameters[0] === 12; });
        var gains = list.filter(function(command) { return command.code === 127 && command.parameters[1] === 0; });
        lines.push($dataCommonEvents[id].name + ": asks " +
            scripts.map(function(command) { return command.parameters[1]; }).join(" ; ") +
            " | hands out weapons " + gains.map(function(command) { return command.parameters[0]; }).join(","));
    });
    // The Market: the merchant's list and the condition of the memory that replaces him
    $dataCommonEvents[33].list.forEach(function(command, index, list) {
        if (command.code === 102 && /Plushie/.test(command.parameters[0].join())) {
            lines.push("market: " + command.parameters[0].join(" | ") + " (cancel " + command.parameters[1] + ")");
            lines.push("market branches: " + list.filter(function(other) {
                return other.code === 402 && other.indent === command.indent && /Plushie|Music|Thank|Need/.test(other.parameters[1]);
            }).map(function(other) { return other.parameters[0] + " " + other.parameters[1].split("if(")[0]; }).join(", "));
        }
        if (command.code === 111 && command.parameters[0] === 12 && /marketMenu/.test(command.parameters[1])) {
            lines.push("market memory: " + command.parameters[1]);
        }
    });
    // The events that ask "revisit or reset" once their relic or card is found: the question and its scenes
    [30, 36, 41, 42, 44, 59].forEach(function(id) {
        var list = $dataCommonEvents[id].list;
        lines.push($dataCommonEvents[id].name + ": " + list.filter(function(command) {
            return (command.code === 111 && /concluded|revisits/.test(command.parameters[1])) ||
                (command.code === 102 && /^ArchipelagoRe/.test(command.parameters[0][0]));
        }).map(function(command) {
            return command.code === 102 ? command.parameters[0].join(" | ") : command.parameters[1].replace("LostChapterAP.", "");
        }).join(" ; "));
    });
    // The choices that say "cannot pay", and where each of them jumps to
    $dataCommonEvents.forEach(function(event) {
        (event ? event.list : []).forEach(function(command, index, list) {
            if (command.code === 402 && /cannot pay/.test(command.parameters[1])) {
                var label = list[index + 1].parameters[0];
                var at = list.findIndex(function(other) { return other.code === 118 && other.parameters[0] === label; });
                lines.push("cannot pay: " + event.name + " choice " + command.parameters[0] + " " +
                    command.parameters[1].split(" \c")[0] + " -> label at " + at + " behind code " + list[at - 1].code);
            }
        });
    });
    // The verse of the standby screen that lost a line break in one version of the game
    $dataCommonEvents[87].list.forEach(function(command) {
        var text = command.code === 357 && command.parameters[3] ? String(command.parameters[3].text) : "";
        if (text.indexOf("When the light goes out") >= 0) {
            lines.push("verse: " + JSON.stringify(text.slice(text.indexOf("that the tears"))));
        }
    });
    // The click picture of the standby screen: every command that touches picture 100, in order
    lines.push("standby click picture: " + $dataCommonEvents[87].list.filter(function(command) {
        var p = command.parameters;
        return ([231, 232, 235].indexOf(command.code) >= 0 && p[0] === 100) ||
            (command.code === 357 && p[0] === "ButtonPicture" && Number(p[3].pictureId) === 100);
    }).map(function(command) {
        return { 231: "show", 232: "move", 235: "erase", 357: "button" }[command.code];
    }).join(" "));
    // The opening: what follows the list of origins the plugin puts in place of the questions
    MAPS["Map001.json"].events.forEach(function(event) {
        (event ? event.pages : []).forEach(function(page) {
            var at = page.list.findIndex(function(command) {
                return command.code === 355 && String(command.parameters[0]).indexOf("chooseOrigin") >= 0;
            });
            if (at >= 0) {
                lines.push("origin list is followed by: " + page.list.slice(at + 1, at + 6).map(function(command) {
                    return command.code + (command.code === 111 ? JSON.stringify(command.parameters) : "");
                }).join(" "));
            }
        });
    });
    lines.push(LostChapterAP.dev("events 10"));
    lines.push(LostChapterAP.dev("events 50"));
} catch (error) {
    lines.push("EXCEPTION " + error.stack);
}
document.getElementById("report").textContent = lines.join("\\n");
"""


def find_browser() -> Optional[str]:
    return next((path for path in BROWSERS if Path(path).is_file()), None)


def page(data: Path, report: str = "") -> str:
    source = PLUGIN.read_text(encoding="utf-8")

    with open(data / "CommonEvents.json", encoding="utf-8") as f:
        common_events = json.load(f)

    with open(data / "Troops.json", encoding="utf-8") as f:
        troops = json.load(f)

    maps = {}

    for file in sorted(data.glob("Map0*.json")):
        with open(file, encoding="utf-8") as f:
            maps[file.name] = json.load(f)

    # The plugin extends the prototypes of these classes
    classes = sorted(set(re.findall(r"\b([A-Z][A-Za-z_]+)\.prototype\b", source)))

    script = "\n".join(
        [f"function {name}() {{}}" for name in classes]
        + [
            STUBS,
            f"var $dataCommonEvents = {json.dumps(common_events)};",
            f"var $dataTroops = {json.dumps(troops)};",
            f"var MAPS = {json.dumps(maps)};",
            "var $dataMap = null;",
            source,
            report or REPORT,
        ]
    )

    return (
        "<html><head><meta charset='utf-8'></head><body><pre id='report'></pre><script>"
        + script.replace("</", "<\\/")
        + "</script></body></html>"
    )


def check(browser: str, name: str, data: Path) -> None:
    with tempfile.TemporaryDirectory() as folder:
        file = Path(folder) / "check.html"
        file.write_text(page(data), encoding="utf-8")

        dom = subprocess.run(
            [browser, "--headless", "--disable-gpu", "--dump-dom", file.as_uri()],
            stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
        ).stdout.decode("utf-8", errors="replace")

    report = re.search(r'<pre id="report">(.*?)</pre>', dom, re.S)

    print(f"== {name}")
    print(html.unescape(report.group(1)) if report and report.group(1) else "  the plugin did not load")
    print()


def main(names: List[str]) -> None:
    browser = find_browser()

    if browser is None:
        sys.exit("No Edge or Chrome found to run the plugin in.")

    snapshots = sorted(folder for folder in SNAPSHOTS.glob("*/data") if (folder / "CommonEvents.json").is_file())

    for data in snapshots:
        if not names or data.parent.name in names:
            check(browser, data.parent.name, data)

    if not snapshots:
        print(f"No snapshots in {SNAPSHOTS}, make one with tools/snapshot_game_data.py")


if __name__ == "__main__":
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")

    main(sys.argv[1:])
