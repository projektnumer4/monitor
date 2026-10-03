import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createHttp, createFixtureHttp } from './http.js';
import { createAnalyzerFromEnv, createMockAnalyzer } from './analyze.js';
import { createMailerFromEnv, createFileMailer } from './mail.js';
import { createStore } from './store/index.js';
import { runScan } from './pipeline.js';
import { buildSources } from './sources/index.js';
import { mergeConfig, validateConfig } from './config.js';
import { createJsonLlm } from './llm.js';
import { runDrafts } from './drafts.js';

const args = process.argv.slice(2);
const cmd = args[0] ?? 'scan';
const flag = (name) => args.includes(`--${name}`);
const opt = (name) => args.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=');
const log = (...m) => console.log(...m);

export async function loadConfig(file = process.env.CONFIG_FILE || 'config/default.json') {
  return JSON.parse(await readFile(file, 'utf8'));
}

async function scan() {
  const baseCfg = await loadConfig();
  const dryRun = flag('dry-run');
  const fixturesDir = opt('fixtures');
  const http = fixturesDir
    ? createFixtureHttp(JSON.parse(await readFile(path.join(fixturesDir, 'manifest.json'), 'utf8')), fixturesDir)
    : createHttp();
  const realHttp = createHttp();

  const mockAi = flag('mock-ai');
  const analyzer = mockAi ? createMockAnalyzer() : createAnalyzerFromEnv({ http: realHttp });
  const mailer = dryRun
    ? createFileMailer(opt('out') || 'out')
    : createMailerFromEnv({ env: process.env, http: realHttp });
  const store = createStore({ dryRun, http: realHttp });

  // Ustawienia z panelu admina (jeśli istnieją) mają pierwszeństwo przed plikiem domyślnym.
  let cfg = baseCfg;
  try {
    const override = await store.getConfig?.();
    if (override) {
      const errors = validateConfig(override);
      if (errors.length) log(`UWAGA: ustawienia z panelu są niepoprawne i zostały zignorowane: ${errors.slice(0, 3).join('; ')}`);
      else { cfg = mergeConfig(baseCfg, override); log('Użyto ustawień z panelu admina'); }
    }
  } catch (e) {
    log(`UWAGA: nie udało się odczytać ustawień z panelu (${e.message}), używam domyślnych`);
  }

  const llm = mockAi ? null : createJsonLlm({ http: realHttp });
  const result = await runScan({
    cfg, http, store, analyzer, mailer,
    drafter: () => runDrafts({ store, llm, cfg, log }),
    now: opt('now') ? new Date(opt('now')) : new Date(),
    force: flag('force'),
    appUrl: process.env.APP_URL || '',
    log,
  });

  if (!result.skipped) {
    const bad = result.health.filter((h) => !h.ok);
    log(`Gotowe: ${result.changes.length} zmian, ${bad.length} źródeł z błędem.`);
    if (dryRun) log(`Raport zapisany w ${opt('out') || 'out'}/report.html`);
    // Gdy WSZYSTKIE źródła zawiodły, kończymy błędem, żeby GitHub pokazał czerwony przebieg.
    if (bad.length === result.health.length) process.exitCode = 1;
  }
}

/** Przetwarza prośby o szkice z panelu (i tworzy brakujące szkice automatyczne) bez uruchamiania skanu. */
async function drafts() {
  const baseCfg = await loadConfig();
  const realHttp = createHttp();
  const store = createStore({ dryRun: flag('dry-run'), http: realHttp });
  let cfg = baseCfg;
  const override = await store.getConfig?.();
  if (override && !validateConfig(override).length) cfg = mergeConfig(baseCfg, override);
  const llm = createJsonLlm({ http: realHttp });
  const r = await runDrafts({ store, llm, cfg, log });
  log(`Szkice: utworzono ${r.created.length}, błędów ${r.failed}, pominięto ${r.skipped}.`);
  if (r.failed && !r.created.length) process.exitCode = 1;
}

/** Sprawdza konfigurację i dostępność źródeł. Warto uruchomić raz przed pierwszym skanem. */
async function verify() {
  const cfg = await loadConfig();
  const http = createHttp();
  const env = (k) => (process.env[k] ? 'ustawiona' : 'BRAK');
  log('Zmienne środowiskowe:');
  for (const k of ['AI_PROVIDER', 'GEMINI_API_KEY', 'ANTHROPIC_API_KEY', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'BREVO_API_KEY', 'RESEND_API_KEY', 'REPORT_FROM', 'REPORT_TO', 'APP_URL']) log(`  ${k}: ${env(k)}`);

  log('\nAkty obserwowane (sprawdź, czy tytuły się zgadzają):');
  for (const w of cfg.watchedActs) {
    try {
      const [pub, year, pos] = w.eli.split('/');
      const d = await http.json(`https://api.sejm.gov.pl/eli/acts/${pub}/${year}/${pos}`);
      log(`  OK   ${w.eli}: ${d.title}`);
    } catch (e) {
      log(`  BŁĄD ${w.eli} (${w.name}): ${e.message}`);
    }
  }

  log('\nŹródła (lista nowych pozycji z ostatnich dni):');
  const today = new Date().toISOString().slice(0, 10);
  for (const s of buildSources(cfg)) {
    try {
      const items = await s.listNew({ http, today, lookbackDays: cfg.schedule.lookbackDays, cfg });
      log(`  OK   ${s.name}: ${items.length} pozycji${items[0] ? ` (np. ${items[0].title.slice(0, 70)})` : ''}`);
    } catch (e) {
      log(`  BŁĄD ${s.name}: ${e.message}`);
    }
  }
}

/** Wysyła krótką wiadomość próbną na adresy z REPORT_TO. Sprawdza klucz, nadawcę i dostarczalność bez uruchamiania skanu. */
async function testmail() {
  const mailer = createMailerFromEnv({ env: process.env, http: createHttp() });
  await mailer.send({
    subject: 'Monitor prawa: wiadomość próbna',
    html: '<p>To jest wiadomość próbna z Monitora prawa oświatowego. Jeśli ją widzisz, wysyłka działa.</p><p>Sprawdź, czy trafiła do skrzynki odbiorczej, a nie do spamu.</p>',
    text: 'To jest wiadomość próbna z Monitora prawa oświatowego. Jeśli ją widzisz, wysyłka działa. Sprawdź, czy trafiła do skrzynki odbiorczej, a nie do spamu.',
  });
  log(`Wysłano wiadomość próbną (usługa: ${mailer.name}) na adresy z REPORT_TO.`);
}

const commands = { scan, verify, drafts, testmail };
if (!commands[cmd]) {
  log('Użycie: node src/cli.js <scan|drafts|verify|testmail> [--dry-run] [--force] [--fixtures=katalog] [--now=ISO] [--mock-ai]');
  process.exit(2);
}
commands[cmd]().catch((e) => {
  console.error(`Błąd krytyczny: ${e.message}`);
  process.exit(1);
});
