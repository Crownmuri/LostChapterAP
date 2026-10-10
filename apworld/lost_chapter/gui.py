from typing import Dict, List, Optional, Tuple

from kvui import GameManager

from kivy.clock import Clock

from kivy.uix.boxlayout import BoxLayout
from kivy.uix.gridlayout import GridLayout
from kivy.uix.label import Label
from kivy.uix.layout import Layout
from kivy.uix.scrollview import ScrollView
from kivy.uix.widget import Widget

from . import data, game_install
from .client import LostChapterContext
from .world import LostChapterWorld

COLOR_UNLOCKED = "40d060"
COLOR_LOCKED = "e05050"
COLOR_DONE = "808080"


def event_locations(event_id: int) -> List[int]:
    """The checks an event holds: its first visit and the relics found in it."""
    name = data.EVENTS[event_id]
    locations: List[int] = [data.SWITCH_OFFSET + event_id]

    for weapon_id, relic in data.RELICS.items():
        if name in data.RELIC_SOURCES.get(relic, {}).get("events", []):
            locations.append(data.RELIC_OFFSET + weapon_id)

    return locations


EVENT_LOCATIONS: Dict[int, List[int]] = {event_id: event_locations(event_id) for event_id in data.EVENTS}


class LostChapterTabLayout(BoxLayout):
    ctx: LostChapterContext

    status_label: Label
    progress_label: Label
    events_label: Label
    event_labels: Dict[int, Label]

    def __init__(self, ctx: LostChapterContext) -> None:
        super().__init__(orientation="vertical", spacing="8dp", padding="12dp")

        self.ctx = ctx

        self.status_label = Label(font_size="18dp", halign="left", valign="top", size_hint_y=0.25)
        self.progress_label = Label(font_size="16dp", halign="left", valign="top", size_hint_x=0.4)
        self.events_label = Label(font_size="16dp", halign="left", valign="middle", size_hint_y=None, height="28dp")

        for label in (self.status_label, self.progress_label, self.events_label):
            label.bind(size=label.setter("text_size"))

        event_grid = GridLayout(cols=2, size_hint_y=None, row_default_height="24dp", row_force_default=True)
        event_grid.bind(minimum_height=event_grid.setter("height"))

        self.event_labels = dict()

        for event_id in data.EVENTS:
            label = Label(font_size="15dp", halign="left", valign="middle", markup=True)
            label.bind(size=label.setter("text_size"))

            self.event_labels[event_id] = label
            event_grid.add_widget(label)

        event_scroll = ScrollView(do_scroll_x=False)
        event_scroll.add_widget(event_grid)

        events = BoxLayout(orientation="vertical", size_hint_x=0.6)
        events.add_widget(self.events_label)
        events.add_widget(event_scroll)

        columns = BoxLayout(orientation="horizontal", spacing="12dp", size_hint_y=0.75)
        columns.add_widget(self.progress_label)
        columns.add_widget(events)

        self.add_widget(self.status_label)
        self.add_widget(columns)

        Clock.schedule_interval(self.update, 1.0)

    def update_events(self) -> None:
        ctx = self.ctx

        if not ctx.slot:
            self.events_label.text = ""

            for label in self.event_labels.values():
                label.text = ""

            return

        received = {network_item.item for network_item in ctx.items_received}
        unlocked_count = 0

        for event_id, label in self.event_labels.items():
            unlocked = data.EVENT_OFFSET + event_id in received
            unlocked_count += unlocked

            left = sum(1 for location in EVENT_LOCATIONS[event_id] if location in ctx.missing_locations)
            color = COLOR_UNLOCKED if unlocked else COLOR_LOCKED
            checks = f"{left} left" if left else f"[color={COLOR_DONE}]done[/color]"

            label.text = f"[color={color}]{data.EVENTS[event_id]}[/color]  {checks}"

        self.events_label.text = f"Events unlocked: {unlocked_count}/{len(self.event_labels)}"

    def update(self, *_) -> None:
        ctx = self.ctx
        game_path: Optional[str] = ctx.game_path

        lines: List[str] = [f"Install: {game_path or 'not found (set lost_chapter_options.game_path in host.yaml)'}"]

        if game_path:
            lines.append(f"Plugin: {'installed' if game_install.is_plugin_installed(game_path) else 'not installed (/patch)'}")

        if ctx.bridge.is_game_connected:
            lines.append(f"Game: connected (plugin {ctx.bridge.plugin_version or '?'})")
        else:
            lines.append(f"Game: waiting on port {ctx.bridge.port} (/run)")

        if ctx.floor is not None:
            lines.append(f"Floor: {ctx.floor}")

        self.status_label.text = "\n".join(lines)

        self.update_events()

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
