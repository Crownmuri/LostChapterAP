from typing import Any, Dict, List, Union

import settings

from BaseClasses import CollectionState, Item, ItemClassification, Location, Region, Tutorial

from worlds.AutoWorld import WebWorld, World

from . import data
from .options import LostChapterOptions


SLOT_DATA_OPTIONS = ("goal", "relicsanity", "first_victories", "shuffle_title_effects", "soul_multiplier")


def location_table() -> Dict[str, int]:
    table: Dict[str, int] = {}

    for switch_id, name in data.HEAVENLY_KINGS.items():
        table[f"Defeat {name}"] = data.SWITCH_OFFSET + switch_id

    for number, name in data.TITLES.items():
        table[f"Title: {name}"] = data.SWITCH_OFFSET + data.TITLE_SWITCH_BASE + number

    for troop_id, name in data.ENEMIES.items():
        table[f"First Victory: {name}"] = data.TROOP_OFFSET + troop_id

    for weapon_id, name in data.RELICS.items():
        table[f"Relic: {name}"] = data.RELIC_OFFSET + weapon_id

    for floor in data.FLOOR_CHECKS:
        table[f"Reach Floor {floor}"] = data.FLOOR_OFFSET + floor

    for event_id, name in data.EVENTS.items():
        table[f"First Visit: {name}"] = data.SWITCH_OFFSET + event_id

    for milestone in data.SOUL_MILESTONES:
        table[f"Souls: {milestone}"] = data.SOUL_OFFSET + milestone

    return table


def item_table() -> Dict[str, int]:
    table: Dict[str, int] = {name: item_id for item_id, name in data.FILLER.items()}

    for weapon_id, name in data.RELICS.items():
        table[name] = data.RELIC_OFFSET + weapon_id

    for event_id, name in data.EVENTS.items():
        table[f"Event: {name}"] = data.EVENT_OFFSET + event_id

    for switch_id, name in data.HEAVENLY_KINGS.items():
        table[f"Boss Unlock: {name}"] = data.BOSS_OFFSET + switch_id

    for number, name in data.TITLES.items():
        table[f"Unlock Title Effect: {name}"] = data.TITLE_OFFSET + number

    for bonus_id, name in data.STARTING_SETS.items():
        table[f"Starting {name}"] = data.SET_OFFSET + bonus_id

    return table


class LostChapterItem(Item):
    game = data.GAME_NAME


class LostChapterLocation(Location):
    game = data.GAME_NAME


class LostChapterSettings(settings.Group):
    class GamePath(str):
        """Lost Chapter install folder. Leave empty to locate it through Steam."""

    class BridgePort(int):
        """Local port the client listens on for the in-game plugin."""

    class DevMode(settings.Bool):
        """Allows the client's /dev commands: set the floor, stats and items, god mode."""

    game_path: GamePath = GamePath("")
    bridge_port: BridgePort = BridgePort(38472)
    dev_mode: Union[DevMode, bool] = False


class LostChapterWebWorld(WebWorld):
    theme: str = "dirt"

    tutorials: List[Tutorial] = [
        Tutorial(
            "Multiworld Setup Guide",
            "A guide to setting up the Lost Chapter randomizer connected to an Archipelago Multiworld",
            "English",
            "setup_en.md",
            "setup/en",
            ["Crownmuri"],
        )
    ]


class LostChapterWorld(World):
    """
    Lost Chapter is a roguelike deckbuilder. Climb floor by floor through random events and card battles,
    defeat the four Heavenly Kings and face what waits in the dark.
    """

    options_dataclass = LostChapterOptions
    options: LostChapterOptions

    settings: LostChapterSettings

    game = data.GAME_NAME

    item_name_to_id = item_table()
    location_name_to_id = location_table()

    item_name_groups = {
        "Relics": set(data.RELICS.values()),
        "Events": {f"Event: {name}" for name in data.EVENTS.values()},
        "Boss Unlocks": {f"Boss Unlock: {name}" for name in data.HEAVENLY_KINGS.values()},
        "Title Effects": {f"Unlock Title Effect: {name}" for name in data.TITLES.values()},
        "Starting Sets": {f"Starting {name}" for name in data.STARTING_SETS.values()},
    }
    location_name_groups = {
        "Heavenly Kings": {f"Defeat {name}" for name in data.HEAVENLY_KINGS.values()},
        "Titles": {f"Title: {name}" for name in data.TITLES.values()},
        "First Victories": {f"First Victory: {name}" for name in data.ENEMIES.values()},
        "Relics": {f"Relic: {name}" for name in data.RELICS.values()},
        "Floors": {f"Reach Floor {floor}" for floor in data.FLOOR_CHECKS},
        "Events": {f"First Visit: {name}" for name in data.EVENTS.values()},
        "Souls": {f"Souls: {milestone}" for milestone in data.SOUL_MILESTONES},
    }

    required_client_version = (0, 6, 7)

    web = LostChapterWebWorld()

    # Universal Tracker
    ut_can_gen_without_yaml: bool = True

    def generate_early(self) -> None:
        # Universal Tracker regenerates the world from slot data instead of a yaml
        passthrough: Dict[str, Any] = getattr(self.multiworld, "re_gen_passthrough", {}).get(self.game, {})

        for option_name in SLOT_DATA_OPTIONS:
            if option_name in passthrough:
                getattr(self.options, option_name).value = passthrough[option_name]

    def included_locations(self) -> Dict[str, int]:
        excluded: set = set()

        if not self.options.relicsanity:
            excluded |= self.location_name_groups["Relics"]

        if not self.options.first_victories:
            excluded |= self.location_name_groups["First Victories"]

        return {name: loc_id for name, loc_id in self.location_name_to_id.items() if name not in excluded}

    def create_regions(self) -> None:
        menu = Region("Menu", self.player, self.multiworld)
        run = Region("The Dark", self.player, self.multiworld)

        self.multiworld.regions += [menu, run]
        menu.connect(run)

        run.add_locations(self.included_locations(), LostChapterLocation)

        ending = LostChapterLocation(self.player, data.ENDING_EVENT, None, run)
        ending.place_locked_item(self.create_event(data.VICTORY))
        run.locations.append(ending)

        self.multiworld.completion_condition[self.player] = lambda state: state.has(data.VICTORY, self.player)

    def can_reach_floor(self, state: CollectionState, floor: int) -> bool:
        # Every boss floor below takes a Heavenly King defeated there, each of them a boss unlock
        return state.has_group("Boss Unlocks", self.player, (floor - 1) // data.BOSS_FLOOR_INTERVAL)

    def set_rules(self) -> None:
        # Fights have no rules yet. Titles only have rules where the condition is a Heavenly King.
        player = self.player

        for floor in data.FLOOR_CHECKS:
            self.get_location(f"Reach Floor {floor}").access_rule = (
                lambda state, floor=floor: self.can_reach_floor(state, floor)
            )

        for event_id, name in data.EVENTS.items():
            floor = data.LATE_EVENT_FLOOR if event_id >= data.LATE_EVENT_FIRST else 1

            self.get_location(f"First Visit: {name}").access_rule = (
                lambda state, item=f"Event: {name}", floor=floor: (
                    state.has(item, player) and self.can_reach_floor(state, floor)
                )
            )

        for name in data.HEAVENLY_KINGS.values():
            self.get_location(f"Defeat {name}").access_rule = (
                lambda state, item=f"Boss Unlock: {name}": state.has(item, player)
            )

        for number, king in data.TITLE_KINGS.items():
            self.get_location(f"Title: {data.TITLES[number]}").access_rule = (
                lambda state, item=f"Boss Unlock: {king}": state.has(item, player)
            )

        if self.options.relicsanity:
            event_ids = {name: event_id for event_id, name in data.EVENTS.items()}

            for name, source in data.RELIC_SOURCES.items():
                required = [f"Event: {event}" for event in source["events"]] + source["relics"]
                late = any(event_ids[event] >= data.LATE_EVENT_FIRST for event in source["events"])
                floor = data.LATE_EVENT_FLOOR if late else 1

                self.get_location(f"Relic: {name}").access_rule = (
                    lambda state, items=required, floor=floor: (
                        state.has_all(items, player) and self.can_reach_floor(state, floor)
                    )
                )

        # The last boss appears on a boss floor once all four Heavenly Kings are defeated
        self.get_location(data.ENDING_EVENT).access_rule = (
            lambda state: state.has_group("Boss Unlocks", player, len(data.HEAVENLY_KINGS))
        )

    def create_item(self, name: str) -> LostChapterItem:
        classification = ItemClassification.progression

        if name in data.FILLER.values():
            classification = ItemClassification.filler
        elif name in self.item_name_groups["Title Effects"] | self.item_name_groups["Starting Sets"]:
            classification = ItemClassification.useful

        return LostChapterItem(name, classification, self.item_name_to_id[name], self.player)

    def create_event(self, name: str) -> LostChapterItem:
        return LostChapterItem(name, ItemClassification.progression, None, self.player)

    def create_items(self) -> None:
        names = (
            self.item_name_groups["Events"]
            | self.item_name_groups["Boss Unlocks"]
            | self.item_name_groups["Starting Sets"]
        )

        if self.options.shuffle_title_effects:
            names |= self.item_name_groups["Title Effects"]

        pool: List[LostChapterItem] = [self.create_item(name) for name in sorted(names)]

        if self.options.relicsanity:
            pool += [self.create_item(name) for name in data.RELICS.values()]

        while len(pool) < len(self.included_locations()):
            pool.append(self.create_filler())

        self.multiworld.itempool += pool

    def get_filler_item_name(self) -> str:
        return self.random.choices(list(data.FILLER.values()), weights=[3, 1])[0]

    def fill_slot_data(self) -> Dict[str, Any]:
        return self.options.as_dict(*SLOT_DATA_OPTIONS)

    @staticmethod
    def interpret_slot_data(slot_data: Dict[str, Any]) -> Dict[str, Any]:
        return slot_data
