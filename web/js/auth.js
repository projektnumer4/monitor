import { esc, toast } from './util.js';

const card = (inner) => `<div class="login"><div class="card pad" style="width:100%;max-width:420px;padding:32px">
  <div class="brand" style="padding:0 0 18px"><div class="logo">§</div><div><b>Monitor prawa oświatowego</b><span>SOSW w Ostrołęce</span></div></div>${inner}</div></div>`;

/**
 * Logowanie administratora: e-mail i hasło, a potem obowiązkowo drugi składnik (TOTP).
 * Baza dodatkowo wymusza poziom aal2, więc nawet pominięcie tego ekranu nie otwiera dostępu do danych.
 */
export function runAuth({ sb, root, api, onReady }) {
  const A = api;

  async function logout() {
    await sb.auth.signOut();
    showLogin();
  }

  function showLogin(msg = '') {
    root.innerHTML = card(`
      <h2>Zaloguj się do panelu</h2>
      <p class="muted small" style="margin-top:4px">Dostęp tylko dla administratora. Pracownicy korzystają z osobnych linków.</p>
      ${msg ? `<div class="errbox" style="margin-top:14px" role="alert">${esc(msg)}</div>` : ''}
      <form id="f-login" class="stack" style="margin-top:6px">
        <div class="field"><label for="em">E-mail</label><input id="em" name="email" type="email" required autocomplete="username"></div>
        <div class="field"><label for="pw">Hasło</label><input id="pw" name="password" type="password" required autocomplete="current-password"></div>
        <button class="btn pri" style="padding:11px;margin-top:6px" type="submit">Dalej</button>
      </form>`);
    root.querySelector('#f-login').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      const btn = e.target.querySelector('button');
      btn.disabled = true;
      const { error } = await sb.auth.signInWithPassword({ email: String(f.get('email')).trim(), password: String(f.get('password')) });
      if (error) return showLogin('Nieprawidłowy e-mail lub hasło.');
      proceed();
    });
  }

  function showDenied() {
    root.innerHTML = card(`<h2>Brak uprawnień</h2>
      <div class="errbox" style="margin-top:14px" role="alert">To konto nie ma dostępu do panelu administratora.</div>
      <p class="muted small" style="margin-top:12px">Jeśli to Twoje konto, dodaj je na listę adminów w Supabase (instrukcja w pliku SETUP-PANEL.md).</p>
      <button class="btn" style="margin-top:14px" id="b-out">Wyloguj</button>`);
    root.querySelector('#b-out').addEventListener('click', logout);
  }

  function codeForm({ title, intro, extra = '', submit }) {
    root.innerHTML = card(`<h2>${esc(title)}</h2><p class="muted small" style="margin-top:4px">${intro}</p>${extra}
      <form id="f-code" class="stack" style="margin-top:8px">
        <div class="field"><label for="code">Kod z aplikacji (6 cyfr)</label>
          <input id="code" name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9 ]{6,7}" maxlength="7" required autofocus></div>
        <div id="err"></div>
        <button class="btn pri" style="padding:11px" type="submit">Potwierdź</button>
      </form>
      <button class="btn sm" style="margin-top:14px" id="b-out">Wyloguj</button>`);
    root.querySelector('#b-out').addEventListener('click', logout);
    root.querySelector('#f-code').addEventListener('submit', async (e) => {
      e.preventDefault();
      const code = String(new FormData(e.target).get('code')).replace(/\s/g, '');
      const err = await submit(code);
      if (err) root.querySelector('#err').innerHTML = `<div class="errbox" role="alert">${esc(err)}</div>`;
      else proceed();
    });
  }

  async function showVerify() {
    const { data, error } = await sb.auth.mfa.listFactors();
    const factor = data?.totp?.[0];
    if (error || !factor) return showEnroll();
    codeForm({
      title: 'Drugi składnik logowania',
      intro: 'Wpisz aktualny kod z aplikacji uwierzytelniającej (np. Google Authenticator, Microsoft Authenticator, Aegis).',
      submit: async (code) => {
        const r = await sb.auth.mfa.challengeAndVerify({ factorId: factor.id, code });
        return r.error ? 'Nieprawidłowy lub przeterminowany kod. Spróbuj z następnym.' : '';
      },
    });
  }

  async function showEnroll() {
    // Porzucone, niezweryfikowane próby konfiguracji usuwamy, żeby nie zaśmiecały konta.
    const list = await sb.auth.mfa.listFactors();
    for (const f of list.data?.all ?? []) if (f.factor_type === 'totp' && f.status === 'unverified') await sb.auth.mfa.unenroll({ factorId: f.id });

    const { data, error } = await sb.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'Monitor prawa' });
    if (error) return showLogin(`Nie udało się rozpocząć konfiguracji 2FA: ${error.message}`);
    codeForm({
      title: 'Skonfiguruj 2FA',
      intro: 'Zeskanuj kod QR w aplikacji uwierzytelniającej, a potem wpisz wygenerowany kod. Bez tego panel się nie otworzy.',
      extra: `<img class="qr" alt="Kod QR do aplikacji uwierzytelniającej" src="${esc(data.totp.qr_code)}">
        <p class="muted small" style="text-align:center">Nie możesz zeskanować? Wpisz ręcznie:</p>
        <div class="secret">${esc(data.totp.secret)}</div>`,
      submit: async (code) => {
        const r = await sb.auth.mfa.challengeAndVerify({ factorId: data.id, code });
        return r.error ? 'Nieprawidłowy kod. Sprawdź, czy zegar w telefonie jest dokładny, i spróbuj ponownie.' : '';
      },
    });
  }

  async function proceed() {
    root.innerHTML = '<div class="centered"><div class="skeleton" style="width:160px"></div></div>';
    const { data } = await sb.auth.getSession();
    if (!data?.session) return showLogin();
    let registered = false;
    try { registered = await A.isRegisteredAdmin(); } catch (e) { return showLogin(`Błąd połączenia z bazą: ${e.message}`); }
    if (!registered) return showDenied();
    const aal = (await sb.auth.mfa.getAuthenticatorAssuranceLevel()).data;
    if (aal?.currentLevel === 'aal2') return onReady({ user: data.session.user, logout });
    if (aal?.nextLevel === 'aal2') return showVerify();
    return showEnroll();
  }

  return { start: proceed, logout };
}
export { toast };
