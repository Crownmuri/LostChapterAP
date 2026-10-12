"""
Walks every floor event through the states a run can be in and prints which checks a state locks away.

The in-game plugin has a walker that follows an event along every way it can go (walkEvent): every choice, both
sides of a roll, one side of what is known. Here it is run in a headless browser against a snapshot of the game's
data (dump/*/data), once with every story switch off and once more for each switch that an event asks for, turned
on. A relic or card the event hands out in the first walk but not in the second is locked away by that switch.

    python tools/review_events.py            the newest snapshot (dlc_patch)
    python tools/review_events.py base

What the plugin already does about a switch is part of the walk: the scenes of the Monster quest and of the flag
on the Hill wait while a relic of the event is an open check, so they lock nothing away here.
"""
import html
import json
import re
import runpy
import subprocess
import sys
import tempfile

from pathlib import Path

import check_patches

REPO = check_patches.REPO
DATA = runpy.run_path(str(REPO / "apworld" / "lost_chapter" / "data.py"))

# Runs after the plugin: the data is loaded, every event is walked, and the lines are put into the page
REVIEW = """
var lines = [];
try {
    DataManager.onLoad($dataCommonEvents);
    DataManager.onLoad($dataTroops);
    var review = LostChapterAP.review;
    // The plugin's own questions, answered for a check that is still open
    var script = function(text) {
        if (/storyScene|relicTaken|cardTaken|lassiGone|locksmithRefuses|concluded|revisits/.test(text)) {
            return false;
        }
        return /girlGift|knightRelics|knightAsks/.test(text) ? true : undefined;
    };
    var world = function(on) {
        var unknown = function() { return undefined; };
        return {
            s: function(id) { return !!on["s" + id]; },
            t: function(id) { return !!on["t" + id]; },
            v: unknown, i: unknown, w: unknown, armor: unknown, script: script,
        };
    };
    var checks = function(gains) {
        return Object.keys(gains).filter(function(key) { return CHECKS[key]; });
    };
    var events = review.events();
    var base = {};
    var asked = {};
    events.forEach(function(eventId) {
        var walk = review.walk(review.list(eventId), world({}));
        var block = review.walk(review.block(eventId), world({}));
        base[eventId] = { walk: walk, offered: Object.keys(block.jumps).length === 0 };
        Object.keys(walk.facts).concat(Object.keys(block.facts)).forEach(function(fact) { asked[fact] = true; });
    });
    var setters = function(fact, value) {
        return events.filter(function(eventId) { return base[eventId].walk.sets[fact + ":" + value]; })
            .map(review.name);
    };
    // Not the scratch switches of the events (1-20), which no run is ever in
    var real = function(fact) { return fact[0] !== "s" || Number(fact.slice(1)) > 20; };
    Object.keys(asked).filter(real).sort().forEach(function(fact) {
        var on = {};
        on[fact] = true;
        var found = [];
        events.forEach(function(eventId) {
            var before = checks(base[eventId].walk.gains);
            var block = review.walk(review.block(eventId), world(on));
            var offered = Object.keys(block.jumps).length === 0;
            if (base[eventId].offered && !offered) {
                found.push(review.name(eventId) + ": not offered at all" +
                    (before.length ? " (" + before.map(function(key) { return CHECKS[key]; }).join(", ") + ")" : ""));
                return;
            }
            var after = review.walk(review.list(eventId), world(on)).gains;
            var lost = before.filter(function(key) { return !after[key]; });
            if (lost.length > 0) {
                found.push(review.name(eventId) + ": " + lost.map(function(key) { return CHECKS[key]; }).join(", "));
            }
        });
        if (found.length > 0) {
            lines.push((NAMES[fact] || fact) + " (" + fact + ")" +
                (review.undone.indexOf(fact) >= 0 ? ": the plugin turns it off on the next floor" : ""));
            lines.push("  turned on in: " + (setters(fact, true).join(", ") || "-") +
                " | off in: " + (setters(fact, false).join(", ") || "-"));
            found.forEach(function(line) { lines.push("  locks " + line); });
        }
    });
    // The names of the floor choice for a run on floor 61 with every event unlocked and nothing found: the counts
    // and asterisks the plugin makes of the same walk
    $dataItems = [];
    $dataArmors = [];
    $gameSystem._archipelago = {
        seed: "s", checked: [], events: events, holdFloor: false,
        options: { events: events, relics: RELIC_IDS, cards: CARD_IDS, relicsanity: 1 },
    };
    LostChapterAP.slot = { seed: "s", event_checks: EVENT_CHECKS };
    $gameVariables.value = function(id) { return id === 11 ? 60 : 0; };
    lines.push("");
    lines.push("A run on floor 61, every event unlocked, nothing found, nothing held:");
    lines.push("  " + review.names().join(" | "));
} catch (error) {
    lines.push("the review failed: " + error + " " + (error.stack || ""));
}
document.getElementById("report").textContent = lines.join("\\n");
"""


def names(data: Path) -> dict:
    with open(data / "System.json", encoding="utf-8") as f:
        system = json.load(f)

    with open(data / "States.json", encoding="utf-8") as f:
        states = json.load(f)

    found = {f"s{index}": name for index, name in enumerate(system["switches"]) if name}
    found.update({f"t{state['id']}": state["name"] for state in states if state and state["name"]})

    return found


def main(name: str) -> None:
    browser = check_patches.find_browser()
    data = check_patches.SNAPSHOTS / name / "data"

    if browser is None:
        sys.exit("No Edge or Chrome found to run the plugin in.")

    checks = {f"w{weapon_id}": relic for weapon_id, relic in DATA["RELICS"].items()}
    checks.update({f"i{item_id}": f"Card: {card}" for item_id, card in DATA["CARDS"].items()})

    event_checks = {event_id: DATA["event_locations"](event_id, True) for event_id in DATA["EVENTS"]}
    values = {
        "CHECKS": checks,
        "NAMES": names(data),
        "EVENT_CHECKS": event_checks,
        "RELIC_IDS": sorted(DATA["RELICS"]),
        "CARD_IDS": sorted(DATA["CARDS"]),
    }
    report = "".join(f"var {name} = {json.dumps(value)};\n" for name, value in values.items()) + REVIEW

    with tempfile.TemporaryDirectory() as folder:
        file = Path(folder) / "review.html"
        file.write_text(check_patches.page(data, report), encoding="utf-8")

        dom = subprocess.run(
            [browser, "--headless", "--disable-gpu", "--dump-dom", file.as_uri()],
            stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
        ).stdout.decode("utf-8", errors="replace")

    found = re.search(r'<pre id="report">(.*?)</pre>', dom, re.S)

    print(html.unescape(found.group(1)) if found and found.group(1) else "the plugin did not load")


if __name__ == "__main__":
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")

    main(sys.argv[1] if len(sys.argv) > 1 else "dlc_patch")
