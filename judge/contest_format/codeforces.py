import math
from datetime import timedelta

from django.core.exceptions import ValidationError
from django.db import connection
from django.template.defaultfilters import floatformat
from django.urls import reverse
from django.utils.html import format_html
from django.utils.safestring import mark_safe
from django.utils.translation import gettext as _, gettext_lazy

from judge.contest_format.default import DefaultContestFormat
from judge.contest_format.registry import register_contest_format
from judge.timezone import from_database_time
from judge.utils.timedelta import nice_repr


@register_contest_format('codeforces')
class CodeforcesContestFormat(DefaultContestFormat):
    name = gettext_lazy('Codeforces')
    """
        Codeforces Standard scoring format.

        For each solved problem, the score is:
            score = max(0.3 * x, x - floor(120 * x * t / (250 * d)) - 50 * w)

        where:
            x = initial (maximum) score for the problem
            t = time of accepted submission in whole minutes (floored)
            d = contest duration in minutes
            w = number of incorrect submissions before the first accepted one
    """

    @classmethod
    def validate(cls, config):
        if config is not None and (not isinstance(config, dict) or config):
            raise ValidationError('Codeforces contest expects no config or empty dict as config')

    def __init__(self, contest, config):
        super(CodeforcesContestFormat, self).__init__(contest, config)

    @staticmethod
    def _compute_score(max_score, duration_minutes, time_minutes, wrong_attempts):
        """
        Compute the Codeforces score for a single problem.

        :param max_score: Initial (maximum) score for the problem (x).
        :param duration_minutes: Contest duration in minutes (d).
        :param time_minutes: Time of accepted submission in whole minutes, floored (t).
        :param wrong_attempts: Number of incorrect submissions before the first AC (w).
        :return: The computed score as an integer.
        """
        if duration_minutes <= 0:
            return max_score

        penalty = math.floor(120 * max_score * time_minutes / (250 * duration_minutes))
        raw_score = max_score - penalty - 50 * wrong_attempts
        min_score = math.floor(0.3 * max_score)
        return max(min_score, raw_score)

    def update_participation(self, participation):
        cumtime = 0
        points = 0
        format_data = {}

        # Contest duration in minutes
        contest_duration = self.contest.contest_window_length.total_seconds() / 60.0

        with connection.cursor() as cursor:
            cursor.execute("""
                SELECT MAX(cs.points) as `score`, (
                    SELECT MIN(csub.date)
                        FROM judge_contestsubmission ccs LEFT OUTER JOIN
                             judge_submission csub ON (csub.id = ccs.submission_id)
                        WHERE ccs.problem_id = cp.id AND ccs.participation_id = %s AND ccs.points = MAX(cs.points)
                ) AS `time`, cp.id AS `prob`, cp.points AS `max_points`
                FROM judge_contestproblem cp INNER JOIN
                     judge_contestsubmission cs ON (cs.problem_id = cp.id AND cs.participation_id = %s) LEFT OUTER JOIN
                     judge_submission sub ON (sub.id = cs.submission_id)
                GROUP BY cp.id
            """, (participation.id, participation.id))

            for score, time, prob, max_points in cursor.fetchall():
                time = from_database_time(time)
                dt = (time - participation.start).total_seconds()

                # t = time in whole minutes (floored)
                t = max(int(dt // 60), 0)

                # Compute wrong attempts (w): non-CE/IE submissions before the first AC, minus the AC itself
                if score:
                    subs = participation.submissions.exclude(submission__result__isnull=True) \
                                                    .exclude(submission__result__in=['IE', 'CE']) \
                                                    .filter(problem_id=prob)
                    wrong = subs.filter(submission__date__lte=time).count() - 1
                else:
                    wrong = 0

                if score:
                    # Apply the Codeforces scoring formula
                    problem_score = self._compute_score(max_points, contest_duration, t, wrong)
                    cumtime = max(cumtime, dt)
                else:
                    problem_score = 0
                    # Count total wrong attempts for display even when not solved
                    subs = participation.submissions.exclude(submission__result__isnull=True) \
                                                    .exclude(submission__result__in=['IE', 'CE']) \
                                                    .filter(problem_id=prob)
                    wrong = subs.count()

                format_data[str(prob)] = {
                    'time': dt,
                    'points': problem_score,
                    'penalty': wrong,
                    'max_points': max_points,
                }
                points += problem_score

        participation.cumtime = max(cumtime, 0)
        participation.score = round(points, self.contest.points_precision)
        participation.tiebreaker = 0
        participation.format_data = format_data
        participation.save()

    def display_user_problem(self, participation, contest_problem, first_solves, frozen=False):
        format_data = (participation.format_data or {}).get(str(contest_problem.id))
        if format_data:
            penalty = format_html(
                '<small style="color:red"> ({penalty})</small>',
                penalty=format_data['penalty'],
            ) if format_data['penalty'] else ''

            if not format_data['points']:
                if format_data['penalty']:
                    # Show wrong attempts even when problem is not solved
                    return format_html(
                        '<td class="{state}"><a href="{url}">{penalty}</a></td>',
                        state='failed-score',
                        url=reverse('contest_user_submissions',
                                    args=[self.contest.key, participation.user.user.username,
                                          contest_problem.problem.code]),
                        penalty=penalty,
                    )
                return mark_safe('<td></td>')

            return format_html(
                '<td class="{state}"><a href="{url}">{points}{penalty}'
                '<div class="solving-time">{time}</div></a></td>',
                state=(('pretest-' if self.contest.run_pretests_only and contest_problem.is_pretested else '') +
                       ('first-solve ' if first_solves.get(str(contest_problem.id), None) == participation.id
                        else '') +
                       self.best_solution_state(format_data['points'], contest_problem.points)),
                url=reverse('contest_user_submissions',
                            args=[self.contest.key, participation.user.user.username, contest_problem.problem.code]),
                points=floatformat(format_data['points'], -self.contest.points_precision),
                penalty=penalty,
                time=nice_repr(timedelta(seconds=format_data['time']), 'noday'),
            )
        else:
            return mark_safe('<td></td>')

    def get_label_for_problem(self, index):
        index += 1
        ret = ''
        while index > 0:
            ret += chr((index - 1) % 26 + 65)
            index = (index - 1) // 26
        return ret[::-1]

    def get_short_form_display(self):
        yield _('Codeforces scoring: score = max(0.3x, x − ⌊120xt/(250d)⌋ − 50w).')
        yield _('**x** = max points, **t** = submission time (min), **d** = contest duration (min), '
                '**w** = wrong attempts.')
        yield _('Ties will be broken by the time of the last score altering submission.')
