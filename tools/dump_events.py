"""
Writes docs/events.md: for every floor event, each decision and what it changes.

    python tools/dump_events.py "D:\\Games\\Steam\\steamapps\\common\\Lost Chapter"

The outline is read straight from the event commands. Messages, pictures and sounds are left out, and a branch
is only listed when something happens inside it. Jumps between labels are not followed, so an outcome listed under
one decision can also be reached from another one.
"""
import json
import re
import sys

from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
OUTPUT = REPO / "docs" / "events.md"

FLOOR_EVENTS = range(21, 62)

PARAMS = ["Max LP", "Max RP", "STR", "DEF", "MAG", "AGL", "FAITH", "VIRTUE"]

# Variables worth reporting. Everything else is scratch space or presentation.
VARIABLES = {
    1: "Rare Drop Rate",
    51: "LEWD",
    52: "Dependence",
    58: "AP per turn",
    66: "Treasury counter",
    71: "LP Regen",
    72: "RP Regen",
    74: "Forget-Me-Not count",
    82: "Draw Count",
    83: "Hand Limit",
    208: "Clothes damage",
    244: "Rocket Larkspur count",
    295: "Power of Darkness",
}
# Read in conditions only
CONDITION_VARIABLES = {
    **VARIABLES,
    11: "Floor",
    13: "Roulette value",
    14: "Roulette target",
    16: "Roulette value 2",
    17: "Roulette target 2",
    42: "LP",
    44: "RP",
    45: "STR",
    46: "DEF",
    47: "MAG",
    48: "AGL",
    49: "FAITH",
    50: "VIRTUE",
    59: "Gold",
    68: "Heavenly Kings defeated",
    81: "Deck size",
}

SWITCHES = {
    1: "Game cleared",
    15: "Demo",
    71: "Granisso defeated",
    72: "Orgenbein defeated",
    73: "Hielohude defeated",
    74: "Spisnix defeated",
    200: "TRUE END seen",
    229: "Title completion A",
    230: "Title completion B",
    231: "Bonus: Forget-Me-Not harvest x2",
    232: "Bonus: Gold gains +100",
    233: "Bonus: LEWD gains x2",
    234: "Bonus: Damage dealt +10%",
    235: "Bonus: Damage taken -10%",
    271: "Quest: Memory of the Moon",
    272: "Quest: Memory of Regret",
    273: "Quest: King laid to rest",
    274: "Quest: Shop stocked",
    275: "Quest: Monster",
    276: "Quest: Monster's end",
    280: "Quest: END 2 flag",
    281: "Quest: Cherry tree event",
    282: "Quest: Treasury",
    283: "Quest: Waiting",
    284: "Quest: Told",
    285: "Quest: Full Moon Man",
    286: "Quest: Pilfered",
    287: "Quest: Hill of Wailing",
    288: "Quest: Knight of the Lake",
    289: "Quest: Knight of the Cherry Blossoms",
    290: "Quest: Knight of the Beginning",
}

COMPARE = ["==", ">=", "<=", ">", "<", "!="]
OPERATE = ["=", "+=", "-=", "*=", "/=", "%="]

# Calls that are presentation or flow only
IGNORED_COMMON_EVENTS = ("Next Floor", "Pop-up")

ACTOR_DATA = ["Level", "EXP", "LP", "RP"] + PARAMS


def variable_name(variable_id: int) -> str:
    return CONDITION_VARIABLES.get(variable_id, f"v[{variable_id}]")


def switch_name(switch_id: int) -> str:
    return SWITCHES.get(switch_id, f"s[{switch_id}]")


def choice_label(text: str) -> str:
    """Strips text codes from a choice and spells out the condition MPP_ChoiceEX reads from its end."""
    condition = ""
    match = re.search(r"(if|en)?\(([^()]*[sv]\[\d+\][^()]*)\)$", text)

    if match:
        text = text[:match.start()]
        expression = re.sub(r"s\[(\d+)\]", lambda m: switch_name(int(m.group(1))), match.group(2))
        expression = re.sub(r"v\[(\d+)\]", lambda m: variable_name(int(m.group(1))), expression)
        condition = f"  [{'enabled' if match.group(1) == 'en' else 'shown'} if {expression}]"

    text = re.sub(r"\\[ci]\[\d+\]", "", text)
    text = re.sub(r"\\v\[(\d+)\]", lambda m: "{" + variable_name(int(m.group(1))) + "}", text)

    return f'"{text.strip()}"{condition}'


def operand(p: list) -> str:
    """The right hand side of a Control Variables command."""
    if p[3] == 0:
        return str(p[4])
    if p[3] == 1:
        return variable_name(p[4])
    if p[3] == 2:
        return f"random {p[4]}..{p[5]}"
    if p[3] == 3:
        if p[4] == 3 and p[6] < len(ACTOR_DATA):
            return ACTOR_DATA[p[6]]
        if p[4] == 7 and p[5] == 2:
            return "Gold"
        return "(game data)"
    return "(script)"


class Game:
    def __init__(self, game_path: Path) -> None:
        def load(name: str):
            with open(game_path / "data" / f"{name}.json", encoding="utf-8") as f:
                return json.load(f)

        self.common_events = load("CommonEvents")
        self.items = load("Items")
        self.weapons = load("Weapons")
        self.armors = load("Armors")
        self.states = load("States")
        self.troops = load("Troops")

    @staticmethod
    def name(table: list, index: int) -> str:
        entry = table[index] if 0 <= index < len(table) else None
        return entry["name"] if entry and entry["name"] else f"#{index}"


# How each scratch variable was last computed, to explain amounts and conditions that use it
scratch = {}


def scratch_note(variable_id: int) -> str:
    return f"  ({variable_name(variable_id)} = {scratch[variable_id]})" if variable_id in scratch else ""


def amount(operation: int, operand_type: int, operand: int) -> str:
    sign = "+" if operation == 0 else "-"
    if operand_type == 1:
        return f"{sign}{variable_name(operand)}{scratch_note(operand)}"
    return f"{sign}{operand}"


def describe_effect(game: Game, code: int, p: list) -> str:
    """One line for a command that changes the run, or an empty string."""
    if code == 125:
        return f"Gold {amount(p[0], p[1], p[2])}"
    if code == 126:
        return f"Card {amount(p[1], p[2], p[3])} {game.name(game.items, p[0])}"
    if code == 127:
        return f"Relic {amount(p[1], p[2], p[3])} {game.name(game.weapons, p[0])}"
    if code == 128:
        return f"Title condition {amount(p[1], p[2], p[3])} {game.name(game.armors, p[0])}"
    if code == 311:
        return f"LP {amount(p[2], p[3], p[4])}"
    if code == 312:
        return f"RP {amount(p[2], p[3], p[4])}"
    if code == 313:
        return f"State {'+' if p[2] == 0 else '-'} {game.name(game.states, p[3])}"
    if code == 314:
        return "Recover all"
    if code == 317:
        return f"{PARAMS[p[2]]} {amount(p[3], p[4], p[5])}"
    if code == 301:
        return f"Battle: {game.name(game.troops, p[1])}" if p[0] == 0 else "Battle"
    if code == 117:
        name = game.common_events[p[0]]["name"].strip("- ")
        return "" if any(ignored in name for ignored in IGNORED_COMMON_EVENTS) else f"Run: {name}"
    if code == 121:
        names = [SWITCHES[i] for i in range(p[0], p[1] + 1) if i in SWITCHES]
        return f"{', '.join(names)} -> {'ON' if p[2] == 0 else 'OFF'}" if names else ""
    if code == 122:
        if p[0] != p[1]:
            return ""
        if p[0] not in VARIABLES:
            if p[2] == 0:
                scratch[p[0]] = operand(p)
            elif p[0] in scratch:
                scratch[p[0]] = f"({scratch[p[0]]}) {OPERATE[p[2]][0]} {operand(p)}"
            return ""
        note = scratch_note(p[4]) if p[3] == 1 else ""
        return f"{VARIABLES[p[0]]} {OPERATE[p[2]]} {operand(p)}{note}"
    return ""


def describe_condition(game: Game, p: list) -> str:
    kind = p[0]
    if kind == 0:
        return f"{switch_name(p[1])} is {'ON' if p[2] == 0 else 'OFF'}"
    if kind == 1:
        value = str(p[3]) if p[2] == 0 else variable_name(p[3])
        return f"{variable_name(p[1])} {COMPARE[p[4]]} {value}{scratch_note(p[1])}"
    if kind == 4:
        if p[2] == 0:
            return f"party member #{p[1]} is present"
        if p[2] == 4:
            return f"has relic {game.name(game.weapons, p[3])} equipped"
        if p[2] == 5:
            return f"has title condition {game.name(game.armors, p[3])} equipped"
        if p[2] == 6:
            return f"has state {game.name(game.states, p[3])}"
        return "actor condition"
    if kind == 7:
        return f"Gold {['>=', '<=', '<'][p[2]]} {p[1]}"
    if kind == 8:
        return f"has card {game.name(game.items, p[1])}"
    if kind == 9:
        return f"has relic {game.name(game.weapons, p[1])}"
    if kind == 10:
        return f"has title condition {game.name(game.armors, p[1])}"
    if kind == 12:
        return f"script: {p[1]}"
    return "condition"


class Node:
    def __init__(self, label: str) -> None:
        self.label = label
        self.children: list = []

    def has_content(self) -> bool:
        return any(isinstance(child, str) or child.has_content() for child in self.children)

    def render(self, depth: int, lines: list) -> None:
        previous = None
        for child in self.children:
            if isinstance(child, str):
                lines.append(f"{'  ' * depth}- {child}")
            elif child.has_content():
                label = child.label
                # An "Otherwise" whose own "If" had nothing to show needs the condition spelled out
                if label == "Otherwise" and isinstance(previous, Node) and not previous.has_content():
                    label = f"Unless {previous.label[3:]}" if previous.label.startswith("If ") else label
                lines.append(f"{'  ' * depth}- **{label}**")
                child.render(depth + 1, lines)
            if not (isinstance(child, Node) and child.label == "Otherwise"):
                previous = child


def outline(game: Game, commands: list) -> Node:
    root = Node("")
    # stack[i] is the node that commands at indent i belong to
    stack = [root]
    scratch.clear()

    for command in commands:
        code, indent, p = command["code"], command["indent"], command["parameters"]
        del stack[indent + 1:]
        parent = stack[-1]

        if code == 402:
            node = Node(f"Choose {choice_label(p[1])}")
        elif code == 403:
            node = Node("Cancel the choice")
        elif code == 111:
            node = Node(f"If {describe_condition(game, p)}")
        elif code == 411:
            node = Node("Otherwise")
        elif code == 601:
            node = Node("If the battle is won")
        elif code == 602:
            node = Node("If escaped")
        elif code == 603:
            node = Node("If the battle is lost")
        else:
            effect = describe_effect(game, code, p)
            if effect:
                parent.children.append(effect)
            continue

        parent.children.append(node)
        stack.append(node)

    return root


def main(game_path: Path) -> None:
    game = Game(game_path)

    lines = [
        "# Floor events",
        "",
        "Generated by `tools/dump_events.py` from the game's event commands. Do not edit by hand.",
        "",
        "Each event lists its decisions and what they change. Messages are left out, and a branch is only shown when",
        "something happens inside it. Jumps between labels are not followed, so read an event as a list of possible",
        "outcomes rather than a strict flow. `v[n]` and `s[n]` are game variables and switches without a known meaning,",
        "mostly dice rolls and scratch values.",
        "",
        "Everything the game hands out here lasts for the current run only: the start of a run resets stats, cards,",
        "relics and quest flags.",
        "",
    ]

    for event_id in FLOOR_EVENTS:
        event = game.common_events[event_id]
        lines.append(f"## {event['name']} (common event {event_id})")
        lines.append("")

        root = outline(game, event["list"])

        if root.has_content():
            root.render(0, lines)
        else:
            lines.append("Nothing but text.")

        lines.append("")

    OUTPUT.parent.mkdir(exist_ok=True)

    with open(OUTPUT, "w", encoding="utf-8", newline="\n") as f:
        f.write("\n".join(lines))

    print(f"Wrote {OUTPUT} ({len(lines)} lines)")


if __name__ == "__main__":
    main(Path(sys.argv[1]))
