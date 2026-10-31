// Interfața aplicației: navigare, panou, tranzacții, import, cash și setări.
(() => {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const money = (v, sign = false) => (sign && v > 0 ? '+' : '') + v.toLocaleString('ro-RO', { minimumFractionDigits: 0, maximumFractionDigits: 2 }) + ' MDL';
  const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const MONTHS = ['ianuarie', 'februarie', 'martie', 'aprilie', 'mai', 'iunie', 'iulie', 'august', 'septembrie', 'octombrie', 'noiembrie', 'decembrie'];
  const monthLabel = (m) => { const [y, mm] = m.split('-'); return `${MONTHS[Number(mm) - 1]} ${y}`; };
  const dayLabel = (d) => { const [y, m, dd] = d.split('-'); return `${Number(dd)} ${MONTHS[Number(m) - 1]} ${y}`; };

  const state = { txs: [], cash: [], rules: [], remindDays: 3, month: today().slice(0, 7), pending: null, editing: null };

  async function load() {
    [state.txs, state.cash, state.rules] = await Promise.all([DB.all('transactions'), DB.all('cash'), DB.all('rules')]);
    state.remindDays = Number(await DB.getSetting('remindDays', 3));
    state.balances = await DB.getSetting('balances', {});
    state.deposits = await DB.getSetting('deposits', []);
  }

  function toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => { t.hidden = true; }, 3200);
  }

  function confirmBox(title, text) {
    return new Promise((resolve) => {
      const d = $('confirmDialog');
      $('confirmTitle').textContent = title;
      $('confirmText').textContent = text;
      d.returnValue = '';
      d.onclose = () => resolve(d.returnValue === 'yes');
      d.showModal();
    });
  }

  // ---------- Navigare ----------
  const VIEWS = ['dashboard', 'transactions', 'import', 'cash', 'settings'];
  function route() {
    let v = location.hash.slice(1) || 'dashboard';
    if (v === 'cash-ask') { askCash(); v = 'cash'; history.replaceState(null, '', '#cash'); }
    if (v === 'settings-deposits') {
      v = 'settings';
      history.replaceState(null, '', '#settings');
      setTimeout(() => $('depositsCard').scrollIntoView({ behavior: 'smooth' }), 50);
    }
    if (!VIEWS.includes(v)) v = 'dashboard';
    for (const name of VIEWS) $('view-' + name).hidden = name !== v;
    document.querySelectorAll('.tabbar a').forEach((a) => a.classList.toggle('active', a.dataset.view === v));
    // Graficele se desenează după lățimea reală, care e 0 cât timp panoul e ascuns.
    if (v === 'dashboard') renderDashboard();
    window.scrollTo(0, 0);
  }

  function renderAll() {
    renderTop();
    renderDashboard();
    renderTransactions();
    renderCash();
    renderSettings();
    renderDeposits();
  }

  // ---------- Sus: total ----------
  function renderTop() {
    const card = Stats.cardBalance(state.txs, state.balances);
    const cash = Stats.cashBalance(state.cash, state.txs);
    const dep = depositTotal();
    const total = (card ? card.value : 0) + (cash ? cash.value : 0) + dep;
    $('topTotal').textContent = card || cash || dep ? money(Math.round(total)) : '—';
  }

  // ---------- Depozite ----------
  const depositTotal = () => state.deposits.reduce((s, d) => s + d.amount, 0);
  const monthlyInterest = (d) => (d.amount * (d.rate || 0)) / 100 / 12;

  function renderDepositTile() {
    const total = depositTotal();
    $('tileDeposit').textContent = state.deposits.length ? money(Math.round(total)) : '—';
    const interest = state.deposits.reduce((s, d) => s + monthlyInterest(d), 0);
    $('tileDepositSub').textContent = !state.deposits.length ? 'adaugă depozitul tău'
      : interest > 0 ? `~${money(Math.round(interest))}/lună dobândă` : `${state.deposits.length} depozit(e)`;
  }

  // Transferuri spre depozit găsite în extrase, care încă nu sunt adăugate ca depozit.
  function depositSuggestions() {
    const linked = new Set(state.deposits.map((d) => d.fromTx));
    return state.txs.filter((t) => t.category === 'Economii (depozit)' && t.amount < 0 && !linked.has(t.id));
  }

  function renderDeposits() {
    $('depositSuggest').innerHTML = depositSuggestions().map((t) =>
      `<div class="suggest"><span>În extras: <b>${esc(t.description)}</b>, ${money(-t.amount)} pe ${dayLabel(t.date)}.</span>
        <button class="btn secondary" data-tx="${t.id}">Adaugă ca depozit</button></div>`).join('');
    $('depositList').innerHTML = state.deposits.map((d) => {
      const bits = [];
      if (d.rate) bits.push(`${d.rate}% pe an, ~${money(Math.round(monthlyInterest(d)))}/lună`);
      if (d.end) bits.push(`scadent ${dayLabel(d.end)}`);
      return `<li data-dep="${d.id}"><div class="tx-main"><div class="tx-desc">🏦 ${esc(d.name)}</div><div class="tx-meta">${bits.join(' · ') || 'apasă ca să editezi'}</div></div>
        <div class="tx-amt">${money(d.amount)}</div></li>`;
    }).join('');
  }

  function editDeposit(d, prefill = {}) {
    state.editingDeposit = d || null;
    const src = d || prefill;
    $('depName').value = src.name || 'Depozit maib';
    $('depAmount').value = src.amount ?? '';
    $('depRate').value = src.rate ?? '';
    $('depStart').value = src.start || '';
    $('depEnd').value = src.end || '';
    $('depSave').textContent = d ? 'Salvează' : 'Adaugă depozitul';
    $('depCancel').hidden = !d && !prefill.fromTx;
    $('depDelete').hidden = !d;
    state.depositFromTx = prefill.fromTx || null;
    $('depositForm').scrollIntoView({ behavior: 'smooth', block: 'center' });
    $('depAmount').focus();
  }

  function resetDepositForm() {
    state.editingDeposit = null;
    state.depositFromTx = null;
    $('depositForm').reset();
    $('depSave').textContent = 'Adaugă depozitul';
    $('depCancel').hidden = true;
    $('depDelete').hidden = true;
  }

  async function saveDeposit(e) {
    e.preventDefault();
    const d = state.editingDeposit || { id: 'd' + DB.uid(), fromTx: state.depositFromTx || undefined };
    Object.assign(d, {
      name: $('depName').value.trim() || 'Depozit',
      amount: Number($('depAmount').value),
      rate: $('depRate').value ? Number($('depRate').value) : null,
      start: $('depStart').value || null,
      end: $('depEnd').value || null
    });
    const list = state.deposits.filter((x) => x.id !== d.id).concat(d);
    await DB.setSetting('deposits', list);
    resetDepositForm();
    await load();
    renderAll();
    toast('Depozitul a fost salvat.');
  }

  async function onDepositListClick(e) {
    const btn = e.target.closest('button[data-tx]');
    if (btn) {
      const t = state.txs.find((x) => x.id === btn.dataset.tx);
      if (t) editDeposit(null, { name: 'Depozit maib', amount: -t.amount, start: t.date, fromTx: t.id });
      return;
    }
    const li = e.target.closest('li[data-dep]');
    if (li) editDeposit(state.deposits.find((d) => d.id === li.dataset.dep));
  }

  async function deleteDeposit() {
    const d = state.editingDeposit;
    if (!d || !(await confirmBox('Ștergi depozitul?', `${d.name}, ${money(d.amount)}`))) return;
    await DB.setSetting('deposits', state.deposits.filter((x) => x.id !== d.id));
    resetDepositForm();
    await load();
    renderAll();
  }

  // ---------- Panou ----------
  function fillMonthSelect(sel, months, value, withAll) {
    sel.innerHTML = (withAll ? '<option value="">Toate lunile</option>' : '') +
      months.map((m) => `<option value="${m}">${monthLabel(m)}</option>`).join('');
    sel.value = value;
  }

  function renderDashboard() {
    const months = Stats.monthList(state.txs);
    if (!months.includes(state.month)) state.month = months[0];
    fillMonthSelect($('monthSelect'), months, state.month);

    $('emptyState').hidden = state.txs.length > 0 || state.cash.length > 0;
    renderDepositTile();

    const card = Stats.cardBalance(state.txs, state.balances);
    $('tileCard').textContent = card ? money(Math.round(card.value)) : '—';
    $('tileCardSub').textContent = card
      ? (card.accounts > 1 ? `${card.accounts} conturi, ` : '') + `la ${dayLabel(card.date)}`
      : 'importă un extras';

    const cash = Stats.cashBalance(state.cash, state.txs);
    $('tileCash').textContent = cash ? money(Math.round(cash.value)) : '—';
    $('tileCashSub').textContent = cash
      ? (cash.estimated ? 'estimat, cu retragerile de după' : `declarat ${dayLabel(cash.date.slice(0, 10))}`)
      : 'încă nedeclarat';

    const s = Stats.summary(state.txs, state.month);
    $('tileIncome').textContent = money(Math.round(s.income));
    $('tileExpense').textContent = money(Math.round(s.expense));
    const prev = Stats.summary(state.txs, Stats.shiftMonth(state.month, -1));
    const sub = $('tileExpenseSub');
    if (prev.expense > 0 && s.expense > 0) {
      const d = Math.round((s.expense / prev.expense - 1) * 100);
      sub.textContent = `${d > 0 ? '▲ +' : '▼ '}${d}% față de luna trecută`;
      sub.className = 'tile-sub ' + (d > 0 ? 'up-bad' : 'down-good');
    } else { sub.textContent = ''; sub.className = 'tile-sub'; }

    Charts.categories($('categoryChart'), s.categories, s.expense);
    Charts.months($('monthsChart'), Stats.lastMonths(state.txs, state.month, 6));

    const tips = Stats.insights(state.txs, state.month);
    const interest = state.deposits.reduce((s, d) => s + monthlyInterest(d), 0);
    if (interest > 0) tips.push({ html: `Depozitul îți aduce ~<b>${money(Math.round(interest))}</b> pe lună din dobândă.` });
    else if (depositSuggestions().length && !state.deposits.length) {
      tips.push({ html: 'Am văzut în extras un transfer spre depozit. <a href="#settings-deposits">Adaugă depozitul</a> ca să intre în totalul tău.' });
    }
    $('insights').innerHTML = tips
      .map((i) => `<li class="${i.warn ? 'warn' : ''}">${i.warn ? '⚠️ ' : '💡 '}${i.html}</li>`).join('');

    const top = s.merchants.slice(0, 7);
    $('topMerchants').innerHTML = top.length
      ? top.map((m) => `<li>${esc(m.name)} <span class="muted small">(${m.count}×)</span><span class="v">${money(Math.round(m.total))}</span></li>`).join('')
      : '<li class="muted">Nimic încă.</li>';
  }

  // ---------- Tranzacții ----------
  function renderTransactions() {
    const months = Stats.monthList(state.txs);
    const mSel = $('txMonth');
    const mVal = mSel.dataset.init ? mSel.value : state.month;
    fillMonthSelect(mSel, months, mVal, true);
    mSel.dataset.init = '1';

    const cSel = $('txCategory');
    const cVal = cSel.value;
    cSel.innerHTML = '<option value="">Toate categoriile</option>' + Categories.LIST.map((c) => `<option>${esc(c)}</option>`).join('');
    cSel.value = cVal;

    const q = Categories.norm($('txSearch').value);
    const list = state.txs
      .filter((t) => (!mSel.value || t.date.startsWith(mSel.value)) && (!cSel.value || t.category === cSel.value) &&
        (!q || Categories.norm(t.description).includes(q)))
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

    const spent = -list.filter(Stats.isExpense).reduce((s, t) => s + t.amount, 0);
    const got = list.filter(Stats.isIncome).reduce((s, t) => s + t.amount, 0);
    $('txSummary').textContent = `${list.length} tranzacții · cheltuieli ${money(Math.round(spent))} · venituri ${money(Math.round(got))}`;

    let html = '', lastDay = '';
    for (const t of list.slice(0, 500)) {
      if (t.date !== lastDay) { html += `<li class="tx-day">${dayLabel(t.date)}</li>`; lastDay = t.date; }
      const src = t.source === 'cash' ? '💵 ' : t.source === 'manual' ? '✍️ ' : '';
      html += `<li data-id="${t.id}"><div class="tx-main"><div class="tx-desc">${src}${esc(t.description)}</div><div class="tx-meta">${esc(t.category)}</div></div>
        <div class="tx-amt ${t.amount > 0 ? 'pos' : ''}">${money(t.amount, true)}</div></li>`;
    }
    if (list.length > 500) html += `<li class="tx-day">… încă ${list.length - 500}. Folosește filtrele.</li>`;
    $('txList').innerHTML = html || '<li class="tx-day">Nicio tranzacție.</li>';
  }

  function openTx(tx) {
    state.editing = tx;
    $('txDialogTitle').textContent = tx ? 'Editează tranzacția' : 'Tranzacție nouă';
    $('txDate').value = tx ? tx.date : today();
    $('txDesc').value = tx ? tx.description : '';
    $('txAmount').value = tx ? tx.amount : '';
    $('txCat').innerHTML = Categories.LIST.map((c) => `<option>${esc(c)}</option>`).join('');
    $('txCat').value = tx ? tx.category : 'Altele';
    $('txRule').checked = false;
    $('txRuleWrap').hidden = !tx || tx.source === 'cash';
    $('txDeleteBtn').hidden = !tx;
    $('txDialog').returnValue = '';
    $('txDialog').showModal();
  }

  async function onTxDialogClose() {
    const action = $('txDialog').returnValue;
    const tx = state.editing;
    if (action === 'delete' && tx) {
      if (!(await confirmBox('Ștergi tranzacția?', tx.description))) return;
      await DB.del('transactions', tx.id);
      toast('Tranzacția a fost ștearsă.');
    } else if (action === 'save') {
      const amount = Number($('txAmount').value);
      const desc = $('txDesc').value.trim();
      if (!desc || !amount || !$('txDate').value) return toast('Completează data, descrierea și suma.');
      const category = $('txCat').value;
      const next = { ...(tx || { id: 'u' + DB.uid(), source: 'manual' }), date: $('txDate').value, description: desc, amount, category };
      await DB.put('transactions', next);
      if (tx && $('txRule').checked) {
        const pattern = Categories.merchantKey(desc);
        if (pattern) {
          await DB.put('rules', { id: 'r' + DB.uid(), pattern, category });
          await load();
          const changed = state.txs.filter((t) => t.source !== 'cash' && Categories.norm(t.description).includes(pattern) && t.category !== category);
          changed.forEach((t) => { t.category = category; });
          await DB.putMany('transactions', changed);
          toast(`Regulă nouă: „${pattern}” → ${category}. Am actualizat ${changed.length + 1} tranzacții.`);
        }
      } else toast('Salvat.');
    } else return;
    await load();
    renderAll();
  }

  // ---------- Import ----------
  async function onFile(e) {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    $('importResult').hidden = true;
    try {
      const buf = await file.arrayBuffer();
      if (new TextDecoder().decode(new Uint8Array(buf, 0, 5)) === '%PDF-') {
        showImportResult('Citesc PDF-ul…');
        const { meta, transactions } = await PdfStatement.read(buf, state.rules);
        $('importResult').hidden = true;
        state.pending = { pdf: true, meta, result: transactions, name: file.name };
        return renderPdfPreview();
      }
      const rows = await Importer.readFile(file);
      if (rows.length < 2) throw new Error('Fișierul pare gol.');
      const headerIdx = Importer.findHeader(rows);
      const header = rows[headerIdx].map((c) => String(c ?? '').trim());
      const sig = Importer.signature(header);
      const saved = await DB.getSetting('mapping:' + sig, null);
      const map = saved ? saved.map : Importer.guessMapping(header);
      state.pending = { rows, headerIdx, header, sig, map, invert: saved ? saved.invert : false, name: file.name };
      renderMapping();
    } catch (err) {
      showImportResult(`<b>Nu am putut citi fișierul.</b><br>${esc(err.message)}`);
    }
  }

  function renderMapping() {
    const p = state.pending;
    $('mappingCard').hidden = false;
    $('mappingCard').querySelector('h2').textContent = 'Verifică coloanele';
    $('mappingInfo').textContent = `${p.name}: ${p.rows.length - p.headerIdx - 1} rânduri. Am ghicit coloanele, verifică-le.`;
    const opts = '<option value="">—</option>' + p.header.map((h, i) => `<option value="${i}">${esc(h || 'Coloana ' + (i + 1))}</option>`).join('');
    $('mapping').innerHTML = Importer.FIELDS.map(([f, label]) =>
      `<label class="field">${label}<select data-field="${f}">${opts}</select></label>`).join('') +
      `<label class="check"><input type="checkbox" id="invertSign" ${p.invert ? 'checked' : ''}> Cheltuielile apar ca sume pozitive</label>`;
    $('mapping').querySelectorAll('select').forEach((s) => {
      s.value = p.map[s.dataset.field] ?? '';
      s.onchange = () => {
        if (s.value === '') delete p.map[s.dataset.field]; else p.map[s.dataset.field] = Number(s.value);
        renderPreview();
      };
    });
    $('invertSign').onchange = (e) => { p.invert = e.target.checked; renderPreview(); };
    renderPreview();
    $('mappingCard').scrollIntoView({ behavior: 'smooth' });
  }

  function renderPreview() {
    const p = state.pending;
    const ok = p.map.date !== undefined && p.map.description !== undefined &&
      (p.map.amount !== undefined || p.map.debit !== undefined || p.map.credit !== undefined);
    $('doImportBtn').disabled = !ok;
    if (!ok) { $('previewTable').innerHTML = '<tr><td>Alege coloanele Data, Descriere și Suma (sau Debit/Credit).</td></tr>'; return; }
    const { transactions, skipped } = Importer.build(p.rows, p.headerIdx, p.map, { invert: p.invert, rules: state.rules });
    p.result = transactions;
    renderPreviewTable(transactions, skipped ? `, ${skipped} rânduri sărite (fără dată sau sumă)` : '');
  }

  function renderPreviewTable(transactions, note = '') {
    const head = '<tr><th>Data</th><th>Descriere</th><th>Suma</th><th>Categorie</th></tr>';
    const body = transactions.slice(0, 8).map((t) =>
      `<tr><td>${t.date}</td><td>${esc(t.description.slice(0, 50))}</td><td>${money(t.amount, true)}</td><td>${esc(t.category)}</td></tr>`).join('');
    const inn = transactions.filter((t) => t.amount > 0).reduce((s, t) => s + t.amount, 0);
    const out = -transactions.filter((t) => t.amount < 0).reduce((s, t) => s + t.amount, 0);
    $('previewTable').innerHTML = head + body +
      `<tr><td colspan="4" class="muted">${transactions.length} tranzacții recunoscute${note}. Intrări ${money(Math.round(inn * 100) / 100)}, ieșiri ${money(Math.round(out * 100) / 100)}.</td></tr>`;
  }

  function renderPdfPreview() {
    const { meta, result, name } = state.pending;
    $('mappingCard').hidden = false;
    $('mappingCard').querySelector('h2').textContent = 'Verifică extrasul';
    $('mappingInfo').textContent = `${name}: extras maib PDF, contul ${meta.account}` +
      (meta.period ? `, ${meta.period[0]} – ${meta.period[1]}` : '') +
      (meta.balance !== null ? `, sold final ${money(meta.balance)}` : '') + '.';
    $('mapping').innerHTML = '';
    $('doImportBtn').disabled = !result.length;
    renderPreviewTable(result);
    $('mappingCard').scrollIntoView({ behavior: 'smooth' });
  }

  async function doImport() {
    const p = state.pending;
    if (!p || !p.result) return;
    const existing = new Set(state.txs.map((t) => t.id));
    // Păstrăm categoriile schimbate manual la tranzacțiile deja importate.
    const fresh = p.result.filter((t) => !existing.has(t.id));
    await DB.putMany('transactions', fresh);
    if (p.pdf) {
      // Soldul final al fiecărui cont; îl păstrăm pe cel din extrasul cel mai recent.
      if (p.meta.balance !== null) {
        const balances = await DB.getSetting('balances', {});
        const date = p.meta.generated || p.result.map((t) => t.date).sort().pop();
        if (!balances[p.meta.account] || balances[p.meta.account].date <= date) {
          balances[p.meta.account] = { value: p.meta.balance, date };
          await DB.setSetting('balances', balances);
        }
      }
    } else {
      await DB.setSetting('mapping:' + p.sig, { map: p.map, invert: p.invert });
    }
    const dates = p.result.map((t) => t.date).sort();
    state.pending = null;
    $('mappingCard').hidden = true;
    await load();
    const own = Stats.linkOwnTransfers(state.txs);
    if (own.length) await DB.putMany('transactions', own);
    if (dates.length) state.month = dates[dates.length - 1].slice(0, 7);
    renderAll();
    showImportResult(`<b>Gata!</b> Am adăugat <b>${fresh.length}</b> tranzacții noi` +
      (p.result.length - fresh.length ? `, ${p.result.length - fresh.length} existau deja` : '') +
      (dates.length ? `, perioada ${dayLabel(dates[0])} – ${dayLabel(dates[dates.length - 1])}` : '') +
      (own.length ? `. Am găsit ${own.length / 2} transferuri între conturile tale; nu le număr ca venit sau cheltuială` : '') +
      '. <a href="#dashboard">Vezi panoul</a>');
  }

  function showImportResult(html) {
    $('importResult').innerHTML = html;
    $('importResult').hidden = false;
  }

  // ---------- Cash ----------
  async function saveCash(amount) {
    if (!(amount >= 0)) return toast('Scrie o sumă validă.');
    const now = new Date().toISOString();
    const prev = state.cash.length ? state.cash.reduce((a, b) => (b.date > a.date ? b : a)) : null;
    const entry = { id: 'k' + DB.uid(), date: now, amount };
    let msg = 'Am salvat suma.';
    if (prev) {
      const moved = Stats.movedToCash(state.txs, prev.date.slice(0, 10), today());
      const spent = Math.round((prev.amount + moved - amount) * 100) / 100;
      const from = dayLabel(prev.date.slice(0, 10));
      if (spent > 0) {
        entry.txId = 'c' + DB.uid();
        await DB.put('transactions', { id: entry.txId, date: today(), amount: -spent, description: `Cheltuieli cash din ${from}`, category: 'Cheltuieli cash', source: 'cash' });
        msg = `Ai cheltuit ${money(spent)} cash din ${from}.`;
      } else if (spent < 0) {
        entry.txId = 'c' + DB.uid();
        await DB.put('transactions', { id: entry.txId, date: today(), amount: -spent, description: `Bani cash primiți din ${from}`, category: 'Alte venituri', source: 'cash' });
        msg = `Ai primit ${money(-spent)} cash din ${from}.`;
      }
    }
    await DB.put('cash', entry);
    await load();
    renderAll();
    toast(msg);
  }

  function renderCash() {
    const cash = Stats.cashBalance(state.cash, state.txs);
    const due = isCashDue();
    $('cashHint').textContent = cash
      ? `Ultima dată: ${money(cash.declared)} pe ${dayLabel(cash.date.slice(0, 10))}.` +
        (cash.estimated ? ` De atunci ai retras ${money(cash.value - cash.declared)} de la bancomat.` : '') +
        ' Diferența o înregistrez ca „Cheltuieli cash”.'
      : 'Prima sumă e punctul de pornire. De data viitoare calculez cât ai cheltuit cash.';
    if (due && cash) $('cashHint').textContent += ' E timpul pentru o actualizare.';

    const list = [...state.cash].sort((a, b) => (a.date < b.date ? 1 : -1));
    $('cashList').innerHTML = list.map((c) => {
      const tx = c.txId && state.txs.find((t) => t.id === c.txId);
      return `<li data-id="${c.id}"><div class="tx-main"><div class="tx-desc">${money(c.amount)}</div>
        <div class="tx-meta">${dayLabel(c.date.slice(0, 10))}${tx ? ' · ' + esc(tx.description.split(' din ')[0].toLowerCase()) + ' ' + money(Math.abs(tx.amount)) : ''}</div></div>
        <div class="tx-amt muted">✕</div></li>`;
    }).join('') || '<li class="tx-day">Nicio înregistrare încă.</li>';
  }

  async function onCashListClick(e) {
    const li = e.target.closest('li[data-id]');
    if (!li) return;
    const c = state.cash.find((x) => x.id === li.dataset.id);
    if (!c || !(await confirmBox('Ștergi înregistrarea?', `${money(c.amount)} din ${dayLabel(c.date.slice(0, 10))}, împreună cu cheltuiala calculată din ea.`))) return;
    await DB.del('cash', c.id);
    if (c.txId) await DB.del('transactions', c.txId);
    await load();
    renderAll();
  }

  function isCashDue() {
    if (!state.cash.length) return true;
    const last = state.cash.reduce((a, b) => (b.date > a.date ? b : a));
    return (Date.now() - new Date(last.date).getTime()) / 86400000 >= state.remindDays;
  }

  function askCash() {
    const d = $('cashDialog');
    if (d.open) return;
    const cash = Stats.cashBalance(state.cash, state.txs);
    $('cashDialogHint').textContent = cash ? `Ultima dată aveai ${money(cash.declared)} (${dayLabel(cash.date.slice(0, 10))}).` : 'Numără banii din portofel și scrie suma.';
    $('cashDialogAmount').value = '';
    d.returnValue = '';
    d.showModal();
  }

  // ---------- Setări ----------
  function renderSettings() {
    $('remindDays').value = String(state.remindDays);
    $('rulesList').innerHTML = state.rules.map((r) =>
      `<li><span>„${esc(r.pattern)}” → <b>${esc(r.category)}</b></span><button data-id="${r.id}" aria-label="Șterge regula">✕</button></li>`).join('') ||
      '<li class="muted small">Nicio regulă încă.</li>';
    renderNotifStatus();
  }

  function renderNotifStatus() {
    const s = $('notifStatus');
    if (!('Notification' in window)) { s.textContent = 'Browserul acesta nu suportă notificări. Te întreb când deschizi aplicația.'; return; }
    if (Notification.permission === 'granted') {
      s.textContent = 'Notificările sunt active. Pe Android, Chrome trimite memento-ul doar dacă aplicația e instalată pe ecranul principal; frecvența o decide telefonul (cel mult o dată pe zi). Te întreb oricum și când deschizi aplicația.';
      $('notifBtn').hidden = true;
    } else if (Notification.permission === 'denied') {
      s.textContent = 'Notificările sunt blocate din setările browserului. Te întreb când deschizi aplicația.';
    } else s.textContent = 'Fără notificări, te întreb doar când deschizi aplicația.';
  }

  async function enableNotifications() {
    if (!('Notification' in window)) return renderNotifStatus();
    const perm = await Notification.requestPermission();
    if (perm === 'granted') await registerPeriodic();
    renderNotifStatus();
  }

  async function registerPeriodic() {
    try {
      const reg = await navigator.serviceWorker.ready;
      if ('periodicSync' in reg) await reg.periodicSync.register('cash-reminder', { minInterval: 12 * 60 * 60 * 1000 });
    } catch (e) { /* telefonul poate refuza; rămâne întrebarea la deschidere */ }
  }

  async function exportBackup() {
    const data = await DB.exportAll();
    const blob = new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `banii-mei-${today()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  async function restoreBackup(e) {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!(await confirmBox('Restaurezi copia?', `Datele actuale vor fi înlocuite cu cele din ${file.name}.`))) return;
      await DB.importAll(data);
      await load();
      renderAll();
      toast('Copia a fost restaurată.');
    } catch (err) {
      toast('Nu am putut restaura: ' + err.message);
    }
  }

  async function wipe() {
    if (!(await confirmBox('Ștergi toate datele?', 'Tranzacțiile, cash-ul, regulile și setările dispar definitiv de pe acest dispozitiv. Fă întâi o copie de rezervă dacă vrei să le păstrezi.'))) return;
    await DB.wipe();
    await load();
    renderAll();
    toast('Toate datele au fost șterse.');
  }

  // ---------- Pornire ----------
  function bind() {
    window.addEventListener('hashchange', route);
    $('monthSelect').onchange = (e) => { state.month = e.target.value; renderDashboard(); };
    ['txSearch', 'txCategory', 'txMonth'].forEach((id) => $(id).addEventListener('input', renderTransactions));
    $('txList').onclick = (e) => {
      const li = e.target.closest('li[data-id]');
      if (li) openTx(state.txs.find((t) => t.id === li.dataset.id));
    };
    $('addTxBtn').onclick = () => openTx(null);
    $('txDialog').addEventListener('close', onTxDialogClose);

    $('fileInput').onchange = onFile;
    $('doImportBtn').onclick = doImport;
    $('cancelImportBtn').onclick = () => { state.pending = null; $('mappingCard').hidden = true; };

    $('cashForm').onsubmit = async (e) => {
      e.preventDefault();
      await saveCash(Number($('cashAmount').value));
      $('cashAmount').value = '';
    };
    $('cashList').onclick = onCashListClick;
    $('cashDialog').addEventListener('close', () => {
      const v = $('cashDialogAmount').value;
      if ($('cashDialog').returnValue === 'save' && v !== '') saveCash(Number(v));
    });

    $('remindDays').onchange = async (e) => {
      state.remindDays = Number(e.target.value);
      await DB.setSetting('remindDays', state.remindDays);
      renderCash();
      toast('Salvat.');
    };
    $('notifBtn').onclick = enableNotifications;
    $('rulesList').onclick = async (e) => {
      const id = e.target.dataset && e.target.dataset.id;
      if (!id) return;
      await DB.del('rules', id);
      await load();
      renderSettings();
    };
    $('depositForm').onsubmit = saveDeposit;
    $('depCancel').onclick = resetDepositForm;
    $('depDelete').onclick = deleteDeposit;
    $('depositSuggest').onclick = onDepositListClick;
    $('depositList').onclick = onDepositListClick;
    $('exportBtn').onclick = exportBackup;
    $('restoreInput').onchange = restoreBackup;
    $('wipeBtn').onclick = wipe;
  }

  async function start() {
    bind();
    await load();
    renderAll();
    route();
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('sw.js').then(() => {
        if (window.Notification && Notification.permission === 'granted') registerPeriodic();
      }).catch(() => {});
    }
    if (isCashDue() && location.hash !== '#import') setTimeout(askCash, 600);
  }

  start();
})();
