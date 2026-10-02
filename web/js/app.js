import { api as makeApi } from './api.js';
import { runAuth } from './auth.js';
import { createAdminApp } from './admin.js';
import { renderUserView } from './user.js';
import { esc } from './util.js';

/** Punkt wejścia aplikacji. Wydzielony z main.js, żeby można go było testować bez przeglądarki. */
export async function startApp({ sb, root, defaults, now = () => new Date(), loaders }) {
  const A = makeApi(sb);
  const m = (globalThis.location.hash || '').match(/^#\/r\/([A-Za-z0-9_-]+)$/);
  if (m) return renderUserView({ api: A, root, token: m[1], now });

  const auth = runAuth({
    sb, root, api: A,
    onReady: async ({ user, logout }) => {
      const app = createAdminApp({ api: A, root, defaults, user, logout, sb, now, ...(loaders ? { loaders } : {}) });
      await app.start();
    },
  });
  await auth.start();
}

export const setupScreen = (root, why) => {
  root.innerHTML = `<div class="centered"><div class="card pad stack" style="max-width:520px"><h2>Panel wymaga konfiguracji</h2><p>${esc(why)}</p>
    <p class="muted small">Otwórz plik <code>web/config.js</code> w repozytorium i wpisz adres projektu Supabase oraz klucz publiczny (anon lub publishable). Szczegóły: SETUP-PANEL.md.</p></div></div>`;
};
