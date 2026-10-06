# Monitor prawa oświatowego: silnik skanowania

Raz dziennie (wieczorem) pobiera nowe akty prawne, wybiera te, które dotyczą placówki, analizuje je przez AI,
nadaje priorytet (wysoki/średni/niski), przypisuje zadania rolom i wysyła **jeden raport e-mail**.
Działa jako zaplanowane zadanie GitHub Actions, bez własnego serwera.

```
GitHub Actions (cron) -> źródła -> filtr słów kluczowych -> analiza AI -> reguły priorytetu
                      -> zapis w Supabase -> raport e-mail (Brevo)
```

## Panel admina
Folder `web/` to panel z logowaniem (hasło + 2FA) i widokiem dla pracowników z linków. Instrukcja uruchomienia: `SETUP-PANEL.md`.

## Wiadomości do odbiorców
Oprócz raportu dla admina silnik wysyła osobne wiadomości do osób, które dobrowolnie zapisano w panelu (zakładka Odbiorcy e-maili). Każdy dostaje tylko zmiany i zadania swojej roli oraz link „Wypisz mnie”. Wysyłka: Brevo (`BREVO_API_KEY`). Konfiguracja: `SETUP-PANEL.md`.

## Szkice dokumentów
1. W panelu (Dokumenty szkoły) wgrywasz tekst statutu i procedur (.docx, .txt, .md albo wklejony tekst). **Bez danych osobowych.**
2. Gdy skan wykryje zmianę prawa, która wymaga zmiany takiego dokumentu, silnik prosi model o propozycje zmian.
   Każdy cytowany fragment dokumentu jest sprawdzany w prawdziwym tekście: propozycje, których nie da się odnaleźć dokładnie raz, są oznaczane jako „do ręcznego wstawienia” i nie trafiają do pliku.
3. W panelu (Szkice dokumentów) przyjmujesz lub odrzucasz każdą zmianę i pobierasz Word ze zmianami śledzonymi (w:ins / w:del) albo tekst po zmianach.
4. Szkice powstają automatycznie przy dziennym skanie (domyślnie dla zmian o priorytecie wysokim i średnim, nie dla projektów aktów; max 6 na przebieg, ustawienia w `drafts` w konfiguracji).
   Prośbę o szkic możesz zgłosić ręcznie w panelu, a przyspieszyć ją workflow **Szkice dokumentów** w Actions.

Wymaga trybu `gemini` lub `claude` (tryb `rules` nie generuje szkiców). Plik Word ze szkicem to **tekstowa wersja dokumentu** ze śledzonymi zmianami:
nie zachowuje formatowania oryginału (style, numeracja automatyczna, tabele), więc traktuj go jako materiał do przeniesienia zmian do oryginalnego pliku.

## Źródła

| Źródło | Co daje | Jak | Wiarygodność |
|---|---|---|---|
| Dziennik Ustaw, Monitor Polski | obowiązujące akty ogólnopolskie | oficjalne API ELI Sejmu | oficjalne API |
| Sejm: druki | projekty ustaw (wczesny sygnał) | oficjalne API Sejmu | oficjalne API |
| RCL | projekty rozporządzeń i ustaw na etapie rządowym (najwcześniejszy sygnał) | czytanie stron HTML (brak API) | **eksperymentalne**: przy zmianie układu strony źródło zgłosi błąd w raporcie |
| Dziennik Urzędowy Woj. Mazowieckiego | uchwały organu prowadzącego, akty wojewody i sejmiku | API dziennika zgodne z ELI, zawężone do `scope` | oficjalne API, **struktura odpowiedzi niezweryfikowana na żywo** |
| Kuratorium Oświaty (komunikaty, na skróty) | komunikaty i wytyczne kuratora | oficjalne kanały RSS kuratorium | kanały podane na stronie kuratorium |
| MEN (komunikaty, wiadomości) | komunikaty ministerstwa | kanały RSS **zewnętrznego serwisu** `rss.mtsz.pl` | nieoficjalne |
| BIP Urzędu Miasta Ostrołęki | uchwały, projekty uchwał, zarządzenia Prezydenta | oficjalny kanał RSS + temat ze strony zarządzenia | kanał potwierdzony; wyciąganie tematu zależy od układu strony |

Ustawa zmieniająca „niektóre inne ustawy” często nie ma w tytule nic o oświacie. Dlatego silnik sprawdza też,
czy akt **zmienia któryś z aktów obserwowanych** (`watchedActs`: Prawo oświatowe, Karta Nauczyciela itd.).
Dotyczy to Dziennika Ustaw. Druki sejmowe i projekty RCL są oceniane po tytule, więc ogólny tytuł może je ukryć.

### Organ prowadzący: Miasto Ostrołęka
- **BIP Urzędu Miasta Ostrołęki** (`https://bip.um.ostroleka.pl/rss`): oficjalny kanał RSS ze wszystkimi nowymi uchwałami, projektami uchwał na sesje i zarządzeniami Prezydenta.
  Kanał podaje dla zarządzeń tylko numer, więc silnik pobiera ze strony zarządzenia jego temat („w sprawie”) i dopiero wtedy ocenia trafność (`detailWhenEmpty`).
- **Dziennik Urzędowy Woj. Mazowieckiego**: w `scope` są terminy, które muszą wystąpić w tytule aktu
  (`ostrołęk`, `w ostrołęce`, wojewoda mazowiecki, sejmik, kurator oświaty). Dziennik zawiera uchwały wszystkich gmin województwa,
  więc bez zawężenia raport byłby zalany. Ta sama uchwała może pojawić się dwa razy: w BIP (jako projekt lub uchwała)
  i w Dzienniku (publikacja, od której liczy się wejście w życie). To zamierzone.
- Dla innych stron bez RSS jest typ źródła `links` (lista linków ze strony, z inicjalizacją przy pierwszym skanie).

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

### 3. Brevo (e-mail)
Załóż konto na brevo.com (plan Free), dodaj i potwierdź adres nadawcy (Senders) oraz wygeneruj klucz API. Szczegóły: `SETUP-PANEL.md`.

### 4. GitHub
Repozytorium **prywatne**. Settings -> Secrets and variables -> Actions:

| Typ | Nazwa | Wartość |
|---|---|---|
| Secret | `ANTHROPIC_API_KEY` | klucz z console.anthropic.com |
| Secret | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | z kroku 2 |
| Secret | `BREVO_API_KEY`, `REPORT_FROM`, `REPORT_TO` | z kroku 3 (`REPORT_TO` może zawierać kilka adresów po przecinku) |
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

Sprawdzone testami (`npm test`, 108 testów, w tym panelu w symulowanej przeglądarce): straż czasu w lecie i zimie, filtr, reguły priorytetów, parsowanie ELI i RSS,
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
- Panel admina i linki dla pracowników: zob. `SETUP-PANEL.md`.
