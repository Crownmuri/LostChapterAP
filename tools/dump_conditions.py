"""
Writes docs/event_conditions.md: for every floor event, when the game offers it and every condition inside it.

    python tools/dump_conditions.py [SNAPSHOT] [BASE SNAPSHOT]

Both are folders with the game's `data` folder in them: a snapshot of tools/snapshot_game_data.py or the game
folder itself. They default to dump/dlc_patch and dump/base. The second one only says which events the DLC adds
to or changes.

Everything is read from the event commands, like docs/events.md: jumps between labels are named but not followed.
"""
import json
import re
import runpy
import sys

from pathlib import Path
from typing import Dict, List, Optional, Tuple

import dump_events as events

from dump_events import Game, Node

REPO = Path(__file__).resolve().parent.parent
OUTPUT = REPO / "docs" / "event_conditions.md"
DATA = runpy.run_path(str(REPO / "apworld" / "lost_chapter" / "data.py"))

COMMON_EVENT_NEXT_FLOOR = 86
VARIABLE_FLOOR_EVENT = 12
VARIABLE_ORIGIN = 2
# The switch ids of the floor events: common event 86 turns the switch of the rolled event on
EVENT_RANGES = ((21, 61), (161, 171))
LATE_EVENT_FIRST = 57
# The start of a run turns these off again ("---Game Initialization---")
RUN_SWITCHES = range(241, 291)
# Switches every event uses for its own ends
SCRATCH_SWITCHES = {11: "scratch switch 1", 12: "scratch switch 2"}
# Labels the events jump to, in the game's Japanese
LABELS = {
    "終了": "the end of the event",
    "やりなおし": "roll again",
    "戻る": "back",
    "勝利": "victory",
    "再開": "resume",
    "開けない": "not opened",
    "リベンジ": "revenge",
    "怪物": "monster",
    "湖の騎士": "Knight of the Lake",
    "海": "the normal scene",
    "周回": "next lap",
    "早い": "too early",
    "スキップ": "skip",
}
ORIGINS = {
    1: "Knowledge Seeker", 2: "Pure Girl", 3: "Forgotten Martyr", 4: "Loyal Knight", 5: "Nobody",
    6: "Soldier of the Wastelands", 7: "Votive Offering", 8: "Hero of the Future", 9: "Devil's Servant",
    99: "The New Ruler",
}
# Common events of the bosses and the fights, for the last part of the document
OTHER_EVENTS = {
    62: "Before a boss floor",
    63: "The doors of the Heavenly Kings and of the DLC bosses",
    64: "Magisdusk",
    69: "Magislilia (DLC)",
}


def is_floor_event(switch_id: int) -> bool:
    return any(first <= switch_id <= last for first, last in EVENT_RANGES)


def load(path: Path, name: str):
    with open(path / "data" / f"{name}.json", encoding="utf-8") as f:
        return json.load(f)


def name_switches_and_variables(path: Path) -> None:
    """Whatever docs/events.md has no name for goes by the name the game's own database gives it."""
    system = load(path, "System")

    for switch_id, name in enumerate(system["switches"]):
        if name and switch_id not in events.SWITCHES and switch_id not in SCRATCH_SWITCHES:
            events.SWITCHES[switch_id] = name.strip()

    events.SWITCHES.update(SCRATCH_SWITCHES)
    events.CONDITION_VARIABLES[VARIABLE_ORIGIN] = "Origin"
    events.CONDITION_VARIABLES[VARIABLE_FLOOR_EVENT] = "rolled event"

    for variable_id, name in enumerate(system["variables"]):
        if name and variable_id not in events.CONDITION_VARIABLES and "Usable at Any Time" not in name:
            events.CONDITION_VARIABLES[variable_id] = name.strip()


def label(name: str) -> str:
    return f'"{LABELS[name]}"' if name in LABELS else f'"{name}"'


def describe(game: Game, code: int, p: list) -> str:
    """describe_effect of docs/events.md, and the flow commands a condition can hang on."""
    if code == 118:
        return f"(label {label(p[0])})"
    if code == 119:
        return f"Jump to {label(p[0])}"
    if code == 115:
        return "The event ends here"

    return events.describe_effect(game, code, p)


def condition(game: Game, p: list) -> str:
    text = events.describe_condition(game, p)

    if p[0] == 1 and p[1] == VARIABLE_ORIGIN and p[2] == 0 and p[3] in ORIGINS:
        text += f" ({ORIGINS[p[3]]})"

    return text


def choice(text: str) -> str:
    """choice_label of docs/events.md, with the origin an origin number stands for."""
    def origin(match: "re.Match") -> str:
        number = int(match.group(2))

        return f"Origin {match.group(1)} {number}" + (f" ({ORIGINS[number]})" if number in ORIGINS else "")

    return re.sub(r"Origin\s*(==|!=)\s*(\d+)", origin, events.choice_label(text))


class Tree(Node):
    """A node that is shown when it has something in it or `always`: a choice is, whatever it leads to."""

    def __init__(self, text: str, always: bool = False) -> None:
        super().__init__(text)
        self.always = always

    def has_content(self) -> bool:
        return self.always or super().has_content()


def outline(game: Game, commands: list) -> Tuple[Tree, List[Tuple[List[str], dict]]]:
    """The tree of an event, and every command with the labels of the branches it sits in."""
    root = Tree("")
    stack: List[Node] = [root]
    placed: List[Tuple[List[str], dict]] = []
    events.scratch.clear()

    for command in commands:
        code, indent, p = command["code"], command["indent"], command["parameters"]
        del stack[indent + 1:]
        placed.append(([node.label for node in stack[1:]], command))

        if code == 402:
            node = Tree(f"Choose {choice(p[1])}", True)
        elif code == 403:
            node = Tree("Cancel the choice")
        elif code == 111:
            node = Tree(f"If {condition(game, p)}")
        elif code == 411:
            node = Tree("Otherwise")
        elif code == 601:
            node = Tree("If the battle is won")
        elif code == 602:
            node = Tree("If escaped")
        elif code == 603:
            node = Tree("If the battle is lost")
        else:
            effect = describe(game, code, p)

            if effect:
                stack[-1].children.append(effect)

            continue

        stack[-1].children.append(node)
        stack.append(node)

    return root, placed


def roll_blocks(commands: list) -> Dict[int, list]:
    """event id -> the commands common event 86 runs when it has rolled that event."""
    blocks: Dict[int, list] = {}

    for index, command in enumerate(commands):
        p = command["parameters"]

        if command["code"] == 111 and p[0] == 1 and p[1] == VARIABLE_FLOOR_EVENT and p[2] == 0 and p[4] == 0:
            end = index + 1

            while end < len(commands) and commands[end]["indent"] > command["indent"]:
                end += 1

            blocks[p[3]] = commands[index + 1:end]

    return blocks


def switches_read(command: dict) -> List[int]:
    """The switches a command asks for: a condition, or the condition at the end of a choice."""
    code, p = command["code"], command["parameters"]

    if code == 111 and p[0] == 0:
        return [p[1]]

    if code == 102:
        return [int(switch_id) for text in p[0] for switch_id in re.findall(r"s\[(\d+)\]", text)]

    if code == 111 and p[0] == 12:
        return [int(switch_id) for switch_id in re.findall(r"\$gameSwitches\.value\((\d+)\)", str(p[1]))]

    return []


def path(labels: List[str]) -> str:
    # Without the condition of a choice, which the event itself lists
    steps = [re.sub(r"  \[(shown|enabled) if .*\]$", "", text.replace("Choose ", "")) for text in labels]

    return " > ".join(steps) if steps else "on entering"


def render(root: Node, lines: List[str], empty: str) -> None:
    if root.has_content():
        root.render(0, lines)
    else:
        lines.append(empty)


def main(snapshot: Path, base: Optional[Path]) -> None:
    game = Game(snapshot)
    name_switches_and_variables(snapshot)

    common_events = game.common_events
    floor_events = sorted(
        (event for event in common_events if event and event["trigger"] == 1 and is_floor_event(event["switchId"])),
        key=lambda event: event["switchId"],
    )
    base_events = {}

    if base and (base / "data").is_dir():
        base_events = {
            event["switchId"]: event
            for event in load(base, "CommonEvents")
            if event and event["trigger"] == 1 and is_floor_event(event["switchId"])
        }

    blocks = roll_blocks(common_events[COMMON_EVENT_NEXT_FLOOR]["list"])
    names = {event["switchId"]: DATA["EVENTS"].get(event["switchId"], event["name"]) for event in floor_events}

    # switch id -> where it is turned on or off, and where it is asked for
    turned: Dict[int, List[str]] = {}
    asked: Dict[int, List[str]] = {}
    trees = {}

    for event in floor_events:
        event_id = event["switchId"]
        tree, placed = outline(game, event["list"])
        trees[event_id] = tree

        for labels, command in placed:
            p = command["parameters"]

            if command["code"] == 121:
                for switch_id in range(p[0], p[1] + 1):
                    if switch_id not in SCRATCH_SWITCHES:
                        turned.setdefault(switch_id, []).append(
                            f"{'on' if p[2] == 0 else 'off'} in **{names[event_id]}**: {path(labels)}"
                        )

            for switch_id in switches_read(command):
                if switch_id not in SCRATCH_SWITCHES:
                    asked.setdefault(switch_id, [])

                    if names[event_id] not in asked[switch_id]:
                        asked[switch_id].append(names[event_id])

    for event_id, block in blocks.items():
        for command in block:
            for switch_id in switches_read(command):
                if switch_id not in SCRATCH_SWITCHES and event_id in names:
                    asked.setdefault(switch_id, [])
                    reader = f"{names[event_id]} (whether it is offered)"

                    if reader not in asked[switch_id]:
                        asked[switch_id].append(reader)

    lines = [
        "# Floor event conditions",
        "",
        "Generated by `tools/dump_conditions.py` from the game's event commands. Do not edit by hand.",
        "",
        "For every floor event: when the game offers it, what it asks of other events, and every condition inside it,",
        "with what each branch changes. `docs/events.md` is the shorter list of outcomes only.",
        "",
        "## How to read this",
        "",
        "- **Choose \"...\"** is a choice. `[shown if ...]` hides it until the condition holds, `[enabled if ...]`",
        "  grays it out. **If ...** is a condition the event checks by itself.",
        "- Jumps between labels are named but not followed: after `Jump to \"the end of the event\"` nothing below",
        "  it in the same branch happens.",
        "- `scratch switch 1` and `2` and `v[n]` are values an event works out for itself, usually right before",
        "  the choice that asks for them. A percentage in a choice is a dice roll against the value named with it.",
        "- Quest switches (ids 241 to 290) are turned off at the start of every run, like stats, cards and relics.",
        "- This is the game as it is. In a multiworld an event also needs its unlock, and where an event hands out a",
        "  relic or a card that is a check, \"has relic\" there means that the check was sent.",
        "",
        "## How a floor is rolled",
        "",
        "Common event 86 decides what the next floor is:",
        "",
        "1. Every 20th floor is a boss floor: the doors of the Heavenly Kings, the last boss once all four are",
        "   defeated, or the last door of the DLC once both of its bosses are.",
        "2. Otherwise a fight is rolled first: 2 in 5 up to floor 100, 2 in 6 on floors 101 to 200, 2 in 7 above.",
        "3. Otherwise one floor event is rolled, every one of them as likely as the next: events 21 to 56 up to",
        "   floor 40, all of them from floor 41 on.",
        "4. An event with a condition of its own (listed under **Offered** below) is rolled again when the condition",
        "   says so, until one stays.",
        "",
        "## Contents",
        "",
    ]

    for event in floor_events:
        name = names[event["switchId"]]
        anchor = re.sub(r"[^a-z0-9 -]", "", name.lower()).replace(" ", "-")
        lines.append(f"- [{name}](#{anchor})")

    lines += ["- [Quest switches](#quest-switches)", "- [Bosses](#bosses)", ""]

    for event in floor_events:
        event_id = event["switchId"]
        name = names[event_id]
        lines += [f"## {name}", ""]

        facts = [f"switch {event_id}, common event {event['id']}"]

        if name != event["name"]:
            facts.append(f"the game calls it \"{event['name']}\"")

        if base_events:
            if event_id not in base_events:
                facts.append("only with the DLC")
            elif base_events[event_id]["list"] != event["list"]:
                facts.append("the DLC changes it")

        lines += [", ".join(facts) + ".", ""]

        floors = "from floor 41 on" if event_id >= LATE_EVENT_FIRST else "on every floor"
        block, _ = outline(game, blocks.get(event_id, []))

        if block.has_content():
            lines += [f"**Offered** {floors}, unless it is rolled again:", ""]
            block.render(0, lines)
        else:
            lines.append(f"**Offered** {floors}, without a condition.")

        lines.append("")

        needs = []
        sets = []

        for switch_id in sorted(set(asked) | set(turned)):
            others = [where for where in turned.get(switch_id, []) if f"**{name}**" not in where]
            own = [where for where in turned.get(switch_id, []) if f"**{name}**" in where]

            if name in asked.get(switch_id, []) and others:
                needs.append(f"- {events.switch_name(switch_id)} (switch {switch_id}): turned {'; '.join(others)}")

            readers = [
                reader for reader in asked.get(switch_id, []) if reader != name and not reader.startswith(name + " (")
            ]

            if own and readers:
                sets.append(f"- {events.switch_name(switch_id)} (switch {switch_id}): asked for in {', '.join(readers)}")

        if needs:
            lines += ["**Asks for what other events did:**", ""] + needs + [""]

        if sets:
            lines += ["**Other events ask for what it does:**", ""] + sets + [""]

        lines += ["**Inside the event:**", ""]
        render(trees[event_id], lines, "Nothing but text.")
        lines.append("")

    lines += [
        "## Quest switches",
        "",
        "Every switch a floor event turns on or off that a floor event asks for, or that decides whether one is",
        "offered.",
        "",
    ]

    for switch_id in sorted(set(asked) & set(turned)):
        lines += [f"### {events.switch_name(switch_id)} (switch {switch_id})", ""]

        if switch_id in RUN_SWITCHES:
            lines += ["Off again at the start of every run.", ""]

        lines += [f"- Turned {where}" for where in turned[switch_id]]
        lines += [f"- Asked for in: {', '.join(asked[switch_id])}", ""]

    lines += [
        "## Bosses",
        "",
        "The common events of the boss floors, read the same way. What a fight itself does is not part of them.",
        "",
    ]

    for event_id, title in OTHER_EVENTS.items():
        if event_id < len(common_events) and common_events[event_id]:
            lines += [f"### {title} (common event {event_id})", ""]
            render(outline(game, common_events[event_id]["list"])[0], lines, "Nothing but text.")
            lines.append("")

    OUTPUT.parent.mkdir(exist_ok=True)

    with open(OUTPUT, "w", encoding="utf-8", newline="\n") as f:
        f.write("\n".join(lines))

    print(f"Wrote {OUTPUT} ({len(lines)} lines)")


if __name__ == "__main__":
    arguments = [Path(argument) for argument in sys.argv[1:]]
    main(
        arguments[0] if arguments else REPO / "dump" / "dlc_patch",
        arguments[1] if len(arguments) > 1 else REPO / "dump" / "base",
    )
