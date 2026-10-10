import pkgutil

import worlds.LauncherComponents as LauncherComponents

from .world import LostChapterWorld


def launch_client(*args) -> None:
    from .client import main
    LauncherComponents.launch(main, name="LostChapterClient", args=args)


def has_icon() -> bool:
    # icon.png is the game's own icon and is not part of the repository, a build without it uses the default icon
    try:
        return pkgutil.get_data(__name__, "icon.png") is not None
    except OSError:
        return False


if has_icon():
    LauncherComponents.icon_paths["lost_chapter"] = f"ap:{__name__}/icon.png"

LauncherComponents.components.append(
    LauncherComponents.Component(
        "Lost Chapter Client",
        func=launch_client,
        component_type=LauncherComponents.Type.CLIENT,
        game_name="Lost Chapter",
        supports_uri=True,
        icon="lost_chapter" if has_icon() else "icon",
    )
)
