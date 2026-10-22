const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../js/core.js');

function sample() {
  const s = C.createInitialState();
  s.accounts[0].initialBalance = 10000; // cash
  s.accounts[1].initialBalance = 500000; // bank
  s.transactions = [
    { id: '1', date: '2026-09-25', type: 'income', amount: 300000, category: '給与', accountId: 'bank', memo: '' },
    { id: '2', date: '2026-10-01', type: 'expense', amount: 80000, category: '住居費', accountId: 'bank', memo: '家賃' },
    { id: '3', date: '2026-10-05', type: 'expense', amount: 3000, category: '食費', accountId: 'cash', memo: '' },
    { id: '4', date: '2026-10-07', type: 'expense', amount: 5000, category: '食費', accountId: 'cash', memo: '' },
    { id: '5', date: '2026-10-10', type: 'transfer', amount: 20000, category: '', accountId: 'bank', toAccountId: 'cash', memo: 'ATM' },
    { id: '6', date: '2026-10-25', type: 'income', amount: 300000, category: '給与', accountId: 'bank', memo: '' },
  ];
  return s;
}

test('口座残高: 振替は総資産を変えない', () => {
  const s = sample();
  const b = C.accountBalances(s);
  assert.equal(b.cash, 10000 - 8000 + 20000);
  assert.equal(b.bank, 500000 + 300000 - 80000 - 20000 + 300000);
  assert.equal(C.totalBalance(s), 510000 + 600000 - 88000);
});

test('指定日までの残高', () => {
  assert.equal(C.totalBalance(sample(), '2026-09-30'), 810000);
});

test('月次サマリーは振替を含まない', () => {
  assert.deepEqual(C.monthlySummary(sample(), '2026-10'), { income: 300000, expense: 88000, net: 212000 });
});

test('カテゴリ別支出は金額の降順', () => {
  assert.deepEqual(C.expenseByCategory(sample(), '2026-10'), [
    { category: '住居費', amount: 80000 },
    { category: '食費', amount: 8000 },
  ]);
});

test('予算の状況', () => {
  const s = sample();
  s.budgets = { 食費: 6000, 娯楽: 10000, 交通費: 0 };
  const st = C.budgetStatus(s, '2026-10');
  assert.equal(st.length, 2);
  assert.deepEqual(st[0], { category: '食費', limit: 6000, spent: 8000, remaining: -2000, ratio: 8000 / 6000 });
  assert.equal(st[1].spent, 0);
});

test('月の推移', () => {
  const t = C.monthlyTrend(sample(), '2026-10', 3);
  assert.deepEqual(t.map((x) => x.month), ['2026-08', '2026-09', '2026-10']);
  assert.equal(t[0].balance, 510000);
  assert.equal(t[1].income, 300000);
  assert.equal(t[2].balance, 1022000);
});

test('shiftMonth は年をまたぐ', () => {
  assert.equal(C.shiftMonth('2026-01', -1), '2025-12');
  assert.equal(C.shiftMonth('2026-12', 1), '2027-01');
});

test('入力チェック', () => {
  const s = sample();
  assert.deepEqual(C.validateTransaction({ type: 'expense', date: '2026-10-01', amount: 100, category: '食費', accountId: 'cash' }, s), []);
  assert.equal(C.validateTransaction({ type: 'expense', date: '', amount: 0, category: '', accountId: 'x' }, s).length, 4);
  assert.deepEqual(C.validateTransaction({ type: 'transfer', date: '2026-10-01', amount: 1, accountId: 'cash', toAccountId: 'cash' }, s), ['振替元と振替先が同じです']);
});

test('normalizeState は壊れたデータを補正する', () => {
  assert.deepEqual(C.normalizeState(null), C.createInitialState());
  const s = C.normalizeState({ transactions: [{ type: 'bogus' }, { id: 'a', type: 'expense', date: '2026-01-01', amount: '-500', category: '食費', accountId: 'cash' }] });
  assert.equal(s.transactions.length, 1);
  assert.equal(s.transactions[0].amount, 500);
  assert.equal(s.accounts.length, 2);
});

test('CSV はカンマ・引用符をエスケープする', () => {
  const s = sample();
  s.transactions = [{ id: 'x', date: '2026-10-01', type: 'expense', amount: 100, category: '食費', accountId: 'cash', memo: 'a,"b"' }];
  assert.equal(C.toCsv(s).split('\n')[1], '2026-10-01,支出,食費,100,現金,,"a,""b"""');
});

test('formatYen', () => {
  assert.equal(C.formatYen(1234567), '¥1,234,567');
  assert.equal(C.formatYen(-500), '-¥500');
});
