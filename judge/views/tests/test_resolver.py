from django.test import TestCase
from django.urls import reverse
from django.utils import timezone

from judge.models import Contest, ContestSubmission, Submission
from judge.models.tests.util import (
    CommonDataMixin,
    create_contest,
    create_contest_participation,
    create_contest_problem,
    create_problem,
    create_user,
)
from judge.utils.resolver import build_resolver_payload


class ContestResolverViewTestCase(CommonDataMixin, TestCase):
    @classmethod
    def setUpTestData(cls):
        super().setUpTestData()
        cls._now = timezone.now()

    def test_resolver_data_allows_ranking_access_code(self):
        contest = create_contest(
            key='resolver_access_code',
            format_name='icpc',
            frozen_last_minutes=30,
            is_visible=True,
            scoreboard_visibility=Contest.SCOREBOARD_HIDDEN,
            ranking_access_code='stream-secret',
            start_time=self._now - timezone.timedelta(days=2),
            end_time=self._now - timezone.timedelta(days=1),
        )
        problem = create_problem(code='resolver_access_problem', is_public=True)
        create_contest_problem(contest=contest, problem=problem, order=1, points=100)
        create_contest_participation(contest=contest, user=self.users['normal'].profile)

        url = reverse('contest_resolver_data', args=[contest.key])
        self.assertEqual(self.client.get(url).status_code, 403)

        response = self.client.get(url, {'code': 'stream-secret'})
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload['contest']['name'], contest.name)

    def test_icpc_resolver_reveals_and_reranks(self):
        contest = create_contest(
            key='resolver_icpc',
            format_name='icpc',
            frozen_last_minutes=30,
            is_visible=True,
            scoreboard_visibility=Contest.SCOREBOARD_VISIBLE,
            start_time=self._now - timezone.timedelta(days=2),
            end_time=self._now - timezone.timedelta(days=1),
        )
        problem = create_problem(code='resolver_icpc_problem', is_public=True)
        contest_problem = create_contest_problem(contest=contest, problem=problem, order=1, points=100)

        alice = create_user(username='resolver_alice')
        bob = create_user(username='resolver_bob')
        alice.profile.rating = 2200
        alice.profile.save(update_fields=['rating'])

        alice_participation = create_contest_participation(contest=contest, user=alice.profile)
        create_contest_participation(contest=contest, user=bob.profile)

        from judge.models import Language
        lang = Language.objects.first()

        alice_sub = Submission.objects.create(
            user=alice.profile, problem=problem, language=lang,
            status='AC', result='AC',
        )
        Submission.objects.filter(id=alice_sub.id).update(date=contest.start_time + timezone.timedelta(minutes=10))

        ContestSubmission.objects.create(
            submission=alice_sub, problem=contest_problem,
            participation=alice_participation, points=100,
        )

        payload = build_resolver_payload(contest)
        contestant_names = [c['name'] for c in payload['contestants']]
        self.assertIn('resolver_alice', contestant_names)
        self.assertIn('resolver_bob', contestant_names)
        alice_payload = next(c for c in payload['contestants'] if c['name'] == 'resolver_alice')
        self.assertEqual(alice_payload['rank'], 'rate-candidate-master')
        self.assertEqual(len(payload['submissions']), 1)
        self.assertEqual(payload['submissions'][0]['name'], 'resolver_alice')
        self.assertEqual(payload['submissions'][0]['submitMinutes'], 10)

    def test_resolver_data_rejects_official_ranking_contests(self):
        contest = create_contest(
            key='resolver_official',
            format_name='icpc',
            frozen_last_minutes=30,
            is_visible=True,
            scoreboard_visibility=Contest.SCOREBOARD_VISIBLE,
            csv_ranking='team,score\nalpha,100',
            start_time=self._now - timezone.timedelta(days=2),
            end_time=self._now - timezone.timedelta(days=1),
        )

        response = self.client.get(reverse('contest_resolver_data', args=[contest.key]))
        self.assertEqual(response.status_code, 409)

    def test_default_resolver_builds(self):
        contest = create_contest(
            key='resolver_default',
            format_name='default',
            frozen_last_minutes=0,
            is_visible=True,
            scoreboard_visibility=Contest.SCOREBOARD_VISIBLE,
            start_time=self._now - timezone.timedelta(days=2),
            end_time=self._now - timezone.timedelta(days=1),
        )
        create_user(username='resolver_normal')
        payload = build_resolver_payload(contest)
        self.assertEqual(payload['contest']['name'], contest.name)

    def test_ioi_resolver_builds(self):
        contest = create_contest(
            key='resolver_ioi',
            format_name='ioi',
            frozen_last_minutes=0,
            is_visible=True,
            scoreboard_visibility=Contest.SCOREBOARD_VISIBLE,
            start_time=self._now - timezone.timedelta(days=2),
            end_time=self._now - timezone.timedelta(days=1),
        )
        payload = build_resolver_payload(contest)
        self.assertEqual(payload['contest']['name'], contest.name)
