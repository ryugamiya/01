// 資金管理アプリのデータ処理ロジック（DOM に依存しない純粋関数）
(function (root) {
  'use strict';

  const DEFAULT_CATEGORIES = {
    income: ['給与', '賞与', '副業', '投資収益', 'その他収入'],
    expense: ['食費', '住居費', '水道光熱費', '通信費', '交通費', '日用品', '医療費', '娯楽', '交際費', '教育', '保険', 'その他支出'],
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
      transactions: [],
    };
  }

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

  function monthKey(date) {
    return String(date).slice(0, 7);
  }

  function shiftMonth(ym, delta) {
    const [y, m] = ym.split('-').map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
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
    for (const t of state.transactions) {
      if (monthKey(t.date) !== ym) continue;
      if (t.type === 'income') income += t.amount;
      else if (t.type === 'expense') expense += t.amount;
    }
    return { income, expense, net: income - expense };
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
      result.push({ month: ym, ...s, balance: totalBalance(state, ym + '-31') });
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
    const rows = [['日付', '種別', 'カテゴリ', '金額', '口座', '振替先', 'メモ']];
    const sorted = state.transactions.slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    for (const t of sorted) {
      rows.push([t.date, typeLabel[t.type], t.category, t.amount, name[t.accountId] || '', t.toAccountId ? name[t.toAccountId] || '' : '', t.memo]);
    }
    return rows.map((r) => r.map(csvEscape).join(',')).join('\n');
  }

  function formatYen(n) {
    return (n < 0 ? '-' : '') + '¥' + Math.abs(Math.round(n)).toLocaleString('ja-JP');
  }

  const api = {
    DEFAULT_CATEGORIES,
    createInitialState,
    normalizeState,
    validateTransaction,
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
