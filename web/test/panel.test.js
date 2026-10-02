import test from 'node:test';
import assert from 'node:assert/strict';
import { setupDom, fakeSupabase, loadDefaults, settle, type, submit, click, sampleChanges } from './helpers.js';
import { startApp } from '../js/app.js';

const NOW = () => new Date('2026-10-02T15:40:00Z');

async function boot({ hash = '', ...opts } = {}) {
  const env = setupDom(`https://panel.test/${hash ? `#${hash}` : ''}`);
  const sb = fakeSupabase({ session: { x: 1 }, aal: 'aal2', factors: [{ id: 'f1', factor_type: 'totp', status: 'verified' }], ...opts });
  const defaults = await loadDefaults();
  await startApp({ sb, root: env.root, defaults, now: NOW });
  await settle();
  return { ...env, sb, defaults };
}

test('logowanie: zły e-mail lub hasło pokazuje komunikat, dobre prowadzi do kodu 2FA', async () => {
  const env = setupDom();
  const sb = fakeSupabase({ password: 'dobre-haslo-123', factors: [{ id: 'f1', factor_type: 'totp', status: 'verified' }] });
  await startApp({ sb, root: env.root, defaults: await loadDefaults(), now: NOW });
  await settle();
  assert.ok(env.root.querySelector('#f-login'));
  await type(env.root, '#em', 'admin@example.pl'); await type(env.root, '#pw', 'zle');
  submit(env.root, '#f-login'); await settle();
  assert.match(env.root.textContent, /Nieprawidłowy e-mail lub hasło/);
  await type(env.root, '#em', 'admin@example.pl'); await type(env.root, '#pw', 'dobre-haslo-123');
  submit(env.root, '#f-login'); await settle();
  assert.match(env.root.textContent, /Drugi składnik logowania/);
  assert.ok(!env.root.textContent.includes('Przegląd'), 'bez kodu panel się nie otwiera');
});

test('2FA: zły kod odrzucony, dobry otwiera panel z danymi', async () => {
  const env = setupDom();
  const sb = fakeSupabase({ session: { x: 1 }, factors: [{ id: 'f1', factor_type: 'totp', status: 'verified' }] });
  await startApp({ sb, root: env.root, defaults: await loadDefaults(), now: NOW });
  await settle();
  await type(env.root, '#code', '000000'); submit(env.root, '#f-code'); await settle();
  assert.match(env.root.textContent, /Nieprawidłowy lub przeterminowany kod/);
  await type(env.root, '#code', '123 456'); submit(env.root, '#f-code'); await settle(); await settle();
  assert.match(env.root.textContent, /Przegląd/);
  assert.match(env.root.textContent, /Rozporządzenie zmieniające organizację/);
});

test('2FA: konto bez składnika dostaje konfigurację z kodem QR i po potwierdzeniu wchodzi do panelu', async () => {
  const env = setupDom();
  const sb = fakeSupabase({ session: { x: 1 }, factors: [{ id: 'old', factor_type: 'totp', status: 'unverified' }] });
  await startApp({ sb, root: env.root, defaults: await loadDefaults(), now: NOW });
  await settle();
  assert.match(env.root.textContent, /Skonfiguruj 2FA/);
  assert.ok(env.root.querySelector('img.qr'));
  assert.match(env.root.textContent, /JBSWY3DPEHPK3PXP/);
  assert.ok(sb.calls.some((c) => c.unenroll === 'old'), 'porzucona próba została usunięta');
  await type(env.root, '#code', '123456'); submit(env.root, '#f-code'); await settle(); await settle();
  assert.match(env.root.textContent, /Przegląd/);
});

test('uprawnienia: konto spoza listy adminów widzi odmowę i żadnych danych', async () => {
  const env = setupDom();
  const sb = fakeSupabase({ session: { x: 1 }, isAdmin: false });
  await startApp({ sb, root: env.root, defaults: await loadDefaults(), now: NOW });
  await settle();
  assert.match(env.root.textContent, /Brak uprawnień/);
  assert.ok(!sb.calls.some((c) => c.table === 'changes'), 'dane nie zostały nawet pobrane');
});

test('przegląd: statystyki liczą tylko zmiany do obsługi, status skanu i błędne źródło', async () => {
  const { root } = await boot();
  const stats = [...root.querySelectorAll('.stat .n')].map((e) => e.textContent);
  assert.deepEqual(stats, ['1', '0', '1'], 'zrobiona zmiana nie liczy się jako otwarta');
  assert.match(root.textContent, /zgłosił problemy ze źródłami: RCL/);
  assert.ok(root.querySelector('.tl-m'), 'oś czasu ma znaczniki');
});

test('przegląd: skan sprzed kilku dni pokazuje ostrzeżenie, brak skanów pokazuje wskazówkę', async () => {
  let { root } = await boot({ runs: [{ run_date: '2026-09-25', status: 'ok', summary: {} }] });
  assert.match(root.textContent, /dni temu/);
  ({ root } = await boot({ runs: [] }));
  assert.match(root.textContent, /Nie ma jeszcze żadnego skanu/);
});

test('zmiany: filtr priorytetu, wyszukiwarka i filtr stanu działają', async () => {
  const { root } = await boot({ hash: '/zmiany' });
  assert.equal(root.querySelectorAll('.item').length, 2, 'domyślnie tylko do obsługi');
  click(root, '[data-a=filter][data-k=prio][data-v=lo]'); await settle();
  assert.equal(root.querySelectorAll('.item').length, 1);
  click(root, '[data-a=filter][data-k=prio][data-v=all]'); click(root, '[data-a=filter][data-k=wf][data-v=all]'); await settle();
  assert.equal(root.querySelectorAll('.item').length, 3);
  await type(root, '#q', 'dostępność'); await settle();
  assert.equal(root.querySelectorAll('.item').length, 1);
});

test('szczegóły zmiany: zmiana stanu i notatki zapisuje się w bazie i znika z listy do obsługi', async () => {
  const { root, sb } = await boot({ hash: `/zmiany/${encodeURIComponent('DU/2026/1900')}` });
  assert.match(root.textContent, /Zwołać radę pedagogiczną/);
  assert.match(root.textContent, /Wymaga uchwały rady pedagogicznej/);
  root.querySelector('#wf').value = 'done';
  root.querySelector('#note').value = 'Rada 12.11';
  submit(root, 'form[data-form=savechange]'); await settle();
  const row = sb.db.changes.find((c) => c.key === 'DU/2026/1900');
  assert.equal(row.workflow, 'done');
  assert.equal(row.admin_note, 'Rada 12.11');
  assert.ok(row.handled_at);
});

test('bezpieczeństwo: treści z internetu w tytule i notatce są escapowane (brak XSS)', async () => {
  const evil = sampleChanges();
  evil[0].title = '<img src=x onerror=alert(1)>';
  evil[0].summary = '<script>alert(2)</script>';
  evil[0].url = 'javascript:alert(3)';
  const { root } = await boot({ hash: `/zmiany/${encodeURIComponent('DU/2026/1900')}`, changes: evil });
  assert.equal(root.querySelectorAll('img[src=x]').length, 0);
  assert.equal(root.querySelectorAll('script').length, 0);
  assert.match(root.textContent, /<img src=x onerror=alert\(1\)>/);
});

test('role: dodanie, zapis zakresu i usunięcie roli zapisują ustawienia w bazie', async () => {
  const { root, sb } = await boot({ hash: '/role' });
  await type(root, 'form[data-form=addrole] [name=name]', 'Asystent nauczyciela');
  submit(root, 'form[data-form=addrole]'); await settle();
  let saved = sb.db.settings[0].value;
  assert.ok(saved.roles.some((r) => r.name === 'Asystent nauczyciela'));
  assert.deepEqual(Object.keys(saved).sort(), ['documents', 'keywords', 'removedSources', 'roles', 'rules', 'school', 'sources'], 'zapisujemy tylko to, co panel edytuje');
  click(root, '[data-a=delrole][data-name="Asystent nauczyciela"]'); await settle();
  saved = sb.db.settings[0].value;
  assert.ok(!saved.roles.some((r) => r.name === 'Asystent nauczyciela'));
});

test('reguły: zmiana priorytetu, wyłączenie i próg dni trafiają do ustawień, słowa kluczowe da się dodać i usunąć', async () => {
  const { root, sb } = await boot({ hash: '/priorytety' });
  const sel = root.querySelector('select[data-id=r3]'); sel.value = 'hi'; sel.dispatchEvent(new window.Event('change', { bubbles: true })); await settle();
  assert.equal(sb.db.settings[0].value.rules.find((r) => r.id === 'r3').prio, 'hi');
  const chk = root.querySelector('input[data-c=rule][data-id=r1]'); chk.checked = false; chk.dispatchEvent(new window.Event('change', { bubbles: true })); await settle();
  assert.equal(sb.db.settings[0].value.rules.find((r) => r.id === 'r1').on, false);
  const num = root.querySelector('input[data-c=num][data-id=r2]'); num.value = '9999'; num.dispatchEvent(new window.Event('change', { bubbles: true })); await settle();
  assert.equal(sb.db.settings[0].value.rules.find((r) => r.id === 'r2').num, 365, 'próg ograniczony do 365 dni');
  await type(root, 'form[data-form=addkw][data-g=education] [name=kw]', 'Logopedyczn');
  submit(root, 'form[data-form=addkw][data-g=education]'); await settle();
  assert.ok(sb.db.settings[0].value.keywords.education.includes('logopedyczn'));
  click(root, '[data-a=rmkw][data-g=education][data-i="0"]'); await settle();
  assert.ok(!sb.db.settings[0].value.keywords.education.includes('oświat'));
});

test('źródła: wyłączenie, dodanie RSS, walidacja adresu i usunięcie domyślnego (trafia do removedSources)', async () => {
  const { root, sb, defaults } = await boot({ hash: '/zrodla' });
  assert.ok(root.querySelector('.dot.ok') && root.querySelector('.dot.bad'), 'stan źródeł z ostatniego skanu');
  const chk = root.querySelector('input[data-c=src][data-id=eli-mp]'); chk.checked = false; chk.dispatchEvent(new window.Event('change', { bubbles: true })); await settle();
  assert.equal(sb.db.settings[0].value.sources.find((s) => s.id === 'eli-mp').enabled, false);
  await type(root, 'form[data-form=addsrc] [name=name]', 'Kanał testowy'); await type(root, 'form[data-form=addsrc] [name=url]', 'ftp://zly');
  submit(root, 'form[data-form=addsrc]'); await settle();
  assert.ok(!sb.db.settings[0].value.sources.some((s) => s.name === 'Kanał testowy'), 'adres spoza http(s) odrzucony');
  await type(root, 'form[data-form=addsrc] [name=url]', 'https://example.test/rss.xml');
  submit(root, 'form[data-form=addsrc]'); await settle();
  assert.ok(sb.db.settings[0].value.sources.some((s) => s.id === 'rss-kanal-testowy' && s.enabled));
  click(root, '[data-a=delsrc][data-id=rcl]'); await settle();
  const v = sb.db.settings[0].value;
  assert.ok(!v.sources.some((s) => s.id === 'rcl'));
  assert.ok(v.removedSources.includes('rcl'));
  assert.ok(defaults.sources.some((s) => s.id === 'rcl'));
});

test('linki: token pokazany raz, w bazie tylko skrót SHA-256, odwołanie działa', async () => {
  const { root, sb } = await boot({ hash: '/linki' });
  root.querySelector('form[data-form=newlink] [name=role]').value = 'Logopeda';
  submit(root, 'form[data-form=newlink]'); await settle();
  const box = root.querySelector('#newlink').textContent;
  const token = box.split('#/r/')[1];
  assert.ok(token && token.length >= 40);
  const row = sb.db.access_links[0];
  assert.match(row.token_hash, /^[0-9a-f]{64}$/);
  assert.ok(!JSON.stringify(sb.db.access_links).includes(token), 'sam token nie trafia do bazy');
  const { sha256Hex } = await import('../js/util.js');
  assert.equal(row.token_hash, await sha256Hex(token));
  assert.equal(row.role_name, 'Logopeda');
  assert.ok(row.expires_at);
  click(root, '[data-a=copylink]'); await settle();
  assert.equal(globalThis.__copied, box);
  click(root, '[data-a=closenew]'); await settle();
  assert.ok(!root.querySelector('#newlink'), 'po zamknięciu link znika');
  click(root, '[data-a=revoke]'); await settle();
  assert.equal(sb.db.access_links[0].revoked, true);
  assert.match(root.textContent, /Odwołany/);
});

test('ustawienia: zapis opisu placówki, dokument z uchwałą rady, zmiana hasła i reset do domyślnych', async () => {
  const { root, sb, defaults } = await boot({ hash: '/ustawienia' });
  assert.match(root.textContent, /Drugi składnik \(2FA\): włączony/);
  await type(root, 'form[data-form=school] [name=profile]', 'Nowy opis placówki');
  submit(root, 'form[data-form=school]'); await settle();
  assert.equal(sb.db.settings[0].value.school.profile, 'Nowy opis placówki');
  await type(root, 'form[data-form=adddoc] [name=name]', 'Regulamin stołówki');
  root.querySelector('form[data-form=adddoc] [name=council]').checked = true;
  submit(root, 'form[data-form=adddoc]'); await settle();
  assert.ok(sb.db.settings[0].value.documents.some((d) => d.name === 'Regulamin stołówki' && d.needsCouncil));
  await type(root, 'form[data-form=password] [name=pw]', 'bardzo-dlugie-haslo-1');
  submit(root, 'form[data-form=password]'); await settle();
  assert.ok(sb.calls.some((c) => c.updateUser?.password === 'bardzo-dlugie-haslo-1'));
  click(root, '[data-a=resetcfg]'); await settle();
  assert.equal(sb.db.settings.length, 0);
  assert.equal(root.querySelector('form[data-form=school] [name=name]').value, defaults.school.name);
});

test('błąd bazy nie wyłącza panelu: komunikat i możliwość ponowienia', async () => {
  const env = setupDom();
  const sb = fakeSupabase({ session: { x: 1 }, aal: 'aal2', factors: [{ id: 'f1', status: 'verified' }] });
  const orig = sb.from;
  sb.from = (t) => (t === 'changes' ? { select() { return this; }, order() { return this; }, limit() { return this; }, then(res) { return Promise.resolve({ data: null, error: { message: 'permission denied' } }).then(res); } } : orig(t));
  await startApp({ sb, root: env.root, defaults: await loadDefaults(), now: NOW });
  await settle();
  assert.match(env.root.textContent, /Nie udało się wczytać danych: permission denied/);
  assert.ok(env.root.querySelector('[data-a=reload]'));
});
