"""Real booking workflow with Telegram replaced by a recording sender."""
from contextlib import closing
from datetime import datetime, timedelta
from hashlib import sha256
from pathlib import Path
from tempfile import TemporaryDirectory
from threading import Thread
from types import SimpleNamespace
import unittest
from unittest.mock import patch
from uuid import uuid4

from booking_server import ASTANA, BookingError, make_server
import test_visit_checkout as checkout_tests


class TelegramVisitTests(unittest.TestCase):
    base = '/api/visit-checkout'
    request = checkout_tests.VisitCheckoutTests.request
    assert_error = checkout_tests.VisitCheckoutTests.assert_error

    def setUp(self):
        directory = TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        root = Path(directory.name)
        self.messages = []
        settings = {'TELEGRAM_BOT_TOKEN': '123456:' + 'a' * 32, 'TELEGRAM_CHAT_ID': '123456',
                    'TELEGRAM_MESSAGE_THREAD_ID': '', 'PUBLIC_ORIGIN': ''}
        self.server = make_server('127.0.0.1', 0, settings, db_path=root / 'delivery.sqlite3',
                                  accounts_db_path=root / 'accounts.sqlite3',
                                  sender=SimpleNamespace(send=self.messages.append))
        self.addCleanup(self.server.server_close)
        Thread(target=self.server.serve_forever, daemon=True).start()
        self.addCleanup(self.server.shutdown)
        self.owner, cookie = self.server.accounts.register({'email': 'owner@example.test', 'password': 'Local fixture 145'})
        self.cookie = cookie.partition(';')[0]
        _, other = self.server.accounts.register({'email': 'other@example.test', 'password': 'Other fixture 174'})
        self.other_cookie = other.partition(';')[0]

    def payload(self):
        return {'requestId': str(uuid4()), 'contact': {'name': 'Клиент', 'phone': '+77001112233'},
                'plan': {'room': 'standard', 'guests': 1, 'duration': 2, 'mode': 'hourly',
                         'date': (datetime.now(ASTANA) + timedelta(days=2)).date().isoformat(),
                         'time': '18:30', 'seat': 'pc-01'}}

    def test_guest_delivery_is_idempotent_and_can_be_claimed(self):
        self.assertEqual(self.request('/config'), (200, {'available': True, 'paymentsAvailable': False}))
        data = self.payload()
        status, reservation = self.request('/reservations', data)
        self.assertEqual(status, 201)
        self.assertEqual(len(self.messages), 1)
        self.assertIn('Клиент', self.messages[0])
        self.assertIn(reservation['reference'], self.messages[0])
        self.assertEqual(self.request('/reservations', data), (201, reservation))
        self.assertEqual(len(self.messages), 1)
        self.assertEqual(self.request('/reservations/' + reservation['id']), (200, reservation))
        self.assertNotIn('contact', reservation)
        self.assertEqual(self.request('/reservations/claim', {'requestId': data['requestId']}, cookie=self.cookie),
                         (200, {key: value for key, value in reservation.items() if key != 'reference'}))
        visits = self.request('/visits', cookie=self.cookie)[1]['visits']
        self.assertEqual([visit['id'] for visit in visits], [reservation['id']])
        self.assert_error(self.request('/orders', {}, cookie=self.cookie), 404, 'not_found')

    def test_changes_and_cancellation_notify_once_and_require_owner(self):
        _, reservation = self.request('/reservations', self.payload(), cookie=self.cookie)
        path = '/visits/reservation/' + reservation['id']
        changes = {'expectedPlan': reservation['plan'], 'date': reservation['plan']['date'],
                   'time': '19:15', 'seat': 'pc-05'}
        self.assert_error(self.request(path + '/update', changes, cookie=self.other_cookie), 404, 'reservation_not_found')
        status, updated = self.request(path + '/update', changes, cookie=self.cookie)
        self.assertEqual((status, updated['plan']['seat']), (200, 'pc-05'))
        self.assertEqual(len(self.messages), 2)
        self.assertIn('Изменение брони', self.messages[-1])
        self.assertIn('19:15', self.messages[-1])
        self.assertEqual(self.request(path + '/update', changes, cookie=self.cookie)[0], 200)
        self.assertEqual(len(self.messages), 2)
        for _ in range(2):
            self.assertEqual(self.request(path + '/cancel', {}, cookie=self.cookie)[0], 200)
        self.assertEqual(len(self.messages), 3)
        self.assertIn('Отмена брони', self.messages[-1])

    def test_delivery_failure_does_not_create_or_change_a_booking(self):
        def fail(_):
            raise BookingError(502, 'delivery_failed', 'Не удалось отправить бронь.')
        sender = self.server.service.sender
        sender.send = fail
        data = self.payload()
        self.assert_error(self.request('/reservations', data, cookie=self.cookie), 502, 'delivery_failed')
        self.assertEqual(self.request('/visits', cookie=self.cookie)[1]['visits'], [])
        sender.send = self.messages.append
        _, reservation = self.request('/reservations', data, cookie=self.cookie)
        self.server.visit_checkout.notifier = fail
        changes = {'expectedPlan': reservation['plan'], 'date': reservation['plan']['date'],
                   'time': '19:15', 'seat': 'pc-06'}
        self.assert_error(self.request('/visits/reservation/' + reservation['id'] + '/update', changes,
                                       cookie=self.cookie), 502, 'delivery_failed')
        self.assertEqual(self.request('/reservations/' + reservation['id'])[1]['plan'], reservation['plan'])

    def test_invalid_contact_and_conflicting_retry_are_not_sent(self):
        data = self.payload()
        self.assert_error(self.request('/reservations', {**data, 'contact': {}}), 422, 'validation')
        self.assertEqual(self.messages, [])
        self.request('/reservations', data)
        altered = {**data, 'contact': {**data['contact'], 'name': 'Другой гость'}}
        self.assert_error(self.request('/reservations', altered), 409, 'conflict')
        self.assertEqual(len(self.messages), 1)


class LocalTelegramVisitTests(unittest.TestCase):
    base = '/api/visit-checkout'
    request = checkout_tests.VisitCheckoutTests.request
    assert_error = checkout_tests.VisitCheckoutTests.assert_error
    payload = TelegramVisitTests.payload

    def setUp(self):
        directory = TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name)
        self.messages = []
        self.settings = {'TELEGRAM_BOT_TOKEN': '123456:' + 'a' * 32, 'TELEGRAM_CHAT_ID': '123456',
                         'TELEGRAM_MESSAGE_THREAD_ID': '', 'PUBLIC_ORIGIN': ''}
        self.server = make_server('127.0.0.1', 0, self.settings, db_path=self.root / 'delivery.sqlite3',
                                  accounts_db_path=self.root / 'accounts.sqlite3', local_booking=True,
                                  telegram_delivery=True, demo_wallet=True,
                                  sender=SimpleNamespace(send=self.messages.append))
        self.addCleanup(self.server.server_close)
        Thread(target=self.server.serve_forever, daemon=True).start()
        self.addCleanup(self.server.shutdown)
        self.owner, cookie = self.server.accounts.register({'email': 'owner@example.test', 'password': 'Local fixture 145'})
        self.cookie = cookie.partition(';')[0]

    def test_local_telegram_sends_date_and_pc_changes_without_altering_wallet(self):
        with patch.object(self, 'base', ''):
            self.assertEqual(self.request('/api/booking-config'), (200, {'mode': 'live', 'available': True}))
        self.assertEqual(self.request('/config'), (200, {'available': True}))
        self.assertTrue(self.server.accounts._remember_sessions)
        accounts = self.server.accounts
        uid = self.owner['uid']
        accounts.add_demo_card(uid)
        topup = accounts.create_topup(uid, 3000)
        accounts.confirm_topup(uid, topup['id'])

        status, reservation = self.request('/reservations', self.payload(), cookie=self.cookie)
        self.assertEqual(status, 201)
        self.assertIn(reservation['reference'], self.messages[0])
        path = '/visits/reservation/' + reservation['id']
        new_date = (datetime.now(ASTANA) + timedelta(days=3)).date().isoformat()
        status, updated = self.request(path + '/update', {
            'expectedPlan': reservation['plan'], 'date': new_date,
            'time': reservation['plan']['time'], 'seat': reservation['plan']['seat'],
        }, cookie=self.cookie)
        self.assertEqual((status, updated['plan']['date']), (200, new_date))
        status, updated = self.request(path + '/update', {
            'expectedPlan': updated['plan'], 'date': new_date,
            'time': updated['plan']['time'], 'seat': 'pc-02',
        }, cookie=self.cookie)
        self.assertEqual((status, updated['plan']['seat']), (200, 'pc-02'))
        self.assertEqual(self.request(path + '/cancel', {}, cookie=self.cookie)[0], 200)
        self.assertEqual(len(self.messages), 4)
        self.assertIn(new_date, self.messages[1])
        self.assertIn('pc-02', self.messages[2])
        self.assertIn('Отмена брони', self.messages[3])
        self.assertEqual(accounts.wallet_balance(uid), 3000)
        self.assertEqual(accounts.current_user(self.cookie)['uid'], uid)
        self.assertEqual(self.request('/visits', cookie=self.cookie)[1]['visits'], [])

    def test_explicit_local_mode_without_telegram_stays_save_only(self):
        server = make_server('127.0.0.1', 0, self.settings,
                             db_path=self.root / 'local-delivery.sqlite3',
                             accounts_db_path=self.root / 'local-accounts.sqlite3',
                             local_booking=True, demo_wallet=True,
                             sender=SimpleNamespace(send=self.messages.append))
        self.addCleanup(server.server_close)
        self.assertTrue(server.local_booking)
        self.assertIsNone(server.visit_checkout.notifier)
        reservation = server.visit_checkout.start_reservation(self.payload())
        self.assertEqual(reservation['status'], 'reserved')
        self.assertEqual(self.messages, [])

    def test_existing_local_reservations_notify_only_when_changed_or_cancelled(self):
        for with_contact in (True, False):
            with self.subTest(with_contact=with_contact):
                data = self.payload()
                if not with_contact:
                    del data['contact']
                checkout = self.server.visit_checkout
                reservation = checkout.start_reservation(data, self.owner['uid'])
                before = len(self.messages)
                reference = sha256(data['requestId'].encode()).hexdigest()[:8].upper()
                path = '/visits/reservation/' + reservation['id']
                changes = {'expectedPlan': reservation['plan'], 'date': reservation['plan']['date'],
                           'time': '19:15', 'seat': 'pc-03'}
                self.assertEqual(self.request(path + '/update', changes, cookie=self.cookie)[0], 200)
                self.assertEqual(len(self.messages), before + 1)
                self.assertIn(reference, self.messages[-1])
                self.assertIn('Клиент' if with_contact else self.owner['email'], self.messages[-1])
                self.assertEqual(self.request(path + '/update', changes, cookie=self.cookie)[0], 200)
                self.assertEqual(len(self.messages), before + 1)
                self.assertEqual(self.request(path + '/cancel', {}, cookie=self.cookie)[0], 200)
                self.assertEqual(len(self.messages), before + 2)
                self.assertIn(reference, self.messages[-1])
                self.assertIn('Отмена брони', self.messages[-1])

    def test_existing_local_reservation_keeps_plan_and_metadata_on_delivery_failure(self):
        checkout = self.server.visit_checkout
        reservation = checkout.start_reservation(self.payload(), self.owner['uid'])

        def fail(_):
            raise BookingError(502, 'delivery_failed', 'Не удалось отправить бронь.')

        checkout.notifier = fail
        changes = {'expectedPlan': reservation['plan'], 'date': reservation['plan']['date'],
                   'time': '19:15', 'seat': 'pc-03'}
        self.assert_error(self.request('/visits/reservation/' + reservation['id'] + '/update', changes,
                                       cookie=self.cookie), 502, 'delivery_failed')
        self.assertEqual(checkout.get_reservation(reservation['id'])['plan'], reservation['plan'])
        with closing(checkout.connect()) as db:
            self.assertIsNone(db.execute('SELECT * FROM visit_telegram_delivery WHERE reservation_id = ?',
                                          (reservation['id'],)).fetchone())
        self.assertEqual(self.messages, [])

    def test_telegram_local_mode_preserves_private_network_password_login(self):
        # Simulate a bound private interface without requiring a specific LAN on the runner.
        with patch('booking_server.ThreadingHTTPServer') as server_type:
            server_type.return_value.server_address = ('192.168.31.40', 8880)
            server_type.return_value.server_port = 8880
            server = make_server('192.168.31.40', 8880,
                                 {**self.settings, 'PUBLIC_ORIGIN': 'http://192.168.31.40:8880'},
                                 db_path=self.root / 'lan-delivery.sqlite3',
                                 accounts_db_path=self.root / 'lan-accounts.sqlite3',
                                 local_booking=True, telegram_delivery=True, demo_wallet=True,
                                 sender=SimpleNamespace(send=self.messages.append))
        self.assertTrue(server.accounts.available)
        profile, _ = server.accounts.register({'email': 'lan@example.test', 'password': 'Local fixture 145'})
        signed_in, _ = server.accounts.login({'email': 'lan@example.test', 'password': 'Local fixture 145'})
        self.assertEqual(signed_in['uid'], profile['uid'])
        self.assertFalse(server.local_booking)
        self.assertTrue(server.demo_wallet)
        self.assertIsNotNone(server.visit_checkout.notifier)
        self.assertEqual(self.messages, [])


if __name__ == '__main__':
    unittest.main()
