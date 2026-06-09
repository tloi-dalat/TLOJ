from datetime import timedelta

from django.test import TestCase
from django.utils import timezone

from judge.models import ContestSubmission, Language, Submission
from judge.models.tests.util import CommonDataMixin, create_contest, create_contest_participation, \
    create_contest_problem, create_problem


class CodeforcesContestFormatTestCase(CommonDataMixin, TestCase):
    @classmethod
    def setUpTestData(self):
        super().setUpTestData()

        # Create Codeforces contest: duration 200 minutes
        self.contest_start = timezone.now() - timedelta(minutes=100)
        self.contest_end = self.contest_start + timedelta(minutes=200)

        self.cf_contest = create_contest(
            key='cf_contest',
            name='Codeforces Test Contest',
            format_name='codeforces',
            start_time=self.contest_start,
            end_time=self.contest_end,
        )

        # Create two problems
        self.problem_a = create_problem(code='prob_a')
        self.problem_b = create_problem(code='prob_b')

        self.cp_a = create_contest_problem(
            contest=self.cf_contest,
            problem=self.problem_a,
            points=500,
            order=1,
        )
        self.cp_b = create_contest_problem(
            contest=self.cf_contest,
            problem=self.problem_b,
            points=1000,
            order=2,
        )

        # Create participation starting at contest start
        self.participation = create_contest_participation(
            contest=self.cf_contest,
            user='normal',
            real_start=self.contest_start,
        )

    def test_codeforces_scoring(self):
        py3 = Language.get_python3()

        # Problem A:
        # Submission 1: WA at minute 10
        sub_a1 = Submission.objects.create(
            user=self.users['normal'].profile,
            problem=self.problem_a,
            language=py3,
            contest_object=self.cf_contest,
            result='WA',
            status='D',
            case_points=0,
            case_total=10,
        )
        Submission.objects.filter(id=sub_a1.id).update(date=self.contest_start + timedelta(minutes=10))
        ContestSubmission.objects.create(
            submission=sub_a1,
            problem=self.cp_a,
            participation=self.participation,
            points=0.0,
        )

        # Submission 2: WA at minute 20
        sub_a2 = Submission.objects.create(
            user=self.users['normal'].profile,
            problem=self.problem_a,
            language=py3,
            contest_object=self.cf_contest,
            result='WA',
            status='D',
            case_points=0,
            case_total=10,
        )
        Submission.objects.filter(id=sub_a2.id).update(date=self.contest_start + timedelta(minutes=20))
        ContestSubmission.objects.create(
            submission=sub_a2,
            problem=self.cp_a,
            participation=self.participation,
            points=0.0,
        )

        # Submission 3: AC at minute 30
        sub_a3 = Submission.objects.create(
            user=self.users['normal'].profile,
            problem=self.problem_a,
            language=py3,
            contest_object=self.cf_contest,
            result='AC',
            status='D',
            case_points=10,
            case_total=10,
        )
        Submission.objects.filter(id=sub_a3.id).update(date=self.contest_start + timedelta(minutes=30))
        ContestSubmission.objects.create(
            submission=sub_a3,
            problem=self.cp_a,
            participation=self.participation,
            points=500.0,
        )

        # Problem B:
        # Submission 1: WA at minute 40
        sub_b1 = Submission.objects.create(
            user=self.users['normal'].profile,
            problem=self.problem_b,
            language=py3,
            contest_object=self.cf_contest,
            result='WA',
            status='D',
            case_points=0,
            case_total=10,
        )
        Submission.objects.filter(id=sub_b1.id).update(date=self.contest_start + timedelta(minutes=40))
        ContestSubmission.objects.create(
            submission=sub_b1,
            problem=self.cp_b,
            participation=self.participation,
            points=0.0,
        )

        # Submission 2: AC at minute 50
        sub_b2 = Submission.objects.create(
            user=self.users['normal'].profile,
            problem=self.problem_b,
            language=py3,
            contest_object=self.cf_contest,
            result='AC',
            status='D',
            case_points=10,
            case_total=10,
        )
        Submission.objects.filter(id=sub_b2.id).update(date=self.contest_start + timedelta(minutes=50))
        ContestSubmission.objects.create(
            submission=sub_b2,
            problem=self.cp_b,
            participation=self.participation,
            points=1000.0,
        )

        # Run update
        self.cf_contest.format.update_participation(self.participation)

        # Reload from DB
        self.participation.refresh_from_db()

        # Computations:
        # Duration: 200.0 mins
        # min_points_ratio: 0.3
        # decay_rate: 0.004
        #
        # Prob A (500 pts):
        # time_ac: minute 30
        # score_decay: 30 * 0.004 * 500 = 60.0
        # base_score: max(150, 500 - 60.0) = 440.0
        # wrong_subs before AC: 2 (sub_a1, sub_a2)
        # points_gained: max(0, 440.0 - 50 * 2) = 340.0
        # penalty: 30 + 20 * 2 = 70.0 mins
        #
        # Prob B (1000 pts):
        # time_ac: minute 50
        # score_decay: 50 * 0.004 * 1000 = 200.0
        # base_score: max(300, 1000 - 200.0) = 800.0
        # wrong_subs before AC: 1 (sub_b1)
        # points_gained: max(0, 800.0 - 50 * 1) = 750.0
        # penalty: 50 + 20 * 1 = 70.0 mins
        #
        # Total:
        # Score = 340.0 + 750.0 = 1090.0
        # Cumtime = (70.0 + 70.0) * 60 = 8400.0 seconds

        self.assertEqual(self.participation.score, 1090.0)
        self.assertEqual(self.participation.cumtime, 8400.0)

        # Check format_data
        format_data = self.participation.format_data
        prob_a_key = str(self.cp_a.id)
        prob_b_key = str(self.cp_b.id)

        self.assertIn(prob_a_key, format_data)
        self.assertEqual(format_data[prob_a_key]['points'], 340.0)
        self.assertEqual(format_data[prob_a_key]['penalty'], 2)
        self.assertEqual(format_data[prob_a_key]['time'], 30 * 60)

        self.assertIn(prob_b_key, format_data)
        self.assertEqual(format_data[prob_b_key]['points'], 750.0)
        self.assertEqual(format_data[prob_b_key]['penalty'], 1)
        self.assertEqual(format_data[prob_b_key]['time'], 50 * 60)
