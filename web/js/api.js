import { deepClone, makeToken, sha256Hex, addDays } from './util.js';

const must = ({ data, error }) => {
  if (error) throw new Error(error.message || String(error));
  return data;
};

export const api = (sb) => ({
  async isRegisteredAdmin() { return must(await sb.rpc('is_registered_admin')) === true; },

  async loadChanges() {
    return must(await sb.from('changes').select('*').order('run_date', { ascending: false }).order('created_at', { ascending: false }).limit(500)) ?? [];
  },
  async updateChange(key, patch) {
    return must(await sb.from('changes').update(patch).eq('key', key).select());
  },
  async loadRuns() {
    return must(await sb.from('runs').select('*').order('run_date', { ascending: false }).limit(30)) ?? [];
  },

  /** Ustawienia z bazy (albo null, gdy jeszcze ich nie zapisano). */
  async loadConfigOverride() {
    const rows = must(await sb.from('settings').select('value').eq('key', 'config').limit(1)) ?? [];
    return rows[0]?.value ?? null;
  },
  async saveConfig(cfg) {
    return must(await sb.from('settings').upsert({ key: 'config', value: cfg, updated_at: new Date().toISOString() }, { onConflict: 'key' }));
  },
  async resetConfig() {
    return must(await sb.from('settings').delete().eq('key', 'config'));
  },

  async listLinks() {
    return must(await sb.from('access_links').select('*').order('created_at', { ascending: false })) ?? [];
  },
  /** Zwraca token (widoczny tylko teraz) i wiersz zapisany w bazie (ze skrótem tokenu). */
  async createLink({ role, label, days }) {
    const token = makeToken();
    const token_hash = await sha256Hex(token);
    const expires_at = days ? new Date(Date.now() + days * 86400000).toISOString() : null;
    const rows = must(await sb.from('access_links').insert({ role_name: role, label: label || null, token_hash, expires_at }).select());
    return { token, link: rows?.[0] ?? null };
  },
  async revokeLink(id) {
    return must(await sb.from('access_links').update({ revoked: true }).eq('id', id).select());
  },
  async deleteLink(id) {
    return must(await sb.from('access_links').delete().eq('id', id));
  },

  async roleView(token) {
    return must(await sb.rpc('get_role_view', { p_token: token }));
  },
});

export { addDays, deepClone };
