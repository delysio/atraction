/*
 * ATRaction - Atari 8-bit ATR/XFD disk image manager
 * Copyright (C) 2026 dely / blowjobb / ng
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 *
 * This program is free software; you can redistribute it and/or modify it under
 * the terms of the GNU General Public License as published by the Free Software
 * Foundation; either version 2 of the License, or (at your option) any later
 * version. This program is distributed WITHOUT ANY WARRANTY; without even the
 * implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
 * See the LICENSE.txt file in the project root for the full text.
 */

/**
 * Minimal PL/EN translation layer for ATRaction.
 *
 * Design: every user-facing string in the engine and UI code stays written in
 * Polish, in place, exactly as before - Polish remains the single source of
 * truth. Instead of using it directly, code wraps it with T(text, ...args),
 * which looks the (whitespace-normalized) Polish text up in EN_DICT and
 * returns the English version when the UI language is 'en', or the original
 * Polish text unchanged otherwise (including when i18n.js is not loaded at
 * all, via the tiny fallback shim each engine file carries). This keeps a
 * single dictionary instead of a separate key namespace, so nothing needs
 * renaming and the source stays readable.
 *
 * Placeholders {0}, {1}, ... in the Polish text are substituted with the
 * extra T() arguments *after* the dictionary lookup, so the EN template must
 * reuse the same slots.
 *
 * Static DOM text is handled the same way via data-i18n / data-i18n-html /
 * data-i18n-title / data-i18n-placeholder attributes: applyStaticTranslations()
 * caches each element's original (Polish) content once, then re-derives the
 * displayed text from that cached original every time the language changes,
 * so repeated toggles never re-translate already-translated text.
 *
 * Two rules when adding entries:
 *  - the key is what the *DOM* returns, not what the HTML source spells. Character
 *    entities are already decoded there (&ndash; -> the dash itself), but
 *    innerHTML re-escapes & < >, so a data-i18n-html key must keep &amp;.
 *  - an element that JS overwrites at runtime still needs its static Polish
 *    default listed here, otherwise switching language before that code runs
 *    leaves the untranslated original on screen.
 */

var ATRACTION_LANG = (function () {
    try {
        var saved = window.localStorage.getItem('atraction_lang');
        return saved === 'en' ? 'en' : 'pl';
    } catch (e) {
        return 'pl';
    }
})();

function getLang() {
    return ATRACTION_LANG;
}

function setLang(lang) {
    ATRACTION_LANG = (lang === 'en') ? 'en' : 'pl';
    try { window.localStorage.setItem('atraction_lang', ATRACTION_LANG); } catch (e) { /* ignore (private mode etc.) */ }
}

/**
 * Collapses whitespace the way HTML rendering already does, so dictionary
 * keys don't have to reproduce the exact indentation of the HTML source.
 * @param {string} s
 * @returns {string}
 */
function normalizeI18nKey(s) {
    return String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
}

/**
 * Polish text (normalized) -> English text.
 * Section 1: engine-layer messages (thrown errors, validation notices,
 * checkFormatSupport reasons) from js/atr.js, dos2.js, mydos.js,
 * spartados.js, litedos.js, cpm.js, engine.js.
 */
var EN_DICT = {
    "Atari DOS 2.0S obsługuje wyłącznie dyski SD (720 sektorów).": "Atari DOS 2.0S only supports SD disks (720 sectors).",
    "Atari DOS 2.0S obsługuje wyłącznie sektory 128-bajtowe (SD).": "Atari DOS 2.0S only supports 128-byte sectors (SD).",
    "Atari DOS 2.0S wymaga 3 sektorów startowych.": "Atari DOS 2.0S requires 3 boot sectors.",
    "Atari DOS 2.5 obsługuje wyłącznie dyski SD (720) lub MD (1040 sektorów).": "Atari DOS 2.5 only supports SD (720) or MD (1040 sectors) disks.",
    "Atari DOS 2.5 obsługuje wyłącznie sektory 128-bajtowe.": "Atari DOS 2.5 only supports 128-byte sectors.",
    "Atari DOS 2.5 wymaga 3 sektorów startowych.": "Atari DOS 2.5 requires 3 boot sectors.",
    "Blokowanie plików nie jest obsługiwane dla DOS ({0}).": "Locking files is not supported for DOS ({0}).",
    "Brak 8 kolejnych wolnych sektorów wymaganych przez podkatalog MyDOS.": "No 8 consecutive free sectors available, as required by a MyDOS subdirectory.",
    "Brak miejsca na dysku SpartaDOS. Wymagane: 2 sektory, Dostępne: {0}": "Not enough space on the SpartaDOS disk. Required: 2 sectors, Available: {0}",
    "Brak miejsca na dysku SpartaDOS. Wymagane: {0} sektorów, Dostępne: {1}": "Not enough space on the SpartaDOS disk. Required: {0} sectors, Available: {1}",
    "Brak miejsca w obrazie MyDOS. Wymagane: 8 sektorów, Dostępne: {0}": "Not enough space on the MyDOS image. Required: 8 sectors, Available: {0}",
    "Brak miejsca w obrazie MyDOS. Wymagane: {0} sektorów, Dostępne: {1}": "Not enough space on the MyDOS image. Required: {0} sectors, Available: {1}",
    "Brak wczytanego obrazu ATR.": "No ATR image loaded.",
    "Brak wolnego miejsca na dysku CP/M 2.2. Wymagane bloki: {0}, wolne: {1}.": "Not enough free space on the CP/M 2.2 disk. Required blocks: {0}, free: {1}.",
    "Brak wolnego miejsca na dysku LiteDOS. Wymagane: {0} sektorów, Dostępne: {1}": "Not enough free space on the LiteDOS disk. Required: {0} sectors, Available: {1}",
    "Brak wolnego miejsca na dysku. Wymagane: {0} sektorów, Dostępne: {1}": "Not enough free space on the disk. Required: {0} sectors, Available: {1}",
    "Błędna bitmapa alokacji w LiteDOS: zajęte sektory są oznaczone jako wolne w VTOC. Obraz zamontowano w trybie tylko do odczytu.": "Invalid LiteDOS allocation bitmap: sectors in use are marked free in the VTOC. The image has been mounted read-only.",
    "Błędna bitmapa alokacji w VTOC (brak wolnych sektorów w bitmapie mimo wolnej przestrzeni). Obraz zamontowano w trybie tylko do odczytu (read-only), aby zapobiec uszkodzeniu danych.": "Invalid VTOC allocation bitmap (no free sectors in the bitmap despite free space being reported). The image has been mounted read-only to prevent data corruption.",
    "Błędna bitmapa alokacji: zajęte sektory są oznaczone jako wolne w VTOC. Obraz zamontowano w trybie tylko do odczytu (read-only), aby zapobiec uszkodzeniu danych.": "Invalid allocation bitmap: sectors in use are marked free in the VTOC. The image has been mounted read-only to prevent data corruption.",
    "Błędna mapa bitowa SpartaDOS: sektory zajęte przez pliki są oznaczone jako wolne. Obraz zamontowano w trybie tylko do odczytu (read-only), aby zapobiec uszkodzeniu danych.": "Invalid SpartaDOS bitmap: sectors used by files are marked free. The image has been mounted read-only to prevent data corruption.",
    "CP/M 2.2 (Atari 1090) obsługuje od {0} do {1} sektorów.": "CP/M 2.2 (Atari 1090) supports {0} to {1} sectors.",
    "CP/M 2.2 (Atari 1090) wymaga sektorów 128-bajtowych.": "CP/M 2.2 (Atari 1090) requires 128-byte sectors.",
    "CP/M 2.2 (Indus GT) obsługuje od 64 do 1068 sektorów.": "CP/M 2.2 (Indus GT) supports 64 to 1068 sectors.",
    "CP/M 2.2 (Indus GT) wymaga sektorów 256-bajtowych.": "CP/M 2.2 (Indus GT) requires 256-byte sectors.",
    "Custom ({0} Sektorów, {1}B)": "Custom ({0} Sectors, {1}B)",
    "DOS II+/D obsługuje sektory 128 lub 256 bajtów.": "DOS II+/D supports 128 or 256-byte sectors.",
    "DOS II+/D obsługuje wyłącznie 720 lub 1040 sektorów.": "DOS II+/D only supports 720 or 1040 sectors.",
    "DOS II+/D wymaga 3 sektorów startowych.": "DOS II+/D requires 3 boot sectors.",
    "Dysk 1040-sektorowy (ED) wymaga sektorów 128-bajtowych.": "A 1040-sector disk (ED) requires 128-byte sectors.",
    "Dysk pełny: brak wolnych sektorów.": "Disk full: no free sectors.",
    "Dysk pełny: wyczerpano bitmapę sektorów.": "Disk full: the sector bitmap is exhausted.",
    "Edycja atrybutów A H P nie jest obsługiwana dla {0}.": "Editing A H P attributes is not supported for {0}.",
    "Katalog dysku CP/M 2.2 jest pełny (brak wolnych wpisów).": "The CP/M 2.2 disk directory is full (no free entries).",
    "Katalog dysku LiteDOS jest pełny.": "The LiteDOS disk directory is full.",
    "Katalog jest pełny (maksymalnie {0} pozycji).": "The directory is full (maximum {0} entries).",
    "Katalog jest pełny. Maksymalna liczba plików to {0}.": "The directory is full. The maximum number of files is {0}.",
    "Katalog nadrzędny jest pełny (maksymalnie {0} pozycji).": "The parent directory is full (maximum {0} entries).",
    "Liczba sektorów musi mieścić się w zakresie {0}..65535.": "The sector count must be in the range {0}..65535.",
    "Moduł odczytu DOS nie jest dostępny.": "The DOS read module is not available.",
    "MyDOS obsługuje sektory 128 lub 256 bajtów.": "MyDOS supports 128 or 256-byte sectors.",
    "MyDOS wymaga 3 sektorów startowych.": "MyDOS requires 3 boot sectors.",
    "MyDOS wymaga co najmniej 720 sektorów.": "MyDOS requires at least 720 sectors.",
    "Nie udało się przydzielić klastrów w LiteDOS.": "Could not allocate clusters in LiteDOS.",
    "Nie udało się przydzielić sektorów na dysku (dysk jest pełny lub zfragmentowany).": "Could not allocate sectors on the disk (the disk is full or fragmented).",
    "Nie udało się przydzielić sektorów.": "Could not allocate sectors.",
    "Nie udało się w pełni przejść drzewa katalogów SpartaDOS podczas weryfikacji alokacji.": "Could not fully traverse the SpartaDOS directory tree while verifying allocation.",
    "Nie znaleziono sektora katalogu.": "Directory sector not found.",
    "Nieprawidłowe dane ATR: Rozmiar pliku wynosi mniej niż 16 bajtów.": "Invalid ATR data: the file is smaller than 16 bytes.",
    "Nieprawidłowy nagłówek magiczny ATR/XFD: 0x{0}. Oczekiwano 0x0296 (lub pliku XFD).": "Invalid ATR/XFD magic header: 0x{0}. Expected 0x0296 (or an XFD file).",
    "Nieprawidłowy obiekt pliku CP/M.": "Invalid CP/M file object.",
    "Nieprawidłowy obiekt pliku do usunięcia.": "Invalid file object to delete.",
    "Nieprawidłowy obiekt pliku do zmiany nazwy.": "Invalid file object to rename.",
    "Nieprawidłowy obiekt pliku.": "Invalid file object.",
    "Nieprawidłowy sektor mapy katalogu docelowego.": "Invalid target directory map sector.",
    "Niespójny licznik wolnych sektorów SpartaDOS (blok boot: {0}, mapa bitowa: {1}). Obraz zamontowano w trybie tylko do odczytu (read-only).": "Inconsistent SpartaDOS free sector count (boot block: {0}, bitmap: {1}). The image has been mounted read-only.",
    "Niestandardowa gęstość dysku ({0} sektorów). Modyfikowanie plików może dać nieprzewidziane efekty.": "Non-standard disk density ({0} sectors). Modifying files may have unpredictable effects.",
    "Niestandardowe parametry dysku (odczytane wolne sektory wykraczają poza pojemność). Zachowaj ostrożność.": "Non-standard disk parameters (the reported free sectors exceed the disk capacity). Proceed with caution.",
    "Niestandardowy rozmiar obrazu dysku ({0} sektorów, rozmiar pliku: {1} B, oczekiwano: {2} B dla {3}). Modyfikowanie plików na tym obrazie może doprowadzić do uszkodzenia danych.": "Non-standard disk image size ({0} sectors, file size: {1} B, expected: {2} B for {3}). Modifying files on this image may corrupt the data.",
    "Obraz dysku jest zbyt mały dla CP/M 2.2 (wymagane min. {0} sektorów).": "The disk image is too small for CP/M 2.2 (at least {0} sectors required).",
    "Obraz jest zamontowany w trybie tylko do odczytu (Read-Only) z powodu błędów w alokacji dysku.": "The image is mounted read-only because of disk allocation errors.",
    "Obraz jest zamontowany w trybie tylko do odczytu.": "The image is mounted read-only.",
    "Obraz jest zbyt mały do sformatowania w CP/M 2.2.": "The image is too small to format as CP/M 2.2.",
    "Operacje zapisu nie są obsługiwane dla wykrytego DOS ({0}).": "Write operations are not supported for the detected DOS ({0}).",
    "Plik '{0}' jest zablokowany (Read-Only).": "File '{0}' is locked (Read-Only).",
    "Plik '{0}' jest zablokowany (Tylko do odczytu). Odblokuj go najpierw.": "File '{0}' is locked (Read-Only). Unlock it first.",
    "Plik '{0}' jest zablokowany.": "File '{0}' is locked.",
    "Plik '{0}' jest zablokowany. Odblokuj go najpierw.": "File '{0}' is locked. Unlock it first.",
    "Plik '{0}' już istnieje na dysku.": "File '{0}' already exists on the disk.",
    "Plik '{0}' już istnieje w tym katalogu.": "File '{0}' already exists in this directory.",
    "Plik lub katalog '{0}' już istnieje w tym katalogu.": "File or directory '{0}' already exists in this directory.",
    "Plik {0} istnieje i jest zabezpieczony przed zapisem.": "File {0} already exists and is write-protected.",
    "Plik {0} jest zabezpieczony przed zapisem.": "File {0} is write-protected.",
    "Rozmiar klastra {0} jest za mały dla {1} sektorów: bitmapa LiteDOS mieści {2} klastrów.": "Cluster size {0} is too small for {1} sectors: the LiteDOS bitmap holds {2} clusters.",
    "Rozmiar sektora musi wynosić 128, 256 lub 512 bajtów.": "The sector size must be 128, 256 or 512 bytes.",
    "Sektor poza zakresem: {0} (Dopuszczalne: 1..{1})": "Sector out of range: {0} (Allowed: 1..{1})",
    "SpartaDOS wymaga co najmniej 16 sektorów.": "SpartaDOS requires at least 16 sectors.",
    "System plików CP/M 2.2 nie obsługuje podkatalogów.": "The CP/M 2.2 filesystem does not support subdirectories.",
    "Tworzenie nowych obrazów LiteDOS nie jest obsługiwane.": "Creating new LiteDOS images is not supported.",
    "Tworzenie nowych obrazów w formacie LiteDOS nie jest obsługiwane. Aplikacja jedynie odczytuje, modyfikuje i formatuje istniejące dyski LiteDOS.": "Creating new LiteDOS images is not supported. The application only reads, modifies and formats existing LiteDOS disks.",
    "Tworzenie podkatalogów nie jest obsługiwane dla DOS ({0}).": "Creating subdirectories is not supported for DOS ({0}).",
    "Usuwanie plików nie jest obsługiwane dla DOS ({0}).": "Deleting files is not supported for DOS ({0}).",
    "Uszkodzony katalog CP/M: {0} bloków jest przypisanych do więcej niż jednego pliku. Obraz zamontowano w trybie tylko do odczytu, aby zapobiec utracie danych.": "Corrupted CP/M directory: {0} blocks are assigned to more than one file. The image has been mounted read-only to prevent data loss.",
    "Uszkodzony katalog CP/M: {0} wpisów wskazuje bloki poza obszarem danych dysku. Obraz zamontowano w trybie tylko do odczytu.": "Corrupted CP/M directory: {0} entries point to blocks outside the disk's data area. The image has been mounted read-only.",
    "Uwaga: bitmapa alokacji w LiteDOS zawiera {0} zagubionych klastrów (oznaczonych jako zajęte, choć żaden plik ich nie używa).": "Warning: the LiteDOS allocation bitmap contains {0} lost clusters (marked in use although no file references them).",
    "Uwaga: bitmapa alokacji w VTOC zawiera zagubione sektory (oznaczone jako zajęte, choć żaden plik ich nie używa).": "Warning: the VTOC allocation bitmap contains lost sectors (marked in use although no file references them).",
    "Uwaga: licznik wolnych sektorów LiteDOS ({0}) nie zgadza się z bitmapą ({1}).": "Warning: the LiteDOS free sector count ({0}) does not match the bitmap ({1}).",
    "Uwaga: mapa bitowa SpartaDOS zawiera {0} zagubionych sektorów (oznaczone jako zajęte, choć żaden plik ich nie używa).": "Warning: the SpartaDOS bitmap contains {0} lost sectors (marked in use although no file references them).",
    "Zmiana nazwy nie jest obsługiwana dla DOS ({0}).": "Renaming is not supported for DOS ({0}).",

    /**
     * Section 2: static UI text tagged in index.html (data-i18n / data-i18n-html /
     * data-i18n-title / data-i18n-placeholder). Keys are exactly what
     * applyStaticTranslations() computes at runtime: entities such as &ndash;
     * and &times; are already decoded to their literal Unicode characters
     * (–, ×) by the browser, and whitespace is collapsed to single spaces.
     */
    "Brak otwartego obrazu ATR": "No ATR image open",
    "DYSK:": "DISK:",
    "Brak Obrazu": "No Image",
    "Utwórz nowy obraz ATR": "Create a new ATR image",
    "Nowy ATR": "New ATR",
    "Otwórz plik .ATR z dysku": "Open an .ATR file from disk",
    "Otwórz ATR": "Open ATR",
    "Eksportuj/Pobierz zmodyfikowany plik ATR": "Export/Download the modified ATR file",
    "Zapisz ATR": "Save ATR",
    "Sformatuj dysk": "Format the disk",
    "Formatuj": "Format",
    "Instrukcja obsługi i podręcznik użytkownika": "User guide and manual",
    "Instrukcja": "Guide",
    "Parametry Dysku": "Disk Parameters",
    "Gęstość:": "Density:",
    "Sektory ogółem:": "Total sectors:",
    "Wolne sektory:": "Free sectors:",
    "Wolne miejsce:": "Free space:",
    "Zajętość dysku": "Disk usage",
    "Struktura Katalogów": "Directory Tree",
    "Dodaj plik z komputera": "Add a file from your computer",
    "Dodaj Plik": "Add File",
    "Utwórz nowy podkatalog (MyDOS / SpartaDOS)": "Create a new subdirectory (MyDOS / SpartaDOS)",
    "Nowy Katalog": "New Directory",
    "Eksportuj wybrany plik": "Export the selected file",
    "Pobierz Plik": "Extract File",
    "Pobierz zaznaczone pozycje w jednym archiwum ZIP": "Download the marked entries in a single ZIP archive",
    "Pobierz ZIP": "Download ZIP",
    "Zmień nazwę pliku": "Rename the file",
    "Zmień Nazwę": "Rename",
    "Zablokuj / Odblokuj plik": "Lock / Unlock the file",
    "Zablokuj/Odblokuj": "Lock/Unlock",
    "Ustaw atrybuty pliku lub wszystkich zaznaczonych plików": "Set attributes of the file or of every marked file",
    "Atrybuty": "Attributes",
    "Usuń plik z obrazu": "Delete the file from the image",
    "Usuń": "Delete",
    "Podgląd ATASCII / Podgląd Hex": "ATASCII preview / Hex preview",
    "Podgląd / Hex": "Preview / Hex",
    "Wyświetl katalog w trybie ATASCII": "Show the directory in ATASCII mode",
    "Katalog ATASCII": "ATASCII Directory",
    "Szukaj pliku...": "Search for a file...",
    "Zaznacz lub odznacz wszystkie widoczne pozycje": "Mark or unmark every visible entry",
    "Nazwa Pliku": "File Name",
    "Sektory": "Sectors",
    "Rozmiar (B)": "Size (B)",
    "Sektor Start": "Start Sector",
    "Akcje": "Actions",
    "Brak wczytanego obrazu ATR lub katalog jest pusty.": "No ATR image loaded, or the directory is empty.",
    "Przeciągnij i upuść plik .ATR tutaj lub kliknij \"Otwórz ATR\".": "Drag and drop an .ATR file here, or click \"Open ATR\".",
    "Upuść plik ATR lub plik do importu": "Drop an ATR image or a file to import",
    "Gotowy.": "Ready.",
    "ATRaction :: dely / blowjobb / ng :: apka powstała z udziałem LLM. :: <a href=\"LICENSE.txt\" target=\"_blank\" rel=\"noopener\" style=\"color: var(--color-primary);\">GPL-2.0-or-later</a>":
        "ATRaction :: dely / blowjobb / ng :: an app built with the help of an LLM. :: <a href=\"LICENSE.txt\" target=\"_blank\" rel=\"noopener\" style=\"color: var(--color-primary);\">GPL-2.0-or-later</a>",
    "Tworzenie Nowego Obrazu ATR": "Creating a New ATR Image",
    "System Plików / DOS:": "File System / DOS:",
    "Atari DOS 2.0S (SD)": "Atari DOS 2.0S (SD)",
    "Atari DOS 2.5 (SD / MD)": "Atari DOS 2.5 (SD / MD)",
    "DOS II+/D (SD / MD / DD)": "DOS II+/D (SD / MD / DD)",
    "MyDOS 4.5x (SD / MD / DD / QD)": "MyDOS 4.5x (SD / MD / DD / QD)",
    "Sparta DOS (SD / MD / DD / QD)": "Sparta DOS (SD / MD / DD / QD)",
    "CP/M 2.2 (Indus GT - DD 180 KB)": "CP/M 2.2 (Indus GT - DD 180 KB)",
    "CP/M 2.2 (Atari 1090 - SD / MD)": "CP/M 2.2 (Atari 1090 - SD / MD)",
    "Brak (dysk niesformatowany)": "None (unformatted disk)",
    "Gęstość i Rozmiar Dysku:": "Disk Density and Size:",
    "SD - SS/SD (90 KB / 720 Sektorów 128B)": "SD - SS/SD (90 KB / 720 Sectors 128B)",
    "MD - SS/MD (130 KB / 1040 Sektorów 128B)": "MD - SS/MD (130 KB / 1040 Sectors 128B)",
    "DD - SS/DD (180 KB / 720 Sektorów 256B)": "DD - SS/DD (180 KB / 720 Sectors 256B)",
    "QD - DS/DD (368 KB / 1440 Sektorów 256B)": "QD - DS/DD (368 KB / 1440 Sectors 256B)",
    "720 KB - DS/QD (720 KB / 2880 Sektorów 256B)": "720 KB - DS/QD (720 KB / 2880 Sectors 256B)",
    "Niestandardowy (własna geometria)": "Custom (your own geometry)",
    "Geometria niestandardowa:": "Custom geometry:",
    "Liczba sektorów:": "Sector count:",
    "Sektory startowe:": "Boot sectors:",
    "Rozmiar sektora:": "Sector size:",
    "128 bajtów": "128 bytes",
    "256 bajtów": "256 bytes",
    "512 bajtów": "512 bytes",
    "Zainstaluj pliki systemowe DOS (Boot & DOS.SYS / DUP.SYS)": "Install DOS system files (Boot & DOS.SYS / DUP.SYS)",
    "Anuluj": "Cancel",
    "Utwórz Dysk": "Create Disk",
    "Tekst": "Text",
    "Hex": "Hex",
    "Przełącz podgląd na font PC lub ATASCII": "Switch the preview between the PC font and ATASCII",
    "Font: PC": "Font: PC",
    "Zamknij": "Close",
    "Zmiana Nazwy Pliku": "Rename File",
    "Nowa nazwa (Standard 8.3 ATASCII):": "New name (8.3 ATASCII standard):",
    "Zapisz Zmianę": "Save Change",
    "Nowy Podkatalog": "New Subdirectory",
    "Nazwa podkatalogu (8.3 ATASCII):": "Subdirectory name (8.3 ATASCII):",
    "Utwórz Katalog": "Create Directory",
    "Atrybuty Plików": "File Attributes",
    "Pole w stanie nieokreślonym oznacza, że zaznaczone pliki różnią się tym atrybutem — pozostawione tak, zostanie u każdego bez zmian.":
        "A checkbox left indeterminate means the marked files disagree on that attribute - left that way, it stays unchanged on each of them.",
    "<strong>(P) Protected / Locked</strong> – Ochrona przed modyfikacją i skasowaniem (Bit 0)": "<strong>(P) Protected / Locked</strong> – Protection against modification and deletion (Bit 0)",
    "<strong>(H) Hidden</strong> – Ukryty plik w katalogu (Bit 1)": "<strong>(H) Hidden</strong> – File hidden in the directory (Bit 1)",
    "<strong>(A) Archive</strong> – Flaga archiwum / zmiany (Bit 2)": "<strong>(A) Archive</strong> – Archive / modified flag (Bit 2)",
    "Zapisz Atrybuty": "Save Attributes",
    "Podgląd Katalogu (ATASCII)": "Directory Preview (ATASCII)",
    "Instrukcja Obsługi ATRaction": "ATRaction User Guide",
    "1. Wstęp i Przegląd Aplikacji": "1. Introduction and Application Overview",
    "<strong>ATRaction</strong> to zaawansowana aplikacja internetowa (Single Page Application) przeznaczona do tworzenia, odczytu, modyfikacji oraz analizy obrazów dyskietek elastycznych (formaty <code>.ATR</code> i <code>.XFD</code>) dla 8-bitowych komputerów Atari (seria 400/800, XL, XE). Całe przetwarzanie odbywa się lokalnie w przeglądarce za pomocą buforów binarnych <code>Uint8Array</code>, gwarantując prywatność i natychmiastowe działanie.":
        "<strong>ATRaction</strong> is an advanced web application (Single Page Application) for creating, reading, modifying and analyzing floppy disk images (<code>.ATR</code> and <code>.XFD</code> formats) for 8-bit Atari computers (400/800, XL, XE series). All processing happens locally in the browser using <code>Uint8Array</code> binary buffers, guaranteeing privacy and instant operation.",
    "<strong>Obsługiwane systemy plików:</strong> Atari DOS 2.0S/2.0D, DOS 2.5, DOS II+/D, MyDOS 4.5x, SpartaDOS (SDFS), LiteDOS-SE oraz CP/M 2.2 (Indus GT i Atari 1090).":
        "<strong>Supported file systems:</strong> Atari DOS 2.0S/2.0D, DOS 2.5, DOS II+/D, MyDOS 4.5x, SpartaDOS (SDFS), LiteDOS-SE and CP/M 2.2 (Indus GT and Atari 1090).",
    "<strong>Gęstości i formaty:</strong> SD (90 KB), MD/ED (130 KB), DD (180 KB), QD (368 KB), DS/QD (720 KB), <strong>geometria niestandardowa</strong> (dowolna liczba sektorów, sektory 128/256/512 B) oraz surowe obrazy <strong>XFD</strong>.":
        "<strong>Densities and formats:</strong> SD (90 KB), MD/ED (130 KB), DD (180 KB), QD (368 KB), DS/QD (720 KB), <strong>custom geometry</strong> (any sector count, 128/256/512 B sectors), and raw <strong>XFD</strong> images.",
    // innerHTML re-escapes "&" on read, so the key of a data-i18n-html element
    // must spell the ampersand as &amp; exactly like the browser hands it back.
    "<strong>Zarządzanie plikami:</strong> Dodawanie, usuwanie, zmiana nazwy (ATASCII 8.3 / CP/M), blokowanie (Lock/Unlock), atrybuty SDFS (A/H/P) oraz eksport na PC. Drag &amp; Drop plików <code>.ATR</code> oraz <code>.XFD</code>.":
        "<strong>File management:</strong> Adding, deleting, renaming (ATASCII 8.3 / CP/M), locking (Lock/Unlock), SDFS attributes (A/H/P) and exporting to PC. Drag &amp; Drop of <code>.ATR</code> and <code>.XFD</code> files.",
    "<strong>Podkatalogi:</strong> Tworzenie i szybka nawigacja po drzewie podkatalogów (MyDOS, SpartaDOS).":
        "<strong>Subdirectories:</strong> Creating and quickly navigating the subdirectory tree (MyDOS, SpartaDOS).",
    "<strong>Tryb Read-Only:</strong> Automatyczna walidacja alokacji chroniąca uszkodzone obrazy przed nadpisaniem.":
        "<strong>Read-Only mode:</strong> Automatic allocation validation protecting corrupted images from being overwritten.",
    "2. Obsługiwane Systemy Plików": "2. Supported File Systems",
    "System": "System",
    "Dopuszczalna geometria": "Allowed geometry",
    "Podkatalogi": "Subdirectories",
    "Nowy dysk": "New disk",
    "wyłącznie 720×128 (SD)": "720×128 only (SD)",
    "nie": "no",
    "tak": "yes",
    "wyłącznie 720×128 (SD) lub 1040×128 (MD)": "720×128 (SD) or 1040×128 (MD) only",
    "od 720 sektorów, 128 lub 256 B": "from 720 sectors, 128 or 256 B",
    "tak (64 pozycje / katalog)": "yes (64 entries / directory)",
    "od 16 sektorów, 128 / 256 / <strong>512 B</strong>": "from 16 sectors, 128 / 256 / <strong>512 B</strong>",
    "tak (bez limitu pozycji)": "yes (no entry limit)",
    "dyski z klastrami 1–64 sektorów": "disks with 1–64 sector clusters",
    "nie – tylko odczyt, zapis i formatowanie istniejących": "no – existing disks only: read, write and format",
    "64–1068 sektorów, wyłącznie 256 B": "64–1068 sectors, 256 B only",
    "<strong>Atari DOS 2.0S</strong> był dystrybuowany wyłącznie na dyskietkach SD, a <strong>DOS 2.5</strong> dodatkowo na MD (1040 sektorów, 130 KB) – nigdy na DD, QD ani 720K. Okno tworzenia dysku wymusza te ograniczenia, ukrywając niedostępne gęstości w rozwijanej liście. Sektory startowe oraz pliki <code>DOS.SYS</code>/<code>DUP.SYS</code> instalowane przy tworzeniu nowego dysku są bajt w bajt identyczne z oryginalnymi obrazami Atari DOS – dla DOS 2.5 wariant MD ma inny plik <code>DOS.SYS</code> niż wariant SD (różnica w osadzonej tabeli geometrii dysku), dlatego aplikacja instaluje odpowiedni zestaw zależnie od wybranej gęstości.":
        "<strong>Atari DOS 2.0S</strong> was only ever distributed on SD diskettes, and <strong>DOS 2.5</strong> additionally on MD (1040 sectors, 130 KB) – never on DD, QD or 720K. The disk creation window enforces these limits by hiding the unavailable densities in the dropdown list. The boot sectors and the <code>DOS.SYS</code>/<code>DUP.SYS</code> files installed when creating a new disk are byte-for-byte identical to original Atari DOS images – for DOS 2.5 the MD variant has a different <code>DOS.SYS</code> file than the SD variant (a difference in an embedded disk-geometry table), so the application installs the matching set depending on the chosen density.",
    "<strong>LiteDOS-SE</strong> rozpoznawany jest w dwóch odmianach: klasycznej (bity 7–6 bajtu ID sektora 360 równe <code>01</code>, bitmapa od offsetu <code>$0A</code>) oraz nowszej 2.x (bity <code>10</code>, sygnatura tekstowa <code>LiteDOS(c)MrA</code>, bitmapa 512-bitowa od <code>$20</code>). Miejsce zajmowane przez samo jądro DOS-u – w LiteDOS nie ma pliku DOS.SYS – jest rozpoznawane jako obszar systemowy i nie jest zgłaszane jako zagubione sektory.":
        "<strong>LiteDOS-SE</strong> is recognized in two variants: the classic one (bits 7–6 of sector 360's ID byte equal to <code>01</code>, bitmap starting at offset <code>$0A</code>) and the newer 2.x one (bits <code>10</code>, text signature <code>LiteDOS(c)MrA</code>, 512-bit bitmap starting at <code>$20</code>). The space taken by the DOS kernel itself – LiteDOS has no DOS.SYS file – is recognized as a system area and is not reported as lost sectors.",
    "<strong>CP/M 2.2</strong> dla stacji Indus GT przechowuje wszystkie bajty w postaci zanegowanej (XOR <code>$FF</code>). Katalog (64 pozycje) zajmuje sektory 37–44, dane są przydzielane blokami po 1 KB. Format zapisuje jedynie liczbę 128-bajtowych rekordów, więc odczytany rozmiar pliku jest zaokrąglany w górę do wielokrotności 128 bajtów.":
        "<strong>CP/M 2.2</strong> for the Indus GT drive stores every byte inverted (XOR <code>$FF</code>). The directory (64 entries) occupies sectors 37–44, and data is allocated in 1 KB blocks. The format only stores a count of 128-byte records, so the reported file size is always rounded up to a multiple of 128 bytes.",

    "<strong>CP/M 2.2</strong> dla karty CP/M urządzenia Atari 1090 zapisuje te same struktury bez negacji, na dyskietkach o sektorach 128-bajtowych. Sektory 1–78 to obszar systemowy (3 ścieżki po 26 rekordów), katalog (64 pozycje) zajmuje sektory 79–94, a blok alokacji liczy 1 KB, czyli 8 sektorów. Rekord CP/M odpowiada jednemu sektorowi Atari, a mapowanie jest liniowe – BIOS karty nie publikuje tablicy translacji sektorów. Jego DPB udostępnia 119 bloków (DSM = 118), co odpowiada dyskietce MD 130 KB; na krótszym nośniku limitem pozostaje jego własny rozmiar.":
        "<strong>CP/M 2.2</strong> for the CP/M card of the Atari 1090 writes the same structures without inversion, on disks with 128-byte sectors. Sectors 1–78 are the system area (3 tracks of 26 records), the directory (64 entries) occupies sectors 79–94, and an allocation block holds 1 KB, i.e. 8 sectors. A CP/M record is one Atari sector and the mapping is linear – the card's BIOS publishes no sector translation table. Its DPB offers 119 blocks (DSM = 118), which matches the 130 KB MD disk; on a shorter medium its own size is the limit instead.",

    "102–1040 sektorów, wyłącznie 128 B": "102–1040 sectors, 128 B only",
    "3. Geometrie Dysków": "3. Disk Geometries",
    "Symbol": "Symbol",
    "Nazwa Gęstości": "Density Name",
    "Rozmiar Sektora": "Sector Size",
    "Pojemność": "Capacity",
    "Single Density": "Single Density",
    "Medium / Enhanced Density": "Medium / Enhanced Density",
    "Double Density (Atari DOS / CP/M)": "Double Density (Atari DOS / CP/M)",
    "Quad Density": "Quad Density",
    "Double Sided / Quad Density": "Double Sided / Quad Density",
    "Własna geometria": "Custom geometry",
    "do 32 MB": "up to 32 MB",
    "<strong>Format Surowy XFD:</strong> Obrazy <code>.XFD</code> to surowe zrzuty sektorów bez 16-bajtowego nagłówka ATR, w których wszystkie sektory mają jednakowy rozmiar. W kontenerze <code>.ATR</code> obowiązuje odwrotna konwencja: przy sektorach większych niż 128 B kilka pierwszych (startowych) zapisywanych jest jako 128-bajtowe.":
        "<strong>Raw XFD format:</strong> <code>.XFD</code> images are raw sector dumps with no 16-byte ATR header, where every sector has the same size. The <code>.ATR</code> container follows the opposite convention: when sectors are larger than 128 B, the first few (boot) sectors are stored as 128 bytes.",
    "<strong>Sektory startowe:</strong> Nagłówek ATR nie ma pola na ich liczbę – przyjmuje się, że obrazy o sektorach do 256 B mają trzy 128-bajtowe sektory startowe. Ustawienie innej wartości w geometrii niestandardowej wpływa na tworzony plik, ale przy ponownym wczytaniu obrazu o sektorach 256 B zostaną odczytane 3. Przy sektorach 128 B pole nie zmienia układu pliku w ogóle, przy 512 B krótkich sektorów startowych nie ma wcale.":
        "<strong>Boot sectors:</strong> The ATR header has no field for their count – images with sectors up to 256 B are assumed to have three 128-byte boot sectors. Setting a different value in a custom geometry affects the file being created, but reloading a 256 B-sector image will always read back 3. With 128 B sectors the field doesn't change the file layout at all, and with 512 B there are no short boot sectors to begin with.",
    "4. Instrukcje Krok po Kroku (Tutoriale)": "4. Step-by-Step Instructions (Tutorials)",
    "Tworzenie Nowego Obrazu ATR / XFD": "Creating a New ATR / XFD Image",
    "Kliknij przycisk <strong>Nowy Dysk</strong> na górnym pasku nawigacyjnym.": "Click the <strong>New Disk</strong> button on the top toolbar.",
    "Wybierz system plików (<em>Atari DOS 2.0S</em>, <em>Atari DOS 2.5</em>, <em>DOS II+/D</em>, <em>MyDOS 4.5x</em>, <em>SpartaDOS</em>, <em>CP/M 2.2</em> lub <em>Brak – dysk niesformatowany</em>).":
        "Choose the file system (<em>Atari DOS 2.0S</em>, <em>Atari DOS 2.5</em>, <em>DOS II+/D</em>, <em>MyDOS 4.5x</em>, <em>SpartaDOS</em>, <em>CP/M 2.2</em>, or <em>None – unformatted disk</em>).",
    "Wskaż gęstość dysku. Lista dostosowuje się do wybranego systemu – np. <em>Atari DOS 2.0S</em> oferuje wyłącznie SD, <em>Atari DOS 2.5</em> wyłącznie SD i MD, a DOS II+/D nie oferuje QD ani 720 KB.":
        "Pick the disk density. The list adapts to the chosen system – e.g. <em>Atari DOS 2.0S</em> offers only SD, <em>Atari DOS 2.5</em> only SD and MD, and DOS II+/D does not offer QD or 720 KB.",
    "Zaznacz opcję instalacji plików systemowych DOS (dostępna dla obu wersji Atari DOS i dla MyDOS) i zatwierdź przyciskiem <strong>Utwórz Dysk</strong>.":
        "Check the option to install DOS system files (available for both Atari DOS versions and for MyDOS) and confirm with the <strong>Create Disk</strong> button.",
    "Geometria Niestandardowa": "Custom Geometry",
    "Wybranie gęstości <strong>Niestandardowy</strong> odsłania trzy pola:": "Selecting the <strong>Custom</strong> density reveals three fields:",
    "<strong>Liczba sektorów</strong> – od liczby sektorów startowych do 65535.": "<strong>Sector count</strong> – from the number of boot sectors up to 65535.",
    "<strong>Sektory startowe</strong> – 0–255. Pole jest wyłączane po wybraniu sektorów 512-bajtowych, które krótkich sektorów startowych nie mają.":
        "<strong>Boot sectors</strong> – 0–255. The field is disabled once 512-byte sectors are selected, which have no short boot sectors.",
    "<strong>Rozmiar sektora</strong> – 128, 256 lub 512 bajtów. Sektory 512 B obsługuje wyłącznie SpartaDOS.":
        "<strong>Sector size</strong> – 128, 256 or 512 bytes. 512 B sectors are supported by SpartaDOS only.",
    "Pod polami wyświetlany jest wynikowy rozmiar obrazu. Jeśli wybrany system plików nie obsługuje podanej geometrii, pojawia się czerwony komunikat z przyczyną, a przycisk <strong>Utwórz Dysk</strong> zostaje zablokowany – dopuszczalne kombinacje zebrano w tabeli w punkcie 2.":
        "The resulting image size is shown below the fields. If the chosen file system does not support the given geometry, a red message explaining why appears and the <strong>Create Disk</strong> button is disabled – the allowed combinations are listed in the table in section 2.",
    "<strong>Uwaga:</strong> dla geometrii niestandardowej instalacja plików systemowych jest <strong>zawsze wyłączona</strong>. Gotowe pliki DOS.SYS i DUP.SYS istnieją wyłącznie w wariantach dla gęstości standardowych i na dysku o innej geometrii nie byłyby poprawnie ładowane.":
        "<strong>Note:</strong> for a custom geometry, installing system files is <strong>always disabled</strong>. The ready-made DOS.SYS and DUP.SYS files only exist for standard densities and would not load correctly on a disk with a different geometry.",
    "Dwa Sposoby Wskazywania Plików": "Two Ways of Picking Files",
    "Tabela plików rozróżnia <strong>wskazanie kliknięciem</strong> i <strong>zaznaczenie polami wyboru</strong> w pierwszej kolumnie. To dwa niezależne mechanizmy, a każdy przycisk korzysta tylko z jednego z nich.":
        "The file table distinguishes <strong>picking by click</strong> from <strong>marking with the checkboxes</strong> in the first column. These are two independent mechanisms, and each button uses only one of them.",
    "<strong>Kliknięcie wiersza</strong> podświetla dokładnie jedną pozycję. Działają na niej <strong>Zmień Nazwę</strong>, <strong>Usuń</strong>, <strong>Podgląd / Hex</strong>, <strong>Zablokuj/Odblokuj</strong> oraz <strong>Pobierz Plik</strong>. Pola wyboru nie mają na te przyciski żadnego wpływu.":
        "<strong>Clicking a row</strong> highlights exactly one entry. <strong>Rename</strong>, <strong>Delete</strong>, <strong>Preview / Hex</strong>, <strong>Lock/Unlock</strong> and <strong>Extract File</strong> all act on it. The checkboxes have no effect on these buttons.",
    "<strong>Pola wyboru</strong> tworzą zaznaczenie zbiorcze, na którym działa <strong>Pobierz ZIP</strong>. Pole w nagłówku tabeli zaznacza i odznacza wszystkie widoczne pozycje – przy włączonej wyszukiwarce tylko te pasujące do frazy.":
        "<strong>The checkboxes</strong> build a bulk selection, which <strong>Download ZIP</strong> acts on. The checkbox in the table header marks and unmarks every visible entry – with the search box in use, only the rows matching the phrase.",
    "<strong>Atrybuty</strong> to jedyny przycisk korzystający z obu mechanizmów: gdy cokolwiek jest odhaczone polami wyboru, działa na całym tym zaznaczeniu, a gdy nie – na pojedynczej pozycji wskazanej kliknięciem.":
        "<strong>Attributes</strong> is the only button that uses both: when anything is checked, it acts on that whole selection, and when nothing is – on the single entry picked by click.",
    "Zaznaczenie polami wyboru przeżywa filtrowanie wyszukiwarką i przechodzenie między katalogami. Znika przy wczytaniu innego obrazu, założeniu nowego dysku i formatowaniu.":
        "A checkbox selection survives search filtering and moving between directories. It is dropped when another image is loaded, a new disk is created, or the disk is formatted.",
    "Wgrywanie, Modyfikacja i Usuwanie Plików": "Uploading, Modifying and Deleting Files",
    "<strong>Dodawanie pliku z PC:</strong> Kliknij <strong>Dodaj Plik</strong> i wybierz plik z dysku komputera (np. <code>.XEX</code>, <code>.COM</code>, <code>.TXT</code>). Nazwa zostanie automatycznie przekonwertowana do standardu 8.3 ATASCII.":
        "<strong>Adding a file from PC:</strong> Click <strong>Add File</strong> and choose a file from your computer (e.g. <code>.XEX</code>, <code>.COM</code>, <code>.TXT</code>). The name will be automatically converted to the 8.3 ATASCII standard.",
    "<strong>Zablokowanie pliku:</strong> Kliknij plik na liście i użyj <strong>Zablokuj/Odblokuj</strong>. Przycisk przełącza ochronę <em>jednej</em> pozycji, tej wskazanej kliknięciem. Aby zmienić blokadę wielu plikom naraz, odhacz je polami wyboru i użyj przycisku <strong>Atrybuty</strong>.":
        "<strong>Locking a file:</strong> Click the file in the list and use <strong>Lock/Unlock</strong>. The button toggles protection on <em>one</em> entry, the one picked by click. To change the lock on many files at once, check them and use the <strong>Attributes</strong> button.",
    "<strong>Atrybuty:</strong> Przycisk <strong>Atrybuty</strong> otwiera okno ustawień. Na dyskach SpartaDOS SDFS dostępne są znaczniki <em>P</em> (Protected), <em>H</em> (Hidden) i <em>A</em> (Archive), a w pozostałych systemach plików – wyłącznie ochrona przed zapisem. Przy wielu odhaczonych plikach pole atrybutu, którym te pliki się różnią, pokazuje stan nieokreślony: pozostawione tak, nie zmienia niczego, a kliknięcia ustawiają atrybut albo zdejmują go wszystkim naraz. Aktywne atrybuty widoczne są jako plakietki na liście plików.":
        "<strong>Attributes:</strong> The <strong>Attributes</strong> button opens the settings dialog. SpartaDOS SDFS disks offer the <em>P</em> (Protected), <em>H</em> (Hidden) and <em>A</em> (Archive) flags; every other file system offers write protection alone. With several files checked, an attribute the files disagree on shows as indeterminate: left that way it changes nothing, while clicking sets or clears it on all of them at once. Active attributes are shown as badges in the file list.",
    "<strong>Zmiana nazwy:</strong> Kliknij plik, wybierz <strong>Zmień Nazwę</strong> i podaj nową nazwę zgodną z formatem 8.3. Operacja dotyczy zawsze jednej pozycji, niezależnie od tego, co jest odhaczone polami wyboru.":
        "<strong>Renaming:</strong> Click a file, choose <strong>Rename</strong> and enter a new name matching the 8.3 format. The operation always applies to one entry, whatever the checkboxes hold.",
    "<strong>Usuwanie:</strong> Kliknij plik lub pusty podkatalog i użyj <strong>Usuń</strong>. Tak jak zmiana nazwy, dotyczy wyłącznie pozycji wskazanej kliknięciem – masowego kasowania nie ma.":
        "<strong>Deleting:</strong> Click a file or an empty subdirectory and use <strong>Delete</strong>. Like renaming, it applies only to the entry picked by click – there is no bulk deletion.",
    "<strong>Eksport:</strong> <strong>Pobierz Plik</strong> zapisuje na dysku komputera pojedynczy plik wskazany kliknięciem. <strong>Pobierz ZIP</strong> pakuje do jednego archiwum wszystko, co odhaczono polami wyboru – odhaczony katalog trafia tam wraz z całą zawartością. <strong>Zapisz Dysk</strong> pobiera cały zmodyfikowany obraz.":
        "<strong>Export:</strong> <strong>Extract File</strong> saves the single file picked by click to your computer. <strong>Download ZIP</strong> packs everything checked into one archive – a checked directory goes in with all of its contents. <strong>Save Disk</strong> downloads the whole modified image.",
    "Praca z Podkatalogami (MyDOS / SpartaDOS)": "Working with Subdirectories (MyDOS / SpartaDOS)",
    "Na dyskach sformatowanych w MyDOS lub SpartaDOS kliknij <strong>Nowy Katalog</strong> i podaj nazwę.":
        "On disks formatted as MyDOS or SpartaDOS, click <strong>New Directory</strong> and enter a name.",
    "Aby wejść do katalogu, kliknij dwukrotnie na wiersz w tabeli lub skorzystaj z <strong>Drzewa Katalogów</strong> w panelu bocznym.":
        "To enter a directory, double-click its row in the table or use the <strong>Directory Tree</strong> in the sidebar.",
    "Powrót do katalogu głównego następuje po kliknięciu <code>[ROOT]</code> w drzewie katalogów.":
        "Return to the root directory by clicking <code>[ROOT]</code> in the directory tree.",
    "Podgląd Tekstowy, Hex Viewer oraz ATASCII": "Text Preview, Hex Viewer and ATASCII",
    "Wybranie pliku i kliknięcie <strong>Podgląd / Hex</strong> otwiera okno podglądu z zakładkami <em>Tekst</em> oraz <em>Hex</em>.":
        "Selecting a file and clicking <strong>Preview / Hex</strong> opens the preview window with the <em>Text</em> and <em>Hex</em> tabs.",
    "Przycisk fontu pozwala na przełączenie widoku między domyślnym krojem PC a oryginalnym fontem Atari 8-Bit (glify ATASCII, symbole graficzne i znaki ramek).":
        "The font button switches the view between the default PC typeface and the original Atari 8-bit font (ATASCII glyphs, graphics symbols and box-drawing characters).",
    "Przycisk <strong>Katalog ATASCII</strong> prezentuje całą zawartość katalogu w 40-kolumnowym formacie ekranu Atari.":
        "The <strong>ATASCII Directory</strong> button displays the whole directory listing in the Atari's 40-column screen format.",
    "5. Walidacja Alokacji i Tryb Read-Only": "5. Allocation Validation and Read-Only Mode",
    "Po wczytaniu obrazu aplikacja przechodzi całe drzewo katalogów i porównuje sektory zajmowane przez pliki z mapą alokacji dysku. Reakcja zależy od rodzaju niezgodności –:":
        "After loading an image, the application walks the entire directory tree and compares the sectors used by files against the disk's allocation map. The reaction depends on the kind of mismatch found:",
    "<strong>Tryb tylko do odczytu</strong> – gdy sektor używany przez plik jest w mapie oznaczony jako wolny, gdy licznik wolnych sektorów nie zgadza się z mapą, gdy ten sam sektor należy do dwóch plików albo gdy wpis katalogu wskazuje poza obszar dysku. Pliki można przeglądać i pobierać, ale wszystkie operacje zapisu są zablokowane, żeby nie pogłębić uszkodzenia.":
        "<strong>Read-only mode</strong> – when a sector used by a file is marked free in the map, when the free-sector count doesn't match the map, when the same sector belongs to two files, or when a directory entry points outside the disk. Files can still be browsed and downloaded, but every write operation is blocked to avoid making the damage worse.",
    "<strong>Ostrzeżenie</strong> – gdy w mapie są tylko <em>zagubione sektory</em>, czyli oznaczone jako zajęte, choć żaden plik ich nie używa. Taki obraz pozostaje zapisywalny; marnuje jedynie miejsce.":
        "<strong>Warning</strong> – when the map only contains <em>lost sectors</em>, i.e. ones marked in use although no file references them. Such an image stays writable; it only wastes space.",
    "Każdy system plików sprawdzany jest według własnych reguł: MyDOS i Atari DOS przez bitmapę VTOC w sektorze 360 (z rozszerzeniami dla dysków powyżej 943 sektorów i drugą mapą DOS 2.5 w sektorze 1024), SpartaDOS przez mapę bitową i licznik w bloku startowym, LiteDOS przez mapę klastrów, a CP/M przez kontrolę bloków przydzielonych w katalogu. Komunikat z przyczyną pojawia się na pasku statusu i w panelu informacji o dysku.":
        "Each file system is checked using its own rules: MyDOS and Atari DOS via the VTOC bitmap in sector 360 (with extensions for disks over 943 sectors and a second DOS 2.5 map in sector 1024), SpartaDOS via its bitmap and the counter in the boot block, LiteDOS via the cluster map, and CP/M by checking the blocks assigned in the directory. A message explaining the cause appears on the status bar and in the disk info panel.",
    "6. Kodowanie Znaków ATASCII vs PC (UTF-8)": "6. ATASCII vs PC (UTF-8) Character Encoding",
    "Komputery Atari 8-bit stosują własny standard kodowania <strong>ATASCII</strong>. Znak końca linii (EOL) to kod <code>0x9B</code> (155), który ATRaction automatycznie konwertuje na znak <code>\\n</code>. Bajty o wartościach <code>0x80</code>–<code>0xFF</code> odpowiadają znakom inwertowanym (Inverse Video), natomiast kody <code>0x00</code>–<code>0x1F</code> oraz <code>0x60</code>–<code>0x7F</code> reprezentują specjalne glify graficzne Atari.":
        "8-bit Atari computers use their own character encoding standard, <strong>ATASCII</strong>. The end-of-line (EOL) character is code <code>0x9B</code> (155), which ATRaction automatically converts to <code>\\n</code>. Bytes with values <code>0x80</code>–<code>0xFF</code> correspond to inverse-video characters, while codes <code>0x00</code>–<code>0x1F</code> and <code>0x60</code>–<code>0x7F</code> represent special Atari graphics glyphs.",
    "7. Podziękowania (Credits)": "7. Credits and Acknowledgements",
    "Aplikacja <strong>ATRaction</strong> powstała przy wsparciu wiedzy i zasobów udostępnionych przez:": "The <strong>ATRaction</strong> application was built with the help of knowledge and resources shared by:",
    "<strong>Mono</strong> – projekt <strong>atari8fs</strong>": "<strong>Mono</strong> – the <strong>atari8fs</strong> project",
    "Implementacje systemów plików Atari DOS 2, DOS 2.5, DOS II+/D i MyDOS 4.5x czerpią z analizy formatów ATR i VTOC udokumentowanej w projekcie atari8fs.":
        "The Atari DOS 2, DOS 2.5, DOS II+/D and MyDOS 4.5x file system implementations draw on the analysis of the ATR and VTOC formats documented by the atari8fs project.",
    "<strong>Avery Lee</strong> – emulator <strong>Altirra</strong>": "<strong>Avery Lee</strong> – the <strong>Altirra</strong> emulator",
    "Kod źródłowy biblioteki ATIO posłużył jako wzorzec przy odtworzeniu rozszerzonego VTOC MyDOS, mapy bitowej SDFS, systemu CP/M 2.2 dla Indus GT, drugiej mapy alokacji DOS 2.5, zasad rozpoznawania formatów oraz mechanizmu walidacji z trybem Read-Only. Okno tworzenia dysku o geometrii niestandardowej odwzorowuje opcję <em>Custom</em> z altirrowego <em>Create New Disk</em>.":
        "The ATIO library source code served as the reference for reconstructing the extended MyDOS VTOC, the SDFS bitmap, the CP/M 2.2 system for the Indus GT, the second DOS 2.5 allocation map, the format-detection rules, and the Read-Only validation mechanism. The custom-geometry disk creation window mirrors the <em>Custom</em> option from Altirra's own <em>Create New Disk</em>.",
    "<strong>Mr Atari</strong> – system <strong>LiteDOS-SE</strong>": "<strong>Mr Atari</strong> – the <strong>LiteDOS-SE</strong> system",
    "Obsługa LiteDOS – klastrowa mapa alokacji, geometria obszaru VTOC i katalogu oraz format wpisów – opiera się na sekcji technicznej instrukcji użytkownika LiteDOS-SE.":
        "LiteDOS support – the cluster allocation map, the VTOC and directory area geometry, and the entry format – is based on the technical section of the LiteDOS-SE user manual.",
    "8. Licencja": "8. License",
    "ATRaction jest wolnym oprogramowaniem na licencji <strong>GNU General Public License w wersji 2 lub dowolnej późniejszej</strong> (<a href=\"LICENSE.txt\" target=\"_blank\" rel=\"noopener\" style=\"color: var(--color-primary);\">GPL-2.0-or-later</a>). Program rozpowszechniany jest w nadziei, że okaże się przydatny, ale <em>bez jakiejkolwiek gwarancji</em>.":
        "ATRaction is free software under the <strong>GNU General Public License, version 2 or any later version</strong> (<a href=\"LICENSE.txt\" target=\"_blank\" rel=\"noopener\" style=\"color: var(--color-primary);\">GPL-2.0-or-later</a>). It is distributed in the hope that it will be useful, but <em>without any warranty</em>.",
    "Wybór licencji nie jest przypadkowy. Część kodu obsługującego formaty dysków – rozszerzony VTOC MyDOS, mapa bitowa SDFS, system CP/M 2.2 dla Indus GT, druga mapa alokacji DOS 2.5, zasady rozpoznawania formatów oraz mechanizm walidacji z trybem tylko do odczytu – powstała na podstawie źródeł biblioteki <strong>ATIO</strong> emulatora <strong>Altirra</strong> (© 2009–2015 Avery Lee), objętych tą samą licencją. Same formaty dysków są faktami technicznymi i nie podlegają prawu autorskiemu, ale odtworzenie ich z otwartym cudzym kodem czyni ten fragment utworem zależnym, dlatego ATRaction dziedziczy GPL.":
        "The choice of licence is not arbitrary. Part of the disk-format code – the extended MyDOS VTOC, the SDFS bitmap, the CP/M 2.2 system for the Indus GT, the second DOS 2.5 allocation map, the format-detection rules, and the read-only validation mechanism – was written from the sources of the <strong>ATIO</strong> library of the <strong>Altirra</strong> emulator (© 2009–2015 Avery Lee), which carries the same licence. The disk formats themselves are technical facts and are not subject to copyright, but reconstructing them with someone else's source open makes that part a derivative work, so ATRaction inherits the GPL.",
    "<strong>Wyjątek:</strong> plik <code>js/dos_templates.js</code> zawiera dosłowne kopie sektorów startowych oraz plików <code>DOS.SYS</code> i <code>DUP.SYS</code> systemów Atari DOS 2.0S, DOS 2.5, DOS II+/D, MyDOS 4.5x i LiteDOS-SE. Nie są one dziełem tego projektu, nie są objęte GPL i nie są tu do nich udzielane żadne prawa – każdy pozostaje własnością swojego podmiotu praw. Pełne zestawienie zapożyczeń znajduje się w pliku <a href=\"THIRD-PARTY.txt\" target=\"_blank\" rel=\"noopener\" style=\"color: var(--color-primary);\">THIRD-PARTY.txt</a>.":
        "<strong>Exception:</strong> the file <code>js/dos_templates.js</code> holds verbatim copies of the boot sectors and of the <code>DOS.SYS</code> and <code>DUP.SYS</code> files of Atari DOS 2.0S, DOS 2.5, DOS II+/D, MyDOS 4.5x and LiteDOS-SE. They are not the work of this project, are not covered by the GPL, and no rights over them are granted here – each remains the property of its own rights holder. A full account of borrowed work is given in <a href=\"THIRD-PARTY.txt\" target=\"_blank\" rel=\"noopener\" style=\"color: var(--color-primary);\">THIRD-PARTY.txt</a>.",
    "Wynik Importu Plików": "File Import Result",
    "Pomyślnie zaimportowane pliki:": "Successfully imported files:",
    "Pliki, które nie mogły zostać dodane:": "Files that could not be added:",

    // ---- Section 3: app.js dynamic strings (toasts, confirm dialogs, generated HTML) ----
    "Załadowany obraz ATR: {0}": "Loaded ATR image: {0}",
    "Wczytano obraz ATR: {0} ({1})": "Loaded ATR image: {0} ({1})",
    "Błąd wczytywania ATR: {0}": "Error loading ATR: {0}",
    "Nagłówek ATR deklaruje obraz o rozmiarze {0} B, a plik ma {1} B ({2}). Obraz jest niekompletny lub uszkodzony i został zamontowany w trybie tylko do odczytu (read-only).":
        "The ATR header declares an image of {0} B, but the file is {1} B ({2}). The image is incomplete or damaged and has been mounted read-only.",
    "brakuje {0} B": "{0} B missing",
    "nadmiarowe {0} B": "{0} B too many",
    "Niestandardowe parametry dysku": "Non-standard disk parameters",
    "Niestandardowy rozmiar / parametry dysku": "Non-standard size / disk parameters",
    "Tylko do odczytu (Read-Only)": "Read-Only",
    // Static fallbacks of the two sidebar notices and the preview modal; app.js
    // overwrites them as soon as a disk is loaded / a file is previewed, but they
    // must still translate so a language switch never leaves Polish behind.
    "Niestandardowy rozmiar / parametry": "Non-standard size / parameters",
    "Odczytano niestandardowy rozmiar dysku. Modyfikowanie plików może doprowadzić do uszkodzenia danych.":
        "A non-standard disk size was read. Modifying files may corrupt the data.",
    "Błędna bitmapa alokacji. Obraz zamontowano w trybie tylko do odczytu.":
        "Invalid allocation bitmap. The image has been mounted read-only.",
    "Podgląd Pliku": "File Preview",
    "NAZWA.EXT": "NAME.EXT",
    "Uwaga: zagubione sektory": "Warning: lost sectors",
    "Pusty katalog ({0}).": "Empty directory ({0}).",
    "Ścieżka: /{0}": "Path: /{0}",
    "Katalog główny": "Root directory",
    "{0} ({1} elementów).": "{0} ({1} items).",
    "Katalog nadrzędny": "Parent directory",
    "Pobierz": "Download",
    "Wyeksportowano i pobrano plik {0}.": "Exported and downloaded file {0}.",
    "Błąd zapisu ATR: {0}": "Error saving ATR: {0}",
    "{0} sekt. x {1} B = {2} KB (plik {3} B)": "{0} sect. x {1} B = {2} KB (file {3} B)",
    "Uwaga: format ATR nie zapisuje liczby sektorów startowych — przy ponownym wczytaniu obrazu o sektorach 256 B zostaną odczytane 3.":
        "Note: the ATR format does not store the boot sector count — reloading an image with 256 B sectors will always read back 3 boot sectors.",
    "Utworzono nowy dysk {0}": "Created new disk {0}",
    "Błąd tworzenia dysku: {0}": "Error creating disk: {0}",
    "Czy na pewno chcesz sformatować dysk? Wszystkie dane zostaną utracone.": "Are you sure you want to format the disk? All data will be lost.",
    "Dysk został pomyślnie sformatowany.": "The disk was formatted successfully.",
    "Błąd formatowania: {0}": "Formatting error: {0}",
    "Najpierw wczytaj obraz .ATR / .XFD lub utwórz nowy dysk.": "First load an .ATR / .XFD image or create a new disk.",
    "Dysk jest w trybie tylko do odczytu. Import jest zablokowany.": "The disk is in read-only mode. Import is blocked.",
    "Obrazy dysków (.ATR / .XFD) należy otworzyć zamiast importować.": "Disk images (.ATR / .XFD) should be opened instead of imported.",
    "Błąd odczytu z dysku lokalnego": "Error reading from local disk",
    "Błąd pliku": "File error",
    "Błąd zapisu": "Write error",
    "Zaimportowano plik: {0}": "Imported file: {0}",
    "Pomyślnie zaimportowano {0} plików.": "Successfully imported {0} files.",
    "Niektóre pliki nie mogły zostać zaimportowane ({0} z {1} zapisanych)": "Some files could not be imported ({0} of {1} saved)",
    "Powodem odrzucenia jest zbyt mała wolna powierzchnia dysku, nieprawidłowy format nazwy lub zablokowany katalog.":
        "The rejection is caused by insufficient free disk space, an invalid name format, or a locked directory.",
    "Zaimportowano {0} z {1} plików.": "Imported {0} of {1} files.",
    "Obraz ATR/XFD - pominięto": "ATR/XFD image - skipped",
    "Utworzono podkatalog: {0}": "Created subdirectory: {0}",
    "Błąd tworzenia podkatalogu: {0}": "Error creating subdirectory: {0}",
    "Pobrano plik: {0}": "Downloaded file: {0}",
    "Błąd pobierania: {0}": "Download error: {0}",
    "Nie ma czego spakować: zaznaczone katalogi są puste.": "Nothing to archive: the marked directories are empty.",
    "Nie udało się odczytać żadnej z {0} zaznaczonych pozycji (szczegóły w konsoli).":
        "None of the {0} marked entries could be read (details in the console).",
    "Spakowano {0} plików do {1}.": "Archived {0} files into {1}.",
    "Spakowano {0} plików do {1}; pominięto {2} nieczytelnych (szczegóły w konsoli).":
        "Archived {0} files into {1}; skipped {2} unreadable ones (details in the console).",
    "Błąd pakowania ZIP: {0}": "ZIP packing error: {0}",
    "Czy na pewno chcesz usunąć plik '{0}'?": "Are you sure you want to delete the file '{0}'?",
    "Usunięto plik {0}": "Deleted file {0}",
    "Błąd usuwania: {0}": "Deletion error: {0}",
    "Zmieniono atrybuty pliku {0}": "Changed attributes of file {0}",
    "Błąd zmiany atrybutów: {0}": "Error changing attributes: {0}",
    "Plik: {0}": "File: {0}",
    "Zaznaczone pliki: {0}": "Marked files: {0}",
    "Zaktualizowano atrybuty pliku {0}": "Updated attributes of file {0}",
    "Zaktualizowano atrybuty {0} plików.": "Updated attributes of {0} files.",
    "Zmieniono atrybuty {0} plików, {1} pominięto (szczegóły w konsoli).":
        "Changed attributes of {0} files, skipped {1} (details in the console).",
    "Błąd zapisu atrybutów: {0}": "Error saving attributes: {0}",
    "Zmieniono nazwę na: {0}": "Renamed to: {0}",
    "Błąd zmiany nazwy: {0}": "Rename error: {0}",
    "Podgląd: {0}": "Preview: {0}",
    "Błąd podglądu pliku: {0}": "File preview error: {0}"
};

/**
 * Translates a Polish template to the active language and fills in {0},{1}...
 * @param {string} text Polish source text (used verbatim as the lookup key)
 * @param {...*} args Values substituted into {0}, {1}, ... placeholders
 * @returns {string}
 */
function T(text) {
    if (text === undefined || text === null) return text;
    var args = Array.prototype.slice.call(arguments, 1);
    var key = normalizeI18nKey(text);
    var template = (ATRACTION_LANG === 'en' && Object.prototype.hasOwnProperty.call(EN_DICT, key))
        ? EN_DICT[key]
        : text;
    for (var i = 0; i < args.length; i++) {
        template = template.split('{' + i + '}').join(args[i]);
    }
    return template;
}

/**
 * Applies the active language to every tagged element under `root`.
 * Safe to call repeatedly (e.g. once on load, then again on every toggle).
 * @param {ParentNode} [root=document]
 */
function applyStaticTranslations(root) {
    root = root || document;

    root.querySelectorAll('[data-i18n]').forEach(function (el) {
        if (el.dataset.i18nOrig === undefined) el.dataset.i18nOrig = el.textContent;
        el.textContent = T(el.dataset.i18nOrig);
    });
    root.querySelectorAll('[data-i18n-html]').forEach(function (el) {
        if (el.dataset.i18nOrigHtml === undefined) el.dataset.i18nOrigHtml = el.innerHTML;
        el.innerHTML = T(el.dataset.i18nOrigHtml);
    });
    root.querySelectorAll('[data-i18n-title]').forEach(function (el) {
        if (el.dataset.i18nOrigTitle === undefined) el.dataset.i18nOrigTitle = el.getAttribute('title') || '';
        el.setAttribute('title', T(el.dataset.i18nOrigTitle));
    });
    root.querySelectorAll('[data-i18n-placeholder]').forEach(function (el) {
        if (el.dataset.i18nOrigPlaceholder === undefined) el.dataset.i18nOrigPlaceholder = el.getAttribute('placeholder') || '';
        el.setAttribute('placeholder', T(el.dataset.i18nOrigPlaceholder));
    });
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { T: T, getLang: getLang, setLang: setLang, applyStaticTranslations: applyStaticTranslations, EN_DICT: EN_DICT };
}
