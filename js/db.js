// Stocare locală în IndexedDB. Nimic nu pleacă de pe dispozitiv.
const DB = (() => {
  const NAME = 'banii-mei';
  const STORES = {
    transactions: 'id', // { id, date:'YYYY-MM-DD', amount, description, category, source:'maib'|'cash'|'manual', balance? }
    cash: 'id',         // { id, date: ISO, amount }
    settings: 'key',    // { key, value }
    rules: 'id'         // { id, pattern, category }
  };
  let dbPromise;

  function open() {
    if (!dbPromise) {
      dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open(NAME, 1);
        req.onupgradeneeded = () => {
          const db = req.result;
          for (const [name, keyPath] of Object.entries(STORES)) {
            if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath });
          }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }
    return dbPromise;
  }

  async function run(store, mode, fn) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, mode);
      const result = fn(tx.objectStore(store));
      tx.oncomplete = () => resolve(result && 'result' in result ? result.result : result);
      tx.onerror = () => reject(tx.error);
    });
  }

  const all = (store) => run(store, 'readonly', (s) => s.getAll());
  const put = (store, value) => run(store, 'readwrite', (s) => s.put(value));
  const del = (store, key) => run(store, 'readwrite', (s) => s.delete(key));
  const clear = (store) => run(store, 'readwrite', (s) => s.clear());
  const putMany = (store, values) => run(store, 'readwrite', (s) => { values.forEach((v) => s.put(v)); });

  async function getSetting(key, fallback) {
    const row = await run('settings', 'readonly', (s) => s.get(key));
    return row ? row.value : fallback;
  }
  const setSetting = (key, value) => put('settings', { key, value });

  async function exportAll() {
    const out = { app: 'banii-mei', version: 1, exportedAt: new Date().toISOString() };
    for (const name of Object.keys(STORES)) out[name] = await all(name);
    return out;
  }

  async function importAll(data) {
    if (!data || data.app !== 'banii-mei') throw new Error('Fișierul nu este o copie Banii Mei.');
    for (const name of Object.keys(STORES)) {
      await clear(name);
      if (Array.isArray(data[name])) await putMany(name, data[name]);
    }
  }

  async function wipe() {
    for (const name of Object.keys(STORES)) await clear(name);
  }

  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

  return { all, put, del, putMany, getSetting, setSetting, exportAll, importAll, wipe, uid };
})();
