"""
Static tables shared by generation and the client.

AP ids are derived from the game's own database ids, so the in-game plugin
(game_plugin/LostChapterAP.js) can compute them without a lookup table.
Keep the offsets in sync with the constants at the top of that file.
"""
from typing import Dict, List, Tuple

GAME_NAME = "Lost Chapter"
STEAM_APP_ID = 2356470

SWITCH_OFFSET = 1000  # location id = offset + game switch id
TROOP_OFFSET = 2000   # location id = offset + troop id
RELIC_OFFSET = 3000   # location id and item id = offset + weapon id
FLOOR_OFFSET = 4000   # location id = offset + floor number
EVENT_OFFSET = 5000   # item id = offset + common event id (the first visit location uses SWITCH_OFFSET)
BOSS_OFFSET = 6000    # item id = offset + the Heavenly King's switch id
TITLE_OFFSET = 7000   # item id = offset + title number
SET_OFFSET = 8000     # item id = offset + bonus id of the card set
BATTLE_OFFSET = 11000  # location id = offset + 100 * stretch of floors (1-10) + number of the reward
CARD_OFFSET = 9000    # location id and item id = offset + item id of the card
# 10000 was the offset of the soul milestones, which are no locations any more

# A Heavenly King waits on every 20th floor (common event 86 "---Standby End---"). The plugin only lets the climb
# go on once one of them is defeated there, so every boss floor passed takes one more door key.
BOSS_FLOOR_INTERVAL = 20
FLOOR_CHECKS = range(10, 81, 10)

# Battle rewards: one of the cards a won fight offers is a check. Each stretch of 20 floors up to the floor of the
# final boss (the required_floor option, 100 to 200) has its own, as many as the battle_rewards option says.
BATTLE_STRETCHES = 10
BATTLE_REWARDS_MAX = 10


def battle_stretches(required_floor: int) -> int:
    """The stretches of 20 floors up to the boss floor the final boss waits on."""
    return -(-required_floor // BOSS_FLOOR_INTERVAL)


def battle_reward(stretch: int, number: int) -> str:
    """Name of a battle reward location. Stretch 1 is floors 1-20."""
    first = (stretch - 1) * BOSS_FLOOR_INTERVAL + 1

    return f"Floors {first}-{first + BOSS_FLOOR_INTERVAL - 1}: Battle Reward {number}"


def battle_rewards(count: int = BATTLE_REWARDS_MAX, stretches: int = BATTLE_STRETCHES) -> Dict[str, Tuple[int, int]]:
    """Battle reward location name -> its id and the first floor of its stretch."""
    return {
        battle_reward(stretch, number): (
            BATTLE_OFFSET + 100 * stretch + number, (stretch - 1) * BOSS_FLOOR_INTERVAL + 1
        )
        for stretch in range(1, stretches + 1)
        for number in range(1, count + 1)
    }

# Floor events from this id on are only offered above this floor (common event 86)
LATE_EVENT_FIRST = 57
LATE_EVENT_FLOOR = 41

# Souls are the score the bonus shop spends. Common event 72 computes the score of a run:
# (Max LP + Max RP + Gold + fluids) / 10 + STR + DEF + MAG + AGL + LEWD + Floor + counts, plus fixed amounts for
# relics, quest flags and Heavenly Kings. The plugin counts the best score of the current run, from 0.
#
# Souls no longer send checks, they are spent in the soul shop of the standby screen (the plugin's SHOP_PRICES).
# Archived: the checks were at 25, 50, 100, 200 (floor 20), 300, 400 (40), 500, 600 (60), 800 (80) and 1000 (100).


# switch id -> boss name (set by common event 63 "Heavenly King Battle")
HEAVENLY_KINGS: Dict[int, str] = {
    71: "Granisso",
    72: "Orgenbein",
    73: "Hielohude",
    74: "Spisnix",
}

# switch id of the Heavenly King -> the item that opens his door (the door choices of common event 63)
DOOR_KEYS: Dict[int, str] = {
    71: "Crimson Door Key",
    72: "Azure Door Key",
    73: "Emerald Door Key",
    74: "Gold Door Key",
}

# title number -> name, in the order of the Title Collection screen (rows of four).
# Common event 420 hands out armor n once the condition of title n is met (that is the check). The player then
# releases the title in the Title Collection (common event 400 + n), which grants the reward and sets switch 200 + n.
# Titles and their armors are reset at the start of every run.
# The names are the ones drawn on the Title Collection pictures (TC101-TC116). The armor names in the database
# have 2/3 and 11/12 the other way around.
TITLES: Dict[int, str] = {
    1: "Seed of Origin",  # Lose Virginity
    2: "Alice Idea",  # FAITH is 30 or less
    3: "Another Sephira",  # VIRTUE is 30 or less
    4: "Eternal Ruler",  # Defeat the Gold Heavenly King
    5: "Nightlife Girl",  # LEWD is 15 or more
    6: "Phoenix Knight",  # LP lowers to 1
    7: "Einherjar Priestess",  # Defeat the Crimson Heavenly King
    8: "Crimson Mythology",  # Use 7 cards during 1 turn
    9: "Sun of Lonasanknez",  # Be inflicted with 7 ailments simultaneously
    10: "The Naked One",  # Defeat the Emerald Heavenly King
    11: "Taygetus Summit",  # Possess 1000G
    12: "Minerva's Owl",  # (Max LP + Max RP + LEWD) / 5 + STR + DEF + MAG + AGL is over 30
    13: "Lanta Charis Spirit",  # Defeat the Azure Heavenly King
    14: "Irminsul Drop",  # VIRTUE is 70 or more
    15: "Star Cradle",  # FAITH is 70 or more
    16: "Azure Philosophy",  # Possess 15 or more cards
}
TITLE_SWITCH_BASE = 200
TITLE_LOSE_VIRGINITY = 1

# title number -> its condition, as the client's tracker shows it
TITLE_REQUIREMENTS: Dict[int, str] = {
    1: "Lose Virginity",
    2: "FAITH 30 or less",
    3: "VIRTUE 30 or less",
    4: "Defeat the Gold Heavenly King",
    5: "LEWD 15 or more",
    6: "LP lowers to 1",
    7: "Defeat the Crimson Heavenly King",
    8: "Use 7 cards during 1 turn",
    9: "7 ailments at the same time",
    10: "Defeat the Emerald Heavenly King",
    11: "Possess 1000 G",
    12: "Stats over 30",
    13: "Defeat the Azure Heavenly King",
    14: "VIRTUE 70 or more",
    15: "FAITH 70 or more",
    16: "Possess 15 or more cards",
}
# title number -> the value of the game's status report its condition is about (bridge.py "Status")
TITLE_STATS: Dict[int, str] = {
    2: "faith", 3: "virtue", 5: "lewd", 11: "gold", 12: "stats", 14: "virtue", 15: "faith", 16: "cards",
}

# title number -> the Heavenly King whose defeat is the condition of that title
TITLE_KINGS: Dict[int, str] = {
    4: "Spisnix",
    7: "Granisso",
    10: "Hielohude",
    13: "Orgenbein",
}

# title number -> floor events that move the stat its condition is about (docs/events.md). Any one of them will do.
# FAITH and VIRTUE start at 50 and an origin shifts them by 15 at most, LEWD starts at 2, and nothing but floor
# events changes them. Only choices that are open on a first visit are counted, not the ones behind a quest, a
# card or a stat that has to be reached first.
TITLE_EVENTS: Dict[int, List[str]] = {
    2: ["Desert", "Desert 2", "Market", "Library", "Girl", "Debauch", "Highway"],  # FAITH down
    3: ["Collapse", "Camp", "Highway"],  # VIRTUE down
    5: ["Desert 2", "Devil Temple", "Camp", "Debauch", "Small Room 2", "Highway", "Lake Shore"],  # LEWD up
    # 1000 G: an income next to what the fights drop. The events that raise LEWD or give the Womb Crest (Devil
    # Temple) open the ones that pay for it, and the treasures pay outright.
    11: [
        "Desert 2", "Devil Temple", "Camp", "Debauch", "Small Room 2", "Highway", "Lake Shore",
        "Gold and Silver Treasures",
    ],
    12: ["Forest", "Quarrel", "Market 2", "Small Room", "Library", "River", "Lake Shore"],  # STR/DEF/MAG/AGL, LP/RP
    14: ["Beggar", "Highway"],  # VIRTUE up
    15: ["Goddess Temple", "Devil Temple"],  # FAITH up
}

# The same with the DLC, on top of the above: its own events, and the events of the base game that the version of
# the game the DLC comes with gave a new choice or outcome (tools: compare dump/base with dump/dlc).
DLC_TITLE_EVENTS: Dict[int, List[str]] = {
    2: ["Gold and Silver Treasures", "Farm Village", "Old Woman", "Graveyard", "Royal Tomb"],  # FAITH down
    5: ["Cat"],  # LEWD up
    11: ["Cat"],  # 1000 G, by way of LEWD
    12: ["Barracks", "Checkpoint"],  # STR/DEF/MAG/AGL
    14: ["Old Woman", "Sculptor"],  # VIRTUE up
    15: ["Desert", "Library", "Farm Village", "Sculptor", "Royal Tomb"],  # FAITH up
}


def title_events(number: int, dlc: bool) -> List[str]:
    """The floor events that move the stat the condition of a title is about."""
    return TITLE_EVENTS.get(number, []) + (DLC_TITLE_EVENTS.get(number, []) if dlc else [])


# title number -> the floor from which its condition is expected to be met. A title about FAITH, VIRTUE, LEWD or
# the stats has none: it is in logic as soon as one of its events (TITLE_EVENTS) can be visited, since the soul shop
# sells the floor event of one's choice and the same event can be taken floor after floor.
TITLE_FLOORS: Dict[int, int] = {
    8: 21,   # Use 7 cards during 1 turn
    9: 21,   # 7 ailments at the same time: the enemies of the first floors do not inflict that many
    11: 21,  # Possess 1000 G: its events pay, but that much takes a while to come together
}

# troop id -> enemy name (common event 65 "Fight")
ENEMIES: Dict[int, str] = {
    1: "Bond",
    2: "Grudge",
    3: "Deception",
    4: "Pillaging",
    5: "Decay",
    6: "Cataclysm",
    7: "Servitude",
    8: "Dread",
    9: "Embellishment",
    10: "Theft",
    11: "Anxiety",
    12: "Dosa",
    13: "Envy",
    14: "Restraint",
    15: "Obstinacy",
    16: "Revilement",
    17: "Immaturity",
    18: "Guiltless",
    19: "Thrill",
    20: "Fortitude",
    21: "Despair",
}

# troop id -> the first floor the enemy shows up on. Common event 65 rolls the troop by floor: three new enemies
# every 20 floors, and from floor 21 on half of the fights are picked from the newest ones only (the newest six on
# floors 101-120, the newest nine on 121-160). Enemies of lower floors keep appearing in the other half. From floor
# 161 on every enemy is equally likely.
#   floors 1-20: 1-3      21-40: 4-6      41-60: 7-9      61-80: 10-12
#   81-100: 13-15         101-120: 16-18  121+: 19-21
ENEMY_FLOORS: Dict[int, int] = {troop_id: 1 + BOSS_FLOOR_INTERVAL * ((troop_id - 1) // 3) for troop_id in ENEMIES}

# The enemies of the DLC join the roll on floors 161-180, where half of the fights come from troops 13-24, and stay
# in it from then on. Only part of a seed with include_dlc.
DLC_ENEMIES: Dict[int, str] = {
    22: "Stubborn",
    23: "Integrity",
    24: "Transgression",
}
ENEMIES.update(DLC_ENEMIES)
ENEMY_FLOORS.update({troop_id: 161 for troop_id in DLC_ENEMIES})

# switch id -> boss of the DLC behind the White Door and the Black Door (common event 63). The doors are in the
# hallway of every boss floor: at the doors of the kings with the matching key, and behind the player ("towards the
# camera") from the first boss floor on. With both defeated in one run the last door of the DLC opens (Magislilia,
# common event 69).
DLC_BOSSES: Dict[int, str] = {
    278: "Migwarners",
    279: "Bordosegeia",
}
# The last boss of the base game is a check where he is not the goal: with a goal of the DLC he is one of the doors
# from floor 100 on, like in the game. The location id is the offset of the switches + the switch of his fight.
LAST_BOSS = "Magisdusk"
LAST_BOSS_SWITCH = 64
LAST_BOSS_FLOOR = 100
# switch id of the DLC boss -> the relic that opens its door
DLC_BOSS_KEYS: Dict[int, str] = {
    278: "White Key",
    279: "Black Key",
}
WHITE_KEY_ID = 57
BLACK_KEY_ID = 58

# common event id -> floor event name. Event n runs while switch n is on (set by common event 86).
EVENTS: Dict[int, str] = {
    21: "Marsh",
    22: "Hot Spring",
    23: "Pond of Acid",
    24: "Forest",
    25: "Inn",
    26: "Desert",
    27: "Desert 2",
    28: "Goddess Temple",
    29: "Devil Temple",
    30: "Collapse",
    31: "Beggar",
    32: "Quarrel",
    33: "Market",
    34: "Market 2",
    35: "Small Room",
    36: "Amusement Center",
    37: "Flower",
    38: "Cherry Blossoms",
    39: "Storage Room",
    40: "Library",
    41: "Girl",
    42: "Battlefield",
    43: "Dog",
    44: "Cat",
    45: "Camp",
    46: "Seamstress",
    47: "River",
    48: "Gold and Silver Treasures",
    49: "Debauch",
    50: "Sea",
    51: "Snowy Mountain",
    52: "Small Room 2",
    53: "Suspension Bridge",
    54: "Pond",
    55: "Highway",
    56: "Lake Shore",
    57: "Locksmith",
    58: "Corridor",
    59: "Throne",
    60: "Hill",
    61: "Prison",  # the game only offers it once cleared, which the plugin makes true from the start
}

# The floor events of the DLC "Dark Abyss" content. They run while switch n is on like the others, but their common
# events are 591-601. All of them are only offered from floor 41 on. Only part of a seed with include_dlc.
DLC_EVENTS: Dict[int, str] = {
    161: "Costume Room",
    162: "Barracks",
    163: "Farm Village",
    164: "Old Woman",
    165: "Checkpoint",
    166: "Clinic",
    167: "Slave Market",
    168: "Graveyard",
    169: "Girl with Flower Crown",
    170: "Sculptor",
    171: "Royal Tomb",  # "Treasury" in the game
}
EVENTS.update(DLC_EVENTS)

# Events that only come up in a state a fresh run is not in (torn clothes, Lust). Not handed out as random
# starting events.
CONDITIONAL_EVENTS = (46, 52)

# unlock name -> the floor events it opens. The two of a pair start out alike (same place, mostly the same opening
# lines), so they share one unlock and the game offers them under that one name. Each keeps its own first visit.
EVENT_GROUPS: Dict[str, List[int]] = {
    "Hot Spring": [22, 23],
    "Desert": [26, 27],
    "Temple": [28, 29],
    "Market": [33, 34],
    "Small Room": [35, 52],
}

# event id -> name of the unlock that opens it: its group, or the event itself
EVENT_UNLOCKS: Dict[int, str] = dict(EVENTS)
for _unlock, _event_ids in EVENT_GROUPS.items():
    for _event_id in _event_ids:
        EVENT_UNLOCKS[_event_id] = _unlock

# unlock name -> its events. The item id of an unlock is EVENT_OFFSET + its first event.
UNLOCK_EVENTS: Dict[str, List[int]] = {}
for _event_id, _unlock in sorted(EVENT_UNLOCKS.items()):
    UNLOCK_EVENTS.setdefault(_unlock, []).append(_event_id)

EVENT_IDS: Dict[str, int] = {name: event_id for event_id, name in EVENTS.items()}

# event id -> what its first visit is called, for the events of a pair: the unlock and what sets the two apart
EVENT_VISITS: Dict[int, str] = {
    22: "Hot Spring - Heal",
    23: "Hot Spring - Trap",
    26: "Desert - Heal",
    27: "Desert - Trap",
    28: "Temple - Good",
    29: "Temple - Evil",
    33: "Market - Elderly",
    34: "Market - Merchant",
    35: "Small Room - Vials",
    52: "Small Room - Vacant Cabin",
}


def first_visit(event_id: int) -> str:
    """Name of the first visit location of a floor event."""
    return f"First Visit: {EVENT_VISITS.get(event_id, EVENTS[event_id])}"


def event_item(event: str) -> str:
    """Name of the item that unlocks a floor event."""
    return f"Event: {EVENT_UNLOCKS[EVENT_IDS[event]]}"

# bonus id of the bonus shop (common event 418) -> card set. Each set is three cards, taken in the deck screen.
STARTING_SETS: Dict[int, str] = {
    101: "Boxer Card Set",     # Strike, Grand Strike, Berserk
    102: "Fighter Card Set",   # Shoot, Dusk Shoot, Fleet Footwork
    103: "Mage Card Set",      # Witch Act, Sacrament, Over Release
    104: "Knight Card Set",    # Shield Bash x2, Eminence Protect
    105: "Merchant Card Set",  # Mammonite x2, Investment
    106: "Succubus Card Set",  # Temptation x2, Levy Suit
}

# weapon id -> relic name. Only relics with a known event source are listed.
# Left out on purpose: the counted flowers Forget-Me-Not (74) and Pieris (75), and what is used up on the spot
# (Mark of Attainer 80, 5000 lux 5).
#
# The Moon Hair Ornament comes from the Girl event, where the game only hands it to a player in the Regression State.
# That state, and with it the ornament and the White Key made from it, only exists with the patch of the game that
# restores its cut content. The plugin has the girl hand the ornament out on any visit, so the three are in every
# seed and no option is needed for the patch.
RELICS: Dict[int, str] = {
    29: "Recovery Misanga",
    30: "Dusk Ring",
    33: "Plushie",
    34: "Music Box",
    36: "Clown Mask",
    38: "Promise Pendant",
    41: "Moon Hair Ornament",
    42: "Collar Key",
    51: "Pretty Water",
    57: "White Key",
    58: "Black Key",
    59: "Aetolus Flag",
}

# Relics the DLC adds, handed out by base events it extends (Marsh) and by its own. Only with include_dlc.
DLC_RELICS: Dict[int, str] = {
    23: "Old Iron Hammer",
    24: "Memento Chisel",
    76: "Crown of Forget-Me-Not",
    77: "Crown of Pieris",
}
RELICS.update(DLC_RELICS)

WHITE_KEY = "White Key"
BLACK_KEY = "Black Key"

# event -> what the game wants before it offers the event at all: other events that have to come first in the same
# run, relics that have to be held, and relics of which one is enough.
EVENT_CONDITIONS: Dict[str, Dict[str, List[str]]] = {
    # The locked door of the Corridor is all there is to it
    "Corridor": {"events": [], "relics": [], "any_relic": [WHITE_KEY, BLACK_KEY]},
    # Both only come up once the Aetolus Flag was hoisted on the Hill, in every run anew
    "Old Woman": {"events": ["Hill"], "relics": ["Aetolus Flag"], "any_relic": []},
    "Sculptor": {"events": ["Hill"], "relics": ["Aetolus Flag"], "any_relic": []},
}

# relic name -> what it takes to find it: the floor events and the relics it is traded for.
# First pass read from the event commands, not yet confirmed in play.
RELIC_SOURCES: Dict[str, Dict[str, List[str]]] = {
    "Old Iron Hammer": {"events": ["Marsh"], "relics": []},
    # The guard only hands it over for the message of the Old Woman, or after she was robbed
    "Memento Chisel": {"events": ["Old Woman", "Checkpoint"], "relics": []},
    "Crown of Forget-Me-Not": {"events": ["Girl with Flower Crown"], "relics": []},
    "Crown of Pieris": {"events": ["Girl with Flower Crown"], "relics": []},
    "Recovery Misanga": {"events": ["Collapse", "Cherry Blossoms"], "relics": []},
    "Dusk Ring": {"events": ["Battlefield"], "relics": []},
    "Plushie": {"events": ["Market"], "relics": []},
    "Music Box": {"events": ["Market"], "relics": []},
    "Clown Mask": {"events": ["Amusement Center"], "relics": []},
    # She only parts with it once the man of the Collapse is dead or saved. The Monster quest is another way to
    # it, but that takes the Black Key, which is made of this pendant.
    "Promise Pendant": {"events": ["Cherry Blossoms"], "relics": [], "needs": ["Collapse"]},
    "Collar Key": {"events": ["Battlefield"], "relics": []},
    "Pretty Water": {"events": ["Pond"], "relics": []},
    "Moon Hair Ornament": {"events": ["Girl"], "relics": []},
    "Black Key": {"events": ["Locksmith"], "relics": ["Plushie", "Clown Mask", "Promise Pendant"]},
    "White Key": {"events": ["Locksmith"], "relics": ["Music Box", "Recovery Misanga", "Moon Hair Ornament"]},
    "Aetolus Flag": {"events": ["Throne"], "relics": ["Dusk Ring"]},
}

# item id -> name. Ids below SWITCH_OFFSET are plugin-defined effects.
FILLER: Dict[int, str] = {
    1: "100 Gold",
    2: "300 Gold",
}

# Souls to spend in the soul shop and the Boon Shop
SOUL_FILLER: Dict[int, str] = {
    5: "10 Souls",
    6: "25 Souls",
    7: "50 Souls",
}

# Filler that raises a stat of the run it arrives in, once. Stats start over with every run.
# Restores LP or RP in the current run, without raising the maximum
RESTORE_FILLER: Dict[int, str] = {
    26: "+5 LP",
    27: "+5 RP",
}

STAT_FILLER: Dict[int, str] = {
    20: "+5 Max LP",
    21: "+5 Max RP",
    22: "+1 STR",
    23: "+1 MAG",
    24: "+1 DEF",
    25: "+1 AGL",
}

# Traps go off in the fight they arrive in, or the next one
TRAPS: Dict[int, str] = {
    30: "Climax Trap",     # RP drops to 0, which is a climax
    31: "Confusion Trap",  # state 121
    32: "Sticky Trap",     # state 101 "Sticky Fluid"
    33: "Paralysis Trap",  # state 242
    34: "Acid Trap",       # state 131 "Torn Clothes", the clothes dissolve
    35: "Ecstasy Trap",    # state 4 "Lust"
    36: "Time Stop Trap",  # states 404-406, DLC only
    37: "Brainwash Trap",  # state 262
    38: "Breeze Trap",     # state 12 "Pantyless"
}

# item id of the card -> name, for the cards floor events hand out. Handing one out is a check ("Card: ..."), and
# the card is an item: received cards can be taken into the deck from the deck screen, each of them once a run.
CARDS: Dict[int, str] = {
    40: "Faithful Dog Lassi",
    74: "Taunt",
    77: "Strip",
    78: "Ride On",
    80: "Temptation",
}
# Only handed out by the version of the game that comes with the DLC
DLC_CARDS: Dict[int, str] = {
    39: "Shadow Cat Assam",
    60: "Ride Back",
    71: "Encase",
    76: "Candylick",
    79: "Projection",
}
CARDS.update(DLC_CARDS)

# The single cards of the game's bonus shop. No event hands them out: they are items only, and like every received
# card they are bought into the deck from the deck screen.
BONUS_CARDS: Dict[int, str] = {
    15: "Healing",
    17: "Inspiration",
    18: "Refresh",
    24: "Psych Up",
}

# card name -> what it takes: the floor events, the relics, and whether LEWD has to go up first (the Cat only hands
# out a card from LEWD 10 on). Ride On comes from the Cat or from Debauch depending on the version of the game, so
# it asks for both. First pass read from the event commands, not yet confirmed in play.
# card name -> the events that no longer hand it out in the game with the DLC, for the counts of open checks
DLC_MOVED_CARDS: Dict[str, List[str]] = {"Ride On": ["Cat"]}

CARD_SOURCES: Dict[str, Dict[str, object]] = {
    "Faithful Dog Lassi": {"events": ["Dog"], "relics": ["Collar Key"], "lewd": False},
    "Taunt": {"events": ["Cat"], "relics": [], "lewd": True},
    "Strip": {"events": ["Cat"], "relics": [], "lewd": True},
    "Temptation": {"events": ["Cat"], "relics": [], "lewd": True},
    "Ride On": {"events": ["Cat", "Debauch"], "relics": [], "lewd": True},
    "Shadow Cat Assam": {"events": ["Cat"], "relics": [], "lewd": True},
    "Ride Back": {"events": ["Debauch"], "relics": [], "lewd": False},
    "Encase": {"events": ["Debauch"], "relics": [], "lewd": False},
    "Candylick": {"events": ["Debauch"], "relics": [], "lewd": False},
    "Projection": {"events": ["Debauch"], "relics": [], "lewd": False},
}
# The title "LEWD is 15 or more" lists the events that raise LEWD
TITLE_LEWD = 5

# The card that is drawn the turn after the enemy climaxes and defeats it outright (skill 93, common event 103).
# With the finisher_move option on "shuffle" it only shows up once this item is found.
FINISHER_ID = 10
FINISHER = "Kick Balls"

# One more floor event to choose from on every floor, next to the two the choice starts with. The floor_exploration
# option says how many there are, and the climb expects one of them by each of these floors.
EXPLORATION_ID = 11
EXPLORATION = "Progressive Floor Exploration"
EXPLORATION_FLOORS = (21, 41, 61, 81, 101)

# Names of the goal option. The plugin reports the values of the goals a win reaches.
DLC_GOALS = ("dlc_normal", "dlc_true")

VICTORY = "Victory"
ENDING_EVENT = "Reach the Ending"


def event_locations(event_id: int, dlc: bool = False) -> List[int]:
    """The checks an event holds: its first visit and the relics and cards found in it."""
    name = EVENTS[event_id]
    locations: List[int] = [SWITCH_OFFSET + event_id]

    for weapon_id, relic in RELICS.items():
        if name in RELIC_SOURCES.get(relic, {}).get("events", []):
            locations.append(RELIC_OFFSET + weapon_id)

    for item_id, card in CARDS.items():
        if name in CARD_SOURCES[card]["events"] and not (dlc and name in DLC_MOVED_CARDS.get(card, [])):
            locations.append(CARD_OFFSET + item_id)

    return locations
