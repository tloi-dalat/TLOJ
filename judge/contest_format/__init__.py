from django.db.models import Q
from django.utils import timezone

from judge.contest_format.atcoder import AtCoderContestFormat
from judge.contest_format.default import DefaultContestFormat
from judge.contest_format.ecoo import ECOOContestFormat
from judge.contest_format.icpc import ICPCContestFormat
from judge.contest_format.ioi import IOIContestFormat
from judge.contest_format.legacy_ioi import LegacyIOIContestFormat
from judge.contest_format.registry import choices, formats
from judge.contest_format.vnoj import VNOJContestFormat
from judge.contest_format.voi import VOIContestFormat


def hide_result_format_names():
    return [name for name, cls in formats.items()
            if getattr(cls, 'hides_results_before_unfreeze', False)]


def hidden_result_contest_q():
    now = timezone.now()
    hide_formats = hide_result_format_names()
    return (
        Q(format_name__in=hide_formats, unfreeze_time__gt=now) |
        Q(format_name__in=hide_formats, unfreeze_time__isnull=True, end_time__gt=now) |
        Q(end_time__lte=now, unfreeze_time__gt=now)
    )


def hidden_result_contest_ids(profile=None):
    from judge.models import Contest, ContestParticipation

    if profile is not None:
        cached = getattr(profile, '_hidden_result_contest_ids', None)
        if cached is not None:
            return cached

    ids = set(Contest.objects.filter(hidden_result_contest_q()).values_list('id', flat=True))
    if profile is not None:
        now = timezone.now()
        participations = (
            ContestParticipation.objects
            .filter(user=profile, virtual__gt=0, contest__format_name__in=hide_result_format_names())
            .select_related('contest')
        )
        for participation in participations:
            if now < participation.contest.get_effective_unfreeze_time(participation):
                ids.add(participation.contest_id)

    result = frozenset(ids)
    if profile is not None:
        profile._hidden_result_contest_ids = result
    return result
