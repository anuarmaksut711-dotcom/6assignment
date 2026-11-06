from concurrent.futures import ThreadPoolExecutor
from contextlib import closing
from pathlib import Path
import sqlite3
from tempfile import TemporaryDirectory
import unittest

from pixel_accounts import AccountError, PixelAccounts


class PixelWalletTests(unittest.TestCase):
    def setUp(self):
        directory = TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.path = Path(directory.name) / 'accounts.sqlite3'
        self.origin = 'http://127.0.0.1:8879'
        self.accounts = PixelAccounts(self.path, self.origin)
        self.alice, self.cookie = self.accounts.register(
            {'email': 'alice@example.test', 'password': 'Local fixture 145'},
        )
        self.bob, _ = self.accounts.register(
            {'email': 'bob@example.test', 'password': 'Other fixture 174'},
        )
        self.owner = self.alice['uid']
        self.other = self.bob['uid']

    def _fund_wallet(self, amount):
        self.accounts.add_demo_card(self.owner)
        topup = self.accounts.create_topup(self.owner, amount)
        return self.accounts.confirm_topup(self.owner, topup['id'])

    def _expect_error(self, code, operation, *args):
        with self.assertRaises(AccountError) as failure:
            operation(*args)
        self.assertEqual(failure.exception.code, code)

    def test_topup_limits_pending_status_card_requirement_and_ownership(self):
        for amount in (99, 50_001, 2_000.0, '2000', True, None):
            with self.subTest(amount=amount):
                self._expect_error('invalid_amount', self.accounts.create_topup, self.owner, amount)
        order = self.accounts.create_topup(self.owner, 100)
        self.assertEqual(order['status'], 'pending')
        self.assertEqual(self.accounts.get_topup(self.owner, order['id']), {**order, 'balance': 0})
        self.assertIsNone(self.accounts.get_demo_card(self.owner))
        self._expect_error('demo_card_required', self.accounts.confirm_topup, self.owner, order['id'])
        self.assertEqual(self.accounts.add_demo_card(self.owner), {'last4': '4242'})
        self.assertEqual(self.accounts.add_demo_card(self.owner), self.accounts.get_demo_card(self.owner))
        self._expect_error('topup_not_found', self.accounts.get_topup, self.other, order['id'])
        self._expect_error('topup_not_found', self.accounts.confirm_topup, self.other, order['id'])
        self.assertIsNone(self.accounts.get_demo_card(self.other))
        self.assertEqual(self.accounts.wallet_balance(self.owner), 0)

    def test_concurrent_topup_replay_credits_once_and_persists_separately(self):
        with closing(sqlite3.connect(self.path)) as db, db:
            db.execute('UPDATE accounts SET balance = 3750 WHERE uid = ?', (self.owner,))
        self.accounts.add_demo_card(self.owner)
        topup = self.accounts.create_topup(self.owner, 3000)
        other_instance = PixelAccounts(self.path, self.origin)

        def confirm(service):
            return service.confirm_topup(self.owner, topup['id'])

        with ThreadPoolExecutor(max_workers=4) as pool:
            results = list(pool.map(confirm, [self.accounts, other_instance] * 2))
        self.assertEqual(results, [{**topup, 'status': 'paid', 'balance': 3000}] * 4)

        reopened = PixelAccounts(self.path, self.origin)
        self.assertEqual(reopened.wallet_balance(self.owner), 3000)
        self.assertEqual(reopened.wallet_balance(self.other), 0)
        self.assertEqual(reopened.get_demo_card(self.owner), {'last4': '4242'})
        self.assertEqual(reopened.current_user(self.cookie.partition(';')[0])['balance'], 3750)

    def test_purchase_uses_fixed_catalog_and_replays_without_second_debit(self):
        catalog = {item['id']: item for item in self.accounts.list_packages()}
        self.assertEqual(set(item['hours'] for item in catalog.values()), {3, 5})
        self.assertEqual(catalog['standard-3-hours']['price'], 2100)
        self._fund_wallet(5000)
        request = 'first-package-987654'
        for item in ('standard-1-hour', 'standard-night', 'standard-student', 'missing'):
            self._expect_error('invalid_package', self.accounts.purchase_package, self.owner, item, request)

        def purchase(_):
            return self.accounts.purchase_package(self.owner, 'standard-3-hours', request)

        with ThreadPoolExecutor(max_workers=3) as pool:
            receipts = list(pool.map(purchase, range(3)))
        self.assertEqual(receipts, [receipts[0]] * 3)
        result = receipts[0]
        self.assertEqual(result['balance'], 2900)
        self.assertEqual(result['purchase']['price'], 2100)
        self.assertEqual(result['purchase']['hours'], 3)
        self.assertEqual(result['purchase']['packageId'], 'standard-3-hours')
        self.assertEqual(self.accounts.get_purchases(self.owner), [result['purchase']])
        self.assertEqual(self.accounts.get_purchases(self.other), [])
        self._expect_error('purchase_conflict', self.accounts.purchase_package,
                           self.owner, 'standard-5-hours', request)
        self.assertEqual(self.accounts.wallet_balance(self.owner), 2900)
        self.assertEqual(self.accounts.current_user(self.cookie.partition(';')[0])['balance'], 0)

    def test_concurrent_distinct_purchases_cannot_overdraw_wallet(self):
        self._fund_wallet(3000)

        def purchase(request):
            try:
                return self.accounts.purchase_package(self.owner, 'standard-3-hours', request)
            except AccountError as failure:
                return failure.code

        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(purchase, ['distinct-package-1', 'distinct-package-2']))
        self.assertEqual(sum(result == 'insufficient_balance' for result in results), 1)
        self.assertEqual(self.accounts.wallet_balance(self.owner), 900)
        self.assertEqual(len(self.accounts.get_purchases(self.owner)), 1)


if __name__ == '__main__':
    unittest.main()
