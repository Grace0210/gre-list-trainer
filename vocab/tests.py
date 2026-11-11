import json

from django.contrib.auth.models import User
from django.test import TestCase
from django.urls import reverse

from .models import ListProgress, WordProgress


class AuthTests(TestCase):
    def test_index_requires_login(self):
        response = self.client.get(reverse('index'))
        self.assertEqual(response.status_code, 302)
        self.assertIn(reverse('auth'), response['Location'])

    def test_api_requires_login(self):
        response = self.client.get(reverse('progress_collection'))
        self.assertEqual(response.status_code, 401)

    def test_register_logs_in(self):
        response = self.client.post(reverse('register'), {'username': 'alice', 'password': 'pw-123456'})
        self.assertRedirects(response, reverse('index'))
        self.assertEqual(self.client.get(reverse('index')).status_code, 200)

    def test_duplicate_username_is_case_insensitive(self):
        User.objects.create_user('Alice', password='x')
        response = self.client.post(reverse('register'), {'username': 'alice', 'password': 'y'})
        self.assertEqual(response.status_code, 409)

    def test_login_rejects_external_next_url(self):
        User.objects.create_user('bob', password='pw')
        response = self.client.post(
            reverse('login'),
            {'username': 'bob', 'password': 'pw', 'next': 'https://evil.example/'},
        )
        self.assertRedirects(response, reverse('index'))


class ProgressIsolationTests(TestCase):
    def setUp(self):
        self.alice = User.objects.create_user('alice', password='a')
        self.bob = User.objects.create_user('bob', password='b')

    def _put(self, word_id, state):
        return self.client.put(
            reverse('progress_detail', args=[word_id]),
            data=json.dumps(state),
            content_type='application/json',
        )

    def test_word_progress_is_per_user(self):
        self.client.force_login(self.alice)
        self.assertEqual(self._put('L01-01-laconic', {'seen': 3, 'correct': 2}).status_code, 200)

        self.client.force_login(self.bob)
        self.assertEqual(self.client.get(reverse('progress_collection')).json(), {})
        self._put('L01-01-laconic', {'seen': 1})

        self.assertEqual(WordProgress.objects.get(owner=self.alice).seen, 3)
        self.assertEqual(WordProgress.objects.get(owner=self.bob).seen, 1)

    def test_reset_only_deletes_own_progress(self):
        WordProgress.objects.create(owner=self.alice, word_id='w1', seen=1)
        WordProgress.objects.create(owner=self.bob, word_id='w1', seen=1)
        self.client.force_login(self.bob)
        self.client.delete(reverse('progress_collection'))
        self.assertTrue(WordProgress.objects.filter(owner=self.alice).exists())
        self.assertFalse(WordProgress.objects.filter(owner=self.bob).exists())

    def test_list_completion_counter(self):
        self.client.force_login(self.alice)
        for _ in range(2):
            self.client.post(reverse('complete_list', args=[1]))
        self.assertEqual(ListProgress.objects.get(owner=self.alice, list_no=1).completed_count, 2)
        self.client.force_login(self.bob)
        self.assertEqual(self.client.get(reverse('list_progress_collection')).json(), {})
