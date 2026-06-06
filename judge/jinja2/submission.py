from operator import attrgetter

from django.utils import timezone

from judge.models import Problem, Submission, SubmissionSourceAccess
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


@registry.function
def hidden_contest_problem_ids(user):
    if not user.is_authenticated:
        return frozenset()
    if user.has_perm('judge.see_private_contest') or user.has_perm('judge.edit_all_contest'):
        return frozenset()
    from judge.contest_format import hidden_result_contest_ids
    hidden = hidden_result_contest_ids(user.profile)
    if not hidden:
        return frozenset()
    return frozenset(
        Submission.objects.filter(
            user=user.profile,
            contest_object__in=hidden,
        ).values_list('problem_id', flat=True).distinct(),
    )


@registry.function
def hidden_result_problem_ids(user):
    if user.is_authenticated and (
        user.has_perm('judge.see_private_contest') or user.has_perm('judge.edit_all_contest')
    ):
        return frozenset()
    from judge.contest_format import hidden_result_contest_ids
    profile = user.profile if user.is_authenticated else None
    hidden = hidden_result_contest_ids(profile)
    if not hidden:
        return frozenset()
    return frozenset(
        Problem.objects.filter(
            contests__contest__in=hidden,
        ).values_list('id', flat=True).distinct(),
    )


@registry.function
def submission_result_hidden(submission, user):
    if not submission.contest_object_id:
        return False
    if submission.status == 'IE':
        return False
    contest = submission.contest_object
    if user.is_authenticated:
        if user.has_perm('judge.see_private_contest') or user.has_perm('judge.edit_all_contest'):
            return False
        if user.profile.id in get_editor_ids(contest):
            return False

    now = timezone.now()
    hides = getattr(contest.format, 'hides_results_before_unfreeze', False)

    if (hides or (contest.unfreeze_time and contest.end_time < now)) and now < contest.get_unfreeze_time():
        return True

    if hides and user.is_authenticated and user.profile.current_contest_id is not None:
        return user.profile.current_contest.contest_id == contest.id

    return False
