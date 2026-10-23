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
  assert.deepEqual(C.monthlySummary(sample(), '2026-10'), { income: 300000, expense: 88000, fixedExpense: 0, variableExpense: 88000, net: 212000 });
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
  assert.equal(C.toCsv(s).split('\n')[1], '2026-10-01,支出,変動,食費,100,現金,,"a,""b"""');
});

test('formatYen', () => {
  assert.equal(C.formatYen(1234567), '¥1,234,567');
  assert.equal(C.formatYen(-500), '-¥500');
});

function withSchedule() {
  const s = sample();
  s.fixedExpenses = [
    { id: 'rent', name: '家賃', amount: 80000, category: '住居費', accountId: 'bank', day: 27 },
    { id: 'phone', name: 'スマホ', amount: 3000, category: '通信費', accountId: 'bank', day: 31 },
  ];
  s.loans = [{ id: 'car', name: 'カーローン', balance: 1200000, annualRate: 3, monthlyPayment: 30000, accountId: 'bank', day: 10 }];
  return s;
}

test('dateInMonth は月末に丸める', () => {
  assert.equal(C.dateInMonth('2026-02', 31), '2026-02-28');
  assert.equal(C.dateInMonth('2028-02', 30), '2028-02-29');
  assert.equal(C.dateInMonth('2026-10', 5), '2026-10-05');
});

test('返済の内訳: 利息は残高×年利/12', () => {
  assert.deepEqual(C.loanPaymentSplit(1200000, 3, 30000), { payment: 30000, interest: 3000, principal: 27000 });
  // 最終回は残高＋利息だけ払う
  assert.deepEqual(C.loanPaymentSplit(10000, 12, 30000), { payment: 10100, interest: 100, principal: 10000 });
});

test('完済見通し', () => {
  const p = C.loanProjection(1200000, 0, 100000);
  assert.equal(p.months, 12);
  assert.equal(p.totalInterest, 0);
  const q = C.loanProjection(1200000, 3, 30000);
  assert.ok(q.payable);
  assert.equal(q.months, 43); // 公式では 42.2 か月 → 最終回は端数
  assert.ok(q.totalInterest > 0 && q.totalInterest < 100000);
  assert.equal(C.loanProjection(1000000, 15, 10000).payable, false);
});

test('固定支出・返済の記録で残高と借入が減り、二重記録されない', () => {
  const s = withSchedule();
  const before = C.totalBalance(s);
  const items = C.scheduledItems(s, '2026-11');
  assert.deepEqual(items.map((i) => [i.name, i.date, i.recorded]), [
    ['カーローン', '2026-11-10', false],
    ['家賃', '2026-11-27', false],
    ['スマホ', '2026-11-30', false],
  ]);
  const txs = C.createScheduledTransactions(s, '2026-11');
  assert.equal(txs.length, 3);
  assert.ok(txs.every((t) => t.type === 'expense' && t.fixed));
  s.transactions.push(...txs);
  assert.equal(C.totalBalance(s), before - 80000 - 3000 - 30000);
  assert.equal(C.loanBalance(s, s.loans[0]), 1200000 - 27000);
  assert.equal(C.createScheduledTransactions(s, '2026-11').length, 0);
  assert.ok(C.scheduledItems(s, '2026-11').every((i) => i.recorded));
  const sum = C.monthlySummary(s, '2026-11');
  assert.equal(sum.fixedExpense, 113000);
  assert.equal(sum.variableExpense, 0);
  // 翌月は減った残高で利息を計算
  const next = C.scheduledItems(s, '2026-12').find((i) => i.kind === 'loan');
  assert.equal(next.interest, Math.floor((1173000 * 3) / 100 / 12));
});

test('返済取引を削除すると借入残高が戻る', () => {
  const s = withSchedule();
  s.transactions.push(...C.createScheduledTransactions(s, '2026-11'));
  s.transactions = s.transactions.filter((t) => !t.loanId);
  assert.equal(C.totalLoanBalance(s), 1200000);
});

test('純資産の推移は借入を差し引く', () => {
  const t = C.monthlyTrend(withSchedule(), '2026-10', 1)[0];
  assert.equal(t.netWorth, t.balance - 1200000);
});

test('固定支出・借入の入力チェック', () => {
  const s = sample();
  assert.deepEqual(C.validateFixedExpense({ name: '家賃', amount: 1, category: '住居費', accountId: 'bank', day: 27 }, s), []);
  assert.equal(C.validateFixedExpense({ name: ' ', amount: 0, category: '', accountId: 'x', day: 0 }, s).length, 5);
  assert.deepEqual(C.validateLoan({ name: 'a', balance: 1, annualRate: 0, monthlyPayment: 1, accountId: 'bank', day: 1, rateType: 'fixed' }, s), []);
  assert.equal(C.validateLoan({ name: '', balance: 0, annualRate: 120, monthlyPayment: 0, accountId: 'x', day: 40, rateType: 'fixed' }, s).length, 6);
});

test('normalizeState は旧データに固定支出・借入を補う', () => {
  const s = C.normalizeState({ transactions: [] });
  assert.deepEqual(s.fixedExpenses, []);
  assert.deepEqual(s.loans, []);
});

test('金利タイプ: 旧データは固定金利、変動金利は見直し設定を保持', () => {
  const s = C.normalizeState({ loans: [
    { id: 'a', name: 'A', balance: 1, annualRate: 1, monthlyPayment: 1, accountId: 'bank', day: 1 },
    { id: 'b', name: 'B', balance: 1, annualRate: 1, monthlyPayment: 1, accountId: 'bank', day: 1, rateType: 'variable', reviewYears: '3', nextReview: '2027-04', rateStep: '0.25' },
  ] });
  assert.deepEqual(s.loans.map((l) => l.rateType), ['fixed', 'variable']);
  assert.equal(s.loans[0].reviewYears, undefined);
  assert.equal(s.loans[1].reviewYears, 3);
  assert.equal(s.loans[1].nextReview, '2027-04');
  assert.equal(s.loans[1].rateStep, 0.25);
});

test('次の金利見直し月は N 年ごとに進む', () => {
  const l = { rateType: 'variable', reviewYears: 3, nextReview: '2027-04' };
  assert.equal(C.nextRateReview(l, '2026-10'), '2027-04');
  assert.equal(C.nextRateReview(l, '2027-04'), '2027-04');
  assert.equal(C.nextRateReview(l, '2027-05'), '2030-04');
  assert.equal(C.nextRateReview(l, '2033-04'), '2033-04');
  assert.equal(C.nextRateReview({ rateType: 'fixed' }, '2026-10'), null);
});

test('変動金利の見通し: 想定変動幅 0 なら固定と同じ、上昇なら利息が増える', () => {
  const base = { annualRate: 1, monthlyPayment: 100000, rateType: 'variable', reviewYears: 1, nextReview: '2027-01' };
  const fixed = C.loanProjection(5000000, 1, 100000);
  const flat = C.loanOutlook({ ...base, rateStep: 0 }, 5000000, '2026-11');
  assert.equal(flat.months, fixed.months);
  assert.equal(flat.totalInterest, fixed.totalInterest);
  const up = C.loanOutlook({ ...base, rateStep: 0.5 }, 5000000, '2026-11');
  assert.ok(up.totalInterest > fixed.totalInterest);
  assert.ok(up.months >= fixed.months);
  // 2 回目の返済（2027-01）から 1.5%、2028-01 から 2.0% …
  const exp = C.loanProjection(5000000, 1, 100000, { firstReviewIn: 2, intervalMonths: 12, step: 0.5 });
  assert.deepEqual(up, exp);
  // 金利は 0% 未満にならない
  const down = C.loanOutlook({ ...base, rateStep: -5 }, 5000000, '2026-11');
  assert.equal(down.finalRate, 0);
});

test('変動金利で利息が返済額を上回ると完済不可', () => {
  const p = C.loanProjection(10000000, 1, 30000, { firstReviewIn: 12, intervalMonths: 12, step: 2 });
  assert.equal(p.payable, false);
  assert.ok(p.failMonth > 12);
});

test('変動金利の入力チェック', () => {
  const s = sample();
  const ok = { name: 'a', balance: 1, annualRate: 0.5, monthlyPayment: 1, accountId: 'bank', day: 1, rateType: 'variable', reviewYears: 5, nextReview: '2027-04', rateStep: 0.25 };
  assert.deepEqual(C.validateLoan(ok, s), []);
  assert.equal(C.validateLoan({ ...ok, reviewYears: 0, nextReview: '', rateStep: 20 }, s).length, 3);
  assert.equal(C.validateLoan({ ...ok, reviewYears: 1.5 }, s).length, 1);
});

test('見直し月が最初の返済月なら、その回は入力済みの金利を使う', () => {
  const l = { annualRate: 1, monthlyPayment: 100000, rateType: 'variable', reviewYears: 2, nextReview: '2026-11', rateStep: 0.5 };
  const exp = C.loanProjection(5000000, 1, 100000, { firstReviewIn: 24, intervalMonths: 24, step: 0.5 });
  assert.deepEqual(C.loanOutlook(l, 5000000, '2026-11'), exp);
});
