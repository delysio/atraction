# Historia zmian

Wszystkie istotne zmiany w projekcie **ATRaction** są odnotowywane w tym pliku.

Układ wpisów opiera się na [Keep a Changelog](https://keepachangelog.com/pl/1.1.0/).
Projekt nie prowadzi numeracji wydań ani znaczników `git tag`, dlatego wpisy
oznaczone są datą publikacji w gałęzi `main`, wraz ze skróconym identyfikatorem
commita.

---

## 2026-08-14

### Poprawione

- Katalog Atari DOS 2, DOS 2.5 i MyDOS kończy się na pierwszym wpisie o
  statusie `$00`, tak jak u prawdziwego DOS-u. Wcześniej aplikacja czytała
  wszystkie 64 pozycje i pokazywała wpisy pozostałe po poprzedniej zawartości
  dyskietki jako istniejące pliki. Były to pliki widmowe: wskazywane przez nie
  sektory należą już do innych plików, więc odczyt zwracał cudze dane, a
  skasowanie takiego wpisu zwolniłoby w bitmapie VTOC sektory używane przez
  działający plik i przy kolejnym zapisie zniszczyłoby sprawny dysk. Walidacja
  alokacji tego nie wychwytywała, bo sektory widm są prawidłowo oznaczone jako
  zajęte przez swoich rzeczywistych właścicieli. Wpis skasowany (`$80`) nadal
  niczego nie kończy. Obrazem referencyjnym jest `MCP.atr`, na którym różnica
  wynosiła jedenaście widmowych wpisów i jeden nieistniejący katalog.
- Sektor katalogowy Atari DOS 2 mieści 8 wpisów także w gęstości podwójnej.
  Liczba wpisów była wyprowadzana z rozmiaru sektora, co na dyskach DD dawało
  16 slotów: czytnik widział widma w nieużywanej górnej połowie sektora, a
  zapis mógł umieścić tam plik, którego prawdziwy DOS nigdy by nie znalazł.
  MyDOS miał tę wartość ograniczoną poprawnie od początku.
- Rozpoznawanie MyDOS po obecności podkatalogu w katalogu głównym pomija wpisy
  za znacznikiem końca, więc pozostałość po poprzedniej zawartości dysku nie
  decyduje już o wyborze systemu plików.

### Uwaga dla użytkowników

Dyski, na których widoczne były wpisy za znacznikiem końca katalogu, pokażą
teraz mniej plików. To nie jest utrata danych: te pozycje nigdy nie były
widoczne na prawdziwym Atari i nie opisywały istniejących plików. Na zbiorze
227 obrazów testowych zmiana dotknęła 29 z nich, w tym 28 wyłącznie wpisów o
nazwach złożonych ze śmieci.

---

## 2026-08-13 — `9886a50`

### Dodane

- Obsługa systemu plików **CP/M 2.2 dla karty CP/M urządzenia Atari 1090** –
  dyskietki o sektorach 128-bajtowych, SD (720 sektorów) i MD (1040 sektorów).
  Odczyt, dodawanie i kasowanie plików, zmiana nazwy, atrybut Read-Only oraz
  formatowanie. Parametry geometrii (obszar systemowy w sektorach 1–78, katalog
  na 64 pozycje w sektorach 79–94, bloki po 1 KB liczące 8 sektorów, brak
  negacji bajtów) pochodzą z tablicy DPB w BIOS-ie karty. Liczbę bloków
  ogranicza limit ogłoszony przez DPB (`DSM = 118`), a nie rozmiar nośnika,
  dzięki czemu aplikacja nie przydziela bloku, którego nie wydałby prawdziwy
  system.
- Pozycja `CP/M 2.2 (Atari 1090 - SD / MD)` w oknie tworzenia nowego dysku.
  Tworzony dysk jest pusty i **niebootowalny** – aplikacja nie instaluje systemu
  CP/M. Formatowanie istniejącego dysku nie narusza sektorów 1–78, więc dysk
  systemowy zachowuje zdolność rozruchu.
- Sekcja 2.4.8 dokumentacji opisująca format wraz z pełnym rozpisaniem tablicy
  DPB oraz wiersz w tabeli kompatybilności geometrii.

### Zmienione

- Moduł `js/cpm.js` obsługuje oba warianty CP/M przez profile układu zamiast
  stałych zaszytych w kodzie; klasa `IndusCPM` nosi teraz nazwę `CPM`, ponieważ
  odpowiada za dwa różne urządzenia.
- Eksport nie wymusza już konwersji do XFD dla każdego dysku CP/M – robi to
  wyłącznie dla wariantu Indus GT. Obrazy 1090 są zwykłymi, bootowalnymi
  plikami ATR i takie pozostają przy zapisie.
- `THIRD-PARTY.txt` odnotowuje, że profil Atari 1090 nie pochodzi ze źródeł
  Altirry – emulator tego formatu nie obsługuje, a geometria została odczytana
  z BIOS-u samej karty.

### Znane ograniczenia

- Obsługiwane są wyłącznie nośniki 128-bajtowe. BIOS karty zawiera także tablice
  DPB dla dysków 256-bajtowych (`SPT = 36`, odpowiedniki DD i QD), ale bez obrazu
  referencyjnego nie sposób zweryfikować mapowania rekordów na sektory.
- Odczyt zmodyfikowanych dysków przez prawdziwą kartę 1090 nie został
  potwierdzony – wymagałoby to sprzętu, ponieważ nie istnieje emulator tego
  formatu.

---

## 2026-08-10 — `756fcd2`

### Poprawione

- Czytnik ATR zakładał bezwarunkowo, że obraz o sektorach 256 B ma trzy
  128-bajtowe sektory startowe. Format tego nie gwarantuje: sektory startowe
  bywają zapisane w pełnych slotach 256 B, a w rzadszym wariancie trzy po 128 B
  jeden za drugim. Przy błędnym założeniu każdy sektor od czwartego wzwyż
  przesuwał się o 384 B, przez co VTOC wypadał poza zasięg, a pliki stawały się
  nieczytelne. Warianty rozróżniane są teraz po liczbie paragrafów nagłówka,
  tak jak robi to Altirra.

---

## 2026-08-09 — `843309d`

### Zmienione

- Nagłówki modułów pochodnych podają zakresy praw autorskich Altirry osobno dla
  każdego pliku źródłowego. Wcześniej wszystkie sześć plików nosiło jeden zakres
  `2009-2015`, wzięty z `diskfsdos2.cpp`, co dla `atr.js`, `engine.js` i
  `cpm.js` było nieprawdziwe.

---

## 2026-08-09 — `a9f8300`

Pierwsze wydanie publiczne.

### Dodane

- Aplikacja **ATRaction** – menedżer obrazów dyskietek `.ATR` i `.XFD` dla
  komputerów Atari 8-bit, działający w całości po stronie przeglądarki, bez
  zewnętrznych bibliotek.
- Obsługa systemów plików: Atari DOS 2.0S/2.0D, DOS 2.5, DOS II+/D, MyDOS 4.5x,
  SpartaDOS (SDFS), LiteDOS-SE oraz CP/M 2.2 dla stacji Indus GT.
- Obsługa gęstości SD, MD/ED, DD, QD, DS/QD oraz geometrii niestandardowej;
  tworzenie nowych dysków wraz z instalacją plików systemowych.
- Walidacja spójności alokacji z trybem tylko do odczytu, dwujęzyczny interfejs
  (polski i angielski) oraz wbudowana instrukcja użytkownika.
- Publikacja na licencji **GPL-2.0-or-later**, wynikającej z tego, że część kodu
  obsługującego formaty dysków powstała na podstawie źródeł biblioteki ATIO
  emulatora Altirra. Zakres zapożyczeń, plik po pliku, opisuje
  [THIRD-PARTY.txt](THIRD-PARTY.txt).

  Wyjątkiem jest `js/dos_templates.js`, zawierający dosłowne kopie sektorów
  startowych i plików systemowych cudzych DOS-ów – nie są one objęte GPL.
