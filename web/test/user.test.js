import test from 'node:test';
import assert from 'node:assert/strict';
import { setupDom, fakeSupabase, loadDefaults, settle } from './helpers.js';
import { startApp } from '../js/app.js';

const TOKEN = 'abcdefghijklmnopqrstuvwxyz0123456789ABCD';
const view = { role: 'Logopeda', generated_at: '2026-10-02T15:00:00Z', changes: [
  { key: 'k1', title: 'Zmiana zasad terapii', priority: 'mid', effective_date: '2027-03-01', summary: 'Częstsza ocena.', status: 'obowiazuje', documents: ['Procedura opracowania IPET'], tasks: [{ role: 'Logopeda', action: 'Dostosować terminy oceny.', deadline: '2027-02-15' }], legal_basis: 'Dz.U. 2026', url: 'https://eli.gov.pl/k1', workflow: 'new' },
  { key: 'k2', title: '<img src=x onerror=alert(1)>', priority: 'lo', effective_date: null, summary: '<script>x</script>', status: 'projekt', documents: [], tasks: [{ role: 'Logopeda', action: 'Śledzić.' }], workflow: 'done' },
] };

async function open(token, roleView) {
  const env = setupDom(`https://panel.test/#/r/${token}`);
  const sb = fakeSupabase({ roleView });
  await startApp({ sb, root: env.root, defaults: await loadDefaults(), now: () => new Date('2026-10-02T15:40:00Z') });
  await settle();
  return { ...env, sb };
}

test('widok z linku: bez logowania, tylko zadania roli, tylko do odczytu, żadnych zapytań do tabel', async () => {
  const { root, sb } = await open(TOKEN, (t) => (t === TOKEN ? view : null));
  assert.match(root.textContent, /Logopeda/);
  assert.match(root.textContent, /Dostosować terminy oceny/);
  assert.match(root.textContent, /Tylko do odczytu/);
  assert.ok(!root.querySelector('form, textarea, input'), 'brak jakichkolwiek pól edycji');
  assert.deepEqual(sb.calls.map((c) => c.rpc).filter(Boolean), ['get_role_view'], 'jedyne wywołanie to funkcja z tokenem');
  assert.ok(!sb.calls.some((c) => c.table), 'tabele nie są czytane bezpośrednio');
});

test('widok z linku: zrobione zadanie jest przekreślone, treści z internetu escapowane', async () => {
  const { root } = await open(TOKEN, () => view);
  assert.ok(root.querySelector('.done-task'));
  assert.equal(root.querySelectorAll('img[src=x]').length, 0);
  assert.equal(root.querySelectorAll('script').length, 0);
});

test('widok z linku: nieważny lub odwołany token pokazuje komunikat bez żadnych danych', async () => {
  const { root } = await open(TOKEN, () => null);
  assert.match(root.textContent, /Link jest nieważny/);
  assert.ok(!root.textContent.includes('Zadania dla roli'));
});

test('widok z linku: pusta lista zadań i błąd sieci mają czytelne komunikaty', async () => {
  let r = await open(TOKEN, () => ({ role: 'IOD', generated_at: '2026-10-02T10:00:00Z', changes: [] }));
  assert.match(r.root.textContent, /Brak zadań dla tej roli/);
  const env = setupDom(`https://panel.test/#/r/${TOKEN}`);
  const sb = fakeSupabase({});
  sb.rpc = async () => ({ data: null, error: { message: 'network down' } });
  await startApp({ sb, root: env.root, defaults: await loadDefaults() });
  await settle();
  assert.match(env.root.textContent, /network down/);
});

test('trasa tokenu przyjmuje tylko bezpieczne znaki', async () => {
  const env = setupDom('https://panel.test/#/r/<script>');
  const sb = fakeSupabase({ session: null });
  await startApp({ sb, root: env.root, defaults: await loadDefaults() });
  await settle();
  assert.ok(env.root.querySelector('#f-login'), 'nierozpoznany adres prowadzi do logowania, nie do widoku użytkownika');
});
