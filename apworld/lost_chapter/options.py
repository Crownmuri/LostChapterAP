from dataclasses import dataclass

from Options import Choice, DefaultOnToggle, OptionSet, PerGameCommonOptions, Range

from . import data


class Goal(Choice):
    """
    What counts as completing the game.

    The game counts as cleared from the start, so the climb continues after the last boss.

    Normal End: defeat the last boss.
    True End: defeat the last boss in a run that would get ENDING 1 "Beyond the Blue Sky", which takes a climax count
    of 20 or less.
    Virgin End: defeat the last boss with the Virginity status intact. Losing it ends the run on the spot, like
    running out of LP. This has no story difference, it is only there for those who want the challenge.
    """
    display_name = "Goal"
    option_normal_end = 0
    option_true_end = 1
    option_virgin_end = 2
    alias_ending = 0
    alias_ending_1 = 1
    default = 0


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
    """
    display_name = "Finisher Move"
    option_vanilla = 0
    option_shuffle = 1
    option_remove = 2
    default = 0


class StartingEventCount(Range):
    """
    How many floor event unlocks you have from the start, next to the battles. They are picked at random from the
    events of the first 40 floors and fill up the ones named in Starting Events.

    Desert, Temple, Hot Spring, Market and Small Room are one unlock for two events each.
    """
    display_name = "Starting Event Count"
    range_start = 0
    range_end = len(data.UNLOCK_EVENTS)
    default = 2


class StartingEvents(OptionSet):
    """
    Floor event unlocks you have from the start, by name: ["Market", "Inn"]. They count towards Starting Event
    Count, and all of them are given even when there are more of them than that.
    """
    display_name = "Starting Events"
    valid_keys = frozenset(data.UNLOCK_EVENTS)


class SoulMultiplier(Range):
    """
    Multiplies the souls every run earns. Souls add up over all runs and send checks at 50, 100, 200, 400, 600,
    800, 1000, 1200, 1600 and 2000. The first four are expected within the first 20 floors, the later ones take
    floors further up.
    """
    display_name = "Soul Multiplier"
    range_start = 1
    range_end = 10
    default = 1


@dataclass
class LostChapterOptions(PerGameCommonOptions):
    goal: Goal
    relicsanity: Relicsanity
    first_victories: FirstVictories
    shuffle_title_effects: ShuffleTitleEffects
    finisher_move: FinisherMove
    starting_event_count: StartingEventCount
    starting_events: StartingEvents
    soul_multiplier: SoulMultiplier
