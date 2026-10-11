from typing import Dict, List, Optional, Tuple

from kvui import GameManager

from kivy.clock import Clock

from kivy.graphics import Color, Line, Rectangle
from kivy.metrics import dp
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

# The color of a title's name is where the title stands in logic. The square in front of it only says whether its
# effect is unlocked.
SQUARE = (0.8, 0.8, 0.8)
IN_LOGIC = (0.25, 0.82, 0.38)
BY_GRINDING = (1.0, 0.82, 0.38)
OUT_OF_LOGIC = (0.88, 0.31, 0.31)


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


class Square(Widget):
    """A small square, filled or only outlined, drawn rather than written: the font has no such character."""

    def __init__(self, **kwargs) -> None:
        super().__init__(**kwargs)

        self.shown: Optional[Tuple[Tuple[float, float, float], bool]] = None
        self.bind(pos=self.redraw, size=self.redraw)

    def show(self, color: Optional[Tuple[float, float, float]], filled: bool = True) -> None:
        shown = None if color is None else (color, filled)

        if shown != self.shown:
            self.shown = shown
            self.redraw()

    def redraw(self, *_) -> None:
        self.canvas.clear()

        if self.shown is None:
            return

        color, filled = self.shown
        side = dp(11)
        x = self.x + dp(2)
        y = self.center_y - side / 2

        with self.canvas:
            Color(*color, 1)

            if filled:
                Rectangle(pos=(x, y), size=(side, side))
            else:
                Line(rectangle=(x, y, side, side), width=dp(1))


def title_rows(count: int, height: str) -> Tuple[ScrollView, List[Tuple[Square, Label]]]:
    """A scrolling list of rows that are a square and a label."""
    column = BoxLayout(orientation="vertical", size_hint_y=None)
    column.bind(minimum_height=column.setter("height"))

    widgets = []

    for _ in range(count):
        row = BoxLayout(orientation="horizontal", size_hint_y=None, height=height)
        square = Square(size_hint_x=None, width="18dp")
        text = label(font_size="14dp", valign="middle")

        row.add_widget(square)
        row.add_widget(text)
        column.add_widget(row)
        widgets.append((square, text))

    scroll = ScrollView(do_scroll_x=False)
    scroll.add_widget(column)

    return scroll, widgets


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
    title_rows: Dict[int, Tuple[Square, Label]]
    legend_label: Label
    events_label: Label
    event_labels: Dict[str, Label]

    def __init__(self, ctx: LostChapterContext) -> None:
        super().__init__(orientation="vertical", spacing="6dp", padding="12dp")

        self.ctx = ctx

        self.status_label = label(font_size="14dp", valign="middle", size_hint_y=None, height="24dp")
        self.run_label = label(font_size="17dp", valign="middle", size_hint_y=None, height="52dp")
        self.titles_label = label(font_size="16dp", valign="middle", size_hint_y=None, height="28dp")
        self.events_label = label(font_size="16dp", valign="middle", size_hint_y=None, height="28dp")

        self.legend_label = label(font_size="13dp", valign="middle", size_hint_y=None, height="20dp")

        # All sixteen fit the tab at its smallest without scrolling
        title_scroll, widgets = title_rows(len(data.TITLES), "21dp")
        self.title_rows = dict(zip(data.TITLES, widgets))

        # One row for each unlock, a pair of events shares one
        event_scroll, event_rows = rows(len(data.UNLOCK_EVENTS), 2, "21dp")
        self.event_labels = dict(zip(data.UNLOCK_EVENTS, event_rows))

        titles = BoxLayout(orientation="vertical", size_hint_x=0.5)
        titles.add_widget(self.titles_label)
        titles.add_widget(self.legend_label)
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
            "    ".join([value("Floor", "floor"), value("FAITH", "faith"), value("VIRTUE", "virtue"), value("Souls", "souls")]),
            "    ".join([
                value("STR", "str"),
                value("DEF", "def"),
                value("MAG", "mag"),
                value("AGI", "agi"),
                value("LEWD", "lewd"),
                value("TOTAL", "stats") + " / 31",
            ]),
        ])

    def title_standing(self, number: int, received: set) -> Tuple[float, float, float]:
        """Where a title stands in logic, from the door keys and the event unlocks this slot has."""
        keys = {name: data.BOSS_OFFSET + switch_id for switch_id, name in data.DOOR_KEYS.items()}
        kings = {name: data.DOOR_KEYS[switch_id] for switch_id, name in data.HEAVENLY_KINGS.items()}

        if number in data.TITLE_KINGS:
            return IN_LOGIC if keys[kings[data.TITLE_KINGS[number]]] in received else OUT_OF_LOGIC

        def unlocked(event: str) -> bool:
            unlock = data.EVENT_UNLOCKS[data.EVENT_IDS[event]]
            return data.EVENT_OFFSET + data.UNLOCK_EVENTS[unlock][0] in received

        events = data.title_events(number, bool(self.ctx.slot_data.get("include_dlc")))
        floor = data.TITLE_FLOORS.get(number, 1)
        needed = min((floor - 1) // data.BOSS_FLOOR_INTERVAL, len(keys))

        if events and not any(unlocked(event) for event in events):
            return OUT_OF_LOGIC

        # Without the floors logic asks for, the title is still there for whoever takes the same events or fights
        # over and over
        return IN_LOGIC if sum(1 for item_id in keys.values() if item_id in received) >= needed else BY_GRINDING

    def update_titles(self) -> None:
        ctx = self.ctx

        if not ctx.slot:
            self.titles_label.text = "Connect to an Archipelago server to see the titles and events."
            self.legend_label.text = ""

            for square, widget in self.title_rows.values():
                square.show(None)
                widget.text = ""

            return

        received = {network_item.item for network_item in ctx.items_received}
        shuffled = ctx.slot_data.get("shuffle_title_effects", 1)
        connected = ctx.bridge.is_game_connected
        done = 0

        for number, (square, widget) in self.title_rows.items():
            checked = data.SWITCH_OFFSET + data.TITLE_SWITCH_BASE + number in ctx.checked_locations
            effect = not shuffled or data.TITLE_OFFSET + number in received
            done += checked

            requirement = data.TITLE_REQUIREMENTS[number]
            stat = data.TITLE_STATS.get(number)

            if checked:
                widget.text = f"[color={COLOR_DONE}]{data.TITLES[number]}  {requirement}, done[/color]"
            else:
                if stat and connected and stat in ctx.status:
                    requirement += f" [color={COLOR_VALUE}](now {ctx.status[stat]})[/color]"

                standing = "".join(f"{round(part * 255):02x}" for part in self.title_standing(number, received))

                widget.text = f"[color={standing}]{data.TITLES[number]}[/color]  [color=b0b0b0]{requirement}[/color]"

            # Filled once the effect of the title is unlocked
            square.show(SQUARE, effect)

        self.titles_label.text = f"Titles: {done}/{len(self.title_rows)}"
        # Short enough for one line at the tab's smallest width
        colors = ["".join(f"{round(part * 255):02x}" for part in color) for color in (IN_LOGIC, BY_GRINDING, OUT_OF_LOGIC)]
        self.legend_label.text = (
            f"[color={COLOR_DONE}]filled: effect unlocked[/color]   [color={colors[0]}]in logic[/color]   "
            f"[color={colors[1]}]grinding[/color]   [color={colors[2]}]not yet[/color]"
        )

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
