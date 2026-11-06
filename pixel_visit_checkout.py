"""Server-owned orders and reservations for the local visit demo."""
from __future__ import annotations

from contextlib import closing
from hashlib import sha256
import json
import re
import time
from uuid import uuid4

from pixel_accounts import AccountError


_REQUEST_ID = re.compile(r'[A-Za-z0-9_-]{16,80}')
_GUEST_PROOF = re.compile(r'[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}')


def request_fingerprint(payload, invalid):
    try:
        intent = json.dumps(payload, sort_keys=True, ensure_ascii=True, allow_nan=False, separators=(',', ':'))
    except (ValueError, RecursionError):
        raise AccountError(400, 'invalid', invalid) from None
    return sha256(intent.encode('ascii')).hexdigest()


class VisitCheckout:
    def __init__(self, connect, quote, plan_start):
        self.connect = connect
        self.quote = quote
        with closing(self.connect()) as db, db:
            db.execute('BEGIN IMMEDIATE')
            db.execute("""
                CREATE TABLE IF NOT EXISTS visit_checkout_orders (
                    id TEXT PRIMARY KEY,
                    account_uid TEXT NOT NULL REFERENCES accounts(uid) ON DELETE RESTRICT,
                    request_id TEXT NOT NULL,
                    fingerprint TEXT NOT NULL,
                    method TEXT NOT NULL CHECK(method IN ('card', 'balance')),
                    plan TEXT NOT NULL,
                    amount INTEGER NOT NULL CHECK(amount > 0),
                    starts_at INTEGER NOT NULL,
                    created_at INTEGER NOT NULL,
                    paid_at INTEGER,
                    cancelled_at INTEGER,
                    UNIQUE(account_uid, request_id)
                )
            """)
            db.execute("""
                CREATE TABLE IF NOT EXISTS visit_reservations (
                    id TEXT PRIMARY KEY,
                    request_id TEXT NOT NULL UNIQUE,
                    fingerprint TEXT NOT NULL,
                    plan TEXT NOT NULL,
                    amount INTEGER NOT NULL CHECK(amount > 0),
                    created_at INTEGER NOT NULL,
                    account_uid TEXT REFERENCES accounts(uid) ON DELETE RESTRICT,
                    starts_at INTEGER NOT NULL,
                    cancelled_at INTEGER
                )
            """)
            self._migrate_existing_visits(db, plan_start)

    @staticmethod
    def _migrate_existing_visits(db, plan_start):
        order_columns = {row['name'] for row in db.execute('PRAGMA table_info(visit_checkout_orders)')}
        if 'cancelled_at' not in order_columns:
            db.execute('ALTER TABLE visit_checkout_orders ADD COLUMN cancelled_at INTEGER')
        reservation_columns = {row['name'] for row in db.execute('PRAGMA table_info(visit_reservations)')}
        if 'account_uid' not in reservation_columns:
            db.execute('ALTER TABLE visit_reservations ADD COLUMN account_uid TEXT REFERENCES accounts(uid) ON DELETE RESTRICT')
        if 'cancelled_at' not in reservation_columns:
            db.execute('ALTER TABLE visit_reservations ADD COLUMN cancelled_at INTEGER')
        if 'starts_at' not in reservation_columns:
            db.execute('ALTER TABLE visit_reservations ADD COLUMN starts_at INTEGER')
            for row in db.execute('SELECT id, plan FROM visit_reservations').fetchall():
                try:
                    plan = json.loads(row['plan'])
                    starts_at = int(plan_start(plan['date'], plan['time']).timestamp())
                except (KeyError, TypeError, ValueError, OverflowError, OSError):
                    continue
                db.execute('UPDATE visit_reservations SET starts_at = ? WHERE id = ?', (starts_at, row['id']))

    @staticmethod
    def _balance(db, uid):
        row = db.execute('SELECT balance FROM demo_wallets WHERE account_uid = ?', (uid,)).fetchone()
        return row['balance'] if row else 0

    def _result(self, db, row):
        status = 'paid' if row['paid_at'] is not None else 'pending'
        result = {
            'id': row['id'],
            'method': row['method'],
            'amount': row['amount'],
            'status': 'cancelled' if row['cancelled_at'] is not None else status,
            'plan': json.loads(row['plan']),
        }
        if row['method'] == 'balance':
            result['balance'] = self._balance(db, row['account_uid'])
        return result

    @staticmethod
    def _get_order(db, uid, order_id):
        row = db.execute('SELECT * FROM visit_checkout_orders WHERE account_uid = ? AND id = ?',
                         (uid, order_id)).fetchone()
        if row is None:
            raise AccountError(404, 'order_not_found', 'Оплата визита не найдена.')
        return row

    def get_order(self, uid, order_id):
        with closing(self.connect()) as db:
            return self._result(db, self._get_order(db, uid, order_id))

    def start_order(self, uid, payload):
        plan = payload.get('plan')
        method = payload.get('method')
        request_id = payload.get('requestId')
        expected_amount = payload.get('expectedAmount')
        invalid = 'Проверьте данные оплаты визита.'
        if (set(payload) - {'plan', 'method', 'requestId', 'expectedAmount'} or not isinstance(plan, dict)
                or method not in ('card', 'balance') or not isinstance(request_id, str)
                or not _REQUEST_ID.fullmatch(request_id)
                or ('expectedAmount' in payload and (type(expected_amount) is not int or expected_amount <= 0))):
            raise AccountError(400, 'invalid', invalid)
        fingerprint = request_fingerprint(payload, invalid)

        with closing(self.connect()) as db, db:
            db.execute('BEGIN IMMEDIATE')
            previous = db.execute('SELECT * FROM visit_checkout_orders WHERE account_uid = ? AND request_id = ?',
                                  (uid, request_id)).fetchone()
            if previous:
                if previous['fingerprint'] != fingerprint:
                    raise AccountError(409, 'request_conflict', 'Параметры визита изменились. Начните оплату снова.')
                return self._result(db, previous)

            checked, amount, starts_at = self.quote(plan)
            if expected_amount is not None and expected_amount != amount:
                raise AccountError(409, 'price_changed', 'Стоимость изменилась. Вернитесь к плану и проверьте итог.')
            if method == 'balance':
                changed = db.execute('UPDATE demo_wallets SET balance = balance - ? WHERE account_uid = ? AND balance >= ?',
                                     (amount, uid, amount))
                if changed.rowcount != 1:
                    raise AccountError(409, 'insufficient_balance', 'На балансе не хватает средств.')

            order_id = uuid4().hex
            now = int(time.time())
            db.execute("""
                INSERT INTO visit_checkout_orders
                    (id, account_uid, request_id, fingerprint, method, plan, amount, starts_at, created_at, paid_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (order_id, uid, request_id, fingerprint, method, json.dumps(checked, ensure_ascii=False),
                  amount, starts_at, now, now if method == 'balance' else None))
            return self._result(db, self._get_order(db, uid, order_id))

    def confirm_card(self, uid, order_id):
        with closing(self.connect()) as db, db:
            db.execute('BEGIN IMMEDIATE')
            row = self._get_order(db, uid, order_id)
            if row['method'] != 'card':
                raise AccountError(409, 'payment_method', 'Для этой оплаты выбран баланс.')
            if row['cancelled_at'] is not None:
                raise AccountError(409, 'visit_cancelled', 'Визит уже отменён.')
            if row['paid_at'] is not None:
                return self._result(db, row)
            now = int(time.time())
            if row['starts_at'] <= now:
                raise AccountError(409, 'visit_expired', 'Время визита уже прошло. Выберите новое время.')
            db.execute('UPDATE visit_checkout_orders SET paid_at = ? WHERE id = ?', (now, order_id))
            return self._result(db, self._get_order(db, uid, order_id))

    @staticmethod
    def _reservation_result(row):
        if row is None:
            raise AccountError(404, 'reservation_not_found', 'Бронь не найдена.')
        return {
            'id': row['id'],
            'plan': json.loads(row['plan']),
            'amount': row['amount'],
            'status': 'cancelled' if row['cancelled_at'] is not None else 'reserved',
        }

    def get_reservation(self, reservation_id):
        with closing(self.connect()) as db:
            row = db.execute('SELECT * FROM visit_reservations WHERE id = ?', (reservation_id,)).fetchone()
            return self._reservation_result(row)

    def start_reservation(self, payload, uid=None):
        plan = payload.get('plan')
        request_id = payload.get('requestId')
        invalid = 'Проверьте данные брони.'
        if (set(payload) != {'plan', 'requestId'} or not isinstance(plan, dict)
                or not isinstance(request_id, str) or not _REQUEST_ID.fullmatch(request_id)):
            raise AccountError(400, 'invalid', invalid)
        fingerprint = request_fingerprint(payload, invalid)

        with closing(self.connect()) as db, db:
            db.execute('BEGIN IMMEDIATE')
            previous = db.execute('SELECT * FROM visit_reservations WHERE request_id = ?', (request_id,)).fetchone()
            if previous:
                if previous['fingerprint'] != fingerprint or previous['account_uid'] not in (None, uid):
                    raise AccountError(409, 'request_conflict', 'Параметры визита изменились. Создайте новую бронь.')
                return self._reservation_result(previous)

            checked, amount, starts_at = self.quote(plan)
            reservation_id = uuid4().hex
            db.execute("""
                INSERT INTO visit_reservations
                    (id, request_id, fingerprint, plan, amount, created_at, account_uid, starts_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """, (reservation_id, request_id, fingerprint, json.dumps(checked, ensure_ascii=False), amount,
                  int(time.time()), uid, starts_at))
            return {'id': reservation_id, 'plan': checked, 'amount': amount, 'status': 'reserved'}

    def claim_reservation(self, uid, payload):
        request_id = payload.get('requestId')
        if set(payload) != {'requestId'} or not isinstance(request_id, str) or not _GUEST_PROOF.fullmatch(request_id):
            raise AccountError(400, 'invalid', 'Не удалось привязать бронь.')
        with closing(self.connect()) as db, db:
            db.execute('BEGIN IMMEDIATE')
            row = db.execute('SELECT * FROM visit_reservations WHERE request_id = ?', (request_id,)).fetchone()
            if row is None or row['account_uid'] not in (None, uid):
                raise AccountError(404, 'reservation_not_found', 'Бронь не найдена.')
            if row['account_uid'] is None:
                db.execute('UPDATE visit_reservations SET account_uid = ? WHERE id = ?', (uid, row['id']))
            return self._reservation_result(row)

    def active_visits(self, uid):
        now = int(time.time())
        with closing(self.connect()) as db, db:
            db.execute('BEGIN')
            rows = db.execute("""
                SELECT id, plan, amount, starts_at, 'reservation' AS kind, NULL AS method
                    FROM visit_reservations
                    WHERE account_uid = ? AND cancelled_at IS NULL AND starts_at > ?
                UNION ALL
                SELECT id, plan, amount, starts_at, 'order' AS kind, method
                    FROM visit_checkout_orders
                    WHERE account_uid = ? AND paid_at IS NOT NULL AND cancelled_at IS NULL AND starts_at > ?
                ORDER BY starts_at, id
            """, (uid, now, uid, now))
            visits = [{
                'id': row['id'],
                'kind': row['kind'],
                'plan': json.loads(row['plan']),
                'amount': row['amount'],
                **({'method': row['method'], 'status': 'paid'} if row['method'] else {'status': 'reserved'}),
            } for row in rows]
            return {'visits': visits, 'balance': self._balance(db, uid)}

    def cancel_visit(self, uid, kind, visit_id):
        with closing(self.connect()) as db, db:
            db.execute('BEGIN IMMEDIATE')
            if kind == 'reservation':
                table = 'visit_reservations'
                row = db.execute('SELECT * FROM visit_reservations WHERE id = ? AND account_uid = ?',
                                 (visit_id, uid)).fetchone()
                if row is None:
                    raise AccountError(404, 'reservation_not_found', 'Бронь не найдена.')
            else:
                table = 'visit_checkout_orders'
                row = self._get_order(db, uid, visit_id)
                if row['paid_at'] is None:
                    raise AccountError(409, 'visit_not_confirmed', 'Оплата визита ещё не подтверждена.')
            if row['cancelled_at'] is None:
                now = int(time.time())
                if row['starts_at'] is None or row['starts_at'] <= now:
                    raise AccountError(409, 'visit_expired', 'Время визита уже наступило.')
                db.execute(f'UPDATE {table} SET cancelled_at = ? WHERE id = ?', (now, visit_id))
                if kind == 'order' and row['method'] == 'balance':
                    db.execute('UPDATE demo_wallets SET balance = balance + ? WHERE account_uid = ?',
                               (row['amount'], uid))
            return {'id': visit_id, 'status': 'cancelled', 'balance': self._balance(db, uid)}
