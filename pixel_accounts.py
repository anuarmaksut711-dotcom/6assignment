"""PIXEL profiles, browser sessions and the balance ledger."""
from __future__ import annotations

from collections import deque
from contextlib import closing
from datetime import datetime, timezone
from hashlib import pbkdf2_hmac, sha256
from hmac import compare_digest
from http.cookies import SimpleCookie
from ipaddress import ip_address
import json
from pathlib import Path
import re
from secrets import token_bytes, token_urlsafe
import sqlite3
import threading
import time
import unicodedata
from urllib.parse import urlsplit
from uuid import uuid4


_PUBLIC_ROOT = (Path(__file__).resolve().parent / 'demofinal').resolve()
_PBKDF2_ROUNDS = 600_000
_SESSION_AGE = 8 * 60 * 60
_DAY = 24 * 60 * 60
_LOCAL_SESSION_AGE = 400 * _DAY
_PERSISTENT_COOKIE_PREFIX = 'v2.'
_ATTEMPT_WINDOW = 10 * 60
_EMAIL_LOCAL = re.compile(r"[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}")
_DNS_LABEL = re.compile(r'[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?')
_SESSION_TOKEN = re.compile(r'[A-Za-z0-9_-]{43}')
_REQUEST_ID = re.compile(r'[A-Za-z0-9_-]{16,80}')
TOPUP_MIN_AMOUNT = 100
TOPUP_MAX_AMOUNT = 50_000
_DEMO_CARD_LAST4 = '4242'
_PACKAGE_CATALOG = json.loads((_PUBLIC_ROOT / 'assets' / 'club-pricing.json').read_text(encoding='utf-8'))
_FIXED_PACKAGES = {
    item['id']: {key: item[key] for key in ('id', 'room', 'title', 'hours', 'price')}
    for item in _PACKAGE_CATALOG['packages']
    if item['kind'] == 'hours' and not item.get('manualOnly')
}


class AccountError(Exception):
    def __init__(self, status: int, code: str, message: str):
        super().__init__(message)
        self.status, self.code, self.message = status, code, message


def _invalid_credentials():
    return AccountError(401, 'invalid_credentials', 'Неверная почта или пароль.')


def _rate_limit():
    return AccountError(429, 'rate_limit', 'Слишком много попыток. Попробуйте позже.')


def _is_loopback(host):
    host = host.rstrip('.')
    if host == 'localhost' or host.endswith('.localhost'):
        return True
    try:
        return ip_address(host).is_loopback
    except ValueError:
        return False


def _normalize_email(value):
    if not isinstance(value, str) or len(value) > 254:
        raise AccountError(422, 'invalid_email', 'Укажите действующий адрес электронной почты.')
    local, separator, domain = value.strip().rpartition('@')
    try:
        domain = domain.encode('idna').decode('ascii')
    except UnicodeError:
        domain = ''
    if (not separator or len(local) + 1 + len(domain) > 254 or not _EMAIL_LOCAL.fullmatch(local)
            or local.startswith('.') or local.endswith('.') or '..' in local
            or '.' not in domain or not all(_DNS_LABEL.fullmatch(label) for label in domain.split('.'))):
        raise AccountError(422, 'invalid_email', 'Укажите действующий адрес электронной почты.')
    return f'{local.lower()}@{domain.lower()}'


def _password_bytes(value):
    if isinstance(value, str) and 12 <= len(value) <= 128:
        try:
            return value.encode('utf-8')
        except UnicodeEncodeError:
            pass
    raise AccountError(422, 'invalid_password', 'Пароль должен содержать от 12 до 128 символов.')


def _display_name(value):
    if isinstance(value, str):
        name = value.strip()
        if len(name) <= 80 and not any(unicodedata.category(char) in ('Cc', 'Cs') for char in name):
            return name
    raise AccountError(422, 'invalid_name', 'Укажите имя длиной до 80 символов.')


def _public_profile(row):
    return {key: row[key] for key in ('uid', 'provider', 'name', 'email', 'balance')}


def _public_purchase(row):
    return {
        'id': row['id'],
        'packageId': row['package_id'],
        'room': row['room'],
        'title': row['title'],
        'hours': row['hours'],
        'price': row['price'],
        'createdAt': datetime.fromtimestamp(row['created_at'], timezone.utc).isoformat(),
    }


class PixelAccounts:
    def __init__(self, db_path: Path | str, origin: str, *, remember_sessions=False):
        parsed = urlsplit(origin)
        self._secure = parsed.scheme == 'https'
        local_http = parsed.scheme == 'http' and bool(parsed.hostname) and _is_loopback(parsed.hostname)
        self.available = bool(parsed.hostname) and (self._secure or local_http)
        self._remember_sessions = remember_sessions and local_http
        self._session_age = _LOCAL_SESSION_AGE if self._remember_sessions else _SESSION_AGE
        self._cookie_name = '__Host-pixel_account' if self._secure else 'pixel_account'
        self._path = Path(db_path).resolve()
        if self._path.is_relative_to(_PUBLIC_ROOT):
            raise ValueError('The accounts database must be outside the public directory.')
        self._path.parent.mkdir(parents=True, exist_ok=True)
        self._attempt_lock = threading.Lock()
        self._attempts = {}
        self._password_slots = threading.BoundedSemaphore(4)
        with closing(self._connect()) as db, db:
            db.executescript(f"""
                CREATE TABLE IF NOT EXISTS accounts (
                    uid TEXT PRIMARY KEY NOT NULL,
                    provider TEXT NOT NULL CHECK(provider IN ('password', 'google.com')),
                    identifier TEXT NOT NULL,
                    email TEXT NOT NULL,
                    name TEXT NOT NULL,
                    password_salt BLOB,
                    password_hash BLOB,
                    password_rounds INTEGER,
                    balance INTEGER NOT NULL DEFAULT 0
                        CHECK(typeof(balance) = 'integer' AND balance >= 0),
                    UNIQUE(provider, identifier)
                );
                CREATE TABLE IF NOT EXISTS account_sessions (
                    token_hash BLOB PRIMARY KEY NOT NULL,
                    account_uid TEXT NOT NULL REFERENCES accounts(uid) ON DELETE CASCADE,
                    expires_at INTEGER NOT NULL
                );
                CREATE INDEX IF NOT EXISTS account_session_expiry ON account_sessions(expires_at);
                CREATE TABLE IF NOT EXISTS demo_wallets (
                    account_uid TEXT PRIMARY KEY NOT NULL REFERENCES accounts(uid) ON DELETE CASCADE,
                    balance INTEGER NOT NULL DEFAULT 0
                        CHECK(typeof(balance) = 'integer' AND balance >= 0),
                    card_added INTEGER NOT NULL DEFAULT 0 CHECK(card_added IN (0, 1))
                );
                CREATE TABLE IF NOT EXISTS balance_topups (
                    id TEXT PRIMARY KEY NOT NULL,
                    account_uid TEXT NOT NULL REFERENCES accounts(uid) ON DELETE RESTRICT,
                    amount INTEGER NOT NULL CHECK(
                        typeof(amount) = 'integer' AND amount BETWEEN {TOPUP_MIN_AMOUNT} AND {TOPUP_MAX_AMOUNT}
                    ),
                    status TEXT NOT NULL CHECK(status IN ('pending', 'paid')),
                    created_at INTEGER NOT NULL,
                    paid_at INTEGER,
                    CHECK((status = 'paid') = (paid_at IS NOT NULL))
                );
                CREATE TABLE IF NOT EXISTS package_purchases (
                    id TEXT PRIMARY KEY NOT NULL,
                    account_uid TEXT NOT NULL REFERENCES accounts(uid) ON DELETE RESTRICT,
                    request_id TEXT NOT NULL,
                    package_id TEXT NOT NULL,
                    room TEXT NOT NULL,
                    title TEXT NOT NULL,
                    hours INTEGER NOT NULL CHECK(hours > 0),
                    price INTEGER NOT NULL CHECK(typeof(price) = 'integer' AND price > 0),
                    created_at INTEGER NOT NULL,
                    UNIQUE(account_uid, request_id)
                );
            """)

    def _connect(self):
        db = sqlite3.connect(self._path, timeout=5)
        db.row_factory = sqlite3.Row
        db.execute('PRAGMA foreign_keys=ON')
        return db

    def _require_available(self):
        if not self.available:
            raise AccountError(503, 'auth_unavailable', 'Вход доступен только через HTTPS.')

    def _count_attempt(self, limits):
        now = time.monotonic()
        with self._attempt_lock:
            for key, attempts in tuple(self._attempts.items()):
                while attempts and attempts[0] <= now - _ATTEMPT_WINDOW:
                    attempts.popleft()
                if not attempts:
                    del self._attempts[key]
            if any(len(self._attempts.get(key, ())) >= limit for key, limit in limits):
                raise _rate_limit()
            for key, _ in limits:
                self._attempts.setdefault(key, deque()).append(now)

    def _derive_password(self, password, salt, rounds=_PBKDF2_ROUNDS):
        if not self._password_slots.acquire(blocking=False):
            raise _rate_limit()
        try:
            return pbkdf2_hmac('sha256', password, salt, rounds)
        finally:
            self._password_slots.release()

    def _cookie(self, token, max_age):
        cookie = SimpleCookie()
        cookie[self._cookie_name] = token
        morsel = cookie[self._cookie_name]
        morsel['path'] = '/'
        morsel['max-age'] = max_age
        morsel['httponly'] = True
        morsel['samesite'] = 'Lax'
        morsel['secure'] = self._secure
        return morsel.OutputString()

    def _cookie_value(self, cookie_header):
        # Parse the account cookie independently of other localhost apps' cookies.
        values = set()
        for entry in (cookie_header or '').split(';'):
            key, separator, value = entry.partition('=')
            if separator and key.strip() == self._cookie_name:
                values.add(value.strip())
        if len(values) != 1:
            return None
        value, = values
        if _SESSION_TOKEN.fullmatch(value.removeprefix(_PERSISTENT_COOKIE_PREFIX)):
            return value
        return None

    @staticmethod
    def _token_hash(value):
        token = value.removeprefix(_PERSISTENT_COOKIE_PREFIX)
        return sha256(token.encode('ascii')).digest()

    def _persistent_cookie(self, value, max_age):
        return self._cookie(_PERSISTENT_COOKIE_PREFIX + value.removeprefix(_PERSISTENT_COOKIE_PREFIX), max_age)

    def _new_session(self, db, row, replace_cookie_header):
        now = int(time.time())
        token = token_urlsafe(32)
        previous = self._cookie_value(replace_cookie_header)
        db.execute('DELETE FROM account_sessions WHERE expires_at <= ?', (now,))
        if previous is not None:
            db.execute('DELETE FROM account_sessions WHERE token_hash = ?', (self._token_hash(previous),))
        db.execute(
            'INSERT INTO account_sessions (token_hash, account_uid, expires_at) VALUES (?, ?, ?)',
            (self._token_hash(token), row['uid'], now + self._session_age),
        )
        cookie = self._persistent_cookie if self._remember_sessions else self._cookie
        return _public_profile(row), cookie(token, self._session_age)

    def register(self, payload, client_ip='', *, replace_cookie_header=None):
        self._require_available()
        self._count_attempt([(('register-ip', client_ip), 6)])
        email = _normalize_email(payload.get('email'))
        password = _password_bytes(payload.get('password'))
        name = _display_name(payload.get('name', ''))
        salt = token_bytes(16)
        password_hash = self._derive_password(password, salt)
        uid = uuid4().hex
        with closing(self._connect()) as db, db:
            cursor = db.execute(
                """INSERT INTO accounts
                    (uid, provider, identifier, email, name, password_salt, password_hash, password_rounds)
                    VALUES (?, 'password', ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(provider, identifier) DO NOTHING""",
                (uid, email, email, name, salt, password_hash, _PBKDF2_ROUNDS),
            )
            if cursor.rowcount == 0:
                raise AccountError(409, 'email_exists', 'Аккаунт с этой почтой уже есть. Войдите с паролем.')
            row = db.execute('SELECT * FROM accounts WHERE uid = ?', (uid,)).fetchone()
            return self._new_session(db, row, replace_cookie_header)

    def login(self, payload, client_ip='', *, replace_cookie_header=None):
        self._require_available()
        ip_limit = (('login-ip', client_ip), 30)
        try:
            email = _normalize_email(payload.get('email'))
            password = _password_bytes(payload.get('password'))
        except AccountError:
            self._count_attempt([ip_limit])
            raise _invalid_credentials() from None
        email_key = ('login-account', email)
        self._count_attempt([ip_limit, (email_key, 8)])
        with closing(self._connect()) as db, db:
            row = db.execute(
                "SELECT * FROM accounts WHERE provider = 'password' AND identifier = ?", (email,)
            ).fetchone()
            # Unknown addresses take the same password hashing path as an incorrect password.
            salt, rounds, expected = (
                (row['password_salt'], row['password_rounds'], row['password_hash'])
                if row else (bytes(16), _PBKDF2_ROUNDS, bytes(32))
            )
            actual = self._derive_password(password, salt, rounds)
            if not compare_digest(expected, actual) or row is None:
                raise _invalid_credentials()
            result = self._new_session(db, row, replace_cookie_header)
        with self._attempt_lock:
            self._attempts.pop(email_key, None)
        return result

    def login_google(self, verified_user, *, replace_cookie_header=None):
        """Provision a profile from a verified Google identity, never from client input."""
        self._require_available()
        identifier = verified_user.get('uid')
        if (verified_user.get('provider') != 'google.com'
                or not isinstance(identifier, str) or not 0 < len(identifier) <= 128):
            raise AccountError(401, 'invalid_token', 'Не удалось подтвердить аккаунт Google.')
        email = verified_user.get('email', '')
        name = verified_user.get('name', '')
        with closing(self._connect()) as db, db:
            db.execute(
                """INSERT INTO accounts (uid, provider, identifier, email, name)
                    VALUES (?, 'google.com', ?, ?, ?)
                    ON CONFLICT(provider, identifier) DO NOTHING""",
                (uuid4().hex, identifier, email, name),
            )
            row = db.execute(
                "SELECT * FROM accounts WHERE provider = 'google.com' AND identifier = ?", (identifier,)
            ).fetchone()
            return self._new_session(db, row, replace_cookie_header)

    def get_session(self, cookie_header, *, renew=False):
        value = self._cookie_value(cookie_header)
        if not self.available or value is None:
            return None, None
        token_hash = self._token_hash(value)
        now = int(time.time())
        with closing(self._connect()) as db:
            row = db.execute(
                """SELECT accounts.*, account_sessions.expires_at FROM account_sessions
                    JOIN accounts ON accounts.uid = account_sessions.account_uid
                    WHERE token_hash = ? AND expires_at > ?""",
                (token_hash, now),
            ).fetchone()
            if row is None:
                return None, None
            profile = _public_profile(row)
            if not renew or not self._remember_sessions:
                return profile, None

            remaining = row['expires_at'] - now
            # Renew at most daily for current cookies; upgrade old cookies while still valid.
            if remaining > _LOCAL_SESSION_AGE - _DAY:
                if value.startswith(_PERSISTENT_COOKIE_PREFIX):
                    return profile, None
                return profile, self._persistent_cookie(value, min(remaining, _LOCAL_SESSION_AGE))

            with db:
                updated = db.execute(
                    """UPDATE account_sessions SET expires_at = MAX(expires_at, ?)
                        WHERE token_hash = ? AND expires_at > ?""",
                    (now + _LOCAL_SESSION_AGE, token_hash, now),
                )
            if not updated.rowcount:
                return None, None
            return profile, self._persistent_cookie(value, _LOCAL_SESSION_AGE)

    def current_user(self, cookie_header):
        return self.get_session(cookie_header)[0]

    def logout(self, cookie_header):
        value = self._cookie_value(cookie_header)
        if value is not None:
            with closing(self._connect()) as db, db:
                db.execute('DELETE FROM account_sessions WHERE token_hash = ?', (self._token_hash(value),))
        return self._cookie('', 0)

    def wallet_balance(self, uid):
        with closing(self._connect()) as db:
            row = db.execute('SELECT balance FROM demo_wallets WHERE account_uid = ?', (uid,)).fetchone()
            return row['balance'] if row is not None else 0

    def get_demo_card(self, uid):
        with closing(self._connect()) as db:
            row = db.execute('SELECT card_added FROM demo_wallets WHERE account_uid = ?', (uid,)).fetchone()
            return {'last4': _DEMO_CARD_LAST4} if row is not None and row['card_added'] else None

    def add_demo_card(self, uid):
        self._require_available()
        with closing(self._connect()) as db, db:
            inserted = db.execute(
                """INSERT INTO demo_wallets (account_uid, card_added)
                    SELECT uid, 1 FROM accounts WHERE uid = ?
                    ON CONFLICT(account_uid) DO UPDATE SET card_added = 1""",
                (uid,),
            )
            if not inserted.rowcount:
                raise AccountError(401, 'auth_required', 'Войдите в аккаунт.')
        return {'last4': _DEMO_CARD_LAST4}

    def create_topup(self, uid, amount):
        """Create an unpaid order for the explicitly enabled local payment sandbox."""
        self._require_available()
        if type(amount) is not int or not TOPUP_MIN_AMOUNT <= amount <= TOPUP_MAX_AMOUNT:
            raise AccountError(422, 'invalid_amount', 'Укажите целую сумму от 100 до 50 000 ₸.')
        order_id = uuid4().hex
        with closing(self._connect()) as db, db:
            inserted = db.execute(
                """INSERT INTO balance_topups (id, account_uid, amount, status, created_at)
                    SELECT ?, uid, ?, 'pending', ? FROM accounts WHERE uid = ?""",
                (order_id, amount, int(time.time()), uid),
            )
            if not inserted.rowcount:
                raise AccountError(401, 'auth_required', 'Войдите в аккаунт.')
        return {'id': order_id, 'amount': amount, 'status': 'pending'}

    @staticmethod
    def _topup_details(db, uid, order_id):
        row = db.execute(
            """SELECT balance_topups.id, balance_topups.amount, balance_topups.status,
                    COALESCE(demo_wallets.balance, 0) AS balance
                FROM balance_topups LEFT JOIN demo_wallets
                    ON demo_wallets.account_uid = balance_topups.account_uid
                WHERE balance_topups.id = ? AND balance_topups.account_uid = ?""",
            (order_id, uid),
        ).fetchone()
        if row is None:
            raise AccountError(404, 'topup_not_found', 'Пополнение не найдено.')
        return dict(row)

    def get_topup(self, uid, order_id):
        with closing(self._connect()) as db:
            return self._topup_details(db, uid, order_id)

    def confirm_topup(self, uid, order_id):
        """Apply one sandbox confirmation. The caller must enforce sandbox mode."""
        self._require_available()
        with closing(self._connect()) as db, db:
            db.execute('BEGIN IMMEDIATE')
            order = self._topup_details(db, uid, order_id)
            if order['status'] == 'paid':
                return order
            wallet = db.execute(
                'SELECT card_added FROM demo_wallets WHERE account_uid = ?', (uid,),
            ).fetchone()
            if wallet is None or not wallet['card_added']:
                raise AccountError(409, 'demo_card_required', 'Сначала добавьте тестовую карту.')
            db.execute(
                "UPDATE balance_topups SET status = 'paid', paid_at = ? WHERE id = ?",
                (int(time.time()), order_id),
            )
            db.execute(
                'UPDATE demo_wallets SET balance = balance + ? WHERE account_uid = ?', (order['amount'], uid),
            )
            return self._topup_details(db, uid, order_id)

    @staticmethod
    def list_packages():
        return [item.copy() for item in _FIXED_PACKAGES.values()]

    def purchase_package(self, uid, package_id, request_id):
        """Debit the server catalog price and save the purchase in one transaction."""
        self._require_available()
        if not isinstance(request_id, str) or not _REQUEST_ID.fullmatch(request_id):
            raise AccountError(422, 'invalid_request', 'Не удалось подготовить покупку. Повторите попытку.')
        if not isinstance(package_id, str):
            raise AccountError(422, 'invalid_package', 'Выберите пакет.')

        with closing(self._connect()) as db, db:
            db.execute('BEGIN IMMEDIATE')
            account = db.execute(
                """SELECT COALESCE(demo_wallets.balance, 0) AS balance
                    FROM accounts LEFT JOIN demo_wallets ON demo_wallets.account_uid = accounts.uid
                    WHERE accounts.uid = ?""",
                (uid,),
            ).fetchone()
            if account is None:
                raise AccountError(401, 'auth_required', 'Войдите в аккаунт.')
            row = db.execute(
                'SELECT * FROM package_purchases WHERE account_uid = ? AND request_id = ?',
                (uid, request_id),
            ).fetchone()
            if row is not None:
                if row['package_id'] != package_id:
                    raise AccountError(409, 'purchase_conflict', 'Этот запрос уже использован для другой покупки.')
                return {'purchase': _public_purchase(row), 'balance': account['balance']}

            package = _FIXED_PACKAGES.get(package_id)
            if package is None:
                raise AccountError(422, 'invalid_package', 'Выберите пакет.')
            balance = account['balance'] - package['price']
            if balance < 0:
                raise AccountError(409, 'insufficient_balance', 'На балансе не хватает средств.')
            db.execute('UPDATE demo_wallets SET balance = ? WHERE account_uid = ?', (balance, uid))
            purchase_id = uuid4().hex
            db.execute(
                """INSERT INTO package_purchases
                    (id, account_uid, request_id, package_id, room, title, hours, price, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (purchase_id, uid, request_id, package_id, package['room'],
                 package['title'], package['hours'], package['price'], int(time.time())),
            )
            row = db.execute('SELECT * FROM package_purchases WHERE id = ?', (purchase_id,)).fetchone()
            return {'purchase': _public_purchase(row), 'balance': balance}

    def get_purchases(self, uid):
        with closing(self._connect()) as db:
            rows = db.execute(
                'SELECT * FROM package_purchases WHERE account_uid = ? ORDER BY created_at DESC, rowid DESC',
                (uid,),
            )
            return [_public_purchase(row) for row in rows]
