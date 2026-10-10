"""
Keeps a copy of the game's data files in dump/<name>/data (gitignored), so the plugin can be checked against every
version of the game: with and without the DLC, with and without the patch. tools/check_patches.py reads them.

    python tools/snapshot_game_data.py base "D:\\Games\\Steam\\steamapps\\common\\Lost Chapter"
"""
import shutil
import sys

from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
OUTPUT = REPO / "dump"


def main(name: str, game_path: Path) -> None:
    target = OUTPUT / name / "data"
    target.mkdir(parents=True, exist_ok=True)

    files = sorted((game_path / "data").glob("*.json"))

    for file in files:
        shutil.copyfile(file, target / file.name)

    print(f"Copied {len(files)} files to {target}")


if __name__ == "__main__":
    main(sys.argv[1], Path(sys.argv[2]))
