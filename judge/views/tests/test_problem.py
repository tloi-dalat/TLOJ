from django.test import TestCase
from django.urls import reverse
from judge.models import Language, Submission
from judge.models.tests.util import CommonDataMixin, create_problem, create_user

class ProblemSubmitLanguageMemoryTestCase(CommonDataMixin, TestCase):
    @classmethod
    def setUpTestData(cls):
        super().setUpTestData()
        
        # Create problems
        cls.problem_a = create_problem(
            code='problem_a',
            is_public=True,
        )
        cls.problem_b = create_problem(
            code='problem_b',
            is_public=True,
        )
        
        # Get/create languages
        cls.python_lang, _ = Language.objects.get_or_create(
            key='PYTHON3',
            defaults={
                'name': 'Python 3',
                'short_name': 'Python 3',
                'common_name': 'Python',
            },
        )
        cls.cpp_lang, _ = Language.objects.get_or_create(
            key='CPP17',
            defaults={
                'name': 'C++ 17',
                'short_name': 'C++17',
                'common_name': 'C++',
            },
        )
        
        # Configure user's favorite language
        cls.user = cls.users['normal']
        cls.user.profile.language = cls.cpp_lang
        cls.user.profile.save()

    def test_default_language_no_submissions(self):
        # 1. User has no submissions: should use their favorite/preferred language (C++)
        self.assertEqual(Submission.objects.filter(user=self.user.profile).count(), 0)
        
        self.client.force_login(self.user)
        response = self.client.get(reverse('problem_submit', args=[self.problem_a.code]))
        self.assertEqual(response.status_code, 200)
        
        # Verify the context's default_lang is the preferred language (C++)
        self.assertEqual(response.context['default_lang'], self.cpp_lang)

    def test_default_language_after_submission(self):
        self.client.force_login(self.user)
        
        # 2. Simulate user submitting a solution with Python
        Submission.objects.create(
            user=self.user.profile,
            problem=self.problem_a,
            language=self.python_lang,
            status='D',
        )
        
        # Now visit Problem B submit page
        response = self.client.get(reverse('problem_submit', args=[self.problem_b.code]))
        self.assertEqual(response.status_code, 200)
        
        # Verify that the default language is Python, which they just used
        self.assertEqual(response.context['default_lang'], self.python_lang)
        
        # Verify that profile.language is still their favorite language (C++)
        self.user.profile.refresh_from_db()
        self.assertEqual(self.user.profile.language, self.cpp_lang)
