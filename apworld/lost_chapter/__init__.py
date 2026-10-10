import worlds.LauncherComponents as LauncherComponents

from .world import LostChapterWorld


def launch_client(*args) -> None:
    from .client import main
    LauncherComponents.launch(main, name="LostChapterClient", args=args)


LauncherComponents.icon_paths["lost_chapter"] = f"ap:{__name__}/icon.png"

LauncherComponents.components.append(
    LauncherComponents.Component(
        "Lost Chapter Client",
        func=launch_client,
        component_type=LauncherComponents.Type.CLIENT,
        game_name="Lost Chapter",
        supports_uri=True,
        icon="lost_chapter",
    )
)
