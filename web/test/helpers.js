import { JSDOM } from 'jsdom';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const loadDefaults = async () => JSON.parse(await readFile(path.join(here, '..', 'defaults.json'), 'utf8'));

/** Środowisko przeglądarkowe w Node: globalne document/location itd. */
export function setupDom(url = 'https://panel.test/') {
  const dom = new JSDOM('<!doctype html><html><body><div id="app"></div><div id="toast"></div></body></html>', { url, pretendToBeVisual: true });
  const w = dom.window;
  globalThis.window = w;
  globalThis.document = w.document;
  globalThis.location = w.location;
  globalThis.localStorage = w.localStorage;
  globalThis.FormData = w.FormData;
  globalThis.confirm = () => true;
  Object.defineProperty(globalThis, 'navigator', { value: { clipboard: { writeText: async (t) => { globalThis.__copied = t; } } }, configurable: true });
  globalThis.matchMedia = () => ({ matches: false });
  return { dom, root: w.document.getElementById('app') };
}

export const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
export async function settle() { for (let i = 0; i < 8; i++) await tick(0); }

export const sampleChanges = () => [
  { key: 'DU/2026/1900', source_id: 'eli-du', source_name: 'Dziennik Ustaw', title: 'Rozporządzenie zmieniające organizację kształcenia specjalnego', url: 'https://eli.gov.pl/x', published_at: '2026-10-01', effective_date: '2027-01-01', category: 'oswiatowe', priority: 'hi', priority_reasons: ['Zmiana wymaga aktualizacji statutu'], summary: 'Zmiana zasad zajęć rewalidacyjnych.', what_changes: 'Wymiar ustala IPET.', status: 'obowiazuje', affects_school: 'yes', requires_statute_change: true, requires_council_resolution: true, documents: ['Statut SOSW'], tasks: [{ role: 'Dyrektor', action: 'Zwołać radę pedagogiczną.', deadline: null }, { role: 'Logopeda', action: 'Dostosować dokumentację terapii.', deadline: '2026-12-01' }], legal_basis: 'Dz.U. 2026 poz. 1900', confidence: 'medium', review_note: null, run_date: '2026-10-02', workflow: 'new', admin_note: null },
  { key: 'rcl:/projekt/1', source_id: 'rcl', source_name: 'RCL', title: 'Projekt rozporządzenia o ocenianiu uczniów', url: 'https://rcl/1', effective_date: null, category: 'oswiatowe', priority: 'lo', priority_reasons: ['Projekt aktu prawnego lub informacja'], summary: 'Projekt w konsultacjach.', what_changes: '', status: 'projekt', documents: [], tasks: [{ role: 'Dyrektor', action: 'Śledzić prace.', deadline: null }], confidence: 'low', review_note: 'Wynik orientacyjny', run_date: '2026-10-01', workflow: 'new' },
  { key: 'DU/2026/1950', source_id: 'eli-du', source_name: 'Dziennik Ustaw', title: 'Dostępność cyfrowa stron BIP', effective_date: '2026-10-20', category: 'administracyjne', priority: 'hi', priority_reasons: ['Termin krótszy niż 30 dni'], summary: 'Deklaracja dostępności.', status: 'obowiazuje', documents: ['Deklaracja dostępności BIP'], tasks: [{ role: 'Sekretarz', action: 'Zaktualizować deklarację.' }], confidence: 'high', run_date: '2026-09-30', workflow: 'done' },
];

/** Atrapa klienta Supabase: tabele w pamięci, kolejkowanie filtrów, MFA, RPC. */
export function fakeSupabase(opts = {}) {
  const db = {
    changes: opts.changes ?? sampleChanges(),
    runs: opts.runs ?? [{ run_date: '2026-10-02', status: 'ok', summary: { reviewed: 12, changes: 3, health: [{ id: 'eli-du', name: 'Dziennik Ustaw', ok: true, listed: 9, fresh: 2 }, { id: 'rcl', name: 'RCL', ok: false, error: 'zmiana układu', listed: 0 }] } }],
    settings: opts.settings ?? [],
    access_links: opts.links ?? [],
  };
  const calls = [];
  let session = opts.session === undefined ? null : opts.session;
  const mfa = { level: opts.aal ?? 'aal1', factors: opts.factors ?? [] };
  const user = { id: 'u1', email: 'admin@example.pl' };

  const from = (table) => {
    const q = { op: 'select', filters: [], payload: null, order: null };
    const run = () => {
      calls.push({ table, op: q.op, payload: q.payload, filters: q.filters });
      let rows = db[table];
      const match = (r) => q.filters.every(([c, v]) => r[c] === v);
      if (q.op === 'select') {
        let out = rows.filter(match);
        return { data: out.map((r) => ({ ...r })), error: null };
      }
      if (q.op === 'update') { rows.filter(match).forEach((r) => Object.assign(r, q.payload)); return { data: rows.filter(match), error: null }; }
      if (q.op === 'insert') { const r = { id: `id${rows.length + 1}`, created_at: new Date().toISOString(), revoked: false, last_used_at: null, ...q.payload }; rows.push(r); return { data: [r], error: null }; }
      if (q.op === 'upsert') { const i = rows.findIndex((r) => r.key === q.payload.key); if (i >= 0) rows[i] = q.payload; else rows.push(q.payload); return { data: [q.payload], error: null }; }
      if (q.op === 'delete') { db[table] = rows.filter((r) => !match(r)); return { data: null, error: null }; }
      return { data: null, error: null };
    };
    const b = {
      select() { return b; }, order() { return b; }, limit() { return b; },
      eq(c, v) { q.filters.push([c, v]); return b; },
      update(p) { q.op = 'update'; q.payload = p; return b; },
      insert(p) { q.op = 'insert'; q.payload = p; return b; },
      upsert(p) { q.op = 'upsert'; q.payload = p; return b; },
      delete() { q.op = 'delete'; return b; },
      then(res, rej) { try { return Promise.resolve(run()).then(res, rej); } catch (e) { return Promise.reject(e); } },
    };
    return b;
  };

  const sb = {
    calls, db,
    from,
    rpc: async (fn, args) => {
      calls.push({ rpc: fn, args });
      if (fn === 'is_registered_admin') return { data: opts.isAdmin !== false, error: null };
      if (fn === 'get_role_view') return { data: opts.roleView?.(args.p_token) ?? null, error: null };
      return { data: null, error: { message: 'unknown rpc' } };
    },
    auth: {
      getSession: async () => ({ data: { session: session && { user } }, error: null }),
      signInWithPassword: async ({ email, password }) => {
        if (password === opts.password) { session = { user }; return { data: { session }, error: null }; }
        return { data: null, error: { message: 'Invalid login credentials' } };
      },
      signOut: async () => { session = null; mfa.level = 'aal1'; return { error: null }; },
      updateUser: async (p) => { calls.push({ updateUser: p }); return { error: opts.pwError ? { message: opts.pwError } : null }; },
      mfa: {
        getAuthenticatorAssuranceLevel: async () => ({ data: { currentLevel: mfa.level, nextLevel: mfa.factors.some((f) => f.status === 'verified') ? 'aal2' : 'aal1' } }),
        listFactors: async () => ({ data: { totp: mfa.factors.filter((f) => f.status === 'verified'), all: mfa.factors }, error: null }),
        enroll: async () => { const f = { id: 'f-new', factor_type: 'totp', status: 'unverified' }; mfa.factors.push(f); return { data: { id: 'f-new', totp: { qr_code: 'data:image/svg+xml;utf-8,<svg/>', secret: 'JBSWY3DPEHPK3PXP' } }, error: null }; },
        unenroll: async ({ factorId }) => { mfa.factors = mfa.factors.filter((f) => f.id !== factorId); calls.push({ unenroll: factorId }); return { error: null }; },
        challengeAndVerify: async ({ factorId, code }) => {
          if (code !== '123456') return { error: { message: 'bad code' } };
          mfa.factors.forEach((f) => { if (f.id === factorId) f.status = 'verified'; });
          mfa.level = 'aal2';
          return { data: {}, error: null };
        },
      },
    },
  };
  return sb;
}

export async function type(root, selector, value) {
  const el = root.querySelector(selector);
  el.value = value;
  el.dispatchEvent(new globalThis.window.Event('input', { bubbles: true }));
  return el;
}
export function submit(root, selector) {
  const f = root.querySelector(selector);
  f.dispatchEvent(new globalThis.window.Event('submit', { bubbles: true, cancelable: true }));
}
export function click(root, selector) {
  root.querySelector(selector).dispatchEvent(new globalThis.window.MouseEvent('click', { bubbles: true }));
}
