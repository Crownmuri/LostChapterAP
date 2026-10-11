from dataclasses import dataclass

from Options import Choice, DeathLink, DefaultOnToggle, OptionSet, PerGameCommonOptions, Range, Toggle

from . import data


class Goal(Choice):
    """
    What counts as completing the game.

    The game counts as cleared from the start, so the climb continues after the last boss.

    Normal End: defeat the last boss.
    True End: defeat the last boss in a run that would get ENDING 1 "Beyond the Blue Sky", which takes a climax count
    of 20 or less.
    DLC End: defeat Magislilia, the last boss of the DLC, who waits behind the last door once Migwarners (White
    Door) and Bordosegeia (Black Door) are defeated in the same run. Needs Include DLC.

    Virgin Mode adds to any of these that the Virginity status has to be intact.
    """
    display_name = "Goal"
    option_normal_end = 0
    option_true_end = 1
    option_dlc_end = 3
    default = 0

    @classmethod
    def get_option_name(cls, value: int) -> str:
        return super().get_option_name(value).replace("Dlc", "DLC")


class VirginMode(Toggle):
    """
    The goal only counts with the Virginity status intact, whichever goal it is.

    Losing the Virginity status ends the run on the spot, like running out of LP, and the "Lose Virginity" title
    check only holds filler. This has no story difference, it is only there for those who want the challenge.
    """
    display_name = "Virgin Mode"


class IncludeDLC(Toggle):
    """
    Adds the content of the DLC to the multiworld. Only turn this on when you own the DLC.

    This includes checks for the monsters, events, titles and relics of the DLC where applicable: the first visits
    and unlocks of its floor events, the first victories over its enemies, its two door bosses and the relics its
    events hand out.

    When off, the floor events of the DLC are not offered even if it is installed.
    """
    display_name = "Include DLC"


class ShuffleKeys(Toggle):
    """
    The White Key and the Black Key are shuffled into the multiworld as relics, and having the Locksmith make one
    is a check. They open the locked door of the Corridor, the Prison and, with the DLC, the White Door and the
    Black Door.

    When off, the keys are made at the Locksmith as in the normal game, from relics that are still shuffled.

    Needs Relicsanity, the keys are always made at the Locksmith without it.
    """
    display_name = "Shuffle Keys"


class Relicsanity(DefaultOnToggle):
    """
    Relics found in events (Dusk Ring, Collar Key, ...) become checks, and the relics themselves are shuffled
    into the multiworld.
    """
    display_name = "Relicsanity"


class FirstVictories(DefaultOnToggle):
    """The first win against each regular enemy is a check."""
    display_name = "First Victories"


class ShuffleTitleEffects(DefaultOnToggle):
    """
    Releasing a title in the Title Collection also needs its Unlock Title Effect item, which is shuffled into the
    multiworld. When off, a title is released as soon as its condition is met, as in the normal game.

    Meeting the condition of a title is a check either way.
    """
    display_name = "Shuffle Title Effects"


class FinisherMove(Choice):
    """
    Kick Balls, the card that turns up after the enemy climaxes and defeats it outright.

    Vanilla: it turns up as in the normal game.
    Shuffle: it only turns up once you have found the Kick Balls item, which is shuffled into the multiworld.
    Remove: it never turns up.
    Boon Shop: it only turns up once you have bought it in the Boon Shop for 1000 souls, which then holds for every
    later run as well.
    """
    display_name = "Finisher Move"
    option_vanilla = 0
    option_shuffle = 1
    option_remove = 2
    option_boon_shop = 3
    default = 0


class FieldExploration(Range):
    """
    How many Progressive Field Exploration items are shuffled into the multiworld. Each one adds a floor event to
    the two you get to choose from on every floor, which makes it easier to find the event you are after.

    The climb expects one of them by floor 21, two by floor 41, three by floor 61, four by floor 81 and five by
    floor 101, as far as there are that many.
    """
    display_name = "Field Exploration"
    range_start = 0
    range_end = len(data.EXPLORATION_FLOORS)
    default = len(data.EXPLORATION_FLOORS)


class BattleRewards(Range):
    """
    Adds checks to the fights. While one of them is open, one of the three cards of a won fight is an Archipelago
    card, and taking it sends the check in place of a card. Each stretch of 20 floors (1-20, 21-40, ...) up to
    the Final Boss Floor has this many of them, 0 for none: 5 of them with the final boss on floor 160 are 40
    checks.
    """
    display_name = "Battle Rewards"
    range_start = 0
    range_end = data.BATTLE_REWARDS_MAX
    default = 0


class FinalBossFloor(Range):
    """
    The floor you have to reach before the final boss can be challenged. He is one of the doors of a boss floor, and
    those come every 20 floors, so a value in between counts up to the next one.

    The doors of floor 100 and later still let you fight the Heavenly Kings again or keep going, which is how you
    climb on. This does not change the DLC ending.
    """
    display_name = "Final Boss Floor"
    range_start = 100
    range_end = 200
    default = 100


class TrapPercentage(Range):
    """
    How much of the filler is traps: Climax Trap, Confusion Trap, Sticky Trap, Paralysis Trap, Acid Trap and
    Ecstasy Trap. A trap
    goes off in the fight it arrives in, or in the next one. The weight options below set how the traps are split.

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
    How likely a trap is a Climax Trap, which forces a climax on your next turn. The six trap weights are compared
    with each other: with all of them the same, every kind is as likely. 0 leaves a kind out.
    """
    display_name = "Climax Trap Weight"


class ConfusionTrapWeight(TrapWeight):
    """
    How likely a trap is a Confusion Trap, which confuses you like an enemy's spell does: up to five cards of the
    Confused State land in your discard pile.
    """
    display_name = "Confusion Trap Weight"


class StickyTrapWeight(TrapWeight):
    """How likely a trap is a Sticky Trap, which covers you in sticky fluid and lowers your AGL."""
    display_name = "Sticky Trap Weight"


class ParalysisTrapWeight(TrapWeight):
    """How likely a trap is a Paralysis Trap, which paralyzes you. This can decide a fight."""
    display_name = "Paralysis Trap Weight"


class AcidTrapWeight(TrapWeight):
    """How likely a trap is an Acid Trap, which dissolves your clothes."""
    display_name = "Acid Trap Weight"


class EcstasyTrapWeight(TrapWeight):
    """
    How likely a trap is an Ecstasy Trap, which puts you in Lust: a card that weakens you is added to your hand.
    """
    display_name = "Ecstasy Trap Weight"


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

    With Include DLC also: Change to Swimsuit, Barracks, Farm Village, Old Woman, Checkpoint, Clinic, Slave Market,
    Graveyard, Girl with Flower Crown, Sculptor, Treasury.
    """
    display_name = "Starting Events"
    valid_keys = frozenset(data.UNLOCK_EVENTS)


class SoulMultiplier(Range):
    """
    The souls a run earns, as a percentage: 100 is what the game counts, 200 twice that. Souls add up over the runs
    of a seed and are spent in the soul shop of the standby screen: a new set of floor events to choose from, a
    floor event of your choice, a Forget-Me-Not, a Pieris (DLC), 10 LP or RP, or a Yellow Vial that ends the
    Regression State. The prices double with every 20 floors.
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
    field_exploration: FieldExploration
    battle_rewards: BattleRewards
    final_boss_floor: FinalBossFloor
    trap_percentage: TrapPercentage
    climax_trap_weight: ClimaxTrapWeight
    confusion_trap_weight: ConfusionTrapWeight
    sticky_trap_weight: StickyTrapWeight
    paralysis_trap_weight: ParalysisTrapWeight
    acid_trap_weight: AcidTrapWeight
    ecstasy_trap_weight: EcstasyTrapWeight
    starting_event_count: StartingEventCount
    starting_events: StartingEvents
    soul_multiplier: SoulMultiplier
    death_link: DeathLink
