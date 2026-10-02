import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import * as docxLib from 'docx';
import { setupDom, fakeSupabase, loadDefaults, settle, type, submit, click, sampleChanges } from './helpers.js';
import { startApp } from '../js/app.js';
import { buildSegments, textAfter, resolveEdits, locateEdit, changeList, summarize } from '../js/drafts-lib.js';
import { buildDocxDocument } from '../js/docx-export.js';
import { readDocumentFile, normalizeText } from '../js/files.js';
import { sha256Hex } from '../js/util.js';

const NOW = () => new Date('2026-10-02T15:40:00Z');
const DOC = 'STATUT SOSW\n\n§ 14. 1. Szkoła organizuje zajęcia rewalidacyjne.\n2. Zajęcia rewalidacyjne organizuje się w wymiarze określonym w orzeczeniu.\n\n§ 15. Dyrektor kieruje szkołą.';
const edit = (o) => ({ id: 'e1', type: 'replace', section: '§ 14 ust. 2', before: 'w wymiarze określonym w orzeczeniu', after: 'w wymiarze ustalonym w IPET', rationale: 'Zgodnie z § 7', confidence: 'high', located: true, problem: null, decision: 'pending', ...o });
const draft = (o = {}) => ({ id: 'd1', change_key: 'DU/2026/1900', document_name: 'Statut SOSW', status: 'ready', summary: 'Zmienić § 14 ust. 2.', model: 'gemini:x', doc_hash: null, requested_at: '2026-10-02T16:00:00Z', edits: [edit({}), edit({ id: 'e2', type: 'insert_after', section: '§ 15', anchor: 'Dyrektor kieruje szkołą.', after: '\n§ 16. Nowy przepis.', before: undefined }), edit({ id: 'e3', located: false, problem: 'nie znaleziono fragmentu w dokumencie', before: 'zmyślony', after: 'x' })], ...o });

async function boot({ hash = '', docs, ...opts } = {}) {
  const env = setupDom(`https://panel.test/${hash ? `#${hash}` : ''}`);
  const meta = docs ?? [{ name: 'Statut SOSW', content: DOC, chars: DOC.length, content_hash: await sha256Hex(DOC), updated_at: '2026-10-01T10:00:00Z' }];
  const sb = fakeSupabase({ session: { x: 1 }, aal: 'aal2', factors: [{ id: 'f1', factor_type: 'totp', status: 'verified' }], documents: meta, ...opts });
  const downloads = [];
  window.HTMLAnchorElement.prototype.click = function () { downloads.push(this.download); };
  await startApp({ sb, root: env.root, defaults: await loadDefaults(), now: NOW, loaders: { mammoth: async () => ({ extractRawText: async () => ({ value: 'Tekst z Worda\r\n\r\n\r\n\r\nDrugi akapit' }) }), docx: async () => docxLib } });
  await settle();
  return { ...env, sb, downloads };
}

/* ---- logika czysta ---- */
test('lib: zmiany są odnajdywane w aktualnym tekście, a niejednoznaczne lub zmyślone ignorowane', () => {
  assert.deepEqual(locateEdit(DOC, edit({})), { start: DOC.indexOf('w wymiarze określonym'), end: DOC.indexOf('w wymiarze określonym') + 'w wymiarze określonym w orzeczeniu'.length });
  assert.equal(locateEdit(DOC, edit({ before: 'rewalidacyjne' })), null, 'występuje dwa razy');
  assert.equal(locateEdit(DOC, edit({ before: 'zmyślone' })), null);
  const r = locateEdit(DOC, edit({ type: 'insert_after', anchor: 'Dyrektor kieruje szkołą.' }));
  assert.equal(r.start, r.end);
  assert.equal(r.end, DOC.length);
});

test('lib: segmenty i tekst po zmianach uwzględniają tylko przyjęte propozycje', () => {
  const edits = [edit({ decision: 'accepted' }), edit({ id: 'e2', type: 'insert_after', anchor: 'Dyrektor kieruje szkołą.', after: '\n§ 16. Nowy przepis.', decision: 'accepted' }), edit({ id: 'e3', before: 'Szkoła organizuje', after: 'Placówka organizuje', decision: 'rejected' }), edit({ id: 'e4', before: 'STATUT', after: 'X', decision: 'pending' })];
  const after = textAfter(DOC, edits);
  assert.match(after, /w wymiarze ustalonym w IPET/);
  assert.match(after, /§ 16\. Nowy przepis\.$/);
  assert.match(after, /Szkoła organizuje/, 'odrzucona zmiana nie wchodzi');
  assert.match(after, /^STATUT/, 'oczekująca zmiana nie wchodzi');
  const segs = buildSegments(DOC, edits);
  assert.deepEqual(segs.filter((s) => s.t === 'del').map((s) => s.s), ['w wymiarze określonym w orzeczeniu']);
  assert.equal(segs.map((s) => s.s).filter((_, i) => segs[i].t !== 'ins').join(''), DOC, 'tekst bez wstawek odtwarza oryginał');
});

test('lib: nakładające się zmiany nie są stosowane obie, a lista zmian i podsumowanie liczą poprawnie', () => {
  const a = edit({ decision: 'accepted' });
  const b = edit({ id: 'x', before: 'ustalonym', after: 'y', decision: 'accepted', located: true });
  assert.equal(resolveEdits('abc w wymiarze określonym w orzeczeniu', [a, b]).length, 1);
  const d = draft({ edits: draft().edits.map((e, i) => (i === 0 ? { ...e, decision: 'accepted' } : e)) });
  assert.deepEqual(summarize(d), { total: 3, located: 2, accepted: 1, rejected: 0, pending: 1, unlocated: 1 });
  assert.match(changeList(d.edits), /ZAMIEŃ: „w wymiarze określonym w orzeczeniu”\n {3}NA: „w wymiarze ustalonym w IPET”/);
});

test('docx: eksport zawiera PRAWDZIWE zmiany śledzone (w:ins i w:del) z autorem i datą', async () => {
  const segs = buildSegments(DOC, [edit({ decision: 'accepted' }), edit({ id: 'e2', type: 'insert_after', anchor: 'Dyrektor kieruje szkołą.', after: '\n§ 16. Nowy przepis.', decision: 'accepted' })]);
  const document = buildDocxDocument(docxLib, segs, { author: 'Monitor prawa (AI)', date: '2026-10-02T16:00:00.000Z', title: 'Statut' });
  const zip = await JSZip.loadAsync(await docxLib.Packer.toBuffer(document));
  const xml = await zip.file('word/document.xml').async('string');
  assert.match(xml, /<w:del [^>]*w:author="Monitor prawa \(AI\)"/);
  assert.match(xml, /<w:ins [^>]*w:author="Monitor prawa \(AI\)"/);
  assert.match(xml, /<w:delText[^>]*>w wymiarze określonym w orzeczeniu<\/w:delText>/);
  assert.match(xml, /w wymiarze ustalonym w IPET/);
  assert.match(xml, /§ 16\. Nowy przepis\./);
  const ids = [...xml.matchAll(/<w:(?:ins|del) [^>]*w:id="(\d+)"/g)].map((m) => m[1]);
  assert.equal(new Set(ids).size, ids.length, 'identyfikatory zmian są unikalne');
});

test('pliki: .txt i .docx są wczytywane i normalizowane, inne formaty odrzucane czytelnym komunikatem', async () => {
  const txt = { name: 'statut.TXT', text: async () => 'Linia 1\r\n\r\n\r\n\r\nLinia 2  \n' };
  assert.equal(await readDocumentFile(txt, {}), 'Linia 1\n\nLinia 2');
  const docx = { name: 'a.docx', arrayBuffer: async () => new ArrayBuffer(1) };
  assert.equal(await readDocumentFile(docx, { loadMammoth: async () => ({ extractRawText: async () => ({ value: 'Z Worda' }) }) }), 'Z Worda');
  await assert.rejects(readDocumentFile({ name: 'a.pdf' }, {}), /Obsługiwane formaty/);
  await assert.rejects(readDocumentFile({ name: 'a.txt', text: async () => '   ' }, {}), /nie zawiera tekstu/);
  assert.equal(normalizeText('a\u00a0b'), 'a b');
});

/* ---- panel ---- */
test('dokumenty: wklejony tekst i plik zapisują się z hashem, podgląd i usunięcie działają, zły format jest odrzucany', async () => {
  const { root, sb } = await boot({ hash: '/dokumenty', docs: [] });
  assert.match(root.textContent, /Bez danych osobowych/);
  await type(root, 'form[data-form=savedoc][data-name="Regulamin internatu"] [name=content]', 'Regulamin internatu: §1.');
  submit(root, 'form[data-form=savedoc][data-name="Regulamin internatu"]'); await settle();
  const row = sb.db.school_documents.find((d) => d.name === 'Regulamin internatu');
  assert.equal(row.content, 'Regulamin internatu: §1.');
  assert.equal(row.content_hash, await sha256Hex('Regulamin internatu: §1.'));
  assert.equal(row.chars, 24);
  assert.match(root.textContent, /wgrany/);

  const input = root.querySelector('input[data-c=docfile][data-name="Statut SOSW"]');
  Object.defineProperty(input, 'files', { value: [{ name: 'statut.docx', arrayBuffer: async () => new ArrayBuffer(1) }], configurable: true });
  input.dispatchEvent(new window.Event('change', { bubbles: true })); await settle();
  assert.equal(sb.db.school_documents.find((d) => d.name === 'Statut SOSW').content, 'Tekst z Worda\n\nDrugi akapit');

  const bad = root.querySelector('input[data-c=docfile][data-name="Regulamin pracy"]');
  Object.defineProperty(bad, 'files', { value: [{ name: 'x.pdf' }], configurable: true });
  bad.dispatchEvent(new window.Event('change', { bubbles: true })); await settle();
  assert.match(document.getElementById('toast').textContent, /Obsługiwane formaty/);
  assert.ok(!sb.db.school_documents.some((d) => d.name === 'Regulamin pracy'));

  click(root, '[data-a=previewdoc][data-name="Statut SOSW"]'); await settle();
  assert.match(root.textContent, /Tekst z Worda/);
  click(root, '[data-a=deldocfile][data-name="Statut SOSW"]'); await settle();
  assert.ok(!sb.db.school_documents.some((d) => d.name === 'Statut SOSW'));
});

test('zmiana prawa: prośba o szkic zapisuje się w bazie, bez dokumentu w bibliotece panel kieruje do wgrania', async () => {
  const { root, sb } = await boot({ hash: `/zmiany/${encodeURIComponent('DU/2026/1900')}` });
  assert.match(root.textContent, /Szkice dokumentów/);
  click(root, '[data-a=reqdraft]'); await settle();
  const d = sb.db.document_drafts[0];
  assert.deepEqual([d.change_key, d.document_name, d.status], ['DU/2026/1900', 'Statut SOSW', 'requested']);
  assert.match(root.textContent, /Zostanie przygotowany przy najbliższym skanie/);

  const none = await boot({ hash: `/zmiany/${encodeURIComponent('DU/2026/1900')}`, docs: [] });
  assert.ok(!none.root.querySelector('[data-a=reqdraft]'));
  assert.match(none.root.textContent, /brak w bibliotece/);
  assert.ok(none.root.querySelector('a[href="#/dokumenty"]'));
});

test('lista szkiców: stany, licznik w menu i liczba przyjętych propozycji', async () => {
  const { root } = await boot({ hash: '/szkice', drafts: [draft(), draft({ id: 'd2', document_name: 'Regulamin internatu', status: 'requested', edits: [] })] });
  assert.match(root.textContent, /Do przeglądu/);
  assert.match(root.textContent, /Oczekuje/);
  assert.match(root.textContent, /1 do ręcznego wstawienia/);
  assert.equal(root.querySelector('.nav .count[style*="accent"]').textContent, '1');
});

test('przegląd szkicu: diff w kontekście, decyzje zapisują się, nieumiejscowionej nie da się przyjąć', async () => {
  const { root, sb } = await boot({ hash: '/szkice/d1', drafts: [draft()] });
  assert.match(root.textContent, /Zmienić § 14 ust\. 2\./);
  assert.equal(root.querySelector('[data-edit=e1] del').textContent, 'w wymiarze określonym w orzeczeniu');
  assert.equal(root.querySelector('[data-edit=e1] ins').textContent, 'w wymiarze ustalonym w IPET');
  assert.match(root.querySelector('[data-edit=e1] .doc').textContent, /organizuje się/, 'jest kontekst z dokumentu');
  assert.match(root.querySelector('[data-edit=e3]').textContent, /Nie umiejscowiono w dokumencie/);
  assert.ok(!root.querySelector('[data-edit=e3] [data-a=decide]'), 'brak przycisków decyzji dla nieumiejscowionej');
  assert.ok(root.querySelector('[data-a=dl-docx]').disabled, 'pobranie wyłączone, dopóki nic nie przyjęto');

  click(root, '[data-edit=e1] [data-a=decide][data-v=accepted]'); await settle();
  assert.equal(sb.db.document_drafts[0].edits.find((e) => e.id === 'e1').decision, 'accepted');
  assert.equal(root.querySelector('[data-a=dl-docx]').disabled, false);
  click(root, '[data-a=acceptall]'); await settle();
  assert.equal(sb.db.document_drafts[0].edits.find((e) => e.id === 'e2').decision, 'accepted');
  assert.equal(sb.db.document_drafts[0].edits.find((e) => e.id === 'e3').decision, 'pending', 'nieumiejscowiona nie jest przyjmowana hurtowo');
  click(root, '[data-edit=e2] [data-a=decide][data-v=rejected]'); await settle();
  click(root, '[data-edit=e2] [data-a=decide][data-v=pending]'); await settle();
  assert.equal(sb.db.document_drafts[0].edits.find((e) => e.id === 'e2').decision, 'pending');
});

test('przegląd szkicu: pobranie Worda i tekstu, kopiowanie listy, zatwierdzenie, ponowne generowanie', async () => {
  const { root, sb, downloads } = await boot({ hash: '/szkice/d1', drafts: [draft()] });
  click(root, '[data-a=acceptall]'); await settle();
  click(root, '[data-a=dl-docx]'); await settle();
  click(root, '[data-a=dl-txt]'); await settle();
  assert.deepEqual([...downloads].sort(), ['Statut SOSW (szkic zmian).docx', 'Statut SOSW (szkic zmian).txt']);
  click(root, '[data-a=copylist]'); await settle();
  assert.match(globalThis.__copied, /ZAMIEŃ: „w wymiarze określonym w orzeczeniu”/);
  click(root, '[data-a=draftstatus][data-v=accepted]'); await settle();
  assert.equal(sb.db.document_drafts[0].status, 'accepted');
  assert.ok(sb.db.document_drafts[0].reviewed_at);
  click(root, '[data-a=regen]'); await settle();
  assert.equal(sb.db.document_drafts[0].status, 'requested');
});

test('przegląd szkicu: zmieniony dokument pokazuje ostrzeżenie, a szkic z błędem oferuje ponowienie', async () => {
  const stale = await boot({ hash: '/szkice/d1', drafts: [draft({ doc_hash: 'stary-hash' })] });
  assert.match(stale.root.textContent, /Dokument w bibliotece zmienił się/);
  const failed = await boot({ hash: '/szkice/d1', drafts: [draft({ status: 'failed', error: 'Gemini 429', edits: [] })] });
  assert.match(failed.root.textContent, /Gemini 429/);
  assert.ok(failed.root.querySelector('[data-a=regen]'));
});

test('bezpieczeństwo: treści modelu w propozycjach są escapowane (brak XSS) także w diffie', async () => {
  const evil = draft({ summary: '<img src=x onerror=alert(1)>', edits: [edit({ after: 'x<script>alert(2)</script>y', rationale: '<b onmouseover=1>r</b>' })] });
  const { root } = await boot({ hash: '/szkice/d1', drafts: [evil] });
  assert.equal(root.querySelectorAll('img[src=x], script, b[onmouseover]').length, 0);
  assert.match(root.textContent, /<script>alert\(2\)<\/script>/);
});
