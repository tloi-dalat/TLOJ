from operator import attrgetter

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

# Selects the latest valid (non-IE) submission for each problem in the participation.
# "Valid" means result != 'IE' (exclude system errors). Null result (still judging) is included.
VOI_RANKING_SQL = """
SELECT cs.points, sub.date AS time, cp.id AS prob
FROM judge_contestproblem cp
    INNER JOIN judge_contestsubmission cs ON (cs.problem_id = cp.id AND cs.participation_id = %s)
    INNER JOIN judge_submission sub ON (sub.id = cs.submission_id)
WHERE (sub.result IS NULL OR sub.result != 'IE')
  AND sub.id = (
    SELECT ccs3.submission_id
    FROM judge_contestsubmission ccs3
        INNER JOIN judge_submission s3 ON s3.id = ccs3.submission_id
    WHERE ccs3.problem_id = cp.id AND ccs3.participation_id = %s
      AND (s3.result IS NULL OR s3.result != 'IE')
    ORDER BY s3.date DESC
    LIMIT 1
  )
"""


@register_contest_format('voi')
class VOIContestFormat(DefaultContestFormat):
    name = gettext_lazy('VOI')

    # All results are hidden until the effective unfreeze time (contest end or unfreeze_time).
    hides_results_before_unfreeze = True

    # Rank by total score only; deterministic tie-break by username (no time penalty).
    ranking_sort_fields = ('-score', 'user__user__username')

    @classmethod
    def validate(cls, config):
        if config is not None and (not isinstance(config, dict) or config):
            raise ValidationError('VOI contest expects no config or empty dict as config')

    def update_participation(self, participation):
        points = 0
        format_data = {}

        with connection.cursor() as cursor:
            cursor.execute(VOI_RANKING_SQL, (participation.id, participation.id))

            for sub_points, time, prob in cursor.fetchall():
                time = from_database_time(time)
                dt = (time - participation.start).total_seconds()
                sub_points = sub_points or 0

                format_data[str(prob)] = {
                    'time': dt,
                    'points': sub_points,
                }
                points += sub_points

        participation.cumtime = 0
        participation.score = round(points, self.contest.points_precision)
        participation.tiebreaker = 0
        participation.frozen_score = 0
        participation.frozen_cumtime = 0
        participation.frozen_tiebreaker = 0
        participation.format_data = format_data
        participation.save()

    def get_first_solves_and_total_ac(self, problems, participations, frozen=False):
        first_solves = {}
        total_ac = {}

        for problem in problems:
            problem_id = str(problem.id)
            min_time = None
            first_solves[problem_id] = None
            total_ac[problem_id] = 0

            for participation in participations:
                format_data = (participation.format_data or {}).get(problem_id)
                if format_data:
                    pts = format_data['points']
                    time = format_data['time']

                    if pts == problem.points:
                        total_ac[problem_id] += 1
                        if participation.virtual == 0 and (min_time is None or min_time > time):
                            min_time = time
                            first_solves[problem_id] = participation.id

        return first_solves, total_ac

    def display_user_problem(self, participation, contest_problem, first_solves, frozen=False):
        format_data = (participation.format_data or {}).get(str(contest_problem.id))
        if format_data:
            state = (
                ('pretest-' if self.contest.run_pretests_only and contest_problem.is_pretested else '') +
                ('first-solve ' if first_solves.get(str(contest_problem.id)) == participation.id else '') +
                self.best_solution_state(format_data['points'], contest_problem.points)
            )
            url = reverse('contest_user_submissions',
                          args=[self.contest.key, participation.user.user.username, contest_problem.problem.code])
            return format_html(
                '<td class="{state}"><a href="{url}">{points}</a></td>',
                state=state,
                url=url,
                points=floatformat(format_data['points'], -self.contest.points_precision),
            )
        return mark_safe('<td></td>')

    def display_participation_result(self, participation, frozen=False):
        return format_html(
            '<td class="user-points"><a href="{url}">{points}</a></td>',
            url=reverse('contest_all_user_submissions',
                        args=[self.contest.key, participation.user.user.username]),
            points=floatformat(participation.score, -self.contest.points_precision),
        )

    def get_ranker_key(self):
        return attrgetter('points')

    def get_short_form_display(self):
        yield _('The final submission for each problem will be used.')
        yield _('No penalty for wrong submissions.')
        yield _('Ties are broken by username only (no time tie-break).')
        base_unfreeze = self.contest.get_unfreeze_time()
        if base_unfreeze > self.contest.end_time:
            yield _('Results are revealed after the unfreeze time.')
        else:
            yield _('Results are revealed after the contest ends.')
