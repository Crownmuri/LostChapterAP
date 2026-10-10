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

COLOR_UNLOCKED = "40d060"
COLOR_LOCKED = "e05050"
COLOR_DONE = "808080"
COLOR_VALUE = "ffd060"


def event_locations(event_id: int) -> List[int]:
    """The checks an event holds: its first visit and the relics and cards found in it."""
    name = data.EVENTS[event_id]
    locations: List[int] = [data.SWITCH_OFFSET + event_id]

    for weapon_id, relic in data.RELICS.items():
        if name in data.RELIC_SOURCES.get(relic, {}).get("events", []):
            locations.append(data.RELIC_OFFSET + weapon_id)

    for item_id, card in data.CARDS.items():
        if name in data.CARD_SOURCES[card]["events"]:
            locations.append(data.CARD_OFFSET + item_id)

    return locations


EVENT_LOCATIONS: Dict[int, List[int]] = {event_id: event_locations(event_id) for event_id in data.EVENTS}


def label(**kwargs) -> Label:
    """A left aligned label whose text wraps inside it."""
    widget = Label(halign="left", markup=True, **kwargs)
    widget.bind(size=widget.setter("text_size"))

    return widget


def rows(count: int, columns: int, height: str) -> Tuple[ScrollView, List[Label]]:
    """A scrolling grid of labels."""
    grid = GridLayout(cols=columns, size_hint_y=None, row_default_height=height, row_force_default=True)
    grid.bind(minimum_height=grid.setter("height"))

    labels = [label(font_size="14dp", valign="middle") for _ in range(count)]

    for widget in labels:
        grid.add_widget(widget)

    scroll = ScrollView(do_scroll_x=False)
    scroll.add_widget(grid)

    return scroll, labels


class LostChapterTabLayout(BoxLayout):
    ctx: LostChapterContext

    status_label: Label
    run_label: Label
    titles_label: Label
    title_labels: Dict[int, Label]
    events_label: Label
    event_labels: Dict[str, Label]

    def __init__(self, ctx: LostChapterContext) -> None:
        super().__init__(orientation="vertical", spacing="6dp", padding="12dp")

        self.ctx = ctx

        self.status_label = label(font_size="14dp", valign="middle", size_hint_y=None, height="24dp")
        self.run_label = label(font_size="17dp", valign="middle", size_hint_y=None, height="52dp")
        self.titles_label = label(font_size="16dp", valign="middle", size_hint_y=None, height="28dp")
        self.events_label = label(font_size="16dp", valign="middle", size_hint_y=None, height="28dp")

        # All sixteen fit the tab at its smallest without scrolling
        title_scroll, title_rows = rows(len(data.TITLES), 1, "21dp")
        self.title_labels = dict(zip(data.TITLES, title_rows))

        # One row for each unlock, a pair of events shares one
        event_scroll, event_rows = rows(len(data.UNLOCK_EVENTS), 2, "21dp")
        self.event_labels = dict(zip(data.UNLOCK_EVENTS, event_rows))

        titles = BoxLayout(orientation="vertical", size_hint_x=0.5)
        titles.add_widget(self.titles_label)
        titles.add_widget(title_scroll)

        events = BoxLayout(orientation="vertical", size_hint_x=0.5)
        events.add_widget(self.events_label)
        events.add_widget(event_scroll)

        columns = BoxLayout(orientation="horizontal", spacing="12dp")
        columns.add_widget(titles)
        columns.add_widget(events)

        self.add_widget(self.status_label)
        self.add_widget(self.run_label)
        self.add_widget(columns)

        Clock.schedule_interval(self.update, 1.0)

    def update_status(self) -> None:
        ctx = self.ctx
        game_path: Optional[str] = ctx.game_path

        if not game_path:
            plugin = "game not found (set lost_chapter_options.game_path in host.yaml)"
        elif game_install.is_plugin_current(game_path):
            plugin = "plugin installed"
        elif game_install.is_plugin_installed(game_path):
            plugin = "plugin outdated (/patch, then restart the game)"
        else:
            plugin = "plugin not installed (/patch)"

        if ctx.bridge.is_game_connected:
            game = f"game connected (plugin {ctx.bridge.plugin_version or '?'})"
        else:
            game = f"waiting for the game on port {ctx.bridge.port} (/run)"

        self.status_label.text = f"[color={COLOR_DONE}]{plugin}, {game}[/color]"

    def update_run(self) -> None:
        """Where the run stands: the stats the title conditions are about."""
        status = self.ctx.status

        if not self.ctx.bridge.is_game_connected or "faith" not in status:
            self.run_label.text = ""
            return

        def value(name: str, key: str) -> str:
            return f"{name} [color={COLOR_VALUE}]{status.get(key, '?')}[/color]"

        # The second line is what the title "Minerva's Owl" adds up, which also counts a fifth of Max LP + Max RP
        self.run_label.text = "\n".join([
            "    ".join([value("Floor", "floor"), value("FAITH", "faith"), value("VIRTUE", "virtue")]),
            "    ".join([
                value("STR", "str"),
                value("DEF", "def"),
                value("MAG", "mag"),
                value("AGI", "agi"),
                value("LEWD", "lewd"),
                value("TOTAL", "stats") + " / 31",
            ]),
        ])

    def update_titles(self) -> None:
        ctx = self.ctx

        if not ctx.slot:
            self.titles_label.text = "Connect to an Archipelago server to see the titles and events."

            for widget in self.title_labels.values():
                widget.text = ""

            return

        received = {network_item.item for network_item in ctx.items_received}
        shuffled = ctx.slot_data.get("shuffle_title_effects", 1)
        connected = ctx.bridge.is_game_connected
        done = 0

        for number, widget in self.title_labels.items():
            checked = data.SWITCH_OFFSET + data.TITLE_SWITCH_BASE + number in ctx.checked_locations
            effect = not shuffled or data.TITLE_OFFSET + number in received
            done += checked

            requirement = data.TITLE_REQUIREMENTS[number]
            stat = data.TITLE_STATS.get(number)

            if checked:
                requirement = f"[color={COLOR_DONE}]{requirement}, done[/color]"
            elif stat and connected and stat in ctx.status:
                requirement += f" [color={COLOR_VALUE}](now {ctx.status[stat]})[/color]"

            color = COLOR_UNLOCKED if effect else COLOR_LOCKED

            widget.text = f"[color={color}]{data.TITLES[number]}[/color]  {requirement}"

        self.titles_label.text = f"Titles: {done}/{len(self.title_labels)}"

    def update_events(self) -> None:
        ctx = self.ctx

        if not ctx.slot:
            self.events_label.text = ""

            for widget in self.event_labels.values():
                widget.text = ""

            return

        received = {network_item.item for network_item in ctx.items_received}
        unlocked_count = 0

        # A seed without the DLC has no use for its events. Older seeds do not list theirs.
        seed_events = ctx.slot_data.get("events")
        unlock_total = 0

        for unlock, widget in self.event_labels.items():
            event_ids = data.UNLOCK_EVENTS[unlock]

            if seed_events is not None and event_ids[0] not in seed_events:
                widget.text = ""
                continue

            if seed_events is None and event_ids[0] in data.DLC_EVENTS:
                widget.text = ""
                continue

            unlock_total += 1

            # A seed from before the pairs has an unlock for each of the two events
            unlocked = any(data.EVENT_OFFSET + event_id in received for event_id in event_ids)
            unlocked_count += unlocked

            left = sum(
                1 for event_id in event_ids for location in EVENT_LOCATIONS[event_id]
                if location in ctx.missing_locations
            )
            color = COLOR_UNLOCKED if unlocked else COLOR_LOCKED
            # Short enough for the longest name to stay on one line
            checks = f"({left})" if left else f"[color={COLOR_DONE}](0)[/color]"

            widget.text = f"[color={color}]{unlock}[/color] {checks}"

        self.events_label.text = f"Events: {unlocked_count}/{unlock_total} unlocked (checks left)"

    def update(self, *_) -> None:
        self.update_status()
        self.update_run()
        self.update_titles()
        self.update_events()


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
