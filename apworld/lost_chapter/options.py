from dataclasses import dataclass

from Options import Choice, DeathLink, DefaultOnToggle, OptionSet, PerGameCommonOptions, Range, Toggle

from . import data


class Goal(Choice):
    """
    What counts as completing the game.

    The game counts as cleared from the start, so the climb continues after the last boss. With one of the two
    Ending goals, his introduction and scripted phases still play until he is defeated once.

    Ending Normal: defeat the last boss, or free the Monster and leave this world at the Sea. The climax count does
    not matter (over 20 it would be ENDING 2 "Deeper Into the Darkness").
    Ending True: the same with a climax count of 20 or less (ENDING 1 "Beyond the Blue Sky").
    DLC Normal: defeat Magislilia past the White Door and the Black Door, whichever ending follows (the other one
    is ENDING 4 "Dark and deep bottom of darkness"). Needs Include DLC.
    DLC True: defeat her in a run that gets ENDING 3 "Lost Chapter". That takes one of LEWD 20 or less, VIRTUE 70 or
    more, the Monster freed at the Sea, or the White Key used in the Corridor, and not the Footsteps of the Night
    route of the origin The New Ruler. Needs Include DLC.

    The standby screen and the tracker say where a run stands for the two True goals.
    """
    display_name = "Goal"
    option_ending_normal = 0
    option_ending_true = 1
    option_dlc_normal = 3
    option_dlc_true = 4
    default = 0

    @classmethod
    def get_option_name(cls, value: int) -> str:
        return super().get_option_name(value).replace("Dlc", "DLC")


class VirginMode(Toggle):
    """
    The goal only counts with the Virginity status intact. Losing it will force the game to game over, putting the
    character's LP to 0.
    The "Seed of Origin" title check will only hold filler to preserve the challenge.
    This has no story difference, it is only there for those who want the challenge.
    """
    display_name = "Virgin Mode"


class IncludeDLC(Toggle):
    """
    Adds the content of the DLC to the multiworld. Only turn this on when you own the DLC.

    This includes checks for the monsters, events, titles and relics of the DLC where applicable: the first visits
    and unlocks of its floor events, the first victories over its enemies and the two additional door bosses.

    When off, the floor events of the DLC are not offered even if it is installed.
    """
    display_name = "Include DLC"


class Relicsanity(DefaultOnToggle):
    """
    Relics found in events (Dusk Ring, Collar Key, ...) become checks, and the relics themselves are shuffled
    into the multiworld.
    """
    display_name = "Relicsanity"


class ShuffleKeys(Toggle):
    """
    The White Key and the Black Key open the doors in the Corridor and the Prison events for the Monster questline.
    With the DLC, these also unlock the White Door and the Black Door required to access the DLC final boss.

    With relicsanity these can be shuffled into the multiworld, with the Locksmith becoming late game checks.
    This setting will give you the option to force the keys to be at their original location.

    True: No longer requires the 6 relics and access to Locksmith in order to obtain the Keys.
    False: Force the 6 relics and Locksmith to be in logic before the DLC boss / Monster questline.
    
    This option is skipped if Relicsanity is false.
    """
    display_name = "Shuffle Keys"


class FirstVictories(DefaultOnToggle):
    """The first win against each regular enemy is a check."""
    display_name = "First Victories"


class ShuffleTitleEffects(DefaultOnToggle):
    """
    Puts "Unlock Title Effect" items into the pool. Until the Unlock item has been found in the multiworld,
    Title Effects cannot be revealed in the Title Collection screen, even if you have met the conditions for them.
    Meeting the condition of a title still remains as a check and is shown accordingly on the tracker.
    """
    display_name = "Shuffle Title Effects"


class FinisherMove(Choice):
    """
    Kick Balls, the card that turns up after the enemy climaxes and defeats it outright.
    This move can trivialize most of the game, so this option provides additional restrictions:

    Vanilla: card is added to the hand as it does in the normal game.
    Shuffle: card is not added to the hand until it is found as an item in the multiworld.
    Boon Shop: card is not added to the hand until it is permanently purchased from the Boon Shop for 1000 souls.
    Remove: card is removed from the game and cannot be used.
    """
    display_name = "Finisher Move"
    option_vanilla = 0
    option_shuffle = 1
    option_boon_shop = 2
    option_remove = 3
    default = 0


class FloorExploration(Range):
    """
    Adds a soft-logic layer by adding Progressive Floor Exploration, which makes exploring new floor events less
    RNG heavy.
    Normally you start off with Battle + 2 floor events, and each Progressive Floor Exploration adds another one.
    The climb expects one of them by floor 21, two by floor 41, three by floor 61, four by floor 81 and five by
    floor 101, as far as there are that many.
    """
    display_name = "Floor Exploration"
    range_start = 0
    range_end = len(data.EXPLORATION_FLOORS)
    default = len(data.EXPLORATION_FLOORS)


class BattleRewards(Range):
    """
    Adds checks to the fights. While one of them is open, one of the three cards of a won fight is an Archipelago
    card, and taking it sends the check in place of a card. Each stretch of 20 floors (1-20, 21-40, ...) up to
    the set Required Floor has this many of them, 0 for none.
    Remaining checks roll over to the next stretch of floors if you have progressed past them.
    """
    display_name = "Battle Rewards"
    range_start = 0
    range_end = data.BATTLE_REWARDS_MAX
    default = 0


class RequiredFloor(Range):
    """
    The floor you have to reach to beat the game: before it the boss of your goal cannot be challenged. That is
    the final boss, or with a DLC goal the boss behind The Last Door. Both are at a boss floor, and those come
    every 20 floors, so a value in between counts up to the next one.

    Normally the game forces an ending on floor 100 but the AP sets the game to post-game environment.
    You can refight Heavenly Kings for bonus stats. With a DLC goal the final boss can be fought from floor 100
    as well, for bonus stats and souls.
    Max is set to 200 to include for possible post-game monster checks that are behind floor 101.
    """
    display_name = "Required Floor"
    range_start = 100
    range_end = 200
    default = 100


class TrapPercentage(Range):
    """
    How much of the filler is traps: Climax Trap, Breeze Trap, Confusion Trap, Brainwash Trap, Sticky Trap,
    Paralysis Trap, Acid Trap, Ecstasy Trap, Time Stop Trap (DLC), and a trap goes off in the fight it arrives in.
    The weight options below set how the traps are split. Set a weight to 0 and it will not be present.

    The rest of the filler is gold, +5 LP or +5 RP restored, one-time stat boosts for the current run (+5 Max
    LP, +5 Max RP, +1 STR, MAG, DEF or AGL) and 10, 25 or 50 souls to spend.
    """
    display_name = "Trap Percentage"
    range_start = 0
    range_end = 100
    default = 20


class TrapWeight(Range):
    range_start = 0
    range_end = 100
    default = 20


class ClimaxTrapWeight(TrapWeight):
    """
    How likely a trap is a Climax Trap, which forces a climax and rendering you immobile for 3 turns.
    Lower odds as some enemies may deal lethal damage in the first 3 turns.
    """
    display_name = "Climax Trap Weight"
    default = 5

class BreezeTrapWeight(TrapWeight):
    """How likely a trap is a Breeze Trap, which takes your underwear like the Steal of an enemy does."""
    display_name = "Breeze Trap Weight"


class ConfusionTrapWeight(TrapWeight):
    """
    How likely a trap is a Confusion Trap, which confuses you like an enemy's spell does: up to five cards of the
    Confused sequence cards land in your discard pile.
    """
    display_name = "Confusion Trap Weight"


class BrainwashTrapWeight(TrapWeight):
    """
    How likely a trap is a Brainwash Trap, which brainwashes you like an enemy's spell does: up to five Brainwash
    sequence cards land in your discard pile. Does not affect Virginity like the enemy does originally.
    Without patch, the sequence cards will be the same as the Confusion Trap.
    """
    display_name = "Brainwash Trap Weight"


class StickyTrapWeight(TrapWeight):
    """How likely a trap is a Sticky Trap, which covers you in sticky fluid (debuff card) and lowers your AGL."""
    display_name = "Sticky Trap Weight"


class ParalysisTrapWeight(TrapWeight):
    """How likely a trap is a Paralysis Trap, which paralyzes you. Mounting actions will not work."""
    display_name = "Paralysis Trap Weight"


class AcidTrapWeight(TrapWeight):
    """
    How likely a trap is an Acid Trap, which dissolves your clothes by one stage (up to two stages in DLC).
    """
    display_name = "Acid Trap Weight"


class EcstasyTrapWeight(TrapWeight):
    """
    How likely a trap is an Ecstasy Trap, which puts you in Lust state, adding a Comfort debuff card to your hand.
    """
    display_name = "Ecstasy Trap Weight"


class TimeStopTrapWeight(TrapWeight):
    """
    How likely a trap is a Time Stop Trap, which stops time for you like Transgression of the DLC does: all you
    hold is Resist cards (the cards in your hand go back to the deck and are drawn again afterwards), and nothing
    the enemy does can be dodged. Two of them (6 AP) within two turns undo it.
    Otherwise the enemy undresses you and pins you down, and from there you cannot move until
    you climax. Needs Include DLC, without it there are none of them.
    """
    display_name = "Time Stop Trap Weight"
    default = 5


class StartingEventCount(Range):
    """
    How many floor event unlocks you have from the start, next to the battles. They are picked at random from the
    events of the first 40 floors and fill up the ones named in Starting Events.

    Desert, Temple, Hot Spring, Market and Small Room are one unlock for two events each.
    """
    display_name = "Starting Event Count"
    range_start = 0
    range_end = len(data.UNLOCK_EVENTS)
    default = 3


class StartingEvents(OptionSet):
    """
    Floor event unlocks you have from the start, by name: ["Market", "Inn"]. They count towards Starting Event
    Count, and all of them are given even when there are more of them than that.

    The names: Marsh, Hot Spring, Forest, Inn, Desert, Temple, Collapse, Beggar, Quarrel, Market, Small Room,
    Amusement Center, Flower, Cherry Blossoms, Storage Room, Library, Girl, Battlefield, Dog, Cat, Camp, Seamstress,
    River, Gold and Silver Treasures, Debauch, Sea, Snowy Mountain, Suspension Bridge, Pond, Highway, Lake Shore,
    Locksmith, Corridor, Throne, Hill, Prison.

    With Include DLC also: Costume Room, Barracks, Farm Village, Old Woman, Checkpoint, Clinic, Slave Market,
    Graveyard, Girl with Flower Crown, Sculptor, Royal Tomb.
    """
    display_name = "Starting Events"
    valid_keys = frozenset(data.UNLOCK_EVENTS)


class SoulMultiplier(Range):
    """
    The souls a run earns, as a percentage: 100 is what the game counts, 200 twice that. Souls add up over the runs
    of a seed and are spent in the soul shop of the standby screen: a new set of floor events to choose from, a
    floor event of your choice, a Forget-Me-Not, a Pieris (DLC), 10 LP or RP, a Yellow Vial that ends the
    Regression State, a Repair Kit that mends your clothes, or Scissors that tear them. The random boon start
    also turned into its own one-time purchase shop on the standby screen.
    """
    display_name = "Soul Multiplier"
    range_start = 100
    range_end = 200
    default = 100


@dataclass
class LostChapterOptions(PerGameCommonOptions):
    goal: Goal
    virgin_mode: VirginMode
    include_dlc: IncludeDLC
    relicsanity: Relicsanity
    shuffle_keys: ShuffleKeys
    first_victories: FirstVictories
    shuffle_title_effects: ShuffleTitleEffects
    finisher_move: FinisherMove
    floor_exploration: FloorExploration
    battle_rewards: BattleRewards
    required_floor: RequiredFloor
    trap_percentage: TrapPercentage
    climax_trap_weight: ClimaxTrapWeight
    confusion_trap_weight: ConfusionTrapWeight
    sticky_trap_weight: StickyTrapWeight
    paralysis_trap_weight: ParalysisTrapWeight
    acid_trap_weight: AcidTrapWeight
    ecstasy_trap_weight: EcstasyTrapWeight
    time_stop_trap_weight: TimeStopTrapWeight
    brainwash_trap_weight: BrainwashTrapWeight
    breeze_trap_weight: BreezeTrapWeight
    starting_event_count: StartingEventCount
    starting_events: StartingEvents
    soul_multiplier: SoulMultiplier
    death_link: DeathLink
