from typing import Any, Dict, List, Union

import settings

from BaseClasses import CollectionState, Item, ItemClassification, Location, LocationProgressType, Region, Tutorial

from worlds.AutoWorld import WebWorld, World

from . import data
from Options import OptionError

from .options import LostChapterOptions


SLOT_DATA_OPTIONS = (
    "goal", "include_dlc", "relicsanity", "shuffle_keys", "first_victories", "shuffle_title_effects",
    "finisher_move", "soul_multiplier",
)


def location_table() -> Dict[str, int]:
    table: Dict[str, int] = {}

    for switch_id, name in list(data.HEAVENLY_KINGS.items()) + list(data.DLC_BOSSES.items()):
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

    table[data.WHITE_KEY] = data.RELIC_OFFSET + data.WHITE_KEY_ID

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
        "Relics": set(data.RELICS.values()) | {data.WHITE_KEY},
        "Events": {f"Event: {unlock}" for unlock in data.UNLOCK_EVENTS},
        "Door Keys": set(data.DOOR_KEYS.values()),
        "Title Effects": {f"Unlock Title Effect: {name}" for name in data.TITLES.values()},
        "Starting Sets": {f"Starting {name}" for name in data.STARTING_SETS.values()},
    }
    location_name_groups = {
        "Heavenly Kings": {f"Defeat {name}" for name in data.HEAVENLY_KINGS.values()},
        "DLC Bosses": {f"Defeat {name}" for name in data.DLC_BOSSES.values()},
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

        if self.options.goal == "dlc_ending" and not self.options.include_dlc:
            raise OptionError(f"{self.player_name}: the dlc_ending goal of Lost Chapter needs include_dlc")

        if passthrough:
            # Seeds from before the starting events have none
            self.starting_events = list(passthrough.get("starting_events", []))
        else:
            self.starting_events = self.pick_starting_events()

    def events(self) -> Dict[int, str]:
        """The floor events of this seed."""
        return {
            event_id: name for event_id, name in data.EVENTS.items()
            if self.options.include_dlc or event_id not in data.DLC_EVENTS
        }

    def unlocks(self) -> List[str]:
        """The names of the event unlocks of this seed."""
        return [unlock for unlock, event_ids in data.UNLOCK_EVENTS.items() if event_ids[0] in self.events()]

    def enemies(self) -> Dict[int, str]:
        """The enemies whose first victory is a check."""
        if not self.options.first_victories:
            return {}

        return {
            troop_id: name for troop_id, name in data.ENEMIES.items()
            if self.options.include_dlc or troop_id not in data.DLC_ENEMIES
        }

    def relic_locations(self) -> Dict[int, str]:
        """The relics whose place in an event is a check."""
        if not self.options.relicsanity:
            return {}

        relics = {
            weapon_id: name for weapon_id, name in data.RELICS.items()
            if self.options.include_dlc or weapon_id not in data.DLC_RELICS
        }

        if not self.options.shuffle_keys:
            del relics[data.BLACK_KEY_ID]

        return relics

    def relic_items(self) -> List[str]:
        """The relics that are items. The White Key is one without a place of its own."""
        relics = list(self.relic_locations().values())

        if self.options.relicsanity and self.options.shuffle_keys and self.options.include_dlc:
            relics.append(data.WHITE_KEY)

        return relics

    def pick_starting_events(self) -> List[str]:
        """The named starting unlocks, filled up with random early ones to the starting event count."""
        events: List[str] = sorted(self.options.starting_events.value)
        unlocks = self.unlocks()

        for event in events:
            if event not in unlocks:
                raise OptionError(f"{self.player_name}: the starting event {event} of Lost Chapter needs include_dlc")

        def early(event_id: int) -> bool:
            return event_id < data.LATE_EVENT_FIRST and event_id not in data.CONDITIONAL_EVENTS

        candidates = [
            unlock for unlock in unlocks
            if unlock not in events and any(early(event_id) for event_id in data.UNLOCK_EVENTS[unlock])
        ]
        missing = max(0, self.options.starting_event_count.value - len(events))

        return events + self.random.sample(candidates, min(missing, len(candidates)))

    def included_locations(self) -> Dict[str, int]:
        included: set = set(self.location_name_to_id)

        included -= self.location_name_groups["Relics"]
        included |= {f"Relic: {name}" for name in self.relic_locations().values()}

        included -= self.location_name_groups["First Victories"]
        included |= {f"First Victory: {name}" for name in self.enemies().values()}

        included -= self.location_name_groups["Events"]
        included |= {data.first_visit(event_id) for event_id in self.events()}

        if not self.options.include_dlc:
            included -= self.location_name_groups["DLC Bosses"]

        return {name: loc_id for name, loc_id in self.location_name_to_id.items() if name in included}

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

        for troop_id, name in self.enemies().items():
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

        for event_id, name in self.events().items():
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

        for name in self.relic_locations().values():
            self.get_location(f"Relic: {name}").access_rule = lambda state, name=name: self.can_find_relic(state, name)

        if self.options.include_dlc:
            for switch_id, name in data.DLC_BOSSES.items():
                self.get_location(f"Defeat {name}").access_rule = (
                    lambda state, key=data.DLC_BOSS_KEYS[switch_id]: self.has_relic(state, key)
                )

        if self.options.goal == "dlc_ending":
            # The last door of the DLC opens with both of its bosses defeated in the same run
            self.get_location(data.ENDING_EVENT).access_rule = (
                lambda state: all(self.has_relic(state, key) for key in data.DLC_BOSS_KEYS.values())
            )
        else:
            # The last boss is one of the doors of floor 100, which takes all four Heavenly Kings defeated
            self.get_location(data.ENDING_EVENT).access_rule = (
                lambda state: state.has_group("Door Keys", player, len(data.HEAVENLY_KINGS))
            )

    def can_find_relic(self, state: CollectionState, name: str) -> bool:
        """The place of a relic can be reached: its events, the floor they come up on and what it is traded for."""
        source = data.RELIC_SOURCES[name]
        late = any(data.EVENT_IDS[event] >= data.LATE_EVENT_FIRST for event in source["events"])

        return (
            state.has_all([data.event_item(event) for event in source["events"]], self.player)
            and self.can_reach_floor(state, data.LATE_EVENT_FLOOR if late else 1)
            and all(self.has_relic(state, relic) for relic in source["relics"])
        )

    def has_relic(self, state: CollectionState, name: str) -> bool:
        """A relic can be held: as the item it is in this seed, or picked up in the game where it is not one."""
        if name in self.relic_items():
            return state.has(name, self.player)

        return self.can_find_relic(state, name)

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
        names = set(self.item_name_groups["Door Keys"] | self.item_name_groups["Starting Sets"])
        names |= {f"Event: {unlock}" for unlock in self.unlocks()}

        if self.options.shuffle_title_effects:
            names |= self.item_name_groups["Title Effects"]

        for event in self.starting_events:
            names.discard(f"Event: {event}")
            self.multiworld.push_precollected(self.create_item(f"Event: {event}"))

        if self.options.finisher_move == "shuffle":
            names.add(data.FINISHER)

        pool: List[LostChapterItem] = [self.create_item(name) for name in sorted(names)]

        pool += [self.create_item(name) for name in self.relic_items()]

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
        slot_data["events"] = sorted(self.events())
        slot_data["relics"] = sorted(self.relic_locations())

        return slot_data

    @staticmethod
    def interpret_slot_data(slot_data: Dict[str, Any]) -> Dict[str, Any]:
        return slot_data
