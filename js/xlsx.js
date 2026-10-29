// Cititor minimal de .xlsx, fără biblioteci externe: dezarhivează ZIP-ul cu
// DecompressionStream și citește prima foaie ca tabel de valori.
const XLSX = (() => {
  async function inflate(bytes) {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  async function unzip(buf) {
    const v = new DataView(buf);
    const u8 = new Uint8Array(buf);
    let eocd = -1;
    for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 65557); i--) {
      if (v.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('Fișierul Excel pare deteriorat.');
    const count = v.getUint16(eocd + 10, true);
    let p = v.getUint32(eocd + 16, true);
    const files = {};
    const dec = new TextDecoder();
    for (let n = 0; n < count; n++) {
      if (v.getUint32(p, true) !== 0x02014b50) break;
      const method = v.getUint16(p + 10, true);
      const size = v.getUint32(p + 20, true);
      const nameLen = v.getUint16(p + 28, true);
      const extraLen = v.getUint16(p + 30, true);
      const commentLen = v.getUint16(p + 32, true);
      const local = v.getUint32(p + 42, true);
      const name = dec.decode(u8.subarray(p + 46, p + 46 + nameLen));
      const start = local + 30 + v.getUint16(local + 26, true) + v.getUint16(local + 28, true);
      files[name] = { method, data: u8.subarray(start, start + size) };
      p += 46 + nameLen + extraLen + commentLen;
    }
    return {
      names: Object.keys(files),
      async text(name) {
        const f = files[name];
        if (!f) return null;
        const raw = f.method === 8 ? await inflate(f.data) : f.data;
        return dec.decode(raw);
      }
    };
  }

  const tags = (node, name) => Array.from(node.getElementsByTagNameNS('*', name));

  function colIndex(ref) {
    const letters = (ref || '').replace(/[^A-Z]/g, '');
    let n = 0;
    for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
    return n - 1;
  }

  async function read(buf) {
    const zip = await unzip(buf);
    const parser = new DOMParser();

    const shared = [];
    const ssText = await zip.text('xl/sharedStrings.xml');
    if (ssText) {
      const doc = parser.parseFromString(ssText, 'application/xml');
      for (const si of tags(doc, 'si')) shared.push(tags(si, 't').map((t) => t.textContent).join(''));
    }

    const sheetName = zip.names.includes('xl/worksheets/sheet1.xml')
      ? 'xl/worksheets/sheet1.xml'
      : zip.names.filter((n) => /^xl\/worksheets\/[^/]+\.xml$/.test(n)).sort()[0];
    if (!sheetName) throw new Error('Nu am găsit nicio foaie în fișierul Excel.');
    const doc = parser.parseFromString(await zip.text(sheetName), 'application/xml');

    const rows = [];
    for (const row of tags(doc, 'row')) {
      const out = [];
      let auto = 0;
      for (const c of tags(row, 'c')) {
        const ref = c.getAttribute('r');
        const idx = ref ? colIndex(ref) : auto;
        auto = idx + 1;
        const type = c.getAttribute('t');
        const vNode = tags(c, 'v')[0];
        let val = '';
        if (type === 's') val = shared[Number(vNode ? vNode.textContent : -1)] ?? '';
        else if (type === 'inlineStr') val = tags(c, 't').map((t) => t.textContent).join('');
        else if (vNode) val = type === 'str' || type === 'b' ? vNode.textContent : Number(vNode.textContent);
        out[idx] = val;
      }
      for (let i = 0; i < out.length; i++) if (out[i] === undefined) out[i] = '';
      rows.push(out);
    }
    return rows;
  }

  return { read };
})();
