// Grafice simple în SVG/HTML, fără biblioteci.
const Charts = (() => {
  const MONTHS = ['ian', 'feb', 'mar', 'apr', 'mai', 'iun', 'iul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const money = (v) => Math.round(v).toLocaleString('ro-RO');

  // Cheltuieli pe categorii: bare orizontale, o singură culoare (mărime, nu identitate).
  function categories(el, cats, total) {
    if (!cats.length) { el.innerHTML = '<div class="empty">Nicio cheltuială în luna aleasă.</div>'; return; }
    const top = cats.slice(0, 8);
    const rest = cats.slice(8).reduce((s, c) => s + c.total, 0);
    if (rest > 0) top.push({ name: 'Restul categoriilor', total: rest });
    const max = Math.max(...top.map((c) => c.total));
    el.innerHTML = top.map((c) => {
      const pct = total ? Math.round((c.total / total) * 100) : 0;
      return `<div class="cat-row" title="${esc(c.name)}: ${money(c.total)} MDL (${pct}%)">
        <div class="cat-name">${esc(c.name)}</div>
        <div class="cat-track"><div class="cat-fill" style="width:${Math.max(2, (c.total / max) * 100)}%"></div></div>
        <div class="cat-val">${money(c.total)} · ${pct}%</div>
      </div>`;
    }).join('');
  }

  // Venituri vs. cheltuieli pe luni: bare grupate, cu tooltip la atingere.
  function months(el, data) {
    if (!data.some((d) => d.income || d.expense)) { el.innerHTML = '<div class="empty">Încă nu sunt date pe ultimele luni.</div>'; return; }
    // Lățimea reală a containerului, ca textul să rămână lizibil și pe telefon.
    const W = Math.max(300, el.clientWidth || 640), H = 220, L = 40, R = 4, T = 10, B = 26;
    const max = Math.max(...data.map((d) => Math.max(d.income, d.expense))) || 1;
    const step = Math.pow(10, Math.floor(Math.log10(max)));
    const nice = [1, 2, 2.5, 5, 10].map((k) => k * step).find((s) => max / s <= 5) || step * 10;
    const top = Math.ceil(max / nice) * nice;
    const y = (v) => T + (H - T - B) * (1 - v / top);
    const gw = (W - L - R) / data.length;
    const bw = Math.min(26, gw * 0.32);

    let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Venituri și cheltuieli pe luni">`;
    for (let v = 0; v <= top + 0.001; v += nice) {
      svg += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="var(--grid)" stroke-width="1"/>`;
      svg += `<text x="${L - 6}" y="${y(v) + 4}" text-anchor="end" font-size="11" fill="var(--muted)">${v >= 1000 ? Math.round(v / 1000) + 'k' : v}</text>`;
    }
    const bar = (x, v, color) => {
      if (v <= 0) return '';
      const h = Math.max(1, y(0) - y(v));
      const r = Math.min(4, h, bw / 2);
      // Colțuri rotunjite doar sus, ancorat pe linia de bază.
      return `<path d="M${x},${y(0)} V${y(v) + r} Q${x},${y(v)} ${x + r},${y(v)} H${x + bw - r} Q${x + bw},${y(v)} ${x + bw},${y(v) + r} V${y(0)} Z" fill="${color}"/>`;
    };
    data.forEach((d, i) => {
      const cx = L + gw * i + gw / 2;
      svg += `<g class="grp" data-i="${i}">`;
      svg += `<rect x="${L + gw * i}" y="${T}" width="${gw}" height="${H - T - B}" fill="transparent"/>`;
      svg += bar(cx - bw - 1, d.income, 'var(--series-income)');
      svg += bar(cx + 1, d.expense, 'var(--series-expense)');
      const [yy, mm] = d.month.split('-');
      svg += `<text x="${cx}" y="${H - 8}" text-anchor="middle" font-size="11" fill="var(--muted)">${MONTHS[Number(mm) - 1]}${mm === '01' ? ' ' + yy.slice(2) : ''}</text>`;
      svg += '</g>';
    });
    svg += `<line x1="${L}" x2="${W - R}" y1="${y(0)}" y2="${y(0)}" stroke="var(--axis)" stroke-width="1"/></svg>`;
    el.innerHTML = svg + '<div class="chart-tip" hidden></div>';

    const tip = el.querySelector('.chart-tip');
    const show = (g) => {
      const d = data[Number(g.dataset.i)];
      const [yy, mm] = d.month.split('-');
      tip.innerHTML = `<b>${MONTHS[Number(mm) - 1]} ${yy}</b><br>Venituri: ${money(d.income)} MDL<br>Cheltuieli: ${money(d.expense)} MDL<br>Diferență: ${money(d.income - d.expense)} MDL`;
      const box = g.getBoundingClientRect(), host = el.getBoundingClientRect();
      tip.style.left = Math.min(Math.max(box.left - host.left + box.width / 2, 80), host.width - 80) + 'px';
      tip.style.top = '100px';
      tip.hidden = false;
    };
    el.querySelectorAll('.grp').forEach((g) => {
      g.addEventListener('mouseenter', () => show(g));
      g.addEventListener('click', () => show(g));
      g.addEventListener('mouseleave', () => { tip.hidden = true; });
    });
  }

  return { categories, months };
})();
