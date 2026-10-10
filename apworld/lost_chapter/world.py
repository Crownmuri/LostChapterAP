from typing import Any, Dict, List, Union

import settings

from BaseClasses import CollectionState, Item, ItemClassification, Location, LocationProgressType, Region, Tutorial

from worlds.AutoWorld import WebWorld, World

from . import data
from .options import LostChapterOptions


SLOT_DATA_OPTIONS = (
    "goal", "relicsanity", "first_victories", "shuffle_title_effects", "finisher_move", "soul_multiplier"
)


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
        table[data.first_visit(event_id)] = data.SWITCH_OFFSET + event_id

    for milestone in data.SOUL_MILESTONES:
        table[f"Souls: {milestone}"] = data.SOUL_OFFSET + milestone

    return table


def item_table() -> Dict[str, int]:
    table: Dict[str, int] = {name: item_id for item_id, name in data.FILLER.items()}
    table[data.FINISHER] = data.FINISHER_ID

    for weapon_id, name in data.RELICS.items():
        table[name] = data.RELIC_OFFSET + weapon_id

    for unlock, event_ids in data.UNLOCK_EVENTS.items():
        table[f"Event: {unlock}"] = data.EVENT_OFFSET + event_ids[0]

    for switch_id, name in data.DOOR_KEYS.items():
        table[name] = data.BOSS_OFFSET + switch_id

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

    starting_events: List[str]

    game = data.GAME_NAME

    item_name_to_id = item_table()
    location_name_to_id = location_table()

    item_name_groups = {
        "Relics": set(data.RELICS.values()),
        "Events": {f"Event: {unlock}" for unlock in data.UNLOCK_EVENTS},
        "Door Keys": set(data.DOOR_KEYS.values()),
        "Title Effects": {f"Unlock Title Effect: {name}" for name in data.TITLES.values()},
        "Starting Sets": {f"Starting {name}" for name in data.STARTING_SETS.values()},
    }
    location_name_groups = {
        "Heavenly Kings": {f"Defeat {name}" for name in data.HEAVENLY_KINGS.values()},
        "Titles": {f"Title: {name}" for name in data.TITLES.values()},
        "First Victories": {f"First Victory: {name}" for name in data.ENEMIES.values()},
        "Relics": {f"Relic: {name}" for name in data.RELICS.values()},
        "Floors": {f"Reach Floor {floor}" for floor in data.FLOOR_CHECKS},
        "Events": {data.first_visit(event_id) for event_id in data.EVENTS},
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

        if passthrough:
            # Seeds from before the starting events have none
            self.starting_events = list(passthrough.get("starting_events", []))
        else:
            self.starting_events = self.pick_starting_events()

    def pick_starting_events(self) -> List[str]:
        """The named starting unlocks, filled up with random early ones to the starting event count."""
        events: List[str] = sorted(self.options.starting_events.value)

        def early(event_id: int) -> bool:
            return event_id < data.LATE_EVENT_FIRST and event_id not in data.CONDITIONAL_EVENTS

        candidates = [
            unlock for unlock, event_ids in data.UNLOCK_EVENTS.items()
            if unlock not in events and any(early(event_id) for event_id in event_ids)
        ]
        missing = max(0, self.options.starting_event_count.value - len(events))

        return events + self.random.sample(candidates, min(missing, len(candidates)))

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
        # Every boss floor below takes a Heavenly King defeated there, each of them a door key. From floor 100 on
        # the doors no longer hold the climb up.
        keys = min((floor - 1) // data.BOSS_FLOOR_INTERVAL, len(data.DOOR_KEYS))

        return state.has_group("Door Keys", self.player, keys)

    def set_rules(self) -> None:
        # Fights only have a rule for the floor the enemy shows up on, not for how hard they are
        player = self.player

        if self.options.first_victories:
            for troop_id, name in data.ENEMIES.items():
                self.get_location(f"First Victory: {name}").access_rule = (
                    lambda state, floor=data.ENEMY_FLOORS[troop_id]: self.can_reach_floor(state, floor)
                )

        for floor in data.FLOOR_CHECKS:
            self.get_location(f"Reach Floor {floor}").access_rule = (
                lambda state, floor=floor: self.can_reach_floor(state, floor)
            )

        for milestone, floor in data.SOUL_MILESTONES.items():
            self.get_location(f"Souls: {milestone}").access_rule = (
                lambda state, floor=floor: self.can_reach_floor(state, floor)
            )

        for event_id, name in data.EVENTS.items():
            floor = data.LATE_EVENT_FLOOR if event_id >= data.LATE_EVENT_FIRST else 1

            self.get_location(data.first_visit(event_id)).access_rule = (
                lambda state, item=data.event_item(name), floor=floor: (
                    state.has(item, player) and self.can_reach_floor(state, floor)
                )
            )

        door_keys = {name: data.DOOR_KEYS[switch_id] for switch_id, name in data.HEAVENLY_KINGS.items()}

        for name, key in door_keys.items():
            self.get_location(f"Defeat {name}").access_rule = lambda state, item=key: state.has(item, player)

        for number, king in data.TITLE_KINGS.items():
            self.get_location(f"Title: {data.TITLES[number]}").access_rule = (
                lambda state, item=door_keys[king]: state.has(item, player)
            )

        # With the virgin end the "Lose Virginity" title costs a run, so nothing worth having is put there
        if self.options.goal == "virgin_end":
            self.get_location(f"Title: {data.TITLES[data.TITLE_LOSE_VIRGINITY]}").progress_type = (
                LocationProgressType.EXCLUDED
            )

        # A title about FAITH, VIRTUE, LEWD or the stats takes an event that moves them
        for number, events in data.TITLE_EVENTS.items():
            self.get_location(f"Title: {data.TITLES[number]}").access_rule = (
                lambda state, items=[data.event_item(event) for event in events]: state.has_any(items, player)
            )

        if self.options.relicsanity:
            for name, source in data.RELIC_SOURCES.items():
                required = [data.event_item(event) for event in source["events"]] + source["relics"]
                late = any(data.EVENT_IDS[event] >= data.LATE_EVENT_FIRST for event in source["events"])
                floor = data.LATE_EVENT_FLOOR if late else 1

                self.get_location(f"Relic: {name}").access_rule = (
                    lambda state, items=required, floor=floor: (
                        state.has_all(items, player) and self.can_reach_floor(state, floor)
                    )
                )

        # The last boss appears on a boss floor once all four Heavenly Kings are defeated
        self.get_location(data.ENDING_EVENT).access_rule = (
            lambda state: state.has_group("Door Keys", player, len(data.HEAVENLY_KINGS))
        )

    def create_item(self, name: str) -> LostChapterItem:
        classification = ItemClassification.progression

        if name in data.FILLER.values():
            classification = ItemClassification.filler
        elif name in self.item_name_groups["Door Keys"]:
            classification = ItemClassification.progression | ItemClassification.useful
        elif name == data.FINISHER:
            classification = ItemClassification.useful
        elif name in self.item_name_groups["Title Effects"] | self.item_name_groups["Starting Sets"]:
            classification = ItemClassification.useful

        return LostChapterItem(name, classification, self.item_name_to_id[name], self.player)

    def create_event(self, name: str) -> LostChapterItem:
        return LostChapterItem(name, ItemClassification.progression, None, self.player)

    def create_items(self) -> None:
        names = set(
            self.item_name_groups["Events"]
            | self.item_name_groups["Door Keys"]
            | self.item_name_groups["Starting Sets"]
        )

        if self.options.shuffle_title_effects:
            names |= self.item_name_groups["Title Effects"]

        for event in self.starting_events:
            names.discard(f"Event: {event}")
            self.multiworld.push_precollected(self.create_item(f"Event: {event}"))

        if self.options.finisher_move == "shuffle":
            names.add(data.FINISHER)

        pool: List[LostChapterItem] = [self.create_item(name) for name in sorted(names)]

        if self.options.relicsanity:
            pool += [self.create_item(name) for name in data.RELICS.values()]

        while len(pool) < len(self.included_locations()):
            pool.append(self.create_filler())

        self.multiworld.itempool += pool

    def get_filler_item_name(self) -> str:
        return self.random.choices(list(data.FILLER.values()), weights=[3, 1])[0]

    def fill_slot_data(self) -> Dict[str, Any]:
        slot_data = self.options.as_dict(*SLOT_DATA_OPTIONS)
        slot_data["soul_milestones"] = list(data.SOUL_MILESTONES)
        slot_data["starting_events"] = self.starting_events
        slot_data["event_groups"] = data.EVENT_GROUPS

        return slot_data

    @staticmethod
    def interpret_slot_data(slot_data: Dict[str, Any]) -> Dict[str, Any]:
        return slot_data
