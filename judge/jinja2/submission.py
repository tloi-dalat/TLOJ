from operator import attrgetter

from django.db.models import Q
from django.utils import timezone

from judge.models import Contest, Submission, SubmissionSourceAccess
from . import registry


# TODO: maybe refactor this?
def get_editor_ids(contest):
    return set(map(attrgetter('id'), contest.authors.all())) | set(map(attrgetter('id'), contest.curators.all()))


@registry.function
def submission_layout(submission, profile_id, user, completed_problem_ids, editable_problem_ids, tester_problem_ids):
    if not user.is_authenticated:
        return False, False

    problem_id = submission.problem_id
    submission_source_visibility = submission.problem.submission_source_visibility
    can_view = False
    can_edit = False

    if (user.has_perm('judge.edit_all_problem') or
            (user.has_perm('judge.edit_public_problem') and submission.problem.is_public) or
            # We try to avoid evaluating this as much as possible to keep it lazy.
            problem_id in editable_problem_ids):
        can_view = True
        can_edit = True
    elif user.has_perm('judge.view_all_submission'):
        can_view = True
    elif profile_id == submission.user_id:
        can_view = True
    elif not submission.problem.is_public and user.has_perm('judge.suggest_new_problem') and \
            submission.problem.is_suggesting:
        can_view = True
    elif submission_source_visibility == SubmissionSourceAccess.ALWAYS:
        can_view = True
    elif submission.contest_object is not None and profile_id in get_editor_ids(submission.contest_object):
        can_view = True
    elif submission.problem_id in completed_problem_ids:
        can_view = submission.problem_id in tester_problem_ids
        if submission_source_visibility == SubmissionSourceAccess.SOLVED:
            can_view = can_view or submission.problem.is_public

    return can_view, can_edit


def _hidden_contest_q():
    from judge.contest_format.registry import formats as contest_formats
    now = timezone.now()
    hide_formats = [name for name, cls in contest_formats.items()
                    if getattr(cls, 'hides_results_before_unfreeze', False)]
    return (
        Q(format_name__in=hide_formats, unfreeze_time__gt=now) |
        Q(format_name__in=hide_formats, unfreeze_time__isnull=True, end_time__gt=now) |
        Q(unfreeze_time__isnull=False, end_time__lte=now, unfreeze_time__gt=now)
    )


@registry.function
def active_contest_result_hidden(request):
    if not request.in_contest:
        return False
    return request.participation.contest.should_hide_result(request.user, request.participation)


@registry.function
def hidden_contest_problem_ids(user):
    """Return frozenset of problem IDs the user submitted to in currently hidden-result contests."""
    if not user.is_authenticated:
        return frozenset()
    if user.has_perm('judge.see_private_contest') or user.has_perm('judge.edit_all_contest'):
        return frozenset()
    return frozenset(
        Submission.objects.filter(
            user=user.profile,
            contest_object__in=Contest.objects.filter(_hidden_contest_q()),
        ).values_list('problem_id', flat=True).distinct()
    )


@registry.function
def submission_result_hidden(submission, user):
    """
    Returns True if this submission's result should be hidden from the given user.
    Uses prefetched contest authors/curators for efficiency in list views.
    """
    if not submission.contest_object_id:
        return False
    contest = submission.contest_object
    if user.is_authenticated:
        if user.has_perm('judge.see_private_contest') or user.has_perm('judge.edit_all_contest'):
            return False
        if user.profile.id in get_editor_ids(contest):
            return False

    now = timezone.now()
    if getattr(contest.format, 'hides_results_before_unfreeze', False):
        effective_unfreeze = contest.unfreeze_time or contest.end_time
        return now < effective_unfreeze

    if contest.unfreeze_time and contest.end_time < now:
        return now < contest.unfreeze_time

    return False
