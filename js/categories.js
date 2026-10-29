// Categorii și reguli automate de clasificare a tranzacțiilor.
const Categories = (() => {
  const LIST = [
    'Alimente', 'Restaurante și cafenele', 'Livrare mâncare', 'Transport', 'Combustibil', 'Taxi',
    'Utilități', 'Telefon și internet', 'Abonamente', 'Sănătate', 'Cumpărături', 'Haine',
    'Casă', 'Divertisment', 'Educație', 'Călătorii', 'Transferuri', 'Comisioane bancare',
    'Cheltuieli cash', 'Retragere numerar', 'Depunere numerar', 'Salariu', 'Alte venituri', 'Altele'
  ];

  // Mutări între card și cash: nu sunt cheltuieli și nici venituri.
  const MOVES = new Set(['Retragere numerar', 'Depunere numerar']);
  const INCOME = new Set(['Salariu', 'Alte venituri']);

  // Cuvinte cheie (fără diacritice, litere mici). Primul care se potrivește câștigă.
  const BUILTIN = [
    ['Retragere numerar', ['atm', 'bancomat', 'cash withdrawal', 'retragere numerar', 'eliberare numerar', 'снятие налич', 'выдача налич']],
    ['Depunere numerar', ['depunere numerar', 'cash deposit', 'cash-in', 'взнос налич']],
    ['Comisioane bancare', ['comision', 'commission', 'fee ', 'комисси', 'abonament card', 'deservire']],
    ['Salariu', ['salariu', 'salary', 'зарплат', 'заработн']],
    ['Livrare mâncare', ['glovo', 'straus', 'yandex eats', 'wolt', 'foodhouse', 'delivery']],
    ['Taxi', ['yandex go', 'yandex.go', 'yango', 'bolt', 'uber', 'itaxi', 'taxi', 'такси']],
    ['Combustibil', ['petrom', 'lukoil', 'rompetrol', 'bemol', 'tirex', 'avante', 'vento', 'datario', 'benzin', 'fuel', 'азс']],
    ['Transport', ['rtec', 'urban bus', 'transport', 'parking', 'parcare', 'cfm', 'autogara', 'mpay']],
    ['Alimente', ['linella', 'nr1', 'nr.1', 'fidesco', 'kaufland', 'metro cash', 'green hills', 'velmart', 'merci', 'ulybka', 'supermarket', 'minimarket', 'magazin alimentar', 'fourchette']],
    ['Restaurante și cafenele', ['andys', "andy's", 'la placinte', 'mcdonald', 'kfc', 'cafe', 'coffee', 'tucano', 'restaurant', 'pizza', 'burger', 'starbucks', 'oliva', 'robins']],
    ['Telefon și internet', ['orange', 'moldcell', 'moldtelecom', 'starnet', 'arax']],
    ['Utilități', ['premier energy', 'energocom', 'moldovagaz', 'termoelectrica', 'apa-canal', 'apa canal', 'red nord', 'gas natural', 'chirie', 'intretinere']],
    ['Abonamente', ['netflix', 'spotify', 'youtube', 'apple.com', 'icloud', 'google play', 'google one', 'microsoft', 'adobe', 'chatgpt', 'openai', 'anthropic', 'claude', 'playstation', 'steam', 'xbox', 'megogo', 'voyo', 'patreon']],
    ['Sănătate', ['farmacia', 'farmacie', 'felicia', 'hippocrates', 'medpark', 'sancos', 'clinica', 'stomatolog', 'аптек', 'pharma', 'medical']],
    ['Haine', ['zara', 'h&m', 'lc waikiki', 'koton', 'reserved', 'sinsay', 'defacto', 'deichmann', 'sportmaster', 'nike', 'adidas']],
    ['Cumpărături', ['emag', 'darwin', 'enter.md', 'maximum', 'bomba', 'aliexpress', 'temu', 'amazon', 'ozon', 'wildberries', 'jysk']],
    ['Casă', ['ikea', 'mobilier', 'supraten', 'baucenter', 'agora', 'leroy']],
    ['Divertisment', ['cinema', 'patria', 'cineplex', 'iticket', 'concert', 'teatru', 'bowling']],
    ['Educație', ['udemy', 'coursera', 'universitat', 'scoala', 'curs ', 'librarie', 'bestseller']],
    ['Călătorii', ['airbnb', 'booking', 'hotel', 'wizz', 'flyone', 'airmoldova', 'ryanair', 'hostel', 'airport']],
    ['Transferuri', ['transfer', 'p2p', 'card to card', 'перевод', 'mia ', 'plata instant']]
  ];

  function norm(s) {
    return (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
  }

  // O „cheie de comerciant” stabilă: fără cifre, numere de card, orașe sau coduri.
  function merchantKey(desc) {
    const n = norm(desc)
      .replace(/\b\d[\d*x\-./:]*\b/g, ' ')
      .replace(/[*#|_]+/g, ' ')
      .replace(/\b(md|mda|chisinau|kishinev|chisinev|balti|mol|mdl|pos|ecom|plata|payment|purchase|cumparare|achitare)\b/g, ' ')
      .replace(/\s+/g, ' ').trim();
    return n.split(' ').slice(0, 3).join(' ').replace(/^[^\p{L}\d]+|[^\p{L}\d]+$/gu, '');
  }

  function categorize(description, amount, userRules) {
    const d = norm(description);
    for (const r of userRules || []) {
      if (r.pattern && d.includes(r.pattern)) return r.category;
    }
    for (const [cat, words] of BUILTIN) {
      if (words.some((w) => d.includes(w))) {
        // Un „transfer” primit e venit, nu cheltuială.
        if (cat === 'Transferuri' && amount > 0) return 'Alte venituri';
        return cat;
      }
    }
    return amount > 0 ? 'Alte venituri' : 'Altele';
  }

  const isMove = (cat) => MOVES.has(cat);
  const isIncomeCat = (cat) => INCOME.has(cat);

  return { LIST, categorize, merchantKey, norm, isMove, isIncomeCat };
})();
