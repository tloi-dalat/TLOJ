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


def hidden_result_contest_q():
    now = timezone.now()
    hide_formats = [name for name, cls in formats.items()
                    if getattr(cls, 'hides_results_before_unfreeze', False)]
    return (
        Q(format_name__in=hide_formats, unfreeze_time__gt=now) |
        Q(format_name__in=hide_formats, unfreeze_time__isnull=True, end_time__gt=now) |
        Q(unfreeze_time__isnull=False, end_time__lte=now, unfreeze_time__gt=now)
    )
