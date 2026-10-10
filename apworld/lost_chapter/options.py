from dataclasses import dataclass

from Options import Choice, DefaultOnToggle, PerGameCommonOptions


class Goal(Choice):
    """
    What counts as completing the game.

    Ending: reach any ending.
    True Ending: reach the TRUE END.
    """
    display_name = "Goal"
    option_ending = 0
    option_true_ending = 1
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


@dataclass
class LostChapterOptions(PerGameCommonOptions):
    goal: Goal
    relicsanity: Relicsanity
    first_victories: FirstVictories
