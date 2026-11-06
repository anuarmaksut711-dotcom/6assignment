from concurrent.futures import ThreadPoolExecutor
from http.cookies import SimpleCookie
from pathlib import Path
from tempfile import TemporaryDirectory
import sqlite3
import unittest
from unittest.mock import patch

from pixel_accounts import AccountError, PixelAccounts


ORIGIN = 'http://127.0.0.1:8879'
PASSWORD = ' Кофе без сахара 42 '


def credentials(email='pixel@example.test', password=PASSWORD):
    return {'email': email, 'password': password}


def browser_cookie(set_cookie):
    return set_cookie.partition(';')[0]


class PixelAccountsTests(unittest.TestCase):
    def setUp(self):
        directory = TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.path = Path(directory.name) / 'accounts.sqlite3'
        self.accounts = PixelAccounts(self.path, ORIGIN)

    def test_registration_session_and_balance_survive_reopen(self):
        profile, cookie = self.accounts.register(
            {**credentials(' Pixel@EXAMPLE.TEST '), 'name': ' Аня ', 'balance': 99999},
            'client',
        )
        self.assertEqual(set(profile), {'uid', 'provider', 'name', 'email', 'balance'})
        self.assertEqual((profile['name'], profile['email'], profile['balance']),
                         ('Аня', 'pixel@example.test', 0))
        self.assertIn('HttpOnly', cookie)
        self.assertIn('SameSite=Lax', cookie)
        self.assertNotIn('Secure', cookie)

        with sqlite3.connect(self.path) as db:
            salt, digest, rounds = db.execute(
                'SELECT password_salt, password_hash, password_rounds FROM accounts'
            ).fetchone()
            stored_token, = db.execute('SELECT token_hash FROM account_sessions').fetchone()
        self.assertEqual((len(salt), len(digest), rounds), (16, 32, 600_000))
        self.assertNotEqual(digest, PASSWORD.encode())
        morsel = SimpleCookie(cookie)['pixel_account']
        self.assertNotEqual(stored_token, morsel.value.encode())
        self.assertEqual(PixelAccounts(self.path, ORIGIN).current_user(browser_cookie(cookie)), profile)

    def test_password_failures_preserve_session_and_run_hash_for_unknown_account(self):
        profile, cookie = self.accounts.register(credentials())
        prior = browser_cookie(cookie)
        with patch.object(self.accounts, '_derive_password', wraps=self.accounts._derive_password) as derive:
            for email in ('PIXEL@EXAMPLE.TEST', 'unregistered@example.test'):
                with self.assertRaises(AccountError) as rejected:
                    self.accounts.login(credentials(email, 'this is an invalid password'),
                                        replace_cookie_header=prior)
                self.assertEqual((rejected.exception.status, rejected.exception.code), (401, 'invalid_credentials'))
        self.assertEqual(derive.call_count, 2)
        self.assertEqual([call.args[2] for call in derive.call_args_list], [600_000, 600_000])
        self.assertEqual(self.accounts.current_user(prior), profile)

        signed_in, rotated = self.accounts.login(credentials('PIXEL@Example.test'), replace_cookie_header=prior)
        self.assertEqual(signed_in, profile)
        self.assertNotEqual(prior, browser_cookie(rotated))
        self.assertIsNone(self.accounts.current_user(prior))
        self.assertEqual(self.accounts.current_user(browser_cookie(rotated)), profile)
        self.assertIn('Max-Age=0', self.accounts.logout(browser_cookie(rotated)))
        self.assertIsNone(self.accounts.current_user(browser_cookie(rotated)))

    def test_same_email_registration_is_atomic_across_clients(self):
        def register(index):
            try:
                return self.accounts.register(credentials(), str(index))[0]
            except AccountError as error:
                return error.code

        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(register, [1, 2]))
        self.assertEqual(sum(isinstance(result, dict) for result in results), 1)
        self.assertIn('email_exists', results)

    def test_profiles_and_balances_are_isolated_by_account_and_provider(self):
        local, local_cookie = self.accounts.register(credentials())
        identity = {'provider': 'google.com', 'uid': 'verified-google-id', 'email': local['email'], 'name': 'Google'}
        google, google_cookie = self.accounts.login_google(identity)
        self.assertNotEqual(local['uid'], google['uid'])
        with sqlite3.connect(self.path) as db:
            db.execute('UPDATE accounts SET balance = ? WHERE uid = ?', (4500, local['uid']))
        self.assertEqual(self.accounts.current_user(browser_cookie(local_cookie))['balance'], 4500)
        self.assertEqual(self.accounts.current_user(browser_cookie(google_cookie))['balance'], 0)
        self.assertEqual(self.accounts.login_google(identity)[0]['uid'], google['uid'])
        with self.assertRaises(AccountError) as rejected:
            self.accounts.login_google({**identity, 'provider': 'phone'})
        self.assertEqual(rejected.exception.code, 'invalid_token')

    def test_session_expiry_secure_cookie_and_loopback_gate(self):
        secure = PixelAccounts(self.path, 'https://pixel.example.test')
        with patch('pixel_accounts.time.time', return_value=1000):
            profile, cookie = secure.register(credentials())
        self.assertTrue(cookie.startswith('__Host-pixel_account='))
        self.assertIn('Secure', cookie)
        with patch('pixel_accounts.time.time', return_value=1000 + 8 * 3600 - 1):
            self.assertEqual(secure.current_user(browser_cookie(cookie)), profile)
        with patch('pixel_accounts.time.time', return_value=1000 + 8 * 3600):
            self.assertIsNone(secure.current_user(browser_cookie(cookie)))
        self.assertIsNone(self.accounts.current_user(browser_cookie(cookie)))
        self.assertIsNone(secure.current_user('__Host-pixel_session=' + 'a' * 43))
        plain = PixelAccounts(self.path, 'http://pixel.example.test')
        self.assertFalse(plain.available)
        with self.assertRaises(AccountError) as rejected:
            plain.register(credentials())
        self.assertEqual(rejected.exception.code, 'auth_unavailable')

    def test_local_session_upgrades_and_renews_across_restarts_until_logout(self):
        start = 1_000_000
        day = 24 * 60 * 60
        with patch('pixel_accounts.time.time', return_value=start):
            profile, old_cookie = self.accounts.register(credentials())
        old = browser_cookie(old_cookie)
        self.assertIn('Max-Age=28800', old_cookie)

        persistent = PixelAccounts(self.path, ORIGIN, remember_sessions=True)
        with patch('pixel_accounts.time.time', return_value=start + 7 * 3600):
            user, first_cookie = persistent.get_session(old, renew=True)
            self.assertEqual(user, profile)
            self.assertIn('Max-Age=34560000', first_cookie)
            # The browser can retry an upgrade if it did not receive the first response.
            self.assertEqual(persistent.get_session(old, renew=True), (profile, first_cookie))
            self.assertEqual(persistent.get_session(browser_cookie(first_cookie), renew=True), (profile, None))

        reopened = PixelAccounts(self.path, ORIGIN, remember_sessions=True)
        with patch('pixel_accounts.time.time', return_value=start + 35 * day):
            user, refreshed = reopened.get_session(browser_cookie(first_cookie), renew=True)
            self.assertEqual(user, profile)
            self.assertIn('Max-Age=34560000', refreshed)
            self.assertEqual(browser_cookie(refreshed), browser_cookie(first_cookie))
        with patch('pixel_accounts.time.time', return_value=start + 420 * day):
            self.assertEqual(reopened.current_user(browser_cookie(refreshed)), profile)
            self.assertIn('Max-Age=0', reopened.logout(browser_cookie(refreshed)))
            self.assertEqual(reopened.get_session(old, renew=True), (None, None))
            self.assertEqual(reopened.get_session(browser_cookie(refreshed), renew=True), (None, None))

    def test_local_session_does_not_restore_an_expired_cookie(self):
        start = 1_000_000
        with patch('pixel_accounts.time.time', return_value=start):
            _, old_cookie = self.accounts.register(credentials())
        persistent = PixelAccounts(self.path, ORIGIN, remember_sessions=True)
        with patch('pixel_accounts.time.time', return_value=start + 8 * 3600):
            self.assertEqual(persistent.get_session(browser_cookie(old_cookie), renew=True), (None, None))
            profile, replacement = persistent.login(credentials())
            self.assertIn('Max-Age=34560000', replacement)
            self.assertEqual(persistent.current_user(browser_cookie(replacement)), profile)

    def test_throttles_login_email_login_ip_and_registration_ip(self):
        with patch.object(self.accounts, '_derive_password', return_value=b'x' * 32) as derive:
            for index in range(8):
                with self.assertRaises(AccountError) as rejected:
                    self.accounts.login(credentials(), str(index))
                self.assertEqual(rejected.exception.code, 'invalid_credentials')
            with self.assertRaises(AccountError) as throttled:
                self.accounts.login(credentials('PIXEL@example.test'), 'new-address')
            self.assertEqual(throttled.exception.status, 429)
            self.assertEqual(derive.call_count, 8)
        for _ in range(30):
            with self.assertRaises(AccountError):
                self.accounts.login({}, 'login-ip')
        with self.assertRaises(AccountError) as throttled:
            self.accounts.login(credentials(), 'login-ip')
        self.assertEqual(throttled.exception.status, 429)
        for _ in range(6):
            with self.assertRaises(AccountError):
                self.accounts.register({}, 'register-ip')
        with self.assertRaises(AccountError) as throttled:
            self.accounts.register(credentials(), 'register-ip')
        self.assertEqual(throttled.exception.status, 429)

    def test_rejects_malformed_signup_fields(self):
        for field, value in [('email', 'not an address'), ('password', 'short'),
                             ('password', 'a' * 129), ('name', 'a\nna')]:
            with self.subTest(field=field), self.assertRaises(AccountError) as rejected:
                self.accounts.register({**credentials(), field: value})
            self.assertEqual(rejected.exception.code, 'invalid_' + field)


if __name__ == '__main__':
    unittest.main()
