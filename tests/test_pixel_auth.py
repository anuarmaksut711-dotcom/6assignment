"""Exercise the auth boundaries with mocked Firebase Admin calls and no network."""

import os
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

from pixel_auth import AUTH_SETTING_KEYS, AuthError, PixelAuth


_SETTINGS = dict(zip(AUTH_SETTING_KEYS, (
    'fake-web-api-key', 'pixel-test.firebaseapp.com', 'pixel-test', '1:12345:web:abcdef',
)))
_PUBLIC_ORIGIN = 'https://pixel.example'
_ID_TOKEN = 'id.payload.signature'
_NOW = 1_800_000_000


class FakeServiceError(Exception):
    pass


class InvalidIdTokenError(FakeServiceError):
    pass


class UserDisabledError(FakeServiceError):
    pass


class UserNotFoundError(FakeServiceError):
    pass


class PixelAuthTests(unittest.TestCase):
    def setUp(self):
        self.claims = {
            'uid': 'firebase-user',
            'aud': 'pixel-test',
            'iss': 'https://securetoken.google.com/pixel-test',
            'firebase': {'sign_in_provider': 'google.com'},
            'name': ' Guest ',
            'email': 'guest@example.com',
            'email_verified': True,
            'auth_time': _NOW - 1,
        }
        self.firebase = SimpleNamespace(
            InvalidIdTokenError=InvalidIdTokenError,
            UserDisabledError=UserDisabledError,
            UserNotFoundError=UserNotFoundError,
            verify_id_token=Mock(return_value=self.claims),
        )
        self.app = object()
        self.credential_file = str(Path('test-credential-fixture.json').resolve())
        env = patch.dict(os.environ, {
            'GOOGLE_APPLICATION_CREDENTIALS': self.credential_file,
            'FIREBASE_AUTH_EMULATOR_HOST': '',
        })
        env.start()
        self.addCleanup(env.stop)
        sdk = patch('pixel_auth._firebase_setup', return_value=(self.firebase, self.app, (FakeServiceError,)))
        self.setup_sdk = sdk.start()
        self.addCleanup(sdk.stop)
        clock = patch('pixel_auth.time.time', return_value=_NOW)
        clock.start()
        self.addCleanup(clock.stop)
        self.auth = PixelAuth(_SETTINGS, _PUBLIC_ORIGIN)

    def test_setup_requires_safe_origin_and_private_credentials(self):
        self.assertFalse(PixelAuth({}, _PUBLIC_ORIGIN).client_config()['enabled'])
        self.assertFalse(PixelAuth(_SETTINGS, 'http://pixel.example').client_config()['enabled'])
        with patch.dict(os.environ, {'GOOGLE_APPLICATION_CREDENTIALS': ''}):
            self.assertFalse(PixelAuth(_SETTINGS, _PUBLIC_ORIGIN).client_config()['enabled'])
        with patch.dict(os.environ, {'GOOGLE_APPLICATION_CREDENTIALS': 'demofinal/account.json'}):
            self.assertFalse(PixelAuth(_SETTINGS, _PUBLIC_ORIGIN).client_config()['enabled'])
        with patch.dict(os.environ, {'FIREBASE_AUTH_EMULATOR_HOST': '127.0.0.1:9099'}):
            self.assertFalse(self.auth.client_config()['enabled'])
            with self.assertRaises(AuthError) as error:
                self.auth.verify_google({'idToken': _ID_TOKEN})
            self.assertEqual(error.exception.status, 503)
        self.setup_sdk.assert_not_called()

    def test_invalid_admin_setup_does_not_enable_sign_in(self):
        self.setup_sdk.side_effect = ValueError('private credential details')
        self.assertEqual(self.auth.client_config(), {
            'enabled': False, 'googleEnabled': False, 'firebase': None,
        })
        with self.assertRaises(AuthError) as error:
            self.auth.verify_google({'idToken': _ID_TOKEN})
        self.assertEqual(error.exception.status, 503)
        self.assertNotIn('private credential details', str(error.exception))

    def test_client_config_exposes_only_web_values(self):
        cfg = self.auth.client_config()
        self.assertEqual(cfg, {
            'enabled': True,
            'googleEnabled': True,
            'firebase': {
                'apiKey': 'fake-web-api-key', 'authDomain': 'pixel-test.firebaseapp.com',
                'projectId': 'pixel-test', 'appId': '1:12345:web:abcdef',
            },
        })
        self.setup_sdk.assert_called_once_with('pixel-test', Path(self.credential_file))

    def test_csrf_rejects_every_other_origin(self):
        self.auth.require_origin(_PUBLIC_ORIGIN)
        for origin in (None, 'null', 'http://pixel.example', 'https://pixel.example.attacker.test',
                       'https://pixel.example:3000', _PUBLIC_ORIGIN + '/'):
            with self.subTest(origin=origin), self.assertRaises(AuthError) as error:
                self.auth.require_origin(origin)
            self.assertEqual((error.exception.status, error.exception.code), (403, 'auth_origin'))

    def test_google_token_verification_and_profile(self):
        user = self.auth.verify_google({'idToken': _ID_TOKEN})
        self.assertEqual(user, {
            'uid': 'firebase-user', 'provider': 'google.com', 'name': 'Guest',
            'email': 'guest@example.com',
        })
        self.firebase.verify_id_token.assert_called_once_with(_ID_TOKEN, app=self.app, check_revoked=True)
        self.claims['email_verified'] = False
        self.assertEqual(self.auth.verify_google({'idToken': _ID_TOKEN})['email'], '')

    def test_localhost_can_enable_optional_google_sign_in(self):
        for origin in ('http://127.0.0.1:8898', 'http://localhost:8898', 'https://[::1]:8898'):
            local = PixelAuth(_SETTINGS, origin)
            self.assertTrue(local.client_config()['googleEnabled'])
            self.assertEqual(local.verify_google({'idToken': _ID_TOKEN})['provider'], 'google.com')

    def test_rejects_wrong_project_issuer_and_non_google_providers(self):
        invalid_claims = (
            {'aud': 'other-project'},
            {'iss': 'https://securetoken.google.com/other-project'},
            {'firebase': {'sign_in_provider': 'phone'}},
            {'firebase': {'sign_in_provider': 'password'}},
            {'uid': ''},
        )
        for overrides in invalid_claims:
            self.firebase.verify_id_token.return_value = {**self.claims, **overrides}
            with self.subTest(overrides=overrides), self.assertRaises(AuthError) as error:
                self.auth.verify_google({'idToken': _ID_TOKEN})
            self.assertEqual((error.exception.status, error.exception.code), (401, 'invalid_token'))

    def test_rejects_malformed_token_and_stale_login(self):
        for payload in ({}, {'idToken': 'unsigned'}, {'idToken': 42}, {'idToken': 'a.b.'}):
            with self.subTest(payload=payload), self.assertRaises(AuthError) as error:
                self.auth.verify_google(payload)
            self.assertEqual(error.exception.status, 401)
        self.firebase.verify_id_token.assert_not_called()
        for auth_time in (_NOW - 301, _NOW + 1, None, True):
            self.claims['auth_time'] = auth_time
            with self.subTest(auth_time=auth_time), self.assertRaises(AuthError) as error:
                self.auth.verify_google({'idToken': _ID_TOKEN})
            self.assertEqual(error.exception.code, 'recent_sign_in')

    def test_revoked_and_unavailable_credentials_fail_closed(self):
        for error_type in (InvalidIdTokenError, UserDisabledError, UserNotFoundError):
            self.firebase.verify_id_token.side_effect = error_type('private verification details')
            with self.subTest(error_type=error_type), self.assertRaises(AuthError) as error:
                self.auth.verify_google({'idToken': _ID_TOKEN})
            self.assertEqual(error.exception.status, 401)
            self.assertNotIn('private verification details', str(error.exception))
        self.firebase.verify_id_token.side_effect = FakeServiceError('provider outage')
        with self.assertRaises(AuthError) as error:
            self.auth.verify_google({'idToken': _ID_TOKEN})
        self.assertEqual(error.exception.status, 503)


if __name__ == '__main__':
    unittest.main()
