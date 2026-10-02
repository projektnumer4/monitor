export const MAX_CHARS = 400000;

export const normalizeText = (t) =>
  String(t).replace(/\r\n?/g, '\n').replace(/\u00a0/g, ' ').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();

/** Wczytuje dokument szkoły z pliku .docx, .txt lub .md i zwraca czysty tekst. */
export async function readDocumentFile(file, { loadMammoth }) {
  const name = String(file.name ?? '').toLowerCase();
  let text;
  if (/\.(txt|md)$/.test(name)) text = await file.text();
  else if (name.endsWith('.docx')) {
    const mammoth = await loadMammoth();
    text = (await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() })).value;
  } else throw new Error('Obsługiwane formaty: .docx, .txt, .md. Plik PDF najpierw zapisz jako Word lub wklej jego tekst.');
  const out = normalizeText(text);
  if (!out) throw new Error('Plik nie zawiera tekstu');
  if (out.length > MAX_CHARS) throw new Error(`Dokument jest za długi (${out.length} znaków, limit ${MAX_CHARS})`);
  return out;
}

/** Ładowanie zewnętrznych bibliotek dopiero wtedy, gdy są potrzebne. */
export const loaders = {
  async mammoth() {
    if (!globalThis.window.mammoth) {
      await new Promise((resolve, reject) => {
        const s = globalThis.document.createElement('script');
        s.src = 'https://cdn.jsdelivr.net/npm/mammoth@1.8.0/mammoth.browser.min.js';
        s.onload = resolve;
        s.onerror = () => reject(new Error('Nie udało się wczytać biblioteki do odczytu plików Word'));
        globalThis.document.head.appendChild(s);
      });
    }
    return globalThis.window.mammoth;
  },
  async docx() {
    return import('https://cdn.jsdelivr.net/npm/docx@8.5.0/+esm');
  },
};

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = globalThis.document.createElement('a');
  a.href = url;
  a.download = filename;
  globalThis.document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
