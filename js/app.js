// 画面描画とイベント処理
(function () {
  'use strict';

  const C = window.FundCore;
  const STORAGE_KEY = 'fund-manager-v1';
  const $ = (sel) => document.querySelector(sel);

  let state = load();
  let currentMonth = todayStr().slice(0, 7);

  function todayStr() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function load() {
    try {
      return C.normalizeState(JSON.parse(localStorage.getItem(STORAGE_KEY)));
    } catch (e) {
      return C.createInitialState();
    }
  }

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      alert('データを保存できませんでした: ' + e.message);
    }
  }

  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function accountName(id) {
    const a = state.accounts.find((x) => x.id === id);
    return a ? a.name : '(削除済み)';
  }

  function commit() {
    save();
    render();
  }

  // ---------- 描画 ----------

  function render() {
    $('#current-month').value = currentMonth;
    renderDashboard();
    renderTransactions();
    renderFixed();
    renderAccounts();
    renderSettings();
    syncFormOptions();
    syncFixedFormOptions();
  }

  function renderDashboard() {
    const s = C.monthlySummary(state, currentMonth);
    const total = C.totalBalance(state, currentMonth + '-31');
    const loan = C.totalLoanBalance(state, currentMonth + '-31');
    $('#stat-total').textContent = C.formatYen(total);
    $('#stat-loan').textContent = C.formatYen(loan);
    const nw = $('#stat-networth');
    nw.textContent = C.formatYen(total - loan);
    nw.className = 'value ' + (total - loan < 0 ? 'expense' : '');
    $('#stat-income').textContent = C.formatYen(s.income);
    $('#stat-expense').textContent = C.formatYen(s.expense);
    $('#stat-expense-split').textContent = `固定 ${C.formatYen(s.fixedExpense)}・変動 ${C.formatYen(s.variableExpense)}`;
    const net = $('#stat-net');
    net.textContent = (s.net > 0 ? '+' : '') + C.formatYen(s.net);
    net.className = 'value ' + (s.net >= 0 ? 'income' : 'expense');

    const cats = C.expenseByCategory(state, currentMonth);
    const max = cats.length ? cats[0].amount : 0;
    $('#category-chart').innerHTML = cats.length
      ? cats.map((c) => `
        <div class="bar-row">
          <div class="bar-head"><span>${esc(c.category)}</span><span class="amt">${C.formatYen(c.amount)}（${Math.round((c.amount / s.expense) * 100)}%）</span></div>
          <div class="bar-track"><div class="bar-fill" style="width:${(c.amount / max) * 100}%"></div></div>
        </div>`).join('')
      : '<p class="empty">支出はまだありません</p>';

    const budgets = C.budgetStatus(state, currentMonth);
    $('#budget-list').innerHTML = budgets.length
      ? budgets.map((b) => {
          const cls = b.ratio > 1 ? 'over' : b.ratio >= 0.8 ? 'warn' : '';
          const rest = b.remaining >= 0 ? `残り ${C.formatYen(b.remaining)}` : `${C.formatYen(-b.remaining)} 超過`;
          return `
          <div class="bar-row">
            <div class="bar-head"><span>${esc(b.category)}</span><span class="amt">${C.formatYen(b.spent)} / ${C.formatYen(b.limit)}・${rest}</span></div>
            <div class="bar-track"><div class="bar-fill ${cls}" style="width:${Math.min(b.ratio, 1) * 100}%"></div></div>
          </div>`;
        }).join('')
      : '<p class="empty">「予算・設定」タブで予算を設定できます</p>';

    renderTrend();
  }

  function renderTrend() {
    const data = C.monthlyTrend(state, currentMonth, 6);
    const W = 640, H = 240, padL = 64, padR = 12, padT = 12, padB = 28;
    const plotW = W - padL - padR, plotH = H - padT - padB;
    const values = data.flatMap((d) => [d.income, d.expense, d.netWorth]);
    // 目盛りが切りの良い値になるよう上下限を丸める
    const step = niceStep((Math.max(0, ...values) - Math.min(0, ...values)) / 4 || 1);
    const maxV = Math.ceil(Math.max(0, ...values) / step) * step || step;
    const minV = Math.floor(Math.min(0, ...values) / step) * step;
    const range = maxV - minV;
    const y = (v) => padT + plotH - ((v - minV) / range) * plotH;
    const slot = plotW / data.length;
    const bw = Math.min(18, slot / 4);

    let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="直近6か月の収入・支出・純資産の推移">`;
    for (let v = minV; v <= maxV; v += step) {
      svg += `<line class="axis" x1="${padL}" x2="${W - padR}" y1="${y(v)}" y2="${y(v)}" />`;
      svg += `<text x="${padL - 6}" y="${y(v) + 4}" text-anchor="end">${shortYen(v)}</text>`;
    }
    const pts = [];
    data.forEach((d, i) => {
      const cx = padL + slot * i + slot / 2;
      svg += `<rect class="bar-income" x="${cx - bw - 1}" y="${y(d.income)}" width="${bw}" height="${Math.max(0, y(0) - y(d.income))}" rx="2"><title>${d.month} 収入 ${C.formatYen(d.income)}</title></rect>`;
      svg += `<rect class="bar-expense" x="${cx + 1}" y="${y(d.expense)}" width="${bw}" height="${Math.max(0, y(0) - y(d.expense))}" rx="2"><title>${d.month} 支出 ${C.formatYen(d.expense)}</title></rect>`;
      svg += `<text x="${cx}" y="${H - 8}" text-anchor="middle">${Number(d.month.slice(5))}月</text>`;
      pts.push([cx, y(d.netWorth), d]);
    });
    svg += `<polyline class="line-balance" points="${pts.map((p) => p[0] + ',' + p[1]).join(' ')}" />`;
    pts.forEach(([x, yy, d]) => {
      svg += `<circle class="dot-balance" cx="${x}" cy="${yy}" r="3.5"><title>${d.month} 純資産 ${C.formatYen(d.netWorth)}</title></circle>`;
    });
    svg += '</svg>';
    svg += '<div class="legend"><span class="l-income">収入</span><span class="l-expense">支出</span><span class="l-balance">月末純資産</span></div>';
    $('#trend-chart').innerHTML = svg;
  }

  function niceStep(raw) {
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const n = raw / mag;
    return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * mag;
  }

  function shortYen(v) {
    const a = Math.abs(v);
    const sign = v < 0 ? '-' : '';
    if (a >= 1e8) return sign + (a / 1e8).toFixed(1).replace(/\.0$/, '') + '億';
    if (a >= 1e4) return sign + Math.round(a / 1e4).toLocaleString('ja-JP') + '万';
    return sign + Math.round(a).toLocaleString('ja-JP');
  }

  function renderTransactions() {
    const q = $('#tx-search').value.trim().toLowerCase();
    const list = C.transactionsInMonth(state, currentMonth).filter((t) => {
      if (!q) return true;
      return [t.memo, t.category, accountName(t.accountId)].some((s) => String(s).toLowerCase().includes(q));
    });
    $('#tx-body').innerHTML = list.map((t) => {
      let cat, amt, cls;
      if (t.type === 'transfer') {
        cat = '<span class="tag-transfer">振替</span>';
        amt = C.formatYen(t.amount);
        cls = '';
      } else {
        cat = esc(t.category) + (t.loanId ? ' <span class="tag">返済</span>' : t.fixed ? ' <span class="tag">固定</span>' : '');
        amt = (t.type === 'income' ? '+' : '-') + C.formatYen(t.amount);
        cls = t.type;
      }
      const acct = t.type === 'transfer'
        ? `${esc(accountName(t.accountId))} → ${esc(accountName(t.toAccountId))}`
        : esc(accountName(t.accountId));
      return `<tr>
        <td>${t.date.slice(5).replace('-', '/')}</td>
        <td>${cat}</td>
        <td>${acct}</td>
        <td class="memo">${esc(t.memo)}</td>
        <td class="num ${cls}">${amt}</td>
        <td class="actions">
          <button type="button" class="link" data-edit="${esc(t.id)}">編集</button>
          <button type="button" class="link del" data-del="${esc(t.id)}">削除</button>
        </td>
      </tr>`;
    }).join('');
    $('#tx-empty').hidden = list.length > 0;
  }

  function renderAccounts() {
    const bal = C.accountBalances(state);
    const used = new Set([
      ...state.transactions.flatMap((t) => [t.accountId, t.toAccountId]),
      ...state.fixedExpenses.map((f) => f.accountId),
      ...state.loans.map((l) => l.accountId),
    ]);
    const items = state.accounts.map((a) => `
      <li>
        <div><div class="name">${esc(a.name)}</div><div class="sub">開始残高 ${C.formatYen(a.initialBalance)}</div></div>
        <span class="bal ${bal[a.id] < 0 ? 'expense' : ''}">${C.formatYen(bal[a.id] || 0)}</span>
        <button type="button" class="link" data-acct-edit="${esc(a.id)}">編集</button>
        <button type="button" class="link del" data-acct-del="${esc(a.id)}" ${used.has(a.id) || state.accounts.length <= 1 ? 'disabled title="入出金・固定費・借入で使っている口座、または最後の口座は削除できません"' : ''}>削除</button>
      </li>`);
    items.push(`<li class="total"><div class="name">合計（現在）</div><span class="bal">${C.formatYen(C.totalBalance(state))}</span></li>`);
    $('#account-list').innerHTML = items.join('');
  }

  function renderSettings() {
    $('#budget-inputs').innerHTML = state.categories.expense.map((c) => `
      <label>${esc(c)}<input type="number" min="0" step="1" name="${esc(c)}" value="${state.budgets[c] || ''}" placeholder="予算なし"></label>`).join('');

    for (const type of ['expense', 'income']) {
      $('#cat-' + type).innerHTML = state.categories[type].map((c) => `
        <li>${esc(c)}<button type="button" data-cat-del="${esc(c)}" data-cat-type="${type}" aria-label="${esc(c)} を削除">×</button></li>`).join('');
    }
  }

  // 取引フォームの選択肢を現在の種別・口座・カテゴリに合わせる
  function syncFormOptions() {
    const form = $('#tx-form');
    const type = form.type.value;
    const keep = (sel, opts) => {
      const prev = sel.value;
      sel.innerHTML = opts.map(([v, label]) => `<option value="${esc(v)}">${esc(label)}</option>`).join('');
      if (opts.some(([v]) => v === prev)) sel.value = prev;
    };
    const acctOpts = state.accounts.map((a) => [a.id, a.name]);
    keep(form.accountId, acctOpts);
    keep(form.toAccountId, acctOpts);
    if (type !== 'transfer') keep(form.category, state.categories[type].map((c) => [c, c]));

    const isTransfer = type === 'transfer';
    form.querySelector('.field-category').hidden = isTransfer;
    form.querySelector('.field-to-account').hidden = !isTransfer;
    form.querySelector('.account-label').textContent = isTransfer ? '振替元' : '口座';
    form.querySelector('.field-kind').hidden = type !== 'expense';
  }

  // ---------- 取引フォーム ----------

  function resetTxForm() {
    const form = $('#tx-form');
    const keepType = form.type.value;
    const keepAccount = form.accountId.value;
    form.reset();
    form.txId.value = '';
    form.type.value = keepType;
    form.date.value = currentMonth === todayStr().slice(0, 7) ? todayStr() : currentMonth + '-01';
    syncFormOptions();
    if (keepAccount) form.accountId.value = keepAccount;
    form.kind.value = 'variable';
    $('#tx-form-title').textContent = '入出金を追加';
    $('#tx-submit').textContent = '追加';
    $('#tx-cancel').hidden = true;
    $('#tx-errors').textContent = '';
  }

  function startEdit(id) {
    const t = state.transactions.find((x) => x.id === id);
    if (!t) return;
    if (t.loanId) {
      alert('借入の返済は元金・利息の内訳と連動しているため編集できません。\n修正する場合は削除して「固定費・借入」タブから記録し直してください。');
      return;
    }
    const form = $('#tx-form');
    form.type.value = t.type;
    syncFormOptions();
    form.txId.value = t.id;
    form.date.value = t.date;
    form.amount.value = t.amount;
    form.accountId.value = t.accountId;
    if (t.type === 'transfer') form.toAccountId.value = t.toAccountId;
    else {
      // 削除済みカテゴリでも編集できるよう一時的に選択肢へ追加
      if (![...form.category.options].some((o) => o.value === t.category)) {
        form.category.insertAdjacentHTML('beforeend', `<option value="${esc(t.category)}">${esc(t.category)}</option>`);
      }
      form.category.value = t.category;
    }
    form.memo.value = t.memo;
    form.kind.value = t.fixed ? 'fixed' : 'variable';
    $('#tx-form-title').textContent = '入出金を編集';
    $('#tx-submit').textContent = '更新';
    $('#tx-cancel').hidden = false;
    $('#tx-errors').textContent = '';
    form.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  $('#tx-form').addEventListener('change', (e) => {
    if (e.target.name === 'type') syncFormOptions();
  });

  $('#tx-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const form = e.target;
    const tx = {
      id: form.txId.value || C.genId(),
      type: form.type.value,
      date: form.date.value,
      amount: Math.round(Number(form.amount.value)),
      category: form.type.value === 'transfer' ? '' : form.category.value,
      accountId: form.accountId.value,
      toAccountId: form.type.value === 'transfer' ? form.toAccountId.value : undefined,
      memo: form.memo.value.trim(),
      fixed: form.type.value === 'expense' && form.kind.value === 'fixed',
    };
    // 固定支出リストから記録したものは、支出のままなら紐づけを残す（二重記録の防止）
    const prev = state.transactions.find((t) => t.id === tx.id);
    if (prev && prev.fixedId && tx.type === 'expense') tx.fixedId = prev.fixedId;
    const errors = C.validateTransaction(tx, state);
    if (errors.length) {
      $('#tx-errors').textContent = errors.join(' / ');
      return;
    }
    const idx = state.transactions.findIndex((t) => t.id === tx.id);
    if (idx >= 0) state.transactions[idx] = tx;
    else state.transactions.push(tx);
    currentMonth = C.monthKey(tx.date);
    commit();
    resetTxForm();
  });

  $('#tx-cancel').addEventListener('click', resetTxForm);

  $('#tx-body').addEventListener('click', (e) => {
    const edit = e.target.closest('[data-edit]');
    const del = e.target.closest('[data-del]');
    if (edit) startEdit(edit.dataset.edit);
    if (del && confirm('この入出金を削除しますか？')) {
      state.transactions = state.transactions.filter((t) => t.id !== del.dataset.del);
      if ($('#tx-form').txId.value === del.dataset.del) resetTxForm();
      commit();
    }
  });

  $('#tx-search').addEventListener('input', renderTransactions);

  // ---------- 月の切り替え・タブ ----------

  function setMonth(ym) {
    if (!/^\d{4}-\d{2}$/.test(ym)) return;
    currentMonth = ym;
    render();
    if (!$('#tx-form').txId.value) resetTxForm();
  }

  $('#prev-month').addEventListener('click', () => setMonth(C.shiftMonth(currentMonth, -1)));
  $('#next-month').addEventListener('click', () => setMonth(C.shiftMonth(currentMonth, 1)));
  $('#current-month').addEventListener('change', (e) => setMonth(e.target.value));

  document.querySelectorAll('.tabs button').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('active', b === btn));
      document.querySelectorAll('.tab-panel').forEach((p) => p.classList.toggle('active', p.id === 'tab-' + btn.dataset.tab));
    });
  });

  // ---------- 固定費・借入 ----------

  function monthLabel(ym) {
    return `${ym.slice(0, 4)}年${Number(ym.slice(5))}月`;
  }

  function renderFixed() {
    $('#schedule-title').textContent = `${monthLabel(currentMonth)}の固定支出・返済`;
    const items = C.scheduledItems(state, currentMonth);
    $('#schedule-list').innerHTML = items.map((i) => `
      <li>
        <div>
          <div class="name">${esc(i.name)} ${i.kind === 'loan' ? '<span class="tag">返済</span>' : ''}</div>
          <div class="sub">${Number(i.date.slice(8))}日・${esc(i.category)}・${esc(accountName(i.accountId))}${
            i.kind === 'loan' && !i.recorded ? `・元金 ${C.formatYen(i.principal)} / 利息 ${C.formatYen(i.interest)}` : ''}</div>
        </div>
        <span class="bal">${C.formatYen(i.amount)}</span>
        <span class="status ${i.recorded ? 'done' : ''}">${i.recorded ? '記録済み' : '未記録'}</span>
      </li>`).join('');
    const pending = items.filter((i) => !i.recorded);
    $('#schedule-empty').hidden = items.length > 0 || state.fixedExpenses.length + state.loans.length > 0;
    $('#record-schedule').disabled = pending.length === 0;
    $('#record-schedule').textContent = pending.length
      ? `未記録の ${pending.length} 件を記録（${C.formatYen(pending.reduce((a, i) => a + i.amount, 0))}）`
      : 'すべて記録済み';

    $('#fixed-list').innerHTML = state.fixedExpenses.map((f) => `
      <li>
        <div><div class="name">${esc(f.name)}</div><div class="sub">毎月${f.day}日・${esc(f.category)}・${esc(accountName(f.accountId))}</div></div>
        <span class="bal">${C.formatYen(f.amount)}</span>
        <button type="button" class="link" data-fixed-edit="${esc(f.id)}">編集</button>
        <button type="button" class="link del" data-fixed-del="${esc(f.id)}">削除</button>
      </li>`).join('');
    if (state.fixedExpenses.length) {
      const sum = state.fixedExpenses.reduce((a, f) => a + f.amount, 0);
      $('#fixed-list').insertAdjacentHTML('beforeend', `<li class="total"><div class="name">固定支出の合計（月）</div><span class="bal">${C.formatYen(sum)}</span></li>`);
    }

    $('#loan-list').innerHTML = state.loans.map((l) => {
      const bal = C.loanBalance(state, l);
      // 表示月の返済が記録済みなら、残りは翌月から数える
      const paidThisMonth = state.transactions.some((t) => t.loanId === l.id && C.monthKey(t.date) === currentMonth);
      const startYm = paidThisMonth ? C.shiftMonth(currentMonth, 1) : currentMonth;
      const p = C.loanOutlook(l, bal, startYm);
      let outlook;
      if (bal <= 0) outlook = '<span class="income">完済しました</span>';
      else outlook = describeOutlook(p, startYm, l.rateType === 'variable' ? l.rateStep : 0, '今後の利息');
      let rateInfo = `固定金利 ${l.annualRate}%`;
      let reviewAlert = '';
      if (l.rateType === 'variable') {
        const review = C.nextRateReview(l, currentMonth);
        rateInfo = `変動金利 ${l.annualRate}%（${l.reviewYears}年ごとに見直し・次回 ${review ? monthLabel(review) : '未設定'}）`;
        if (review === currentMonth && bal > 0) {
          reviewAlert = '<div class="sub warn-text">今月は金利の見直し月です。新しい金利が決まったら「編集」で年利を更新してください。</div>';
        }
      }
      return `
      <li>
        <div>
          <div class="name">${esc(l.name)} <span class="tag">${l.rateType === 'variable' ? '変動' : '固定'}</span></div>
          <div class="sub">${rateInfo}</div>
          <div class="sub">毎月${l.day}日 ${C.formatYen(l.monthlyPayment)}・${esc(accountName(l.accountId))}</div>
          <div class="sub">${outlook}</div>
          ${reviewAlert}
        </div>
        <span class="bal">${C.formatYen(bal)}</span>
        <button type="button" class="link" data-loan-edit="${esc(l.id)}">編集</button>
        <button type="button" class="link del" data-loan-del="${esc(l.id)}">削除</button>
      </li>`;
    }).join('');
    if (state.loans.length) {
      $('#loan-list').insertAdjacentHTML('beforeend', `<li class="total"><div class="name">借入残高の合計（現在）</div><span class="bal">${C.formatYen(C.totalLoanBalance(state))}</span></li>`);
    }
    updateLoanPreview();
  }

  function fillSelect(sel, opts) {
    const prev = sel.value;
    sel.innerHTML = opts.map(([v, label]) => `<option value="${esc(v)}">${esc(label)}</option>`).join('');
    if (opts.some(([v]) => v === prev)) sel.value = prev;
  }

  function syncFixedFormOptions() {
    const acctOpts = state.accounts.map((a) => [a.id, a.name]);
    fillSelect($('#fixed-form').category, state.categories.expense.map((c) => [c, c]));
    fillSelect($('#fixed-form').accountId, acctOpts);
    fillSelect($('#loan-form').accountId, acctOpts);
  }

  function readNumber(input) {
    return input.value.trim() === '' ? NaN : Number(input.value);
  }

  // 完済見通しの文章。変動金利で想定変動幅があれば、その前提も添える
  function describeOutlook(p, startYm, rateStep, interestLabel) {
    const assumption = rateStep ? `見直しごとに${rateStep > 0 ? '+' : ''}${rateStep}%の想定で、` : '';
    if (!p.payable) {
      if (p.failMonth) {
        const when = monthLabel(C.shiftMonth(startYm, p.failMonth - 1));
        return `<span class="expense">${assumption}${when}頃に金利が${p.failRate.toFixed(2).replace(/\.?0+$/, '')}%になり、利息が返済額を上回るため完済できません</span>`;
      }
      return `<span class="expense">返済額が月の利息（${C.formatYen(p.firstInterest)}）以下のため完済できません</span>`;
    }
    const years = Math.floor(p.months / 12), months = p.months % 12;
    const span = `${years ? years + '年' : ''}${months ? months + 'か月' : ''}`;
    const last = monthLabel(C.shiftMonth(startYm, p.months - 1));
    return `${assumption}完済まであと ${p.months} 回（${span}・${last}頃）・${interestLabel} ${C.formatYen(p.totalInterest)}`;
  }

  // フォームの入力内容を借入データの形にする
  function loanFromForm(form) {
    const l = {
      name: form.title.value.trim(),
      annualRate: readNumber(form.annualRate),
      monthlyPayment: Math.round(readNumber(form.monthlyPayment)),
      accountId: form.accountId.value,
      day: Math.round(readNumber(form.day)),
      rateType: form.rateType.value,
    };
    if (l.rateType === 'variable') {
      l.reviewYears = readNumber(form.reviewYears);
      l.nextReview = form.nextReview.value;
      l.rateStep = form.rateStep.value.trim() === '' ? 0 : Number(form.rateStep.value);
    }
    return l;
  }

  // 金利タイプに応じて変動金利の入力欄を出し分ける
  function syncRateFields() {
    const form = $('#loan-form');
    const variable = form.rateType.value === 'variable';
    form.querySelectorAll('.field-variable').forEach((el) => { el.hidden = !variable; });
    form.querySelector('.rate-label').textContent = variable ? '現在の年利（%）' : '年利（%）';
    if (variable && !form.nextReview.value) form.nextReview.value = C.shiftMonth(currentMonth, 12);
  }

  // 入力中の借入から完済見通しをその場で表示
  function updateLoanPreview() {
    const form = $('#loan-form');
    const l = loanFromForm(form);
    const bal = readNumber(form.balance);
    const out = $('#loan-preview');
    if (!(bal > 0 && l.annualRate >= 0 && l.monthlyPayment > 0)) {
      out.textContent = '残高・年利・返済額を入れると、完済までの回数と利息の総額を計算します。';
      out.className = 'loan-preview hint';
      return;
    }
    const usable = l.rateType === 'variable' && l.reviewYears >= 1 && /^\d{4}-\d{2}$/.test(l.nextReview);
    const p = usable
      ? C.loanOutlook({ ...l, reviewYears: Math.round(l.reviewYears) }, Math.round(bal), currentMonth)
      : C.loanProjection(Math.round(bal), l.annualRate, l.monthlyPayment);
    out.innerHTML = describeOutlook(p, currentMonth, usable ? l.rateStep : 0, '利息の総額')
      + (p.payable ? `・支払総額 ${C.formatYen(p.totalPaid)}` : '');
    out.className = 'loan-preview';
  }

  function resetFixedForm() {
    const form = $('#fixed-form');
    form.reset();
    form.fixedId.value = '';
    $('#fixed-form-title').textContent = '固定支出を登録';
    $('#fixed-submit').textContent = '登録';
    $('#fixed-cancel').hidden = true;
    $('#fixed-errors').textContent = '';
    syncFixedFormOptions();
  }

  function resetLoanForm() {
    const form = $('#loan-form');
    form.reset();
    form.loanId.value = '';
    $('#loan-form-title').textContent = '借入を登録';
    $('#loan-submit').textContent = '登録';
    $('#loan-cancel').hidden = true;
    $('#loan-errors').textContent = '';
    syncFixedFormOptions();
    syncRateFields();
    updateLoanPreview();
  }

  $('#record-schedule').addEventListener('click', () => {
    const txs = C.createScheduledTransactions(state, currentMonth);
    if (!txs.length) return;
    const total = txs.reduce((a, t) => a + t.amount, 0);
    if (!confirm(`${monthLabel(currentMonth)}の固定支出・返済 ${txs.length} 件（${C.formatYen(total)}）を支出として記録しますか？`)) return;
    state.transactions.push(...txs);
    commit();
  });

  $('#fixed-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const form = e.target;
    const f = {
      id: form.fixedId.value || C.genId(),
      name: form.title.value.trim(),
      amount: Math.round(Number(form.amount.value)),
      category: form.category.value,
      accountId: form.accountId.value,
      day: Math.round(Number(form.day.value)),
    };
    const errors = C.validateFixedExpense(f, state);
    if (errors.length) {
      $('#fixed-errors').textContent = errors.join(' / ');
      return;
    }
    const idx = state.fixedExpenses.findIndex((x) => x.id === f.id);
    if (idx >= 0) state.fixedExpenses[idx] = f;
    else state.fixedExpenses.push(f);
    commit();
    resetFixedForm();
  });

  $('#fixed-cancel').addEventListener('click', resetFixedForm);

  $('#fixed-list').addEventListener('click', (e) => {
    const edit = e.target.closest('[data-fixed-edit]');
    const del = e.target.closest('[data-fixed-del]');
    if (edit) {
      const f = state.fixedExpenses.find((x) => x.id === edit.dataset.fixedEdit);
      const form = $('#fixed-form');
      syncFixedFormOptions();
      form.fixedId.value = f.id;
      form.title.value = f.name;
      form.amount.value = f.amount;
      if (![...form.category.options].some((o) => o.value === f.category)) {
        form.category.insertAdjacentHTML('beforeend', `<option value="${esc(f.category)}">${esc(f.category)}</option>`);
      }
      form.category.value = f.category;
      form.accountId.value = f.accountId;
      form.day.value = f.day;
      $('#fixed-form-title').textContent = '固定支出を編集';
      $('#fixed-submit').textContent = '更新';
      $('#fixed-cancel').hidden = false;
      form.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    if (del && confirm('この固定支出を削除しますか？（記録済みの支出はそのまま残ります）')) {
      state.fixedExpenses = state.fixedExpenses.filter((x) => x.id !== del.dataset.fixedDel);
      if ($('#fixed-form').fixedId.value === del.dataset.fixedDel) resetFixedForm();
      commit();
    }
  });

  $('#loan-form').addEventListener('input', updateLoanPreview);
  $('#loan-form').addEventListener('change', (e) => {
    if (e.target.name === 'rateType') {
      syncRateFields();
      updateLoanPreview();
    }
  });

  $('#loan-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const form = e.target;
    const id = form.loanId.value || C.genId();
    const current = Math.round(Number(form.balance.value));
    const l = { id, balance: current, ...loanFromForm(form) };
    const errors = C.validateLoan(l, state);
    if (errors.length) {
      $('#loan-errors').textContent = errors.join(' / ');
      return;
    }
    const idx = state.loans.findIndex((x) => x.id === id);
    if (idx >= 0) {
      // 入力は「現在の残高」なので、記録済み返済の元金分を足して登録時点の残高として保存する
      const repaid = state.loans[idx].balance - C.loanBalance(state, state.loans[idx]);
      l.balance = current + repaid;
      state.loans[idx] = l;
    } else {
      state.loans.push(l);
    }
    commit();
    resetLoanForm();
  });

  $('#loan-cancel').addEventListener('click', resetLoanForm);

  $('#loan-list').addEventListener('click', (e) => {
    const edit = e.target.closest('[data-loan-edit]');
    const del = e.target.closest('[data-loan-del]');
    if (edit) {
      const l = state.loans.find((x) => x.id === edit.dataset.loanEdit);
      const form = $('#loan-form');
      syncFixedFormOptions();
      form.loanId.value = l.id;
      form.title.value = l.name;
      form.balance.value = C.loanBalance(state, l);
      form.annualRate.value = l.annualRate;
      form.monthlyPayment.value = l.monthlyPayment;
      form.accountId.value = l.accountId;
      form.day.value = l.day;
      form.rateType.value = l.rateType;
      if (l.rateType === 'variable') {
        form.reviewYears.value = l.reviewYears;
        form.nextReview.value = l.nextReview;
        form.rateStep.value = l.rateStep;
      }
      syncRateFields();
      $('#loan-form-title').textContent = '借入を編集';
      $('#loan-submit').textContent = '更新';
      $('#loan-cancel').hidden = false;
      updateLoanPreview();
      form.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    if (del && confirm('この借入を削除しますか？（記録済みの返済は支出として残ります）')) {
      state.loans = state.loans.filter((x) => x.id !== del.dataset.loanDel);
      if ($('#loan-form').loanId.value === del.dataset.loanDel) resetLoanForm();
      commit();
    }
  });

  // ---------- 口座 ----------

  $('#account-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const form = e.target;
    const name = form.name.value.trim();
    if (!name) return;
    state.accounts.push({ id: C.genId(), name, initialBalance: Math.round(Number(form.initialBalance.value) || 0) });
    form.reset();
    commit();
  });

  $('#account-list').addEventListener('click', (e) => {
    const edit = e.target.closest('[data-acct-edit]');
    const del = e.target.closest('[data-acct-del]');
    if (edit) {
      const a = state.accounts.find((x) => x.id === edit.dataset.acctEdit);
      const name = prompt('口座名', a.name);
      if (name === null) return;
      const init = prompt('開始残高（円）', String(a.initialBalance));
      if (init === null) return;
      if (name.trim()) a.name = name.trim();
      if (init.trim() !== '' && !Number.isNaN(Number(init))) a.initialBalance = Math.round(Number(init));
      commit();
    }
    if (del && !del.disabled && confirm('この口座を削除しますか？')) {
      state.accounts = state.accounts.filter((a) => a.id !== del.dataset.acctDel);
      commit();
    }
  });

  // ---------- 予算・カテゴリ ----------

  $('#budget-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const budgets = {};
    e.target.querySelectorAll('input').forEach((inp) => {
      const v = Math.round(Number(inp.value));
      if (v > 0) budgets[inp.name] = v;
    });
    state.budgets = budgets;
    commit();
    alert('予算を保存しました');
  });

  document.querySelectorAll('.inline-form').forEach((form) => {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const type = form.dataset.catType;
      const name = form.name.value.trim();
      if (!name) return;
      if (state.categories[type].includes(name)) {
        alert('同じ名前のカテゴリがあります');
        return;
      }
      state.categories[type].push(name);
      form.reset();
      commit();
    });
  });

  document.querySelector('#tab-settings').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-cat-del]');
    if (!btn) return;
    const { catDel, catType } = btn.dataset;
    if (state.categories[catType].length <= 1) {
      alert('カテゴリは最低 1 つ必要です');
      return;
    }
    if (!confirm(`カテゴリ「${catDel}」を削除しますか？（既存の取引はそのまま残ります）`)) return;
    state.categories[catType] = state.categories[catType].filter((c) => c !== catDel);
    if (catType === 'expense') delete state.budgets[catDel];
    commit();
  });

  // ---------- データ入出力 ----------

  function download(filename, content, mime) {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  $('#export-json').addEventListener('click', () => {
    download(`fund-backup-${todayStr()}.json`, JSON.stringify(state, null, 2), 'application/json');
  });

  $('#export-csv').addEventListener('click', () => {
    // Excel で文字化けしないよう BOM を付与
    download(`fund-transactions-${todayStr()}.csv`, '﻿' + C.toCsv(state), 'text/csv');
  });

  $('#import-json').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!data || !Array.isArray(data.transactions)) throw new Error('取引データが見つかりません');
      if (!confirm('現在のデータを上書きして復元しますか？')) return;
      state = C.normalizeState(data);
      commit();
      resetTxForm();
      resetFixedForm();
      resetLoanForm();
      alert('復元しました');
    } catch (err) {
      alert('復元に失敗しました: ' + err.message);
    }
  });

  $('#reset-data').addEventListener('click', () => {
    if (!confirm('全データを削除して初期状態に戻します。よろしいですか？')) return;
    state = C.createInitialState();
    commit();
    resetTxForm();
    resetFixedForm();
    resetLoanForm();
  });

  // ---------- アプリ化（PWA） ----------

  const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  let installPrompt = null;

  function renderInstallCard() {
    const status = $('#install-status');
    $('#install-actions').hidden = !installPrompt;
    $('#install-ios').hidden = !(isIos && !isStandalone());
    if (isStandalone()) status.textContent = 'アプリとしてインストール済みです。オフラインでも使えます。';
    else if (isIos) status.textContent = 'Safari でホーム画面に追加すると、アプリのように全画面で起動し、オフラインでも使えます。';
  }

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    installPrompt = e;
    renderInstallCard();
  });

  window.addEventListener('appinstalled', () => {
    installPrompt = null;
    renderInstallCard();
  });

  $('#install-button').addEventListener('click', async () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    await installPrompt.userChoice;
    installPrompt = null;
    renderInstallCard();
  });

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch((err) => console.warn('Service Worker の登録に失敗しました', err));
    });
  }

  // ブラウザの容量不足時にデータが自動削除されないよう永続化を要求
  if (navigator.storage && navigator.storage.persist) {
    navigator.storage.persisted().then((p) => p || navigator.storage.persist()).catch(() => {});
  }

  // ---------- 起動 ----------
  render();
  resetTxForm();
  resetFixedForm();
  resetLoanForm();
  renderInstallCard();
})();
