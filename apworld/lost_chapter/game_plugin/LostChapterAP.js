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
 *  - The bonus shop is skipped. Received starting sets are offered after the
 *    origin is confirmed.
 *  - Souls (the score the bonus shop used to spend) add up over all runs and
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
    const SESSION_FILE = "archipelago_session.json";
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
    const SWITCH_STANDBY_CONTROL = 89; // on while the standby screen takes input
    const VARIABLE_LP = 42;
    const VARIABLE_FLOOR = 11;
    const VARIABLE_FLOOR_EVENT = 12;
    const VARIABLE_ORIGIN = 2;
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
    const GOAL_TRUE_VIRGIN = 2;
    const GOAL_DLC_END = 3;
    const GOAL_DLC_VIRGIN = 4;
    const VIRGIN_GOALS = [GOAL_TRUE_VIRGIN, GOAL_DLC_VIRGIN];

    const COMMON_EVENT_NEXT_FLOOR = 86;
    const COMMON_EVENT_STANDBY = 11;
    const COMMON_EVENT_SCORE = 72;
    const COMMON_EVENT_TITLE_RELEASE = 400; // + title number
    const COMMON_EVENT_KING_BATTLE = 63;
    // Kick Balls: the turn start (common event 103) draws card 93 while the enemy is in its Refractory Period
    const COMMON_EVENT_TURN_START = 103;
    const CARD_FINISHER = 93;
    const STATE_REFRACTORY = 16;
    const ITEM_FINISHER = 10; // FINISHER_ID of apworld/lost_chapter/data.py
    const FINISHER_SHUFFLE = 1; // the finisher_move option
    const FINISHER_REMOVE = 2;
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
    // Floor event -> choice (as written in the event, without its condition and colors) -> what it takes.
    // Choices that already name a card they need, and the ones about FAITH, VIRTUE and LEWD, are not listed:
    // the latter are read from their condition.
    const CHOICE_REQUIREMENTS = {
        37: { "Water It": "Pretty Water" },
        38: { "Tell Her the Location of the Man's Grave": "Collapse first" },
        40: { "Pay -160 G": "MAG 15 or more" },
        54: { "Bathe in the Water": "filth to wash off", "Bathe in water": "filth to wash off" },
        56: { "I Came to See You": "an earlier visit" },
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
    };

    // The game calls common event 52 "Small Room" like common event 35, the apworld calls it "Small Room 2"
    const EVENT_ALIASES = { "small room 2": 52 };
    const CHOICE_MAX_ROWS = 5;
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
        101: ["Boxer Set", [11, 19, 32]],
        102: ["Fighter Set", [12, 20, 33]],
        103: ["Mage Set", [25, 34, 27]],
        104: ["Knight Set", [29, 29, 30]],
        105: ["Merchant Set", [35, 35, 36]],
        106: ["Succubus Set", [80, 80, 37]],
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

    // event id -> id of the common event that runs it, for the floor events this version of the game has
    const eventCommon = {};
    const mapEvents = () => {
        for (const commonEvent of $dataCommonEvents) {
            const id = commonEvent ? commonEvent.switchId : 0;
            if (commonEvent && commonEvent.trigger === 1 && EVENT_RANGES.some(range => id >= range[0] && id <= range[1])) {
                eventCommon[id] = commonEvent.id;
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
    // Filler: item id -> [parameter of the protagonist, amount]. Parameters 2-5 are STR, DEF, MAG and AGL.
    const STAT_ITEMS = { 20: [0, 5], 21: [1, 5], 22: [2, 1], 23: [4, 1], 24: [3, 1], 25: [5, 1] };
    // Traps: the Climax Trap empties RP, the others are a state (Confusion, Sticky Fluid, Paralysis, Torn Clothes)
    const ITEM_CLIMAX_TRAP = 30;
    const ITEM_ACID_TRAP = 34;
    const TRAP_STATES = { 31: 121, 32: 101, 33: 242, 34: 131 };
    const VARIABLE_TORN_CLOTHES = 208; // the standing picture and the Seamstress go by this, not by the state
    const SWITCH_IN_BATTLE = 101;

    // The cards floor events hand out. Which of them are checks comes with the slot data.
    const CARD_ITEMS = [39, 40, 60, 71, 74, 76, 77, 78, 79, 80];
    // What taking a received card into the deck costs in souls: 100 for Strip, 200 for the other lewd cards (Ride
    // Back, Encase, Taunt, Candylick, Ride On, Projection, Temptation), and for Faithful Dog Lassi and Shadow Cat
    // Assam what the game's score gives for holding them (111 and 222), which they do not add either.
    const CARD_COSTS = { 77: 100, 60: 200, 71: 200, 74: 200, 76: 200, 78: 200, 79: 200, 80: 200, 40: 111, 39: 222 };
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
    const DECK_LIMIT = 30;
    const CARD_BUTTON_X = 930;
    const CARD_BUTTON_Y = 560;
    const CARD_BUTTON_WIDTH = 345;
    const CARD_BUTTON_HEIGHT = 36;
    const CARD_BUTTON_KEY = "pageup"; // Q and Page Up
    // The Archipelago icon, 48x48
    const AP_ICON = "data:image/png;base64,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";
    // The milestones come with the slot data. Seeds from before that have these.
    const LEGACY_SOUL_MILESTONES = [50, 100, 200, 500, 1000, 2000];
    const SOUL_UPDATE_FRAMES = 30;

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

    if (SESSION) {
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
                souls: 0, // banked from finished runs
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

        socket.onopen = () => send({ cmd: "Hello", version: VERSION, session: SESSION ? SESSION.save : null });
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
            bindSave();
        } else if (message.cmd === "Items") {
            AP.items = message.items;
        } else if (message.cmd === "Scouts") {
            AP.scouts = message.locations;
        } else if (message.cmd === "Speed") {
            setSpeed(message.speed);
        } else if (message.cmd === "Dev") {
            send({ cmd: "DevResult", text: AP.dev(message.args) });
        }
    };

    // Ties the loaded save to the connected seed and reports what it already has
    const bindSave = () => {
        const s = state();
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

    const lastBossDefeated = () => {
        const goals = [GOAL_NORMAL_END];
        // The ending map plays the TRUE END below this climax count
        if ($gameVariables.value(VARIABLE_CLIMAX_COUNT) < TRUE_END_CLIMAX_LIMIT) {
            goals.push(GOAL_TRUE_END);
            if (isVirgin()) {
                goals.push(GOAL_TRUE_VIRGIN);
            }
        }
        reachGoals(goals);
    };

    const dlcLastBossDefeated = () => {
        reachGoals(isVirgin() ? [GOAL_DLC_END, GOAL_DLC_VIRGIN] : [GOAL_DLC_END]);
    };

    const checkTitle = title => check(SWITCH_OFFSET + TITLE_SWITCH_BASE + title);

    // Virgin goals: losing the Virginity state ends the run the way running out of LP does. The fight is lost, or
    // the event plays out and the game over follows on the way to the next floor.
    const _Game_Battler_removeState = Game_Battler.prototype.removeState;
    Game_Battler.prototype.removeState = function(stateId) {
        const lost = stateId === STATE_VIRGINITY && this.isStateAffected(stateId) && this === $gameActors.actor(1);
        _Game_Battler_removeState.apply(this, arguments);
        if (lost && bound() && VIRGIN_GOALS.includes(option("goal")) && $gameVariables.value(VARIABLE_FLOOR) >= 1) {
            checkTitle(TITLE_LOSE_VIRGINITY);
            notify("Virginity lost, this run is over");
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

    const _Game_Switches_setValue = Game_Switches.prototype.setValue;
    Game_Switches.prototype.setValue = function(switchId, value) {
        const wasOn = this.value(switchId);
        _Game_Switches_setValue.apply(this, arguments);
        if (value && (KING_SWITCHES.includes(switchId) || DLC_BOSS_SWITCHES.includes(switchId))) {
            check(SWITCH_OFFSET + switchId);
        } else if (!value && wasOn && eventCommon[switchId]) {
            // A floor event runs while its switch is on and ends in the standby screen, which turns it off. The
            // first visit is only sent then, when the player has seen which event it was.
            check(SWITCH_OFFSET + switchId);
        }
    };

    const _Game_Variables_setValue = Game_Variables.prototype.setValue;
    Game_Variables.prototype.setValue = function(variableId, value) {
        _Game_Variables_setValue.apply(this, arguments);
        if (variableId !== VARIABLE_FLOOR) {
            return;
        }
        const s = state();
        if (value === 0 && s) {
            // "---Game Initialization---" strips every relic at the start of a run
            s.regrant = true;
            s.claimed = [];
            s.souls += s.runSouls;
            s.runSouls = 0;
            s.runBase = null;
        }
        checkFloor(value);
        send({ cmd: "Status", floor: value });
    };

    const _BattleManager_processVictory = BattleManager.processVictory;
    BattleManager.processVictory = function() {
        const troopId = $gameTroop._troopId;
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
    const STAT_PHRASES = {
        ">=": value => value + " or more",
        ">": value => "over " + value,
        "<=": value => value + " or less",
        "<": value => "under " + value,
    };

    // "LEWD 10 or more" for a condition like v[51]>=10, null when it is about anything else
    const statRequirement = condition => {
        const parts = [];
        const rest = condition.replace(/v\[(\d+)\]\s*(>=|<=|>|<)\s*(\d+)/g, (match, variableId, comparison, value) => {
            if (!STAT_VARIABLES[variableId]) {
                return match;
            }
            parts.push(STAT_VARIABLES[variableId] + " " + STAT_PHRASES[comparison](value));
            return "";
        });
        return parts.length > 0 && !/[^\s&]/.test(rest) ? parts.join(", ") : null;
    };

    const stripConditions = text => text.replace(CHOICE_SHOWN, "").replace(CHOICE_ENABLED, "");

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
        const requirement = (CHOICE_REQUIREMENTS[eventId] || {})[key] || statRequirement(failed[1]);
        return requirement ? stripConditions(text) + " \\c[18]requires " + requirement + "\\c[0]en(0)" : text;
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
                if (named.includes(FINAL_BOSS_LOCK) && !$gameSwitches.value(SWITCH_FINAL_BOSS)) {
                    return named.replace(FINAL_BOSS_LOCK, " \\c[18]requires floor " + finalBossFloor() + "\\c[0]en(0)");
                }
                return eventId ? lockedChoice(this, eventId, String(text), named) : named;
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

    // Souls spent on cards are gone, the milestones they reached before stay checked
    const soulTotal = () => state().souls + state().runSouls - (state().spent || 0);

    const soulMilestones = () => option("soul_milestones") || LEGACY_SOUL_MILESTONES;

    const updateSouls = () => {
        const s = state();
        const score = $gameVariables.value(VARIABLE_FLOOR) >= 1 ? runScore() : null;
        if (score !== null && s.runBase != null) {
            s.runSouls = Math.max(s.runSouls, (score - s.runBase) * (option("soul_multiplier") || 1));
        }
        for (const milestone of soulMilestones()) {
            if (soulTotal() >= milestone && !s.checked.includes(SOUL_OFFSET + milestone)) {
                check(SOUL_OFFSET + milestone);
            }
        }
    };

    const soulText = () => {
        if (!bound()) {
            return "";
        }
        const next = soulMilestones().find(milestone => milestone > soulTotal());
        return "Souls " + soulTotal() + (next ? " / " + next : "");
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
        this._archipelagoSouls = createLabel(this, Graphics.width - 336, 76, 320, "right");
        this._archipelagoStatus = createLabel(this, 16, Graphics.height - 44, 720, "left");
        this._archipelagoNotice = createLabel(this, (Graphics.width - NOTICE_WIDTH) / 2, 8, NOTICE_WIDTH, "center");
        this._archipelagoCards = createCardButton(this);
    };

    const updateSoulCounter = scene => {
        updateLabel(scene._archipelagoSouls, bound() && $gameSwitches.value(SWITCH_STANDBY_CONTROL), soulText());
    };

    // [text, color] for the title screen
    const connectionStatus = () => {
        if (!SESSION) {
            return ["Archipelago: off (normal game, normal save)", "#b0b0b0"];
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
        const before = s.runBase != null ? runScore() : null;
        give();
        const after = before !== null ? runScore() : null;
        if (after !== null) {
            s.runBase += after - before;
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
        } else if (GOLD_ITEMS[item.id]) {
            $gameParty.gainGold(GOLD_ITEMS[item.id]);
        } else if (STAT_ITEMS[item.id]) {
            $gameActors.actor(1).addParam(STAT_ITEMS[item.id][0], STAT_ITEMS[item.id][1]);
        } else if (item.id === ITEM_CLIMAX_TRAP || TRAP_STATES[item.id]) {
            s.traps = (s.traps || []).concat([item.id]);
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
        if (bound() && !$gameSwitches.value(SWITCH_CLEARED)) {
            // With the game cleared, common event 64 continues the climb after the last boss
            _Game_Switches_setValue.call($gameSwitches, SWITCH_CLEARED, true);
        }
        if (!active() || $gameParty.inBattle()) {
            return;
        }
        const s = state();
        if (s.regrant && $gameVariables.value(VARIABLE_FLOOR) >= 1) {
            s.regrant = false;
            s.relics.forEach(grantRelic);
        }
        // Every run starts at 0 souls: what the origin, the starting set and the relics from the multiworld are worth
        // in the score is taken off. The DLC's origin alone would start a run at 115.
        if (s.runBase == null && $gameVariables.value(VARIABLE_FLOOR) >= 1) {
            s.runBase = runScore();
        }
        while (s.itemIndex < AP.items.length) {
            const item = AP.items[s.itemIndex];
            // A stat boost only lasts for the run it arrives in, so it waits for one
            if (STAT_ITEMS[item.id] && $gameVariables.value(VARIABLE_FLOOR) < 1) {
                break;
            }
            withoutSouls(() => applyItem(item));
            s.itemIndex++;
        }
    };

    // A trap goes off in a fight: the one that is on, or the next
    const applyTraps = () => {
        const s = bound() ? state() : null;
        const actor = $gameActors ? $gameActors.actor(1) : null;
        if (!s || !s.traps || s.traps.length === 0 || !actor || actor.isDead()) {
            return;
        }
        if (!$gameSwitches.value(SWITCH_IN_BATTLE)) {
            return;
        }
        const trap = s.traps.shift();
        if (trap === ITEM_CLIMAX_TRAP) {
            actor.setMp(0);
        } else {
            actor.addState(TRAP_STATES[trap]);
        }
        if (trap === ITEM_ACID_TRAP && $gameVariables.value(VARIABLE_TORN_CLOTHES) < 1) {
            $gameVariables.setValue(VARIABLE_TORN_CLOTHES, 1);
        }
    };

    const _Scene_Battle_update = Scene_Battle.prototype.update;
    Scene_Battle.prototype.update = function() {
        _Scene_Battle_update.apply(this, arguments);
        applyTraps();
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

    // Runs in the common event the button of the deck screen starts: the list of the received cards
    AP.offerCards = interpreter => {
        const cards = bound() ? waitingCards() : [];
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
        const label = card => $dataItems[card.id].name + (cardCost(card) ? " (" + cardCost(card) + " souls)" : "");
        $gameMessage.add("Which card from the multiworld do you look at? Each can be taken once a run.");
        $gameMessage.add("You have " + soulTotal() + " souls.");
        $gameMessage.setChoices(cards.map(label).concat(["Not Now"]), 0, cards.length);
        $gameMessage.setChoiceBackground(0);
        $gameMessage.setChoicePositionType(2);
        limitChoiceRows();
        $gameMessage.setChoiceCallback(index => {
            AP.cardPreview = index < cards.length ? cards[index] : null;
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
        const cost = cardCost(card);
        const affordable = soulTotal() >= cost;
        const y = CARD_PREVIEW_Y;
        $gameScreen.showPicture(PICTURE_CARD_PREVIEW, String(card.id), 1, CARD_PREVIEW_X, y, 100, 100, 255, 0);
        $gameScreen.showPicture(PICTURE_CARD_DESCRIPTION, card.id + "s", 1, CARD_DESCRIPTION_X, y, 100, 100, 255, 0);
        $gameMessage.add($dataItems[card.id].name + (cost ? ": " + cost + " souls, you have " + soulTotal() + "." : ""));
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
            s.spent = (s.spent || 0) + cost;
            s.claimed = (s.claimed || []).concat([card.index]);
            AP.granting = true;
            withoutSouls(() => $gameParty.gainItem($dataItems[card.id], 1));
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
        if (!$gameMessage.isBusy() && $gameVariables.value(VARIABLE_SCREEN) === SCREEN_DECK && waitingCards().length > 0) {
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
        const count = waitingCards().length;
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
            bitmap.drawText(":  " + count + " Pcs.  [Q]", size + 166, 0, 170, CARD_BUTTON_HEIGHT, "left");
        }
    };

    const _Scene_Map_update = Scene_Map.prototype.update;
    Scene_Map.prototype.update = function() {
        _Scene_Map_update.apply(this, arguments);
        updateItems();
        if (bound() && Graphics.frameCount % SOUL_UPDATE_FRAMES === 0) {
            updateSouls();
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
    const freeDoors = () => bound() && ($gameVariables.value(VARIABLE_FLOOR) >= FREE_DOORS_FLOOR || kingsDefeated());

    // The "Final Boss" door choice only opens from this floor on (final_boss_floor option)
    const finalBossFloor = () => option("final_boss_floor") || FREE_DOORS_FLOOR;

    const doorOpen = kingSwitch => {
        const defeated = $gameSwitches.value(kingSwitch);
        if (!bound()) {
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
        mirrorSwitch(SWITCH_TURN_BACK, bound() && !freeDoors());
        mirrorSwitch(SWITCH_FREE_DOORS, freeDoors());
        mirrorSwitch(SWITCH_FINAL_BOSS, $gameVariables.value(VARIABLE_FLOOR) >= finalBossFloor());
        const hasKey = weaponId => !bound() || $gameParty.hasItem($dataWeapons[weaponId], false);
        mirrorSwitch(SWITCH_WHITE_DOOR, hasKey(WEAPON_WHITE_KEY));
        mirrorSwitch(SWITCH_BLACK_DOOR, hasKey(WEAPON_BLACK_KEY));
        mirrorSwitch(SWITCH_LAST_DOOR, bound() && DLC_BOSS_SWITCHES.every(switchId => $gameSwitches.value(switchId)));
    };

    // Switch of the boss scene `floor` leads to, 0 when it is an ordinary floor
    const bossFloorSwitch = floor => {
        if (floor % BOSS_FLOOR_INTERVAL !== 0) {
            return 0;
        }
        if (!bound() && kingsDefeated()) {
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
    const blockCondition = (p, scratch) => {
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
            case 9:
                return $gameParty.hasItem($dataWeapons[p[1]], p[2]);
            default:
                return null;
        }
    };

    // True when the block ends in the jump that rolls again. Switches it sets are its own scratch values.
    const rerolls = block => {
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
                const result = blockCondition(p, scratch);
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
        return !rerollBlocks[eventId] || !rerolls(rerollBlocks[eventId]);
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

    const startFloorEvent = switchId => {
        if (switchId !== SWITCH_FIGHT) {
            $gameVariables.setValue(VARIABLE_FLOOR_EVENT, switchId);
        }
        $gameSwitches.setValue(switchId, true);
    };

    // Asks what `floor` holds and hands the switch id to `callback`. False when there is nothing to choose from.
    const offerFloorEvents = (interpreter, floor, callback) => {
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
        const offered = [];
        while (offered.length < FLOOR_EVENT_CHOICES && pool.length > 0) {
            const eventId = pool.splice(Math.randomInt(pool.length), 1)[0];
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
        const switchIds = [SWITCH_FIGHT].concat(offered);
        const names = ["Battle"].concat(offered.map(eventName));
        $gameMessage.setChoices(names, 0, -1);
        if (canGray) {
            $gameMessage.setChoiceEnables([true].concat(offered.map(unlocked)));
        }
        $gameMessage.setChoiceBackground(0);
        $gameMessage.setChoicePositionType(2);
        $gameMessage.setChoiceCallback(index => callback(switchIds[index]));
        interpreter.setWaitMode("message");
        return true;
    };

    // Runs at the start of common event 86, while the standby screen is still shown
    AP.prepareFloorEvent = interpreter => {
        AP.chosenFloorEvent = 0;
        // Without LP left the game over follows instead of a floor
        if (!bound() || AP.nextFloorEvent || $gameVariables.value(VARIABLE_LP) <= 0) {
            return;
        }
        const floor = $gameVariables.value(VARIABLE_FLOOR) + (state().holdFloor ? 0 : 1);
        if (bossFloorSwitch(floor)) {
            return;
        }
        const offered = offerFloorEvents(interpreter, floor, switchId => (AP.chosenFloorEvent = switchId));
        if (!offered) {
            // Nothing to roll from. Settled here, so the floor is not rolled a second time after the screen went dark
            AP.chosenFloorEvent = SWITCH_FIGHT;
        } else if ($gameMessage.setChoicePos) {
            // Below the lines of the standby screen instead of over them
            $gameMessage.setChoicePos(-1, STANDBY_CHOICE_Y, CHOICE_MAX_ROWS);
        }
    };

    // Replaces the fight / random event roll of common event 86
    AP.chooseFloorEvent = interpreter => {
        const forced = AP.nextFloorEvent || AP.chosenFloorEvent;
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

    // Guards the "has armor n" branch of the title release events (common events 401-416)
    AP.titleLocked = title => {
        if (!titleEffectMissing(title)) {
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
        if (pictureId !== TITLE_TEXT_PICTURE || !picture || !picture.mzkp_text) {
            return;
        }
        if ($gameVariables.value(VARIABLE_SCREEN) === SCREEN_TITLES && titleEffectMissing(title)) {
            picture.mzkp_text +=
                "\n\\c[18]Unlock Title Effect: " + TITLE_NAMES[title - 1] + " required to activate this bonus";
            picture.mzkp_textChanged = true;
        }
    };

    // Replaces the first floor advance of a run: wait on the standby screen at floor 1
    AP.startRun = () => {
        state().holdFloor = true;
        $gameVariables.setValue(VARIABLE_FLOOR, 1);
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
    const limitChoiceRows = () => {
        if ($gameMessage.setChoicePos) {
            $gameMessage.setChoicePos(-1, -1, CHOICE_MAX_ROWS);
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

    // Runs once the origin is confirmed
    AP.chooseStartingSet = interpreter => {
        if (!bound()) {
            return;
        }
        const owned = state().sets.filter(setId => STARTING_SETS[setId]).sort((a, b) => a - b);
        if (owned.length === 0) {
            return;
        }
        const cardNames = setId => STARTING_SETS[setId][1].map(itemId => "\u3010" + $dataItems[itemId].name + "\u3011");
        const names = owned.map(setId => "[" + STARTING_SETS[setId][0] + "] " + cardNames(setId).join(""));
        $gameMessage.setBackground(2);
        $gameMessage.setPositionType(1);
        $gameMessage.add("You carry......");
        $gameMessage.setChoices(names.concat("Nothing"), 0, -1);
        $gameMessage.setChoiceBackground(0);
        $gameMessage.setChoicePositionType(1);
        limitChoiceRows();
        $gameMessage.setChoiceCallback(index => {
            if (index < owned.length) {
                STARTING_SETS[owned[index]][1].forEach(itemId => $gameParty.gainItem($dataItems[itemId], 1));
            }
        });
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
        "heal - restore LP and RP",
        "stat " + DEV_PARAMS.join("|") + "|lewd N - set a stat",
        "card NAME [COUNT] / relic NAME [COUNT] - give (negative COUNT takes away)",
        "title N - meet the condition of title N",
        "unlock - own every event, boss, title effect and starting set unlock",
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
            return handler(words.slice(1));
        } catch (error) {
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
    const overrideRange = (list, start, end, replacement) => {
        const indent = list[start].indent;
        const original = list.slice(start, end + 1);
        original.forEach(originalCommand => originalCommand.indent++);
        replacement.forEach(newCommand => (newCommand.indent += indent + 1));
        list.splice(
            start,
            original.length,
            command(111, indent, [12, "!LostChapterAP.bound()"]),
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
            list.splice(standbyEnd, 0, command(355, 0, ["LostChapterAP.prepareFloorEvent(this);"]));
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
                overrideRange(list, i, i, [
                    command(355, 0, ["LostChapterAP.startRun();"]),
                    command(117, 0, [COMMON_EVENT_STANDBY]),
                ]);
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
        overrideRange(list, question - 1, revealStart - 1, [command(355, 0, ["LostChapterAP.chooseOrigin(this);"])]);
    };

    // Map001: the branch of the "Correct" choice that applies the origin
    const patchStartingSet = list => {
        const correct = list.findIndex(item => item.code === 402 && item.parameters[1] === "Correct");
        if (correct >= 0 && list.some(item => item.code === 401 && String(item.parameters[0]).startsWith("That's right"))) {
            list.splice(correct + 1, 0, command(355, list[correct].indent + 1, ["LostChapterAP.chooseStartingSet(this);"]));
        }
    };

    // Map003: a new run goes to the bonus shop (Map008) from the second playthrough on
    const patchBonusShop = list => {
        for (const item of list) {
            const p = item.parameters;
            if (item.code === 111 && p[0] === 1 && p[1] === VARIABLE_PLAYTHROUGH && p[3] === 2 && p[4] === 1) {
                item.parameters = [12, "!LostChapterAP.bound() && $gameVariables.value(" + VARIABLE_PLAYTHROUGH + ") >= 2"];
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
            patchStartingSet(list);
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
        return mode === FINISHER_REMOVE ? false : mode === FINISHER_SHUFFLE ? !!state().finisher : true;
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

    // A floor event that hands out a card asks "has card n" the same way
    const patchCardConditions = () => {
        for (const eventId of allEvents()) {
            const list = eventData(eventId).list;
            const handedOut = CARD_ITEMS.filter(itemId =>
                list.some(item => item.code === 126 && item.parameters[0] === itemId && item.parameters[1] === 0)
            );
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

    connect();
})();
