// 資金管理アプリのデータ処理ロジック（DOM に依存しない純粋関数）
(function (root) {
  'use strict';

  const DEFAULT_CATEGORIES = {
    income: ['給与', '賞与', '副業', '投資収益', 'その他収入'],
    expense: ['食費', '住居費', '水道光熱費', '通信費', '交通費', '日用品', '医療費', '娯楽', '交際費', '教育', '保険', '借入返済', 'その他支出'],
  };

  const DEFAULT_ACCOUNTS = [
    { id: 'cash', name: '現金', initialBalance: 0 },
    { id: 'bank', name: '銀行口座', initialBalance: 0 },
  ];

  function createInitialState() {
    return {
      version: 1,
      accounts: DEFAULT_ACCOUNTS.map((a) => ({ ...a })),
      categories: {
        income: DEFAULT_CATEGORIES.income.slice(),
        expense: DEFAULT_CATEGORIES.expense.slice(),
      },
      budgets: {},
      fixedExpenses: [],
      loans: [],
      transactions: [],
    };
  }

  const LOAN_CATEGORY = '借入返済';

  function genId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  // 保存データを検証し、欠けている項目を補う
  function normalizeState(raw) {
    const base = createInitialState();
    if (!raw || typeof raw !== 'object') return base;
    const state = {
      version: 1,
      accounts: Array.isArray(raw.accounts) && raw.accounts.length ? raw.accounts : base.accounts,
      categories: {
        income: Array.isArray(raw.categories?.income) ? raw.categories.income : base.categories.income,
        expense: Array.isArray(raw.categories?.expense) ? raw.categories.expense : base.categories.expense,
      },
      budgets: raw.budgets && typeof raw.budgets === 'object' ? raw.budgets : {},
      fixedExpenses: Array.isArray(raw.fixedExpenses) ? raw.fixedExpenses : [],
      loans: Array.isArray(raw.loans) ? raw.loans : [],
      transactions: Array.isArray(raw.transactions) ? raw.transactions : [],
    };
    state.accounts = state.accounts.map((a) => ({
      id: String(a.id),
      name: String(a.name),
      initialBalance: Number(a.initialBalance) || 0,
    }));
    state.transactions = state.transactions
      .filter((t) => t && (t.type === 'income' || t.type === 'expense' || t.type === 'transfer'))
      .map((t) => ({
        id: String(t.id || genId()),
        date: String(t.date),
        type: t.type,
        amount: Math.abs(Number(t.amount)) || 0,
        category: t.category ? String(t.category) : '',
        accountId: String(t.accountId),
        toAccountId: t.type === 'transfer' ? String(t.toAccountId) : undefined,
        memo: t.memo ? String(t.memo) : '',
        fixed: t.type === 'expense' && !!t.fixed,
        fixedId: t.fixedId ? String(t.fixedId) : undefined,
        loanId: t.loanId ? String(t.loanId) : undefined,
        principal: t.loanId ? Number(t.principal) || 0 : undefined,
        interest: t.loanId ? Number(t.interest) || 0 : undefined,
      }));
    state.fixedExpenses = state.fixedExpenses.map((f) => ({
      id: String(f.id || genId()),
      name: String(f.name),
      amount: Math.abs(Number(f.amount)) || 0,
      category: String(f.category),
      accountId: String(f.accountId),
      day: clampDay(f.day),
    }));
    state.loans = state.loans.map((l) => ({
      id: String(l.id || genId()),
      name: String(l.name),
      balance: Math.abs(Number(l.balance)) || 0,
      annualRate: Math.abs(Number(l.annualRate)) || 0,
      monthlyPayment: Math.abs(Number(l.monthlyPayment)) || 0,
      accountId: String(l.accountId),
      day: clampDay(l.day),
    }));
    return state;
  }

  function validateTransaction(t, state) {
    const errors = [];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(t.date || '')) errors.push('日付を入力してください');
    if (!(Number(t.amount) > 0)) errors.push('金額は 0 より大きい数値を入力してください');
    if (!state.accounts.some((a) => a.id === t.accountId)) errors.push('口座を選択してください');
    if (t.type === 'transfer') {
      if (!state.accounts.some((a) => a.id === t.toAccountId)) errors.push('振替先の口座を選択してください');
      else if (t.toAccountId === t.accountId) errors.push('振替元と振替先が同じです');
    } else if (t.type === 'income' || t.type === 'expense') {
      if (!t.category) errors.push('カテゴリを選択してください');
    } else {
      errors.push('種別が不正です');
    }
    return errors;
  }

  function clampDay(d) {
    return Math.min(31, Math.max(1, Math.round(Number(d)) || 1));
  }

  function validateFixedExpense(f, state) {
    const errors = [];
    if (!String(f.name || '').trim()) errors.push('名前を入力してください');
    if (!(Number(f.amount) > 0)) errors.push('金額は 0 より大きい数値を入力してください');
    if (!f.category) errors.push('カテゴリを選択してください');
    if (!state.accounts.some((a) => a.id === f.accountId)) errors.push('口座を選択してください');
    if (!(f.day >= 1 && f.day <= 31)) errors.push('引落日は 1〜31 で入力してください');
    return errors;
  }

  function validateLoan(l, state) {
    const errors = [];
    if (!String(l.name || '').trim()) errors.push('名前を入力してください');
    if (!(Number(l.balance) > 0)) errors.push('借入残高は 0 より大きい数値を入力してください');
    if (!(Number(l.annualRate) >= 0 && Number(l.annualRate) < 100)) errors.push('年利は 0〜100% 未満で入力してください');
    if (!(Number(l.monthlyPayment) > 0)) errors.push('月々の返済額は 0 より大きい数値を入力してください');
    if (!state.accounts.some((a) => a.id === l.accountId)) errors.push('引落口座を選択してください');
    if (!(l.day >= 1 && l.day <= 31)) errors.push('返済日は 1〜31 で入力してください');
    return errors;
  }

  function monthKey(date) {
    return String(date).slice(0, 7);
  }

  function shiftMonth(ym, delta) {
    const [y, m] = ym.split('-').map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  }

  // 月末を超える日付は月末に丸める（例: 2月31日 → 2月28日）
  function dateInMonth(ym, day) {
    const [y, m] = ym.split('-').map(Number);
    const last = new Date(y, m, 0).getDate();
    return ym + '-' + String(Math.min(day, last)).padStart(2, '0');
  }

  // 1 か月分の返済の内訳（元利均等の月次計算、利息は円未満切り捨て）
  function loanPaymentSplit(balance, annualRate, monthlyPayment) {
    const interest = Math.floor((balance * annualRate) / 100 / 12);
    const payment = Math.min(monthlyPayment, balance + interest);
    return { payment, interest, principal: payment - interest };
  }

  // 現在の残高から完済までの見通し。返済額が利息以下なら完済不可
  function loanProjection(balance, annualRate, monthlyPayment) {
    let rest = balance;
    let months = 0;
    let totalInterest = 0;
    const firstInterest = Math.floor((balance * annualRate) / 100 / 12);
    if (balance > 0 && monthlyPayment <= firstInterest) return { payable: false, months: Infinity, totalInterest: Infinity, totalPaid: Infinity, firstInterest };
    while (rest > 0 && months < 1200) {
      const s = loanPaymentSplit(rest, annualRate, monthlyPayment);
      rest -= s.principal;
      totalInterest += s.interest;
      months++;
    }
    return { payable: rest <= 0, months, totalInterest, totalPaid: balance + totalInterest, firstInterest };
  }

  // 登録時の残高から、記録済み返済の元金分を差し引いた残高
  function loanBalance(state, loan, untilDate) {
    let paid = 0;
    for (const t of state.transactions) {
      if (t.loanId !== loan.id) continue;
      if (untilDate && t.date > untilDate) continue;
      paid += t.principal || 0;
    }
    return Math.max(0, loan.balance - paid);
  }

  function totalLoanBalance(state, untilDate) {
    return state.loans.reduce((sum, l) => sum + loanBalance(state, l, untilDate), 0);
  }

  // 指定月の固定支出・借入返済の記録状況
  function scheduledItems(state, ym) {
    const inMonth = state.transactions.filter((t) => monthKey(t.date) === ym);
    const items = state.fixedExpenses.map((f) => ({
      kind: 'fixed',
      id: f.id,
      name: f.name,
      category: f.category,
      accountId: f.accountId,
      date: dateInMonth(ym, f.day),
      amount: f.amount,
      recorded: inMonth.some((t) => t.fixedId === f.id),
    }));
    for (const l of state.loans) {
      const recorded = inMonth.some((t) => t.loanId === l.id);
      const bal = loanBalance(state, l);
      if (!recorded && bal <= 0) continue;
      const split = loanPaymentSplit(bal, l.annualRate, l.monthlyPayment);
      items.push({
        kind: 'loan',
        id: l.id,
        name: l.name,
        category: LOAN_CATEGORY,
        accountId: l.accountId,
        date: dateInMonth(ym, l.day),
        amount: recorded ? inMonth.find((t) => t.loanId === l.id).amount : split.payment,
        principal: split.principal,
        interest: split.interest,
        recorded,
      });
    }
    return items.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  }

  // 未記録の固定支出・返済を支出取引として作成する
  function createScheduledTransactions(state, ym) {
    const txs = [];
    for (const item of scheduledItems(state, ym)) {
      if (item.recorded) continue;
      const tx = {
        id: genId(),
        date: item.date,
        type: 'expense',
        amount: item.amount,
        category: item.category,
        accountId: item.accountId,
        memo: item.name,
        fixed: true,
      };
      if (item.kind === 'fixed') tx.fixedId = item.id;
      else Object.assign(tx, { loanId: item.id, principal: item.principal, interest: item.interest });
      txs.push(tx);
    }
    return txs;
  }

  // 指定日（含む）までの各口座残高。date を省略すると全期間
  function accountBalances(state, untilDate) {
    const balances = {};
    for (const a of state.accounts) balances[a.id] = a.initialBalance;
    for (const t of state.transactions) {
      if (untilDate && t.date > untilDate) continue;
      if (t.type === 'income') balances[t.accountId] = (balances[t.accountId] || 0) + t.amount;
      else if (t.type === 'expense') balances[t.accountId] = (balances[t.accountId] || 0) - t.amount;
      else if (t.type === 'transfer') {
        balances[t.accountId] = (balances[t.accountId] || 0) - t.amount;
        balances[t.toAccountId] = (balances[t.toAccountId] || 0) + t.amount;
      }
    }
    return balances;
  }

  function totalBalance(state, untilDate) {
    const b = accountBalances(state, untilDate);
    return state.accounts.reduce((sum, a) => sum + (b[a.id] || 0), 0);
  }

  function transactionsInMonth(state, ym) {
    return state.transactions
      .filter((t) => monthKey(t.date) === ym)
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  }

  function monthlySummary(state, ym) {
    let income = 0;
    let expense = 0;
    let fixedExpense = 0;
    for (const t of state.transactions) {
      if (monthKey(t.date) !== ym) continue;
      if (t.type === 'income') income += t.amount;
      else if (t.type === 'expense') {
        expense += t.amount;
        if (t.fixed) fixedExpense += t.amount;
      }
    }
    return { income, expense, fixedExpense, variableExpense: expense - fixedExpense, net: income - expense };
  }

  function expenseByCategory(state, ym) {
    const totals = {};
    for (const t of state.transactions) {
      if (t.type !== 'expense' || monthKey(t.date) !== ym) continue;
      totals[t.category] = (totals[t.category] || 0) + t.amount;
    }
    return Object.entries(totals)
      .map(([category, amount]) => ({ category, amount }))
      .sort((a, b) => b.amount - a.amount);
  }

  function budgetStatus(state, ym) {
    const spent = Object.fromEntries(expenseByCategory(state, ym).map((e) => [e.category, e.amount]));
    return Object.entries(state.budgets)
      .filter(([, limit]) => Number(limit) > 0)
      .map(([category, limit]) => {
        const used = spent[category] || 0;
        return { category, limit: Number(limit), spent: used, remaining: Number(limit) - used, ratio: used / Number(limit) };
      });
  }

  // 直近 n か月の収支と月末時点の総資産
  function monthlyTrend(state, endYm, n) {
    const result = [];
    for (let i = n - 1; i >= 0; i--) {
      const ym = shiftMonth(endYm, -i);
      const s = monthlySummary(state, ym);
      const balance = totalBalance(state, ym + '-31');
      result.push({ month: ym, ...s, balance, netWorth: balance - totalLoanBalance(state, ym + '-31') });
    }
    return result;
  }

  function csvEscape(v) {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function toCsv(state) {
    const name = Object.fromEntries(state.accounts.map((a) => [a.id, a.name]));
    const typeLabel = { income: '収入', expense: '支出', transfer: '振替' };
    const rows = [['日付', '種別', '区分', 'カテゴリ', '金額', '口座', '振替先', 'メモ']];
    const sorted = state.transactions.slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    for (const t of sorted) {
      rows.push([t.date, typeLabel[t.type], t.type === 'expense' ? (t.fixed ? '固定' : '変動') : '', t.category, t.amount, name[t.accountId] || '', t.toAccountId ? name[t.toAccountId] || '' : '', t.memo]);
    }
    return rows.map((r) => r.map(csvEscape).join(',')).join('\n');
  }

  function formatYen(n) {
    return (n < 0 ? '-' : '') + '¥' + Math.abs(Math.round(n)).toLocaleString('ja-JP');
  }

  const api = {
    DEFAULT_CATEGORIES,
    LOAN_CATEGORY,
    createInitialState,
    normalizeState,
    validateTransaction,
    validateFixedExpense,
    validateLoan,
    dateInMonth,
    loanPaymentSplit,
    loanProjection,
    loanBalance,
    totalLoanBalance,
    scheduledItems,
    createScheduledTransactions,
    genId,
    monthKey,
    shiftMonth,
    accountBalances,
    totalBalance,
    transactionsInMonth,
    monthlySummary,
    expenseByCategory,
    budgetStatus,
    monthlyTrend,
    toCsv,
    formatYen,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.FundCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
