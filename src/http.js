import { sleep } from './util.js';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

/** Klient HTTP z ponawianiem prób (429 i 5xx) oraz limitem czasu. */
export function createHttp({ fetchImpl = globalThis.fetch, retries = 3, timeoutMs = 30000, userAgent = 'sosw-monitor/0.1 (monitoring prawa oswiatowego)' } = {}) {
  async function request(url, { method = 'GET', headers = {}, body } = {}) {
    let last;
    for (let i = 0; i <= retries; i++) {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), timeoutMs);
      try {
        const res = await fetchImpl(url, { method, body, headers: { 'User-Agent': userAgent, ...headers }, signal: ctl.signal });
        clearTimeout(timer);
        if (res.status === 429 || res.status >= 500) {
          last = Object.assign(new Error(`HTTP ${res.status} dla ${url}`), { status: res.status });
          await sleep(1000 * 2 ** i);
          continue;
        }
        if (!res.ok) {
          // Treść odpowiedzi (np. komunikat Supabase lub API) mówi, co dokładnie poszło nie tak.
          let detail = '';
          try { detail = (await res.text()).replace(/\s+/g, ' ').slice(0, 300); } catch { /* brak treści */ }
          throw Object.assign(new Error(`HTTP ${res.status} dla ${url}${detail ? `: ${detail}` : ''}`), { status: res.status, fatal: true });
        }
        return res;
      } catch (e) {
        clearTimeout(timer);
        if (e.fatal) throw e;
        // fetch() w Node zgłasza tylko „fetch failed”; prawdziwa przyczyna (np. ECONNRESET, błąd certyfikatu, DNS) siedzi w e.cause.
        const c = e.cause;
        if (c && (c.code || c.message)) e.message = `${e.message} (${[c.code, c.message].filter(Boolean).join(': ')}) dla ${url}`;
        else if (e.name === 'AbortError') e.message = `przekroczono limit czasu ${timeoutMs} ms dla ${url}`;
        last = e;
        await sleep(1000 * 2 ** i);
      }
    }
    throw last;
  }
  return {
    request,
    json: async (u, o = {}) => (await request(u, { ...o, headers: { Accept: 'application/json', ...o.headers } })).json(),
    text: async (u, o = {}) => (await request(u, o)).text(),
    buffer: async (u, o = {}) => Buffer.from(await (await request(u, o)).arrayBuffer()),
  };
}

/**
 * Klient HTTP oparty na plikach: manifest mapuje URL na plik z danymi testowymi.
 * Służy do testów i do uruchomienia próbnego bez internetu.
 */
export function createFixtureHttp(manifest, dir) {
  const load = async (url) => {
    const entry = manifest[url];
    if (!entry) throw Object.assign(new Error(`Brak danych testowych dla ${url}`), { status: 404, fatal: true });
    if (entry.error) throw new Error(entry.error);
    return readFile(path.join(dir, entry.file));
  };
  return {
    json: async (u) => JSON.parse((await load(u)).toString('utf8')),
    text: async (u) => (await load(u)).toString('utf8'),
    buffer: async (u) => load(u),
    request: async () => { throw new Error('request() nie jest dostępne w trybie danych testowych'); },
  };
}
