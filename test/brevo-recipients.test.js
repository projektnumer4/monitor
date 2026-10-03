import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createBrevoMailer, createResendMailer, createMailerFromEnv, parseSender } from '../src/mail.js';
import { changesForRecipient, buildRecipientMails, sendToRecipients, scrub } from '../src/recipients.js';
import { runScan } from '../src/pipeline.js';
import { createFileStore } from '../src/store/file.js';
import { createMockAnalyzer } from '../src/analyze.js';
import { fixtureHttp, NOW, loadCfg } from './helpers.js';

const recorder = (fail = () => false) => {
  const calls = [];
  return { calls, http: { request: async (url, o) => { const body = JSON.parse(o.body); calls.push({ url, headers: o.headers, body }); if (fail(body)) throw new Error('HTTP 400: nieprawidłowy adres kto@example.pl'); return { ok: true }; } } };
};

test('Brevo: żądanie ma klucz w nagłówku, nadawcę, odbiorców z REPORT_TO i treść HTML oraz tekst', async () => {
  const r = recorder();
  const m = createBrevoMailer({ apiKey: 'xkeysib-1', from: 'Jan <jan@gmail.com>', to: 'a@x.pl, b@x.pl', http: r.http });
  await m.send({ subject: 'Temat', html: '<p>H</p>', text: 'T' });
  const c = r.calls[0];
  assert.equal(c.url, 'https://api.brevo.com/v3/smtp/email');
  assert.equal(c.headers['api-key'], 'xkeysib-1');
  assert.deepEqual(c.body.sender, { name: 'Jan', email: 'jan@gmail.com' });
  assert.deepEqual(c.body.to, [{ email: 'a@x.pl' }, { email: 'b@x.pl' }]);
  assert.equal(c.body.subject, 'Temat');
  assert.equal(c.body.htmlContent, '<p>H</p>');
  assert.equal(c.body.textContent, 'T');
  assert.ok(!('headers' in c.body));
});

test('Brevo: `to` nadpisuje domyślnych odbiorców i przenosi nagłówki (List-Unsubscribe)', async () => {
  const r = recorder();
  const m = createBrevoMailer({ apiKey: 'k', from: 'jan@gmail.com', fromName: 'Monitor', to: 'admin@x.pl', http: r.http });
  await m.send({ subject: 'S', html: 'h', text: 't', to: [{ email: 'n@x.pl', name: 'Anna' }], headers: { 'List-Unsubscribe': '<https://p/#/wypisz/t>' } });
  assert.deepEqual(r.calls[0].body.to, [{ email: 'n@x.pl', name: 'Anna' }]);
  assert.equal(r.calls[0].body.sender.name, 'Monitor');
  assert.equal(r.calls[0].body.headers['List-Unsubscribe'], '<https://p/#/wypisz/t>');
});

test('Brevo: brak klucza, nadawcy lub niepoprawny nadawca kończą się czytelnym błędem', () => {
  assert.throws(() => createBrevoMailer({ from: 'a@b.pl', to: 'x@y.pl', http: {} }), /BREVO_API_KEY/);
  assert.throws(() => createBrevoMailer({ apiKey: 'k', to: 'x@y.pl', http: {} }), /REPORT_FROM/);
  assert.throws(() => createBrevoMailer({ apiKey: 'k', from: 'to nie jest adres', http: {} }), /adresem e-mail/);
  assert.deepEqual(parseSender('jan@gmail.com'), { name: 'Monitor prawa', email: 'jan@gmail.com' });
});

test('wybór usługi: Brevo, gdy jest klucz; Resend domyślnie bez niego; MAIL_PROVIDER ma pierwszeństwo', () => {
  const base = { REPORT_FROM: 'a@b.pl', REPORT_TO: 'x@y.pl' };
  assert.equal(createMailerFromEnv({ env: { ...base, BREVO_API_KEY: 'k', RESEND_API_KEY: 'r' }, http: {} }).name, 'brevo');
  assert.equal(createMailerFromEnv({ env: { ...base, RESEND_API_KEY: 'r' }, http: {} }).name, 'resend');
  assert.equal(createMailerFromEnv({ env: { ...base, BREVO_API_KEY: 'k', RESEND_API_KEY: 'r', MAIL_PROVIDER: 'resend' }, http: {} }).name, 'resend');
  assert.throws(() => createMailerFromEnv({ env: { ...base, MAIL_PROVIDER: 'poczta' }, http: {} }), /MAIL_PROVIDER/);
});

test('Resend nadal działa po zmianach: domyślni odbiorcy i nadpisanie', async () => {
  const r = recorder();
  const m = createResendMailer({ apiKey: 'k', from: 'f@x.pl', to: 'a@x.pl', http: r.http });
  await m.send({ subject: 'S', html: 'h', text: 't' });
  await m.send({ subject: 'S', html: 'h', text: 't', to: [{ email: 'n@x.pl' }] });
  assert.deepEqual(r.calls[0].body.to, ['a@x.pl']);
  assert.deepEqual(r.calls[1].body.to, ['n@x.pl']);
});

const task = (role) => ({ role, action: `Zadanie ${role}` });
const chg = (key, roles, extra = {}) => ({ key, source_name: 'DU', title: `Zmiana ${key}`, url: `https://x/${key}`, priority: 'hi', priority_reasons: [], summary: 'S', what_changes: 'W', status: 'obowiazuje', documents: [], tasks: roles.map(task), effective_date: '2027-01-01', workflow: 'new', run_date: '2026-10-02', ...extra });
const rcp = (name, roles, extra = {}) => ({ id: name, name, email: `${name.toLowerCase()}@example.pl`, roles, status: 'active', unsub_token: `tok-${name}-aaaaaaaaaaaaaaaaaaaaaaaa`, ...extra });

test('odbiorca widzi tylko zmiany i zadania swojej roli; zamknięte przez admina są ukryte', () => {
  const out = changesForRecipient([chg('a', ['Dyrektor', 'Logopeda']), chg('b', ['Psycholog']), chg('c', ['Logopeda'], { workflow: 'dismissed' }), chg('d', ['Logopeda'], { workflow: 'done' })], rcp('Ola', ['Logopeda']));
  assert.deepEqual(out.map((c) => c.key), ['a']);
  assert.deepEqual(out[0].tasks.map((t) => t.role), ['Logopeda']);
});

test('wiadomość dla odbiorcy: tylko jego zadania, stopka z linkiem do wypisania i nagłówek List-Unsubscribe', async () => {
  const cfg = await loadCfg();
  const { mails, skipped } = buildRecipientMails({
    cfg, today: '2026-10-02', appUrl: 'https://panel.pages.dev/',
    changes: [chg('a', ['Dyrektor', 'Logopeda']), chg('b', ['Psycholog'])],
    recipients: [rcp('Ola', ['Logopeda']), rcp('Piotr', ['Wicedyrektor'])],
  });
  assert.equal(skipped, 1, 'Piotra nic nie dotyczy');
  assert.equal(mails.length, 1);
  const m = mails[0].message;
  const url = 'https://panel.pages.dev/#/wypisz/tok-Ola-aaaaaaaaaaaaaaaaaaaaaaaa';
  assert.deepEqual(m.to, [{ email: 'ola@example.pl', name: 'Ola' }]);
  assert.equal(m.headers['List-Unsubscribe'], `<${url}>`);
  assert.ok(m.html.includes(url) && m.text.includes(url));
  assert.match(m.text, /Zadanie Logopeda/);
  assert.ok(!m.text.includes('Zadanie Dyrektor'), 'cudze zadania nie wyciekają');
  assert.ok(!m.text.includes('Zmiana b'), 'cudze zmiany nie wyciekają');
  assert.match(m.text, /nie przypisuje nikomu obowiązków służbowych/);
  assert.match(m.html, /dla Twojej roli \(Logopeda\)/);
});

test('wysyłka: błąd u jednej osoby nie zatrzymuje reszty, a w logach nie ma adresów e-mail', async () => {
  const cfg = await loadCfg();
  const logs = [];
  const sent = [];
  const mailer = { supportsRecipients: true, send: async (msg) => { if (msg.to[0].email === 'ola@example.pl') throw new Error('HTTP 400: zły adres ola@example.pl'); sent.push(msg.to[0].email); } };
  const store = { listRecipients: async () => [rcp('Ola', ['Logopeda']), rcp('Ewa', ['Logopeda']), rcp('Stary', ['Logopeda'], { status: 'unsubscribed' }), rcp('Bez', [])] };
  const out = await sendToRecipients({ mailer, store, cfg, today: '2026-10-02', changes: [chg('a', ['Logopeda'])], upcoming: [], appUrl: 'https://p.pl', log: (m) => logs.push(m) });
  assert.deepEqual(out, { sent: 1, failed: 1, skipped: 0 });
  assert.deepEqual(sent, ['ewa@example.pl'], 'wypisani i osoby bez ról są pomijane');
  assert.ok(!logs.join('\n').includes('@'), 'w logach nie ma adresów');
  assert.equal(scrub('błąd dla a.b+c@dom.example.pl!'), 'błąd dla ***!');
});

test('wysyłka: bez APP_URL nikt nie dostaje wiadomości (stopka wymaga linku do wypisania)', async () => {
  const cfg = await loadCfg();
  const logs = [];
  let n = 0;
  const out = await sendToRecipients({ mailer: { supportsRecipients: true, send: async () => { n++; } }, store: { listRecipients: async () => [rcp('Ola', ['Logopeda'])] }, cfg, today: '2026-10-02', changes: [chg('a', ['Logopeda'])], upcoming: [], appUrl: '', log: (m) => logs.push(m) });
  assert.equal(n, 0);
  assert.equal(out.skipped, 1);
  assert.match(logs[0], /APP_URL/);
});

test('wysyłka: brak zmian albo brak tabeli odbiorców niczego nie psuje', async () => {
  const cfg = await loadCfg();
  const mailer = { supportsRecipients: true, send: async () => { throw new Error('nie powinno być wywołane'); } };
  const none = await sendToRecipients({ mailer, store: { listRecipients: async () => [rcp('Ola', ['Logopeda'])] }, cfg, today: 'd', changes: [], upcoming: [], appUrl: 'https://p.pl' });
  assert.deepEqual(none, { sent: 0, failed: 0, skipped: 0 });
  const logs = [];
  const broken = await sendToRecipients({ mailer, store: { listRecipients: async () => { throw new Error('relation "recipients" does not exist'); } }, cfg, today: 'd', changes: [chg('a', ['Logopeda'])], upcoming: [], appUrl: 'https://p.pl', log: (m) => logs.push(m) });
  assert.equal(broken.sent, 0);
  assert.match(logs[0], /recipients\.sql/);
});

async function scanSetup(extra = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), 'sosw-'));
  const store = createFileStore(path.join(dir, 's.json'));
  const sent = [];
  return { cfg: await loadCfg(), http: await fixtureHttp(), store, analyzer: createMockAnalyzer(), sent, mailer: { supportsRecipients: true, send: async (m) => { sent.push(m); } }, ...extra };
}

test('potok: raport dla admina idzie pierwszy, potem wiadomości dla odbiorców; skan zapisuje liczby w podsumowaniu', async () => {
  const s = await scanSetup();
  // Każda rola, która ma zadania w zmianach z danych testowych, dostaje wiadomość.
  const first = await runScan({ ...s, now: NOW, appUrl: 'https://p.pl' });
  const roles = [...new Set(first.changes.flatMap((c) => c.tasks.map((t) => t.role)))];
  assert.ok(roles.length > 0);

  const s2 = await scanSetup();
  s2.store.listRecipients = async () => [rcp('Ola', [roles[0]])];
  const r = await runScan({ ...s2, now: NOW, appUrl: 'https://p.pl' });
  assert.ok(!s2.sent[0].to, 'pierwsza wiadomość to raport dla admina (domyślni odbiorcy)');
  assert.equal(s2.sent.length, 2);
  assert.equal(s2.sent[1].to[0].email, 'ola@example.pl');
  assert.equal(r.summary.recipients.sent, 1);
});

test('potok: awaria wysyłki do odbiorców nie przerywa skanu i go nie cofa', async () => {
  const s = await scanSetup();
  const sentAdmin = [];
  s.mailer = { supportsRecipients: true, send: async (m) => { if (m.to) throw new Error('HTTP 401'); sentAdmin.push(m); } };
  const probe = await runScan({ ...(await scanSetup()), now: NOW, appUrl: 'https://p.pl' });
  const role = probe.changes.flatMap((c) => c.tasks.map((t) => t.role))[0];
  s.store.listRecipients = async () => [rcp('Ola', [role])];
  const r = await runScan({ ...s, now: NOW, appUrl: 'https://p.pl' });
  assert.equal(r.skipped, false);
  assert.equal(sentAdmin.length, 1);
  assert.equal(r.summary.recipients.failed, 1);
  assert.equal(await s.store.hasRun('2026-10-02'), true);
});

test('potok: tryb próbny (mailer plikowy) nigdy nie wysyła do odbiorców', async () => {
  const s = await scanSetup({ mailer: { send: async () => {} } });
  s.store.listRecipients = async () => { throw new Error('nie powinno być wywołane'); };
  const r = await runScan({ ...s, now: NOW, appUrl: 'https://p.pl' });
  assert.equal(r.skipped, false);
  assert.ok(!r.summary.recipients);
});
