// Import de extrase (CSV / Excel): citire, recunoașterea coloanelor, conversie în tranzacții.
const Importer = (() => {
  // Cuvinte din antetele de coloană, în română, rusă și engleză.
  const HINTS = {
    date: ['data tranzac', 'data operat', 'data', 'дата', 'date'],
    description: ['descriere', 'detalii', 'destinatia', 'beneficiar', 'comerciant', 'operatiune', 'описание', 'детали', 'назначение', 'description', 'details', 'merchant'],
    amount: ['suma in valuta contului', 'suma contului', 'suma', 'сумма', 'amount'],
    debit: ['debit', 'iesire', 'cheltuieli', 'расход', 'списан'],
    credit: ['credit', 'intrare', 'incasari', 'приход', 'зачислен'],
    balance: ['sold', 'остаток', 'balance'],
    currency: ['valuta', 'валюта', 'currency']
  };
  const FIELDS = [
    ['date', 'Data *'], ['description', 'Descriere *'], ['amount', 'Suma (cu semn)'],
    ['debit', 'Debit / ieșire'], ['credit', 'Credit / intrare'], ['balance', 'Sold (opțional)'],
    ['currency', 'Valuta (opțional)']
  ];

  async function readFile(file) {
    const buf = await file.arrayBuffer();
    const head = new Uint8Array(buf, 0, Math.min(4, buf.byteLength));
    if (head[0] === 0x50 && head[1] === 0x4b) return XLSX.read(buf); // „PK” = arhivă ZIP = .xlsx
    if (/\.xls$/i.test(file.name)) throw new Error('Formatul vechi .xls nu e suportat. Salvează extrasul ca .xlsx sau CSV.');
    if (/\.pdf$/i.test(file.name) || (head[0] === 0x25 && head[1] === 0x50)) throw new Error('Extrasele PDF nu sunt suportate încă. Exportă ca Excel sau CSV.');
    let text = new TextDecoder('utf-8').decode(buf);
    if (text.includes('�')) text = new TextDecoder('windows-1251').decode(buf); // CSV-uri vechi cu chirilice
    return parseCSV(text.replace(/^﻿/, ''));
  }

  function parseCSV(text) {
    const sample = text.split(/\r?\n/).slice(0, 20).join('\n');
    const delim = [';', ',', '\t', '|']
      .map((d) => [d, sample.split(d).length])
      .sort((a, b) => b[1] - a[1])[0][0];
    const rows = [];
    let row = [], cell = '', quoted = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (quoted) {
        if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
        else if (ch === '"') quoted = false;
        else cell += ch;
      } else if (ch === '"') quoted = true;
      else if (ch === delim) { row.push(cell); cell = ''; }
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        row.push(cell); rows.push(row); row = []; cell = '';
      } else cell += ch;
    }
    if (cell || row.length) { row.push(cell); rows.push(row); }
    return rows.filter((r) => r.some((c) => String(c).trim() !== ''));
  }

  const n = (s) => Categories.norm(String(s ?? ''));

  function scoreHeader(row) {
    let score = 0;
    for (const words of Object.values(HINTS)) {
      if (row.some((c) => words.some((w) => n(c).includes(w)))) score++;
    }
    return score;
  }

  function findHeader(rows) {
    let best = 0, bestScore = -1;
    rows.slice(0, 40).forEach((r, i) => {
      const s = scoreHeader(r);
      if (s > bestScore) { best = i; bestScore = s; }
    });
    return best;
  }

  function guessMapping(header) {
    const map = {};
    const used = new Set();
    // Ordinea contează: „data”, „suma” și „valuta” sunt cuvinte scurte care apar și în alte antete.
    for (const field of ['debit', 'credit', 'balance', 'date', 'description', 'amount', 'currency']) {
      let found = header.findIndex((c, i) => !used.has(i) && HINTS[field].includes(n(c)));
      for (const w of HINTS[field]) {
        if (found >= 0) break;
        found = header.findIndex((c, i) => !used.has(i) && n(c).includes(w));
      }
      if (found >= 0) { map[field] = found; used.add(found); }
    }
    if (map.amount !== undefined && (map.debit !== undefined || map.credit !== undefined)) {
      // Dacă există și Debit/Credit și Suma, folosim suma (de obicei are deja semn).
      delete map.debit; delete map.credit;
    }
    return map;
  }

  function parseNumber(v) {
    if (typeof v === 'number') return v;
    let s = String(v ?? '').trim();
    if (!s) return NaN;
    let neg = false;
    if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
    s = s.replace(/[\s ']/g, '').replace(/[^\d,.\-+]/g, '');
    if (s.endsWith('-')) { neg = true; s = s.slice(0, -1); }
    if (s.startsWith('-')) { neg = !neg; s = s.slice(1); }
    s = s.replace(/^\+/, '');
    const lastComma = s.lastIndexOf(','), lastDot = s.lastIndexOf('.');
    if (lastComma >= 0 && lastDot >= 0) {
      s = lastComma > lastDot ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
    } else if (lastComma >= 0) {
      s = /,\d{1,2}$/.test(s) ? s.replace(/,(?=\d{1,2}$)/, '.').replace(/,/g, '') : s.replace(/,/g, '');
    }
    const num = parseFloat(s);
    return isNaN(num) ? NaN : neg ? -num : num;
  }

  const pad = (x) => String(x).padStart(2, '0');

  function parseDate(v) {
    if (typeof v === 'number' && v > 20000 && v < 80000) {
      const d = new Date(Math.round((v - 25569) * 86400000)); // dată în format Excel
      return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
    }
    const s = String(v ?? '').trim();
    let m = s.match(/^(\d{4})[-./](\d{1,2})[-./](\d{1,2})/);
    if (m) return `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
    m = s.match(/^(\d{1,2})[-./](\d{1,2})[-./](\d{2,4})/);
    if (m) {
      const y = m[3].length === 2 ? '20' + m[3] : m[3];
      return `${y}-${pad(m[2])}-${pad(m[1])}`;
    }
    return null;
  }

  function hash(str) {
    let h = 5381;
    for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36);
  }

  // Transformă rândurile în tranzacții. `invert` schimbă semnul (pentru extrase unde cheltuielile sunt pozitive).
  function build(rows, headerIdx, map, { invert = false, rules = [] } = {}) {
    const out = [];
    const seen = {};
    let skipped = 0;
    for (const r of rows.slice(headerIdx + 1)) {
      const date = parseDate(r[map.date]);
      const desc = String(r[map.description] ?? '').trim();
      let amount;
      if (map.amount !== undefined) amount = parseNumber(r[map.amount]);
      else {
        const debit = map.debit !== undefined ? parseNumber(r[map.debit]) : NaN;
        const credit = map.credit !== undefined ? parseNumber(r[map.credit]) : NaN;
        amount = (isNaN(credit) ? 0 : Math.abs(credit)) - (isNaN(debit) ? 0 : Math.abs(debit));
        if (isNaN(debit) && isNaN(credit)) amount = NaN;
      }
      if (!date || isNaN(amount) || amount === 0) { skipped++; continue; }
      if (invert) amount = -amount;
      amount = Math.round(amount * 100) / 100;
      const key = `${date}|${amount}|${n(desc)}`;
      seen[key] = (seen[key] || 0) + 1;
      const tx = {
        id: 'm' + hash(key + '|' + seen[key]),
        date, amount, description: desc || '(fără descriere)',
        category: Categories.categorize(desc, amount, rules),
        source: 'maib'
      };
      if (map.balance !== undefined) {
        const b = parseNumber(r[map.balance]);
        if (!isNaN(b)) tx.balance = b;
      }
      if (map.currency !== undefined && r[map.currency]) tx.currency = String(r[map.currency]).trim();
      out.push(tx);
    }
    return { transactions: out, skipped };
  }

  // Semnătura antetului: ca să ținem minte maparea pentru următorul extras de același tip.
  const signature = (header) => hash(header.map((c) => n(c)).join('|'));

  return { readFile, findHeader, guessMapping, build, FIELDS, signature, parseNumber, parseDate };
})();
