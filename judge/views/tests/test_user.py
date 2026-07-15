from django.test import TestCase
from django.urls import reverse

from judge.models.tests.util import create_user


class EditProfileTestCase(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.user = create_user(username='normal_user')

    def test_editor_theme_preview_is_rendered(self):
        self.client.force_login(self.user)
        response = self.client.get(reverse('user_edit_profile'))

        self.assertEqual(response.status_code, 200)
        self.assertContains(response, 'id="ace-theme-preview"')
        self.assertContains(response, 'ace.js')
