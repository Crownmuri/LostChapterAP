//=============================================================================
// LostChapterAP.js
//=============================================================================
/*:
 * @target MZ
 * @plugindesc Archipelago bridge for Lost Chapter. Talks to the Lost Chapter Client over a local WebSocket.
 * @author Crownmuri
 *
 * @param port
 * @text Client port
 * @type number
 * @default 38472
 *
 * @help
 * Installed and registered by the Lost Chapter Client (Archipelago Launcher).
 * All Archipelago logic lives in the client; this plugin only reports what
 * happens in the game and applies received items.
 *
 * The plugin only acts when the game was started from the client's "Launch
 * game" button, which leaves a session file in the game folder. The game then
 * keeps its save in a folder of its own for that multiworld slot. Started any
 * other way, the game and its normal save are left alone.
 *
 * Game changes in such a session:
 *  - Every floor is a fight until floor events are unlocked. With unlocked
 *    events the player picks between a fight and two events rolled from all
 *    of them, where the ones still locked are grayed out.
 *  - A Heavenly King can only be challenged with his door key, the other
 *    doors are grayed out. The doors also offer to turn back, which repeats
 *    the last 20 floors: the climb only goes on once a king is defeated.
 *  - From floor 100 on the doors are a free choice every 20 floors: any king
 *    again, the last boss, or keep going without a fight.
 *  - Relics handed out by events become checks (relicsanity).
 *  - Meeting the condition of a title is a check. Releasing the title in the
 *    Title Collection also needs its Unlock Title Effect item, unless the
 *    shuffle_title_effects option is off.
 *  - A run starts on the standby screen instead of inside the first event.
 *  - The "Once upon a time" questions are replaced by a list of the origins.
 *  - The game counts as cleared from the start: defeating the last boss is the
 *    goal and the climb continues afterwards instead of rolling the ending.
 *  - The bonus shop is skipped. Received card sets are taken in the deck
 *    screen, with the received cards.
 *  - Souls (the score the bonus shop used to spend) are counted over a run and
 *    send checks at milestones. The standby screen shows the total.
 *
 * The title screen shows the state of the Archipelago connection in its
 * bottom left corner.
 *
 * F7 toggles double speed.
 *
 * Dev commands come from the client (/dev, needs dev_mode in host.yaml) or
 * from the console: LostChapterAP.dev("floor 19"), LostChapterAP.dev("help").
 */

(() => {
    "use strict";

    const PLUGIN_NAME = "LostChapterAP";
    const VERSION = "0.8.0";
    const PORT = Number(PluginManager.parameters(PLUGIN_NAME).port || 38472);
    const RECONNECT_MS = 3000;
    const IMAGE_RETRIES = 3;
    const IMAGE_RETRY_MS = 250;
    const PICTURE_MISSING_FRAMES = 90;
    const SESSION_FILE = "archipelago_session.json";
    const LOG_FILE = "archipelago_log.txt";
    const MAP_TITLE = 3;

    // Keep in sync with apworld/lost_chapter/data.py
    const SWITCH_OFFSET = 1000;
    const TROOP_OFFSET = 2000;
    const RELIC_OFFSET = 3000;
    const FLOOR_OFFSET = 4000;
    const EVENT_OFFSET = 5000;
    const BOSS_OFFSET = 6000;
    const TITLE_OFFSET = 7000;
    const SET_OFFSET = 8000;
    const CARD_OFFSET = 9000;
    const SOUL_OFFSET = 10000;

    const SWITCH_CLEARED = 1;
    const SWITCH_BEFORE_BOSS = 62;
    const SWITCH_LAST_BOSS = 64;
    const SWITCH_FIGHT = 65;
    const SWITCH_STANDBY_END = 86; // runs common event 86, which leaves the standby screen for the next floor
    const SWITCH_STANDBY_IMAGE = 88; // on while the standby screen is shown
    const SWITCH_STANDBY_CONTROL = 89; // on while the standby screen takes input
    const VARIABLE_LP = 42;
    const VARIABLE_FLOOR = 11;
    const VARIABLE_FLOOR_EVENT = 12;
    const VARIABLE_ORIGIN = 2;
    const VARIABLE_LEWD = 51;
    const VARIABLE_PLAYTHROUGH = 67;
    const VARIABLE_CLIMAX_COUNT = 232;
    const VARIABLE_SCORE = 77;

    const TROOP_LAST_BOSS = 30;
    // The ending map plays its other ending from this climax count on, the TRUE END below it
    const TRUE_END_CLIMAX_LIMIT = 21;
    const STATE_VIRGINITY = 301;
    const TITLE_LOSE_VIRGINITY = 1;
    // The values of the goal option of apworld/lost_chapter/options.py
    const GOAL_NORMAL_END = 0;
    const GOAL_TRUE_END = 1;
    const GOAL_DLC_END = 3;

    const COMMON_EVENT_NEXT_FLOOR = 86;
    const COMMON_EVENT_STANDBY = 11;
    const COMMON_EVENT_STANDBY_START = 87;
    const COMMON_EVENT_GUI = 2; // parallel: copies LP, RP and the stats to their variables and draws them
    const SWITCH_GUI = 2; // runs that event
    const PICTURE_GUI = 98; // its line of text
    const COMMON_EVENT_SCORE = 72;
    const COMMON_EVENT_TITLE_RELEASE = 400; // + title number
    const COMMON_EVENT_TITLES = 80; // opens the Title Collection
    const TITLE_PICTURE_BASE = 70; // + title number
    const COMMON_EVENT_KING_BATTLE = 63;
    // Kick Balls: the turn start (common event 103) draws card 93 while the enemy is in its Refractory Period
    const COMMON_EVENT_TURN_START = 103;
    const CARD_FINISHER = 93;
    const STATE_REFRACTORY = 16;
    const ITEM_FINISHER = 10; // FINISHER_ID of apworld/lost_chapter/data.py
    const ITEM_EXPLORATION = 11; // EXPLORATION_ID of apworld/lost_chapter/data.py, one more event to choose from
    // RESTORE_FILLER of apworld/lost_chapter/data.py
    const ITEM_RESTORE_LP = 26;
    const ITEM_RESTORE_RP = 27;
    const RESTORE_AMOUNT = 5;
    const SWITCH_GAME_OVER = 66; // turned on by common event 86 when the floor ends without LP
    const MAP_ENDING = 11;
    const FINISHER_SHUFFLE = 1; // the finisher_move option
    const FINISHER_REMOVE = 2;
    const FINISHER_BOON_SHOP = 3;
    const FINISHER_PRICE = 1000; // souls, in the Boon Shop
    const COMMON_EVENT_POND = 54;
    const COMMON_EVENT_LOCKSMITH = 57;
    // Switch 12 is on in the Pond while there is filth on the body (variable 209)
    const POND_BATHE_HIDDEN = "Bathe in the Waterif(!s[12])";
    const POND_BATHE_SHOWN = "Bathe in the Waterif(s[12])";
    const LABEL_END = "終了";

    const KING_SWITCHES = [71, 72, 73, 74];
    // Unused game switches mirroring the door keys, read by the door choices of common event 63
    // Switches 185-190 are not used by the game, with or without its DLC (which took 261 and up for its quests)
    const KING_UNLOCK_SWITCH_SHIFT = 114; // 71-74 -> 185-188, on while the door of that king can be opened
    // More unused game switches read by the door choices. MPP_ChoiceEX reads a choice condition up to its first
    // closing bracket, so a condition has to be made of plain switches.
    const SWITCH_TURN_BACK = 189; // the doors offer "Turn Back"
    const SWITCH_FREE_DOORS = 190; // the doors offer "Final Boss" and "Keep Going"
    const SWITCH_KING_BATTLE = 63;
    const BOSS_FLOOR_INTERVAL = 20;
    const FREE_DOORS_FLOOR = 100;
    const LABEL_LEAVE_DOORS = "ArchipelagoLeaveDoors";

    // The id of a floor event is the switch that runs it. In the base game that is also the id of its common event
    // (21-61), the events of the DLC are common events 591-601 on switches 161-171.
    const EVENT_RANGES = [[21, 61], [161, 171]];
    const LEGACY_EVENTS = Array.from({ length: 41 }, (_, i) => 21 + i);
    const FLOOR_EVENT_CHOICES = 2;
    const LABEL_STANDBY = "ArchipelagoStandby";
    // The soul shop of the standby screen. The prices are the same on every floor.
    // Boons: souls -> [bonus id of common event 418, name, the switch it turns on if it is one, needs the
    // Regression State]. BOON_TIERS names the price groups.
    const COMMON_EVENT_BONUS = 418;
    const BOON_TIERS = { 200: "Small Boons", 300: "Medium Boons", 400: "Body", 600: "Combat", 800: "Large Boons" };
    const COLOR_SOUL_SHOP = 4; // text colors of the game's window skin: light blue
    const COLOR_BOON_SHOP = 2; // orange
    const BOONS = {
        200: [
            [1, "STR +2"], [2, "DEF +2"], [3, "MAG +2"], [4, "AGL +2"], [5, "Max LP +10"], [6, "Max RP +10"],
            [7, "LP Regen +1"], [8, "RP Regen +1"], [17, "FAITH +10"], [18, "FAITH -10"], [19, "VIRTUE +10"],
            [20, "VIRTUE -10"], [109, "Acquired Gold +100 G", 232],
        ],
        300: [[9, "Gold +200"], [10, "LEWD +5"], [21, "Rare Drop Rate +3"]],
        400: [
            [15, "Womb Crest"], [16, "Bosomy", 0, true], [117, "Swimsuit"], [118, "Beastification"],
            [107, "Regression", 0, true],
        ],
        600: [[111, "Dealt Combat Damage +10%", 234], [112, "Received Combat Damage -10%", 235]],
        800: [
            [113, "All Stats +2"], [114, "Max LP +20"], [115, "Max RP +20"], [116, "LEWD +10"],
            [110, "Double LEWD Rate", 233],
        ],
    };
    const SHOP_LIMITS = { forgetMeNot: 2, pieris: 1 }; // how many of each a run can buy
    const SHOP_PRICES = { reroll: 10, pick: 40, forgetMeNot: 150, pieris: 300, heal: 20, cards: 20, vial: 50 };
    // The three cards to choose from after a fight: common event 17 rolls and shows them while its switch is on,
    // common event 16 takes the choice while its switch is on
    const SWITCH_DROP_CONTROL = 16;
    const COMMON_EVENT_DROP_CONTROL = 16;
    const SWITCH_DROP_START = 17;
    const REROLL_KEY = "pagedown"; // W
    const REROLL_Y = 520;
    // Battle rewards (the battle_rewards option): BATTLE_OFFSET of apworld/lost_chapter/data.py
    const BATTLE_OFFSET = 11000;
    const TRACED_SWITCHES = [65, 66, 86, 87, 89, 90]; // fight, game over, standby end and start, its input, a click
    const TRACE_LENGTH = 24;
    const COMMON_EVENT_DROP_START = 17;
    const VARIABLE_DROP_FIRST = 6; // variables 6-8 are the item ids of the three cards on offer
    const DROP_CARDS = 3;
    const REWARD_CARD = 9000; // stands for the battle reward among them, no item has this id
    const CARD_WIDTH = 140;
    const CARD_HEIGHT = 210;
    const SHOP_HEAL = 10;
    const WEAPON_FORGET_ME_NOT = 74;
    const WEAPON_PIERIS = 75;
    const UNVISITED_EVENT_WEIGHT = 6; // times as likely to be rolled as any other event
    // Checkpoints: the first floor after a boss floor (21, 41, ...) is saved to a file of its own, checkpoint 1 is
    // floor 21. They are no save files of the game, which loads the newest of those when it starts.
    const CHECKPOINT_NAME = "checkpoint";
    const CHECKPOINTS = 10;
    const CHECKPOINT_WAIT = 600; // frames the event that asked stands still while the checkpoint loads
    // Floor event -> choice (as written in the event, without its condition and colors) -> what it takes.
    // Choices that already name a card they need, and the ones about FAITH, VIRTUE and LEWD, are not listed:
    // the latter are read from their condition.
    const CHOICE_REQUIREMENTS = {
        37: { "Water It": "Pretty Water" },
        38: { "Tell Her the Location of the Man's Grave": "Collapse first" },
        40: { "Pay -160 G": "(MAG \u2267 15)" },
        54: { "Bathe in the Water": "filth to wash off", "Bathe in water": "filth to wash off" },
        56: { "I Came to See You": "revisit" },
        57: {
            "Create White Key": "Music Box, Recovery Misanga, Moon Hair Ornament",
            "Create Black Key": "Plushie, Clown Mask, Promise Pendant",
        },
        58: {
            "Remove the Portrait": "the Beggar's treasury",
            "Use White Key": "White Key",
            "Use Black Key": "Black Key",
        },
        59: { "Show Ring": "Dusk Ring" },
        60: { "Hoist Flag": "Aetolus Flag" },
        162: { "Do you know this girl?": "Faithful Dog Lassi" },
        163: { "Release desire": "(LEWD \u2267 30)" },
        170: { "You brought a tool": "Old Iron Hammer, Memento Chisel" },
    };
    // A switch that more floor events than this turn on is one they all use for their own ends, not a story switch
    const STORY_SWITCH_EVENTS = 3;

    // The game calls common event 52 "Small Room" like common event 35, the apworld calls it "Small Room 2"
    const EVENT_ALIASES = { "small room 2": 52 };
    const CHOICE_MAX_ROWS = 5;
    const STANDBY_MAX_ROWS = 9; // what fits on the standby screen, a longer list scrolls
    const STANDBY_CHOICE_Y = 315; // in the 600 high UI area, which sits 60 below the top of the screen

    const TITLE_COUNT = 16; // title n is held as armor n once its condition is met
    const TITLE_SWITCH_BASE = 200;
    // Keep in sync with TITLES in apworld/lost_chapter/data.py (the armor names in the database differ)
    const TITLE_NAMES = [
        "Seed of Origin",
        "Alice Idea",
        "Another Sephira",
        "Eternal Ruler",
        "Nightlife Girl",
        "Phoenix Knight",
        "Einherjar Priestess",
        "Crimson Mythology",
        "Sun of Lonasanknez",
        "The Naked One",
        "Taygetus Summit",
        "Minerva's Owl",
        "Lanta Charis Spirit",
        "Irminsul Drop",
        "Star Cradle",
        "Azure Philosophy",
    ];
    // The Title Collection (common event 419) writes the condition and effect of the selected title into this picture
    const TITLE_TEXT_PICTURE = 51;
    const VARIABLE_SCREEN = 97;
    const SCREEN_TITLES = 11;
    const VARIABLE_SELECTED = 85;

    // Origin number (variable 2) -> label, in the order they are listed
    const ORIGINS = [
        [1, "[Knowledge Seeker] \u3010+MAG\u3011\u3010-FAITH\u3011"],
        [2, "[Pure Girl] \u3010LEWD 0\u3011"],
        [3, "[Forgotten Martyr] \u3010+FAITH\u3011\u3010+VIRTUE\u3011\u3010Natal Pray\u3011"],
        [4, "[Loyal Knight] \u3010+DEF\u3011\u3010Hynel Defensor\u3011"],
        [5, "[Nobody] \u3010+RARE DROP\u3011"],
        [6, "[Soldier of the Wastelands] \u3010+LP\u3011\u3010+STR\u3011\u3010+DEF\u3011"],
        [7, "[Votive Offering] \u3010+LP\u3011\u3010+RP\u3011\u3010+FAITH\u3011"],
        [8, "[Hero of the Future] \u3010+STR\u3011\u3010+DEF\u3011\u3010+MAG\u3011\u3010+AGL\u3011\u3010-RP\u3011"],
        [9, "[Devil's Servant] \u3010+GOLD\u3011\u3010+FAITH\u3011\u3010-VIRTUE\u3011"],
    ];
    // The DLC adds an origin for a cleared game ("I Desired Destruction"), listed when the opening has it
    const DLC_ORIGIN = [99, "[The New Ruler]"];

    // Bonus id of the bonus shop (common event 418) -> name and the cards it hands out
    const STARTING_SETS = {
        101: ["Boxer Card Set", [11, 19, 32]],
        102: ["Fighter Card Set", [12, 20, 33]],
        103: ["Mage Card Set", [25, 34, 27]],
        104: ["Knight Card Set", [29, 29, 30]],
        105: ["Merchant Card Set", [35, 35, 36]],
        106: ["Succubus Card Set", [80, 80, 37]],
    };

    const CHECK_TROOP_MAX = 24; // 22-24 are the enemies of the DLC
    const CHECK_FLOORS = [10, 20, 30, 40, 50, 60, 70, 80];
    // The relics that are checks in a seed from before the slot data listed them
    const LEGACY_RELIC_WEAPONS = [29, 30, 33, 34, 36, 38, 42, 51, 58, 59];
    // Every relic that can be a check: the ones above and those of the DLC
    // (Moon Hair Ornament, White Key)
    const RELIC_WEAPONS = LEGACY_RELIC_WEAPONS.concat([41, 57, 23, 24, 76, 77]);
    const WEAPON_MOON_HAIR_ORNAMENT = 41;
    const COMMON_EVENT_GIRL = 41;
    const STATE_REGRESSION = 143;

    // DLC: the bosses behind the White Door and the Black Door, and Magislilia behind the last door
    const DLC_BOSS_SWITCHES = [278, 279];
    const TROOP_DLC_LAST_BOSS = 33;
    const SWITCH_DLC_LAST_BOSS = 69;
    const SWITCH_BEHIND = 154; // on while the player stands at the doors behind the hallway
    const WEAPON_WHITE_KEY = 57;
    const WEAPON_BLACK_KEY = 58;
    // More unused switches for the doors behind the hallway
    const SWITCH_WHITE_DOOR = 182; // the White Door there can be opened
    const SWITCH_BLACK_DOOR = 183;
    const SWITCH_LAST_DOOR = 193; // both are defeated, the last door is offered
    const SWITCH_FINAL_BOSS = 159; // the floor of the final_boss_floor option is reached
    // Market (common event 33): the merchant hands out the Plushie and the Music Box, thanks the player who took
    // both (VIRTUE +5) and is gone from then on. With both as checks he stays, see patchMarket.
    const COMMON_EVENT_MARKET = 33;
    const MARKET_RELICS = [33, 34];
    const SWITCH_MARKET_THANKS = 157; // both checks are sent, the merchant can be thanked
    const COMMON_EVENT_CAT = 44;
    const COMMON_EVENT_MARSH = 21;
    const WEAPON_OLD_IRON_HAMMER = 23;
    const ITEM_LASSI = 40;
    const WEAPON_DUSK_RING = 30;
    const WEAPON_COLLAR_KEY = 42;
    const CAT_LEWD = 10; // from here on the Cat hands out a card when patted
    const LABEL_MARKET_THANKS = "\u6607\u5929";

    // event id -> id of the common event that runs it, for the floor events this version of the game has
    const eventCommon = {};
    // Floor events that go by another name than the game gives them: switch id -> name (EVENTS of data.py)
    const EVENT_NAMES = { 161: "Costume Room" }; // "Change to Swimsuit"
    const mapEvents = () => {
        for (const commonEvent of $dataCommonEvents) {
            const id = commonEvent ? commonEvent.switchId : 0;
            if (commonEvent && commonEvent.trigger === 1 && EVENT_RANGES.some(range => id >= range[0] && id <= range[1])) {
                eventCommon[id] = commonEvent.id;
                commonEvent.name = EVENT_NAMES[id] || commonEvent.name;
            }
        }
    };
    const allEvents = () => Object.keys(eventCommon).map(Number);
    const eventData = eventId => $dataCommonEvents[eventCommon[eventId]];
    // The floor events of the seed, as far as this version of the game has them
    const eventIds = () => (option("events") || LEGACY_EVENTS).filter(eventId => eventCommon[eventId]);
    // The relics whose place in an event is a check
    const relicChecks = () => option("relics") || (option("relicsanity") ? LEGACY_RELIC_WEAPONS : []);
    // The cards whose handing out by a floor event is a check
    const cardChecks = () => option("cards") || [];
    const GOLD_ITEMS = { 1: 100, 2: 300 };
    const SOUL_FILLER = { 5: 10, 6: 25, 7: 50 }; // SOUL_FILLER of apworld/lost_chapter/data.py: souls to spend
    // Filler: item id -> [parameter of the protagonist, amount]. Parameters 2-5 are STR, DEF, MAG and AGL.
    const STAT_ITEMS = { 20: [0, 5], 21: [1, 5], 22: [2, 1], 23: [4, 1], 24: [3, 1], 25: [5, 1] };
    // Traps: the Climax Trap empties RP, the others are a state (Confusion, Sticky Fluid, Paralysis, Torn Clothes)
    const ITEM_CLIMAX_TRAP = 30;
    const ITEM_ACID_TRAP = 34;
    // The common events of the enemy skills behind the traps: Hypnotic Spell, Sticky Fluid and Slash
    const TRAP_EVENTS = { 31: 221, 32: 201, 34: 231 };
    // The skill behind the Paralysis Trap has no common event of its own, only an animation
    const TRAP_ANIMATIONS = { 33: 144 };
    const TRAP_STATE_NAMES = { 33: "Paralysis" };
    const STATE_REFLECTION = 21;
    const TRAP_STATES = { 31: 121, 32: 101, 33: 242, 34: 131, 35: 4 }; // 35: Ecstasy Trap, the Lust state
    const VARIABLE_TORN_CLOTHES = 208; // the standing picture and the Seamstress go by this, not by the state
    const SWITCH_IN_BATTLE = 101;
    const TRAP_DELAY_FRAMES = 120; // into a fight before a trap goes off, and between two traps

    // The cards floor events hand out. Which of them are checks comes with the slot data.
    const CARD_ITEMS = [39, 40, 60, 71, 74, 76, 77, 78, 79, 80];
    // What taking a received card into the deck costs in souls: 400 for Ride On, Ride Back, Encase and Candylick,
    // 200 for the other lewd cards (Strip, Taunt, Projection, Temptation), and for Faithful Dog Lassi and Shadow Cat
    // Assam what the game's score gives for holding them (111 and 222), which they do not add either.
    // 15, 17, 18 and 24 are the single cards of the bonus shop (BONUS_CARDS of apworld/lost_chapter/data.py)
    const CARD_COSTS = {
        15: 100, 17: 100, 18: 100, 24: 100, 77: 200, 60: 400, 71: 400, 74: 200, 76: 400, 78: 400, 79: 200, 80: 200,
        40: 111, 39: 222,
    };
    // The deck screen shows the card under the cursor as two pictures named after its item id: "<id>" is the card,
    // "<id>s" its description, which the screen puts into picture 47
    const PICTURE_CARD_PREVIEW = 48;
    const PICTURE_CARD_DESCRIPTION = 47;
    const CARD_PREVIEW_X = 860;
    const CARD_DESCRIPTION_X = 1020;
    const CARD_PREVIEW_Y = 240;
    const LABEL_CARDS = "ArchipelagoCards";
    // Deck screen (common events 73-77): received cards are taken into the deck from a button there
    const SCREEN_DECK = 21;
    const SCREEN_DECK_BUSY = 22;
    const SWITCH_DECK_CONTROL = 75;
    const COMMON_EVENT_DECK_DISPLAY = 75;
    const VARIABLE_DECK_COUNT = 81;
    // The deck screen (common event 75): three rows of five cards to a page, pictures 31-45
    const VARIABLE_DECK_PAGE = 75;
    const VARIABLE_DECK_X = 241;
    const VARIABLE_DECK_Y = 242;
    const DECK_PICTURE_BASE = 31;
    const DECK_PAGE_SLOTS = 15;
    const DECK_ROW_SLOTS = 5;
    const DECK_SLOT_WIDTH = 150;
    const DECK_SLOT_HEIGHT = 220;
    const CARD_ITEM_FIRST = 11; // its picture stands in for an empty slot
    const DECK_LIMIT = 30;
    // The game's own Forget-Me-Not and Pieris counts (picture 46) are moved left by this much, so that the three
    // lines stay in one column and the key at the end of the first fits on the screen
    const PICTURE_DECK_COUNTS = 46;
    const DECK_COUNTS_SHIFT = 80;
    const CARD_BUTTON_X = 930 - DECK_COUNTS_SHIFT;
    const CARD_BUTTON_Y = 560;
    const CARD_BUTTON_WIDTH = 420;
    const CARD_BUTTON_HEIGHT = 36;
    const CARD_BUTTON_KEY = "pageup"; // Q and Page Up
    // The Archipelago icon, 48x48
    const AP_ICON = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADAAAAAwCAYAAABXAvmHAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAAvrSURBVGhDzVkJcBvlFXZomkIKtPTmaEPbKR1Ky9ACZQp0SOk0aadMC8OEtlAaYNrQAmkOa1erY/Vr17Idx3F8SLKw40iOYztgoEBgAiR2dFnHypIl24rlK7EjO75iO7aTOAkJeZ23iRxpJTsyA4E3802s3X+fvu//36VNRsanYHWELGlR6n7hZ3Srmpmc1UFl7mMhRf5PMzIyFknXfq5sz1rFN0OKbF2zIvtgSJkDEZIPnWQLRDT50KzIRoSDSh21e82apdJnP3NzUeSRFlXuQA9XCC2qXPDJs0Cg+Vk0ybOgTb0JDvKFEFLmHnBksvdJfXxm5paRJ8PqPGhT54E3jnQq4P12TT6KnHFmkuVSX1fcvJn83SFl7rmQMvey5C+J4AAFBxS6CS9NbpH6vGJmJeRqgeJCGOPpkp8VQXHQzW0FL8XvJoRcJfV9RUyQ6e5qVmSf7yBbkgheDpgjPdxWEOT8ZJNSd6PU9xUxyIBFAs3fEVDo3unUFoCf0SURlQJPCisS5kGAybYEVFnL4NMqr8eHjXfOjBjp6UHDrsmB4oapIyXvHR8xmGaOmp6aGtB/PX5tE6NTtbObITCPCCQfVOZgFfrIJ9c9F/88baVvUXgU/2I8TAXtoj+gG+l9cre8ivEw/6Vs1I/i117WBvvyfzIzWvrmiREjwCkzwIkKODdVDh9NlwOc3C5iZtQ4Mj1sYK1Wsjj2nE/Or+vQ5CeV0BhQXKtqE3hk3OOxZ6i3qOsYL7OF8TBTpI2ApkUD6ma1CPwbr8k98jOMl7FseGfDzbMk57LRQ4V/OTVWegJmtsPUoB4m+otTYma0FODDSjgxamwc6d38ndjzHlpr6tIWpExqvO6WETq2dt3edbczXqadO8AB42GAclApIXfJQRvWgsKrGNqwd8NDs2SldrS38NGzk2VwaswE49GiJNKpAKfNKLRt4uCmr6APrEw+mu/FnY4nj+HlpXl37LsyGzKXMR5mEHeZsieTToKdAnVADQqfYibTlnlvAnG08YEt350e0h8/PY7kk4nOBRSKJzHWV7gr5kuQ8c/gCBEjjyGFdd9NceLuAcAimU3mwvCQ2WXJZOcCigiqgXJSvS9YX7g2UUC0sBJOW9Le+XhMHimBc5PlMHG46EH05d5QcI1AccM4D6EA7NAeigvGvouyU09hSCQRTAd2Crh2DkWoZ8mP9m298dhA8anjw4YkcukCc2aiv/iVmE8PzVXF+sPFnCBxAryYpEnk0oTSp8ST619tXX216HA8WvI3OFmRRGohwKSe6C8ehiNl4qQpUNy/MYx8NA9hNg8EmluJ1zH2KQd1DhNTSixd0E76ggib7FeigGMDRTkXd/BjAysWhtLYYOHt6NMry1qBcY/NzSfPOh+gefH6xv0bV6oCKgyBJGILwcXk/6coYKK/2IS1XUoKgaQwtHCHT44aYXrIAMcGSlKuwzVTQwZxTHbLuAdwrMau66X4sx45uRWv0076CTbEJhFC4M7K3XIslyLwb7wmXScKaBUFUKKAsWhRQfwJiEk5hU2rAk5gXkSLp8ejRUPj0aLRif7iMx8ee1lsZlhu45+ZHsK+UXSnGEI0t7Ivq1gc2DCEPBdPgHJQj0jjX9mkBNJKxLCgHNQM5aCGZXbZMOWgTigEhUhW5VcliMFrMrvsxQs5cLjw+ZiA89Pb4CTu5KB+//Ehw0uTg/p7hg8Wffv8UP6Xx7qKr58ZNCw7MWJcMT1Ukj89qD+IImeOlopCx6NF05PRgq+hT/9G8o1WZe5jASbraR/F/ylMiFj21jesvwPjX4zjJiWwQRboRrqNclFauVO+HEcKqpG6jljJtUq78kbaTt9Pu2la7pJ7UQT2AhSA/8rsshWigKmBwh+LnfW0BcNk78yI8X7xxmUsGi24ZnrQ8J+To8ZhgFrcgHrpGqkRK1kss8u6dd06YLxMF+2i/5ruOE176D8wHqaJ7+CR/HHGydwwe/NotOiDqSF9VsITGbCI4Z13M1rnaprYaIazr1fwjkfJJuf34leNdRbcfGqy3HZsoOjZ+Otzmcwu45RNyrfX7ll7ffz1ULlwW9DkfqKp1JXpL22kgib3U6EKH74MmLWHyEOLGYGpkNll5vjrGQB1S2Y/EHIVw9lfUvKONiXvBLLJD9q8AGg3BUCT6wOF1j6j5Jxvy8k+sXHF+fhC/Oe5bI1/zRfjP/tLHY+0lAkNzSb32U5LCLorW0V0Wlqg2eSGlpcFL4qJf4bUkUt842098+4PFLzDzW0OglrnBjnZD7SmIQGM1iaKwvu0dn+u1Ee6VkfqljSb3NuRdIc5CIFSF/gMjgT4jY3Qvr0Zena0QdDk2f1+wftijqU0marhhwrOMYA7LSWdCigkK78FKLY+8TjTMKvVujhgbHy/r7pdJCklngqHqg7giQSDhdavSv1lrC3e8yVK09CKO0ux9Ulk5wKeEI8iNPsu1OQ0zVOy39RbHUkiOR8EvV0UIeht70r9ZVCaejmfHwJakz75GBScA+Sc7QyeoNRvKvMYrA8eqAiAvzS9nY9Hk8EphpOgd66adUiIfynN1g+pslxJ5C6PepATK+Tpe4DSNBQmMJ3DfAb7O8N1vdBkdCYRTAeR7c14Gv5ZhzS7dyWbI6QgNz8w1DCRsVIpeId+I9l3WwLTOcxXbPt50OSpweRsKRPE0JCSnA94cpjwHqNN7O4ZFNugxjIpJTgfkLwmR8DwGZCThofjCYbryLWHa8iDvdXkmYPV2hf7dpK/R2t0vwxLSp/f5H6ipUyYDm/zL1gEVi5B73xSdERr6o2YvFKScwHJs9leJN+zTv6eOKShBfTUTX3V2oJD1dqB/leyYPT1XDj6Ri6Mvp4Dh2t56K3huvtqtOye4ksNzFVkuzdU5p1oK/eBYEhfRFdlKwgGW6bohNI06BciQAwZzjG1kbkUMpEK5eOHa/mRiTfzoK+Gg64dGuisZGeBn6O7eJh4Kw/6arnuA2bFr2PPOgv3LW8pFz7CpiUlOhdQgLfEsSEmgFpICJHcJshU7X06RiC8XfXsUF029O/Kgg7LJdKpgPcH67IhWsufaatgLgxj+PuhxEa6d7QlEZ0L2Ph8+sYLr2dk7P4HxK6aoutKweZ4gVLXz75d6Kxi78PwwF3vSEE4FVDEwCtZ0FutnYpYLvxOCJPwEp/e0dda7ksiKwUmsN/oPOsyuJaJJAixLpax9V3qbE8SYSlwFpKz9Y/hcwDkqohFFRp+LeeyOy8Frh//3yaIWNRvzZ6C3i7r3tGaRFgKnJG8elvi5CsnDf/A+UdKOB4Y+xRbP0rIbvF3b6eF/ePI6zlJ5NJFd5UGExsiZvXP0J/HZL21ydj4YaqZKAYsoRFzM/iKHckvuChN/bvzdWNNjg/DZ7aNRyzsTqwyUmILAZ5Cp4XVxnwKJfbW8LamJOIx9FVHwFNiM8ySjre1ZM/1cq3djSKwu0oFiEMeW78Z1+Ib5Q4LG8ZyKSW1EAy/lg2dFvWeGAef3v5ahzmUQBrLa7PJBTg7+Q2NbwCBuX8ArVmze6mCs5uxzmNpFeccMbn3A5fXDDgz4Tp/GVnaaWEHMXmlpBYCTOYOizoQ+37BYC/DPMCZB6fUUJkXsDqFyrzn/aWuvASy85mCs/1GxTvrGK39KMY+CsrZ2o5CVHjf/eqGazos6k9EQGcl2xT7XsFgNw/s6gYc9oIveyBoch9pKfOavaXOuxMIpmtMrvMGpa7xHoY4fs9mC7+lyN6bYvc6KtnQRQIfG2IFq1Tvjvn0lti/376t+Xf+UtfKcLlwV9gQTnwH+klapFJdMYZJmIJYuhh/E59XK6S+r4h1mFUPYwfu2pFMLB307CTQU0XO99SoF/Y/MJ+ktZtVjaNv5GIiJhGcD7ge56aIWV0l9XlF7UCl+o6+Gu40DmrpdmMkjyfXs1Mz1FNFviX1ecXtgFn552gtf27wVV1a8xB278O1/LE2M5v8Py2flUW2qZYfruW6MCywMuGYECPchfFeReDIqzoYF8dt3heqUCS8sPpcWGPec9f11XJ0b422tadKcx7HZiyTeDI9VZqzvdWccKhG+3zdqlVpvQBLx/4PAyQlIclHtxQAAAAASUVORK5CYII=";
    // The milestones come with the slot data. Seeds from before that have these.
    const LEGACY_SOUL_MILESTONES = [50, 100, 200, 500, 1000, 2000];
    const SOUL_UPDATE_FRAMES = 30;
    const SOULS_Y = 104; // the two lines of the soul counter, under the stats of the standby screen

    const NOTICE_WIDTH = 640;
    const NOTICE_FRAMES = 180;
    const NOTICE_FADE_FRAMES = 30;
    const NOTICE_BACKLOG = 4;
    const NOTICE_SE = { name: "Item3", volume: 90, pitch: 100, pan: 0 };
    const ITEM_FLAG_PROGRESSION = 1; // NetworkItem.flags
    const RAINBOW_HUE_STEP = 14; // degrees between two letters
    const RAINBOW_FRAMES = 3; // redrawn every this many frames
    const RAINBOW_SPEED = 3; // degrees per frame

    const AP = {
        socket: null,
        slot: null, // last "Slot" message while a slot is connected
        items: [], // full received item list from the client
        scouts: {}, // location id -> { item, player, flags } for the relic places
        granting: false,
        wrongSlot: false, // the client is connected to another slot than the game was launched for
        speed: 1,
        god: false,
        nextFloorEvent: 0, // dev: switch id forced on the next floor
        chosenFloorEvent: 0, // switch id picked on the standby screen for the floor being entered
        notices: [], // { text, rainbow } waiting to be shown
        notice: { text: "", rainbow: false },
        noticeFrames: 0, // frames the current notice stays up
        noticeDrawn: true,
    };
    window.LostChapterAP = AP;

    //-------------------------------------------------------------------------
    // Session

    const gameFolder = () => require("path").dirname(process.mainModule.filename);

    // {seed, slot, save} written by the client, or null when the game was started without it
    const readSession = () => {
        try {
            const file = require("path").join(gameFolder(), SESSION_FILE);
            const session = JSON.parse(require("fs").readFileSync(file, "utf8"));
            return /^save_ap_[A-Za-z0-9_]+$/.test(session.save) ? session : null;
        } catch (error) {
            return null;
        }
    };

    const SESSION = readSession();
    AP.session = SESSION;
    // The /offline command of the client: the game as it is in a multiworld, with nothing shuffled and no client.
    // Every floor event is open, relics and cards are where the game has them, and the bonus shop is back.
    const OFFLINE = !!(SESSION && SESSION.offline);

    // A log of the session next to the game, started anew with every launch: the game is shipped without the
    // developer console, so this is where its errors and the plugin's own messages can be read afterwards
    const bitmapState = bitmap =>
        bitmap.width + "x" + bitmap.height + " " + bitmap._loadingState + (bitmap._image ? " image" : "") +
        (bitmap._canvas ? " canvas" : "") + (bitmap._baseTexture ? "" : " no texture") +
        (bitmap.mzkp_isTextPicture ? " text" : "");

    const writeLog = text => {
        if (!SESSION) {
            return;
        }
        try {
            const file = require("path").join(gameFolder(), LOG_FILE);
            const frame = typeof Graphics !== "undefined" ? Graphics.frameCount : 0;
            require("fs").appendFileSync(file, new Date().toISOString() + " f" + frame + " " + text + "\n");
        } catch (error) {
            // A log that cannot be written is no reason to stop
        }
    };
    AP.log = writeLog;

    if (SESSION) {
        try {
            require("fs").writeFileSync(require("path").join(gameFolder(), LOG_FILE), "");
        } catch (error) {
            // See writeLog
        }
        writeLog("plugin " + VERSION + " started, session " + JSON.stringify(SESSION));
        window.addEventListener("error", event => {
            writeLog("ERROR " + event.message + " at " + event.filename + ":" + event.lineno + "\n" +
                (event.error && event.error.stack ? event.error.stack : ""));
        });
        window.addEventListener("unhandledrejection", event => {
            writeLog("REJECTION " + (event.reason && event.reason.stack ? event.reason.stack : event.reason));
        });
        for (const level of ["log", "warn", "error"]) {
            const original = console[level];
            console[level] = function() {
                const text = Array.from(arguments).map(String).join(" ");
                // Of the ordinary messages only the plugin's own
                if (level !== "log" || text.startsWith("[AP]")) {
                    writeLog(level.toUpperCase() + " " + text);
                }
                return original.apply(this, arguments);
            };
        }
        // The game now and then fails to load a picture and shows nothing in its place, with or without this
        // plugin: a card on the deck screen for one. A picture that failed is asked for again, a few times.
        const _Bitmap_onError = Bitmap.prototype._onError;
        Bitmap.prototype._onError = function() {
            this._archipelagoRetries = (this._archipelagoRetries || 0) + 1;
            writeLog("image failed, try " + this._archipelagoRetries + ": " + decodeURIComponent(this._url || ""));
            if (this._archipelagoRetries > IMAGE_RETRIES || !this._url) {
                _Bitmap_onError.apply(this, arguments);
                return;
            }
            setTimeout(() => this.retry(), IMAGE_RETRY_MS);
        };
        // And one that still ended up failed is loaded anew the next time something asks for it
        const _ImageManager_loadBitmapFromUrl = ImageManager.loadBitmapFromUrl;
        ImageManager.loadBitmapFromUrl = function(url) {
            for (const cache of [this._cache, this._system]) {
                if (cache && cache[url] && cache[url].isError()) {
                    delete cache[url];
                }
            }
            return _ImageManager_loadBitmapFromUrl.apply(this, arguments);
        };

        // A picture on screen whose image never arrived is invisible and takes no clicks, which leaves the standby
        // screen stuck when it is the picture that takes its clicks. Such a picture loads its image anew.
        const _Sprite_Picture_update = Sprite_Picture.prototype.update;
        Sprite_Picture.prototype.update = function() {
            _Sprite_Picture_update.apply(this, arguments);
            const bitmap = this.bitmap;
            const missing = this.visible && this._pictureName && bitmap && bitmap.width === 0;
            this._archipelagoMissing = missing ? (this._archipelagoMissing || 0) + 1 : 0;
            if (this._archipelagoMissing >= PICTURE_MISSING_FRAMES) {
                this._archipelagoMissing = 0;
                writeLog("picture " + this._pictureId + " '" + this._pictureName + "' has no image (" +
                    bitmapState(bitmap) + "), loading it again");
                for (const url of Object.keys(ImageManager._cache)) {
                    if (ImageManager._cache[url] === bitmap) {
                        delete ImageManager._cache[url];
                    }
                }
                this.loadBitmap();
            }
        };

        // Every multiworld slot saves into its own folder, the normal save folder is never opened
        StorageManager.fileDirectoryPath = function() {
            return require("path").join(gameFolder(), SESSION.save + "/");
        };
    }

    //-------------------------------------------------------------------------
    // Persistent state (lives in the save file)

    // null outside a session, so nothing is ever written into the normal save
    const state = () => {
        if (!SESSION || !$gameSystem) {
            return null;
        }
        if (!$gameSystem._archipelago) {
            $gameSystem._archipelago = {
                seed: null,
                options: {},
                checked: [],
                itemIndex: 0,
                relics: [],
                cards: [], // item ids of the received cards, one entry for each
                claimed: [], // indexes into cards that were taken into the deck this run
                traps: [], // received traps that have not gone off yet
                events: [],
                bosses: [],
                sets: [],
                souls: 0, // banked from the runs that ended
                runSouls: 0, // best value of the current run
                runBase: null, // score the current run started with, which does not count
                goals: [], // values of the goal option that wins have reached
                titles: [],
                regrant: false,
                holdFloor: false,
            };
        }
        return $gameSystem._archipelago;
    };

    // The save has been played in a multiworld. Stays true while offline.
    const bound = () => {
        const s = state();
        return !!(SESSION && s && s.seed !== null);
    };
    AP.bound = bound;

    // The save belongs to the multiworld the client is connected to
    const active = () => !!(AP.slot && bound() && state().seed === AP.slot.seed);

    // In a multiworld, as opposed to offline: what follows from things being shuffled or from the climb being a
    // multiworld's (the doors of the boss floors, the game counting as cleared, the list of origins, revisits)
    const shuffled = () => bound() && !OFFLINE;
    AP.shuffled = shuffled;

    const option = name => (bound() ? state().options[name] : 0);

    //-------------------------------------------------------------------------
    // Connection

    const send = message => {
        if (AP.socket && AP.socket.readyState === WebSocket.OPEN) {
            AP.socket.send(JSON.stringify(message));
        }
    };

    const connect = () => {
        const socket = new WebSocket("ws://127.0.0.1:" + PORT);
        AP.socket = socket;

        socket.onopen = () => {
            AP.lastStatus = null;
            send({ cmd: "Hello", version: VERSION, session: SESSION ? SESSION.save : null });
        };
        socket.onmessage = event => onMessage(JSON.parse(event.data));
        socket.onclose = () => {
            AP.slot = null;
            setTimeout(connect, RECONNECT_MS);
        };
        socket.onerror = () => {};
    };

    const onMessage = message => {
        if (message.cmd === "Slot") {
            AP.slot = message.connected ? message : null;
            AP.wrongSlot = false;
            AP.items = [];
            AP.scouts = {};
            AP.collected = [];
            bindSave();
        } else if (message.cmd === "Items") {
            AP.items = message.items;
        } else if (message.cmd === "Scouts") {
            AP.scouts = message.locations;
        } else if (message.cmd === "Checked") {
            AP.collected = message.locations;
        } else if (message.cmd === "Notice") {
            notify(String(message.text), message.flags & ITEM_FLAG_PROGRESSION);
        } else if (message.cmd === "Death") {
            // DeathLink: someone else died, applied by updateItems once a run is under way
            AP.pendingDeath = String(message.source || "someone");
        } else if (message.cmd === "Speed") {
            setSpeed(message.speed);
        } else if (message.cmd === "Dev") {
            send({ cmd: "DevResult", text: AP.dev(message.args) });
        }
    };

    // Ties the loaded save to the connected seed and reports what it already has
    // What a slot of a multiworld with nothing shuffled would be
    const offlineSlot = () => ({
        connected: true,
        seed: SESSION.seed,
        slot: SESSION.slot,
        name: "Offline",
        slot_data: {
            goal: 0,
            include_dlc: $dataWeapons[WEAPON_PIERIS] && $dataWeapons[WEAPON_PIERIS].name === "Pieris" ? 1 : 0,
            relicsanity: 0,
            shuffle_keys: 0,
            first_victories: 0,
            shuffle_title_effects: 0,
            finisher_move: 0,
            field_exploration: 0,
            final_boss_floor: FREE_DOORS_FLOOR,
            soul_multiplier: 100,
            death_link: 0,
            battle_rewards: 0,
            soul_milestones: [],
            starting_events: [],
            event_groups: {},
            events: allEvents(),
            relics: [],
            cards: [],
        },
    });

    const bindSave = () => {
        const s = state();
        if (OFFLINE && s) {
            AP.slot = offlineSlot();
            // Nothing is locked: every floor event and every door of the Heavenly Kings
            allEvents().forEach(eventId => remember(s.events, eventId));
            KING_SWITCHES.forEach(kingSwitch => remember(s.bosses, kingSwitch));
        }
        if (!SESSION || !AP.slot || !s) {
            return;
        }
        if (AP.slot.seed !== SESSION.seed || AP.slot.slot !== SESSION.slot) {
            AP.wrongSlot = true;
            send({ cmd: "Error", text: "The game was launched for a different slot. Launch it again from the client." });
            return;
        }
        if (s.seed !== null && s.seed !== AP.slot.seed) {
            send({ cmd: "Error", text: "This save belongs to a different multiworld. Start a new game." });
            return;
        }
        s.seed = AP.slot.seed;
        s.options = AP.slot.slot_data;
        scanState();
        send({ cmd: "Checks", locations: s.checked });
    };

    //-------------------------------------------------------------------------
    // Checks

    const check = locationId => {
        const s = state();
        if (!s) {
            return;
        }
        if (!s.checked.includes(locationId)) {
            s.checked.push(locationId);
        }
        if (active()) {
            send({ cmd: "Checks", locations: s.checked });
        }
    };

    // Sent by this save, or checked on the server without it: collected by the player the item is for
    const isSent = location => state().checked.includes(location) || (AP.collected || []).includes(location);

    const checkFloor = floor => {
        for (const milestone of CHECK_FLOORS) {
            if (floor >= milestone) {
                check(FLOOR_OFFSET + milestone);
            }
        }
    };

    // The goals the wins of this save have reached are kept, and sent again whenever the client connects
    const sendGoal = () => {
        const s = state();
        if (active() && s.goals && s.goals.length > 0) {
            send({ cmd: "Goal", goals: s.goals });
        }
    };

    const reachGoals = goals => {
        const s = state();
        s.goals = s.goals || [];
        goals.forEach(goal => remember(s.goals, goal));
        sendGoal();
    };

    const isVirgin = () => $gameActors.actor(1).isStateAffected(STATE_VIRGINITY);

    // The virgin_mode option: a win only counts with the Virginity state intact
    const winCounts = () => !option("virgin_mode") || isVirgin();

    const lastBossDefeated = () => {
        if (!winCounts()) {
            return;
        }
        const goals = [GOAL_NORMAL_END];
        // The ending map plays the TRUE END below this climax count
        if ($gameVariables.value(VARIABLE_CLIMAX_COUNT) < TRUE_END_CLIMAX_LIMIT) {
            goals.push(GOAL_TRUE_END);
        }
        reachGoals(goals);
    };

    const dlcLastBossDefeated = () => {
        if (winCounts()) {
            reachGoals([GOAL_DLC_END]);
        }
    };

    const checkTitle = title => check(SWITCH_OFFSET + TITLE_SWITCH_BASE + title);

    // Virgin mode: losing the Virginity state ends the run the way running out of LP does. The fight is lost, or
    // the event plays out and the game over follows on the way to the next floor.
    const _Game_Battler_removeState = Game_Battler.prototype.removeState;
    Game_Battler.prototype.removeState = function(stateId) {
        const lost = stateId === STATE_VIRGINITY && this.isStateAffected(stateId) && this === $gameActors.actor(1);
        _Game_Battler_removeState.apply(this, arguments);
        if (lost && bound() && option("virgin_mode") && $gameVariables.value(VARIABLE_FLOOR) >= 1) {
            checkTitle(TITLE_LOSE_VIRGINITY);
            notify("Virginity lost, this run is over");
            // An event can go on to heal the player (a night at the Inn), so the run is marked as over as well
            state().runOver = true;
            this.setHp(0);
        }
    };

    // Picks up everything the save already achieved
    const scanState = () => {
        for (let title = 1; title <= TITLE_COUNT; title++) {
            if ($gameParty.hasItem($dataArmors[title], true) || $gameSwitches.value(TITLE_SWITCH_BASE + title)) {
                checkTitle(title);
            }
        }
        for (const switchId of KING_SWITCHES.concat(DLC_BOSS_SWITCHES)) {
            if ($gameSwitches.value(switchId)) {
                check(SWITCH_OFFSET + switchId);
            }
        }
        checkFloor($gameVariables.value(VARIABLE_FLOOR));
        sendGoal();
    };

    // The last things that happened around the standby screen, for "/dev stuck"
    const trace = text => {
        AP.traced = (AP.traced || []).concat([Graphics.frameCount + " " + text]).slice(-TRACE_LENGTH);
        writeLog("trace " + text);
    };

    const _Game_Switches_setValue = Game_Switches.prototype.setValue;
    Game_Switches.prototype.setValue = function(switchId, value) {
        const wasOn = this.value(switchId);
        if (TRACED_SWITCHES.includes(switchId) && !!value !== wasOn) {
            trace("s" + switchId + (value ? " on" : " off"));
        }
        _Game_Switches_setValue.apply(this, arguments);
        if (value && !wasOn && switchId === SWITCH_GAME_OVER && bound()) {
            // DeathLink: every game over is passed on, except the one a death from the multiworld brought
            // The ending map closes a run through the same switch, which is no death
            if (!AP.deathReceived && $gameMap.mapId() !== MAP_ENDING) {
                send({ cmd: "Death", floor: $gameVariables.value(VARIABLE_FLOOR) });
            }
            AP.deathReceived = false;
        }
        if (value && (KING_SWITCHES.includes(switchId) || DLC_BOSS_SWITCHES.includes(switchId))) {
            check(SWITCH_OFFSET + switchId);
        } else if (!value && wasOn && eventCommon[switchId]) {
            // A floor event runs while its switch is on and ends in the standby screen, which turns it off. The
            // first visit is only sent then, when the player has seen which event it was.
            check(SWITCH_OFFSET + switchId);
        }
    };

    // The run as it stands, for the tracker of the client. Sent when something in it changed.
    const sendStatus = () => {
        const actor = $gameActors ? $gameActors.actor(1) : null;
        if (!actor || !$gameParty) {
            return;
        }
        const lewd = $gameVariables.value(VARIABLE_LEWD);
        const status = {
            cmd: "Status",
            floor: $gameVariables.value(VARIABLE_FLOOR),
            faith: actor.param(6),
            virtue: actor.param(7),
            lewd: lewd,
            str: actor.param(2),
            def: actor.param(3),
            mag: actor.param(4),
            agi: actor.param(5),
            // What the title "Minerva's Owl" asks to be over 30
            stats:
                Math.floor((actor.param(0) + actor.param(1) + lewd) / 5) +
                actor.param(2) + actor.param(3) + actor.param(4) + actor.param(5),
            gold: $gameParty.gold(),
            cards: $gameVariables.value(VARIABLE_DECK_COUNT),
            souls: state() ? soulTotal() : 0,
        };
        const text = JSON.stringify(status);
        if (text !== AP.lastStatus) {
            AP.lastStatus = text;
            send(status);
        }
    };

    const _Game_Variables_setValue = Game_Variables.prototype.setValue;
    Game_Variables.prototype.setValue = function(variableId, value) {
        _Game_Variables_setValue.apply(this, arguments);
        if (variableId !== VARIABLE_FLOOR) {
            return;
        }
        const s = state();
        AP.battleDrop = false;
        AP.skipNotes = [];
        if (value === 0 && s) {
            // "---Game Initialization---" strips every relic at the start of a run
            s.regrant = true;
            s.runOver = false;
            AP.deathReceived = false;
            s.claimed = [];
            s.claimedSets = [];
            s.shopBought = {};
            s.lastFight = 0;
            s.checkpoint = 0;
            // The souls of the run that ended are kept, the next one adds to them
            s.souls = (s.souls || 0) + (s.runSouls || 0);
            s.runSouls = 0;
            s.runBase = null;
        }
        checkFloor(value);
        sendStatus();
    };

    const _BattleManager_processVictory = BattleManager.processVictory;
    BattleManager.processVictory = function() {
        const troopId = $gameTroop._troopId;
        // The card choice that follows is the one of a fight. Events hand out cards through the same choice.
        AP.battleDrop = true;
        if (state()) {
            state().lastFight = $gameVariables.value(VARIABLE_FLOOR);
        }
        if (troopId >= 1 && troopId <= CHECK_TROOP_MAX) {
            check(TROOP_OFFSET + troopId);
        } else if (troopId === TROOP_LAST_BOSS && state()) {
            lastBossDefeated();
        } else if (troopId === TROOP_DLC_LAST_BOSS && state()) {
            dlcLastBossDefeated();
        }
        _BattleManager_processVictory.apply(this, arguments);
    };

    // Relicsanity: a relic handed out by an event becomes a check instead
    const _Game_Party_gainItem = Game_Party.prototype.gainItem;
    Game_Party.prototype.gainItem = function(item, amount, includeEquip) {
        if (item && amount > 0 && DataManager.isArmor(item) && item.id <= TITLE_COUNT) {
            checkTitle(item.id);
        }
        const isRelicGain =
            item && amount > 0 && DataManager.isWeapon(item) && RELIC_WEAPONS.includes(item.id);
        if (isRelicGain && !AP.granting && relicChecks().includes(item.id)) {
            check(RELIC_OFFSET + item.id);
            return;
        }
        // The same for a card, but only where a floor event hands it out: cards also come from fights
        if (AP.eventCard && item && amount > 0 && DataManager.isItem(item) && cardChecks().includes(item.id)) {
            check(CARD_OFFSET + item.id);
            return;
        }
        _Game_Party_gainItem.apply(this, arguments);
    };

    // Replaces "has relic n" in the event that hands the relic out. There the game asks whether the relic was
    // already taken, which in a multiworld is whether its check was sent: the relic itself can come from anywhere.
    AP.relicTaken = (weaponId, includeEquip) => {
        if (bound() && relicChecks().includes(weaponId)) {
            return state().checked.includes(RELIC_OFFSET + weaponId);
        }
        return $gameParty.hasItem($dataWeapons[weaponId], includeEquip);
    };

    // Change Items of a floor event: gainItem above is told where the card comes from
    const _Game_Interpreter_command126 = Game_Interpreter.prototype.command126;
    Game_Interpreter.prototype.command126 = function() {
        AP.eventCard = bound() && floorEventOf(this._list) !== 0;
        try {
            return _Game_Interpreter_command126.apply(this, arguments);
        } finally {
            AP.eventCard = false;
        }
    };

    // Replaces "has card n" in the event that hands the card out, like relicTaken does for a relic
    AP.cardTaken = itemId => {
        if (bound() && cardChecks().includes(itemId)) {
            return state().checked.includes(CARD_OFFSET + itemId);
        }
        return $gameParty.hasItem($dataItems[itemId]);
    };

    const scoutLabel = location => {
        const scout = AP.scouts[location];
        // A backslash would start an escape code in a choice
        return scout ? (scout.item + " for " + scout.player).replace(/\\/g, "") : null;
    };

    const cardLabel = itemId => (bound() && cardChecks().includes(itemId) ? scoutLabel(CARD_OFFSET + itemId) : null);

    // "Item for Player" for the multiworld item an event hands out in place of the relic, null when unknown
    const relicLabel = weaponId => {
        const scout = bound() && relicChecks().includes(weaponId) && AP.scouts[RELIC_OFFSET + weaponId];
        // A backslash would start an escape code in a choice
        return scout ? (scout.item + " for " + scout.player).replace(/\\/g, "") : null;
    };

    // The relic the branch of `choice` hands out, for the choices command at `start`
    const branchRelic = (list, start, choice) => {
        const indent = list[start].indent;
        let inBranch = false;
        for (let i = start + 1; i < list.length; i++) {
            const item = list[i];
            if (item.indent === indent) {
                if (item.code !== 402 && item.code !== 403) {
                    break;
                }
                inBranch = item.code === 402 && item.parameters[0] === choice;
            } else if (inBranch && item.code === 127 && item.parameters[1] === 0) {
                if (relicChecks().includes(item.parameters[0])) {
                    return item.parameters[0];
                }
            }
        }
        return 0;
    };

    // MPP_ChoiceEX conditions at the end of a choice: if(...) hides it, en(...) grays it out
    const FINAL_BOSS_LOCK = "en(s[" + SWITCH_FINAL_BOSS + "])";
    const CHOICE_SHOWN = /\s?if\((.+?)\)/;
    const CHOICE_ENABLED = /\s?en\((.+?)\)/;
    const STAT_VARIABLES = { 49: "FAITH", 50: "VIRTUE", 51: "LEWD" };
    const STAT_SIGNS = { ">=": "\u2267", ">": ">", "<=": "\u2266", "<": "<" };

    // "(LEWD \u2267 10)" for a condition like v[51]>=10, null when it is about anything else
    const statRequirement = condition => {
        const parts = [];
        const rest = condition.replace(/v\[(\d+)\]\s*(>=|<=|>|<)\s*(\d+)/g, (match, variableId, comparison, value) => {
            if (!STAT_VARIABLES[variableId]) {
                return match;
            }
            parts.push(STAT_VARIABLES[variableId] + " " + STAT_SIGNS[comparison] + " " + value);
            return "";
        });
        return parts.length > 0 && !/[^\s&]/.test(rest) ? "(" + parts.join(", ") + ")" : null;
    };

    const stripConditions = text => text.replace(CHOICE_SHOWN, "").replace(CHOICE_ENABLED, "");

    // "the origin The New Ruler" for a choice only that origin has, null when the condition is about anything else
    const originRequirement = condition => {
        const match = /^\s*v\[(\d+)\]\s*==\s*(\d+)\s*$/.exec(condition);
        const origin = match && Number(match[1]) === VARIABLE_ORIGIN
            ? ORIGINS.concat([DLC_ORIGIN]).find(other => other[0] === Number(match[2]))
            : null;
        const name = origin ? /\[(.+?)\]/.exec(origin[1]) : null;
        return name ? "the origin " + name[1] : null;
    };

    // switch id -> the floor events that turn it on
    let switchSetters = null;
    const findSwitchSetters = () => {
        switchSetters = {};
        for (const eventId of allEvents()) {
            for (const item of eventData(eventId).list) {
                const p = item.parameters;
                if (item.code === 121 && p[0] === p[1] && p[2] === 0) {
                    switchSetters[p[0]] = switchSetters[p[0]] || [];
                    remember(switchSetters[p[0]], eventId);
                }
            }
        }
    };

    // "the Old Woman event" for a choice that only shows once another floor event turned its switch on, null when
    // the condition is about anything else
    const eventRequirement = (eventId, condition) => {
        const match = /^\s*s\[(\d+)\]\s*$/.exec(condition);
        return match ? switchRequirement(eventId, Number(match[1])) : null;
    };

    const switchRequirement = (eventId, switchId) => {
        if (!switchSetters) {
            findSwitchSetters();
        }
        const setters = switchSetters[switchId] || [];
        if (setters.length === 0 || setters.length > STORY_SWITCH_EVENTS || setters.includes(eventId)) {
            return null;
        }
        const names = setters.map(eventName).filter((name, index, all) => all.indexOf(name) === index);
        return "the " + names.join(" or ") + " event";
    };

    // A choice of a floor event whose condition is not met stays on the list, grayed out, and says what it takes.
    // `original` is the text of the event data, `text` what is shown for it.
    const lockedChoice = (interpreter, eventId, original, text) => {
        const failed = [CHOICE_SHOWN.exec(original), CHOICE_ENABLED.exec(original)].find(
            match => match && !interpreter.evalChoice(match[1])
        );
        if (!failed) {
            return text;
        }
        const key = stripConditions(original)
            .replace(/\\c\[\d+\]/gi, "")
            .trim();
        const requirement =
            (CHOICE_REQUIREMENTS[eventId] || {})[key] ||
            statRequirement(failed[1]) ||
            eventRequirement(eventId, failed[1]) ||
            originRequirement(failed[1]);
        if (!requirement) {
            return text;
        }
        // A stat reads as "(LEWD \u2267 10)", anything else as "requires Pretty Water"
        const note = requirement.startsWith("(") ? requirement : "requires " + requirement;
        return stripConditions(text) + " \\c[18]" + note + "\\c[0]en(0)";
    };

    // What a choice of a floor event does, by the common event and the text of the choice without its codes. Where
    // two events share a name on the floor choice (Desert, Temple, Hot Spring) both outcomes are named, so the
    // choice does not give away which of them it is.
    const CHOICE_EFFECTS = {
        21: {"Explore %": "Forget-Me-Not, fail: LP -3"},
        22: {"Enter the Hot Spring": "LP & RP + or LP -20%"},
        23: {"Enter the Hot Spring": "LP & RP + or LP -20%"},
        24: {"Pass Through the Forest %": "AGL +1, fail: LP -5", "Take a Detour": "LP -2"},
        25: {"Rest in a Cheap Room -50 G": "LP & RP +1/3", "Rest in an Expensive Room -150 G": "LP & RP full", "Cheap Room -50 G": "LP & RP +1/3", "Expensive Room -150 G": "LP & RP full", "I Don't Mind": "LEWD +2, then rest", "Take Off Underwear": "RP -2", "Expose Vagina": "RP -10, Gold, LEWD +3", "Can't Do That": "LEWD +2, rest", "Flee": "LEWD +2, rest", "Answer": "more Gold", "Disregard": "less Gold"},
        26: {"Drink": "LP +3, FAITH +5 or Lust", "Refuse": "FAITH -5"},
        27: {"Drink": "LP +3, FAITH +5 or Lust", "Refuse": "FAITH -5", "Beg For His Semen": "LEWD +2/+3, ends Lust", "Ignore Him and Move On": "Lust stays", "Get Revenge on the Man": "Pieris, VIRTUE -10"},
        28: {"Ask for Assistance": "LP + or Forget-Me-Not", "Ask for Salvation": "FAITH +5, Womb Crest off or on", "Ask for Mercy": "Gold +60 or LEWD +2"},
        29: {"Ask for Assistance": "LP + or Forget-Me-Not", "Ask for Salvation": "FAITH +5, Womb Crest off or on", "Ask for Mercy": "Gold +60 or LEWD +2"},
        30: {"Pray": "FAITH +5", "Rush Over": "＜Cure＞ saves him, else he dies", "Abandon": "VIRTUE -5", "Save Lose ＜Cure＞": "Recovery Misanga", "Talk About the Woman": "Recovery Misanga", "Say Nothing": "Recovery Misanga"},
        31: {"Donate -20 G": "VIRTUE +5", "Advise": "VIRTUE ≧ 70: VIRTUE +5", "For Their Sake": "gives all Gold, the Corridor returns it ×3"},
        32: {"The Man Is in the Wrong %": "Max LP +5", "The Woman Is in the Wrong %": "Max RP +5"},
        33: {"Receive clothes": "ends Nude", "Thank Him": "VIRTUE +5", "Refuse the offer": "FAITH -5", "Don't Need Anything": "FAITH -5"},
        34: {"Buy -30 G": "Random Stat +1", "Buy -50 G": "chosen Stat +1", "Invest Lose ＜Investment＞": "better goods from now on", "Attack from behind": "Pieris"},
        35: {"Drink the Blue Potion": "Max LP +5", "Drink the Red Potion": "Bosomy on or off", "Drink the Yellow Potion": "ends Regression"},
        36: {"Bet on Heads": "heads: Gold +200, tails: LP +", "Bet on Tails": "tails: LP ++, heads: Gold +100", "Bet your life": "Clown Mask, Pieris"},
        37: {"Pick It Up": "LP -2, Forget-Me-Not", "Water It": "lose Pretty Water, all Stats +1"},
        38: {"Obtain": "Promise Pendant", "Overlook": "Promise Pendant", "Can't Do That": "LP damage, ends the Monster quest", "Tell Her the Location of the Man's Grave": "Promise Pendant"},
        39: {"Rummage Through a Shelf %": "add a card", "Search Under the Floor %": "add a card"},
        40: {"Pay -40 G": "MAG +1, FAITH -5", "Pay -160 G": "MAG +2, FAITH -5", "Seduce ＜Levy Suit＞ Required": "MAG +1, FAITH -5, LEWD +2", "Refuse": "FAITH +5"},
        41: {"Yes": "Moon Hair Ornament, VIRTUE +5", "No": "FAITH -5", "Play With Her": "RP +5", "Dodge Her Question": "FAITH -5"},
        42: {"Leave him alone＜HEALING＞ Lost": "Dusk Ring, VIRTUE +5", "So Be It Lose ＜Healing＞": "Dusk Ring, VIRTUE +5", "Can't Do Anything": "Collar Key", "Free him from suffering": "Pieris", "Accept His Request": "Collar Key"},
        43: {"Beckon Dog Over": "Max RP +5", "Unlock the Dog's Collar": "obtain Faithful Dog Lassi", "Release from curse": "Pieris"},
        44: {"Pat": "LEWD +2, LEWD ≧ 10: a card", "Hug": "Bosomy, else LEWD +2"},
        45: {"Rummage Through Their Belongings %": "Gold, VIRTUE -3", "Rummage Again %": "Gold, VIRTUE -3", "Flee": "lose Lassi, VIRTUE -10", "Resign Yourself": "lose that Gold, LEWD +3", "Make up your mind": "fight: Pieris", "Give in to their demands": "lose that Gold, LEWD +3"},
        46: {"Entrust": "ends Nude and Torn Clothes", "Attack from behind": "Pieris"},
        47: {"Cross the River %": "LP -2, DEF +1, fail: LP -4", "Take a Detour": "AGL +1"},
        48: {"Help Yourself": "Gold +200, then a trap", "Doubt": "FAITH -5", "! %": "fail: LP -10, Torn Clothes", "Dodge ＜Step＞ Required": "no damage"},
        49: {"Stay": "a card or LEWD +2", "Flee": "FAITH -5", "Follow the Man": "LEWD +2, Womb Crest"},
        50: {"Hold His Hand": "VIRTUE +20", "Get Revenge on Him": "VIRTUE -20", "Leave This World": "plays an ending"},
        51: {"Pick It Up": "LP -2, Forget-Me-Not"},
        52: {"Masturbate": "LEWD +5"},
        53: {"Pay": "Gold -60", "Don't Pay": "LP -3", "Seduce": "Gold +100, LEWD +2", "Take Off Underwear": "Gold +100, LEWD +3", "Refuse": "LEWD +1", "Resign Yourself": "LP -3"},
        54: {"Drink the Water": "LP +1/3", "Bathe in water": "washes you clean", "Bathe in the Water": "washes you clean"},
        55: {"Help": "LP -2, Gold +80, VIRTUE +5", "Pilfer %": "Gold +150, VIRTUE -5", "Depart": "FAITH -5"},
        56: {"I Came to See You": "a wish", "I Wish for Strength": "Random Stat +1", "I Wish for Gold": "Gold +158", "I Wish for Charm": "LEWD +2", "Counterattack": "LP damage, Pieris"},
        57: {"Create White Key": "uses Music Box, Recovery Misanga, Moon Hair Ornament", "Create Black Key": "uses Plushie, Clown Mask, Promise Pendant", "Hand Over the Other Key": "its three relics back"},
        58: {"Remove the Portrait": "the donated Gold ×3", "Use Black Key": "all Stats +3, later +1"},
        59: {"Seduce the King": "LEWD +4, VIRTUE -10, the king dies", "Show Ring": "Aetolus Flag"},
        60: {"Hoist Flag": "uses Aetolus Flag"},
        61: {"Open the Door": "White Key and Black Key: Monster quest, without them FAITH +10", "Apologize": "FAITH +10"},
        591: {"Wear Clothes": "ends Nude", "Wear a swimsuit": "ends Nude", "Stay as you are": "LUX +50"},
        592: {"I want to fight too": "DEF +1", "Leave him ＜Loyal Dog Lassie＞ Lost": "Max LP +30", "I don’t know what to do": "opens the Checkpoint"},
        593: {"Show contempt for the man": "FAITH -5", "Praise the woman": "FAITH +5", "Release desire": "LEWD +2"},
        594: {"Depart": "FAITH -5", "Accept to take a message.": "VIRTUE +5", "Hello": "Memento Chisel: VIRTUE +5, else LP & RP full", "I won't hesitate to do it.": "Gold +150, Pieris"},
        595: {"Continue onward": "AGL +1", "Turn Back": "MAG +1 on the road, LEWD -2 at the checkpoint", "Take off underwear ＜Strip＞Required": "LEWD +2", "I came to see you": "VIRTUE +5, Memento Chisel", "Don't you want to see your mother?": "Pieris, Memento Chisel", "Refuse the request": "LEWD +2"},
        597: {"Sell your body": "Gold +100, LEWD +2", "Refuse": "LEWD -3", "Overlook": "Gold +300", "Give Judgment": "Pieris, ends Beastification", "Resist": "LP -8", "Accept the offer": "Beastification"},
        598: {"Offer a crown of Forget-Me-Not": "LP regen +5", "Offer a crown of Pieris": "RP regen +5", "Depart": "FAITH -5"},
        600: {"Do you know how to get out?": "FAITH +5", "What about you?": "VIRTUE +5", "You brought a tool": "VIRTUE +5"},
        601: {"Explore the coffin %": "FAITH -5, add a card", "Depart": "FAITH +5"},
    };

    const effectKey = text =>
        stripConditions(text)
            .replace(/\\[a-z]+\[\d*\]/gi, "")
            .replace(/\s+/g, " ")
            .trim();

    // `text` with what the choice does behind it, in front of its conditions
    const withEffect = (eventId, original, text) => {
        let effect = (CHOICE_EFFECTS[eventData(eventId).id] || {})[effectKey(original)];
        const hammer = WEAPON_OLD_IRON_HAMMER;
        if (effect && eventData(eventId).id === COMMON_EVENT_MARSH && relicChecks().includes(hammer)) {
            if (!state().checked.includes(RELIC_OFFSET + hammer)) {
                effect = effect.replace("Forget-Me-Not", $dataWeapons[hammer].name);
            }
        }
        if (!effect || text.includes("\\c[18]")) {
            return text;
        }
        // A card that is a check is named by what is really there
        for (const itemId of cardChecks()) {
            const name = $dataItems[itemId] ? $dataItems[itemId].name : "";
            if (name && effect.includes(name)) {
                const sent = state().checked.includes(CARD_OFFSET + itemId);
                effect = effect.replace(name, sent ? name + " (found)" : cardLabel(itemId) || name);
            }
        }
        // The same for a relic, where the choice hands it out: one that is given up or used is the relic itself
        const handsOut = !/^(lose|uses) /.test(effect);
        for (const weaponId of handsOut ? relicChecks() : []) {
            const name = $dataWeapons[weaponId] ? $dataWeapons[weaponId].name : "";
            if (name && effect.includes(name) && !text.includes(relicLabel(weaponId) || name)) {
                const sent = state().checked.includes(RELIC_OFFSET + weaponId);
                effect = effect.replace(name, sent ? name + " (found)" : relicLabel(weaponId) || name);
            } else if (name && effect === name) {
                return text;
            }
        }
        const conditions = /((?:if|en)\([^)]*\)\s*)+$/.exec(text);
        const at = conditions ? conditions.index : text.length;
        return text.slice(0, at) + " \\c[8](" + effect + ")\\c[0]" + text.slice(at);
    };

    // Not every option of a floor event is a choice that can be shown grayed out: some sit in a part of the event
    // that is passed over as a whole (the cursed dog is only released by a player with the Collar Key). A notice
    // names the first choice of such a part and what it takes, as far as the condition is one that can be named.
    const SKIP_NOTICES = 2; // a visit
    const branchRequirement = (eventId, p) => {
        if (p[0] === 0 && p[2] === 0) {
            return switchRequirement(eventId, p[1]);
        }
        if (p[0] === 1 && p[1] === VARIABLE_ORIGIN && p[2] === 0 && p[4] === 0) {
            return originRequirement("v[" + VARIABLE_ORIGIN + "]==" + p[3]);
        }
        const list = eventData(eventId).list;
        // Not the relic the event itself hands out: that question is whether it was taken
        const handsOut = other => other.code === 127 && other.parameters[0] === p[1] && other.parameters[1] === 0;
        return p[0] === 9 && $dataWeapons[p[1]] && !list.some(handsOut) ? $dataWeapons[p[1]].name : null;
    };

    const noteSkipped = (list, at, taken, eventId) => {
        const item = list[at];
        const p = item.parameters;
        let from = at;
        let requirement = null;
        if (!taken) {
            requirement = branchRequirement(eventId, p);
        } else if (p[0] === 0 && p[2] === 1) {
            // "the switch is off" held: what comes after its Else takes the switch
            from = list.findIndex((other, i) => i > at && other.indent <= item.indent);
            requirement = from >= 0 && list[from].code === 411 ? switchRequirement(eventId, p[1]) : null;
        }
        if (!requirement) {
            return;
        }
        let choices = null;
        for (let i = from + 1; i < list.length && list[i].indent > item.indent && !choices; i++) {
            choices = list[i].code === 102 ? list[i].parameters[0] : null;
        }
        const notes = AP.skipNotes || (AP.skipNotes = []);
        if (!choices || notes.length >= SKIP_NOTICES || notes.includes(at)) {
            return;
        }
        notes.push(at);
        const text = effectKey(String(choices[0]));
        notify(/[a-z]/i.test(text)
            ? "\"" + text + "\" is not offered: requires " + requirement
            : "Another scene of this event requires " + requirement);
    };

    const _Game_Interpreter_command111 = Game_Interpreter.prototype.command111;
    Game_Interpreter.prototype.command111 = function() {
        const list = this._list;
        const at = this._index;
        const indent = this._indent;
        const result = _Game_Interpreter_command111.apply(this, arguments);
        const eventId = bound() && list && list[at] && list[at].code === 111 ? floorEventOf(list) : 0;
        if (eventId) {
            noteSkipped(list, at, !!this._branch[indent], eventId);
        }
        return result;
    };

    const floorEventOf = list => {
        return allEvents().find(eventId => eventData(eventId).list === list) || 0;
    };

    const _Game_Interpreter_setupChoices = Game_Interpreter.prototype.setupChoices;
    Game_Interpreter.prototype.setupChoices = function(params) {
        const list = this._list;
        const start = this._index;
        if (bound() && list && list[start] && list[start].code === 102) {
            const eventId = this.evalChoice ? floorEventOf(list) : 0;
            const choices = params[0].map((text, choice) => {
                // "Take a Plushie" names what is really there
                const relic = option("relicsanity") ? branchRelic(list, start, choice) : 0;
                const label = relic ? relicLabel(relic) : null;
                const named = label ? String(text).replace($dataWeapons[relic].name, () => label) : String(text);
                const conclusion = conclusionChoice(String(text));
                if (conclusion) {
                    return conclusion;
                }
                const lewd = $gameVariables.value(VARIABLE_LEWD);
                if (eventId === COMMON_EVENT_CAT && named === "Pat" && lewd >= CAT_LEWD && AP.catDone()) {
                    return "Pat \\c[18](all cards found)\\c[0]en(0)";
                }
                // A gift of the merchant that is taken stays on his list, grayed out
                if (eventId === COMMON_EVENT_MARKET && AP.marketMenu() && /if\(!s\[1[12]\]\)/.test(named)) {
                    return named.replace("if(!s[", "en(!s[");
                }
                if (named.includes(FINAL_BOSS_LOCK) && !$gameSwitches.value(SWITCH_FINAL_BOSS)) {
                    return named.replace(FINAL_BOSS_LOCK, " \\c[18]requires floor " + finalBossFloor() + "\\c[0]en(0)");
                }
                return eventId ? withEffect(eventId, String(text), lockedChoice(this, eventId, String(text), named)) : named;
            });
            params = [choices].concat(params.slice(1));
        }
        _Game_Interpreter_setupChoices.call(this, params);
    };

    // The "Obtained" window of TinyGetInfoWndMZ draws the name and description of the weapon or card it is given
    const _Spriteset_Base_addGetInfoWindow = Spriteset_Base.prototype.addGetInfoWindow;
    if (_Spriteset_Base_addGetInfoWindow) {
        Spriteset_Base.prototype.addGetInfoWindow = function(id, type, text, value, includeEquip) {
            const isRelic = type === 1 && value > 0 && relicChecks().includes(id);
            const isCard = type === 0 && value > 0 && AP.eventCard;
            const label = isRelic ? relicLabel(id) : isCard ? cardLabel(id) : null;
            if (!label) {
                _Spriteset_Base_addGetInfoWindow.apply(this, arguments);
                return;
            }
            const weapon = isRelic ? $dataWeapons[id] : $dataItems[id];
            const original = { name: weapon.name, description: weapon.description, info: weapon.meta.info };
            weapon.name = label;
            weapon.description = "";
            delete weapon.meta.info;
            try {
                _Spriteset_Base_addGetInfoWindow.call(this, id, type, "Found", value, includeEquip);
            } finally {
                weapon.name = original.name;
                weapon.description = original.description;
                if (original.info !== undefined) {
                    weapon.meta.info = original.info;
                }
            }
        };
    }

    //-------------------------------------------------------------------------
    // Souls

    // The part of common event 72 that adds up the score of the run, set when the data loads
    let scoreCommands = null;

    const compare = (left, right, operation) => {
        switch (operation) {
            case 0:
                return left === right;
            case 1:
                return left >= right;
            case 2:
                return left <= right;
            case 3:
                return left > right;
            case 4:
                return left < right;
            default:
                return left !== right;
        }
    };

    // null for a condition this evaluator does not know
    const scoreCondition = p => {
        switch (p[0]) {
            case 0:
                return $gameSwitches.value(p[1]) === (p[2] === 0);
            case 1:
                return compare($gameVariables.value(p[1]), p[2] === 0 ? p[3] : $gameVariables.value(p[3]), p[4]);
            case 8:
                return $gameParty.hasItem($dataItems[p[1]]);
            case 9:
                return $gameParty.hasItem($dataWeapons[p[1]], p[2]);
            case 10:
                return $gameParty.hasItem($dataArmors[p[1]], p[2]);
            default:
                return null;
        }
    };

    // Evaluates the game's own score commands without touching any variable
    const runScore = () => {
        if (!scoreCommands) {
            return null;
        }
        let score = 0;
        let skipAbove = -1; // skipping everything nested deeper than this indent
        const branchTaken = {};
        for (const item of scoreCommands) {
            const p = item.parameters;
            if (skipAbove >= 0) {
                if (item.indent > skipAbove) {
                    continue;
                }
                skipAbove = -1;
            }
            if (item.code === 111) {
                const result = scoreCondition(p);
                if (result === null) {
                    return null;
                }
                branchTaken[item.indent] = result;
                if (!result) {
                    skipAbove = item.indent;
                }
            } else if (item.code === 411) {
                if (branchTaken[item.indent]) {
                    skipAbove = item.indent;
                }
            } else if (item.code === 122 && p[0] === VARIABLE_SCORE && p[1] === VARIABLE_SCORE && p[3] <= 1) {
                const value = p[3] === 0 ? p[4] : $gameVariables.value(p[4]);
                score = Math.floor([value, score + value, score - value, score * value, score / value, score % value][p[2]]);
            } else if (item.code !== 0 && item.code !== 412 && item.code !== 122) {
                return null;
            }
        }
        return score;
    };

    // The score goes by variables that the game only brings up to date in its status display (common event 2: gold,
    // the stats, FAITH and VIRTUE). Measured around a received item they would still be the old ones, and the item
    // would count for the souls a moment later. Those commands of the event are carried out first.
    const freshScore = () => {
        const copies = $dataCommonEvents[COMMON_EVENT_GUI].list.filter(
            item => item.code === 122 && item.indent === 0 && item.parameters[3] === 3
        );
        const interpreter = new Game_Interpreter();
        interpreter.setup(copies.concat([command(0, 0, [])]));
        interpreter.update();
        return runScore();
    };

    // Souls spent on cards are gone, the milestones they reached before stay checked
    // 0 without a session: the labels that show it are asked for their text in the normal game too
    const soulTotal = () => {
        const s = state();
        return s ? (s.souls || 0) + (s.runSouls || 0) - (s.spent || 0) : 0;
    };

    const soulMilestones = () => option("soul_milestones") || LEGACY_SOUL_MILESTONES;

    // The souls a milestone takes
    const soulsFor = milestone => milestone;

    // The soul_multiplier option is a percentage from 100 up. Seeds from before that have a factor from 1 to 10.
    const soulRate = () => {
        const value = option("soul_multiplier") || 100;
        return value >= 100 ? value / 100 : value;
    };

    const updateSouls = () => {
        const s = state();
        const score = $gameVariables.value(VARIABLE_FLOOR) >= 1 ? runScore() : null;
        if (score !== null && s.runBase != null) {
            // A score under what the run started with means the start was measured too high, with something of
            // the run before still counted in it. The souls of this run count from the lower value.
            if (score < s.runBase) {
                s.runBase = score;
            }
            s.runSouls = Math.max(s.runSouls, Math.floor((score - s.runBase) * soulRate()));
        }
        for (const milestone of soulMilestones()) {
            if (soulTotal() >= soulsFor(milestone) && !s.checked.includes(SOUL_OFFSET + milestone)) {
                check(SOUL_OFFSET + milestone);
            }
        }
    };

    const soulText = () => {
        if (!bound()) {
            return "";
        }
        const next = soulMilestones().find(milestone => soulsFor(milestone) > soulTotal());
        return soulTotal() + (next ? " / " + soulsFor(next) : "");
    };

    // A line of text drawn over the map scene, redrawn only when it changes
    const createLabel = (scene, x, y, width, align) => {
        const sprite = new Sprite(new Bitmap(width, 32));
        sprite.x = x;
        sprite.y = y;
        sprite.visible = false;
        sprite.bitmap.fontFace = $gameSystem.mainFontFace();
        sprite.bitmap.fontSize = 22;
        sprite._archipelagoAlign = align;
        sprite._archipelagoText = "";
        scene.addChild(sprite);
        return sprite;
    };

    const updateLabel = (sprite, visible, text, color) => {
        if (!sprite) {
            return;
        }
        sprite.visible = visible;
        if (visible && sprite._archipelagoText !== text) {
            sprite._archipelagoText = text;
            sprite.bitmap.clear();
            sprite.bitmap.textColor = color || "#ffffff";
            sprite.bitmap.drawText(text, 0, 0, sprite.bitmap.width, sprite.bitmap.height, sprite._archipelagoAlign);
        }
    };

    const _Scene_Map_createDisplayObjects = Scene_Map.prototype.createDisplayObjects;
    Scene_Map.prototype.createDisplayObjects = function() {
        _Scene_Map_createDisplayObjects.apply(this, arguments);
        this._archipelagoSoulsTitle = createLabel(this, Graphics.width - 336, SOULS_Y, 320, "right");
        this._archipelagoSouls = createLabel(this, Graphics.width - 336, SOULS_Y + 28, 320, "right");
        this._archipelagoStatus = createLabel(this, 16, Graphics.height - 44, 720, "left");
        this._archipelagoNotice = createLabel(this, (Graphics.width - NOTICE_WIDTH) / 2, 8, NOTICE_WIDTH, "center");
        this._archipelagoCards = createCardButton(this);
        this._archipelagoReroll = createLabel(this, (Graphics.width - NOTICE_WIDTH) / 2, REROLL_Y, NOTICE_WIDTH, "center");
    };

    // The next open battle reward, 0 when there is none: first what an earlier stretch of 20 floors still has
    // open, so nothing is lost by climbing on, then the stretch the player is on
    const battleReward = () => {
        if (!bound()) {
            return 0;
        }
        // The stretches go up to the boss floor of the final boss
        const last = Math.min(
            Math.ceil($gameVariables.value(VARIABLE_FLOOR) / BOSS_FLOOR_INTERVAL),
            Math.ceil(finalBossFloor() / BOSS_FLOOR_INTERVAL)
        );
        for (let stretch = 1; stretch <= last; stretch++) {
            for (let number = 1; number <= (option("battle_rewards") || 0); number++) {
                const location = BATTLE_OFFSET + 100 * stretch + number;
                if (!isSent(location)) {
                    return location;
                }
            }
        }
        return 0;
    };

    // One of the three cards of a won fight is the next battle reward, as a card of its own. Runs in common event
    // 17 once the cards are rolled: the variable of one of them gets an id no card has, whose pictures are drawn
    // by drawRewardCard below instead of being loaded.
    AP.rollDrop = () => {
        AP.dropLocation = AP.battleDrop ? battleReward() : 0;
        if (AP.dropLocation) {
            $gameVariables.setValue(VARIABLE_DROP_FIRST + Math.floor(Math.random() * DROP_CARDS), REWARD_CARD);
        }
    };

    // Replaces the "gain the chosen card" of common event 16: the reward card sends its check instead
    AP.takeDrop = variableId => {
        const itemId = $gameVariables.value(variableId);
        if (itemId !== REWARD_CARD) {
            $gameParty.gainItem($dataItems[itemId], 1);
            return;
        }
        if (AP.dropLocation) {
            check(AP.dropLocation);
        }
        AP.dropLocation = 0;
        AP.battleDrop = false;
    };

    const rewardIcon = new Image();
    rewardIcon.src = AP_ICON;

    // The pictures of the reward card, the size of a card of the game: "<id>" is its face, "<id>s" what Shift
    // shows in its place (what the check holds, as far as the client told), and a card from id 51 on has a third
    // picture below it, which stays empty.
    const drawRewardCard = name => {
        if (name === "5" + REWARD_CARD + "s") {
            return new Bitmap(1, 1);
        }
        if (name !== String(REWARD_CARD) && name !== REWARD_CARD + "s") {
            return null;
        }
        const bitmap = new Bitmap(CARD_WIDTH, CARD_HEIGHT);
        const scout = AP.scouts[AP.dropLocation];
        const text = (line, y, size, color) => {
            bitmap.fontFace = $gameSystem.mainFontFace();
            bitmap.fontSize = size;
            bitmap.textColor = color;
            bitmap.drawText(line, 6, y, CARD_WIDTH - 12, size + 6, "center");
        };
        bitmap.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT, "#c9a227");
        bitmap.gradientFillRect(3, 3, CARD_WIDTH - 6, CARD_HEIGHT - 6, "#1d2a44", "#0c111d", true);
        if (name === String(REWARD_CARD)) {
            if (rewardIcon.complete && rewardIcon.naturalWidth > 0) {
                bitmap.context.drawImage(rewardIcon, (CARD_WIDTH - 88) / 2, 34, 88, 88);
            }
            text("Archipelago", 136, 18, "#b0e0a0");
            text("Battle Reward", 164, 15, "#ffffff");
        } else {
            const progression = scout && scout.flags & ITEM_FLAG_PROGRESSION;
            text("Sends", 14, 15, "#b0b0b0");
            // The name of the item, broken into lines that fit the card
            const lines = [];
            bitmap.fontSize = 16;
            for (const word of String(scout ? scout.item : "an unknown item").split(" ")) {
                const last = lines.length - 1;
                if (last >= 0 && bitmap.measureTextWidth(lines[last] + " " + word) <= CARD_WIDTH - 12) {
                    lines[last] += " " + word;
                } else {
                    lines.push(word);
                }
            }
            lines.slice(0, 5).forEach((line, i) => text(line, 44 + 22 * i, 16, progression ? "#d0a0ff" : "#ffffff"));
            if (scout && scout.player) {
                text("to", 160, 15, "#b0b0b0");
                text(scout.player, 180, 16, "#b0e0a0");
            }
        }
        bitmap.baseTexture.update();
        return bitmap;
    };

    const _ImageManager_loadPicture = ImageManager.loadPicture;
    ImageManager.loadPicture = function(filename) {
        return (bound() && drawRewardCard(String(filename))) || _ImageManager_loadPicture.apply(this, arguments);
    };

    // While the cards of a won fight are up, souls buy three new ones
    const updateCardReroll = scene => {
        const dropping = bound() && $gameSwitches.value(SWITCH_DROP_CONTROL);
        const cost = dropping ? shopPrice("cards", $gameVariables.value(VARIABLE_FLOOR)) : 0;
        const affordable = dropping && soulTotal() >= cost;
        const text = "[W] Reroll cards: " + cost + " souls (you have " + (dropping ? soulTotal() : 0) + ")";
        updateLabel(scene._archipelagoReroll, dropping, text, affordable ? "#b0e0a0" : "#909090");
        if (affordable && Input.isTriggered(REROLL_KEY)) {
            spendSouls(cost);
            SoundManager.playOk();
            $gameSwitches.setValue(SWITCH_DROP_CONTROL, false);
            $gameSwitches.setValue(SWITCH_DROP_START, true);
        }
    };

    const updateSoulCounter = scene => {
        updateCardReroll(scene);
        // Only on the standby screen itself, its Title Collection, deck and item screens have that corner in use
        const shown =
            bound() && $gameSwitches.value(SWITCH_STANDBY_CONTROL) && $gameVariables.value(VARIABLE_SCREEN) === 0;
        const waiting = soulMilestones().some(milestone => soulsFor(milestone) > soulTotal());
        updateLabel(scene._archipelagoSoulsTitle, shown, waiting ? "Next AP unlock" : "Souls", "#b0e0a0");
        updateLabel(scene._archipelagoSouls, shown, soulText());
    };

    // [text, color] for the title screen
    const connectionStatus = () => {
        if (!SESSION) {
            return ["Archipelago: off (normal game, normal save)", "#b0b0b0"];
        }
        if (OFFLINE) {
            return ["Archipelago: offline (nothing shuffled, its own save)", "#80ff90"];
        }
        if (!AP.socket || AP.socket.readyState !== WebSocket.OPEN) {
            return ["Archipelago: waiting for the client...", "#ffd060"];
        }
        if (AP.wrongSlot) {
            return ["Archipelago: the client is on a different slot, launch again from it", "#ff7070"];
        }
        if (!AP.slot) {
            return ["Archipelago: client found, not connected to a server", "#ffd060"];
        }
        return ["Archipelago: connected as " + (AP.slot.name || "slot " + AP.slot.slot), "#80ff90"];
    };

    const updateConnectionStatus = scene => {
        const status = connectionStatus();
        updateLabel(scene._archipelagoStatus, $gameMap.mapId() === MAP_TITLE, status[0], status[1]);
    };

    // Received items, shown one at a time at the top of the screen
    const notify = (text, rainbow) => {
        AP.notices.push({ text: text, rainbow: !!rainbow });
    };

    // Every letter in its own hue, `shift` moves the colors along
    const drawRainbow = (bitmap, text, shift) => {
        bitmap.clear();
        let x = Math.max(0, (bitmap.width - bitmap.measureTextWidth(text)) / 2);
        Array.from(text).forEach((letter, index) => {
            const width = bitmap.measureTextWidth(letter);
            bitmap.textColor = "hsl(" + ((index * RAINBOW_HUE_STEP + shift) % 360) + ", 100%, 70%)";
            bitmap.drawText(letter, x, 0, width + 8, bitmap.height, "left");
            x += width;
        });
    };

    const updateNotices = scene => {
        if (AP.noticeFrames > 0) {
            AP.noticeFrames--;
        } else if (AP.notices.length > 0) {
            if (AP.notices.length > NOTICE_BACKLOG) {
                // A backlog (first connection, items sent while away) is summed up instead of played out
                AP.notice = { text: "Received " + AP.notices.length + " items", rainbow: false };
                AP.notices.length = 0;
            } else {
                AP.notice = AP.notices.shift();
            }
            AP.noticeFrames = NOTICE_FRAMES;
            AP.noticeDrawn = false;
            AudioManager.playSe(NOTICE_SE);
        }
        const sprite = scene._archipelagoNotice;
        if (!sprite) {
            return;
        }
        if (!AP.noticeDrawn) {
            AP.noticeDrawn = true;
            sprite._archipelagoText = "";
        }
        if (AP.noticeFrames > 0 && AP.notice.rainbow) {
            sprite.visible = true;
            if (sprite._archipelagoText !== AP.notice.text || Graphics.frameCount % RAINBOW_FRAMES === 0) {
                sprite._archipelagoText = AP.notice.text;
                drawRainbow(sprite.bitmap, AP.notice.text, Graphics.frameCount * RAINBOW_SPEED);
            }
        } else {
            updateLabel(sprite, AP.noticeFrames > 0, AP.notice.text, "#ffffff");
        }
        sprite.opacity = Math.min(255, (AP.noticeFrames * 255) / NOTICE_FADE_FRAMES);
    };

    //-------------------------------------------------------------------------
    // Items

    const grantRelic = weaponId => {
        const weapon = $dataWeapons[weaponId];
        if (weapon && !$gameParty.hasItem(weapon)) {
            AP.granting = true;
            $gameParty.gainItem(weapon, 1);
            AP.granting = false;
        }
    };

    const remember = (list, value) => {
        if (!list.includes(value)) {
            list.push(value);
        }
    };

    // Souls are for what the run achieves. What the multiworld hands over is worth a lot in the game's score (a
    // relic 51 to 777, the card Shadow Cat Assam 222), so the score it adds is taken off again.
    const withoutSouls = give => {
        const s = state();
        const before = s.runBase != null ? freshScore() : null;
        give();
        const after = before !== null ? freshScore() : null;
        if (after !== null) {
            s.runBase += after - before;
        }
    };

    // The game stops drawing LP, RP, gold and the stats while the floor is chosen (common event 86 turns the switch
    // of common event 2 off), so a change made then is drawn here. That event never waits: one update runs all of
    // it. Only where its line is on the screen already, so it does not turn up on a screen that hides it.
    const redrawGui = () => {
        const picture = $gameScreen.picture(PICTURE_GUI);
        if (!$gameSwitches.value(SWITCH_GUI) && picture && picture.mzkp_text && !$gameParty.inBattle()) {
            const gui = new Game_Interpreter();
            gui.setup($dataCommonEvents[COMMON_EVENT_GUI].list);
            gui.update();
        }
    };

    const applyItem = item => {
        const s = state();
        if (item.id >= CARD_OFFSET) {
            s.cards = (s.cards || []).concat([item.id - CARD_OFFSET]);
        } else if (item.id >= SET_OFFSET) {
            remember(s.sets, item.id - SET_OFFSET);
        } else if (item.id >= TITLE_OFFSET) {
            remember(s.titles, item.id - TITLE_OFFSET);
        } else if (item.id >= BOSS_OFFSET) {
            remember(s.bosses, item.id - BOSS_OFFSET);
        } else if (item.id >= EVENT_OFFSET) {
            // One unlock can open a pair of events
            const group = eventGroup(item.id - EVENT_OFFSET);
            (group ? group.events : [item.id - EVENT_OFFSET]).forEach(eventId => remember(s.events, eventId));
        } else if (item.id >= RELIC_OFFSET) {
            remember(s.relics, item.id - RELIC_OFFSET);
            grantRelic(item.id - RELIC_OFFSET);
        } else if (item.id === ITEM_FINISHER) {
            s.finisher = true;
        } else if (item.id === ITEM_EXPLORATION) {
            s.exploration = (s.exploration || 0) + 1;
        } else if (GOLD_ITEMS[item.id]) {
            $gameParty.gainGold(GOLD_ITEMS[item.id]);
        } else if (SOUL_FILLER[item.id]) {
            s.souls = (s.souls || 0) + SOUL_FILLER[item.id];
        } else if (item.id === ITEM_RESTORE_LP) {
            $gameActors.actor(1).gainHp(RESTORE_AMOUNT);
        } else if (item.id === ITEM_RESTORE_RP) {
            $gameActors.actor(1).gainMp(RESTORE_AMOUNT);
        } else if (STAT_ITEMS[item.id]) {
            $gameActors.actor(1).addParam(STAT_ITEMS[item.id][0], STAT_ITEMS[item.id][1]);
        } else if (item.id === ITEM_CLIMAX_TRAP || TRAP_STATES[item.id]) {
            s.traps = (s.traps || []).concat([item.id]);
        }
        if (item.id < RELIC_OFFSET) {
            redrawGui();
        }
        console.log("[AP] Received " + item.name + " from " + item.sender);
        const own = AP.slot && item.sender === AP.slot.name;
        notify("Received " + item.name + (own ? "" : " from " + item.sender), item.flags & ITEM_FLAG_PROGRESSION);
    };

    const updateItems = () => {
        if (!SESSION) {
            return;
        }
        syncKingUnlockSwitches();
        if (shuffled() && !$gameSwitches.value(SWITCH_CLEARED)) {
            // With the game cleared, common event 64 continues the climb after the last boss
            _Game_Switches_setValue.call($gameSwitches, SWITCH_CLEARED, true);
        }
        // Also during a fight: a trap that arrives in one goes off in it
        if (!active()) {
            return;
        }
        const s = state();
        if (AP.pendingDeath && $gameVariables.value(VARIABLE_FLOOR) >= 1 && !s.runOver) {
            // Like virgin mode with the state lost: the fight is lost, or the game over follows before the next floor
            notify("DeathLink: " + AP.pendingDeath + " died, this run is over");
            AP.pendingDeath = null;
            AP.deathReceived = true;
            s.runOver = true;
            $gameActors.actor(1).setHp(0);
        }
        if (s.regrant && $gameVariables.value(VARIABLE_FLOOR) >= 1) {
            s.regrant = false;
            s.relics.forEach(grantRelic);
            // A title that was obtained once in this multiworld is obtained in every later run, without meeting
            // its condition again. Releasing it in the Title Collection is still up to the player.
            for (let title = 1; title <= TITLE_COUNT; title++) {
                const obtained = s.checked.includes(SWITCH_OFFSET + TITLE_SWITCH_BASE + title);
                if (obtained && !$gameParty.hasItem($dataArmors[title], true)) {
                    $gameParty.gainItem($dataArmors[title], 1, true);
                }
            }
        }
        // Every run adds its souls from 0: what the origin, the starting set and the relics from the multiworld are worth
        // in the score is taken off. The DLC's origin alone would start a run at 115.
        if (s.runBase == null && $gameVariables.value(VARIABLE_FLOOR) >= 1) {
            s.runBase = freshScore();
        }
        while (s.itemIndex < AP.items.length) {
            const item = AP.items[s.itemIndex];
            // A stat boost only lasts for the run it arrives in, so it waits for one
            const forRun = STAT_ITEMS[item.id] || item.id === ITEM_RESTORE_LP || item.id === ITEM_RESTORE_RP;
            if (forRun && $gameVariables.value(VARIABLE_FLOOR) < 1) {
                break;
            }
            withoutSouls(() => applyItem(item));
            s.itemIndex++;
        }
    };

    // A trap goes off in a fight: the one that is on, or the next
    // A trap does what the enemy skill behind its state does, which is the common event of that skill: its sound,
    // the look of the protagonist, and for confusion the cards put into the discard pile. Not the reflection some
    // of them start with, and not the enemy action they end in, which belongs to the enemy's turn. Nothing of what
    // is left waits, so one update runs all of it.
    const castTrap = (trap, actor) => {
        const event = $dataCommonEvents[TRAP_EVENTS[trap]];
        let spell = event ? event.list : [];
        const reflects = item => item.code === 111 && item.indent === 0 && item.parameters[3] === STATE_REFLECTION;
        if (spell.length > 0 && reflects(spell[0])) {
            const start = spell.findIndex(item => item.code === 411 && item.indent === 0);
            const end = spell.findIndex((item, i) => i > start && item.code === 412 && item.indent === 0);
            const unreflected = start < 0 || end < 0 ? [] : spell.slice(start + 1, end);
            spell = unreflected.map(item => command(item.code, item.indent - 1, item.parameters));
        }
        spell = spell.filter(item => item.code !== 339);
        if (spell.length > 0) {
            const interpreter = new Game_Interpreter();
            interpreter.setup(spell.concat([command(0, 0, [])]));
            interpreter.update();
        }
        actor.addState(TRAP_STATES[trap]);
        const animation = $dataAnimations[TRAP_ANIMATIONS[trap]];
        if (animation && animation.name === TRAP_STATE_NAMES[trap] && $gameParty.inBattle()) {
            $gameTemp.requestAnimation([actor], animation.id);
        }
    };

    const applyTraps = () => {
        const s = bound() ? state() : null;
        const actor = $gameActors ? $gameActors.actor(1) : null;
        // The switch comes on at the end of the fight's own setup. A trap waits a little longer and for any message
        // to be gone, so it lands in the fight proper and not in the middle of it starting.
        AP.battleFrames = $gameSwitches && $gameSwitches.value(SWITCH_IN_BATTLE) ? (AP.battleFrames || 0) + 1 : 0;
        if (!s || !s.traps || s.traps.length === 0 || !actor || actor.isDead()) {
            return;
        }
        if (AP.battleFrames < TRAP_DELAY_FRAMES || $gameMessage.isBusy()) {
            return;
        }
        AP.battleFrames = 0;
        const trap = s.traps.shift();
        if (trap === ITEM_CLIMAX_TRAP) {
            actor.setMp(0);
        } else {
            castTrap(trap, actor);
        }
        if (trap === ITEM_ACID_TRAP && $gameVariables.value(VARIABLE_TORN_CLOTHES) < 1) {
            $gameVariables.setValue(VARIABLE_TORN_CLOTHES, 1);
        }
    };

    const _Scene_Battle_update = Scene_Battle.prototype.update;
    Scene_Battle.prototype.update = function() {
        _Scene_Battle_update.apply(this, arguments);
        updateItems();
        applyTraps();
        updateNotices(this);
    };

    // The notices of received items are shown during a fight too
    const _Scene_Battle_createDisplayObjects = Scene_Battle.prototype.createDisplayObjects;
    Scene_Battle.prototype.createDisplayObjects = function() {
        _Scene_Battle_createDisplayObjects.apply(this, arguments);
        this._archipelagoNotice = createLabel(this, (Graphics.width - NOTICE_WIDTH) / 2, 8, NOTICE_WIDTH, "center");
    };

    //-------------------------------------------------------------------------
    // Received cards

    // { id, index } of the received cards that were not taken into the deck this run
    const waitingCards = () => {
        const s = state();
        const claimed = s.claimed || [];
        return (s.cards || []).map((id, index) => ({ id: id, index: index })).filter(card => !claimed.includes(card.index));
    };

    const cardCost = card => CARD_COSTS[card.id] || 0;

    // The received card sets that were not taken this run. A set is three cards and free.
    const waitingSets = () => {
        const s = state();
        const taken = s.claimedSets || [];
        return s.sets.filter(setId => STARTING_SETS[setId] && !taken.includes(setId)).sort((a, b) => a - b);
    };

    const setCards = setId => STARTING_SETS[setId][1].map(itemId => $dataItems[itemId].name).join(", ");

    // Runs in the common event the button of the deck screen starts: the list of the received cards
    AP.offerCards = interpreter => {
        const sets = bound() ? waitingSets().map(setId => ({ set: setId })) : [];
        const cards = sets.concat(bound() ? waitingCards() : []);
        AP.cardPreview = null;
        AP.cardAgain = false;
        if (cards.length === 0) {
            return;
        }
        if ($gameVariables.value(VARIABLE_DECK_COUNT) >= DECK_LIMIT) {
            $gameMessage.add("No more cards can be acquired.");
            interpreter.setWaitMode("message");
            return;
        }
        const label = card =>
            card.set
                ? STARTING_SETS[card.set][0] + " (3 cards, free)"
                : $dataItems[card.id].name + (cardCost(card) ? " (" + cardCost(card) + " G)" : "");
        $gameMessage.add("Which card from the multiworld do you look at? Each can be taken once a run.");
        $gameMessage.add("You have " + $gameParty.gold() + " G.");
        $gameMessage.setChoices(cards.map(label).concat(["Not Now"]), 0, cards.length);
        $gameMessage.setChoiceBackground(0);
        $gameMessage.setChoicePositionType(2);
        limitChoiceRows();
        $gameMessage.setChoiceCallback(index => {
            AP.cardPreview = index < cards.length ? cards[index] : null;
        });
        interpreter.setWaitMode("message");
    };

    // A card set has no picture of its own: its cards are named and the same question follows
    const previewSet = (interpreter, setId) => {
        const fits = $gameVariables.value(VARIABLE_DECK_COUNT) + STARTING_SETS[setId][1].length <= DECK_LIMIT;
        $gameMessage.add(STARTING_SETS[setId][0] + ": " + setCards(setId) + ".");
        if (!fits) {
            $gameMessage.add("There is no room for all of them in the deck.");
        }
        $gameMessage.setChoices(["Add to Deck", "Back"], 0, 1);
        if ($gameMessage.setChoiceEnables) {
            $gameMessage.setChoiceEnables([fits, true]);
        }
        $gameMessage.setChoiceBackground(0);
        $gameMessage.setChoicePositionType(2);
        $gameMessage.setChoiceCallback(index => {
            if (index !== 0 || !fits) {
                AP.cardAgain = true;
                return;
            }
            const s = state();
            s.claimedSets = (s.claimedSets || []).concat([setId]);
            AP.granting = true;
            withoutSouls(() => STARTING_SETS[setId][1].forEach(itemId => $gameParty.gainItem($dataItems[itemId], 1)));
            AP.granting = false;
        });
        interpreter.setWaitMode("message");
    };

    // The next step: the picked card and its description, and the question whether it goes into the deck
    AP.previewCard = interpreter => {
        const card = AP.cardPreview;
        AP.cardPreview = null;
        if (!card) {
            return;
        }
        if (card.set) {
            previewSet(interpreter, card.set);
            return;
        }
        const cost = cardCost(card);
        const affordable = $gameParty.gold() >= cost;
        const y = CARD_PREVIEW_Y;
        $gameScreen.showPicture(PICTURE_CARD_PREVIEW, String(card.id), 1, CARD_PREVIEW_X, y, 100, 100, 255, 0);
        $gameScreen.showPicture(PICTURE_CARD_DESCRIPTION, card.id + "s", 1, CARD_DESCRIPTION_X, y, 100, 100, 255, 0);
        $gameMessage.add($dataItems[card.id].name + (cost ? ": " + cost + " G, you have " + $gameParty.gold() + " G." : ""));
        $gameMessage.setChoices(["Add to Deck", "Back"], 0, 1);
        if ($gameMessage.setChoiceEnables) {
            $gameMessage.setChoiceEnables([affordable, true]);
        }
        $gameMessage.setChoiceBackground(0);
        $gameMessage.setChoicePositionType(2);
        $gameMessage.setChoiceCallback(index => {
            $gameScreen.erasePicture(PICTURE_CARD_PREVIEW);
            if (index !== 0 || !affordable) {
                // Back to the list
                AP.cardAgain = true;
                return;
            }
            const s = state();
            s.claimed = (s.claimed || []).concat([card.index]);
            AP.granting = true;
            // Neither the gold paid nor the card counts for the souls
            withoutSouls(() => {
                $gameParty.loseGold(cost);
                $gameParty.gainItem($dataItems[card.id], 1);
            });
            AP.granting = false;
        });
        interpreter.setWaitMode("message");
    };

    // The deck screen stops taking input while one of its own questions is up, this does the same
    const createCardEvent = () => {
        AP.cardEvent = $dataCommonEvents.length;
        $dataCommonEvents.push({
            id: AP.cardEvent,
            name: "Archipelago Cards",
            trigger: 0,
            switchId: 1,
            list: [
                command(121, 0, [SWITCH_DECK_CONTROL, SWITCH_DECK_CONTROL, 1]),
                command(122, 0, [VARIABLE_SCREEN, VARIABLE_SCREEN, 0, 0, SCREEN_DECK_BUSY]),
                command(118, 0, [LABEL_CARDS]),
                command(355, 0, ["LostChapterAP.offerCards(this);"]),
                command(355, 0, ["LostChapterAP.previewCard(this);"]),
                command(111, 0, [12, "LostChapterAP.cardAgain"]),
                command(119, 1, [LABEL_CARDS]),
                command(0, 1, []),
                command(412, 0, []),
                command(122, 0, [VARIABLE_SCREEN, VARIABLE_SCREEN, 0, 0, SCREEN_DECK]),
                command(117, 0, [COMMON_EVENT_DECK_DISPLAY]),
                command(121, 0, [SWITCH_DECK_CONTROL, SWITCH_DECK_CONTROL, 0]),
                command(0, 0, []),
            ],
        });
    };

    const takeCards = () => {
        if (!$gameMessage.isBusy() && $gameVariables.value(VARIABLE_SCREEN) === SCREEN_DECK && waitingCards().length + waitingSets().length > 0) {
            SoundManager.playOk();
            $gameTemp.reserveCommonEvent(AP.cardEvent);
        }
    };

    // A line above the Forget-Me-Not and Pieris counts of the deck screen, in their style
    const createCardButton = scene => {
        const button = new Sprite_Clickable();
        button.bitmap = new Bitmap(CARD_BUTTON_WIDTH, CARD_BUTTON_HEIGHT);
        button.x = CARD_BUTTON_X;
        button.y = CARD_BUTTON_Y;
        button.visible = false;
        button._archipelagoCount = -1;
        const icon = new Image();
        icon.onload = () => {
            button._archipelagoIcon = icon;
            button._archipelagoCount = -1;
        };
        icon.src = AP_ICON;
        button.onClick = takeCards;
        scene.addChild(button);
        return button;
    };

    // Shown on the deck screen: the icon, how many received cards wait to be taken and the key that takes one
    const updateCardButton = scene => {
        const button = scene._archipelagoCards;
        if (!button) {
            return;
        }
        button.visible = bound() && $gameVariables.value(VARIABLE_SCREEN) === SCREEN_DECK;
        if (!button.visible) {
            return;
        }
        const count = waitingCards().length + waitingSets().length;
        if (Input.isTriggered(CARD_BUTTON_KEY)) {
            takeCards();
        }
        if (button._archipelagoIcon && button._archipelagoCount !== count) {
            const bitmap = button.bitmap;
            const size = CARD_BUTTON_HEIGHT - 6;
            button._archipelagoCount = count;
            bitmap.clear();
            bitmap.context.drawImage(button._archipelagoIcon, 0, 3, size, size);
            bitmap.fontFace = $gameSystem.mainFontFace();
            bitmap.fontSize = 24;
            bitmap.textColor = "#b0e0a0";
            bitmap.drawText("Archipelago", size + 12, 0, 150, CARD_BUTTON_HEIGHT, "left");
            bitmap.textColor = "#ffffff";
            bitmap.drawText(":  " + count + " Pcs.  [Q]", size + 166, 0, 220, CARD_BUTTON_HEIGHT, "left");
        }
    };

    const _Scene_Map_update = Scene_Map.prototype.update;
    Scene_Map.prototype.update = function() {
        _Scene_Map_update.apply(this, arguments);
        updateItems();
        if (bound() && Graphics.frameCount % SOUL_UPDATE_FRAMES === 0) {
            updateSouls();
            sendStatus();
        }
        updateSoulCounter(this);
        updateConnectionStatus(this);
        updateNotices(this);
        updateCardButton(this);
        applyTraps();
    };

    // A save was loaded or a new game started
    const _Scene_Map_start = Scene_Map.prototype.start;
    Scene_Map.prototype.start = function() {
        _Scene_Map_start.apply(this, arguments);
        bindSave();
    };

    //-------------------------------------------------------------------------
    // Floor flow (called from the patched common events)

    const kingsDefeated = () => KING_SWITCHES.every(kingSwitch => $gameSwitches.value(kingSwitch));

    // From the floor of the last boss on the doors are a free choice: any king again, the last boss, or go on
    const freeDoors = () => shuffled() && ($gameVariables.value(VARIABLE_FLOOR) >= FREE_DOORS_FLOOR || kingsDefeated());

    // The "Final Boss" door choice only opens from this floor on (final_boss_floor option)
    const finalBossFloor = () => option("final_boss_floor") || FREE_DOORS_FLOOR;

    const doorOpen = kingSwitch => {
        const defeated = $gameSwitches.value(kingSwitch);
        if (!shuffled()) {
            return !defeated;
        }
        return state().bosses.includes(kingSwitch) && (!defeated || freeDoors());
    };

    const mirrorSwitch = (switchId, value) => {
        if ($gameSwitches.value(switchId) !== value) {
            _Game_Switches_setValue.call($gameSwitches, switchId, value);
        }
    };

    const syncKingUnlockSwitches = () => {
        for (const kingSwitch of KING_SWITCHES) {
            mirrorSwitch(kingSwitch + KING_UNLOCK_SWITCH_SHIFT, doorOpen(kingSwitch));
        }
        mirrorSwitch(SWITCH_TURN_BACK, shuffled() && !freeDoors());
        mirrorSwitch(SWITCH_FREE_DOORS, freeDoors());
        mirrorSwitch(SWITCH_FINAL_BOSS, $gameVariables.value(VARIABLE_FLOOR) >= finalBossFloor());
        const sent = weaponId => state().checked.includes(RELIC_OFFSET + weaponId);
        mirrorSwitch(SWITCH_MARKET_THANKS, AP.marketMenu() && MARKET_RELICS.every(sent));
        const hasKey = weaponId => !shuffled() || $gameParty.hasItem($dataWeapons[weaponId], false);
        mirrorSwitch(SWITCH_WHITE_DOOR, hasKey(WEAPON_WHITE_KEY));
        mirrorSwitch(SWITCH_BLACK_DOOR, hasKey(WEAPON_BLACK_KEY));
        mirrorSwitch(SWITCH_LAST_DOOR, bound() && DLC_BOSS_SWITCHES.every(switchId => $gameSwitches.value(switchId)));
    };

    // Switch of the boss scene `floor` leads to, 0 when it is an ordinary floor
    const bossFloorSwitch = floor => {
        if (floor % BOSS_FLOOR_INTERVAL !== 0) {
            return 0;
        }
        if (!shuffled() && kingsDefeated()) {
            return SWITCH_LAST_BOSS;
        }
        // In a multiworld every boss floor leads to the doors. The last boss is one of the choices there, and
        // without an open door the way on is closed until a king falls.
        return SWITCH_BEFORE_BOSS;
    };

    // The "Turn Back" door choice: the floors since the last boss floor are climbed again
    AP.turnBack = () => {
        state().holdFloor = true;
        $gameVariables.setValue(VARIABLE_FLOOR, $gameVariables.value(VARIABLE_FLOOR) - BOSS_FLOOR_INTERVAL + 1);
    };

    // Replaces the boss floor branch of common event 86. True when this floor is a boss floor.
    AP.bossFloor = () => {
        syncKingUnlockSwitches();
        const bossSwitch = bossFloorSwitch($gameVariables.value(VARIABLE_FLOOR));
        if (bossSwitch) {
            $gameSwitches.setValue(bossSwitch, true);
        }
        return bossSwitch !== 0;
    };

    // Common event 86 rolls an event and rolls again when the block it has for that event says so: the Seamstress
    // without torn clothes, the Locksmith without the relics for a key, an event whose character has died, ...
    // The blocks are read from the event itself, so they are the ones of the installed version of the game.
    const rerollBlocks = {};
    const collectRerollBlocks = list => {
        list.forEach((item, i) => {
            const p = item.parameters;
            if (item.code === 111 && p[0] === 1 && p[1] === VARIABLE_FLOOR_EVENT && p[2] === 0 && p[4] === 0) {
                const end = branchEnd(list, i);
                if (end > i) {
                    rerollBlocks[p[3]] = list.slice(i + 1, end);
                }
            }
        });
    };

    // A conditional branch of such a block. null for a kind of condition this does not know.
    const blockCondition = (p, scratch, eventId) => {
        const actor = p[0] === 4 ? $gameActors.actor(p[1]) : null;
        switch (p[0]) {
            case 0:
                return (p[1] in scratch ? scratch[p[1]] : $gameSwitches.value(p[1])) === (p[2] === 0);
            case 1: {
                const a = $gameVariables.value(p[1]);
                const b = p[2] === 0 ? p[3] : $gameVariables.value(p[3]);
                return [a === b, a >= b, a <= b, a > b, a < b, a !== b][p[4]];
            }
            case 4:
                if (p[2] === 0) {
                    return !!actor && $gameParty.members().includes(actor);
                }
                return p[2] === 6 ? !!actor && actor.isStateAffected(p[3]) : null;
            case 9: {
                // An event is gone once the relic it hands out is held (Checkpoint). Where that relic is a check
                // it is gone once the check was sent: the relic itself can come from anywhere.
                const handsOut = eventData(eventId).list.some(
                    item => item.code === 127 && item.parameters[0] === p[1] && item.parameters[1] === 0
                );
                if (handsOut && bound() && relicChecks().includes(p[1])) {
                    return state().checked.includes(RELIC_OFFSET + p[1]);
                }
                return $gameParty.hasItem($dataWeapons[p[1]], p[2]);
            }
            default:
                return null;
        }
    };

    // True when the block ends in the jump that rolls again. Switches it sets are its own scratch values.
    const rerolls = (block, eventId) => {
        const scratch = {};
        const taken = {};
        let skipAbove = Infinity;
        for (const item of block) {
            if (item.indent > skipAbove) {
                continue;
            }
            skipAbove = Infinity;
            const p = item.parameters;
            if (item.code === 111) {
                const result = blockCondition(p, scratch, eventId);
                if (result === null) {
                    return false;
                }
                taken[item.indent] = result;
                if (!result) {
                    skipAbove = item.indent;
                }
            } else if (item.code === 411) {
                if (taken[item.indent]) {
                    skipAbove = item.indent;
                }
            } else if (item.code === 121) {
                for (let switchId = p[0]; switchId <= p[1]; switchId++) {
                    scratch[switchId] = p[2] === 0;
                }
            } else if (item.code === 119) {
                return true;
            }
        }
        return false;
    };

    // The game's own conditions for offering an event on `floor`
    const eventAvailable = (eventId, floor) => {
        if (eventId > 56 && floor <= 40) {
            return false;
        }
        return !rerollBlocks[eventId] || !rerolls(rerollBlocks[eventId], eventId);
    };

    // { name, events } of the pair `eventId` belongs to (slot data "event_groups"), null for an event on its own
    const eventGroup = eventId => {
        const groups = option("event_groups") || {};
        const name = Object.keys(groups).find(groupName => groups[groupName].includes(eventId));
        return name ? { name: name, events: groups[name] } : null;
    };

    // What the floor choice calls an event: a pair goes by the name of its unlock, which hides which one it is
    const eventName = eventId => {
        const group = eventGroup(eventId);
        return group ? group.name : eventData(eventId).name;
    };

    // How many checks an event has left, null when the client did not say which ones it holds. A pair is counted
    // together, like in the tracker.
    const checksLeft = eventId => {
        const held = AP.slot && AP.slot.event_checks;
        if (!held) {
            return null;
        }
        const group = eventGroup(eventId);
        return (group ? group.events : [eventId])
            .reduce((all, id) => all.concat(held[id] || []), [])
            .filter(location => !isSent(location)).length;
    };

    // The name of an event in the floor choice, with its open checks behind it
    const offerName = eventId => {
        const left = checksLeft(eventId);
        // An event that is still locked cannot be picked, how much it holds says nothing there
        if (left === null || !state().events.includes(eventId)) {
            return eventName(eventId);
        }
        // An asterisk: something is left to do here that is no check, but opens one in another event
        const group = eventGroup(eventId);
        const quest = (group ? group.events : [eventId]).some(member => questEvents().includes(member));
        return eventName(eventId) + (quest ? "*" : "") + (left ? " (" + left + ")" : " \\c[8](0)\\c[0]");
    };

    // Whether the branch of `choice` of the choices command at `start` hands out a check that is still open
    const branchChecks = (list, start, choice) => {
        const indent = list[start].indent;
        const found = [];
        let inBranch = false;
        for (let i = start + 1; i < list.length; i++) {
            const item = list[i];
            const p = item.parameters;
            if (item.indent === indent) {
                if (item.code !== 402 && item.code !== 403) {
                    break;
                }
                inBranch = item.code === 402 && p[0] === choice;
            } else if (inBranch && item.code === 127 && p[1] === 0 && relicChecks().includes(p[0])) {
                found.push(RELIC_OFFSET + p[0]);
            } else if (inBranch && item.code === 126 && p[1] === 0 && cardChecks().includes(p[0])) {
                found.push(CARD_OFFSET + p[0]);
            }
        }
        return found.filter(location => !isSent(location));
    };

    // The floor events with something left to do that opens a check in another event: the message of the Old
    // Woman, which the guard of the Checkpoint hands the Memento Chisel over for. A check that one of its choices
    // already leads to is not waiting on anything.
    let questCache = null;
    const questEvents = () => {
        if (questCache && questCache.frame === Graphics.frameCount) {
            return questCache.events;
        }
        if (!switchSetters) {
            findSwitchSetters();
        }
        const waiting = {};
        const ready = [];
        for (const eventId of eventIds()) {
            const list = eventData(eventId).list;
            list.forEach((item, start) => {
                (item.code === 102 ? item.parameters[0] : []).forEach((text, choice) => {
                    const shown = CHOICE_SHOWN.exec(String(text));
                    const match = shown && /^\s*s\[(\d+)\]\s*$/.exec(shown[1]);
                    const setters = match ? switchSetters[Number(match[1])] || [] : [];
                    if (setters.length === 0 || setters.length > STORY_SWITCH_EVENTS || setters.includes(eventId)) {
                        return;
                    }
                    for (const location of branchChecks(list, start, choice)) {
                        if ($gameSwitches.value(Number(match[1]))) {
                            ready.push(location);
                        } else {
                            waiting[location] = (waiting[location] || []).concat(setters);
                        }
                    }
                });
            });
        }
        const events = [];
        for (const location of Object.keys(waiting).map(Number)) {
            if (!ready.includes(location)) {
                waiting[location].forEach(eventId => remember(events, eventId));
            }
        }
        questCache = { frame: Graphics.frameCount, events: events };
        return events;
    };

    const startFloorEvent = switchId => {
        // The roll of the floor is used up
        AP.offer = null;
        if (switchId !== SWITCH_FIGHT) {
            $gameVariables.setValue(VARIABLE_FLOOR_EVENT, switchId);
        }
        $gameSwitches.setValue(switchId, true);
    };

    // Asks what `floor` holds and hands the switch id to `callback`. False when there is nothing to choose from.
    // The same on every floor
    const shopPrice = name => SHOP_PRICES[name];

    const spendSouls = cost => {
        state().spent = (state().spent || 0) + cost;
    };

    // The choices of a menu of the standby screen: [text, enabled, what it does]. Every one of them asks the
    // standby question again unless it settles the floor.
    const askStandby = (interpreter, entries) => {
        $gameMessage.setChoices(entries.map(entry => entry[0]), 0, entries.length - 1);
        limitChoiceRows(STANDBY_MAX_ROWS);
        if ($gameMessage.setChoiceEnables) {
            $gameMessage.setChoiceEnables(entries.map(entry => entry[1]));
        }
        $gameMessage.setChoiceBackground(0);
        $gameMessage.setChoicePositionType(2);
        $gameMessage.setChoiceCallback(index => {
            AP.standbyAgain = true;
            if (entries[index][1]) {
                entries[index][2]();
            }
        });
        interpreter.setWaitMode("message");
    };

    const offerShop = (interpreter, floor) => {
        const actor = $gameActors.actor(1);
        const entry = (text, name, buy) => {
            const cost = shopPrice(name, floor);
            return [text + " (" + cost + ")", soulTotal() >= cost, () => {
                spendSouls(cost);
                buy();
            }];
        };
        const relic = weaponId => () => {
            AP.granting = true;
            withoutSouls(() => $gameParty.gainItem($dataWeapons[weaponId], 1));
            AP.granting = false;
        };
        // The flowers are sold a few times a run only
        const limited = (text, name, weaponId) => {
            const s = state();
            const bought = (s.shopBought || {})[name] || 0;
            const offer = entry(text + ", " + (SHOP_LIMITS[name] - bought) + " left", name, () => {
                s.shopBought = Object.assign({}, s.shopBought, { [name]: bought + 1 });
                relic(weaponId)();
            });
            offer[1] = offer[1] && bought < SHOP_LIMITS[name];
            return offer;
        };
        const heal = gain => {
            withoutSouls(gain);
            redrawGui();
        };
        const entries = [
            entry("Reroll Floor Events", "reroll", () => {
                AP.offer = null;
                AP.standbyMenu = null;
            }),
            [
                "Choose the Floor Event (" + shopPrice("pick", floor) + ")",
                soulTotal() >= shopPrice("pick", floor) && floorsToFight(floor) !== 0,
                () => {
                    AP.standbyMenu = "pick";
                },
            ],
            limited("Forget-Me-Not", "forgetMeNot", WEAPON_FORGET_ME_NOT),
        ];
        const pieris = $dataWeapons[WEAPON_PIERIS];
        if (option("include_dlc") && pieris && pieris.name === "Pieris") {
            entries.push(limited("Pieris", "pieris", WEAPON_PIERIS));
        }
        // What the yellow potion of the Small Room does. Only offered to a regressed player.
        const regression = $dataStates[STATE_REGRESSION];
        if (regression && regression.name.startsWith("Regression") && actor.isStateAffected(STATE_REGRESSION)) {
            entries.push(entry("Yellow Vial: ends Regression", "vial", () => actor.removeState(STATE_REGRESSION)));
        }
        entries.push(
            entry("LP +" + SHOP_HEAL, "heal", () => heal(() => actor.gainHp(SHOP_HEAL))),
            entry("RP +" + SHOP_HEAL, "heal", () => heal(() => actor.gainMp(SHOP_HEAL))),
            [
                "Back (" + soulTotal() + " souls)",
                true,
                () => {
                    AP.standbyMenu = null;
                },
            ]
        );
        askStandby(interpreter, entries);
    };

    // The boons of the game's bonus shop, which a multiworld has no visit to: sold here for souls, at prices that
    // stay the same on every floor. A boon is carried out by the bonus shop's own event (common event 418), which
    // goes by the bonus id in the "selected" variable and never waits.
    const boonAvailable = boon => {
        const list = $dataCommonEvents[COMMON_EVENT_BONUS].list;
        const known = list.some(item => {
            const p = item.parameters;
            return item.code === 111 && item.indent === 0 && p[0] === 1 && p[1] === VARIABLE_SELECTED && p[3] === boon[0];
        });
        const regression = $dataStates[STATE_REGRESSION];
        // Only the versions of the game with the Regression State have the two boons about it
        return known && (!boon[3] || (regression && regression.name.startsWith("Regression")));
    };

    const giveBoon = boon => {
        const selected = $gameVariables.value(VARIABLE_SELECTED);
        $gameVariables.setValue(VARIABLE_SELECTED, boon[0]);
        const interpreter = new Game_Interpreter();
        interpreter.setup($dataCommonEvents[COMMON_EVENT_BONUS].list);
        // What a boon adds to the score is no soul earned
        withoutSouls(() => interpreter.update());
        $gameVariables.setValue(VARIABLE_SELECTED, selected);
        redrawGui();
    };

    const offerBoons = (interpreter, price) => {
        const entries = [];
        if (!price) {
            for (const tier of Object.keys(BOONS).map(Number)) {
                if (BOONS[tier].some(boonAvailable)) {
                    entries.push([BOON_TIERS[tier] + " (" + tier + " each)", true, () => {
                        AP.standbyMenu = "boons:" + tier;
                    }]);
                }
            }
            // The finisher_move option on "boon_shop": bought once, Kick Balls is had for the rest of the multiworld
            if (option("finisher_move") === FINISHER_BOON_SHOP) {
                const had = !!state().finisher;
                const text = "Kick Balls" + (had ? " (owned)" : " (" + FINISHER_PRICE + ")");
                entries.push([text, !had && soulTotal() >= FINISHER_PRICE, () => {
                    spendSouls(FINISHER_PRICE);
                    state().finisher = true;
                    notify("Kick Balls turns up after the enemy climaxes from now on");
                }]);
            }
        } else {
            for (const boon of BOONS[price].filter(boonAvailable)) {
                // A boon that is a switch of the game is had for the rest of the run
                const had = boon[2] && $gameSwitches.value(boon[2]);
                entries.push([boon[1] + (had ? " (active)" : " (" + price + ")"), !had && soulTotal() >= price, () => {
                    spendSouls(price);
                    giveBoon(boon);
                }]);
            }
        }
        entries.push(["Back (" + soulTotal() + " souls)", true, () => {
            AP.standbyMenu = price ? "boons" : null;
        }]);
        askStandby(interpreter, entries);
    };

    // Any unlocked event the floor could hold, for the price of the shop
    const offerPick = (interpreter, floor) => {
        const cost = shopPrice("pick", floor);
        const names = [];
        const entries = [];
        for (const eventId of eventIds()) {
            const name = offerName(eventId);
            if (!state().events.includes(eventId) || !eventAvailable(eventId, floor) || names.includes(name)) {
                continue;
            }
            // A pair goes by one name: which of the two it is stays a matter of luck
            const group = eventGroup(eventId);
            const members = (group ? group.events : [eventId]).filter(
                member => state().events.includes(member) && eventAvailable(member, floor)
            );
            names.push(name);
            entries.push([name, true, () => {
                spendSouls(cost);
                AP.standbyMenu = null;
                AP.standbyAgain = false;
                AP.standbyChoice = false;
                AP.chosenFloorEvent = members[Math.floor(Math.random() * members.length)];
            }]);
        }
        entries.push(["Back", true, () => {
            AP.standbyMenu = "shop";
        }]);
        askStandby(interpreter, entries);
    };

    // Battle rewards are only found in fights, and nothing else makes a player fight: while one is open, a floor
    // is a fight when none was won on the floors before it. 5 rewards for 20 floors are a fight every 4 floors.
    // The floors until the next one has to be a fight, 0 for this one, null when nothing forces any.
    const floorsToFight = floor => {
        const rewards = option("battle_rewards") || 0;
        if (!shuffled() || !rewards || !battleReward()) {
            return null;
        }
        const interval = Math.max(1, Math.floor(BOSS_FLOOR_INTERVAL / rewards));
        return Math.max(0, (state().lastFight || 0) + interval - floor);
    };

    const offerFloorEvents = (interpreter, floor, callback, shop) => {
        // Drawn from every event the floor could hold. The ones without their unlock are shown grayed out, so a
        // few unlocked events do not come up floor after floor.
        const unlocked = eventId => state().events.includes(eventId);
        const canGray = !!$gameMessage.setChoiceEnables; // MPP_ChoiceEX
        const pool = [];
        for (const eventId of eventIds()) {
            if (eventAvailable(eventId, floor) && (canGray || unlocked(eventId))) {
                pool.push(eventId);
            }
        }
        // An unlocked event that was not visited yet is likelier to come up, so its check does not wait on luck
        const weight = eventId =>
            unlocked(eventId) && !state().checked.includes(SWITCH_OFFSET + eventId) ? UNVISITED_EVENT_WEIGHT : 1;
        const draw = () => {
            let roll = Math.random() * pool.reduce((sum, eventId) => sum + weight(eventId), 0);
            const index = pool.findIndex(eventId => (roll -= weight(eventId)) < 0);
            return pool.splice(index < 0 ? pool.length - 1 : index, 1)[0];
        };
        // The roll of a floor stands until the floor is over or the shop rolls it again
        const kept = AP.offer && AP.offer.floor === floor ? AP.offer.events : null;
        const offered = kept || [];
        const choices = FLOOR_EVENT_CHOICES + (state().exploration || 0);
        while (!kept && offered.length < choices && pool.length > 0) {
            const eventId = draw();
            const group = eventGroup(eventId);
            offered.push(eventId);
            // The two events of a pair go by one name, so only one of them is offered at a time
            for (let i = pool.length - 1; group && i >= 0; i--) {
                if (group.events.includes(pool[i])) {
                    pool.splice(i, 1);
                }
            }
        }
        // The rolled events are shown even when none of them is unlocked, so the player sees what the floor held
        if (offered.length === 0) {
            return false;
        }
        AP.offer = { floor: floor, events: offered };
        const switchIds = [SWITCH_FIGHT].concat(offered);
        const toFight = floorsToFight(floor);
        const forced = toFight === 0;
        let battle = "Battle";
        if (forced) {
            battle += " \\c[2](a battle reward is open, this floor is a fight)\\c[0]";
        } else if (toFight !== null) {
            battle += " \\c[8](forced in " + toFight + (toFight === 1 ? " floor)" : " floors)") + "\\c[0]";
        }
        const names = [battle].concat(offered.map(offerName));
        const menus = [];
        if (shop) {
            // Back is also what cancelling does. The roll of the floor stands, so a relic bought in the shop can be
            // used from the standby screen before the floor is chosen.
            // The shops stand out from the floor events by their color. Offline the game has its own bonus shop.
            menus.push("shop");
            names.push("\\c[" + COLOR_SOUL_SHOP + "]Soul Shop (" + soulTotal() + " souls)\\c[0]");
            if (!OFFLINE) {
                menus.push("boons");
                names.push("\\c[" + COLOR_BOON_SHOP + "]Boon Shop (" + soulTotal() + " souls)\\c[0]");
            }
            names.push("Back");
        }
        $gameMessage.setChoices(names, 0, shop ? names.length - 1 : -1);
        limitChoiceRows(STANDBY_MAX_ROWS);
        if (canGray) {
            const open = eventId => unlocked(eventId) && !forced;
            $gameMessage.setChoiceEnables([true].concat(offered.map(open), menus.map(() => true), [true]));
        }
        $gameMessage.setChoiceBackground(0);
        $gameMessage.setChoicePositionType(2);
        $gameMessage.setChoiceCallback(index => {
            if (index >= switchIds.length + menus.length) {
                AP.standbyChoice = false;
                AP.standbyBack = true;
                return;
            }
            if (index >= switchIds.length) {
                AP.standbyMenu = menus[index - switchIds.length];
                AP.standbyAgain = true;
                return;
            }
            callback(switchIds[index]);
        });
        interpreter.setWaitMode("message");
        return true;
    };

    // Runs at the start of common event 86, while the standby screen is still shown
    AP.prepareFloorEvent = interpreter => {
        trace("prepare");
        if (!AP.standbyAgain) {
            AP.standbyMenu = null;
        }
        AP.standbyAgain = false;
        AP.standbyBack = false;
        AP.chosenFloorEvent = 0;
        if (bound() && state().runOver) {
            $gameActors.actor(1).setHp(0);
            $gameVariables.setValue(VARIABLE_LP, 0);
        }
        // Without LP left the game over follows instead of a floor
        if (!bound() || AP.nextFloorEvent || $gameVariables.value(VARIABLE_LP) <= 0) {
            return;
        }
        const floor = $gameVariables.value(VARIABLE_FLOOR) + (state().holdFloor ? 0 : 1);
        if (bossFloorSwitch(floor)) {
            return;
        }
        if (AP.standbyMenu === "shop") {
            offerShop(interpreter, floor);
            return;
        }
        if (AP.standbyMenu === "pick") {
            offerPick(interpreter, floor);
            return;
        }
        if (String(AP.standbyMenu).startsWith("boons")) {
            offerBoons(interpreter, Number(String(AP.standbyMenu).split(":")[1]) || 0);
            return;
        }
        const offered = offerFloorEvents(
            interpreter,
            floor,
            switchId => {
                AP.standbyChoice = false;
                AP.chosenFloorEvent = switchId;
            },
            true
        );
        // Nothing to roll from is settled here too, so the floor is not rolled a second time after the screen went dark
        AP.standbyChoice = offered;
        if (!offered) {
            AP.chosenFloorEvent = SWITCH_FIGHT;
        }
    };

    // "Back" in the floor choice: common event 86 has only turned the standby screen's switches off by then, its
    // pictures are still there. With the switches back on and the event left, the screen takes input again.
    AP.backToStandby = interpreter => {
        trace("back");
        AP.standbyBack = false;
        for (const switchId of [SWITCH_GUI, SWITCH_STANDBY_IMAGE, SWITCH_STANDBY_CONTROL]) {
            $gameSwitches.setValue(switchId, true);
        }
        $gameSwitches.setValue(SWITCH_STANDBY_END, false);
        interpreter.command115();
    };

    // The choice of the standby screen sits below its lines instead of over them. Placed here, after the game and
    // MPP_ChoiceEX have placed the window: handing MPP_ChoiceEX a position of its own left the window out of sight.
    const _Window_ChoiceList_updatePlacement = Window_ChoiceList.prototype.updatePlacement;
    Window_ChoiceList.prototype.updatePlacement = function() {
        _Window_ChoiceList_updatePlacement.apply(this, arguments);
        if (AP.standbyChoice) {
            this.y = Math.max(0, Math.min(STANDBY_CHOICE_Y, Graphics.boxHeight - this.height));
        }
    };

    // Every event of the floor choice is in sight, without scrolling: MPP_ChoiceEX stops at six rows
    const _Window_ChoiceList_numVisibleRows = Window_ChoiceList.prototype.numVisibleRows;
    Window_ChoiceList.prototype.numVisibleRows = function() {
        if (AP.standbyChoice) {
            return $gameMessage.choices().length;
        }
        return _Window_ChoiceList_numVisibleRows.apply(this, arguments);
    };

    // Replaces the fight / random event roll of common event 86
    AP.chooseFloorEvent = interpreter => {
        const forced = AP.nextFloorEvent || AP.chosenFloorEvent;
        AP.standbyChoice = false;
        AP.nextFloorEvent = 0;
        AP.chosenFloorEvent = 0;
        if (forced) {
            startFloorEvent(forced);
            return;
        }
        if (!offerFloorEvents(interpreter, $gameVariables.value(VARIABLE_FLOOR), startFloorEvent)) {
            startFloorEvent(SWITCH_FIGHT);
        }
    };

    // Seeds from before the option existed have no value for it and shuffle the title effects
    const titleEffectMissing = title =>
        bound() &&
        option("shuffle_title_effects") !== 0 &&
        title >= 1 &&
        title <= TITLE_COUNT &&
        !state().titles.includes(title);

    // The Title Collection only puts the picture of an obtained title on the screen when it is opened, hidden until
    // the title is released. A title that was not there yet at that moment has no picture to fade in, so releasing
    // it shows nothing. The picture is put there the way the screen does it (common event 80).
    const showTitlePicture = title => {
        const pictureId = TITLE_PICTURE_BASE + title;
        const waiting = $gameParty.hasItem($dataArmors[title], false) && !$gameSwitches.value(TITLE_SWITCH_BASE + title);
        if (!waiting || $gameScreen.picture(pictureId) || $gameVariables.value(VARIABLE_SCREEN) !== SCREEN_TITLES) {
            return;
        }
        const list = $dataCommonEvents[COMMON_EVENT_TITLES].list;
        const start = list.findIndex(item => {
            const p = item.parameters;
            return item.code === 231 && p[0] === pictureId && p[8] === 0;
        });
        if (start < 0) {
            return;
        }
        let end = start;
        while (list[end + 1].code !== 0 && list[end + 1].indent === list[start].indent) {
            end++;
        }
        const interpreter = new Game_Interpreter();
        const show = list.slice(start, end + 1).map(item => command(item.code, 0, item.parameters));
        interpreter.setup(show.concat([command(0, 0, [])]));
        interpreter.update();
    };

    // Guards the "has armor n" branch of the title release events (common events 401-416)
    AP.titleLocked = title => {
        if (!titleEffectMissing(title)) {
            showTitlePicture(title);
            return false;
        }
        // The condition is met and the title would be released now
        if ($gameParty.hasItem($dataArmors[title], false) && !$gameSwitches.value(TITLE_SWITCH_BASE + title)) {
            SoundManager.playBuzzer();
        }
        return true;
    };

    // The Title Collection names the missing item under the condition and effect of the selected title
    const _Game_Screen_showPicture = Game_Screen.prototype.showPicture;
    Game_Screen.prototype.showPicture = function(pictureId) {
        _Game_Screen_showPicture.apply(this, arguments);
        const picture = this.picture(pictureId);
        const title = $gameVariables.value(VARIABLE_SELECTED);
        const screen = $gameVariables.value(VARIABLE_SCREEN);
        if (pictureId === PICTURE_DECK_COUNTS && picture && bound() && [SCREEN_DECK, SCREEN_DECK_BUSY].includes(screen)) {
            picture._x -= DECK_COUNTS_SHIFT;
        }
        if (pictureId !== TITLE_TEXT_PICTURE || !picture || !picture.mzkp_text) {
            return;
        }
        if ($gameVariables.value(VARIABLE_SCREEN) === SCREEN_TITLES && titleEffectMissing(title)) {
            picture.mzkp_text +=
                "\n\\c[18]Unlock Title Effect: " + TITLE_NAMES[title - 1] + " required to activate this bonus";
            picture.mzkp_textChanged = true;
        }
    };

    // Replaces the first floor advance of a run: wait on the standby screen at floor 1.
    // The standby screen is reserved, not called. From the second run on this runs in a parallel event of Map006
    // whose page ends once the floor is 1 or more, which stops whatever that event is still doing a frame later.
    // The game's own call gets away with it because nothing in it waits after the floor is set.
    AP.startRun = interpreter => {
        // A run that got past a boss floor left a checkpoint on the floor after it, with everything it had there
        const ids = [];
        for (let id = 1; bound() && interpreter && id <= CHECKPOINTS; id++) {
            if (StorageManager.exists(CHECKPOINT_NAME + id)) {
                ids.push(id);
            }
        }
        if (ids.length === 0) {
            startAt(1);
            return;
        }
        const names = ids.map(id => "Checkpoint: floor " + checkpointFloor(id));
        $gameMessage.setBackground(2);
        $gameMessage.setPositionType(1);
        $gameMessage.add("Start a new run, or go on from a checkpoint?");
        $gameMessage.setChoices(["New run"].concat(names), 0, -1);
        limitChoiceRows();
        $gameMessage.setChoiceBackground(0);
        $gameMessage.setChoicePositionType(2);
        $gameMessage.setChoiceCallback(index => {
            if (index === 0) {
                startAt(1);
                return;
            }
            // Nothing of the event that asked goes on while the checkpoint takes the place of this game
            interpreter.wait(CHECKPOINT_WAIT);
            SceneManager.goto(Scene_ArchipelagoLoad);
            SceneManager.prepareNextScene(ids[index - 1]);
        });
        interpreter.setWaitMode("message");
    };

    const startAt = floor => {
        state().holdFloor = true;
        $gameVariables.setValue(VARIABLE_FLOOR, floor);
        $gameTemp.reserveCommonEvent(COMMON_EVENT_STANDBY);
    };

    const checkpointFloor = id => id * BOSS_FLOOR_INTERVAL + 1;

    // Runs in common event 87 right after the game's own autosave, so a checkpoint goes on the way that one does
    AP.saveCheckpoint = () => {
        const s = state();
        const floor = $gameVariables.value(VARIABLE_FLOOR);
        const id = (floor - 1) / BOSS_FLOOR_INTERVAL;
        // Once a run: the standby screen starts over after every look at the deck or the shop
        if (!bound() || id < 1 || id > CHECKPOINTS || id !== Math.floor(id) || s.checkpoint === floor) {
            return;
        }
        s.checkpoint = floor;
        $gameSystem.onBeforeSave();
        StorageManager.saveObject(CHECKPOINT_NAME + id, DataManager.makeSaveContents())
            .then(() => notify("Checkpoint saved: floor " + floor))
            .catch(error => {
                s.checkpoint = 0;
                writeLog("checkpoint of floor " + floor + " not saved: " + error);
            });
    };

    // Loads a checkpoint the way the game's load screen loads a save file
    function Scene_ArchipelagoLoad() {
        this.initialize(...arguments);
    }
    Scene_ArchipelagoLoad.prototype = Object.create(Scene_Base.prototype);
    Scene_ArchipelagoLoad.prototype.constructor = Scene_ArchipelagoLoad;

    Scene_ArchipelagoLoad.prototype.prepare = function(id) {
        this._checkpoint = id;
    };

    Scene_ArchipelagoLoad.prototype.start = function() {
        Scene_Base.prototype.start.call(this);
        StorageManager.loadObject(CHECKPOINT_NAME + this._checkpoint)
            .then(contents => {
                DataManager.createGameObjects();
                DataManager.extractSaveContents(contents);
                DataManager.correctDataErrors();
                this._loaded = true;
                AP.offer = null;
                AP.standbyMenu = null;
                SceneManager.goto(Scene_Map);
            })
            .catch(error => {
                writeLog("checkpoint " + this._checkpoint + " not loaded: " + error);
                startAt(1);
                SceneManager.goto(Scene_Map);
            });
    };

    Scene_ArchipelagoLoad.prototype.terminate = function() {
        Scene_Base.prototype.terminate.call(this);
        if (this._loaded) {
            $gameSystem.onAfterLoad();
            notify("Checkpoint loaded: floor " + $gameVariables.value(VARIABLE_FLOOR));
        }
    };

    // Replaces the floor increment of common event 86
    AP.advanceFloor = () => {
        const s = state();
        if (bound() && s.holdFloor) {
            s.holdFloor = false;
            return;
        }
        $gameVariables.setValue(VARIABLE_FLOOR, $gameVariables.value(VARIABLE_FLOOR) + 1);
    };

    // The game's MPP_ChoiceEX decides how many choices are shown before the list scrolls
    const limitChoiceRows = rows => {
        if ($gameMessage.setChoicePos) {
            $gameMessage.setChoicePos(-1, -1, rows || CHOICE_MAX_ROWS);
        }
    };

    // Replaces the "Once upon a time" questions of the opening
    AP.chooseOrigin = interpreter => {
        $gameMessage.setBackground(2);
        $gameMessage.setPositionType(1);
        $gameMessage.add("Choose your starting class......");
        const origins = AP.dlcOrigin ? ORIGINS.concat([DLC_ORIGIN]) : ORIGINS;
        $gameMessage.setChoices(origins.map(origin => origin[1]), 0, -1);
        $gameMessage.setChoiceBackground(0);
        $gameMessage.setChoicePositionType(1);
        limitChoiceRows();
        $gameMessage.setChoiceCallback(index => $gameVariables.setValue(VARIABLE_ORIGIN, origins[index][0]));
        interpreter.setWaitMode("message");
    };

    //-------------------------------------------------------------------------
    // Speed

    const setSpeed = speed => {
        AP.speed = Math.min(Math.max(Math.floor(Number(speed)) || 1, 1), 4);
        return AP.speed;
    };

    const _SceneManager_determineRepeatNumber = SceneManager.determineRepeatNumber;
    SceneManager.determineRepeatNumber = function(deltaTime) {
        return _SceneManager_determineRepeatNumber.apply(this, arguments) * AP.speed;
    };

    document.addEventListener("keydown", event => {
        if (event.key === "F7") {
            setSpeed(AP.speed === 1 ? 2 : 1);
        }
    });

    //-------------------------------------------------------------------------
    // Dev mode

    const DEV_PARAMS = ["maxlp", "maxrp", "str", "def", "mag", "agl", "faith", "virtue"];
    const DEV_HELP = [
        "floor N - set the current floor (the next one is N + 1)",
        "event NAME|ID|fight - force the next floor's event",
        "events [FLOOR] - the events the game would offer on a floor right now",
        "gold N - set gold",
        "souls N - set the souls there are to spend",
        "next - leave the standby screen, as a click on it does",
        "stuck - what the game is doing right now, for a screen that takes no input",
        "heal - restore LP and RP",
        "stat " + DEV_PARAMS.join("|") + "|lewd N - set a stat",
        "card NAME [COUNT] / relic NAME [COUNT] - give (negative COUNT takes away)",
        "title N - meet the condition of title N",
        "unlock - own every event, boss, title effect and card set unlock",
        "var ID [VALUE] / switch ID [on|off] - read or write game data",
        "god [on|off] - LP and RP cannot go down",
        "speed N - game speed 1-4",
    ].join("\n");

    // Damage goes through setHp/setMp, both in battle and from event commands
    const guardSetter = (name, current) => {
        const original = Game_BattlerBase.prototype[name];
        Game_BattlerBase.prototype[name] = function(value) {
            if (AP.god && this.isActor() && value < current(this)) {
                return;
            }
            original.apply(this, arguments);
        };
    };
    guardSetter("setHp", battler => battler.hp);
    guardSetter("setMp", battler => battler.mp);

    const findEntry = (table, text) => {
        const lower = text.toLowerCase();
        return table.find(entry => entry && entry.name && entry.name.toLowerCase() === lower) || table[Number(text)] || null;
    };

    // "Grand Strike 2" -> ["Grand Strike", 2]
    const nameAndCount = words => {
        const hasCount = words.length > 1 && /^-?\d+$/.test(words[words.length - 1]);
        return [words.slice(0, hasCount ? -1 : undefined).join(" "), hasCount ? Number(words[words.length - 1]) : 1];
    };

    const onOff = (word, current) => (word === undefined ? !current : word === "on" || word === "1" || word === "true");

    const devCommands = {
        help: () => DEV_HELP,
        floor: words => {
            $gameVariables.setValue(VARIABLE_FLOOR, Number(words[0]));
            return "Floor " + $gameVariables.value(VARIABLE_FLOOR);
        },
        events: words => {
            const floor = Number(words[0]) || $gameVariables.value(VARIABLE_FLOOR);
            const names = allEvents()
                .filter(eventId => eventAvailable(eventId, floor))
                .map(eventId => eventData(eventId).name);
            return "Floor " + floor + " can hold: " + names.join(", ");
        },
        event: words => {
            const text = words.join(" ");
            const lower = text.toLowerCase();
            const named = eventId => eventData(eventId).name.toLowerCase() === lower || String(eventId) === text;
            const eventId = lower === "fight" ? SWITCH_FIGHT : EVENT_ALIASES[lower] || allEvents().find(named);
            if (!eventId) {
                return "No floor event called " + text;
            }
            AP.nextFloorEvent = eventId;
            return "Next floor: " + (eventId === SWITCH_FIGHT ? "Fight" : eventData(eventId).name);
        },
        gold: words => {
            $gameParty.gainGold(Number(words[0]) - $gameParty.gold());
            return "Gold " + $gameParty.gold();
        },
        souls: words => {
            const s = state();
            if (!s || !bound()) {
                return "Only in a game launched from the client";
            }
            // What was earned stays as it is, the souls spent make up the difference
            s.spent = (s.souls || 0) + (s.runSouls || 0) - Math.max(0, Math.floor(Number(words[0])) || 0);
            return "Souls " + soulTotal();
        },
        next: () => {
            if (!$gameSwitches.value(SWITCH_STANDBY_CONTROL)) {
                return "Not on the standby screen";
            }
            $gameSwitches.setValue(SWITCH_STANDBY_END, true);
            return "Leaving the standby screen";
        },
        heal: () => {
            $gameActors.actor(1).recoverAll();
            return "Recovered";
        },
        stat: words => {
            const actor = $gameActors.actor(1);
            const value = Number(words[1]);
            if (words[0] === "lewd") {
                $gameVariables.setValue(51, value);
                return "LEWD " + value;
            }
            const paramId = DEV_PARAMS.indexOf(words[0]);
            if (paramId < 0) {
                return "Unknown stat " + words[0];
            }
            actor.addParam(paramId, value - actor.param(paramId));
            return words[0] + " " + actor.param(paramId);
        },
        card: words => {
            const [name, count] = nameAndCount(words);
            const item = findEntry($dataItems, name);
            if (!item) {
                return "No card called " + name;
            }
            $gameParty.gainItem(item, count);
            return item.name + " x" + $gameParty.numItems(item);
        },
        relic: words => {
            const [name, count] = nameAndCount(words);
            const weapon = findEntry($dataWeapons, name);
            if (!weapon) {
                return "No relic called " + name;
            }
            AP.granting = true;
            $gameParty.gainItem(weapon, count);
            AP.granting = false;
            return weapon.name + " x" + $gameParty.numItems(weapon);
        },
        title: words => {
            const armor = $dataArmors[Number(words[0])];
            if (!armor || armor.id > TITLE_COUNT) {
                return "Titles are numbered 1-" + TITLE_COUNT;
            }
            $gameParty.gainItem(armor, 1, true);
            return "Condition met for title " + armor.id;
        },
        unlock: () => {
            const s = state();
            if (!s) {
                return "Only in a game launched from the client";
            }
            allEvents().forEach(eventId => remember(s.events, eventId));
            KING_SWITCHES.forEach(kingSwitch => remember(s.bosses, kingSwitch));
            for (let title = 1; title <= TITLE_COUNT; title++) {
                remember(s.titles, title);
            }
            Object.keys(STARTING_SETS).forEach(setId => remember(s.sets, Number(setId)));
            return "Everything unlocked on this save";
        },
        var: words => {
            if (words.length > 1) {
                $gameVariables.setValue(Number(words[0]), Number(words[1]));
            }
            return "v[" + words[0] + "] = " + $gameVariables.value(Number(words[0]));
        },
        switch: words => {
            if (words.length > 1) {
                $gameSwitches.setValue(Number(words[0]), onOff(words[1], false));
            }
            return "s[" + words[0] + "] = " + ($gameSwitches.value(Number(words[0])) ? "on" : "off");
        },
        god: words => {
            AP.god = onOff(words[0], AP.god);
            return "God mode " + (AP.god ? "on" : "off");
        },
        speed: words => "Speed x" + setSpeed(words[0]),
    };

    // Takes "floor 19" or ["floor", "19"] and returns a line of text
    // What the game is waiting for, for a standby screen that does not react
    devCommands.stuck = () => {
        const interpreter = $gameMap._interpreter;
        const running = [];
        for (let current = interpreter; current; current = current._childInterpreter) {
            const list = current._list;
            const event = list ? $dataCommonEvents.find(other => other && other.list === list) : null;
            const item = list ? list[current._index] : null;
            running.push(
                (list ? (event ? "CE " + event.id + " " + event.name : "map event " + current._eventId) : "idle") +
                    (list ? " at " + current._index + "/" + list.length + " code " + (item ? item.code : "end") : "") +
                    (current._waitMode ? " waits for " + current._waitMode : "") +
                    (current._waitCount ? " waits " + current._waitCount + " frames" : "")
            );
        }
        const on = [1, 2, 16, 17, 66, 86, 87, 88, 89, 90, 101, 294].filter(id => $gameSwitches.value(id));
        const picture = $gameScreen.picture(100);
        const spriteset = SceneManager._scene && SceneManager._scene._spriteset;
        const sprites = spriteset && spriteset._pictureContainer ? spriteset._pictureContainer.children : [];
        const sprite = sprites.find(other => other._pictureId === 100);
        const s = state();
        return [
            "map " + $gameMap.mapId() + ", floor " + $gameVariables.value(VARIABLE_FLOOR) + ", screen " +
                $gameVariables.value(VARIABLE_SCREEN) + ", LP " + $gameVariables.value(VARIABLE_LP),
            "interpreter: " + running.join(" > "),
            "switches on: " + on.join(", "),
            "message busy " + $gameMessage.isBusy() + ", choice " + $gameMessage.isChoice() + ", reserved CE " +
                $gameTemp.isCommonEventReserved() + ", fade " + $gameScreen.brightness(),
            "bound " + bound() + ", active " + active() + ", holdFloor " + (s ? !!s.holdFloor : "-") + ", runOver " +
                (s ? !!s.runOver : "-") + ", standbyChoice " + !!AP.standbyChoice + ", menu " + AP.standbyMenu +
                ", again " + !!AP.standbyAgain + ", chosen " + AP.chosenFloorEvent,
            "bgm " + (AudioManager._currentBgm ? AudioManager._currentBgm.name : "none"),
            // The standby screen takes its input in the parallel common event 89 and its clicks through picture 100
            "parallel: " + [88, 89].map(id => {
                const event = ($gameMap._commonEvents || []).find(other => other._commonEventId === id);
                const own = event && event._interpreter;
                if (!own) {
                    return "CE " + id + (event ? " no interpreter" : " not on this map");
                }
                return "CE " + id + " at " + own._index + (own._list ? "/" + own._list.length : " (no list)") +
                    (own._waitMode ? " waits for " + own._waitMode : "") +
                    (own._waitCount ? " waits " + own._waitCount : "") +
                    (own._childInterpreter ? " in a called event" : "");
            }).join(", "),
            "picture 100: " + (picture ? "'" + picture.name() + "' opacity " + picture.opacity() + " button " +
                picture.mzkp_commonEventId : "none") + ", sprite " + (sprite ? "visible " + sprite.visible +
                " bitmap " + (sprite.bitmap ? bitmapState(sprite.bitmap) : "none") : "none"),
            "trace: " + (AP.traced || []).join(" | "),
        ].join("\n");
    };

    AP.dev = input => {
        const words = Array.isArray(input) ? input.map(String) : String(input).trim().split(/\s+/);
        const handler = devCommands[(words[0] || "help").toLowerCase()];
        if (!handler) {
            return "Unknown dev command " + words[0] + ". Try: help";
        }
        if (!$gameParty) {
            return "The game has not finished loading";
        }
        try {
            const result = handler(words.slice(1));
            writeLog("dev " + words.join(" ") + "\n" + result);
            return result;
        } catch (error) {
            writeLog("dev " + words.join(" ") + " failed\n" + error.stack);
            return "Failed: " + error.message;
        }
    };

    //-------------------------------------------------------------------------
    // Event data patches

    const command = (code, indent, parameters) => ({ code: code, indent: indent, parameters: parameters });

    // Index of the "End" (412) command closing the conditional branch that starts at `start`
    const branchEnd = (list, start) => {
        for (let i = start + 1; i < list.length; i++) {
            if (list[i].code === 412 && list[i].indent === list[start].indent) {
                return i;
            }
        }
        return -1;
    };

    // Keeps commands start..end for saves that are not bound to a multiworld and runs `replacement` otherwise
    const overrideRange = (list, start, end, replacement, keeps) => {
        const indent = list[start].indent;
        const original = list.slice(start, end + 1);
        original.forEach(originalCommand => originalCommand.indent++);
        replacement.forEach(newCommand => (newCommand.indent += indent + 1));
        list.splice(
            start,
            original.length,
            command(111, indent, [12, keeps || "!LostChapterAP.bound()"]),
            ...original,
            command(0, indent + 1, []),
            command(411, indent, []),
            ...replacement,
            command(0, indent + 1, []),
            command(412, indent, [])
        );
    };

    const overrideBranch = (list, start, script) => {
        overrideRange(list, start, branchEnd(list, start), [command(355, 0, [script])]);
    };

    const patchNextFloor = () => {
        const list = $dataCommonEvents[COMMON_EVENT_NEXT_FLOOR].list;
        const isBranch = (item, test) => item.code === 111 && item.indent === 0 && test(item.parameters);
        const bossBranch = list.findIndex(item =>
            isBranch(item, p => p[0] === 12 && String(p[1]).includes("% 20"))
        );
        const eventBranch = list.findIndex(item =>
            isBranch(item, p => p[0] === 1 && p[1] === VARIABLE_FLOOR_EVENT && p[3] === 2 && p[4] === 2)
        );
        const increment = list.findIndex(item => {
            const p = item.parameters;
            return item.code === 122 && p[0] === VARIABLE_FLOOR && p[1] === VARIABLE_FLOOR && p[2] === 1 && p[4] === 1;
        });
        if (bossBranch < 0 || eventBranch < bossBranch || increment < 0 || increment > bossBranch) {
            console.error("[AP] Common event 86 has an unexpected layout, floor events are not patched");
            return;
        }
        collectRerollBlocks(list);
        // Later branch first, so the earlier index stays valid
        overrideBranch(list, eventBranch, "LostChapterAP.chooseFloorEvent(this);");
        overrideBranch(
            list,
            bossBranch,
            "if (LostChapterAP.bossFloor()) { this.command119(['" + LABEL_END + "']); }"
        );
        list[increment] = command(355, list[increment].indent, ["LostChapterAP.advanceFloor();"]);
        // The choice goes ahead of the transition that slides in over the standby screen
        const transition = list.findIndex(item =>
            item.code === 231 && item.indent === 0 && String(item.parameters[1]).startsWith("Transition")
        );
        if (transition >= 0 && transition < increment) {
            let standbyEnd = transition;
            while (standbyEnd > 0 && [355, 655].includes(list[standbyEnd - 1].code)) {
                standbyEnd--;
            }
            // Asked again after a visit to the soul shop
            list.splice(
                standbyEnd,
                0,
                command(118, 0, [LABEL_STANDBY]),
                command(355, 0, ["LostChapterAP.prepareFloorEvent(this);"]),
                command(111, 0, [12, "LostChapterAP.standbyAgain"]),
                command(119, 1, [LABEL_STANDBY]),
                command(0, 1, []),
                command(412, 0, []),
                command(111, 0, [12, "LostChapterAP.standbyBack"]),
                command(355, 1, ["LostChapterAP.backToStandby(this);"]),
                command(0, 1, []),
                command(412, 0, [])
            );
        }
    };

    const patchTitleReleases = () => {
        for (let title = 1; title <= TITLE_COUNT; title++) {
            const list = $dataCommonEvents[COMMON_EVENT_TITLE_RELEASE + title].list;
            const start = list.findIndex(item => {
                const p = item.parameters;
                return item.code === 111 && item.indent === 0 && p[0] === 10 && p[1] === title;
            });
            const end = start < 0 ? -1 : branchEnd(list, start);
            if (end < 0) {
                console.error("[AP] Common event " + (400 + title) + " has an unexpected layout, title is not patched");
                continue;
            }
            // The whole "has armor n" branch is skipped without the title effect. With the DLC that branch also
            // holds the offer to release the title with a Mark of Attainer.
            const release = list.slice(start, end + 1);
            release.forEach(item => item.indent++);
            list.splice(
                start,
                release.length,
                command(111, 0, [12, "LostChapterAP.titleLocked(" + title + ")"]),
                command(0, 1, []),
                command(411, 0, []),
                ...release,
                command(0, 1, []),
                command(412, 0, [])
            );
        }
    };

    // Common event 72: from the command that resets the score to the loop that animates its digits
    const findScoreCommands = () => {
        const list = $dataCommonEvents[COMMON_EVENT_SCORE].list;
        const isScore = (item, operation) => {
            const p = item.parameters;
            return item.code === 122 && p[0] === VARIABLE_SCORE && p[1] === VARIABLE_SCORE && p[2] === operation;
        };
        const start = list.findIndex(item => isScore(item, 0) && item.parameters[3] === 0 && item.parameters[4] === 0);
        const end = list.findIndex((item, i) => i > start && item.code === 112);
        if (start < 0 || end < 0) {
            console.error("[AP] Common event 72 has an unexpected layout, souls are not counted");
            return;
        }
        scoreCommands = list.slice(start, end);
    };

    const eventLists = map => {
        const lists = [];
        for (const event of map.events) {
            if (event) {
                event.pages.forEach(page => lists.push(page.list));
            }
        }
        return lists;
    };

    // A run starts with a call to common event 86 from Map004 (first playthrough) or Map006
    const patchRunStart = list => {
        for (let i = list.length - 1; i >= 0; i--) {
            if (list[i].code === 117 && list[i].parameters[0] === COMMON_EVENT_NEXT_FLOOR) {
                overrideRange(list, i, i, [command(355, 0, ["LostChapterAP.startRun(this);"])]);
            }
        }
    };

    // Map001: the chain of questions from "Once upon a time" up to the "That's right" message that reveals the origin
    const patchOrigin = list => {
        const isMessage = (item, text) => item.code === 401 && String(item.parameters[0]).startsWith(text);
        const question = list.findIndex(item => isMessage(item, "Once upon a time"));
        if (question < 1) {
            return;
        }
        const reveal = list.findIndex((item, i) => i > question && isMessage(item, "That's right"));
        if (reveal < 0 || list[question - 1].code !== 101 || list[reveal - 1].code !== 101) {
            console.error("[AP] The opening has an unexpected layout, the origin list is not patched");
            return;
        }
        // With the DLC the reveal sits in a branch that words it differently for the origin of its own
        // ("Oh... You are..." for The New Ruler, "That's right" otherwise). The list ends ahead of that whole branch.
        let revealStart = reveal - 1;
        if (list[reveal].indent > 0) {
            while (list[revealStart].indent > 0 || list[revealStart].code !== 111) {
                revealStart--;
            }
        }
        AP.dlcOrigin = list.some(item => {
            const p = item.parameters;
            return item.code === 122 && p[0] === VARIABLE_ORIGIN && p[1] === VARIABLE_ORIGIN && p[4] === DLC_ORIGIN[0];
        });
        // Offline the game asks its own questions
        const pick = [command(355, 0, ["LostChapterAP.chooseOrigin(this);"])];
        overrideRange(list, question - 1, revealStart - 1, pick, "!LostChapterAP.shuffled()");
    };

    // Map001: the branch of the "Correct" choice that applies the origin
    // A multiworld has the soul shop in its place. Offline the game keeps its own.
    AP.skipsBonusShop = () => bound() && !OFFLINE;

    // Map003: a new run goes to the bonus shop (Map008) from the second playthrough on
    const patchBonusShop = list => {
        for (const item of list) {
            const p = item.parameters;
            if (item.code === 111 && p[0] === 1 && p[1] === VARIABLE_PLAYTHROUGH && p[3] === 2 && p[4] === 1) {
                const visits = "!LostChapterAP.skipsBonusShop() && $gameVariables.value(" + VARIABLE_PLAYTHROUGH + ") >= 2";
                item.parameters = [12, visits];
            }
        }
    };

    const patchMap = map => {
        if (map._archipelagoPatched) {
            return;
        }
        map._archipelagoPatched = true;
        for (const list of eventLists(map)) {
            patchRunStart(list);
            patchOrigin(list);
            patchBonusShop(list);
        }
    };

    // Each door choice already carries a condition like "(!s[71]&&!s[15])"
    const patchKingDoors = () => {
        const list = $dataCommonEvents[COMMON_EVENT_KING_BATTLE].list;
        const choices = list.find(item => item.code === 102 && String(item.parameters[0][0]).includes("!s[71]"));
        if (!choices) {
            console.error("[AP] Common event 63 has an unexpected layout, boss doors are not patched");
            return;
        }
        choices.parameters[0] = choices.parameters[0].map((text, index) => {
            const kingSwitch = KING_SWITCHES[index];
            return text.replace("!s[" + kingSwitch + "]", "s[" + (kingSwitch + KING_UNLOCK_SWITCH_SHIFT) + "]");
        });
        patchDoorChoices(list, list.indexOf(choices));
    };

    // More door choices. After a victory the event clears the particles of the hallway, moves to the map of the
    // climb and calls the standby screen: the new choices that skip the fight join in there.
    const patchDoorChoices = (list, choices) => {
        const indent = list[choices].indent;
        const choicesEnd = list.findIndex((item, i) => i > choices && item.code === 404 && item.indent === indent);
        const leave = list.findIndex(
            (item, i) => i > choicesEnd && item.indent === 0 && item.code === 357 && item.parameters[1] === "clear"
        );
        const transfer = list.findIndex((item, i) => i > leave && item.indent === 0 && item.code === 201);
        if (choicesEnd < 0 || leave < 0 || transfer < 0) {
            console.error("[AP] Common event 63 has an unexpected layout, the boss doors have no other choices");
            return;
        }
        const leaveHallway = list.slice(leave, transfer + 1).map(item => Object.assign({}, item));
        const added = [
            // The last boss (common event 64) expects to start on the map of the climb with the screen faded out
            [
                "Final Bossen(s[" + SWITCH_FINAL_BOSS + "])if(s[" + SWITCH_FREE_DOORS + "])",
                [command(221, 0, [])].concat(leaveHallway, [
                    command(121, 0, [SWITCH_KING_BATTLE, SWITCH_KING_BATTLE, 1]),
                    command(121, 0, [SWITCH_LAST_BOSS, SWITCH_LAST_BOSS, 0]),
                    command(119, 0, [LABEL_END]),
                ]),
            ],
            ["Keep Goingif(s[" + SWITCH_FREE_DOORS + "])", [command(119, 0, [LABEL_LEAVE_DOORS])]],
            [
                "Turn Backif(s[" + SWITCH_TURN_BACK + "])",
                [
                    command(355, 0, ["LostChapterAP.turnBack();"]),
                    command(101, 0, ["", 0, 1, 2, ""]),
                    command(401, 0, ["You turned back. The way on stays closed until a Heavenly King falls."]),
                    command(119, 0, [LABEL_LEAVE_DOORS]),
                ],
            ],
        ];
        const branches = [];
        for (const [text, commands] of added) {
            branches.push(command(402, indent, [list[choices].parameters[0].length, text]));
            commands.forEach(item => (item.indent = indent + 1));
            branches.push(...commands, command(0, indent + 1, []));
            list[choices].parameters[0].push(text);
        }
        // Later index first, so the earlier one stays valid
        list.splice(leave, 0, command(118, 0, [LABEL_LEAVE_DOORS]));
        list.splice(choicesEnd, 0, ...branches);
        patchDlcDoors(list);
    };

    // DLC: behind the hallway are the White Door and the Black Door again, there without their keys, and the game
    // walks away from them once both are defeated: Magislilia then takes the place of the next boss floor.
    // In a multiworld the two doors take their keys there as well, and Magislilia is a third door behind them.
    const patchDlcDoors = list => {
        const isBehind = text => String(text).startsWith("White Doorif(!s[");
        const choices = list.findIndex(item => item.code === 102 && item.parameters[0].some(isBehind));
        if (choices < 0) {
            return;
        }
        const indent = list[choices].indent;
        const at = (code, from, test) =>
            list.findIndex((item, i) => i > from && item.indent === indent && item.code === code && (!test || test(item)));
        const cancel = at(403, choices);
        const walkAway = list.findIndex((item, i) => {
            const p = item.parameters;
            return i < choices && item.indent === indent && item.code === 111 && p[0] === 0 && p[1] === DLC_BOSS_SWITCHES[0];
        });
        const leave = list.findIndex(
            (item, i) => i > choices && item.indent === 0 && item.code === 357 && item.parameters[1] === "clear"
        );
        const transfer = list.findIndex((item, i) => i > leave && item.indent === 0 && item.code === 201);
        if (cancel < 0 || walkAway < 0 || leave < 0 || transfer < 0) {
            console.error("[AP] Common event 63 has an unexpected layout, the doors of the DLC are not patched");
            return;
        }
        list[walkAway].parameters = [
            12,
            "!LostChapterAP.bound() && $gameSwitches.value(" + DLC_BOSS_SWITCHES[0] + ")",
        ];
        const lastDoor = "The Last Doorif(s[" + SWITCH_LAST_DOOR + "])";
        const branch = [command(402, indent, [list[choices].parameters[0].length, lastDoor]), command(221, 0, [])]
            .concat(list.slice(leave, transfer + 1).map(item => Object.assign({}, item)), [
                command(121, 0, [SWITCH_BEHIND, SWITCH_BEHIND, 1]),
                command(121, 0, [SWITCH_KING_BATTLE, SWITCH_KING_BATTLE, 1]),
                command(121, 0, [SWITCH_DLC_LAST_BOSS, SWITCH_DLC_LAST_BOSS, 0]),
                command(119, 0, [LABEL_END]),
                command(0, 0, []),
            ]);
        branch.slice(1).forEach(item => (item.indent = indent + 1));
        list[choices].parameters[0] = list[choices].parameters[0]
            .map(text => String(text).replace("White Door", "White Dooren(s[" + SWITCH_WHITE_DOOR + "])"))
            .map(text => text.replace("Black Door", "Black Dooren(s[" + SWITCH_BLACK_DOOR + "])"))
            .concat([lastDoor]);
        list.splice(cancel, 0, ...branch);
    };

    // Replaces "the enemy is in its Refractory Period" where the turn start draws Kick Balls
    AP.finisher = () => {
        const enemy = $gameTroop.members()[0];
        if (!enemy || !enemy.isStateAffected(STATE_REFRACTORY)) {
            return false;
        }
        const mode = option("finisher_move");
        if (mode === FINISHER_REMOVE) {
            return false;
        }
        return mode === FINISHER_SHUFFLE || mode === FINISHER_BOON_SHOP ? !!state().finisher : true;
    };

    const patchFinisher = () => {
        const list = $dataCommonEvents[COMMON_EVENT_TURN_START].list;
        const draw = list.findIndex((item, i) => {
            const p = item.parameters;
            const next = list[i + 1];
            return (
                item.code === 111 && p[0] === 5 && p[2] === 1 && p[3] === STATE_REFRACTORY &&
                next && next.code === 122 && next.parameters[4] === CARD_FINISHER
            );
        });
        if (draw < 0) {
            console.error("[AP] Common event 103 has an unexpected layout, Kick Balls is not patched");
            return;
        }
        list[draw].parameters = [12, "LostChapterAP.finisher()"];
    };

    // Market. In the game the merchant is gone once both of his gifts are taken, and the place only brings back a
    // memory of him from then on (Max RP +5). As checks the gifts stay taken for good, which would leave every later
    // run with that memory alone: no merchant to thank (VIRTUE +5) and none to turn down (FAITH down), which the
    // titles about VIRTUE and FAITH count on. So with both as checks the merchant is always there: his gifts are
    // grayed out once taken, and he can be thanked from then on or turned down as before.
    AP.marketMenu = () => bound() && MARKET_RELICS.every(weaponId => relicChecks().includes(weaponId));

    const patchMarket = () => {
        const list = $dataCommonEvents[COMMON_EVENT_MARKET].list;
        const choices = list.findIndex(
            item => item.code === 102 && item.parameters[0].some(text => String(text).startsWith("Take a Plushie"))
        );
        const memory = list.findIndex(item => {
            const p = item.parameters;
            return item.code === 111 && item.indent === 0 && p[0] === 0 && p[1] === 11 && p[2] === 0;
        });
        const indent = choices < 0 ? 0 : list[choices].indent;
        const refuse = list.findIndex(
            (item, i) => i > choices && item.code === 402 && item.indent === indent && item.parameters[0] === 2
        );
        const hasThanks = list.some(item => item.code === 118 && item.parameters[0] === LABEL_MARKET_THANKS);
        if (choices < 0 || memory < 0 || memory > choices || refuse < 0 || !hasThanks) {
            console.error("[AP] Common event 33 has an unexpected layout, the merchant is not kept");
            return;
        }
        const thanks = "Thank Himif(s[" + SWITCH_MARKET_THANKS + "])";
        const p = list[choices].parameters;
        list[memory].parameters = [12, "$gameSwitches.value(11) && !LostChapterAP.marketMenu()"];
        // "Thank Him" goes ahead of "Don't Need Anything", which stays what cancelling picks
        p[0] = p[0].slice(0, 2).concat([thanks], p[0].slice(2));
        if (p[1] === 2) {
            p[1] = 3;
        }
        list[refuse].parameters[0] = 3;
        list.splice(
            refuse,
            0,
            command(402, indent, [2, thanks]),
            command(119, indent + 1, [LABEL_MARKET_THANKS]),
            command(0, indent + 1, [])
        );
    };

    // An event whose relic or card was found plays one short scene from then on instead of itself, which in a
    // multiworld would be for good: the check stays sent. There the player is asked on every visit instead, to see
    // that scene (revisit) or the event as it was before (reset). `kind` is that of the "has ..." question the
    // event asks at its top level, 9 for a relic and 8 for a card. A scene without a label is never played.
    const bonfireLabel = () => {
        const open = relicChecks().includes(WEAPON_COLLAR_KEY) && !state().checked.includes(RELIC_OFFSET + WEAPON_COLLAR_KEY);
        return "LP Recovery" + (open ? ", full LP: Collar Key" : "");
    };

    const SWITCH_TRAVELER_DEAD = 281; // "For Cherry Blossom Tree Event": the traveler of the Collapse died
    const travelerDead = () => $gameSwitches.value(SWITCH_TRAVELER_DEAD);

    const CONCLUSIONS = {
        // Collapse: the traveler who was saved, or his grave when he was left to die since. A reset brings him back.
        30: {
            scenes: [{ kind: 9, id: 29, label: () => (travelerDead() ? "FAITH +5 (Dead)" : "Gold (Alive)") }],
            reset: "VIRTUE -5",
            blocked: () => travelerDead(),
            onReset: () => $gameSwitches.setValue(SWITCH_TRAVELER_DEAD, false),
        },
        // Amusement Center
        36: { scenes: [{ kind: 9, id: 36, label: "Random Stat +1" }], reset: "Gold or LP" },
        // Girl, who only asks in the versions of the game that have her gift
        41: { scenes: [{ kind: 9, id: 41, label: "Max RP +5", optional: true }], reset: "RP +5 / FAITH -5" },
        // Battlefield: the regrets the Collar Key brings (LP -3), then the bonfire of the soldier who gave his ring
        42: {
            scenes: [{ kind: 9, id: WEAPON_COLLAR_KEY, label: null }, { kind: 9, id: WEAPON_DUSK_RING, label: bonfireLabel }],
            reset: "\uff1cHealing\uff1e required: VIRTUE +5",
        },
        // Cat, whose own card only exists with the DLC
        44: { scenes: [{ kind: 8, id: 39, label: "Max RP +5", optional: true }], reset: "LEWD +2 / Bosomy" },
        // Throne
        59: { scenes: [{ kind: 9, id: 59, label: "LP +10" }], reset: "Seduce the King" },
    };
    const REVISIT_CHOICE = "ArchipelagoRevisit:";
    const RESET_CHOICE = "ArchipelagoReset:";

    const sceneIsCheck = scene => bound() && (scene.kind === 9 ? relicChecks() : cardChecks()).includes(scene.id);

    // The relic or card of a scene was handed out: its check was sent, or where it is no check, the player has it
    const sceneTaken = scene => {
        if (sceneIsCheck(scene)) {
            return state().checked.includes((scene.kind === 9 ? RELIC_OFFSET : CARD_OFFSET) + scene.id);
        }
        return $gameParty.hasItem((scene.kind === 9 ? $dataWeapons : $dataItems)[scene.id], scene.equip);
    };

    const sceneOffered = scene => !!scene.label && shuffled() && sceneTaken(scene);

    // Asked before the first of the scenes: is there one to revisit? Also forgets the answer of the last visit.
    AP.concluded = eventId => {
        AP.revisit = 0;
        return CONCLUSIONS[eventId].scenes.some(sceneOffered);
    };

    // Replaces "has relic n" and "has card n" in front of a scene: the player asked for it
    AP.revisits = (eventId, index) => {
        const scene = CONCLUSIONS[eventId].scenes[index];
        // The game's own question where nothing is asked: outside a multiworld, and for a scene that is never
        // revisited and whose relic is in the player's hands
        if (!shuffled() || (!scene.label && !sceneIsCheck(scene))) {
            return $gameParty.hasItem((scene.kind === 9 ? $dataWeapons : $dataItems)[scene.id], scene.equip);
        }
        // A scene that is `blocked` gives way to what the event holds further down, the grave of the Collapse
        const event = CONCLUSIONS[eventId];
        return AP.revisit === index + 1 && !(event.blocked && event.blocked());
    };

    AP.answer = (eventId, answer) => {
        const event = CONCLUSIONS[eventId];
        AP.revisit = answer;
        if (answer < 0 && event.onReset) {
            event.onReset();
        }
    };

    // What a choice of the question is called, null for any other choice
    const conclusionChoice = text => {
        const parts = String(text).split(":");
        const event = CONCLUSIONS[Number(parts[1])];
        if (text.startsWith(RESET_CHOICE)) {
            return "Reset Event (" + event.reset + ")";
        }
        if (!text.startsWith(REVISIT_CHOICE)) {
            return null;
        }
        const label = event.scenes[Number(parts[2])].label;
        return "Revisit Event (" + (typeof label === "function" ? label() : label) + ")";
    };

    // Events that are over for the rest of the run once someone in them is gone: the Throne with the king dead
    // ("Seduce the King", or the Monster quest), and with it the place of the Aetolus Flag, and the Old Woman once
    // she left or was robbed. In a multiworld the player is asked instead, like at an event that reached its
    // conclusion, and a reset has them back: `off` are the switches it turns off, the first is the one asked for.
    const REVIVALS = [
        { event: 59, off: [273], line: "The king is dead.", revisit: "the king is dead", reset: "the king lives" },
        // Old Woman (DLC): "Disappearance of Old Woman", and her message with it so it can be taken again
        { event: 594, off: [264, 261], line: "The old woman is gone.", revisit: "she is gone", reset: "she is back" },
    ];
    AP.revives = () => shuffled();

    const patchRevivals = () => {
        for (const revival of REVIVALS) {
            const commonEvent = $dataCommonEvents[revival.event];
            const list = commonEvent ? commonEvent.list : [];
            const gone = list.findIndex(item => {
                const q = item.parameters;
                return item.code === 111 && q[0] === 0 && q[1] === revival.off[0] && q[2] === 0;
            });
            if (gone < 0) {
                // The Old Woman is only there with the DLC
                continue;
            }
            const label = "archipelago revival " + revival.event;
            const indent = list[gone].indent + 1;
            const answers = ["Revisit Event (" + revival.revisit + ")", "Reset Event (" + revival.reset + ")"];
            list.splice(
                gone + 1,
                0,
                command(111, indent, [12, "LostChapterAP.revives()"]),
                command(101, indent + 1, ["", 0, 1, 2, ""]),
                command(401, indent + 1, [revival.line]),
                command(401, indent + 1, ["Revisit or reset the event?"]),
                command(102, indent + 1, [answers, -1, 0, 2, 0]),
                command(402, indent + 1, [0, answers[0]]),
                command(0, indent + 2, []),
                command(402, indent + 1, [1, answers[1]]),
                ...revival.off.map(switchId => command(121, indent + 2, [switchId, switchId, 1])),
                command(119, indent + 2, [label]),
                command(0, indent + 2, []),
                command(404, indent + 1, []),
                command(0, indent + 1, []),
                command(412, indent, [])
            );
            list.unshift(command(118, 0, [label]));
        }
    };

    const patchConclusions = () => {
        for (const eventId of Object.keys(CONCLUSIONS).map(Number)) {
            const event = CONCLUSIONS[eventId];
            const list = $dataCommonEvents[eventId].list;
            let first = -1;
            event.scenes.forEach((scene, index) => {
                const at = list.findIndex(item => {
                    const p = item.parameters;
                    return item.code === 111 && item.indent === 0 && p[0] === scene.kind && p[1] === scene.id;
                });
                if (at < 0) {
                    scene.label = null;
                    if (!scene.optional) {
                        console.error("[AP] Common event " + eventId + " has an unexpected layout, it cannot be reset");
                    }
                    return;
                }
                scene.equip = !!list[at].parameters[2];
                list[at].parameters = [12, "LostChapterAP.revisits(" + eventId + ", " + index + ")"];
                first = first < 0 ? at : Math.min(first, at);
            });
            const answers = event.scenes
                .map((scene, index) => [REVISIT_CHOICE + eventId + ":" + index, index + 1, scene.label])
                .filter(answer => answer[2])
                .concat([[RESET_CHOICE + eventId, -1]]);
            if (first < 0 || answers.length < 2) {
                continue;
            }
            const question = [
                command(111, 0, [12, "LostChapterAP.concluded(" + eventId + ")"]),
                command(101, 1, ["", 0, 1, 2, ""]),
                command(401, 1, ["This event has reached its conclusion."]),
                command(401, 1, ["Revisit or reset the event?"]),
                command(102, 1, [answers.map(answer => answer[0]), -1, 0, 2, 0]),
            ];
            answers.forEach((answer, index) => {
                question.push(
                    command(402, 1, [index, answer[0]]),
                    command(355, 2, ["LostChapterAP.answer(" + eventId + ", " + answer[1] + ");"]),
                    command(0, 2, [])
                );
            });
            question.push(command(404, 1, []), command(0, 1, []), command(412, 0, []));
            list.splice(first, 0, ...question);
        }
    };

    // Cat: patting it hands out its cards one after the other from LEWD 10 on. With all of them found there is
    // nothing left to hand out, and the choice says so instead of doing nothing.
    AP.catDone = () => {
        const cards = (AP.catCards || []).filter(itemId => cardChecks().includes(itemId));
        return bound() && cards.length > 0 && cards.every(itemId => state().checked.includes(CARD_OFFSET + itemId));
    };

    // Marsh: the Old Iron Hammer is only found by a player with the dog in the deck, or who laid it to rest. In a
    // multiworld the first find that succeeds is the hammer while its check is open.
    AP.marshHammer = () => {
        if (bound() && relicChecks().includes(WEAPON_OLD_IRON_HAMMER)) {
            return true;
        }
        return $gameParty.hasItem($dataItems[ITEM_LASSI]);
    };

    const patchMarsh = () => {
        const list = $dataCommonEvents[COMMON_EVENT_MARSH].list;
        const gains = (item, weaponId) => item && item.code === 127 && item.parameters[0] === weaponId;
        const at = list.findIndex((item, i) => {
            const p = item.parameters;
            return item.code === 111 && p[0] === 8 && p[1] === ITEM_LASSI && gains(list[i + 1], WEAPON_OLD_IRON_HAMMER);
        });
        if (at >= 0) {
            // Only the version of the game that comes with the DLC has the hammer
            list[at].parameters = [12, "LostChapterAP.marshHammer()"];
        }
    };

    // Girl: the patch of the game that restores its cut content has her give the Moon Hair Ornament to a player in
    // the Regression State. In the game without it there is neither the state nor the gift, and with it no White
    // Key. In a multiworld she hands the ornament out on any visit while its check is open, in every version.
    AP.girlGift = () => {
        if ($gameActors.actor(1).isStateAffected(STATE_REGRESSION)) {
            return true;
        }
        const location = RELIC_OFFSET + WEAPON_MOON_HAIR_ORNAMENT;
        return bound() && relicChecks().includes(WEAPON_MOON_HAIR_ORNAMENT) && !state().checked.includes(location);
    };

    const patchGirl = () => {
        const list = $dataCommonEvents[COMMON_EVENT_GIRL].list;
        const gate = list.findIndex(item => {
            const p = item.parameters;
            return item.code === 111 && item.indent === 0 && p[0] === 4 && p[2] === 6 && p[3] === STATE_REGRESSION;
        });
        const otherwise = list.findIndex((item, i) => i > gate && item.indent === 0 && item.code === 411);
        if (gate < 0 || otherwise < 0) {
            console.error("[AP] Common event 41 has an unexpected layout, the Moon Hair Ornament is not handed out");
            return;
        }
        const isGift = item => {
            const p = item.parameters;
            return item.code === 127 && p[0] === WEAPON_MOON_HAIR_ORNAMENT && p[1] === 0;
        };
        list[gate].parameters = [12, "LostChapterAP.girlGift()"];
        if (!list.slice(gate, otherwise).some(isGift)) {
            list.splice(
                gate + 1,
                0,
                command(101, 1, ["", 0, 1, 2, ""]),
                command(401, 1, ["The girl held something out to you, to remember her by."]),
                command(127, 1, [WEAPON_MOON_HAIR_ORNAMENT, 0, 0, 1, false])
            );
        }
    };

    // One of the verses of the standby screen (common event 87) runs off the screen in the patched DLC version
    // of the game, where a line break of it went missing
    const patchStandbyVerse = () => {
        const long = "overflow. When the light goes out, I will regain";
        for (const item of $dataCommonEvents[COMMON_EVENT_STANDBY_START].list) {
            const args = item.code === 357 && item.parameters[0] === "TextPicture" ? item.parameters[3] : null;
            if (args && String(args.text).includes(long)) {
                args.text = args.text.replace(long, long.replace(". When", ".\nWhen"));
            }
        }
    };

    // The DLC shows a tip about a new kind of card on the first standby screen of a save. It uses the picture the
    // standby screen takes its clicks with and erases it afterwards, which leaves the screen deaf to the mouse.
    // The picture is put back after the tip.
    // The deck screen takes its clicks through the pictures of the cards, so an empty slot, which is where a
    // Pieris is used, only answers to the keyboard. With a Pieris the empty slots of the page get a picture that
    // is as good as invisible, and the game makes a button of it like of any card.
    AP.showEmptySlots = () => {
        const pieris = $dataWeapons[WEAPON_PIERIS];
        if (!bound() || !pieris || pieris.name !== "Pieris" || !$gameParty.hasItem(pieris, false)) {
            return;
        }
        const first = $gameVariables.value(VARIABLE_DECK_PAGE) === 1 ? 0 : DECK_PAGE_SLOTS;
        const blank = String(CARD_ITEM_FIRST);
        for (let slot = 0; slot < DECK_PAGE_SLOTS; slot++) {
            if (first + slot >= $gameVariables.value(VARIABLE_DECK_COUNT)) {
                const x = $gameVariables.value(VARIABLE_DECK_X) + DECK_SLOT_WIDTH * (slot % DECK_ROW_SLOTS);
                const y = $gameVariables.value(VARIABLE_DECK_Y) + DECK_SLOT_HEIGHT * Math.floor(slot / DECK_ROW_SLOTS);
                $gameScreen.showPicture(DECK_PICTURE_BASE + slot, blank, 1, x, y, 100, 100, 1, 0);
            }
        }
    };

    // The cards of a won fight: one of them can be a battle reward (rollDrop and takeDrop)
    const patchDrops = () => {
        const start = $dataCommonEvents[COMMON_EVENT_DROP_START].list;
        const shown = start.findIndex(item => {
            const script = item.code === 355 ? String(item.parameters[0]) : "";
            return item.indent === 0 && script.startsWith("$gameScreen.showPicture(51,$gameVariables.value(6)");
        });
        const gains = $dataCommonEvents[COMMON_EVENT_DROP_CONTROL].list.filter(item => {
            const script = item.code === 355 ? String(item.parameters[0]) : "";
            return /^\$gameParty\.gainItem\(\$dataItems\[\$gameVariables\.value\([678]\)\], 1\)$/.test(script);
        });
        if (shown < 0 || gains.length !== DROP_CARDS) {
            console.error("[AP] Common events 16 and 17 have an unexpected layout, battle rewards are not offered");
            return;
        }
        start.splice(shown, 0, command(355, 0, ["LostChapterAP.rollDrop();"]));
        for (const item of gains) {
            item.parameters = ["LostChapterAP.takeDrop(" + /value\((\d)\)/.exec(item.parameters[0])[1] + ");"];
        }
    };

    const patchDeckSlots = () => {
        const list = $dataCommonEvents[COMMON_EVENT_DECK_DISPLAY].list;
        const button = list.findIndex(item => item.code === 357 && item.parameters[0] === "ButtonPicture");
        if (button >= 0) {
            list.splice(button, 0, command(355, list[button].indent, ["LostChapterAP.showEmptySlots();"]));
        }
    };

    const patchCheckpoint = () => {
        const list = $dataCommonEvents[COMMON_EVENT_STANDBY_START].list;
        const autosave = list.findIndex(item => item.code === 355 && String(item.parameters[0]).includes("requestAutosave"));
        if (autosave >= 0) {
            list.splice(autosave + 1, 0, command(355, list[autosave].indent, ["LostChapterAP.saveCheckpoint();"]));
        }
    };

    const patchStandbyTip = () => {
        const list = $dataCommonEvents[COMMON_EVENT_STANDBY_START].list;
        const isButton = item =>
            item.code === 357 && item.parameters[0] === "ButtonPicture" && Number(item.parameters[3].pictureId) === 100;
        const button = list.findIndex(isButton);
        const shown = button > 0 && list[button - 1].code === 231 && list[button - 1].parameters[0] === 100;
        const erased = list.findIndex((item, i) => i > button && item.code === 235 && item.parameters[0] === 100);
        if (!shown || erased < 0) {
            return;
        }
        let end = button;
        while (list[end + 1].code === 657) {
            end++;
        }
        const again = list
            .slice(button - 1, end + 1)
            .map(item => command(item.code, list[erased].indent, JSON.parse(JSON.stringify(item.parameters))));
        list.splice(erased + 1, 0, ...again);
    };

    // A floor event that rolls which of several cards it hands out (Debauch): while one of them is a check that is
    // still open, the roll does not land on one that was sent already.
    AP.rollOpenCard = (variableId, cards) => {
        const open = value => {
            const itemId = cards[value];
            return cardChecks().includes(itemId) && !state().checked.includes(CARD_OFFSET + itemId);
        };
        const values = Object.keys(cards).map(Number).filter(open);
        if (bound() && values.length > 0 && !open($gameVariables.value(variableId))) {
            $gameVariables.setValue(variableId, values[Math.floor(Math.random() * values.length)]);
        }
    };

    const patchCardRolls = () => {
        for (const eventId of allEvents()) {
            const list = eventData(eventId).list;
            for (let i = list.length - 1; i >= 0; i--) {
                const p = list[i].parameters;
                if (list[i].code !== 122 || p[0] !== p[1] || p[2] !== 0 || p[3] !== 2) {
                    continue;
                }
                // The branches on the rolled value that follow it, each handing out one card
                const cards = {};
                for (let j = i + 1; j < list.length && list[j].indent >= list[i].indent; j++) {
                    const q = list[j].parameters;
                    const gain = list[j + 1];
                    const asksRoll = list[j].code === 111 && q[0] === 1 && q[1] === p[0] && q[2] === 0 && q[4] === 0;
                    if (asksRoll && gain && gain.code === 126 && gain.parameters[1] === 0) {
                        cards[q[3]] = gain.parameters[0];
                    }
                }
                if (Object.keys(cards).length > 1) {
                    const script = "LostChapterAP.rollOpenCard(" + p[0] + ", " + JSON.stringify(cards) + ");";
                    list.splice(i + 1, 0, command(355, list[i].indent, [script]));
                }
            }
        }
    };

    // A floor event that hands out a card asks "has card n" the same way
    const patchCardConditions = () => {
        for (const eventId of allEvents()) {
            const list = eventData(eventId).list;
            const handedOut = CARD_ITEMS.filter(itemId =>
                list.some(item => item.code === 126 && item.parameters[0] === itemId && item.parameters[1] === 0)
            );
            if (eventId === COMMON_EVENT_CAT) {
                AP.catCards = handedOut;
            }
            for (const item of list) {
                const p = item.parameters;
                if (item.code === 111 && p[0] === 8 && handedOut.includes(p[1])) {
                    item.parameters = [12, "LostChapterAP.cardTaken(" + p[1] + ")"];
                }
            }
        }
    };

    // A floor event that hands out a relic asks "has relic n" to tell whether that already happened
    const patchRelicConditions = () => {
        for (const eventId of allEvents()) {
            const list = eventData(eventId).list;
            const handedOut = RELIC_WEAPONS.filter(weaponId =>
                list.some(item => item.code === 127 && item.parameters[0] === weaponId && item.parameters[1] === 0)
            );
            let patched = 0;
            for (const item of list) {
                const p = item.parameters;
                if (item.code !== 111 || p[0] !== 9 || !handedOut.includes(p[1])) {
                    continue;
                }
                // The Locksmith only asks this way before he makes a key: "unless you have the key already". His
                // other questions are about what is in the bag: the relics a key is made of, and the key he takes
                // back in a loop that runs until it is gone.
                const index = list.indexOf(item);
                const makesKey =
                    [WEAPON_WHITE_KEY, WEAPON_BLACK_KEY].includes(p[1]) &&
                    list[index + 1].code === 0 &&
                    list[index + 2].code === 411;
                if (eventId === COMMON_EVENT_LOCKSMITH && !makesKey) {
                    continue;
                }
                item.parameters = [12, "LostChapterAP.relicTaken(" + p[1] + ", " + !!p[2] + ")"];
                patched++;
            }
        }
    };

    // Pond: the game offers "Bathe in the Water" while there is nothing to wash off and hides it otherwise
    const patchPond = () => {
        const choices = $dataCommonEvents[COMMON_EVENT_POND].list.find(
            item => item.code === 102 && item.parameters[0].some(text => String(text).includes(POND_BATHE_HIDDEN))
        );
        if (!choices) {
            // The version of the game that comes with the DLC has this fixed
            return;
        }
        choices.parameters[0] = choices.parameters[0].map(text =>
            String(text).replace(POND_BATHE_HIDDEN, POND_BATHE_SHOWN)
        );
    };

    const _DataManager_onLoad = DataManager.onLoad;
    DataManager.onLoad = function(object) {
        _DataManager_onLoad.apply(this, arguments);
        if (!SESSION) {
            return;
        }
        if (object === $dataCommonEvents && !object._archipelagoPatched) {
            object._archipelagoPatched = true;
            mapEvents();
            patchNextFloor();
            patchKingDoors();
            patchTitleReleases();
            patchGirl();
            patchMarsh();
            patchMarket();
            patchConclusions();
            patchRevivals();
            patchStandbyVerse();
            patchStandbyTip();
            patchCheckpoint();
            patchDeckSlots();
            patchDrops();
            patchCardRolls();
            patchCardConditions();
            createCardEvent();
            patchRelicConditions();
            patchPond();
            patchFinisher();
            findScoreCommands();
        } else if (object === $dataMap) {
            patchMap(object);
        }
    };

    if (!OFFLINE) {
        connect();
    }
})();
