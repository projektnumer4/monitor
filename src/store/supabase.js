/** Magazyn w Supabase (PostgREST). Używa klucza service_role, który istnieje wyłącznie w sekretach GitHuba. */
export function createSupabaseStore({ url, serviceKey, http }) {
  if (!url || !serviceKey) throw new Error('Brak SUPABASE_URL lub SUPABASE_SERVICE_ROLE_KEY');
  const base = `${url.replace(/\/$/, '')}/rest/v1`;
  const headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'content-type': 'application/json' };

  const get = async (table, query) => (await http.request(`${base}/${table}?${query}`, { headers })).json();
  const upsert = async (table, rows, onConflict) => {
    if (!rows.length) return;
    await http.request(`${base}/${table}?on_conflict=${onConflict}`, {
      method: 'POST',
      headers: { ...headers, Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(rows),
    });
  };

  return {
    kind: 'supabase',
    async hasRun(date) {
      const rows = await get('runs', `run_date=eq.${date}&status=eq.ok&select=run_date`);
      return rows.length > 0;
    },
    async recordRun(date, summary) {
      await upsert('runs', [{ run_date: date, status: 'ok', finished_at: new Date().toISOString(), summary }], 'run_date');
    },
    async getSeen(keys) {
      const found = new Set();
      for (let i = 0; i < keys.length; i += 60) {
        const chunk = keys.slice(i, i + 60).map((k) => `"${k.replace(/"/g, '')}"`).join(',');
        const rows = await get('seen_items', `key=in.(${encodeURIComponent(chunk)})&select=key`);
        rows.forEach((r) => found.add(r.key));
      }
      return found;
    },
    async markSeen(rows) {
      await upsert('seen_items', rows.map((r) => ({ key: r.key, source_id: r.source_id, title: r.title, relevant: r.relevant })), 'key');
    },
    async saveChange(c) { await upsert('changes', [c], 'key'); },
    async listByRunDate(date) { return get('changes', `run_date=eq.${date}&order=created_at.asc&select=*`); },
    async listUpcoming(from, to) {
      return get('changes', `effective_date=gte.${from}&effective_date=lte.${to}&order=effective_date.asc&select=*`);
    },
  };
}
