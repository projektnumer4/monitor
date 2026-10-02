import { createFileStore } from './file.js';
import { createSupabaseStore } from './supabase.js';

export function createStore({ dryRun, http, env = process.env }) {
  if (dryRun) return createFileStore(env.STATE_FILE || '.data/state.json');
  return createSupabaseStore({ url: env.SUPABASE_URL, serviceKey: env.SUPABASE_SERVICE_ROLE_KEY, http });
}
