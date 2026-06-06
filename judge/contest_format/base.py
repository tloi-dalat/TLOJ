from abc import ABCMeta, abstractmethod
from operator import attrgetter

from django.urls import reverse
from django.utils.html import format_html
from django.utils.safestring import mark_safe


class abstractclassmethod(classmethod):
    __isabstractmethod__ = True

    def __init__(self, callable):
        callable.__isabstractmethod__ = True
        super(abstractclassmethod, self).__init__(callable)


class BaseContestFormat(metaclass=ABCMeta):
    # Set to True in formats that hide ALL results until the effective unfreeze time.
    # For such formats, results are hidden from the start of the contest.
    # For other formats, results are only hidden between contest_end and unfreeze_time (if set).
    hides_results_before_unfreeze = False

    # Default DB ordering fields for the ranking queryset (after is_disqualified).
    # VOI overrides this to use username for deterministic tie-breaking.
    ranking_sort_fields = ('-score', 'cumtime', 'tiebreaker', '-submission_count')

    @abstractmethod
    def __init__(self, contest, config):
        self.config = config
        self.contest = contest

    @property
    @abstractmethod
    def name(self):
        """
        Name of this contest format. Should be invoked with gettext_lazy.

        :return: str
        """
        raise NotImplementedError()

    @abstractclassmethod
    def validate(cls, config):
        """
        Validates the contest format configuration.

        :param config: A dictionary containing the configuration for this contest format.
        :return: None
        :raises: ValidationError
        """
        raise NotImplementedError()

    @abstractmethod
    def update_participation(self, participation):
        """
        Updates a ContestParticipation object's score, cumtime, and format_data fields based on this contest format.
        Implementations should call ContestParticipation.save().

        :param participation: A ContestParticipation object.
        :return: None
        """
        raise NotImplementedError()

    @abstractmethod
    def get_first_solves_and_total_ac(self, problems, participations, frozen=False):
        """
        Returns two dictionaries mapping ContestProblem to the first ContestParticipation that solves it
        and the total number of accepted submissions.

        :param problems: A list of ContestProblem objects.
        :param participations: A list of ContestParticipation objects.
        :param frozen: Whether the ranking is frozen or not. Only useful for ICPC/VNOJ format.
        :return: A tuple of two dictionaries. First one maps ContestProblem's ID to ContestParticipation's ID,
        or None if no solves yet. Second one maps ContestProblem's ID to total number of accepted submissions.
        """
        raise NotImplementedError()

    @abstractmethod
    def display_user_problem(self, participation, contest_problem, first_solves, frozen=False):
        """
        Returns the HTML fragment to show a user's performance on an individual problem. This is expected to use
        information from the format_data field instead of computing it from scratch.

        :param participation: The ContestParticipation object linking the user to the contest.
        :param contest_problem: The ContestProblem object representing the problem in question.
        :param first_solves: The first dictionary returned by get_first_solves_and_total_ac.
        :param frozen: Whether the ranking is frozen or not. Only useful for ICPC/VNOJ format.
        :return: An HTML fragment, marked as safe for Jinja2.
        """
        raise NotImplementedError()

    @abstractmethod
    def display_participation_result(self, participation, frozen=False):
        """
        Returns the HTML fragment to show a user's performance on the whole contest. This is expected to use
        information from the format_data field instead of computing it from scratch.

        :param participation: The ContestParticipation object.
        :param frozen: Whether the ranking is frozen or not. Only useful for ICPC/VNOJ format.
        :return: An HTML fragment, marked as safe for Jinja2.
        """
        raise NotImplementedError()

    @abstractmethod
    def get_problem_breakdown(self, participation, contest_problems):
        """
        Returns a machine-readable breakdown for the user's performance on every problem.

        :param participation: The ContestParticipation object.
        :param contest_problems: The list of ContestProblem objects to display performance for.
        :return: A list of dictionaries, whose content is to be determined by the contest system.
        """
        raise NotImplementedError()

    @abstractmethod
    def get_label_for_problem(self, index):
        """
        Returns the problem label for a given zero-indexed index.

        :param index: The zero-indexed problem index.
        :return: A string, the problem label.
        """
        raise NotImplementedError()

    @abstractmethod
    def get_short_form_display(self):
        """
        Returns a generator of Markdown strings to display the contest format's settings in short form.

        :return: A generator, where each item is an individual line.
        """
        raise NotImplementedError()

    def display_hidden_problem_cell(self, participation, contest_problem):
        """Returns an empty cell if no submissions, otherwise a pending cell with '?'."""
        format_data = (participation.format_data or {}).get(str(contest_problem.id))
        if not format_data:
            return mark_safe('<td></td>')

        tries = format_data.get('tries', 0)
        if not tries:
            return mark_safe('<td></td>')

        url = reverse('contest_user_submissions',
                      args=[self.contest.key, participation.user.user.username, contest_problem.problem.code])
        return format_html(
            '<td class="pending"><a href="{url}">?</a></td>',
            url=url,
        )

    def display_hidden_result_cell(self, participation):
        """Returns the total-score cell when results are hidden before unfreeze."""
        url = reverse('contest_all_user_submissions',
                      args=[self.contest.key, participation.user.user.username])
        return format_html('<td class="user-points"><a href="{url}">?</a></td>', url=url)

    def get_ranker_key(self):
        """Returns the attrgetter key for the Python ranker. VOI overrides to sort by points only."""
        return attrgetter('points', 'cumtime', 'tiebreaker')

    @classmethod
    def best_solution_state(cls, points, total):
        if not points:
            return 'failed-score'
        if points == total:
            return 'full-score'
        return 'partial-score'
