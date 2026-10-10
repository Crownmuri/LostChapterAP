"""
Dumps a readable outline of the game's database into dump/ (gitignored) for reverse engineering.

    python tools/dump_game_data.py "D:\\Games\\Steam\\steamapps\\common\\Lost Chapter"

Writes:
    dump/names.txt          switches, variables, items, weapons, armors, enemies, troops, common events
    dump/common_events.txt  every common event as one line per event command
"""
import json
import sys

from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
OUTPUT = REPO / "dump"


def load(game_path: Path, name: str):
    with open(game_path / "data" / f"{name}.json", encoding="utf-8") as f:
        return json.load(f)


def main(game_path: Path) -> None:
    OUTPUT.mkdir(exist_ok=True)

    system = load(game_path, "System")

    with open(OUTPUT / "names.txt", "w", encoding="utf-8") as f:
        for key in ("switches", "variables"):
            f.write(f"== {key}\n")
            f.writelines(f"{i}\t{name}\n" for i, name in enumerate(system[key]) if name)

        for name in ("Items", "Weapons", "Armors", "Enemies", "Troops", "CommonEvents"):
            f.write(f"== {name}\n")
            f.writelines(f"{entry['id']}\t{entry['name']}\n" for entry in load(game_path, name) if entry and entry["name"])

    with open(OUTPUT / "common_events.txt", "w", encoding="utf-8") as f:
        for event in load(game_path, "CommonEvents"):
            if not event:
                continue

            f.write(f"#### {event['id']} {event['name']} (trigger {event['trigger']}, switch {event['switchId']})\n")

            for command in event["list"]:
                if command["code"]:
                    parameters = json.dumps(command["parameters"], ensure_ascii=False)
                    f.write(f"{'  ' * command['indent']}{command['code']} {parameters}\n")

    print(f"Wrote {OUTPUT}")


if __name__ == "__main__":
    main(Path(sys.argv[1]))
