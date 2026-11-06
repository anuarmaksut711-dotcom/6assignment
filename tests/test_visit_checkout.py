from concurrent.futures import ThreadPoolExecutor
from contextlib import closing
from datetime import datetime, timedelta
import http.client
import json
from pathlib import Path
from tempfile import TemporaryDirectory
from threading import Thread
import unittest
from uuid import uuid4

from booking_server import ASTANA, make_server, quote_visit_checkout, visit_start
from pixel_visit_checkout import VisitCheckout


class VisitCheckoutTests(unittest.TestCase):
    base = '/api/visit-checkout'

    def setUp(self):
        directory = TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        root = Path(directory.name)
        self.server = make_server('127.0.0.1', 0, {}, db_path=root / 'booking.sqlite3',
                                  accounts_db_path=root / 'accounts.sqlite3', local_booking=True, demo_wallet=True)
        self.addCleanup(self.server.server_close)
        thread = Thread(target=self.server.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(self.server.shutdown)
        self.owner, cookie = self.server.accounts.register({'email': 'owner@example.test', 'password': 'Local fixture 145'})
        _, other_cookie = self.server.accounts.register({'email': 'other@example.test', 'password': 'Other fixture 174'})
        self.cookie, self.other_cookie = [value.partition(';')[0] for value in (cookie, other_cookie)]

    def request(self, path, payload=None, *, cookie='', origin=None, account=None):
        headers = {}
        if cookie:
            headers['Cookie'] = cookie
        if payload is not None:
            headers['Content-Type'] = 'application/json'
            headers['Origin'] = self.server.origin if origin is None else origin
        if account is not None:
            headers['X-Pixel-Account'] = account
        connection = http.client.HTTPConnection('127.0.0.1', self.server.server_port, timeout=5)
        try:
            connection.request('GET' if payload is None else 'POST', self.base + path,
                               None if payload is None else json.dumps(payload), headers)
            response = connection.getresponse()
            return response.status, json.load(response)
        finally:
            connection.close()

    def start(self, payload, **options):
        return self.request('/orders', payload, cookie=self.cookie, **options)

    def fund(self, amount):
        accounts = self.server.accounts
        uid = self.owner['uid']
        accounts.add_demo_card(uid)
        topup = accounts.create_topup(uid, amount)
        accounts.confirm_topup(uid, topup['id'])

    @staticmethod
    def order(method='card', request_id='visit-application-001'):
        date = (datetime.now(ASTANA) + timedelta(days=2)).date().isoformat()
        return {'requestId': request_id, 'method': method, 'expectedAmount': 1800,
                'plan': {'room': 'standard', 'guests': '1', 'duration': '2', 'date': date, 'time': '14:00',
                         'mode': 'hourly', 'total': 1}}

    def assert_error(self, response, status, code):
        actual_status, body = response
        self.assertEqual((actual_status, body['code']), (status, code))

    def test_card_order_requires_own_session_and_confirms_without_wallet_debit(self):
        self.assertEqual(self.request('/config'), (200, {'available': True}))
        self.fund(2000)
        data = self.order()
        self.assert_error(self.request('/orders', data), 401, 'sign_in')
        self.assert_error(self.start(data, origin='https://elsewhere.example'), 403, 'auth_origin')
        self.assert_error(self.start(data, account='other-account'), 409, 'account_changed')
        status, order = self.start(data, account=self.owner['uid'])
        self.assertEqual(status, 201)
        self.assertEqual((order['method'], order['status'], order['amount']), ('card', 'pending', 1800))
        self.assertEqual(order['plan']['guests'], 1)
        self.assertNotIn('total', order['plan'])
        self.assertEqual(self.start(data), (201, order))
        path = '/orders/' + order['id']
        self.assertEqual(self.request(path, cookie=self.cookie), (200, order))
        self.assert_error(self.request(path, cookie=self.other_cookie), 404, 'order_not_found')
        self.assert_error(self.request(path + '/confirm', {}, cookie=self.other_cookie), 404, 'order_not_found')
        self.assert_error(self.request(path + '/confirm', {'card': '4242424242424242'}, cookie=self.cookie),
                          400, 'invalid')
        paid = {**order, 'status': 'paid'}
        self.assertEqual(self.request(path + '/confirm', {}, cookie=self.cookie), (200, paid))
        self.assertEqual(self.request(path + '/confirm', {}, cookie=self.cookie), (200, paid))
        self.assertEqual(self.server.accounts.wallet_balance(self.owner['uid']), 2000)

    def test_balance_package_uses_catalog_price_and_idempotent_debit(self):
        self.fund(3000)
        data = self.order('balance')
        data['plan'].update({'duration': '3', 'mode': 'packages', 'packageId': 'standard-3-hours',
                             'pricingPolicy': 'package-estimate-v1',
                             'packages': [{'id': 'standard-3-hours', 'quantity': 1, 'price': 1}]})
        self.assert_error(self.start(data), 409, 'price_changed')
        data['expectedAmount'] = 2100
        with ThreadPoolExecutor(max_workers=3) as pool:
            responses = list(pool.map(self.start, [data] * 3))
        status, order = responses[0]
        self.assertEqual(responses, [(201, order)] * 3)
        self.assertEqual((status, order['method'], order['status'], order['amount'], order['balance']),
                         (201, 'balance', 'paid', 2100, 900))
        self.assertEqual(order['plan']['packages'][0]['price'], 2100)
        self.assert_error(self.start({**data, 'method': 'card'}), 409, 'request_conflict')
        self.assert_error(self.start({**data, 'requestId': 'visit-application-002'}), 409, 'insufficient_balance')
        self.assertEqual(self.server.accounts.wallet_balance(self.owner['uid']), 900)

    def test_concurrent_distinct_balance_orders_cannot_overdraw(self):
        self.fund(3000)
        payloads = [self.order('balance', request_id=f'visit-application-00{index}') for index in (1, 2)]
        with ThreadPoolExecutor(max_workers=2) as pool:
            responses = list(pool.map(self.start, payloads))
        self.assertEqual(sorted(status for status, _ in responses), [201, 409])
        self.assert_error(next(response for response in responses if response[0] == 409), 409, 'insufficient_balance')
        self.assertEqual(self.server.accounts.wallet_balance(self.owner['uid']), 1200)

    def test_invalid_visit_date_does_not_charge_wallet(self):
        self.fund(3000)
        data = self.order('balance')
        data['plan']['date'] = (datetime.now(ASTANA) - timedelta(days=2)).date().isoformat()
        response = self.start(data)
        self.assert_error(response, 422, 'validation')
        self.assertIn('date', response[1]['fields'])
        self.assertEqual(self.server.accounts.wallet_balance(self.owner['uid']), 3000)

    def test_guest_reservation_persists_without_payment_or_contact(self):
        self.fund(3000)
        order = self.order()
        data = {'plan': {**order['plan'], 'phone': 'local contact'}, 'requestId': order['requestId']}
        self.assert_error(self.request('/reservations', data, origin='https://elsewhere.example'), 403, 'auth_origin')
        status, reservation = self.request('/reservations', data)
        self.assertEqual((status, reservation['status'], reservation['amount']), (201, 'reserved', 1800))
        self.assertRegex(reservation['id'], r'^[0-9a-f]{32}$')
        self.assertNotIn('phone', reservation['plan'])
        self.assertEqual(self.request('/reservations/' + reservation['id']), (200, reservation))
        self.assert_error(self.request('/reservations/' + '0' * 32), 404, 'reservation_not_found')
        self.assertEqual(self.request('/reservations', data), (201, reservation))
        invalid_plan = {**data, 'plan': {**data['plan'], 'date': '2020-01-01'}}
        self.assert_error(self.request('/reservations', invalid_plan), 409, 'request_conflict')
        self.assert_error(self.request('/reservations', {**invalid_plan, 'requestId': 'visit-application-002'}),
                          422, 'validation')
        self.assertEqual(self.server.accounts.wallet_balance(self.owner['uid']), 3000)

    def test_guest_claim_and_reservation_cancel_are_owner_bound(self):
        data = {'plan': self.order()['plan'], 'requestId': str(uuid4())}
        _, reservation = self.request('/reservations', data)
        path = '/visits/reservation/' + reservation['id'] + '/cancel'
        claim = '/reservations/claim'
        proof = {'requestId': data['requestId']}
        self.assert_error(self.request('/visits'), 401, 'sign_in')
        self.assert_error(self.request(claim, proof), 401, 'sign_in')
        self.assert_error(self.request(claim, proof, cookie=self.cookie, origin='https://elsewhere.example'),
                          403, 'auth_origin')
        self.assert_error(self.request(claim, proof, cookie=self.other_cookie, account=self.owner['uid']),
                          409, 'account_changed')
        self.assert_error(self.request(claim, {'requestId': str(uuid4())}, cookie=self.cookie),
                          404, 'reservation_not_found')
        self.assert_error(self.request(path, {}, cookie=self.cookie), 404, 'reservation_not_found')
        self.assertEqual(self.request('/visits', cookie=self.cookie), (200, {'visits': [], 'balance': 0}))

        for _ in range(2):
            self.assertEqual(self.request(claim, proof, cookie=self.cookie), (200, reservation))
        self.assert_error(self.request(claim, proof, cookie=self.other_cookie), 404, 'reservation_not_found')
        self.assert_error(self.request('/visits', cookie=self.other_cookie, account=self.owner['uid']),
                          409, 'account_changed')
        self.assert_error(self.request(path, {}, cookie=self.other_cookie), 404, 'reservation_not_found')
        self.assertEqual(self.request('/visits', cookie=self.cookie),
                         (200, {'visits': [{**reservation, 'kind': 'reservation'}], 'balance': 0}))
        cancelled = {'id': reservation['id'], 'status': 'cancelled', 'balance': 0}
        for _ in range(2):
            self.assertEqual(self.request(path, {}, cookie=self.cookie), (200, cancelled))
        self.assertEqual(self.request('/visits', cookie=self.cookie), (200, {'visits': [], 'balance': 0}))
        self.assertEqual(self.request('/reservations/' + reservation['id']),
                         (200, {**reservation, 'status': 'cancelled'}))

    def test_signed_in_reservation_is_listed_and_cannot_be_cancelled_after_start(self):
        data = {'plan': self.order()['plan'], 'requestId': str(uuid4())}
        _, reservation = self.request('/reservations', data, cookie=self.cookie)
        self.assertEqual(self.request('/visits', cookie=self.cookie),
                         (200, {'visits': [{**reservation, 'kind': 'reservation'}], 'balance': 0}))
        with closing(self.server.accounts._connect()) as db, db:
            db.execute('UPDATE visit_reservations SET starts_at = 1 WHERE id = ?', (reservation['id'],))
        self.assertEqual(self.request('/visits', cookie=self.cookie), (200, {'visits': [], 'balance': 0}))
        path = '/visits/reservation/' + reservation['id'] + '/cancel'
        self.assert_error(self.request(path, {}, cookie=self.cookie), 409, 'visit_expired')

    def test_paid_order_cancel_refunds_balance_once_and_prevents_card_confirmation(self):
        self.fund(3000)
        data = self.order('balance')
        _, order = self.start(data)
        path = '/visits/order/' + order['id'] + '/cancel'
        self.assert_error(self.request(path, {}, cookie=self.other_cookie), 404, 'order_not_found')
        self.assert_error(self.request(path, {}, cookie=self.cookie, origin='https://elsewhere.example'),
                          403, 'auth_origin')
        self.assertEqual(self.server.accounts.wallet_balance(self.owner['uid']), 1200)
        with ThreadPoolExecutor(max_workers=3) as pool:
            results = list(pool.map(lambda _: self.request(path, {}, cookie=self.cookie), range(3)))
        cancelled = {'id': order['id'], 'status': 'cancelled', 'balance': 3000}
        self.assertEqual(results, [(200, cancelled)] * 3)
        self.assertEqual(self.start(data), (201, {**order, 'status': 'cancelled', 'balance': 3000}))

        _, card = self.start(self.order(request_id='visit-application-002'))
        confirm = '/orders/' + card['id'] + '/confirm'
        card_cancel = '/visits/order/' + card['id'] + '/cancel'
        self.assert_error(self.request(card_cancel, {}, cookie=self.cookie), 409, 'visit_not_confirmed')
        _, paid = self.request(confirm, {}, cookie=self.cookie)
        self.assertEqual(self.request('/visits', cookie=self.cookie),
                         (200, {'visits': [{**paid, 'kind': 'order'}], 'balance': 3000}))
        self.assertEqual(self.request(card_cancel, {}, cookie=self.cookie),
                         (200, {'id': card['id'], 'status': 'cancelled', 'balance': 3000}))
        self.assertEqual(self.request('/orders/' + card['id'], cookie=self.cookie), (200, {**card, 'status': 'cancelled'}))
        self.assert_error(self.request(confirm, {}, cookie=self.cookie), 409, 'visit_cancelled')

    def test_legacy_reservation_can_be_claimed_and_cancelled(self):
        data = {'plan': self.order()['plan'], 'requestId': str(uuid4())}
        _, reservation = self.request('/reservations', data)
        connect = self.server.accounts._connect
        with closing(connect()) as db, db:
            db.execute('ALTER TABLE visit_reservations RENAME TO upgraded_reservations')
            db.execute("""
                CREATE TABLE visit_reservations (
                    id TEXT PRIMARY KEY, request_id TEXT NOT NULL UNIQUE, fingerprint TEXT NOT NULL,
                    plan TEXT NOT NULL, amount INTEGER NOT NULL, created_at INTEGER NOT NULL
                )
            """)
            db.execute("""
                INSERT INTO visit_reservations
                    SELECT id, request_id, fingerprint, plan, amount, created_at FROM upgraded_reservations
            """)
            db.execute('DROP TABLE upgraded_reservations')
        self.server.visit_checkout = VisitCheckout(connect, quote_visit_checkout, visit_start)
        self.assertEqual(self.request('/reservations/claim', {'requestId': data['requestId']}, cookie=self.cookie),
                         (200, reservation))
        self.assertEqual(self.request('/visits', cookie=self.cookie),
                         (200, {'visits': [{**reservation, 'kind': 'reservation'}], 'balance': 0}))
        path = '/visits/reservation/' + reservation['id'] + '/cancel'
        self.assertEqual(self.request(path, {}, cookie=self.cookie),
                         (200, {'id': reservation['id'], 'status': 'cancelled', 'balance': 0}))


if __name__ == '__main__':
    unittest.main()
