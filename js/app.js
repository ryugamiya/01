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
    renderAccounts();
    renderSettings();
    syncFormOptions();
  }

  function renderDashboard() {
    const s = C.monthlySummary(state, currentMonth);
    $('#stat-total').textContent = C.formatYen(C.totalBalance(state, currentMonth + '-31'));
    $('#stat-income').textContent = C.formatYen(s.income);
    $('#stat-expense').textContent = C.formatYen(s.expense);
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
    const values = data.flatMap((d) => [d.income, d.expense, d.balance]);
    // 目盛りが切りの良い値になるよう上下限を丸める
    const step = niceStep((Math.max(0, ...values) - Math.min(0, ...values)) / 4 || 1);
    const maxV = Math.ceil(Math.max(0, ...values) / step) * step || step;
    const minV = Math.floor(Math.min(0, ...values) / step) * step;
    const range = maxV - minV;
    const y = (v) => padT + plotH - ((v - minV) / range) * plotH;
    const slot = plotW / data.length;
    const bw = Math.min(18, slot / 4);

    let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="直近6か月の収入・支出・総資産の推移">`;
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
      pts.push([cx, y(d.balance), d]);
    });
    svg += `<polyline class="line-balance" points="${pts.map((p) => p[0] + ',' + p[1]).join(' ')}" />`;
    pts.forEach(([x, yy, d]) => {
      svg += `<circle class="dot-balance" cx="${x}" cy="${yy}" r="3.5"><title>${d.month} 総資産 ${C.formatYen(d.balance)}</title></circle>`;
    });
    svg += '</svg>';
    svg += '<div class="legend"><span class="l-income">収入</span><span class="l-expense">支出</span><span class="l-balance">月末総資産</span></div>';
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
        cat = esc(t.category);
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
    const used = new Set(state.transactions.flatMap((t) => [t.accountId, t.toAccountId]));
    const items = state.accounts.map((a) => `
      <li>
        <div><div class="name">${esc(a.name)}</div><div class="sub">開始残高 ${C.formatYen(a.initialBalance)}</div></div>
        <span class="bal ${bal[a.id] < 0 ? 'expense' : ''}">${C.formatYen(bal[a.id] || 0)}</span>
        <button type="button" class="link" data-acct-edit="${esc(a.id)}">編集</button>
        <button type="button" class="link del" data-acct-del="${esc(a.id)}" ${used.has(a.id) || state.accounts.length <= 1 ? 'disabled title="取引がある口座、または最後の口座は削除できません"' : ''}>削除</button>
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
    $('#tx-form-title').textContent = '取引を追加';
    $('#tx-submit').textContent = '追加';
    $('#tx-cancel').hidden = true;
    $('#tx-errors').textContent = '';
  }

  function startEdit(id) {
    const t = state.transactions.find((x) => x.id === id);
    if (!t) return;
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
    $('#tx-form-title').textContent = '取引を編集';
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
    };
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
    if (del && confirm('この取引を削除しますか？')) {
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
  renderInstallCard();
})();
