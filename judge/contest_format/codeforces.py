from django.db import connection
from django.utils.translation import gettext as _, gettext_lazy, ngettext

from judge.contest_format.registry import register_contest_format
from judge.contest_format.vnoj import DEFAULT_RANKING_SQL, FROZEN_RANKING_SQL, ParticipationInfo, VNOJContestFormat
from judge.timezone import from_database_time, to_database_time


@register_contest_format('codeforces')
class CodeforcesContestFormat(VNOJContestFormat):
    name = gettext_lazy('Codeforces')
    config_defaults = {
        'min_points_ratio': 0.3,
        'penalty_per_wrong_points': 50.0,
        'penalty_per_wrong_time': 20.0,
        'decay_rate': 0.004,
    }
    config_validators = {
        'min_points_ratio': lambda x: 0.0 <= x <= 1.0,
        'penalty_per_wrong_points': lambda x: x >= 0.0,
        'penalty_per_wrong_time': lambda x: x >= 0.0,
        'decay_rate': lambda x: x >= 0.0,
    }

    def calculate_participation_info(self, participation, frozen=False) -> ParticipationInfo:
        cumtime = 0
        score = 0
        format_data = {}
        frozen_time = participation.contest.frozen_time

        problems_points = {cp.id: cp.points for cp in participation.contest.contest_problems.all()}

        with connection.cursor() as cursor:
            if not frozen:
                cursor.execute(DEFAULT_RANKING_SQL, (participation.id, participation.id))
            else:
                db_time = to_database_time(frozen_time)
                cursor.execute(FROZEN_RANKING_SQL, (participation.id, db_time,
                                                    participation.id, db_time))

            for points_original, time_ac, prob_id in cursor.fetchall():
                time_ac_parsed = from_database_time(time_ac)
                dt_seconds = (time_ac_parsed - participation.start).total_seconds()
                dt_minutes = int(dt_seconds // 60)

                problem_subs = participation.submissions.exclude(submission__result__isnull=True) \
                                            .exclude(submission__result__in=['IE', 'CE']) \
                                            .filter(problem_id=prob_id)
                subs_before_ac = problem_subs.filter(submission__date__lt=time_ac_parsed)
                if frozen:
                    subs_before_ac = subs_before_ac.filter(submission__date__lt=frozen_time)

                wrong_submissions = subs_before_ac.count()

                if points_original:
                    max_points = problems_points.get(prob_id, points_original)
                    score_decay = dt_minutes * self.config['decay_rate'] * max_points
                    base_score = max(max_points * self.config['min_points_ratio'], max_points - score_decay)

                    penalty_points = self.config['penalty_per_wrong_points'] * wrong_submissions
                    points_gained = max(0.0, (points_original / max_points) * base_score - penalty_points)

                    penalty = dt_minutes + self.config['penalty_per_wrong_time'] * wrong_submissions

                    cumtime += penalty
                    score += points_gained
                else:
                    points_gained = 0.0
                    penalty = 0.0
                    wrong_submissions = problem_subs.count()

                format_data[str(prob_id)] = {
                    'time': dt_seconds,
                    'points': points_gained,
                    'penalty': wrong_submissions,
                }

                if not frozen and participation.contest.frozen_last_minutes != 0:
                    format_data[str(prob_id)]['pending'] = problem_subs \
                        .filter(submission__date__gte=frozen_time) \
                        .count()

        return ParticipationInfo(
            cumtime=max(cumtime * 60, 0),  # DMOJ cumtime is stored in seconds
            score=round(score, self.contest.points_precision),
            tiebreaker=0.0,
            format_data=format_data,
        )

    def get_short_form_display(self):
        yield _('Points decrease dynamically based on solving time.')
        yield _('Wrong submissions before first AC will deduct points and add penalty time.')

        min_points_ratio = self.config['min_points_ratio']
        yield _('Minimum points ratio for each problem: **%d%%**.') % int(min_points_ratio * 100)

        penalty_points = self.config['penalty_per_wrong_points']
        if penalty_points:
            yield _('Each wrong submission before the first AC will deduct **%.1f points**.') % penalty_points

        penalty_time = int(self.config['penalty_per_wrong_time'])
        if penalty_time:
            yield ngettext(
                'Each wrong submission before the first AC will incur a **penalty of %d minute**.',
                'Each wrong submission before the first AC will incur a **penalty of %d minutes**.',
                penalty_time,
            ) % penalty_time
