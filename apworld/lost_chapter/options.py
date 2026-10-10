from dataclasses import dataclass

from Options import Choice, DefaultOnToggle, PerGameCommonOptions, Range


class Goal(Choice):
    """
    What counts as completing the game.

    The game counts as cleared from the start, so the climb continues after the last boss.

    Ending: defeat the last boss.
    Ending 1: defeat the last boss in a run that would get ENDING 1 "Beyond the Blue Sky", which takes a climax count
    of 20 or less.
    """
    display_name = "Goal"
    option_ending = 0
    option_ending_1 = 1
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


class SoulMultiplier(Range):
    """
    Multiplies the souls every run earns. Souls add up over all runs and send checks at 50, 100, 200, 500, 1000
    and 2000.
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
    soul_multiplier: SoulMultiplier
