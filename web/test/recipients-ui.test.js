import test from 'node:test';
import assert from 'node:assert/strict';
import { setupDom, fakeSupabase, loadDefaults, settle, type, submit, click } from './helpers.js';
import { startApp } from '../js/app.js';

const NOW = () => new Date('2026-10-02T15:40:00Z');
const TOKEN = 'tok-Ola-aaaaaaaaaaaaaaaaaaaaaaaa';
const ola = () => ({ id: 'r1', name: 'Ola Nowak', email: 'ola@example.pl', roles: ['Logopeda'], status: 'active', consent_at: '2026-09-30', consent_note: 'ustnie', unsub_token: TOKEN, created_at: '2026-09-30T10:00:00Z' });

async function boot(opts = {}) {
  const env = setupDom('https://panel.test/#/odbiorcy');
  const sb = fakeSupabase({ session: { x: 1 }, aal: 'aal2', factors: [{ id: 'f1', factor_type: 'totp', status: 'verified' }], ...opts });
  await startApp({ sb, root: env.root, defaults: await loadDefaults(), now: NOW });
  await settle();
  return { ...env, sb };
}

function fill(root, { name = 'Anna Kowalska', email = 'anna@example.pl', roles = ['Psycholog'], consent = true } = {}) {
  root.querySelector('[name=name]').value = name;
  root.querySelector('[name=email]').value = email;
  root.querySelectorAll('[name=roles]').forEach((c) => { c.checked = roles.includes(c.value); });
  root.querySelector('[name=consent]').checked = consent;
}

test('odbiorcy: bez tabeli w bazie panel działa, a zakładka tłumaczy, co wykonać', async () => {
  const { root } = await boot();
  assert.match(root.textContent, /supabase\/recipients\.sql/);
  assert.match(root.textContent, /Odbiorcy e-maili/);
});

test('odbiorcy: lista pokazuje osoby, role, zgodę i status; adres jest escapowany', async () => {
  const { root } = await boot({ recipients: [ola(), { ...ola(), id: 'r2', name: '<img src=x onerror=alert(1)>', email: 'x@example.pl', status: 'unsubscribed', unsubscribed_at: '2026-10-01T10:00:00Z' }] });
  assert.match(root.textContent, /Ola Nowak/);
  assert.match(root.textContent, /ola@example\.pl/);
  assert.match(root.textContent, /Logopeda/);
  assert.match(root.textContent, /ustnie/);
  assert.match(root.textContent, /Aktywny/);
  assert.match(root.textContent, /Wypisany/);
  assert.equal(root.querySelectorAll('img[src=x]').length, 0);
});

test('odbiorcy: dodanie wymaga roli i zgody, potem osoba trafia do bazy z datą i opisem zgody', async () => {
  const { root, sb } = await boot({ recipients: [] });
  fill(root, { roles: [] });
  submit(root, 'form[data-form=newrecipient]'); await settle();
  assert.match(document.getElementById('toast').textContent, /przynajmniej jedną rolę/);
  assert.equal(sb.db.recipients.length, 0);

  fill(root, { consent: false, roles: ['Psycholog'] });
  submit(root, 'form[data-form=newrecipient]'); await settle();
  assert.match(document.getElementById('toast').textContent, /wyraziła zgodę/);
  assert.equal(sb.db.recipients.length, 0);

  root.querySelector('[name=consent_note]').value = 'SMS';
  fill(root, { roles: ['Psycholog', 'Logopeda'] });
  submit(root, 'form[data-form=newrecipient]'); await settle();
  assert.equal(sb.db.recipients.length, 1);
  assert.deepEqual(sb.db.recipients[0].roles, ['Psycholog', 'Logopeda']);
  assert.equal(sb.db.recipients[0].email, 'anna@example.pl');
  assert.equal(sb.db.recipients[0].consent_at, '2026-10-02');
  assert.equal(sb.db.recipients[0].consent_note, 'SMS');
  assert.match(root.textContent, /Anna Kowalska/);
});

test('odbiorcy: ten sam adres drugi raz daje czytelny komunikat', async () => {
  const { root, sb } = await boot({ recipients: [ola()] });
  fill(root, { email: 'OLA@example.pl' });
  submit(root, 'form[data-form=newrecipient]'); await settle();
  assert.match(document.getElementById('toast').textContent, /już jest na liście/);
  assert.equal(sb.db.recipients.length, 1);
});

test('odbiorcy: admin może wypisać osobę albo usunąć ją razem z adresem', async () => {
  const { root, sb } = await boot({ recipients: [ola()] });
  click(root, '[data-a=unsubrec]'); await settle();
  assert.equal(sb.db.recipients[0].status, 'unsubscribed');
  assert.match(root.textContent, /Wypisany/);
  click(root, '[data-a=delrec]'); await settle();
  assert.equal(sb.db.recipients.length, 0);
});

test('wypisanie z linku: wymaga kliknięcia, działa bez logowania i nie czyta żadnych tabel', async () => {
  const env = setupDom(`https://panel.test/#/wypisz/${TOKEN}`);
  const sb = fakeSupabase({ recipients: [ola()] });
  await startApp({ sb, root: env.root, defaults: await loadDefaults(), now: NOW });
  await settle();
  assert.match(env.root.textContent, /Wypisz mnie/);
  assert.equal(sb.calls.length, 0, 'samo otwarcie strony niczego nie zmienia');
  click(env.root, '#unsub'); await settle();
  assert.match(env.root.textContent, /Wypisano/);
  assert.equal(sb.db.recipients[0].status, 'unsubscribed');
  assert.deepEqual(sb.calls.map((c) => c.rpc), ['unsubscribe_recipient']);
});

test('wypisanie z linku: nieznany token pokazuje komunikat, a nie potwierdzenie', async () => {
  const env = setupDom('https://panel.test/#/wypisz/zly-token-zly-token-zly-token-zly');
  const sb = fakeSupabase({ recipients: [ola()] });
  await startApp({ sb, root: env.root, defaults: await loadDefaults(), now: NOW });
  await settle();
  click(env.root, '#unsub'); await settle();
  assert.match(env.root.textContent, /Link jest nieważny/);
  assert.equal(sb.db.recipients[0].status, 'active');
});
