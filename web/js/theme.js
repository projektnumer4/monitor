// Motyw ustawiany przed renderem, żeby uniknąć błysku (osobny plik, bo CSP nie dopuszcza skryptów inline).
try { var t = localStorage.getItem('theme'); if (t) document.documentElement.dataset.theme = t; } catch (e) { /* brak dostępu do localStorage */ }
