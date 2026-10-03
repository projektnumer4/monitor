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

  /* biblioteka dokumentów szkoły */
  async listDocuments() {
    return must(await sb.from('school_documents').select('name,chars,content_hash,updated_at').order('name', { ascending: true })) ?? [];
  },
  async getDocument(name) {
    const rows = must(await sb.from('school_documents').select('*').eq('name', name).limit(1)) ?? [];
    return rows[0] ?? null;
  },
  async saveDocument({ name, content }) {
    const content_hash = await sha256Hex(content);
    return must(await sb.from('school_documents').upsert({ name, content, chars: content.length, content_hash, updated_at: new Date().toISOString() }, { onConflict: 'name' }));
  },
  async deleteDocument(name) {
    return must(await sb.from('school_documents').delete().eq('name', name));
  },

  /* szkice */
  async listDrafts() {
    return must(await sb.from('document_drafts').select('*').order('requested_at', { ascending: false }).limit(200)) ?? [];
  },
  async requestDraft(change_key, document_name) {
    return must(await sb.from('document_drafts').upsert({ change_key, document_name, status: 'requested', error: null, requested_at: new Date().toISOString() }, { onConflict: 'change_key,document_name' }));
  },
  async updateDraft(id, patch) {
    return must(await sb.from('document_drafts').update(patch).eq('id', id).select());
  },

  /* odbiorcy wiadomości e-mail (dobrowolny zapis) */
  async listRecipients() {
    return must(await sb.from('recipients').select('id,name,email,roles,status,consent_at,consent_note,unsubscribed_at,created_at').order('name', { ascending: true })) ?? [];
  },
  async addRecipient({ name, email, roles, consent_at, consent_note }) {
    const rows = must(await sb.from('recipients').insert({ name, email, roles, consent_at, consent_note: consent_note || null }).select('id,name,email,roles,status,consent_at,consent_note,unsubscribed_at,created_at'));
    return rows?.[0] ?? null;
  },
  async updateRecipient(id, patch) {
    return must(await sb.from('recipients').update(patch).eq('id', id).select('id'));
  },
  async deleteRecipient(id) {
    return must(await sb.from('recipients').delete().eq('id', id));
  },
  /** Wypisanie z linku w stopce wiadomości (bez logowania). Zwraca true, gdy token jest prawidłowy. */
  async unsubscribe(token) {
    return must(await sb.rpc('unsubscribe_recipient', { p_token: token })) === true;
  },

  async roleView(token) {
    return must(await sb.rpc('get_role_view', { p_token: token }));
  },
});

export { addDays, deepClone };
