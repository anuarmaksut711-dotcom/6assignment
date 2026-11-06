"""Verify optional Google sign-in with Firebase before issuing a PIXEL session."""
from __future__ import annotations

from ipaddress import ip_address
import json
import os
from pathlib import Path
import re
import threading
import time
from urllib.parse import urlsplit
from uuid import uuid4


_FIREBASE_CONFIG_FIELDS = {
    'FIREBASE_API_KEY': 'apiKey',
    'FIREBASE_AUTH_DOMAIN': 'authDomain',
    'FIREBASE_PROJECT_ID': 'projectId',
    'FIREBASE_APP_ID': 'appId',
}
AUTH_SETTING_KEYS = tuple(_FIREBASE_CONFIG_FIELDS)
_PUBLIC_ROOT = (Path(__file__).resolve().parent / 'demofinal').resolve()
_RECENT_SIGN_IN_SECONDS = 5 * 60
_JWT = re.compile(r'[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+')


class AuthError(Exception):
    def __init__(self, status: int, code: str, message: str):
        super().__init__(message)
        self.status, self.code, self.message = status, code, message


def _unavailable() -> AuthError:
    return AuthError(503, 'auth_unavailable', 'Вход пока недоступен. Попробуйте позже.')


def _invalid_token() -> AuthError:
    return AuthError(401, 'invalid_token', 'Не удалось подтвердить вход. Войдите ещё раз.')


def _is_loopback(host: str) -> bool:
    host = host.rstrip('.')
    if host == 'localhost' or host.endswith('.localhost'):
        return True
    try:
        return ip_address(host).is_loopback
    except ValueError:
        return False


def _firebase_setup(project_id: str, credential_file: Path):
    # Loading the key is local. Token verification can contact Firebase.
    import firebase_admin
    from firebase_admin import auth, credentials, exceptions
    from google.auth.exceptions import GoogleAuthError

    with credential_file.open(encoding='utf-8-sig') as file:
        key_data = json.load(file)
    if not isinstance(key_data, dict):
        raise ValueError('Expected a service account JSON object.')
    credential = credentials.Certificate(key_data)
    if credential.project_id != project_id:
        raise ValueError('Firebase project and service account do not match.')
    app = firebase_admin.initialize_app(
        credential,
        {'projectId': project_id, 'httpTimeout': 10},
        name=f'pixel-auth-{uuid4().hex}',
    )
    return auth, app, (exceptions.FirebaseError, GoogleAuthError, ValueError)


def _claim_text(claims: dict, key: str, limit: int) -> str:
    value = claims.get(key)
    return value.strip()[:limit] if isinstance(value, str) else ''


def _google_profile(claims: dict) -> dict:
    firebase_claims = claims.get('firebase')
    provider = firebase_claims.get('sign_in_provider') if isinstance(firebase_claims, dict) else None
    uid = claims.get('uid')
    if provider != 'google.com' or not isinstance(uid, str) or not 0 < len(uid) <= 128:
        raise _invalid_token()
    return {
        'uid': uid,
        'provider': 'google.com',
        'name': _claim_text(claims, 'name', 160),
        'email': _claim_text(claims, 'email', 254) if claims.get('email_verified') is True else '',
    }


class PixelAuth:
    def __init__(self, settings: dict, origin: str):
        self.origin = origin
        parsed = urlsplit(origin)
        self._allowed_transport = parsed.scheme == 'https' or (
            parsed.scheme == 'http' and _is_loopback(parsed.hostname or '')
        )
        self._web_config = {field: settings.get(key, '').strip() for key, field in _FIREBASE_CONFIG_FIELDS.items()}
        credential_file = os.environ.get('GOOGLE_APPLICATION_CREDENTIALS')
        try:
            self.credential_file = Path(credential_file).expanduser().resolve() if credential_file else None
        except (OSError, RuntimeError, ValueError):
            self.credential_file = None
        self._sdk_lock = threading.Lock()
        self._firebase = None

    def require_origin(self, origin: str | None):
        # POSTs also require application/json and the server does not grant cross-origin access.
        if origin != self.origin:
            raise AuthError(403, 'auth_origin', 'Откройте страницу входа на сайте клуба.')

    def _sdk(self):
        if (not self._allowed_transport or not all(self._web_config.values()) or not self.credential_file
                or self.credential_file.is_relative_to(_PUBLIC_ROOT)
                or os.environ.get('FIREBASE_AUTH_EMULATOR_HOST')):
            raise _unavailable()
        with self._sdk_lock:
            if self._firebase is None:
                try:
                    self._firebase = _firebase_setup(self._web_config['projectId'], self.credential_file)
                except (ImportError, OSError, ValueError):
                    raise _unavailable() from None
        return self._firebase

    def client_config(self) -> dict:
        try:
            self._sdk()
        except AuthError:
            return {'enabled': False, 'googleEnabled': False, 'firebase': None}
        return {
            'enabled': True,
            'googleEnabled': True,
            'firebase': self._web_config.copy(),
        }

    def verify_google(self, payload) -> dict:
        auth, app, service_errors = self._sdk()
        token = payload.get('idToken') if isinstance(payload, dict) else None
        if not isinstance(token, str) or len(token) > 8192 or not _JWT.fullmatch(token):
            raise _invalid_token()
        try:
            claims = auth.verify_id_token(token, app=app, check_revoked=True)
        except (auth.InvalidIdTokenError, auth.UserDisabledError, auth.UserNotFoundError):
            raise _invalid_token() from None
        except service_errors:
            raise _unavailable() from None
        project_id = self._web_config['projectId']
        if claims.get('aud') != project_id or claims.get('iss') != f'https://securetoken.google.com/{project_id}':
            raise _invalid_token()
        user = _google_profile(claims)
        auth_time = claims.get('auth_time')
        if type(auth_time) is not int or not 0 <= time.time() - auth_time <= _RECENT_SIGN_IN_SECONDS:
            raise AuthError(401, 'recent_sign_in', 'Войдите ещё раз, чтобы открыть личный кабинет.')
        return user
