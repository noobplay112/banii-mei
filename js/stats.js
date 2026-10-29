// Calcule: totaluri, categorii, solduri, cash și sugestii de optimizare.
const Stats = (() => {
  const monthOf = (date) => date.slice(0, 7);
  const isExpense = (t) => t.amount < 0 && !Categories.isMove(t.category);
  const isIncome = (t) => t.amount > 0 && !Categories.isMove(t.category);

  function shiftMonth(month, delta) {
    const [y, m] = month.split('-').map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }

  function monthList(txs) {
    const set = new Set(txs.map((t) => monthOf(t.date)));
    set.add(new Date().toISOString().slice(0, 7));
    return [...set].sort().reverse();
  }

  function summary(txs, month) {
    const inMonth = txs.filter((t) => monthOf(t.date) === month);
    const income = inMonth.filter(isIncome).reduce((s, t) => s + t.amount, 0);
    const expenses = inMonth.filter(isExpense);
    const expense = -expenses.reduce((s, t) => s + t.amount, 0) || 0;
    const byCat = {};
    for (const t of expenses) byCat[t.category] = (byCat[t.category] || 0) - t.amount;
    const byMerchant = {};
    for (const t of expenses) {
      const k = t.source === 'cash' ? 'cheltuieli cash' : Categories.merchantKey(t.description) || '(necunoscut)';
      byMerchant[k] = byMerchant[k] || { name: t.source === 'cash' ? 'Cheltuieli cash' : t.description, total: 0, count: 0 };
      byMerchant[k].total -= t.amount;
      byMerchant[k].count++;
    }
    return {
      income, expense,
      categories: Object.entries(byCat).map(([name, total]) => ({ name, total })).sort((a, b) => b.total - a.total),
      merchants: Object.values(byMerchant).sort((a, b) => b.total - a.total)
    };
  }

  function lastMonths(txs, endMonth, count) {
    const out = [];
    for (let i = count - 1; i >= 0; i--) {
      const m = shiftMonth(endMonth, -i);
      const s = summary(txs, m);
      out.push({ month: m, income: s.income, expense: s.expense });
    }
    return out;
  }

  // Soldul de pe card: suma soldurilor finale din extrasele PDF (câte unul pe cont),
  // altfel ultima valoare din coloana „Sold” a unui extras CSV/Excel.
  function cardBalance(txs, balances) {
    const accounts = Object.values(balances || {});
    if (accounts.length) {
      return {
        value: accounts.reduce((s, a) => s + a.value, 0),
        date: accounts.map((a) => a.date).sort()[0],
        accounts: accounts.length
      };
    }
    const withBal = txs.filter((t) => t.source === 'maib' && typeof t.balance === 'number');
    if (!withBal.length) return null;
    const last = withBal.reduce((a, b) => (b.date >= a.date ? b : a));
    return { value: last.balance, date: last.date, accounts: 1 };
  }

  // Cash estimat acum: ultima sumă declarată + retrageri de la bancomat după ea − depuneri.
  function cashBalance(cash, txs) {
    if (!cash.length) return null;
    const last = cash.reduce((a, b) => (b.date > a.date ? b : a));
    const since = last.date.slice(0, 10);
    const moved = movedToCash(txs, since, '9999-12-31');
    return { value: last.amount + moved, declared: last.amount, date: last.date, estimated: moved !== 0 };
  }

  // Câți bani au trecut din card în cash între două date (retrageri − depuneri).
  function movedToCash(txs, from, to) {
    let sum = 0;
    for (const t of txs) {
      if (t.date <= from || t.date > to) continue;
      if (t.category === 'Retragere numerar') sum += Math.abs(t.amount);
      if (t.category === 'Depunere numerar') sum -= Math.abs(t.amount);
    }
    return sum;
  }

  // Găsește transferurile dintre conturile proprii: o ieșire dintr-un cont și o intrare
  // cu aceeași sumă în alt cont, în cel mult o zi. Le marchează ca mutări, nu cheltuieli.
  function linkOwnTransfers(txs) {
    const candidates = new Set(['Transferuri', 'Alte venituri', 'Altele']);
    const pool = txs.filter((t) => t.account && candidates.has(t.category));
    const ins = pool.filter((t) => t.amount > 0);
    const used = new Set();
    const changed = [];
    const days = (a, b) => Math.abs(new Date(a) - new Date(b)) / 86400000;
    for (const out of pool.filter((t) => t.amount < 0).sort((a, b) => (a.date < b.date ? -1 : 1))) {
      const match = ins.find((t) => !used.has(t.id) && t.account !== out.account &&
        Math.abs(t.amount + out.amount) < 0.005 && days(t.date, out.date) <= 1);
      if (!match) continue;
      used.add(match.id);
      for (const t of [out, match]) { t.category = 'Între conturile mele'; changed.push(t); }
    }
    return changed;
  }

  const fmt = (v) => Math.round(v).toLocaleString('ro-RO') + ' MDL';

  function insights(txs, month) {
    const out = [];
    const cur = summary(txs, month);
    const prev = [1, 2, 3].map((i) => summary(txs, shiftMonth(month, -i)));
    const prevWithData = prev.filter((p) => p.expense > 0);
    const isCurrent = month === new Date().toISOString().slice(0, 7);
    const sofar = isCurrent ? ' (până acum)' : '';

    if (cur.income > 0) {
      const rate = (cur.income - cur.expense) / cur.income;
      if (rate < 0) out.push({ warn: true, html: `Luna aceasta ai cheltuit cu <b>${fmt(cur.expense - cur.income)}</b> mai mult decât ai câștigat${sofar}.` });
      else out.push({ html: `Ai economisit <b>${Math.round(rate * 100)}%</b> din venituri${sofar}. O țintă bună e 10–20%.` });
    }

    // Categorii care au crescut față de media ultimelor luni.
    if (prevWithData.length) {
      const grown = [];
      for (const c of cur.categories) {
        const avg = prevWithData.reduce((s, p) => s + (p.categories.find((x) => x.name === c.name)?.total || 0), 0) / prevWithData.length;
        if (avg > 0 && c.total > avg * 1.25 && c.total - avg > 200) grown.push({ ...c, avg, extra: c.total - avg });
      }
      // Doar cele mai mari 3 creșteri, ca să nu fie prea mult zgomot.
      for (const c of grown.sort((a, b) => b.extra - a.extra).slice(0, 3)) {
        out.push({ warn: true, html: `La <b>${c.name}</b> ai cheltuit ${fmt(c.total)}${sofar}, cu <b>${Math.round((c.total / c.avg - 1) * 100)}%</b> peste media ta (${fmt(c.avg)}).` });
      }
    }

    // Plăți mici, dar dese.
    for (const name of ['Restaurante și cafenele', 'Livrare mâncare', 'Taxi']) {
      const list = txs.filter((t) => monthOf(t.date) === month && isExpense(t) && t.category === name);
      if (list.length >= 6) {
        const total = -list.reduce((s, t) => s + t.amount, 0);
        out.push({ html: `<b>${list.length}</b> plăți la ${name.toLowerCase()}, în total ${fmt(total)}. Dacă le reduci la jumătate, economisești ~<b>${fmt(total / 2)}</b> pe lună.` });
      }
    }

    // Plăți recurente (abonamente): același comerciant, sumă asemănătoare, în cel puțin 2 din ultimele 3 luni.
    const recent = [0, 1, 2].map((i) => shiftMonth(month, -i));
    const groups = {};
    for (const t of txs) {
      if (!isExpense(t) || t.source === 'cash' || t.category === 'Comisioane bancare' || !recent.includes(monthOf(t.date))) continue;
      const k = Categories.merchantKey(t.description);
      if (!k) continue;
      (groups[k] = groups[k] || []).push(t);
    }
    const recurring = [];
    for (const list of Object.values(groups)) {
      const months = new Set(list.map((t) => monthOf(t.date)));
      if (months.size < 2) continue;
      const amounts = list.map((t) => -t.amount);
      const avg = amounts.reduce((a, b) => a + b, 0) / amounts.length;
      if (amounts.every((a) => Math.abs(a - avg) <= avg * 0.15) && list.length <= months.size + 1) {
        recurring.push({ name: list[0].description, avg });
      }
    }
    if (recurring.length) {
      recurring.sort((a, b) => b.avg - a.avg);
      const total = recurring.reduce((s, r) => s + r.avg, 0);
      const names = recurring.slice(0, 5).map((r) => `${r.name} (~${fmt(r.avg)})`).join(', ');
      out.push({ html: `Ai <b>${recurring.length}</b> plăți care se repetă lunar, ~<b>${fmt(total)}</b>/lună: ${names}. Verifică dacă le folosești pe toate.` });
    }

    const fees = cur.categories.find((c) => c.name === 'Comisioane bancare');
    if (fees && fees.total >= 1) out.push({ html: `Ai plătit <b>${fmt(fees.total)}</b> comisioane bancare. Retragerile de la bancomatele altor bănci și conversiile valutare costă de obicei cel mai mult.` });

    const other = cur.categories.find((c) => c.name === 'Altele');
    if (other && cur.expense > 0 && other.total / cur.expense > 0.2) {
      out.push({ html: `<b>${Math.round((other.total / cur.expense) * 100)}%</b> din cheltuieli sunt la „Altele”. Pune-le categoria corectă în Tranzacții și statistica devine mult mai utilă.` });
    }

    const cashSpent = cur.categories.find((c) => c.name === 'Cheltuieli cash');
    if (cashSpent && cur.expense > 0 && cashSpent.total / cur.expense > 0.25) {
      out.push({ html: `<b>${Math.round((cashSpent.total / cur.expense) * 100)}%</b> din cheltuieli sunt cash, fără detalii. Cu cardul ai vedea exact pe ce se duc banii.` });
    }

    if (!out.length) out.push({ html: 'Importă cel puțin 2–3 luni de extrase ca să pot compara și să găsesc unde poți economisi.' });
    return out;
  }

  return { monthOf, shiftMonth, monthList, summary, lastMonths, cardBalance, cashBalance, movedToCash, linkOwnTransfers, insights, fmt, isExpense, isIncome };
})();
