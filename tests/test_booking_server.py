"""All deliveries are fake. These tests never contact Telegram."""
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta
import http.client
import json
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from booking_server import ASTANA, BookingError, BookingService, TelegramSender, configured, make_server, message_for, validate, package_estimate


def payload(request_id='a' * 32):
    start = datetime.now(ASTANA) + timedelta(days=2)
    return {'requestId': request_id, 'contact': {'name': 'Тестовый гость', 'phone': '+7 (700) 000-00-00'},
            'plan': {'room': 'standard', 'guests': '2', 'duration': '2', 'date': start.strftime('%Y-%m-%d'),
                     'time': '23:00', 'mode': 'hourly', 'nearby': True, 'seat': 'pc-01', 'game': 'cs2', 'packages': []}}


class FakeSender:
    def __init__(self, error=None):
        self.messages, self.error = [], error

    def send(self, text):
        self.messages.append(text)
        if self.error:
            raise self.error


class BookingTests(unittest.TestCase):
    def test_optional_email_is_validated_trimmed_and_delivered(self):
        data = payload()
        data['contact']['email'] = '  guest@example.com  '
        booking = validate(data)
        self.assertEqual(booking['contact']['email'], 'guest@example.com')
        self.assertIn('E-mail: guest@example.com', message_for(booking, 'AAAAAAAA'))
        for value in ('missing-at', 'a@b', 'a@b..', 'a b@example.com', 'a\x01@example.com', 3):
            with self.subTest(value=value), self.assertRaises(BookingError) as error:
                data['contact']['email'] = value
                validate(data)
            self.assertIn('email', error.exception.fields)

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.path = Path(self.temp.name) / 'requests.sqlite3'
        self.settings = {'TELEGRAM_BOT_TOKEN': '123456:' + 'x' * 30, 'TELEGRAM_CHAT_ID': '-100123456',
                         'TELEGRAM_MESSAGE_THREAD_ID': '', 'PUBLIC_ORIGIN': 'http://127.0.0.1:8897'}

    def tearDown(self):
        self.temp.cleanup()

    def service(self, sender=None, dry_run=False):
        return BookingService(self.path, self.settings, dry_run, sender or FakeSender())

    def test_contacts_and_server_price(self):
        data = payload()
        data['plan']['total'] = 1
        booking = validate(data)
        text = message_for(booking, 'AAAAAAAA')
        self.assertIn('Телефон: +77000000000', text)
        self.assertIn('3 600 ₸', text)
        self.assertIn('01:00', text)
        self.assertIn('Counter-Strike 2', text)

    def test_required_contacts_and_invalid_control_characters(self):
        for contact in ({'name': '', 'phone': ''}, {'name': 'A\nB', 'phone': '+7 700 000 00 00'}, {'name': 'Гость', 'phone': '123'}):
            with self.subTest(contact=contact), self.assertRaises(BookingError) as error:
                data = payload()
                data['contact'] = contact
                validate(data)
            self.assertEqual(error.exception.status, 422)

    def test_capacity_past_duration_seat_and_game(self):
        for changes in ({'room': 'duo', 'guests': '3'}, {'date': '2020-01-01'}, {'duration': '1.5'},
                        {'duration': '13'}, {'seat': 'vip-01'}, {'game': 'unknown'}, {'date': '2026-02-30'}):
            with self.subTest(changes=changes), self.assertRaises(BookingError):
                data = payload()
                data['plan'].update(changes)
                validate(data)

    def test_legacy_packages_require_explicit_pricing_policy(self):
        data = payload()
        data['plan']['mode'] = 'packages'
        for selected in ([], [{'id': 'standard-3-hours', 'quantity': 1}],
                         [{'id': 'standard-5-hours', 'quantity': 2, 'price': 1}],
                         [{'id': 'standard-night', 'quantity': 1}],
                         [{'id': 'vip-night', 'quantity': 1}], [{'id': 'standard-day', 'quantity': 100}]):
            with self.subTest(selected=selected), self.assertRaises(BookingError):
                data['plan']['packages'] = selected
                validate(data)

    def test_package_model_scenarios_match_browser(self):
        cases = json.loads((Path(__file__).parent / 'package_quote_cases.json').read_text(encoding='utf-8'))
        for case in cases:
            with self.subTest(case=case['name']):
                if 'code' in case['expected']:
                    with self.assertRaises(BookingError) as error:
                        package_estimate(case['plan'])
                    self.assertEqual(error.exception.code, case['expected']['code'])
                else:
                    quote = package_estimate(case['plan'])
                    for key, value in case['expected'].items():
                        self.assertEqual(quote[key], value, key)

    def test_package_request_uses_server_total_and_labels_assumptions(self):
        data = payload()
        data['plan'].update(mode='packages', packageId='standard-3-hours', pricingPolicy='package-estimate-v1',
                            duration='4', packages=[{'id':'standard-3-hours','quantity':2,'price':1}], estimate={'total':1})
        booking = validate(data)
        self.assertEqual(booking['plan']['estimate']['total'], 6000)
        text = message_for(booking, 'AAAAAAAA')
        self.assertIn('Предварительно за весь визит: 6 000 ₸', text)
        self.assertIn('МОДЕЛЬ САЙТА', text)
        data['plan']['packages'][0]['quantity'] = 1
        with self.assertRaises(BookingError):
            validate(data)

    def test_success_and_duplicate_do_not_send_twice_or_store_contacts(self):
        sender = FakeSender()
        service = self.service(sender)
        first = service.submit(payload(), 'local')
        second = service.submit(payload(), 'local')
        self.assertEqual(first, second)
        self.assertEqual(first['status'], 'sent')
        self.assertEqual(len(sender.messages), 1)
        with service.connect() as db:
            rows = json.dumps(db.execute('SELECT * FROM requests').fetchall(), ensure_ascii=False)
        self.assertNotIn('Тестовый гость', rows)
        self.assertNotIn('77000000000', rows)

    def test_simultaneous_double_submit_calls_sender_once(self):
        entered, release = threading.Event(), threading.Event()
        sender = FakeSender()
        original = sender.send

        def slow(text):
            entered.set()
            release.wait(3)
            original(text)

        sender.send = slow
        service = self.service(sender)
        with ThreadPoolExecutor(max_workers=2) as pool:
            first = pool.submit(service.submit, payload(), 'local')
            self.assertTrue(entered.wait(2))
            with self.assertRaises(BookingError):
                service.submit(payload(), 'local')
            release.set()
            self.assertEqual(first.result()['status'], 'sent')
        self.assertEqual(len(sender.messages), 1)

    def test_rejected_delivery_can_retry_and_never_claims_success(self):
        sender = FakeSender(BookingError(502, 'delivery_failed', 'failed'))
        service = self.service(sender)
        with self.assertRaises(BookingError):
            service.submit(payload(), 'local')
        sender.error = None
        self.assertEqual(service.submit(payload(), 'local')['status'], 'sent')

    def test_uncertain_delivery_is_never_sent_twice(self):
        sender = FakeSender(BookingError(409, 'uncertain', 'unknown'))
        service = self.service(sender)
        for _ in range(2):
            with self.assertRaises(BookingError) as error:
                service.submit(payload(), 'local')
            self.assertEqual(error.exception.code, 'uncertain')
        self.assertEqual(len(sender.messages), 1)

    def test_id_reuse_with_different_data_is_rejected(self):
        service = self.service()
        service.submit(payload(), 'local')
        data = payload()
        data['contact']['name'] = 'Другой гость'
        with self.assertRaises(BookingError) as error:
            service.submit(data, 'local')
        self.assertEqual(error.exception.code, 'conflict')

    def test_dry_run_never_calls_sender(self):
        sender = FakeSender()
        self.assertEqual(self.service(sender, True).submit(payload(), 'local')['status'], 'test')
        self.assertEqual(sender.messages, [])

    def test_unconfigured_and_rate_limit(self):
        service = self.service()
        service.settings['TELEGRAM_BOT_TOKEN'] = ''
        self.assertFalse(configured(service.settings))
        with self.assertRaises(BookingError) as error:
            service.submit(payload(), 'local')
        self.assertEqual(error.exception.status, 503)
        service.dry_run = True
        for i in range(8):
            service.submit(payload(f'{i:032x}'), 'local')
        with self.assertRaises(BookingError) as error:
            service.submit(payload('f' * 32), 'local')
        self.assertEqual(error.exception.status, 429)

    def test_telegram_adapter_uses_server_credentials_without_markup(self):
        class Response:
            def __enter__(self): return self
            def __exit__(self, *args): pass
            def read(self): return b'{"ok":true,"result":{"message_id":1}}'
        with patch('booking_server.urlopen', return_value=Response()) as mocked:
            TelegramSender(self.settings).send('Тест <без разметки>')
        request = mocked.call_args.args[0]
        body = json.loads(request.data)
        self.assertEqual(body['chat_id'], '-100123456')
        self.assertEqual(body['text'], 'Тест <без разметки>')
        self.assertNotIn('parse_mode', body)


class HttpTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.sender = FakeSender()
        settings = {'TELEGRAM_BOT_TOKEN': '123456:' + 'x' * 30, 'TELEGRAM_CHAT_ID': '-100123456',
                    'TELEGRAM_MESSAGE_THREAD_ID': '', 'PUBLIC_ORIGIN': ''}
        directory = Path(self.temp.name)
        self.server = make_server('127.0.0.1', 0, settings, db_path=directory / 'requests.sqlite3',
                                  sender=self.sender, accounts_db_path=directory / 'accounts.sqlite3')
        self.origin = self.server.origin
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(2)
        self.temp.cleanup()

    def request(self, path, data=None, origin=None, content_type='application/json'):
        headers = {'Origin': origin or self.origin, 'Content-Type': content_type}
        request = Request(self.origin + path, data=data, headers=headers)
        try:
            with urlopen(request, timeout=3) as response:
                return response.status, response.read()
        except HTTPError as response:
            return response.code, response.read()

    def test_http_send_and_repeat_with_fake_telegram(self):
        body = json.dumps(payload()).encode()
        status, first = self.request('/api/bookings', body)
        status2, second = self.request('/api/bookings', body)
        self.assertEqual((status, status2), (200, 200))
        self.assertEqual(first, second)
        self.assertEqual(len(self.sender.messages), 1)

    def test_cross_origin_rejected(self):
        status, _ = self.request('/api/bookings', json.dumps(payload()).encode(), origin='https://other.example')
        self.assertEqual(status, 403)
        self.assertEqual(self.sender.messages, [])

    def test_unconfigured_fails_closed_without_secrets(self):
        self.server.service.settings['TELEGRAM_BOT_TOKEN'] = ''
        status, config = self.request('/api/booking-config')
        self.assertEqual(status, 200)
        self.assertFalse(json.loads(config)['available'])
        self.assertNotIn('TELEGRAM', config.decode())
        status, _ = self.request('/api/bookings', json.dumps(payload()).encode())
        self.assertEqual(status, 503)
        self.assertEqual(self.sender.messages, [])

    def test_env_and_directory_listing_not_served(self):
        for path in ('/env/.env', '/.env', '/%2e%2e/env/.env', '/assets/'):
            with self.subTest(path=path):
                self.assertEqual(self.request(path)[0], 404)
        self.assertEqual(self.request('/booking.html')[0], 200)

    def test_malformed_and_windows_secret_paths_fail_closed(self):
        paths = ('/env%00', '/var%00', '/%ff', '/%ed%a0%80', '/env%5c%2eenv',
                 '/%2e%2e%5cenv%5c%2eenv', '/%252e%252e/env/%252eenv',
                 '/%252e%252e%5c%252e%252e%5cbooking_server.py',
                 '/%252e%252e\\%252e%252e\\var\\booking.sqlite3',
                 '/env/.env::$DATA', '/index.html::$DATA', '/C:/env/.env',
                 '/.git/config', '/booking_server.py', '/var/booking.sqlite3')
        for path in paths:
            for method in ('GET', 'HEAD'):
                with self.subTest(path=path, method=method):
                    connection = http.client.HTTPConnection('127.0.0.1', self.server.server_port, timeout=3)
                    try:
                        connection.request(method, path)
                        response = connection.getresponse()
                        self.assertEqual(response.status, 404)
                        self.assertNotIn(b'TELEGRAM_BOT_TOKEN', response.read())
                    finally:
                        connection.close()
        self.assertEqual(self.request('/')[0], 200)

    def test_root_index_target_must_stay_inside_public_directory(self):
        # Model a resolved index link without requiring Windows symlink privileges.
        # Both the direct file and the implicit home page must check that target.
        public = Path(__file__).resolve().parents[1] / 'demofinal'
        outside = Path(self.temp.name) / 'private.txt'
        outside.write_text('AUDIT_PRIVATE_MARKER', encoding='utf-8')
        original_resolve = Path.resolve

        def resolve(path, *args, **kwargs):
            if path == public / 'index.html':
                return outside
            return original_resolve(path, *args, **kwargs)

        with patch.object(Path, 'resolve', resolve):
            for path in ('/', '/index.html'):
                with self.subTest(path=path):
                    status, body = self.request(path)
                    self.assertEqual(status, 404)
                    self.assertNotIn(b'AUDIT_PRIVATE_MARKER', body)

    def test_internal_exception_and_config_do_not_expose_credentials(self):
        marker = 'AUDIT_PRIVATE_MARKER'
        with patch.object(self.server.service, 'submit', side_effect=RuntimeError(marker)):
            status, body = self.request('/api/bookings', b'{}')
            self.assertEqual(status, 500)
            self.assertNotIn(marker.encode(), body)
            self.assertNotIn(b'Traceback', body)
        status, body = self.request('/api/booking-config?file=env/.env')
        self.assertEqual(status, 200)
        self.assertEqual(set(json.loads(body)), {'mode', 'available'})

    def test_bad_json_content_type_and_size(self):
        self.assertEqual(self.request('/api/bookings', b'{')[0], 400)
        self.assertEqual(self.request('/api/bookings', b'{}', content_type='text/plain')[0], 415)
        self.assertEqual(self.request('/api/bookings', b'x' * 17000)[0], 413)
        self.assertEqual(self.sender.messages, [])

    def test_account_posts_reject_cross_site_or_malformed_requests(self):
        for action in ('register', 'login', 'session', 'logout'):
            path = '/api/auth/' + action
            with self.subTest(action=action):
                self.assertEqual(self.request(path, b'{}', origin='https://other.example')[0], 403)
                self.assertEqual(self.request(path, b'{}', content_type='text/plain')[0], 415)
                self.assertEqual(self.request(path, b'[]')[0], 400)

    def test_native_account_http_registration_login_balance_and_logout(self):
        _, config = self.request('/api/auth/config')
        self.assertTrue(json.loads(config)['passwordEnabled'])
        self.assertNotIn('phoneEnabled', json.loads(config))
        self.assertEqual(json.loads(self.request('/api/auth/session')[1]), {'user': None})

        def post(action, data, cookie=''):
            headers = {'Origin': self.origin, 'Content-Type': 'application/json'}
            if cookie:
                headers['Cookie'] = cookie
            return urlopen(Request(self.origin + '/api/auth/' + action, data=json.dumps(data).encode(),
                                   headers=headers), timeout=3)

        credentials = {'email': 'Player@Example.test', 'password': 'example password 741'}
        with post('register', {**credentials, 'balance': 123000}) as response:
            self.assertEqual(response.status, 201)
            profile = json.load(response)['user']
            self.assertEqual(profile['balance'], 0)
            self.assertEqual(profile['email'], 'player@example.test')
            self.assertEqual(response.headers['Cache-Control'], 'no-store')
            self.assertIsNone(response.headers['Access-Control-Allow-Origin'])
            registered = response.headers['Set-Cookie']
            self.assertIn('HttpOnly', registered)
            self.assertIn('SameSite=Lax', registered)
            first_cookie = registered.split(';', 1)[0]

        def profile_for(cookie):
            request = Request(self.origin + '/api/auth/session', headers={'Cookie': cookie})
            with urlopen(request, timeout=3) as response:
                return json.load(response)['user']

        self.assertEqual(profile_for(first_cookie), profile)
        wrong = json.dumps({**credentials, 'password': 'another password 741'}).encode()
        self.assertEqual(self.request('/api/auth/login', wrong)[0], 401)
        self.assertEqual(profile_for(first_cookie), profile)
        with post('login', credentials, first_cookie) as response:
            self.assertEqual(json.load(response)['user'], profile)
            second_cookie = response.headers['Set-Cookie'].split(';', 1)[0]
        self.assertNotEqual(first_cookie, second_cookie)
        self.assertIsNone(profile_for(first_cookie))
        self.assertEqual(profile_for(second_cookie), profile)
        with post('logout', {}, second_cookie) as response:
            self.assertEqual(json.load(response), {'user': None})
            self.assertIn('Max-Age=0', response.headers['Set-Cookie'])
        self.assertIsNone(profile_for(second_cookie))

    def test_verified_google_sign_in_uses_the_same_balance_and_session(self):
        identity = {'uid': 'test-google-user', 'provider': 'google.com', 'name': 'Гость', 'email': 'guest@example.test'}
        token = b'{"idToken":"test-token"}'
        headers = {'Origin': self.origin, 'Content-Type': 'application/json'}
        path = self.origin + '/api/auth/session'
        with patch.object(self.server.auth, 'verify_google', return_value=identity) as verify:
            with urlopen(Request(path, data=token, headers=headers), timeout=3) as response:
                profile = json.load(response)['user']
                cookie = response.headers['Set-Cookie'].split(';', 1)[0]
            verify.assert_called_once_with({'idToken': 'test-token'})
        self.assertEqual(profile['provider'], 'google.com')
        self.assertEqual(profile['balance'], 0)
        with urlopen(Request(path, headers={'Cookie': cookie}), timeout=3) as response:
            self.assertEqual(json.load(response)['user'], profile)

    def test_auth_cannot_serve_the_configured_credential_file(self):
        public_file = Path(__file__).resolve().parents[1] / 'demofinal' / 'assets' / 'club-pricing.json'
        with patch.object(self.server.auth, 'credential_file', public_file):
            self.assertEqual(self.request('/assets/club-pricing.json')[0], 404)

    def test_local_mode_keeps_booking_save_only(self):
        self.server.local_booking = True
        status, body = self.request('/api/booking-config')
        self.assertEqual((status, json.loads(body)), (200, {'mode': 'local', 'available': True}))
        self.assertEqual(self.request('/api/bookings', json.dumps(payload()).encode())[0], 503)
        self.assertEqual(self.sender.messages, [])

    def test_loopback_page_redirect_keeps_path_query_and_canonical_cookie_host(self):
        port = self.server.server_port
        target = '/account.html?topup=demo-order&source=%2Fgames'
        for canonical, alternate in (('127.0.0.1', 'localhost'), ('localhost', '127.0.0.1')):
            self.server.origin = f'http://{canonical}:{port}'
            for method in ('GET', 'HEAD'):
                with self.subTest(canonical=canonical, method=method):
                    connection = http.client.HTTPConnection('127.0.0.1', port, timeout=3)
                    try:
                        connection.request(method, target, headers={'Host': f'{alternate}:{port}'})
                        response = connection.getresponse()
                        self.assertEqual(response.status, 307)
                        self.assertEqual(response.getheader('Location'), self.server.origin + target)
                        self.assertEqual(response.read(), b'')
                    finally:
                        connection.close()

    def test_loopback_redirect_excludes_api_and_post(self):
        port = self.server.server_port
        alternate = f'localhost:{port}'
        for method, target, status in (
            ('GET', '/api/auth/session', 200),
            ('GET', '/api/account/wallet', 404),
            ('POST', '/account.html', 404),
            ('POST', '/api/auth/logout', 403),
        ):
            with self.subTest(method=method, target=target):
                connection = http.client.HTTPConnection('127.0.0.1', port, timeout=3)
                try:
                    connection.request(method, target, body=b'{}' if method == 'POST' else None, headers={
                        'Host': alternate, 'Origin': 'http://' + alternate, 'Content-Type': 'application/json',
                    })
                    response = connection.getresponse()
                    self.assertEqual(response.status, status)
                    self.assertIsNone(response.getheader('Location'))
                    response.read()
                finally:
                    connection.close()

    def test_demo_wallet_is_hidden_without_flag_and_rejects_public_bind(self):
        self.server.local_booking = True
        for path in ('/checkout.html', '/%63heckout.html', '/api/account/wallet'):
            with self.subTest(path=path):
                self.assertEqual(self.request(path)[0], 404)
        self.assertEqual(self.request('/api/account/demo-card', b'{}')[0], 404)
        with self.assertRaises(ValueError):
            make_server('0.0.0.0', 0, {}, local_booking=True, demo_wallet=True)

    def test_wallet_auth_ignores_unrelated_cookie_and_rejects_account_switch(self):
        self.server.demo_wallet = True
        headers = {'Origin': self.origin, 'Content-Type': 'application/json'}
        registration = {'email': 'wallet@example.test', 'password': 'example wallet password'}
        with urlopen(Request(self.origin + '/api/auth/register', data=json.dumps(registration).encode(),
                             headers=headers), timeout=3) as response:
            user = json.load(response)['user']
            cookie = response.headers['Set-Cookie'].split(';', 1)[0]
        headers['Cookie'] = 'unrelated=bare value; ' + cookie

        def start(account):
            return urlopen(Request(self.origin + '/api/account/topups', data=b'{"amount":1000}',
                                   headers={**headers, 'X-Pixel-Account': account}), timeout=3)

        with self.assertRaises(HTTPError) as rejected:
            start('different-account')
        self.assertEqual(rejected.exception.code, 409)
        with rejected.exception as response:
            self.assertEqual(json.load(response)['code'], 'account_changed')

        with start(user['uid']) as response:
            self.assertEqual(response.status, 201)
            self.assertEqual(json.load(response)['status'], 'pending')

        ambiguous = {**headers, 'Cookie': headers['Cookie'] + '; pixel_account=' + 'x' * 43}
        request = Request(self.origin + '/api/account/wallet', headers=ambiguous)
        with self.assertRaises(HTTPError) as rejected:
            urlopen(request, timeout=3)
        self.assertEqual(rejected.exception.code, 401)
        rejected.exception.close()


if __name__ == '__main__':
    unittest.main()
