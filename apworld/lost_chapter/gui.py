from typing import Dict, List, Optional, Tuple

from kvui import GameManager

from kivy.clock import Clock

from kivy.uix.boxlayout import BoxLayout
from kivy.uix.button import Button
from kivy.uix.label import Label
from kivy.uix.layout import Layout
from kivy.uix.widget import Widget

from . import game_install
from .client import LostChapterContext
from .world import LostChapterWorld


class LostChapterTabLayout(BoxLayout):
    ctx: LostChapterContext

    status_label: Label
    progress_label: Label

    def __init__(self, ctx: LostChapterContext) -> None:
        super().__init__(orientation="vertical", spacing="8dp", padding="12dp")

        self.ctx = ctx

        self.status_label = Label(font_size="18dp", halign="left", valign="top", size_hint_y=0.3)
        self.progress_label = Label(font_size="16dp", halign="left", valign="top", size_hint_y=0.5)

        for label in (self.status_label, self.progress_label):
            label.bind(size=label.setter("text_size"))

        buttons = BoxLayout(orientation="horizontal", spacing="8dp", size_hint_y=None, height="44dp")

        install_button = Button(text="Install plugin")
        install_button.bind(on_release=lambda *_: self.ctx.install_plugin())

        launch_button = Button(text="Launch game (Steam)")
        launch_button.bind(on_release=lambda *_: self.ctx.launch_game())

        buttons.add_widget(install_button)
        buttons.add_widget(launch_button)

        self.add_widget(self.status_label)
        self.add_widget(buttons)
        self.add_widget(self.progress_label)

        Clock.schedule_interval(self.update, 1.0)

    def update(self, *_) -> None:
        ctx = self.ctx
        game_path: Optional[str] = ctx.game_path

        lines: List[str] = [f"Install: {game_path or 'not found (set lost_chapter_options.game_path in host.yaml)'}"]

        if game_path:
            lines.append(f"Plugin: {'installed' if game_install.is_plugin_installed(game_path) else 'not installed'}")

        if ctx.bridge.is_game_connected:
            lines.append(f"Game: connected (plugin {ctx.bridge.plugin_version or '?'})")
        else:
            lines.append(f"Game: waiting on port {ctx.bridge.port}")

        if ctx.floor is not None:
            lines.append(f"Floor: {ctx.floor}")

        self.status_label.text = "\n".join(lines)

        if not ctx.slot:
            self.progress_label.text = "Connect to an Archipelago server to see check progress."
            return

        in_logic = set(ctx.locations_in_logic)

        lines = list()

        group: str
        names: set
        for group, names in LostChapterWorld.location_name_groups.items():
            ids: Dict[str, int] = {name: LostChapterWorld.location_name_to_id[name] for name in names}
            included = {name for name, loc_id in ids.items() if loc_id in ctx.server_locations}

            if not included:
                continue

            checked = sum(1 for name in included if ids[name] in ctx.checked_locations)
            line = f"{group}: {checked}/{len(included)}"

            if ctx.tracker_loaded:
                available = sum(1 for name in included if name in in_logic and ids[name] in ctx.missing_locations)
                line += f"  ({available} in logic)"

            lines.append(line)

        self.progress_label.text = "\n".join(lines)


def bootstrap_client_gui(gui: Optional[type[GameManager]]) -> type[GameManager]:
    class LostChapterManager(gui):
        ctx: LostChapterContext

        logging_pairs: List[Tuple[str, str]] = [("Client", "Archipelago")]
        base_title: str = "Archipelago Lost Chapter Client"

        lost_chapter_tab_layout: LostChapterTabLayout

        lost_chapter_tab: Widget

        def build(self) -> Layout:
            container: Layout = super().build()

            self.lost_chapter_tab_layout = LostChapterTabLayout(self.ctx)
            self.lost_chapter_tab = self.add_client_tab("Lost Chapter", self.lost_chapter_tab_layout)

            return container

    return LostChapterManager
