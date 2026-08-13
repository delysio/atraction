# ATRaction :: Atari 8-Bit ATR Disk Manager
## Dokumentacja Techniczna i Podręcznik Użytkownika

---

## 1. Wstęp i Przegląd Aplikacji

**ATRaction** to nowoczesna, wysoce wyspecjalizowana aplikacja internetowa (Single Page Application - SPA) przeznaczona do tworzenia, odczytu, modyfikacji oraz analizy obrazów dyskietek elastycznych (format `.ATR`) używanych przez 8-bitowe komputery Atari (seria 400/800, XL, XE).

Aplikacja została zaprojektowana od podstaw w czystym języku JavaScript (ES6+), HTML5 oraz CSS3, bez wykorzystywania zewnętrznych bibliotek czy frameworków. Całe przetwarzanie odbywa się lokalnie w przeglądarce internetowej użytkownika za pomocą manipulacji buforami binarnymi `Uint8Array`, co gwarantuje natychmiastowe działanie, pełne bezpieczeństwo danych oraz niezależność od serwerów zewnętrznych.

### Kluczowe cechy aplikacji:
- **Obsługa wielu systemów plików**: Atari DOS 2.0S, DOS 2.5, DOS II+/D, MyDOS 4.5x, SpartaDOS (SDFS), **LiteDOS-SE** oraz **CP/M 2.2** w dwóch wariantach – dla stacji **Indus GT** i dla karty CP/M urządzenia **Atari 1090**.
- **Obsługa obrazów ATR oraz surowych plików XFD**: Wykrywanie i wirtualne pakowanie surowych obrazów `.XFD` (bez nagłówka ATR) z eksportem do czystego formatu XFD.
- **Obsługa wszystkich gęstości dysków oraz geometrii niestandardowej**: SD (Single Density), MD/ED (Medium/Enhanced Density), DD (Double Density), QD (Quad Density), DS/QD (720 KB) oraz dowolna geometria **Niestandardowa** (własna liczba sektorów, sektory 128/256/512 B, własna liczba sektorów startowych).
- **Operacje na plikach**: Dodawanie plików, usuwanie, zmiana nazwy (format 8.3 ATASCII / CP/M), zmiana statusu blokady (Lock/Unlock / Read-Only), edycja atrybutów **A/H/P** dla SpartaDOS SDFS oraz eksport plików na komputer PC.
- **Obsługa podkatalogów**: Tworzenie i nawigacja po strukturze drzewiastej dla systemów MyDOS i SpartaDOS.
- **Zaawansowany podgląd treści**: Zintegrowany podgląd tekstowy z dekodowaniem ATASCII oraz Hex Viewer z możliwością przełączania czcionki pomiędzy **PC (UTF-8)** a **ATASCII**.
- **Tryb tylko do odczytu (Read-Only)**: Zaawansowana walidacja spójności alokacji sektorów dla wszystkich sześciu systemów plików – wykrywanie błędnych bitmap/map alokacji oraz bezpieczny odczyt uszkodzonych struktur. Reguły walidacji zostały odtworzone na podstawie kodu źródłowego biblioteki ATIO emulatora Altirra.
- **Zintegrowany pakiet szablonów DOS**: Automatyczna instalacja sektorów rozruchowych oraz plików systemowych (`DOS.SYS`, `DUP.SYS`) podczas tworzenia nowych dysków w standardowych gęstościach – dla Atari DOS 2.0S, Atari DOS 2.5, DOS II+/D oraz MyDOS 4.5x. Wszystkie pliki szablonów są bajt w bajt identyczne z oryginalnymi obrazami danego systemu DOS.
- **Inteligentne nazywanie plików przy zapisie**: Automatyczne sugerowanie standardowych nazw w formacie `GĘSTOŚĆ_DOS.atr` lub `GĘSTOŚĆ_DOS.xfd` (np. `SD_D20.atr`, `MD_D25.atr`, `DD_SDX.atr`, `DD_CPM.xfd`).

---

## 2. Obsługiwane Formaty Plików, Geometrie Dysków i Systemy Plików

### 2.1. Formaty Kontenerów Obrazów Dysków (Image Container Formats)

Aplikacja ATRaction zapewnia pełną obsługę dwóch głównych formatów kontenerów dyskowych używanych w emulacji komputera Atari 8-bit oraz na fizycznym sprzęcie:

#### 1. Format `.ATR` (Atari Disk Image)
- **Charakterystyka**: Standardowy i najpopularniejszy format kontenera dyskowego stworzony przez Nicka Kennedy'ego dla emulatora SIO2PC.
- **Struktura**: Obraz składa się z 16-bajtowego nagłówka binarnego oraz zrzutu sektorów dysku.
- **Sektory Startowe (Boot Sectors)**:
  - Format ATR nie posiada osobnego pola na liczbę sektorów startowych. Dla Atari **pierwsze 3 sektory są zawsze 128-bajtowe** – wynika to z ograniczeń sprzętowych ROM kontrolerów stacji dysków Atari 810/1050, które podczas rozruchu zawsze odczytują sektory 1–3 jako 128-bajtowe.
  - **Niejednoznaczność w podwójnej gęstości**: to, jak te trzy sektory są *fizycznie zapisane w pliku*, nie jest już jednoznaczne. Spotyka się trzy układy:
    1. **krótki** (typowy) – trzy sloty po 128 B, dane od offsetu $16+384$;
    2. **pełne sloty** – każdy sektor startowy zajmuje pełne 256 B, z czego znacząca jest tylko pierwsza połowa;
    3. **„packed"** – trzy sektory po 128 B jeden za drugim, a reszta trzeciego pełnego slotu wypełniona zerami.
  - Aplikacja rozróżnia je tak samo jak Altirra – po **liczbie paragrafów z nagłówka**. Paragraf to 16 B, a sektor 256 B to dokładnie 16 paragrafów, więc całkowita liczba pełnowymiarowych sektorów zawsze daje wielokrotność 16; prefiks $3\times128$ B dokłada 24 paragrafy i zostawia resztę 8. Reszta różna od zera oznacza układ krótki, reszta zero – jeden z dwóch pozostałych, rozróżnianych dodatkowo po tym, czy drugi 128-bajtowy slot niesie dane, a piąty jest pusty.
  - Rozróżnienie ma znaczenie krytyczne: przyjęcie układu krótkiego dla obrazu z pełnymi slotami przesuwa **każdy sektor od czwartego wzwyż o 384 B**, co wyprowadza VTOC poza zasięg i czyni wszystkie pliki nieczytelnymi. Dlatego aplikacja prowadzi dwie osobne liczby – *logiczną* (ile sektorów Atari widzi jako 128-bajtowe, zawsze 3) oraz *fizyczną* (ile jest tak zapisanych w pliku, 3 albo 0). Pierwsza wyznacza rozmiar sektora, druga – jego offset.
  - Przy tworzeniu obrazu o **geometrii niestandardowej** liczba sektorów startowych (0–255) jest dowolna, jednak przy sektorach 256 B ponowne wczytanie pliku zawsze przywróci wartość 3 (ograniczenie samego formatu ATR, nie aplikacji).
  - Przy sektorach **512 B** krótkie sektory startowe nie występują – wszystkie sektory obrazu mają jednakowy rozmiar.
  - Sektory od numeru `bootSectorCount + 1` wzwyż przyjmują pełny rozmiar zadeklarowany w nagłówku.
- **Formuła Obliczania Rozmiaru Danych (Payload)**, gdzie $B$ = liczba krótkich (128 B) sektorów startowych:
  - $\text{Payload} = B \times 128 + (N_{\text{sec}} - B) \times \text{RozmiarSektora}$
  - Dla standardowych gęstości SD/ED ($B=3$, sektor 128 B) upraszcza się do $N_{\text{sec}} \times 128$.
  - Dla standardowych gęstości DD/QD/720K ($B=3$, sektor 256 B) upraszcza się do $384 + (N_{\text{sec}} - 3) \times 256$.
  - Całkowity rozmiar pliku `.ATR`: $\text{Rozmiar Pliku} = 16\text{ B (Nagłówek)} + \text{Payload}$.

#### Szczegółowy Układ Nagłówka ATR (16 Bajtów):
| Offset (Hex) | Offset (Dec) | Typ / Długość | Opis / Wartość |
| :---: | :---: | :---: | :--- |
| `0x00 - 0x01` | `0 - 1` | `Uint16LE` (2B) | **Magic Header**: Stała wartość identyfikacyjna `0x0296` (`0x96`, `0x02`). |
| `0x02 - 0x03` | `2 - 3` | `Uint16LE` (2B) | **Liczba Paragrafów (Dolne 16 bitów)**: Paragraf = 16 bajtów. Wartość $= \lfloor \text{Payload} / 16 \rfloor$. |
| `0x04 - 0x05` | `4 - 5` | `Uint16LE` (2B) | **Rozmiar Sektora Danych**: `128`, `256` lub `512` bajtów. |
| `0x06 - 0x07` | `6 - 7` | `Uint16LE` (2B) | **Liczba Paragrafów (Górne 16 bitów)**: Rozszerzenie dla dużych obrazów dysków / partycji MyDOS/SpartaDOS (> 1 MB). |
| `0x08` | `8` | `Uint8` (1B) | **Ochrona przed Zapisem**: Bit 0 = 1 oznacza włączoną ochronę Write-Protect (`0x01`). Pozostałe bity `0`. |
| `0x09 - 0x0F` | `9 - 15` | `Bytes` (7B) | **Zarezerwowane**: Wypełnione wartościami `0x00`. |

#### 2. Format `.XFD` (XF551 / Raw Disk Image)
- **Charakterystyka**: Surowy zrzut sektorów (Raw Sector Dump) bez jakiegokolwiek nagłówka binarnego.
- **Jednolity Rozmiar Sektorów**: W odróżnieniu od ATR, w plikach XFD **wszystkie sektory mają identyczną długość** (128, 256 lub 512 B) – nie ma krótkich sektorów startowych.
- **Formuła Rozmiaru Pliku**: $\text{Rozmiar Pliku} = N_{\text{sec}} \times \text{Rozmiar Sektora}$.
- **Wykrywanie i Obsługa w ATRaction**:
  - Aplikacja automatycznie wykrywa pliki XFD podczas wczytywania (brak magic `0x0296` przy jednoczesnej podzielności rozmiaru przez 128 B).
  - W pamięci RAM tworzony jest wirtualny nagłówek ATR, umożliwiając pełną edycję.
  - Podczas wywoływania funkcji zapisu plik jest automatycznie konwertowany do czystego surowego formatu `.XFD` – każdy sektor jest fizycznie przepisywany do jednolitej siatki, tak by pozostał logicznie identyczny niezależnie od tego, czy pierwotnie był krótkim sektorem startowym w kontenerze ATR.

---

### 2.2. Specyfikacja Geometrii Dysków (Disk Geometries)

Aplikacja ATRaction obsługuje wszystkie standardowe geometrie dyskietek 8-bitowych Atari oraz geometrię niestandardową, wzorowaną na oknie *Create New Disk → Custom* emulatora Altirra:

| Geometria | Opis Gęstości | Sektory ($N_{\text{sec}}$) | Rozmiar Sektora | Sektory Startowe | Pojemność Payload | Rozmiar ATR | Rozmiar XFD |
| :---: | :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| **SD** | Single Density (SS/SD) | 720 | 128 B | 3 | **90 KB** (92 160 B) | 92 176 B | 92 160 B |
| **MD / ED** | Medium / Enhanced Density (SS/MD) | 1040 | 128 B | 3 | **130 KB** (133 120 B) | 133 136 B | 133 120 B |
| **DD** | Double Density (SS/DD) | 720 | 256 B | 3 | **180 KB** (183 936 B) | 183 952 B | 184 320 B |
| **QD** | Quad Density / DSDD | 1440 | 256 B | 3 | **368 KB** (368 256 B) | 368 272 B | 368 640 B |
| **720K** | DS/QD (Double Sided Quad Density) | 2880 | 256 B | 3 | **720 KB** (737 280 B) | 737 296 B | 737 280 B |
| **Niestandardowy** | Własna geometria / partycja | 1 .. 65535 | 128 / 256 / **512** B | 0 .. 255 | Zmienna, do ok. 32 MB | $16 + \text{Payload}$ | $N_{\text{sec}} \times \text{Size}$ |

#### Przeliczanie Offsetu Sektora w Pamięci ($B$ = liczba krótkich sektorów startowych, $S$ = numer sektora 1-indexed):
- **W formacie XFD**: $\text{Offset} = 16 + (S - 1) \times \text{RozmiarSektora}$
- **W formacie ATR**:
  - Jeśli $S \le B$: $\text{Offset} = 16 + (S - 1) \times 128$
  - Jeśli $S > B$: $\text{Offset} = 16 + B \times 128 + (S - 1 - B) \times \text{RozmiarSektora}$
  - Dla standardowych obrazów SD/ED ($B=0$ efektywnie, bo sektor już ma 128 B) oraz DD/QD/720K ($B=3$) wzór upraszcza się do klasycznych formuł znanych z wcześniejszych wersji aplikacji.

---

### 2.3. Macierz Kompatybilności Systemów Plików i Geometrii (DOS Compatibility Matrix)

Poniższa tabela odtwarza logikę `DiskManager.checkFormatSupport()` (odpowiednik `IsCurrentFormatSupported()` z okna *Create New Disk* Altirry), rozszerzoną o systemy plików dostępne wyłącznie w ATRaction. Okno tworzenia nowego dysku dostosowuje listę dostępnych gęstości dokładnie do tych reguł.

| System Plików | SD (90K) | MD/ED (130K) | DD (180K) | QD (368K) | 720K | Niestandardowy |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| **Atari DOS 2.0S** | Tak | Nie | Nie | Nie | Nie | Nie (poza opcją SD) |
| **Atari DOS 2.5** | Tak | Tak | Nie | Nie | Nie | Nie (poza opcjami SD/MD) |
| **DOS II+/D** | Tak | Tak (VTOC2 w sek. 359) | Tak | Nie | Nie | Tak (720 lub 1040 sekt., 128/256 B, 3 boot) |
| **MyDOS 4.5x** | Tak | Tak | Tak | Tak | Tak | Tak (od 720 sekt., 128/256 B, do 65535 sekt.) |
| **SpartaDOS (SDFS)** | Tak | Tak | Tak | Tak | Tak | Tak (od 16 sekt., **128/256/512 B**, do 65535 sekt.) |
| **LiteDOS-SE** | – | – | – | – | – | Brak wsparcia tworzenia nowych obrazów – wyłącznie odczyt/zapis/formatowanie istniejących dysków |
| **CP/M 2.2 (Indus GT)** | Nie | Nie | Tak | Nie | Nie | Tak (64–1068 sekt., wyłącznie 256 B) |
| **CP/M 2.2 (Atari 1090)** | Tak | Tak | Nie | Nie | Nie | Tak (102–1040 sekt., wyłącznie 128 B) |
| **Brak (dysk niesformatowany)** | Tak | Tak | Tak | Tak | Tak | Tak (dowolna geometria) |

Weryfikacja odbywa się przed utworzeniem obrazu, zarówno dla geometrii niestandardowej, jak i standardowych gęstości; przy niezgodnej kombinacji tworzenie dysku zostaje zablokowane wraz z komunikatem opisującym przyczynę. **Atari DOS 2.0S i Atari DOS 2.5 mają odrębne, ściślejsze ograniczenia niż DOS II+/D** – mimo że VTOC tych trzech systemów w gęstościach SD/DD bywa nie do odróżnienia, oryginalne wersje DOS 2.0S i DOS 2.5 nigdy nie były dystrybuowane poza wskazanymi gęstościami, więc okno tworzenia dysku i silnik formatujący odrzucają pozostałe kombinacje. **Dla geometrii niestandardowej instalacja plików systemowych (DOS.SYS / DUP.SYS) jest zawsze wyłączona** – gotowe szablony boot sektorów istnieją wyłącznie dla standardowych gęstości i na innej geometrii nie byłyby poprawnie ładowane.

---

### 2.4. Obsługiwane Systemy Plików (DOS File Systems)

#### 1. Atari DOS 2.0S (`Atari DOS`)
- **Przeznaczenie**: Wyłącznie gęstość SD (720 sektorów po 128 B) – oryginalny DOS 2.0S nigdy nie był dystrybuowany w innej geometrii, dlatego okno tworzenia dysku i `DiskManager.checkFormatSupport()` odrzucają MD, DD, QD i 720K dla tego systemu.
- **Struktura VTOC**: Sektor 360 zawiera bajt typu `0x02`, liczbę sektorów `707` (wartość zgodna z tym, co zapisuje sam DOS 2 oraz Altirra – `ATDiskFSDOS2::InitNew`) oraz mapę bitową wolnych sektorów (sektory 4..359 i 369..719; sektor 720 pozostaje trwale zarezerwowany, ponieważ klasyczny DOS 2 nie potrafi go zaadresować 90-bajtową bitmapą).
- **Katalog**: Sektory 361–368 (max 64 pliki, 8 wpisów na sektor po 16 bajtów).
- **Łańcuch sektorów**: Ostatnie 3 bajty każdego sektora pliku zawierają odnośnik do następnego sektora (bajt `secSize-3` i `secSize-2`) oraz długość danych w sektorze (`secSize-1`).
- **Instalacja plików systemowych**: Sektory startowe oraz pliki `DOS.SYS` (4875 B) i `DUP.SYS` (5126 B) instalowane przy tworzeniu nowego dysku są wyekstrahowane bajt w bajt z oryginalnego obrazu Atari DOS 2.0S i zweryfikowane testem porównującym je z dyskiem referencyjnym.
- **Obsługa ASCII Art oraz Wpisów Specjalnych**:
  - Silnik odczytu katalogów w ATRaction zezwala na dowolne znaki ATASCII (w tym symbole graficzne, znaki ramek scene'owych oraz znaki kontrolne używane do tworzenia rysunków ASCII Art w strukturalnym spisie plików, np. na dyskach demonstracyjnych takich jak `Sheol Side A.atr`).
  - Wpisy o sektorze startowym `0` lub długości `0` są akceptowane i wyświetlane w spisie plików zgodnie z zawartością dysku.
- **Filtrowanie Uszkodzonych Wpisów (`brokenDir`)**:
  - Aby skutecznie odróżniać celowe wpisy graficzne/ASCII Art od śmieci pozostałych po starym formatowaniu dysku, silnik weryfikuje legalność bitów flagi statusu oraz nieprzekraczalny zakres sektora startowego.
  - Napotkanie pustego slotu albo nielegalnych bitów flagi aktywuje stan `brokenDir = true`, ignorując resztkowe śmieci znajdujące się poza granicą aktywnego katalogu.

#### 2. Atari DOS 2.5 (`DOS2.5`)
- **Przeznaczenie**: Gęstość SD (720 sektorów) oraz MD/ED (1040 sektorów po 128 B, 130 KB) – nigdy DD, QD ani 720K.
- **Struktura VTOC**:
  - Sektor 360 obejmuje pierwsze 720 sektorów (`vtocType = 2`), tak jak w klasycznym DOS 2.
  - Sektor 1024 zawiera dodatkowy blok **VTOC2** o trzyczęściowej strukturze: bajty `0..83` to kopia bitmapy sektorów 48–719 z sektora 360, bajty `84..121` to bitmapa sektorów 720–1023, a bajty `122..123` to licznik wolnych sektorów w obszarze rozszerzonym (sektory 720–1023). Sektor 720 pozostaje zarezerwowany także w tym obszarze – DOS 2.5 premarkuje go jako zajęty (`byte 100 = 0x7F`), tak samo jak robi to Altirra przy walidacji.
  - Łącznie dysk DOS 2.5 na 1040 sektorach udostępnia 707 (obszar podstawowy) + 303 (obszar rozszerzony, sektory 721–1023) = 1010 wolnych sektorów na świeżo sformatowanym dysku.
  - Na dysku SD (720 sektorów) VTOC2 nie istnieje i obraz jest rozpoznawany po prostu jako `Atari DOS` – rozróżnienie DOS 2.0S / DOS 2.5 w tej gęstości nie jest możliwe po samej strukturze dysku, wynika wyłącznie z zawartości pliku `DOS.SYS`.
- **Katalog**: Sektory 361–368 (płaski katalog w obszarze podstawowym).
- **Instalacja plików systemowych**: Aplikacja instaluje wariant SD lub MD zależnie od wybranej gęstości. Sektory startowe (384 B) są **identyczne bajt w bajt** dla obu wariantów – zweryfikowane porównaniem dysków referencyjnych – natomiast plik `DOS.SYS` (4625 B) różni się między wariantami na 43 bajtach (osadzona tabela zależna od geometrii dysku); `DUP.SYS` (5126 B) jest wspólny dla obu.

#### 3. DOS II+/D (`DOS II+/D`)
- **Przeznaczenie**: Gęstości SD (720 sektorów 128 B), MD (1040 sektorów 128 B) oraz DD (720 sektorów 256 B). Autorstwa Stefana Dorndorfa.
- **Rozpoznawanie w SD/DD**: VTOC DOS II+/D w gęstościach SD i DD jest niemożliwy do odróżnienia od klasycznego DOS 2 (ten sam bajt typu `0x02`, ta sama liczba `707`). System jest w tym wypadku rozpoznawany po **sygnaturze bloku rozruchowego**: bajt 0 sektora 1 równy `0xC4` w połączeniu z charakterystycznym fragmentem kodu startowego (`38 B0` pod offsetem 6–7). Sygnatura ta została zweryfikowana na niezależnym dysku z epoki (`_disks/Forever5.atr`).
- **Struktura VTOC w MD**:
  - Sektor 360 zawiera bajt typu `0x03` oraz całkowitą liczbę sektorów danych `1009`. Przechowuje mapę sektorów 0..943.
  - Sektor 359 służy jako pomocnicza mapa bitowa (VTOC2) przechowująca status sektorów 944..1023 (10 bajtów mapy). **Najwyższym adresowalnym sektorem DOS II+/D jest zatem 1023, tak samo jak w DOS 2.5** – na obrazie 1040-sektorowym ostatnie 17 sektorów nie ma bitu w żadnej mapie i jest pomijanych przy weryfikacji alokacji (inaczej każdy taki dysk, łącznie ze świeżo sformatowanym, zgłaszałby 17 fałszywie zagubionych sektorów). Sektor 720 jest zarezerwowany również w tym systemie.
- **Katalog**: Sektory 361–368.

#### 4. MyDOS 4.5x (`MyDOS`)
- **Przeznaczenie**: Wszystkie gęstości dyskietek (SD 90K, MD 130K, DD 180K, QD 368K, DS/QD 720K) oraz dyski twarde i RAMdyski o pojemności do 16 MB (do 65535 sektorów, także w geometrii niestandardowej). Autorstwa Charlesa Marsletta i Roberta Puffa (1988).
- **Model Bitmapy VTOC** *(zweryfikowany na rzeczywistym dysku QD `_disks/XL Digital.atr` oraz na kodzie źródłowym `ATDiskFSDOS2::InitNew` z biblioteki ATIO Altirry)*:
  - Bitmapa alokacji jest **jednym ciągłym strumieniem bitów**: bit sektora $N$ znajduje się pod bitem $N$, licząc od bajtu 10 sektora 360.
  - Strumień jest mierzony w 256-bajtowych "stronach". Pierwsza strona to sektor 360 (do 943 sektorów mieści się w jednej stronie – 128 B w gęstości pojedynczej, w podwójnej cała strona to jeden sektor). Dodatkowe strony dopisywane są w dół: sektor 359, 358, itd. – w gęstości pojedynczej po dwa sparowane sektory na stronę, w podwójnej po jednym.
  - Bajt 0 sektora 360 (`vtocByte`) koduje liczbę stron + 2: `0x02` dla dysków do 943/1023 sektorów (1 sektor VTOC), `0x03` dla dysków do ok. 1968 sektorów, `0x04` dla większych (np. DS/QD 2880 sektorów → 2 sektory VTOC). **Na dyskach twardych wartość ta wykracza daleko poza zakres 2–5 typowy dla DOS 2** – pełny obraz 16 MB (65535 sektorów po 256 B) daje 33 strony bitmapy, czyli `vtocByte` = `0x23` (35) i 33 sektory VTOC (360 w dół do 328). Detekcja systemu plików akceptuje więc każdą wartość, której VTOC mieści się jeszcze pomiędzy sektorami startowymi a katalogiem głównym; wartość powyżej `0x05` jest sama w sobie sygnaturą MyDOS, ponieważ DOS 2 nigdy nie zapisuje wielostronicowego VTOC-a.
  - Pole `total` (bajty 1–2 VTOC) przechowuje liczbę *użytecznych sektorów danych* (fizyczna liczba sektorów minus 3 rozruchowe, minus sektory VTOC, minus 8 sektorów katalogu głównego) – nie fizyczny rozmiar dysku.
- **Rozszerzone Numery Sektorów**: Dyski powyżej 943 sektorów nie mieszczą numeru sektora w 10-bitowym łączu klasycznego DOS 2, dlatego MyDOS przełącza się na pełne 16-bitowe numery sektorów (bit `0x04` flagi wpisu katalogowego, wartość flagi `0x46` zamiast `0x42`).
- **Struktura Podkatalogów**:
  - Katalog główny (Root Directory) oraz każdy podkatalog zajmują dedykowany blok **8 kolejnych, sąsiadujących sektorów**, mieszcząc do **64 plików lub podkatalogów** (8 wpisów na sektor katalogowy, również w gęstości podwójnej).
  - Brak sztywnego limitu liczby podkatalogów na dysku (ograniczeniem jest jedynie pojemność dysku i bufor pamięci programu) – pojedyncza dyskietka może zawierać setki plików ułożonych w głębokie drzewa.
  - Wpis katalogowy posiadający bit `0x10` w fladze statusu oznaczony jest jako podkatalog.
  - Ścieżki podkatalogów w MyDOS mogą być rozdzielane znakiem dwukropka `:` lub znakiem większości `>` (np. `BAS:GRAPHIC1` lub `BAS>GRAPHIC1`).
  - Usunięcie podkatalogu jest możliwe tylko wtedy, gdy jest on pusty.
- **Nazywanie Plików i Walidacja przy Edycji**:
  - **Wyświetlanie**: Podobnie jak w Atari DOS, przy listowaniu katalogu wyświetlane są wszystkie oryginalne bajty ATASCII wpisu.
  - **Edycja/Import**: Podczas tworzenia nowych plików, podkatalogów oraz przy zmianie nazwy egzekwowana jest ścisła walidacja, usuwająca niedozwolone znaki sterujące i dopasowująca nazwy do standardu (1-8 znaków nazwy, 0-3 rozszerzenia, dozwolone litery, cyfry, `_` oraz `@`, zakaz cyfry na pierwszej pozycji).
  - **Symbole wieloznaczne (Wildcards)**:
    - Znak `*` lub sekwencja `.*` kończy pole nazwy (8 znaków) lub rozszerzenia (3 znaki) i dopasowuje wszystkie pozostałe znaki.
    - Znak `?` zastępuje dokładnie 1 znak w nazwie lub rozszerzeniu.

#### 5. SpartaDOS (`SpartaDOS` / SDFS)
- **Przeznaczenie**: Wszystkie gęstości z profesjonalnym systemem plików SDFS (SpartaDOS File System), w tym geometria niestandardowa z sektorami **512 B**.
- **Struktura SDFS**:
  - Sektor 1 zawiera strukturę **Boot Block** ze wskaźnikami mapy sektorów (`sectorMap`), całkowitej liczby sektorów oraz katalogu głównego.
  - Rozmiar sektora kodowany jest zarówno bezpośrednio (bajty 33–34), jak i w bajcie 31 wg konwencji Altirry: `128` → 128 B, `0` → 256 B, `1` → 512 B. Bajt 7 bloku boot niesie sygnaturę formatu: `0x80` dla wolumenów SD/DD, `0x40` dla wolumenów z sektorami 512 B – po tej sygnaturze aplikacja rozpoznaje SpartaDOS jeszcze przed sondą VTOC innych systemów.
  - Liczba sektorów startowych zależy od rozmiaru sektora: **3** dla sektorów do 256 B, **1** dla sektorów 512 B (przy 512 B sektor 2 jest już częścią mapy bitowej, nie kodu rozruchowego).
  - Każdy plik oraz katalog posiada własny **File Map / Sector Map** (łańcuch sektorów SUSB wskazujący bloki danych, z maksymalną liczbą wpisów `(sectorSize - 4) / 2` na jeden sektor mapy).
  - Prawdziwa struktura katalogowa z nieograniczoną głębokością podkatalogów.
- **Atrybuty Plików (A H P)**:
  - Bajt statusu (bajt 0 wpisu katalogowego) obsługuje standardowe flagi SpartaDOS SDFS:
    - **`P` (Protected)**: Ochrona pliku przed modyfikacją oraz usunięciem.
    - **`H` (Hidden)**: Ukrywanie pliku w katalogu.
    - **`A` (Archive)**: Flaga archiwizacji / modyfikacji pliku.
  - Aplikacja ATRaction umożliwia pełny odczyt i edycję atrybutów `A`, `H`, `P` dla dysków SpartaDOS / SDFS poprzez dedykowany modal **Edytuj Atrybuty**, dostępny wyłącznie dla tego systemu plików.
- **Odporność na Błędy Zapisu**: Operacje `importFile`, `createDirectory` oraz alokacja sektorów najpierw rezerwują całą wymaganą przestrzeń (dane + mapa sektorów), a dopiero potem zapisują strukturę katalogową. W razie niepowodzenia na dowolnym etapie zaalokowane sektory są automatycznie zwalniane, co zapobiega powstawaniu osieroconych (zagubionych) sektorów w bitmapie.

#### 6. LiteDOS-SE (`LiteDOS-SE`)
- **Przeznaczenie**: Odczyt, edycja i formatowanie istniejących dysków LiteDOS-SE – lekkiego systemu plików autorstwa Mr Atari, zgodnego z Atari DOS 2 na poziomie sektorów rozruchowych. **Tworzenie nowych obrazów w tym formacie nie jest obsługiwane** – gotowe szablony boot sektorów dla LiteDOS nie istnieją, więc `createNew` dla tego systemu zgłasza jawny wyjątek.
- **Rozpoznawane Warianty** *(na podstawie sekcji technicznej instrukcji LiteDOS-SE)*:
  - **LiteDOS-SE (klasyczny)** – bity 7–6 bajtu ID sektora 360 równe `01`. Bajt `$00` niesie rozmiar klastra (dolne 6 bitów, `clusterSize - 1`), bajty `$01-$02` całkowitą liczbę sektorów, `$03-$04` liczbę wolnych sektorów, bajty `$05-$09` są zawsze zerowe (kryterium detekcji), a bitmapa klastrów zaczyna się pod offsetem `$0A` i ma 118 bajtów (SD) lub 128 bajtów (DD).
  - **LiteDOS 2.x** – bity `10`, sygnatura tekstowa `LiteDOS` pod offsetem `$03`, 64-bajtowa (512-bitowa) bitmapa klastrów od offsetu `$20`, 24-bitowy licznik wolnych sektorów pod `$71`.
- **Alokacja Klastrowa**: Jednostką alokacji jest **klaster** – potęga dwójki od 1 do 64 sektorów. Rozmiar klastra dobierany jest tak, by 512-bitowa (SE) lub 944/1024-bitowa bitmapa pomieściła cały dysk; przy formatowaniu przez ATRaction rozmiar klastra jest automatycznie zwiększany, aż zmieści się w dostępnej bitmapie.
- **Obszar VTOC i Katalogu**: Zajmuje dwa klastry wyrównane do granicy podwójnego klastra i zawsze obejmujące sektor 360 (np. przy klastrze 1: sektory 360–361; przy klastrze 8: sektory 352–367). Katalog zaczyna się od sektora 361 i "zawija się" wewnątrz tego obszaru, omijając sam sektor 360. Każdy sektor katalogowy mieści zawsze 8 wpisów, również w gęstości podwójnej.
- **Obszar Jądra Systemu**: LiteDOS nie ma pliku `DOS.SYS` – jego niewielkie jądro (ok. 2 KB) leży w klastrach bezpośrednio za obszarem VTOC, oznaczonych w bitmapie jako zajęte, choć nieprzypisanych do żadnego pliku. Silnik walidacji rozpoznaje ten wiodący ciąg alokowanych, niczyich klastrów jako obszar systemowy i nie zgłasza go jako zagubionych sektorów.
- **Łącza Sektorów**: 10-bitowe (z numerem pliku w górnych bitach, flaga `0x42`) dla dysków do 1024 sektorów, 16-bitowe (flaga `0x46`) dla większych.

#### 7. CP/M 2.2 dla stacji Indus GT (`CP/M 2.2 (Indus GT)`)
- **Przeznaczenie**: Dyski o sektorach 256-bajtowych dla stacji dysków Indus GT uruchamiających wbudowany system CP/M 2.2 na procesorze Z80. Obsługiwany zakres to **64–1068 sektorów** (odpowiednik `ATDiskFSCPM` z biblioteki ATIO Altirry), co obejmuje zarówno standardowy dysk DD 180 KB (720 sektorów), jak i geometrię niestandardową.
- **Szyfrowanie / Maskowanie Bitowe (XOR 0xFF)**: Wszystkie bajty nagłówków katalogowych oraz zawartość sektorów plików są na dysku zapisywane w formie zanegowanej bitowo (`byte ^ 0xFF`). Aplikacja transparentnie deszyfruje dane przy odczycie oraz szyfruje przy zapisie. Zgodność tej konwencji potwierdza dokumentacja Altirry (`.diskdumpsec -i`): *"disk formats that are non-inverted on disk and thus inverted from the view of the computer (Atari 815, Indus GT CP/M)"*.
- **Struktura Katalogu i Alokacji**:
  - Sektory 1–36 to zarezerwowane ścieżki systemowe (2 ścieżki po 18 sektorów), nieużywane przez samo CP/M.
  - Katalog zajmuje sektory logiczne 37–44 (bloki alokacji 0–1, mieści do 64 wpisów katalogowych / ekstentów po 32 bajty).
  - Jednostka alokacji (blok) wynosi 1 KB (4 sektory po 256 B); liczba bloków dysku wynika z jego rozmiaru: $\text{Bloki} = (N_{\text{sec}} - 36) / 4$. Na standardowym dysku 720-sektorowym daje to 171 bloków, z czego ostatni kończy się dokładnie na sektorze 720.
  - Blok $b$ zaczyna się na sektorze fizycznym $37 + 4b$; dane zaczynają się od bloku 2.
  - Brak podkatalogów (płaski katalog CP/M).
  - Numer ekstentu kodowany jest w dwóch polach wpisu katalogowego: dolne 5 bitów w bajcie EX (offset 12), górne bity w bajcie S2 (offset 14) – `logicalExt = (EX & 31) | ((S2 & 15) << 5)`.
  - Rozmiar pliku wyliczany jest z **najwyższego posiadanego ekstentu** (a nie sumy rekordów wszystkich ekstentów), co pozostaje poprawne nawet przy brakującym pośrednim ekstencie: $\text{Rozmiar} = \text{ExtentNr} \times 16384 + \min(\text{RC}, 128) \times 128$. Ponieważ CP/M przechowuje jedynie liczbę 128-bajtowych rekordów, odczytany rozmiar pliku jest zawsze zaokrąglony w górę do wielokrotności 128 bajtów.
  - Obsługa atrybutu **Read-Only (R/O)** zapisywanego w najstarszym bicie pierwszego znaku rozszerzenia pliku.
- **Wykrywanie Formatu**: Aplikacja rozpoznaje CP/M na dwa sposoby – po sygnaturze rozruchowej `$F3 $22 $55 $7F` w sektorze 1 (dokładnie ta, po której rozpoznaje go Altirra w `ATDiskMountImage`) lub, dla dysków bez tej sygnatury, po strukturalnej weryfikacji całego katalogu (poprawne numery użytkowników, drukowalne nazwy plików, liczniki rekordów w granicach 0–128, bloki alokacji w dopuszczalnym zakresie). Pusty, świeżo sformatowany dysk (cały katalog wypełniony bajtem $E5$) jest również poprawnie rozpoznawany.

#### 8. CP/M 2.2 dla karty CP/M Atari 1090 (`CP/M 2.2 (Atari 1090)`)
- **Przeznaczenie**: Dyskietki o sektorach 128-bajtowych (SD 720 lub MD 1040 sektorów) zapisywane przez kartę CP/M rozszerzenia **Atari 1090**, na której CP/M 2.2 pracuje na procesorze Z80. To ten sam system plików co w wariancie Indus GT, ale inaczej rozmieszczony na nośniku i **bez negacji bajtów** – dane leżą na dysku dokładnie tak, jak widzi je komputer.
- **Źródło Parametrów**: Geometria pochodzi z tablicy DPB w BIOS-ie karty (sektor 28 dysku systemowego): `SPT = 26`, `BSH = 3`, `BLM = 7`, `EXM = 0`, `DSM = 118`, `DRM = 63`, `AL0 = $C0`, `CKS = 16`, `OFF = 3`. W tablicy DPH pole XLT wynosi 0, czyli **BIOS nie stosuje translacji (przeplotu) sektorów** – rekord CP/M odpowiada wprost jednemu sektorowi Atari, a adresowanie jest liniowe.
- **Struktura Katalogu i Alokacji**:
  - Sektory 1–78 to obszar systemowy (`OFF` = 3 ścieżki po `SPT` = 26 rekordów). Na dysku bootowalnym mieszczą się tam ładowacz Atari oraz CCP, BDOS i BIOS karty; na dysku z danymi obszar ten bywa wyzerowany.
  - Katalog zajmuje sektory 79–94 (bloki alokacji 0–1, do 64 wpisów katalogowych / ekstentów po 32 bajty).
  - Jednostka alokacji (blok) wynosi 1 KB, czyli 8 sektorów po 128 B; blok $b$ zaczyna się na sektorze fizycznym $79 + 8b$, a dane zaczynają się od bloku 2.
  - Liczba bloków to **mniejsza** z dwóch wartości: limitu ogłoszonego przez DPB ($DSM + 1 = 119$) oraz pojemności nośnika $(N_{sec} - 78) / 8$ zaokrąglonej w dół. Dla dysku MD (1040 sektorów) wiążący jest DPB – 119 bloków zamiast 120 fizycznie mieszczących się na dyskietce; dla dysku SD (720 sektorów) wiążący jest nośnik – 80 bloków. Dzięki temu aplikacja nigdy nie przydziela bloku, którego nie wydałby prawdziwy system.
  - Pozostałe reguły – kodowanie numeru ekstentu w polach EX/S2, wyliczanie rozmiaru pliku z najwyższego ekstentu, atrybut **Read-Only** w najstarszym bicie pierwszego znaku rozszerzenia, brak podkatalogów – są wspólne z wariantem Indus GT.
- **Kontener**: Obrazy 1090 to zwykłe, bootowalne pliki `.ATR` i takie pozostają przy zapisie. W odróżnieniu od wariantu Indus GT aplikacja **nie** konwertuje ich do `.XFD`.
- **Wykrywanie Formatu**: Wyłącznie przez strukturalną weryfikację katalogu w sektorach 79–94 (bez negacji bajtów) – tymi samymi regułami co w wariancie Indus GT. Sektor rozruchowy nie zawiera sygnatury nadającej się do rozpoznania: dyski z danymi w ogóle nie mają obszaru systemowego, a dyski systemowe zaczynają się od zwyczajnego ładowacza Atari.
- **Ograniczenia**: Obsługiwane są wyłącznie nośniki 128-bajtowe. BIOS karty zawiera także tablice DPB dla dysków 256-bajtowych (`SPT = 36`, odpowiedniki DD i QD, w wariantach `OFF = 1` i `OFF = 3`), ale bez obrazu referencyjnego nie sposób zweryfikować mapowania rekordów na sektory, więc pozostają one nieobsługiwane. Aplikacja formatuje nowe dyski 1090, lecz **nie instaluje systemu CP/M** – tak utworzony dysk nie jest bootowalny. Formatowanie istniejącego dysku nie narusza sektorów 1–78, więc dysk systemowy zachowuje zdolność rozruchu.

---

### 2.5. Weryfikacja Alokacji, Niestandardowego Rozmiaru Dysku i Tryb "Read-Only"

Reguły walidacji zostały odtworzone na podstawie kodu źródłowego biblioteki **ATIO** emulatora Altirra (`ATDiskFSDOS2::Validate`, `ATDiskFSSDX2::Validate`, `ATDiskFSCPM::RecomputeBlockBitmap`) i obejmują **wszystkie sześć obsługiwanych systemów plików** – Atari DOS 2, DOS 2.5, DOS II+/D, MyDOS, SpartaDOS oraz LiteDOS-SE i CP/M.

- **Przechodzenie drzewa katalogów**: Przy otwieraniu obrazu algorytm rekursywnie przechodzi całą strukturę katalogów, zbierając zbiór sektorów (lub bloków/klastrów) faktycznie używanych przez pliki i podkatalogi, a następnie konfrontuje go z mapą/bitmapą alokacji zapisaną na dysku.
- **Detekcja niestandardowego rozmiaru dysku**: Przetwarzanie odnosi fizyczny rozmiar pliku `.ATR` oraz nagłówek paragrafów do matematycznego wyliczenia (nagłówek 16 B + sektory startowe + sektory danych, patrz sekcja 2.1). W przypadku obciętego pliku, nadmiarowych bajtów lub niezgodności liczby sektorów ze standardem danej gęstości, w panelu bocznym generowane jest ostrzeżenie informujące o ryzyku modyfikacji. Samo odstępstwo liczby sektorów od pięciu formatów dyskietkowych **nie** jest zgłaszane na dyskach MyDOS i SpartaDOS – oba systemy z założenia adresują dowolną geometrię do 65535 sektorów, więc obraz dysku twardego czy partycji jest tam sytuacją normalną, a nie podejrzaną.
- **Montowanie w trybie tylko do odczytu (Read-Only)**: Obraz zostaje zamontowany w trybie tylko do odczytu, gdy wykryta zostanie **poważna** niezgodność:
  - **nagłówek ATR deklaruje inny rozmiar obrazu, niż wynika z rzeczywistej długości pliku** (obraz obcięty przy transferze albo z doklejonymi danymi). Geometria obiecana przez nagłówek nie jest tą, która faktycznie znajduje się w pliku, więc sektor, do którego aplikacja by zapisała, nie musi być sektorem wskazywanym przez nagłówek. Komunikat podaje obie wartości oraz różnicę. Kontrola nie dotyczy obrazów XFD, które własnego nagłówka nie mają (jest on syntetyzowany z długości pliku),
  - sektor/blok używany przez plik jest w mapie alokacji oznaczony jako wolny,
  - licznik wolnych sektorów zapisany w nagłówku (VTOC / boot block) nie zgadza się z rzeczywistą liczbą wolnych bitów w mapie,
  - ten sam sektor lub blok jest przypisany do dwóch różnych plików jednocześnie,
  - wpis katalogowy wskazuje sektor lub blok poza fizycznym obszarem dysku.
- **Samo Ostrzeżenie (dysk pozostaje zapisywalny)**: Gdy jedyną wykrytą niezgodnością są tzw. **zagubione sektory** – oznaczone w mapie jako zajęte, choć żaden plik ich nie używa – obraz pozostaje w pełni zapisywalny, a w panelu bocznym pojawia się jedynie informacyjne ostrzeżenie. Dotyczy to również obszaru jądra systemowego LiteDOS, który jest rozpoznawany osobno i nie generuje fałszywego ostrzeżenia.
- **Reguły specyficzne dla systemu**:
  - *Atari DOS 2 / DOS II+/D*: sektor 720 jest trwale zarezerwowany (nieadresowalny 90-bajtową bitmapą klasycznego DOS 2). **Zarezerwowany nie znaczy zajęty**: nie leżą tam żadne dane, więc bitmapa opisująca go jako wolny jest tylko niechlujna, a nie groźna – przydzielenie tego sektora niczego by nie nadpisało. Taki dysk nie jest z tego powodu montowany jako tylko do odczytu; blokada dotyczy wyłącznie sektorów faktycznie należących do plików lub struktur katalogu.
  - *DOS 2.5*: dodatkowo porównywana jest zgodność kopii bitmapy w VTOC2 (bajty 0–83 sektora 1024) z oryginałem w sektorze 360 oraz zgodność licznika wolnych sektorów obszaru rozszerzonego. **Licznik wolnych sektorów jest rozdzielony na dwa obszary** – sektor 360 zlicza sektory 0–719, a VTOC2 osobno 720–1023 – więc o tym, czy dysk jest pełny, decyduje suma obu. Ocenianie po samym liczniku z sektora 360 blokowało dyski mające jeszcze miejsce w obszarze rozszerzonym.
  - *MyDOS*: uwzględniana jest wielosektorowa, stronicowana bitmapa VTOC (sekcja 2.4.4) oraz to, że podkatalog zajmuje 8 kolejnych sektorów bez własnego łańcucha.
  - *SpartaDOS*: dodatkowo weryfikowana jest zgodność licznika wolnych sektorów w bloku rozruchowym z sumą wolnych bitów mapy. Zakres kontroli wyznacza **liczba sektorów zadeklarowana w bloku rozruchowym**, a nie rozmiar pliku – nadmiarowy zrzut (np. wolumin 720-sektorowy zapisany w obrazie 1120-sektorowym) zawiera sektory spoza woluminu, które nie mają sensownego bitu w mapie. **Ostatni sektor woluminu** – niezależnie od jego rozmiaru – bywa trwale oznaczany jako zajęty przez oryginalny formater SpartaDOS (potwierdzone na woluminach 720- i 1040-sektorowych; obrazy tworzone przez ATRaction i Altirrę zostawiają go wolnym) i jest traktowany jako zarezerwowany, a nie zagubiony. Reguła działa tylko wtedy, gdy bitmapa faktycznie opisuje go jako zajęty, więc zagubiony sektor w środku woluminu nadal jest zgłaszany.
  - *CP/M*: ze względu na brak jawnej bitmapy alokacji jedynym możliwym uszkodzeniem strukturalnym jest blok przypisany do dwóch ekstentów lub blok wskazujący poza obszar danych dysku – oba przypadki skutkują trybem tylko do odczytu.
- **Ochrona danych i dostęp do plików**: W trybie tylko do odczytu cała zawartość dysku i lista plików pozostaje w pełni dostępna do przeglądania i pobierania na PC, natomiast wszelkie operacje modyfikujące dysk (dodawanie plików, zmiana nazwy, usuwanie, zmiana blokad/atrybutów, tworzenie podkatalogów) są wyłączane, a w panelu bocznym pojawia się stosowne ostrzeżenie z opisem przyczyny.

---

## 3. Przewodnik po Interfejsie Użytkownika

Interfejs użytkownika składa się z 4 głównych sekcji:
- **Pasek Akcji Głównych (Header)**: Pozwala na otwieranie obrazów `.ATR`/`.XFD`, tworzenie nowych dysków, zapis zmodyfikowanych obrazów oraz otwarcie okna **Instrukcja**.
- **Panel Boczny (Sidebar)**: Wyświetla parametry dysku (gęstość, wolne sektory, pasek zajętości, ostrzeżenia i stan Read-Only) oraz drzewo podkatalogów (dla MyDOS / SpartaDOS).
- **Pasek Narzędziowy Tabeli (Toolbar)**: Udostępnia przyciski operacji na plikach (dodawanie, zmiana nazwy, usuwanie, podgląd, pobieranie, zmiana blokady, edycja atrybutów SpartaDOS, podgląd w ATASCII).
- **Tabela Plików (Main Workspace)**: Prezentuje listę plików i katalogów wraz z ich rozmiarem, sektorami startowymi, atrybutami oraz akcjami podglądu i pobierania.

### 3.1. Pasek Akcji Głównych (Header)
- **Otwórz ATR / XFD**: Otwiera okno wyboru pliku `.ATR` lub `.XFD` z lokalnego dysku komputera. Obsługiwana jest również funkcja **Drag & Drop** (przeciągnięcie i upuszczenie pliku `.ATR` lub `.XFD` w dowolnym miejscu okna).
- **Nowy Dysk**: Wyświetla modal tworzenia nowego obrazu ATR/XFD z opcją formatowania pod wybrany system (Atari DOS 2.0S, Atari DOS 2.5, DOS II+/D, MyDOS, SpartaDOS, CP/M 2.2 lub brak systemu plików) i wyborem gęstości standardowej lub **Niestandardowej**.
- **Zapisz ATR / XFD**: Pobiera zmodyfikowany obraz ATR lub XFD na komputer użytkownika. Nazwa pliku jest generowana automatycznie wg wzorca gęstości i systemu plików (np. `SD_D20.atr`, `MD_D25.atr`, `MD_D2P.atr`, `DD_CPM.xfd`).
- **Instrukcja**: Otwiera okno z pełną instrukcją obsługi i opisem obsługiwanych formatów, dostępne z każdego miejsca aplikacji.

### 3.2. Panel Boczny (Sidebar)
Panel boczny posiada rozszerzoną szerokość **330px**, co zapewnia wygodny i przejrzysty odczyt statystyk oraz ścieżek podkatalogów.
- **Karta Parametrów Dysku**: Wyświetla system plików, gęstość, całkowitą liczbę sektorów, wolne sektory, wolne miejsce w bajtach oraz wizualny pasek zajętości.
  - **Obsługa Niestandardowych Parametrów oraz Tryb Read-Only**: Gdy odczytane wolne sektory wykraczają poza fizyczną pojemność dysku, wartości zastępowane są czerwonym znakiem zapytania (`?`), a pasek zajętości zostaje ujednolicony. W przypadku wykrycia błędnej mapy alokacji pojawia się ostrzeżenie informujące o zamontowaniu dysku w trybie tylko do odczytu (patrz sekcja 2.5).
- **Drzewo Katalogów**: Interaktywne drzewo pozwalające na szybkie przechodzenie między katalogiem głównym a podkatalogami w MyDOS / SpartaDOS. Panel jest automatycznie ukrywany dla systemów jednopoziomowych.

### 3.3. Pasek Narzędziowy Tabeli (Toolbar)
- **Dodaj Plik**: Wgrywa plik binarny lub tekstowy z PC do aktywnego katalogu na obrazie ATR.
- **Nowy Katalog**: Tworzy nowy podkatalog (aktywny tylko dla MyDOS i SpartaDOS).
- **Pobierz Plik**: Pobiera zaznaczony plik na komputer PC.
- **Zmień Nazwę**: Zmienia nazwę zaznaczonego pliku lub katalogu (konwertuje wpisaną nazwę na format 8.3 ATASCII / CP/M).
- **Zablokuj/Odblokuj**: Przełącza atrybut ochrony pliku przed zapisem/skasowaniem (`Locked` / `Read-Only`).
- **Edytuj Atrybuty**: Widoczny wyłącznie dla dysków SpartaDOS SDFS – otwiera modal edycji atrybutów `A` (Archive), `H` (Hidden) i `P` (Protected).
- **Usuń**: Usuwa zaznaczony plik lub podkatalog z obrazu dysku oraz uwalnia jego sektory w mapie alokacji.
- **Podgląd / Hex**: Otwiera okno podglądu zawartości pliku.
- **Katalog ATASCII**: Wyświetla modal podglądu całego katalogu w formacie ATASCII z użyciem oryginalnego fontu Atari. Prezentuje pliki w formacie 40-kolumnowym ekranu Atari oraz surową zawartość sektorów katalogowych.
- **Wyszukiwarka**: Filtruje pliki w tabeli w czasie rzeczywistym wg wpisanej frazy.

---

## 4. Instrukcje Krok po Kroku (Tutoriale)

### Tutorial 1: Tworzenie Nowego Obrazu Dyskietki ATR / XFD

1. Kliknij przycisk **Nowy Dysk** na górnym pasku akcji.
2. W oknie modalnym wybierz pożądany **System Plików / DOS**:
   - `Atari DOS 2.0S (SD)` – *Wierna kopia oryginalnego DOS 2.0S, dostępna wyłącznie w gęstości SD*.
   - `Atari DOS 2.5 (SD / MD)` – *DOS 2.5 z obsługą 130 KB (MD/ED), dostępny w SD i MD*.
   - `DOS II+/D (SD / MD / DD)` – *Zalecany dla standardowych gier i użytku ogólnego*.
   - `MyDOS 4.5x` – *Gdy planujesz używać podkatalogów*.
   - `Sparta DOS` – *Dla zaawansowanych środowisk SpartaDOS, także z sektorami 512 B*.
   - `CP/M 2.2 (Indus GT - DD 180 KB)` – *Dla stacji Indus GT z systemem CP/M 2.2*.
   - `CP/M 2.2 (Atari 1090 - SD / MD)` – *Dla karty CP/M urządzenia Atari 1090; tworzony dysk jest pusty i niebootowalny, bo aplikacja nie instaluje systemu CP/M*.
   - `Brak (dysk niesformatowany)` – *Gdy potrzebny jest surowy obraz bez systemu plików, np. do dalszej obróbki w innym narzędziu*.
3. Wybierz **Gęstość i Rozmiar Dysku**:
   - `SD` (90 KB), `MD` (130 KB), `DD` (180 KB), `QD` (368 KB), `720K` lub **`Niestandardowy`**.
   - Lista dostępnych gęstości dostosowuje się automatycznie do wybranego systemu plików zgodnie z macierzą kompatybilności (sekcja 2.3) – `Atari DOS 2.0S` oferuje wyłącznie SD, `Atari DOS 2.5` wyłącznie SD i MD, a DOS II+/D nie oferuje QD ani 720K.
4. Upewnij się, że opcja **Zainstaluj pliki systemowe DOS** jest zaznaczona, jeśli tworzysz dysk samobootujący (zostaną zapisane sektory rozruchowe oraz pliki `DOS.SYS` / `DUP.SYS`, bajt w bajt identyczne z oryginalnymi obrazami danego systemu). Opcja jest automatycznie wyłączana i blokowana dla SpartaDOS, CP/M oraz geometrii niestandardowej.
5. Kliknij **Utwórz Dysk**. Wskaźniki w panelu bocznym zaktualizują się automatycznie.

---

### Tutorial 1b: Tworzenie Dysku o Geometrii Niestandardowej

1. W kroku 3 powyższego tutoriala wybierz gęstość **`Niestandardowy`** – pod listą pojawią się trzy dodatkowe pola, odpowiadające opcji *Custom* z okna *Create New Disk* emulatora Altirra:
   - **Liczba sektorów** – od liczby sektorów startowych do 65535.
   - **Sektory startowe** – 0–255. Pole jest automatycznie wyłączane po wybraniu sektorów 512-bajtowych, które krótkich sektorów startowych nie mają.
   - **Rozmiar sektora** – 128, 256 lub 512 bajtów. Sektory 512 B obsługuje wyłącznie SpartaDOS.
2. Pod polami na bieżąco wyświetlany jest wynikowy rozmiar obrazu w KB oraz w bajtach.
3. Jeśli wybrana kombinacja systemu plików i geometrii jest niezgodna (patrz macierz kompatybilności, sekcja 2.3), pod polami pojawia się czerwony komunikat z przyczyną, a przycisk **Utwórz Dysk** zostaje zablokowany.
4. Instalacja plików systemowych jest dla tej geometrii zawsze wyłączona i niedostępna do zaznaczenia.
5. Kliknij **Utwórz Dysk**, aby zatwierdzić.

---

### Tutorial 2: Wgrywanie i Edycja Plików na Obrazie ATR

1. **Wgrywanie pliku z PC**:
   - Kliknij przycisk **Dodaj Plik** na pasku narzędzi.
   - Wybierz plik z dysku komputera (np. plik wykonywalny `.XEX`, `.COM`, `.OBJ` lub plik danych `.BAS`, `.TXT`).
   - Nazwa pliku zostanie automatycznie sformatowana do standardu Atari 8.3 ATASCII (wielkie litery, usunięcie niedozwolonych znaków).
   - Plik zostanie zapisany na obrazie, a sektory zostaną przydzielone w mapie alokacji.

2. **Zablokowanie pliku przed usunięciem**:
   - Zaznacz plik na liście (kliknij na jego wiersz).
   - Kliknij przycisk **Zablokuj/Odblokuj**. W kolumnie *Atrybuty* pojawi się flaga `[LOCKED]`.

3. **Edycja atrybutów SpartaDOS (A/H/P)**:
   - Na dysku SDFS zaznacz plik i kliknij **Edytuj Atrybuty**.
   - Zaznacz odpowiednie znaczniki (`Protected`, `Hidden`, `Archive`) i zatwierdź – aktywne atrybuty pojawią się jako plakietki przy nazwie pliku.

4. **Zmiana nazwy pliku**:
   - Zaznacz plik i kliknij **Zmień Nazwę**.
   - Wpisz nową nazwę (np. `GRA.XEX`) i zatwierdź przyciskiem **Zmień Nazwę**.

5. **Usuwanie pliku**:
   - Zaznacz plik i kliknij **Usuń**. Potwierdź chęć usunięcia w oknie dialogowym.

---

### Tutorial 3: Praca z Podkatalogami w MyDOS i SpartaDOS

1. Upewnij się, że wczytany plik ATR jest sformatowany w systemie **MyDOS** lub **SpartaDOS**.
2. Kliknij przycisk **Nowy Katalog** na pasku narzędzi.
3. Wpisz nazwę katalogu (np. `GRY`) i kliknij **Utwórz Katalog**.
4. W tabeli plików pojawi się nowy wiersz z ikoną folderu i rozszerzeniem `<DIR>`.
5. Aby wejść do katalogu:
   - Kliknij dwukrotnie na wiersz katalogu w tabeli **LUB**
   - Kliknij na nazwę katalogu w **Drzewie Katalogów** w panelu bocznym.
6. Pasek ścieżki oraz tablica plików zaktualizują się wskazując zawartość wybranego podkatalogu. Aby powrócić do katalogu głównego, kliknij `[ROOT]` w drzewie katalogów.

---

### Tutorial 4: Analiza Zawartości Plików (Podgląd Tekstowy & Hex Viewer)

1. Zaznacz plik na liście (uwaga: opcja jest niedostępna dla katalogów).
2. Kliknij przycisk **Podgląd / Hex** (lub ikonę oka w wierszu pliku).
3. Okno podglądu posiada dwie zakładki:
   - **Tekst**: Wyświetla tekst przekonwertowany z kodowania ATASCII na UTF-8.
   - **Hex**: Wyświetla tradycyjny zrzut heksadecymalny (adres offsetu, 16 bajtów w kodzie szesnastkowym oraz reprezentacja znakowa).
4. **Przełączanie fontu**:
   - Na górze okna podglądu znajduje się przycisk przełączający font:
     - **`Font: PC`** (domyślny): Używa standardowego fontu systemowego PC i dekodowania znaków sterujących.
     - **`Font: ATASCII`**: Przełącza podgląd na oryginalny font Atari 8-Bit oraz mapuje znaki wg dokładnej matrycy znaków glifowych komputera Atari.

---

## 5. Kodowanie Znaków ATASCII vs PC (UTF-8)

Komputery Atari 8-bit używają własnego standardu kodowania znaków zwanego **ATASCII** (Atari Standard Code for Information Interchange).

### Różnice pomiędzy ATASCII a ASCII/UTF-8:
1. **Znak Końca Linii (EOL)**:
   - ATASCII używa wartości `0x9B` (155 w systemie dziesiętnym) jako znaku końca linii (End-Of-Line).
   - Standard PC używa `0x0A` (`\n` w Unix/Linux) lub `0x0D 0x0A` (`\r\n` w Windows).
   - Aplikacja **ATRaction** automatycznie konwertuje bajty `0x9B` na `\n` podczas podglądu i eksportu tekstowego oraz konwertuje `\n` na `0x9B` przy imporcie plików tekstowych.
2. **Znaki Inwertowane (Inverse Video)**:
   - Bajty z ustawionym najstarszym bitem (wartości `0x80`–`0xFF`) reprezentują znaki wyświetlane w negatywie (inwersja).
3. **Znaki Graficzne (Internal Character Set)**:
   - Kody `0x00`–`0x1F` oraz `0x60`–`0x7F` zawierają unikalne symbole graficzne Atari (kratki, linie, kociołki, serca, strzałki itp.).
   - Po przełączeniu trybu na **`Font: ATASCII`**, aplikacja renderuje dokładne odpowiedniki glifów Atari.

---

## 6. Dedykowana Pigułka Aktywnego Obrazu ATR i Organizacja Interfejsu

Interfejs aplikacji zawiera szereg rozwiązań poprawiających przejrzystość i ergonomię pracy:
- **Pigułka z Nazwą Obrazu ATR**: Centralnie umieszczona etykieta z nazwą aktywnego pliku `.ATR` w nagłówku aplikacji, zawierająca ikonę dyskietki, etykietę oraz nazwę otwartego obrazu. Po wczytaniu pliku przybiera bursztynowe wykończenie w stylistyce serwisu Atari.
- **Warunkowy Panel Struktura Katalogów**: Panel drzewa katalogów jest wyświetlany wyłącznie dla systemów plików obsługujących podkatalogi (`MyDOS` oraz `SpartaDOS`), a dla systemów jednopoziomowych (`Atari DOS`, `DOS 2.5`, `DOS II+/D`, `LiteDOS-SE`, `CP/M`) jest automatycznie ukrywany.
- **Kompaktowe Drzewo Katalogów**: Podkatalogi prezentowane są w zwartej, przejrzystej formie ułatwiającej sprawną nawigację.
- **Instrukcja Zawsze Pod Ręką**: Przycisk **Instrukcja** na głównym pasku otwiera pełny podręcznik użytkownika bez konieczności opuszczania aplikacji.

---

## 7. Podziękowania i Uznania (Credits & Acknowledgements)

Aplikacja **ATRaction** powstała dzięki pracom i zasobom udostępnionym przez:

### Mono – atari8fs

- **Autor:** Mono
- **Projekt:** atari8fs – biblioteka dostępu do systemów plików Atari 8-bit
- **Strona projektu:** [http://mono.i-demo.pl/](http://mono.i-demo.pl/)

Implementacje systemów plików **Atari DOS 2.0S**, **DOS 2.5**, **DOS II+/D** oraz **MyDOS 4.5x** w ATRaction inspirowane były analizą formatu ATR, struktury VTOC i katalogów udokumentowaną przez projekt **atari8fs** autorstwa Mono. Sektory startowe i pliki systemowe (`DOS.SYS`, `DUP.SYS`) instalowane przy tworzeniu nowych dysków Atari DOS 2.0S i DOS 2.5 zostały wyekstrahowane bajt w bajt z oryginalnych obrazów tych systemów, aby zagwarantować pełną zgodność z rzeczywistym sprzętem.

### Avery Lee – Altirra

- **Autor:** Avery Lee
- **Projekt:** Altirra – emulator komputerów Atari 8-bit
- **Strona projektu:** [https://www.virtualdub.org/altirra.html](https://www.virtualdub.org/altirra.html)

Kod źródłowy biblioteki **ATIO** emulatora Altirra (`diskfs.cpp`, `diskfsdos2.cpp`, `diskfssdx2.cpp`, `diskfscpm.cpp`) posłużył jako wzorzec przy odtworzeniu: dokładnego, stronicowanego modelu bitmapy VTOC MyDOS dla dysków powyżej 943 sektorów, dwuczęściowej mapy bitowej i licznika VTOC2 dla DOS 2.5, mapy bitowej i sygnatur rozpoznawania SpartaDOS SDFS (w tym wariantu z sektorami 512 B), systemu plików CP/M 2.2 dla Indus GT (wariant dla karty Atari 1090 nie pochodzi z Altirry – ta go nie obsługuje), zasad rozpoznawania formatów dysku (`ATDiskMountImage`) oraz mechanizmu walidacji spójności alokacji z trybem *Read-Only* (`ATDiskFSValidationReport`). Okno tworzenia dysku o geometrii niestandardowej odwzorowuje opcję *Custom* z altirrowego okna *Create New Disk* (`ATNewDiskDialog`), a ograniczenia geometrii Atari DOS 2.0S i DOS 2.5 odzwierciedlają logikę `IsCurrentFormatSupported()` z tego samego okna.

### Mr Atari – LiteDOS-SE

- **Autor:** Mr Atari
- **Projekt:** LiteDOS-SE – lekki system plików dla komputerów Atari 8-bit
- **Strona projektu:** [http://www.mr-atari.com/](http://www.mr-atari.com/)

Obsługa systemu **LiteDOS-SE** – klastrowa mapa alokacji, geometria dwuklastrowego obszaru VTOC i katalogu, rozpoznawanie wariantów klasycznego LiteDOS-SE oraz LiteDOS 2.x, a także format wpisów katalogowych – opiera się na sekcji technicznej instrukcji użytkownika LiteDOS-SE.

---

## 8. Licencja

**ATRaction** jest wolnym oprogramowaniem na licencji **GNU General Public License w wersji 2 lub dowolnej późniejszej** (`GPL-2.0-or-later`). Pełny tekst licencji znajduje się w pliku [LICENSE.txt](LICENSE.txt).

Wybór licencji nie jest przypadkowy. Część kodu obsługującego formaty dysków – rozszerzony VTOC MyDOS, mapa bitowa SDFS, system CP/M 2.2 dla Indus GT, druga mapa alokacji DOS 2.5, zasady rozpoznawania formatów oraz mechanizm walidacji z trybem tylko do odczytu – powstała na podstawie źródeł biblioteki **ATIO** emulatora **Altirra** (© 2009–2015 Avery Lee), objętych tą samą licencją. Same formaty dysków są faktami technicznymi i nie podlegają prawu autorskiemu, ale odtworzenie ich z otwartym cudzym kodem czyni ten fragment utworem zależnym, dlatego ATRaction dziedziczy GPL.

**Wyjątek:** plik `js/dos_templates.js` zawiera dosłowne kopie sektorów startowych oraz plików `DOS.SYS` i `DUP.SYS` systemów Atari DOS 2.0S, DOS 2.5, DOS II+/D, MyDOS 4.5x i LiteDOS-SE. Nie są one dziełem tego projektu, nie są objęte GPL i nie są tu do nich udzielane żadne prawa – każdy pozostaje własnością swojego podmiotu praw.

Pełne zestawienie zapożyczeń, plik po pliku, znajduje się w [THIRD-PARTY.txt](THIRD-PARTY.txt).

---

*Dokumentacja wygenerowana dla aplikacji ATRaction (v2026.08).*
