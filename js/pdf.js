// Citirea extraselor maib în PDF. Textul se extrage local cu pdf.js; rândurile se
// reconstruiesc după poziția pe pagină.
const PdfStatement = (() => {
  let loading;
  function loadLib() {
    if (window.pdfjsLib) return Promise.resolve();
    if (!loading) {
      loading = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = 'vendor/pdf.min.js';
        s.onload = () => { pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js'; resolve(); };
        s.onerror = () => reject(new Error('Nu am putut încărca cititorul de PDF.'));
        document.head.appendChild(s);
      });
    }
    return loading;
  }

  const DATE = /^\d{4}-\d{2}-\d{2}$/;
  const NUM = /^-?\d{1,3}( \d{3})*\.\d{2}$/;
  const num = (s) => parseFloat(s.replace(/ /g, ''));

  // Grupează bucățile de text în rânduri (aceeași înălțime pe pagină, cu toleranță).
  function toLines(items) {
    const sorted = items.filter((i) => i.str.trim())
      .map((i) => ({ x: i.transform[4], y: i.transform[5], s: i.str.trim() }))
      .sort((a, b) => b.y - a.y || a.x - b.x);
    const lines = [];
    for (const it of sorted) {
      const line = lines.find((l) => Math.abs(l.y - it.y) <= 2.5);
      if (line) line.items.push(it); else lines.push({ y: it.y, items: [it] });
    }
    for (const l of lines) l.items.sort((a, b) => a.x - b.x);
    return lines.sort((a, b) => b.y - a.y);
  }

  // Curăță rândurile de continuare: fără numere de card/cont, ID-uri sau cifre izolate.
  function cleanExtra(text) {
    return text
      .replace(/\d{6}\*+\d{4}/g, '')
      .replace(/\b(pe )?contul \d{8,}\b/gi, '')
      .replace(/\btxn \d+|\bID\b/gi, '')
      .replace(/^\d+$/, '')
      .trim();
  }

  async function parse(buf) {
    await loadLib();
    const doc = await pdfjsLib.getDocument({ data: new Uint8Array(buf) }).promise;
    const meta = { account: null, period: null, balance: null, generated: null };
    const txs = [];
    let cols = null; // pozițiile coloanelor, din antetul tabelului
    let current = null;

    for (let p = 1; p <= doc.numPages; p++) {
      const lines = toLines((await (await doc.getPage(p)).getTextContent()).items);
      current = null; // antetul paginii noi nu e continuarea ultimei tranzacții
      for (const line of lines) {
        const strs = line.items.map((i) => i.s);
        const text = strs.join(' ');

        // Antetul extrasului
        let m;
        if ((m = text.match(/Număr cont:\s*(\d+)/))) meta.account = m[1];
        if ((m = text.match(/(\d{2}\.\d{2}\.\d{4}) - (\d{2}\.\d{2}\.\d{4})/))) meta.period = [m[1], m[2]];
        if ((m = text.match(/generat la (\d{2})\.(\d{2})\.(\d{4})/))) meta.generated = `${m[3]}-${m[2]}-${m[1]}`;
        if ((m = text.match(/Sold final:\s*(-?[\d ]+\.\d{2})/))) meta.balance = num(m[1]);

        // Antetul tabelului: de aici aflăm unde încep coloanele.
        const xOf = (word) => line.items.find((i) => i.s.toLowerCase() === word)?.x;
        if (xOf('ieșiri') !== undefined && xOf('comision') !== undefined) {
          cols = { out: xOf('ieșiri'), in: xOf('intrări'), fee: xOf('comision') };
          continue;
        }
        if (line.items.some((i) => i.s.startsWith('sold după'))) { cols && (cols.bal = line.items.find((i) => i.s.startsWith('sold după')).x); }

        const first = line.items[0];
        if (DATE.test(first.s) && first.x < 80 && cols) {
          // Rând nou de tranzacție: data, data procesării, descriere, sume.
          const nums = line.items.filter((i) => NUM.test(i.s));
          const descParts = line.items.filter((i) => !NUM.test(i.s) && !DATE.test(i.s) && i.x < (nums[0]?.x ?? Infinity));
          const currency = line.items.find((i) => /^[A-Z]{3}$/.test(i.s) && nums[0] && i.x > nums[0].x)?.s;
          const balX = cols.bal ?? cols.fee + 40;
          let out = 0, inn = 0, fee = 0, bal = null;
          for (const n of nums.slice(1)) {
            const v = Math.abs(num(n.s));
            if (n.x >= balX - 12) bal = num(n.s);
            else if (n.x >= cols.fee) fee += v;
            else if (n.x >= cols.in) inn += v;
            else if (n.x >= cols.out - 25) out += v;
          }
          current = {
            date: first.s,
            description: descParts.map((i) => i.s).join(' ').trim(),
            amount: Math.round((inn - out - fee) * 100) / 100,
            extra: [],
            balance: bal
          };
          if (currency && currency !== 'MDL' && nums[0]) current.original = `${Math.abs(num(nums[0].s))} ${currency}`;
          txs.push(current);
        } else if (current && first.x > 120 && first.x < 250 && line.items.length === 1) {
          const extra = cleanExtra(first.s);
          if (extra) current.extra.push(extra);
        } else if (/^#(Cont|Card)/.test(first.s) || /din$/.test(text) || /Sfârșitul/.test(text)) {
          current = null;
        }
      }
    }

    if (!meta.account) throw new Error('Nu pare a fi un extras maib (nu am găsit numărul contului).');
    return { meta, txs };
  }

  function hash(str) {
    let h = 5381;
    for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36);
  }

  // Transformă rezultatul în tranzacții pentru aplicație.
  async function read(buf, rules) {
    const { meta, txs } = await parse(buf);
    const seen = {};
    const out = [];
    for (const t of txs) {
      if (!t.amount) continue;
      const description = [t.description, ...t.extra].join(' ').replace(/\s+/g, ' ').trim() || '(fără descriere)';
      const key = `${meta.account}|${t.date}|${t.amount}|${Categories.norm(description)}`;
      seen[key] = (seen[key] || 0) + 1;
      const tx = {
        id: 'p' + hash(key + '|' + seen[key]),
        date: t.date, amount: t.amount, description,
        category: Categories.categorize(description, t.amount, rules),
        source: 'maib', account: meta.account
      };
      if (t.original) tx.original = t.original;
      out.push(tx);
    }
    return { meta, transactions: out };
  }

  return { read };
})();
