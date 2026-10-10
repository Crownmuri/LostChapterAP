"""
Static tables shared by generation and the client.

AP ids are derived from the game's own database ids, so the in-game plugin
(game_plugin/LostChapterAP.js) can compute them without a lookup table.
Keep the offsets in sync with the constants at the top of that file.
"""
from typing import Dict, List

GAME_NAME = "Lost Chapter"
STEAM_APP_ID = 2356470

SWITCH_OFFSET = 1000  # location id = offset + game switch id
TROOP_OFFSET = 2000   # location id = offset + troop id
RELIC_OFFSET = 3000   # location id and item id = offset + weapon id
FLOOR_OFFSET = 4000   # location id = offset + floor number
EVENT_OFFSET = 5000   # item id = offset + common event id (the first visit location uses SWITCH_OFFSET)
BOSS_OFFSET = 6000    # item id = offset + the Heavenly King's switch id
TITLE_OFFSET = 7000   # item id = offset + title number

# Game variables
VARIABLE_FLOOR = 11

# A Heavenly King waits on every 20th floor (common event 86 "---Standby End---")
FLOOR_CHECKS = range(10, 81, 10)

# Game switches
SWITCH_ENDING = 1         # set by the Ending map (Map011)
SWITCH_TRUE_ENDING = 200  # set by the Ending map on the TRUE END page

# switch id -> boss name (set by common event 63 "Heavenly King Battle")
HEAVENLY_KINGS: Dict[int, str] = {
    71: "Granisso",
    72: "Orgenbein",
    73: "Hielohude",
    74: "Spisnix",
}

# title number -> name, in the order of the Title Collection screen (rows of four).
# Common event 420 hands out armor n once the condition of title n is met (that is the check). The player then
# releases the title in the Title Collection (common event 400 + n), which grants the reward and sets switch 200 + n.
# Titles and their armors are reset at the start of every run.
TITLES: Dict[int, str] = {
    1: "Seed of Origin",
    2: "Another Sephira",
    3: "Alice Idea",
    4: "Eternal Ruler",
    5: "Nightlife Girl",
    6: "Phoenix Knight",
    7: "Einherjar Priestess",
    8: "Crimson Mythology",
    9: "Sun of Lonasanknez",
    10: "The Naked One",
    11: "Minerva's Owl",
    12: "Taygetus Summit",
    13: "Lanta Charis Spirit",
    14: "Irminsul Drop",
    15: "Star Cradle",
    16: "Azure Philosophy",
}
TITLE_SWITCH_BASE = 200

# title number -> the Heavenly King whose defeat is the condition of that title
TITLE_KINGS: Dict[int, str] = {
    4: "Spisnix",
    7: "Granisso",
    10: "Hielohude",
    13: "Orgenbein",
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

# common event id -> floor event name. Event n runs while switch n is on (set by common event 86).
# Left out on purpose: Prison (61), which the game only offers after the first clear.
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
}

# weapon id -> relic name. Only relics with a known event source are listed.
# Left out on purpose: Moon Hair Ornament (41, never handed out by an event command), White Key (57, crafted
# from the Moon Hair Ornament) and the counted flowers Forget-Me-Not (74) / Rocket Larkspur (75).
RELICS: Dict[int, str] = {
    29: "Recovery Misanga",
    30: "Dusk Ring",
    33: "Plushie",
    34: "Music Box",
    36: "Clown Mask",
    38: "Promise Pendant",
    42: "Collar Key",
    51: "Pretty Water",
    58: "Black Key",
    59: "Aetolus Flag",
}

# relic name -> what it takes to find it: the floor events and the relics it is traded for.
# First pass read from the event commands, not yet confirmed in play.
RELIC_SOURCES: Dict[str, Dict[str, List[str]]] = {
    "Recovery Misanga": {"events": ["Collapse", "Cherry Blossoms"], "relics": []},
    "Dusk Ring": {"events": ["Battlefield"], "relics": []},
    "Plushie": {"events": ["Market"], "relics": []},
    "Music Box": {"events": ["Market"], "relics": []},
    "Clown Mask": {"events": ["Amusement Center"], "relics": []},
    "Promise Pendant": {"events": ["Cherry Blossoms"], "relics": []},
    "Collar Key": {"events": ["Battlefield"], "relics": []},
    "Pretty Water": {"events": ["Pond"], "relics": []},
    "Black Key": {"events": ["Locksmith"], "relics": ["Plushie", "Clown Mask", "Promise Pendant"]},
    "Aetolus Flag": {"events": ["Throne"], "relics": []},
}

# item id -> name. Ids below SWITCH_OFFSET are plugin-defined effects.
FILLER: Dict[int, str] = {
    1: "100 Gold",
    2: "300 Gold",
}

VICTORY = "Victory"
ENDING_EVENT = "Reach the Ending"
