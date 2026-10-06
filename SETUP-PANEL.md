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

W GitHubie otwórz `web/config.js` (jeśli go nie ma, utwórz go: Add file → Create new file → `web/config.js`, zawartość wg `web/config.example.js`), kliknij ołówek i wpisz:
```js
window.APP_CONFIG = {
  supabaseUrl: 'https://TWOJ-ID.supabase.co',
  supabaseAnonKey: 'eyJ... albo sb_publishable_...',
};
```
**Paczka ZIP nie zawiera pliku `web/config.js`, więc kolejne wgrania kodu nie nadpiszą Twoich danych.** Te dwie wartości są publiczne z założenia. Bezpieczeństwo zapewnia 2FA i reguły w bazie. Jeśli wkleisz klucz tajny, panel odmówi działania.

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

## Szkice dokumentów: konfiguracja (jednorazowo)

**Kolejność ma znaczenie.** Najpierw baza, potem kod, bo nowy silnik zapisuje dodatkowe pole, którego stara baza nie ma.

1. W Supabase wykonaj `supabase/drafts.sql` (SQL Editor → New query → wklej → Run).
2. Wgraj nowy kod do repo i dodaj plik workflow `.github/workflows/drafts.yml` (zawartość w załączniku).
3. W panelu otwórz **Dokumenty szkoły** i wgraj tekst statutu oraz procedur (bez danych osobowych).
4. Szkice pojawią się w zakładce **Szkice dokumentów** po najbliższym skanie albo po ręcznym uruchomieniu workflow *Szkice dokumentów*.
5. Wymagany jest tryb AI `gemini` lub `claude`.

## Wiadomości do nauczycieli: Brevo (dobrowolny zapis, 0 zł)

Silnik wysyła raport dla Ciebie (adresy z `REPORT_TO`) i osobne, krótsze wiadomości dla osób zapisanych w panelu, w zakładce **Odbiorcy e-maili**.
Każda osoba dostaje tylko zmiany i zadania swojej roli, a w stopce ma link „Wypisz mnie”. Darmowy plan Brevo: 300 wiadomości dziennie, bez własnej domeny.

**Kolejność ma znaczenie: najpierw baza, potem kod.**

1. **Baza.** Supabase → SQL Editor → New query → wklej `supabase/recipients.sql` → Run.
2. **Konto Brevo.** Załóż konto na brevo.com (plan Free). W menu konta wybierz **Senders, Domains & Dedicated IPs → Senders → Add a sender**, wpisz swój adres i potwierdź go linkiem z maila.
   Nazwy w menu mogą się nieznacznie różnić. Zdarza się, że Brevo przy nowym koncie chce chwilę zweryfikować użycie, wtedy pierwsza wysyłka rusza dopiero po ich akceptacji.
3. **Klucz API.** Menu konta → **SMTP & API → API keys → Generate a new API key**. Skopiuj klucz (widać go tylko raz).
4. **GitHub: Settings → Secrets and variables → Actions.**

   | Rodzaj | Nazwa | Wartość |
   |---|---|---|
   | Secret | `BREVO_API_KEY` | klucz z kroku 3 |
   | Secret | `REPORT_FROM` | zweryfikowany adres nadawcy z kroku 2 (sam adres, np. `jan@gmail.com`) |
   | Secret | `REPORT_TO` | Twój adres (raport zbiorczy; kilka adresów po przecinku) |
   | Variable | `APP_URL` | adres panelu, np. `https://monitor.TWOJA-NAZWA.workers.dev` (bez ukośnika na końcu) |
   | Variable (opcjonalnie) | `REPORT_FROM_NAME` | nazwa nadawcy, np. `Monitor prawa` |

   `APP_URL` jest obowiązkowy: bez niego nikt poza Tobą nie dostanie wiadomości, bo w stopce musi być działający link do wypisania.
5. **Wiadomość próbna.** Actions → **Wiadomość próbna** → Run workflow. Na adres z `REPORT_TO` przyjdzie krótki mail. Sprawdź, czy jest w skrzynce odbiorczej, a nie w spamie.
6. **Odbiorcy.** W panelu: *Odbiorcy e-maili → Dodaj osobę*. Wpisz imię, adres, zaznacz role i datę oraz sposób wyrażenia zgody. Dodawaj tylko osoby, które same o to poprosiły.
7. Od następnego skanu zapisane osoby dostają wiadomości o zmianach w ich rolach. Osoba, której nic nie dotyczy, nie dostaje nic.

Co warto wiedzieć:
- Liczbę wysłanych i nieudanych wiadomości widać w logu skanu („Odbiorcy: wysłano … błędów …”). Awaria wysyłki do odbiorców **nie** psuje skanu ani raportu dla Ciebie.
- W logach nie zapisujemy adresów e-mail. Repozytorium jest publiczne, więc logi Actions też są, dlatego adresy odbiorców trzymamy wyłącznie w bazie Supabase, a nie w plikach ani w sekretach.
- Wiadomości z adresu `@gmail.com`, wysyłane przez usługę zewnętrzną, mogą na początku trafiać do spamu. Poproś odbiorców, żeby oznaczyli pierwszą wiadomość jako „nie spam”. Własna domena rozwiązuje to na stałe.
- Brevo jest jedyną obsługiwaną usługą wysyłki. Resend został usunięty: usuń sekret `RESEND_API_KEY`, jeśli jeszcze jest w repozytorium.

## Jak panel łączy się z silnikiem skanowania

Zmiany w zakładkach **Źródła**, **Priorytety i słowa kluczowe**, **Role** i **Ustawienia** zapisują się w bazie.
Silnik czyta je przy każdym skanie i stosuje zamiast ustawień z pliku `config/default.json`
(w logu skanu widać wtedy „Użyto ustawień z panelu admina”). Zmiany działają od następnego skanu.
Źródła i reguły dodane w przyszłych wersjach kodu pojawią się u Ciebie same.

## Rozwiązywanie problemów

| Objaw | Przyczyna i rozwiązanie |
|---|---|
| Ekran „Panel wymaga konfiguracji” | `web/config.js` jest pusty albo zawiera klucz tajny (krok 2). Otwórz `https://TWOJ-ADRES/config.js` w przeglądarce: jeśli wartości są puste, zmiana nie została jeszcze wdrożona (sprawdź zakładkę Deployments w Cloudflare) albo plik w repo jest nadpisany pustym |
| „Brak uprawnień” po zalogowaniu | konto nie jest na liście adminów (krok 1.5) |
| „Nie udało się rozpocząć konfiguracji 2FA” | TOTP wyłączone w Supabase (krok 1.4) |
| Panel otwiera się, ale „permission denied” | `panel.sql` nie został wykonany albo wykonany w innym projekcie (krok 1.1) |
| Zakładka „Odbiorcy e-maili” prosi o wykonanie skryptu | nie wykonano `supabase/recipients.sql` (krok 1 sekcji o Brevo) |
| Panel pusty, mimo że skany działają | w tabeli `changes` nie ma jeszcze wpisów: uruchom skan w Actions |
| Link pracownika pokazuje „nieważny” | link odwołany, wygasł albo skopiowany z błędem: utwórz nowy |

## Bezpieczeństwo w skrócie

- Dane w bazie widzi i zmienia tylko konto z listy `admins`, zalogowane z 2FA. Wymusza to sama baza (reguły RLS), a nie tylko strona.
- Pracownik z linku może wywołać wyłącznie jedną funkcję, która zwraca zadania jego roli. Nie ma dostępu do tabel.
- Tokeny linków mają 256 bitów losowości, a w bazie są przechowywane tylko jako skrót SHA-256.
- Panel ma nagłówek `noindex` i politykę CSP (plik `web/_headers`, działa na Cloudflare Pages i Netlify).
- Mimo to traktuj linki jak hasła i nie umieszczaj w systemie danych uczniów ani pracowników.
