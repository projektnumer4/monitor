# Monitor prawa oświatowego: silnik skanowania

Raz dziennie (wieczorem) pobiera nowe akty prawne, wybiera te, które dotyczą placówki, analizuje je przez AI,
nadaje priorytet (wysoki/średni/niski), przypisuje zadania rolom i wysyła **jeden raport e-mail**.
Działa jako zaplanowane zadanie GitHub Actions, bez własnego serwera.

```
GitHub Actions (cron) -> źródła -> filtr słów kluczowych -> analiza AI -> reguły priorytetu
                      -> zapis w Supabase -> raport e-mail (Resend)
```

## Źródła w tej wersji

| Źródło | Jak | Uwagi |
|---|---|---|
| Dziennik Ustaw | API ELI Sejmu (`api.sejm.gov.pl/eli`) | oficjalne, dokumentacja publiczna |
| Monitor Polski | to samo API | |
| MEN: komunikaty i wiadomości | kanał RSS | adresy wskazują kanały utrzymywane przez **zewnętrzny serwis** (`rss.mtsz.pl`), nie przez MEN. Jeśli przestaną działać, zamień URL w `config/default.json` |

Ustawa zmieniająca „niektóre inne ustawy” często nie ma w tytule nic o oświacie. Dlatego silnik sprawdza też,
czy akt **zmienia któryś z aktów obserwowanych** (`watchedActs`: Prawo oświatowe, Karta Nauczyciela itd.).

## Uruchomienie krok po kroku

### 1. Test lokalny (bez internetu, bez kluczy)
```bash
npm install
npm test
npm run dry-run          # dane testowe + analizator próbny; raport w out/report.html
```
W trybie próbnym nic się nie wysyła ani nie zapisuje w Supabase. Analizator próbny (`--mock-ai`) **nie jest AI**, to tylko
pokaz działania potoku.

### 2. Supabase
1. Utwórz projekt, region **Frankfurt (UE)**.
2. SQL Editor -> wklej `supabase/schema.sql` -> Run.
3. Settings -> API: skopiuj **Project URL** i klucz **service_role** (nigdy nie wklejaj go do kodu ani do frontendu).

### 3. Resend (e-mail)
Utwórz konto, wygeneruj klucz API. Bez zweryfikowanej własnej domeny Resend zwykle pozwala wysyłać tylko na adres konta,
więc do rozsyłki do kilku osób zweryfikuj domenę.

### 4. GitHub
Repozytorium **prywatne**. Settings -> Secrets and variables -> Actions:

| Typ | Nazwa | Wartość |
|---|---|---|
| Secret | `ANTHROPIC_API_KEY` | klucz z console.anthropic.com |
| Secret | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | z kroku 2 |
| Secret | `RESEND_API_KEY`, `REPORT_FROM`, `REPORT_TO` | z kroku 3 (`REPORT_TO` może zawierać kilka adresów po przecinku) |
| Variable | `ANTHROPIC_MODEL` | opcjonalnie, domyślnie `claude-sonnet-5-5` (taniej: `claude-haiku-4-5-20251001`) |
| Variable | `APP_URL` | opcjonalnie, adres panelu (linki w raporcie) |

### 5. Sprawdź konfigurację i pierwszy skan
W GitHubie: Actions -> „Sprawdzenie konfiguracji” -> **Run workflow** (lokalnie: `npm run verify`).
Wypisze, czy klucze są ustawione, czy akty obserwowane mają oczekiwane tytuły i ile pozycji zwracają źródła.
Potem w GitHubie: Actions -> „Dzienny skan prawa” -> **Run workflow**. Pierwszy skan obejmuje ostatnie 7 dni
(`schedule.lookbackDays`), więc raport może być dłuższy niż zwykle.

## Analiza AI: trzy tryby (wybierasz zmienną `AI_PROVIDER`)

| `AI_PROVIDER` | Koszt | Co potrzeba | Jakość |
|---|---|---|---|
| `gemini` | darmowy poziom Google AI Studio (bez karty) | sekret `GEMINI_API_KEY` | pełne streszczenia i przypisania ról |
| `claude` | płatny (grosze za akt) | sekret `ANTHROPIC_API_KEY` z konsoli API i saldo | pełne streszczenia i przypisania ról |
| `rules` | 0 zł, bez żadnego klucza | nic | tylko dopasowanie słów kluczowych i terminy z metadanych, bez streszczeń |

Gdy `AI_PROVIDER` jest puste, silnik wybiera sam: Gemini (jeśli jest klucz), potem Claude, na końcu `rules`.
Model Gemini zmienisz zmienną `GEMINI_MODEL` (domyślnie `gemini-3.5-flash`). Nie włączaj płatności w Google Cloud:
bez niej przekroczenie darmowego limitu kończy się błędem 429, nie opłatą.
Darmowy poziom Google może wykorzystywać wysyłane treści do ulepszania produktów, dlatego do analizy trafiają wyłącznie
publiczne akty prawne, nigdy dokumenty szkoły ani dane osób.

## Jak to się układa w czasie

Workflow ma dwa wpisy cron w UTC (15:30 i 16:30). Skrypt sprawdza czas w `Europe/Warsaw`, uruchamia się tylko w oknie
17:00-19:59 i tylko raz dziennie, więc raport przychodzi wieczorem przez cały rok, także po zmianie czasu.
Zadania GitHuba mogą się opóźniać, co w oknie kilku godzin nie ma znaczenia.

## Konfiguracja (`config/default.json`)

`school.profile` (opis placówki dla AI), `keywords`, `watchedActs`, `roles`, `documents`, `rules` (priorytety),
`sources`, `schedule`. Panel admina będzie później edytował te same dane w bazie.
**Sprawdź i dopasuj `school.profile`, `roles` i `documents` do rzeczywistej placówki.** To one decydują, komu i co system przypisze.

## Co jest sprawdzone, a co nie

Sprawdzone testami (`npm test`, 42 testy): straż czasu w lecie i zimie, filtr, reguły priorytetów, parsowanie ELI i RSS,
odporność na awarię źródła, idempotencja (dwa uruchomienia w tym samym dniu), ponowienie po nieudanej wysyłce,
kształt żądania do API Claude, escapowanie treści w e-mailu.

**Nie sprawdzone na żywo** (środowisko, w którym powstał kod, nie miało dostępu do tych serwisów):
- rzeczywiste odpowiedzi API ELI i kanałów RSS: struktura odpowiedzi jest zgodna z dokumentacją, ale uruchom `npm run verify`,
- parametry stronicowania listy aktów w ELI (kod jest zabezpieczony przed zapętleniem),
- identyfikatory aktów obserwowanych (`DU/2017/59` itd.): `verify` pokaże ich tytuły, porównaj je ręcznie,
- jakość analizy AI na prawdziwych aktach: przez pierwsze tygodnie czytaj streszczenia krytycznie.

## Znane ograniczenia

- Ustawa o bardzo długim tekście jest obcinana do ok. 70 tys. znaków (raport zaznacza to w „Do sprawdzenia”).
- Akty bez słów kluczowych w tytule i bez odwołania do aktów obserwowanych mogą zostać pominięte.
  Rozszerzaj `keywords` i `watchedActs`, gdy zauważysz lukę.
- Nie ma jeszcze: RCL (projekty), Kuratorium, BIP organu prowadzącego, generowania szkiców dokumentów, panelu i linków.
