# Panel admina: uruchomienie krok po kroku

Panel to statyczna strona (folder `web/`) połączona z Twoją bazą Supabase. Logowanie: e-mail, hasło i obowiązkowo kod z aplikacji (2FA).
Pracownicy wchodzą bez logowania przez osobne linki, tylko do odczytu. Koszt: 0 zł (Supabase Free + Cloudflare Pages Free).

## 1. Supabase (ok. 10 minut)

1. **Reguły dostępu i tabele panelu.** SQL Editor → New query → wklej całą zawartość `supabase/panel.sql` → Run.
   Wynik: „Success. No rows returned”. (Najpierw musiał być wykonany `schema.sql`, ale to już masz.)
2. **Konto administratora.** Authentication → Users → **Add user → Create new user**. Wpisz swój e-mail i silne hasło
   (min. 12 znaków), zaznacz **Auto Confirm User**.
3. **Wyłącz rejestrację.** Authentication → Sign In / Providers (lub Settings) → wyłącz **Allow new users to sign up**.
   Dzięki temu nikt poza Tobą nie założy konta.
4. **Włącz 2FA (TOTP).** Authentication → Sign In / Providers → sekcja Multi-Factor (MFA): TOTP ma być włączone (zwykle jest domyślnie).
5. **Wpisz się na listę adminów.** SQL Editor → New query (wstaw swój e-mail):
   ```sql
   insert into public.admins (user_id) select id from auth.users where email = 'TWOJ-EMAIL@example.pl';
   ```
   Komunikat „Success. 1 row affected” potwierdza, że się udało.
6. **Skopiuj dane połączenia.** Project Settings → API (lub API Keys): **Project URL** oraz klucz **anon** (`eyJ...`)
   albo **publishable** (`sb_publishable_...`). **Nie** kopiuj klucza service_role ani secret.

## 2. Dane połączenia w repozytorium

W GitHubie otwórz `web/config.js`, kliknij ołówek i wpisz:
```js
window.APP_CONFIG = {
  supabaseUrl: 'https://TWOJ-ID.supabase.co',
  supabaseAnonKey: 'eyJ... albo sb_publishable_...',
};
```
Te dwie wartości są publiczne z założenia. Bezpieczeństwo zapewnia 2FA i reguły w bazie. Jeśli wkleisz klucz tajny, panel odmówi działania.

## 3. Hosting: Cloudflare Pages (ok. 10 minut)

1. Załóż darmowe konto na cloudflare.com → **Workers & Pages → Create → Pages → Connect to Git** i wybierz to repozytorium.
2. Ustawienia budowania: **Framework preset: None**, **Build command: (puste)**, **Build output directory: `web`**.
3. **Save and Deploy**. Po minucie dostaniesz adres `https://TWOJA-NAZWA.pages.dev`. Każda zmiana w repozytorium wdraża się sama.
4. W Supabase: Authentication → URL Configuration → **Site URL** ustaw na ten adres (potrzebne m.in. do resetu hasła).

Alternatywa: Netlify albo Vercel jako projekt statyczny z katalogiem publikacji `web`.

## 4. Pierwsze logowanie

1. Wejdź na adres panelu i zaloguj się e-mailem i hasłem z kroku 1.2.
2. Panel pokaże kod QR: zeskanuj go aplikacją uwierzytelniającą (Google/Microsoft Authenticator, Aegis) i wpisz kod.
   **Zapisz kody zapasowe aplikacji i nie gub telefonu**: bez drugiego składnika nie wejdziesz do panelu.
3. Wejdź w **Linki dla pracowników**, wybierz rolę i utwórz link. Link pokazuje się tylko raz (w bazie jest wyłącznie jego skrót).

## Jak panel łączy się z silnikiem skanowania

Zmiany w zakładkach **Źródła**, **Priorytety i słowa kluczowe**, **Role** i **Ustawienia** zapisują się w bazie.
Silnik czyta je przy każdym skanie i stosuje zamiast ustawień z pliku `config/default.json`
(w logu skanu widać wtedy „Użyto ustawień z panelu admina”). Zmiany działają od następnego skanu.
Źródła i reguły dodane w przyszłych wersjach kodu pojawią się u Ciebie same.

## Rozwiązywanie problemów

| Objaw | Przyczyna i rozwiązanie |
|---|---|
| Ekran „Panel wymaga konfiguracji” | `web/config.js` jest pusty albo zawiera klucz tajny (krok 2) |
| „Brak uprawnień” po zalogowaniu | konto nie jest na liście adminów (krok 1.5) |
| „Nie udało się rozpocząć konfiguracji 2FA” | TOTP wyłączone w Supabase (krok 1.4) |
| Panel otwiera się, ale „permission denied” | `panel.sql` nie został wykonany albo wykonany w innym projekcie (krok 1.1) |
| Panel pusty, mimo że skany działają | w tabeli `changes` nie ma jeszcze wpisów: uruchom skan w Actions |
| Link pracownika pokazuje „nieważny” | link odwołany, wygasł albo skopiowany z błędem: utwórz nowy |

## Bezpieczeństwo w skrócie

- Dane w bazie widzi i zmienia tylko konto z listy `admins`, zalogowane z 2FA. Wymusza to sama baza (reguły RLS), a nie tylko strona.
- Pracownik z linku może wywołać wyłącznie jedną funkcję, która zwraca zadania jego roli. Nie ma dostępu do tabel.
- Tokeny linków mają 256 bitów losowości, a w bazie są przechowywane tylko jako skrót SHA-256.
- Panel ma nagłówek `noindex` i politykę CSP (plik `web/_headers`, działa na Cloudflare Pages i Netlify).
- Mimo to traktuj linki jak hasła i nie umieszczaj w systemie danych uczniów ani pracowników.
