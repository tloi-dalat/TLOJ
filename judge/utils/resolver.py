from django.db.models import Prefetch

from judge.jinja2.gravatar import gravatar
from judge.models import ContestParticipation, ContestSubmission, Organization
from judge.ratings import rating_name


def supports_resolver(contest):
    return contest.format_name in ('icpc', 'vnoj')


def build_resolver_payload(contest, show_virtual=False):
    problems = list(contest.contest_problems.select_related('problem').order_by('order'))
    participations_qs = contest.users.filter(virtual__gt=ContestParticipation.SPECTATE) \
        .select_related('user__user') \
        .prefetch_related(Prefetch('user__organizations', queryset=Organization.objects.filter(is_unlisted=False)))

    if not show_virtual:
        participations_qs = participations_qs.filter(virtual=ContestParticipation.LIVE)

    participations = list(participations_qs)

    submissions_qs = ContestSubmission.objects.filter(participation__contest=contest) \
        .select_related('participation__user', 'submission') \
        .order_by('submission__date')

    if not show_virtual:
        submissions_qs = submissions_qs.filter(participation__virtual=ContestParticipation.LIVE)

    submissions_data = []
    problem_id_to_label = {cp.id: contest.get_label_for_problem(i) for i, cp in enumerate(problems)}

    for cs in submissions_qs:
        label = problem_id_to_label.get(cs.problem_id)
        if not label:
            continue

        delta = cs.submission.date - contest.start_time
        submit_minutes = int(delta.total_seconds() // 60)

        submissions_data.append({
            'name': cs.participation.user.display_name or cs.participation.user.username,
            'problemIndex': label,
            'submitMinutes': submit_minutes,
            'points': float(cs.points or 0),
        })

    data = {
        'contest': {
            'name': contest.name,
            'durationMinutes': int((contest.end_time - contest.start_time).total_seconds() // 60),
            'freezeDurationMinutes': contest.frozen_last_minutes,
            'penaltyMinutes': (contest.format.config or {}).get('penalty', 20),
        },
        'problems': [
            {
                'index': contest.get_label_for_problem(i),
                'points': float(p.points),
            } for i, p in enumerate(problems)
        ],
        'contestants': [
            {
                'name': p.user.display_name or p.user.username,
                'logo': gravatar(p.user.user.email, size=64),
                'rank': rating_name(p.user.rating).lower() if p.user.rating is not None else 'newbie',
            } for p in participations
        ],
        'submissions': submissions_data,
    }
    return data
