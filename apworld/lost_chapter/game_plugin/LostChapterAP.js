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
 * Game changes while a save is bound to a multiworld:
 *  - Every floor is a fight until floor events are unlocked. With unlocked
 *    events the player picks between a fight and up to two of them.
 *  - A Heavenly King can only be challenged with his boss unlock. A boss floor
 *    without an available king is played as a normal floor.
 *  - Relics handed out by events become checks (relicsanity).
 *  - Meeting the condition of a title is a check. Releasing the title in the
 *    Title Collection also needs its title effect item.
 *  - A run starts on the standby screen instead of inside the first event.
 *  - The "Once upon a time" questions are replaced by a list of the origins.
 */

(() => {
    "use strict";

    const PLUGIN_NAME = "LostChapterAP";
    const VERSION = "0.3.0";
    const PORT = Number(PluginManager.parameters(PLUGIN_NAME).port || 38472);
    const RECONNECT_MS = 3000;

    // Keep in sync with apworld/lost_chapter/data.py
    const SWITCH_OFFSET = 1000;
    const TROOP_OFFSET = 2000;
    const RELIC_OFFSET = 3000;
    const FLOOR_OFFSET = 4000;
    const EVENT_OFFSET = 5000;
    const BOSS_OFFSET = 6000;
    const TITLE_OFFSET = 7000;

    const SWITCH_ENDING = 1;
    const SWITCH_TRUE_ENDING = 200;
    const SWITCH_BEFORE_BOSS = 62;
    const SWITCH_LAST_BOSS = 64;
    const SWITCH_FIGHT = 65;
    const VARIABLE_FLOOR = 11;
    const VARIABLE_FLOOR_EVENT = 12;
    const VARIABLE_ORIGIN = 2;

    const COMMON_EVENT_NEXT_FLOOR = 86;
    const COMMON_EVENT_STANDBY = 11;
    const COMMON_EVENT_TITLE_RELEASE = 400; // + title number
    const COMMON_EVENT_KING_BATTLE = 63;
    const LABEL_END = "終了";

    const KING_SWITCHES = [71, 72, 73, 74];
    // Unused game switches mirroring the boss unlocks, read by the door choices of common event 63
    const KING_UNLOCK_SWITCH_SHIFT = 190; // 71-74 -> 261-264

    const EVENT_MIN = 21;
    const EVENT_MAX = 60;
    const EVENT_PRISON = 61; // not shuffled, the game offers it after the first clear
    const FLOOR_EVENT_CHOICES = 2;

    const TITLE_COUNT = 16; // title n is held as armor n once its condition is met
    const TITLE_SWITCH_BASE = 200;

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

    const CHECK_SWITCHES = KING_SWITCHES.slice();
    for (let eventId = EVENT_MIN; eventId <= EVENT_MAX; eventId++) {
        CHECK_SWITCHES.push(eventId);
    }
    const CHECK_TROOP_MAX = 21;
    const CHECK_FLOORS = [10, 20, 30, 40, 50, 60, 70, 80];
    const RELIC_WEAPONS = [29, 30, 33, 34, 36, 38, 42, 51, 58, 59];
    const GOLD_ITEMS = { 1: 100, 2: 300 };

    const AP = {
        socket: null,
        slot: null, // last "Slot" message while a slot is connected
        items: [], // full received item list from the client
        granting: false,
    };
    window.LostChapterAP = AP;

    //-------------------------------------------------------------------------
    // Persistent state (lives in the save file)

    const state = () => {
        if (!$gameSystem) {
            return null;
        }
        if (!$gameSystem._archipelago) {
            $gameSystem._archipelago = {
                seed: null,
                options: {},
                checked: [],
                itemIndex: 0,
                relics: [],
                events: [],
                bosses: [],
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
        return !!(s && s.seed !== null);
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

        socket.onopen = () => send({ cmd: "Hello", version: VERSION });
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
            AP.items = [];
            bindSave();
        } else if (message.cmd === "Items") {
            AP.items = message.items;
        }
    };

    // Ties the loaded save to the connected seed and reports what it already has
    const bindSave = () => {
        const s = state();
        if (!AP.slot || !s) {
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

    const sendGoal = () => {
        if (!active()) {
            return;
        }
        if ($gameSwitches.value(SWITCH_TRUE_ENDING)) {
            send({ cmd: "Goal", kind: "true_ending" });
        } else if ($gameSwitches.value(SWITCH_ENDING)) {
            send({ cmd: "Goal", kind: "ending" });
        }
    };

    const checkTitle = title => check(SWITCH_OFFSET + TITLE_SWITCH_BASE + title);

    // Picks up everything the save already achieved
    const scanState = () => {
        for (let title = 1; title <= TITLE_COUNT; title++) {
            if ($gameParty.hasItem($dataArmors[title], true) || $gameSwitches.value(TITLE_SWITCH_BASE + title)) {
                checkTitle(title);
            }
        }
        for (const switchId of CHECK_SWITCHES) {
            if ($gameSwitches.value(switchId)) {
                check(SWITCH_OFFSET + switchId);
            }
        }
        checkFloor($gameVariables.value(VARIABLE_FLOOR));
        sendGoal();
    };

    const _Game_Switches_setValue = Game_Switches.prototype.setValue;
    Game_Switches.prototype.setValue = function(switchId, value) {
        _Game_Switches_setValue.apply(this, arguments);
        if (!value) {
            return;
        }
        if (CHECK_SWITCHES.includes(switchId)) {
            check(SWITCH_OFFSET + switchId);
        } else if (switchId === SWITCH_ENDING || switchId === SWITCH_TRUE_ENDING) {
            sendGoal();
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
        }
        checkFloor(value);
        send({ cmd: "Status", floor: value });
    };

    const _BattleManager_processVictory = BattleManager.processVictory;
    BattleManager.processVictory = function() {
        const troopId = $gameTroop._troopId;
        if (troopId >= 1 && troopId <= CHECK_TROOP_MAX) {
            check(TROOP_OFFSET + troopId);
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
        if (isRelicGain && !AP.granting && option("relicsanity")) {
            check(RELIC_OFFSET + item.id);
            return;
        }
        _Game_Party_gainItem.apply(this, arguments);
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

    const applyItem = item => {
        const s = state();
        if (item.id >= TITLE_OFFSET) {
            remember(s.titles, item.id - TITLE_OFFSET);
        } else if (item.id >= BOSS_OFFSET) {
            remember(s.bosses, item.id - BOSS_OFFSET);
        } else if (item.id >= EVENT_OFFSET) {
            remember(s.events, item.id - EVENT_OFFSET);
        } else if (item.id >= RELIC_OFFSET) {
            remember(s.relics, item.id - RELIC_OFFSET);
            grantRelic(item.id - RELIC_OFFSET);
        } else if (GOLD_ITEMS[item.id]) {
            $gameParty.gainGold(GOLD_ITEMS[item.id]);
        }
        console.log("[AP] Received " + item.name + " from " + item.sender);
    };

    const updateItems = () => {
        syncKingUnlockSwitches();
        if (!active() || $gameParty.inBattle()) {
            return;
        }
        const s = state();
        if (s.regrant && $gameVariables.value(VARIABLE_FLOOR) >= 1) {
            s.regrant = false;
            s.relics.forEach(grantRelic);
        }
        while (s.itemIndex < AP.items.length) {
            applyItem(AP.items[s.itemIndex]);
            s.itemIndex++;
        }
    };

    const _Scene_Map_update = Scene_Map.prototype.update;
    Scene_Map.prototype.update = function() {
        _Scene_Map_update.apply(this, arguments);
        updateItems();
    };

    // A save was loaded or a new game started
    const _Scene_Map_start = Scene_Map.prototype.start;
    Scene_Map.prototype.start = function() {
        _Scene_Map_start.apply(this, arguments);
        bindSave();
    };

    //-------------------------------------------------------------------------
    // Floor flow (called from the patched common events)

    const kingUnlocked = kingSwitch => !bound() || state().bosses.includes(kingSwitch);

    const syncKingUnlockSwitches = () => {
        for (const kingSwitch of KING_SWITCHES) {
            const unlockSwitch = kingSwitch + KING_UNLOCK_SWITCH_SHIFT;
            if ($gameSwitches.value(unlockSwitch) !== kingUnlocked(kingSwitch)) {
                _Game_Switches_setValue.call($gameSwitches, unlockSwitch, kingUnlocked(kingSwitch));
            }
        }
    };

    // Replaces the boss floor branch of common event 86. True when this floor is a boss floor.
    AP.bossFloor = () => {
        syncKingUnlockSwitches();
        if ($gameVariables.value(VARIABLE_FLOOR) % 20 !== 0) {
            return false;
        }
        if (KING_SWITCHES.every(kingSwitch => $gameSwitches.value(kingSwitch))) {
            $gameSwitches.setValue(SWITCH_LAST_BOSS, true);
            return true;
        }
        if (KING_SWITCHES.some(kingSwitch => !$gameSwitches.value(kingSwitch) && kingUnlocked(kingSwitch))) {
            $gameSwitches.setValue(SWITCH_BEFORE_BOSS, true);
            return true;
        }
        return false;
    };

    const hasWeapons = weaponIds => weaponIds.every(weaponId => $gameParty.hasItem($dataWeapons[weaponId]));

    // The game's own conditions for offering an event (common event 86)
    const eventAvailable = eventId => {
        if (eventId > 56 && $gameVariables.value(VARIABLE_FLOOR) <= 40) {
            return false;
        }
        switch (eventId) {
            case 46: // Seamstress
                return $gameVariables.value(208) !== 0;
            case 52: // Small Room 2
                return $gameActors.actor(1).isStateAffected(4);
            case 57: // Locksmith
                return hasWeapons([34, 29, 41]) || hasWeapons([33, 36, 38]);
            case EVENT_PRISON:
                return $gameSwitches.value(SWITCH_ENDING);
            default:
                return true;
        }
    };

    const startFloorEvent = switchId => {
        if (switchId !== SWITCH_FIGHT) {
            $gameVariables.setValue(VARIABLE_FLOOR_EVENT, switchId);
        }
        $gameSwitches.setValue(switchId, true);
    };

    // Replaces the fight / random event roll of common event 86
    AP.chooseFloorEvent = interpreter => {
        const pool = state().events.concat(EVENT_PRISON).filter(eventAvailable);
        const offered = [];
        while (offered.length < FLOOR_EVENT_CHOICES && pool.length > 0) {
            offered.push(pool.splice(Math.randomInt(pool.length), 1)[0]);
        }
        if (offered.length === 0) {
            startFloorEvent(SWITCH_FIGHT);
            return;
        }
        const switchIds = [SWITCH_FIGHT].concat(offered);
        const names = ["Battle"].concat(offered.map(eventId => $dataCommonEvents[eventId].name));
        $gameMessage.setChoices(names, 0, -1);
        $gameMessage.setChoiceBackground(0);
        $gameMessage.setChoicePositionType(2);
        $gameMessage.setChoiceCallback(index => startFloorEvent(switchIds[index]));
        interpreter.setWaitMode("message");
    };

    // Replaces the "has armor n" condition of the title release events (common events 401-416)
    AP.titleCondition = title => {
        if (!$gameParty.hasItem($dataArmors[title], false)) {
            return false;
        }
        if (bound() && !state().titles.includes(title)) {
            if (!$gameSwitches.value(TITLE_SWITCH_BASE + title)) {
                SoundManager.playBuzzer();
            }
            return false;
        }
        return true;
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

    // Replaces the "Once upon a time" questions of the opening
    AP.chooseOrigin = interpreter => {
        $gameMessage.setBackground(2);
        $gameMessage.setPositionType(1);
        $gameMessage.add("You are a......");
        $gameMessage.setChoices(ORIGINS.map(origin => origin[1]), 0, -1);
        $gameMessage.setChoiceBackground(0);
        $gameMessage.setChoicePositionType(1);
        $gameMessage.setChoiceCallback(index => $gameVariables.setValue(VARIABLE_ORIGIN, ORIGINS[index][0]));
        interpreter.setWaitMode("message");
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
        // Later branch first, so the earlier index stays valid
        overrideBranch(list, eventBranch, "LostChapterAP.chooseFloorEvent(this);");
        overrideBranch(
            list,
            bossBranch,
            "if (LostChapterAP.bossFloor()) { this.command119(['" + LABEL_END + "']); }"
        );
        list[increment] = command(355, list[increment].indent, ["LostChapterAP.advanceFloor();"]);
    };

    const patchTitleReleases = () => {
        for (let title = 1; title <= TITLE_COUNT; title++) {
            const condition = $dataCommonEvents[COMMON_EVENT_TITLE_RELEASE + title].list[0];
            if (condition.code !== 111 || condition.parameters[0] !== 10 || condition.parameters[1] !== title) {
                console.error("[AP] Common event " + (400 + title) + " has an unexpected layout, title is not patched");
                continue;
            }
            condition.parameters = [12, "LostChapterAP.titleCondition(" + title + ")"];
        }
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
        const reveal = list.findIndex((item, i) => i > question && item.indent === 0 && isMessage(item, "That's right"));
        if (reveal < 0 || list[question - 1].code !== 101 || list[reveal - 1].code !== 101) {
            console.error("[AP] The opening has an unexpected layout, the origin list is not patched");
            return;
        }
        overrideRange(list, question - 1, reveal - 2, [command(355, 0, ["LostChapterAP.chooseOrigin(this);"])]);
    };

    const patchMap = map => {
        if (map._archipelagoPatched) {
            return;
        }
        map._archipelagoPatched = true;
        for (const list of eventLists(map)) {
            patchRunStart(list);
            patchOrigin(list);
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
            const unlockSwitch = kingSwitch + KING_UNLOCK_SWITCH_SHIFT;
            return text.replace("(!s[" + kingSwitch + "]", "(s[" + unlockSwitch + "]&&!s[" + kingSwitch + "]");
        });
    };

    const _DataManager_onLoad = DataManager.onLoad;
    DataManager.onLoad = function(object) {
        _DataManager_onLoad.apply(this, arguments);
        if (object === $dataCommonEvents) {
            patchNextFloor();
            patchKingDoors();
            patchTitleReleases();
        } else if (object === $dataMap) {
            patchMap(object);
        }
    };

    connect();
})();
