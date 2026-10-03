import { startApp, setupScreen } from './app.js';

const root = document.getElementById('app');

/** Wykrywa przypadkowe wklejenie klucza tajnego (nowy sb_secret_... albo stary JWT z rolą service_role). */
function isSecretKey(key) {
  if (/^sb_secret_/i.test(key)) return true;
  try {
    const payload = JSON.parse(atob(key.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return payload.role === 'service_role';
  } catch { return false; }
}

const cfg = window.APP_CONFIG || {};

try {
  if (!cfg.supabaseUrl || !cfg.supabaseAnonKey) {
    const missing = [!cfg.supabaseUrl && 'adresu projektu (supabaseUrl)', !cfg.supabaseAnonKey && 'klucza publicznego (supabaseAnonKey)'].filter(Boolean).join(' i ');
    setupScreen(root, `Serwowany plik config.js nie zawiera ${missing}. Jeśli właśnie go uzupełniłeś, poczekaj minutę na wdrożenie i odśwież stronę (Ctrl+F5). Możesz też otworzyć adres /config.js w przeglądarce i sprawdzić, co jest na serwerze.`);
  } else if (isSecretKey(cfg.supabaseAnonKey)) {
    setupScreen(root, 'W config.js jest klucz tajny (secret/service_role). Natychmiast go usuń i wygeneruj nowy w Supabase. Tu wolno wpisać wyłącznie klucz publiczny.');
  } else {
    const [{ createClient }, defaults] = await Promise.all([
      import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm'),
      fetch('./defaults.json').then((r) => r.json()),
    ]);
    const sb = createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false } });
    await startApp({ sb, root, defaults });
  }
} catch (e) {
  setupScreen(root, `Nie udało się uruchomić aplikacji: ${e.message}`);
}
