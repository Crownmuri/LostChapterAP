"""
Packs apworld/lost_chapter into build/lost_chapter.apworld.

    python tools/build_apworld.py
    python tools/build_apworld.py --install "D:\\Games\\Randomizer\\Archipelago\\custom_worlds"
"""
import argparse
import shutil
import zipfile

from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
WORLD = REPO / "apworld" / "lost_chapter"
OUTPUT = REPO / "build" / "lost_chapter.apworld"


def build() -> Path:
    OUTPUT.parent.mkdir(exist_ok=True)

    with zipfile.ZipFile(OUTPUT, "w", zipfile.ZIP_DEFLATED) as apworld:
        for path in sorted(WORLD.rglob("*")):
            if path.is_file() and "__pycache__" not in path.parts:
                apworld.write(path, Path("lost_chapter") / path.relative_to(WORLD))

    return OUTPUT


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--install", metavar="CUSTOM_WORLDS_DIR", help="also copy the apworld into this folder")
    args = parser.parse_args()

    output = build()
    print(f"Built {output}")

    if args.install:
        print(f"Installed {shutil.copy(output, args.install)}")
