[Polska wersja / Polish version](CHANGELOG.pl.md)

# Changelog

All notable changes to the **ATRaction** project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
The project does not use numbered releases or `git tag` markers; entries are
dated by publication on the `main` branch together with the abbreviated commit
hash.

---

## 2026-11-13

### Added

- English documentation (`README.md`) and changelog (`CHANGELOG.md`) set as the
  repository defaults, with cross-links to the Polish versions (`README.pl.md`,
  `CHANGELOG.pl.md`) and vice versa (`6ca89ab`).

---

## 2026-11-12 — `774179b`

### Security

- Protected the UI against HTML/JS injection (DOM XSS) from crafted file names,
  directory names, and error messages rendered into the DOM (`escapeHtml` in
  `js/app.js`).

### Fixed

- **LiteDOS-SE**: directory scanning now stops at the first `$00` end-of-directory
  entry (eliminating stale entries past the terminator); added `index`,
  `nameBytes`, and `extBytes` fields for the ATASCII directory view; blocked
  renaming of Read-Only files and skipped the entry being renamed during
  duplicate checks.
- **MyDOS**: moved duplicate checks (covering both files and subdirectories) and
  free slot lookup before allocating 8 sectors in `createDirectory()`, preventing
  VTOC sector leaks on error; blocked importing a file with the same name as an
  existing subdirectory, deleting non-empty subdirectories, and creating
  duplicate names in `renameFile()`.
- **SpartaDOS (SDFS)**: `freeSector()` now increments `boot.freeSectors` only
  when the sector was actually marked allocated in the bitmap (idempotency);
  clamped `allocateSector()` and `freeSector()` to the volume's
  `boot.sectorCount`; enforced the `Protected` attribute on deletion and
  renaming, blocked deleting non-empty subdirectories, and added duplicate name
  checks in `renameFile()`.
- **DOS II+/D (MD 1040) & Atari DOS 2**: excluded reserved sector 720 and sectors
  above 1023 from allocation and from the 10-byte VTOC2 in sector 359 (`1009`
  usable sectors), preserved `dosType = 'DOS II+/D'` after formatting, and added
  duplicate checks to `AtariDOS2.renameFile()`.
- **CP/M 2.2**: added `CPM.formatFilename()` (splits on the last dot, strips
  diacritics and `[Un]` user badges), restricted overwrite-on-import to `User 0`
  (protecting files belonging to `User > 0`), verified free blocks and directory
  extents before deleting an overwritten file, and added duplicate checks in
  `renameFile()`.
- **Disk stats & UI**: corrected `freeBytes` and `totalBytes` calculations in
  `getDiskStats()` for SpartaDOS (including 512 B sectors) and CP/M (no
  3-byte sector link deduction and no 16 B ATR header deduction on `.XFD`
  images); preserved checkbox selections across subdirectories and search
  filtering, fixed formatting `DOS II+/D` from the toolbar, and fixed opening
  the ATASCII directory modal on empty directories.

---

## 2026-08-15 — `f156ca6`

### Added

- Checkboxes in the first column of the file table allow selecting multiple
  entries at once. Bulk selection is independent of clicking a row, which
  continues to drive single-file actions (rename, delete, preview, and lock
  toggle). This separation is documented button-by-button in section 4 of the
  manual and in `README.md`. The header checkbox selects and deselects all
  currently visible rows, narrowing to matching entries when the search filter
  is active.
- One-click export of marked entries into a single `.ZIP` archive. Marked
  subdirectories are archived recursively with paths relative to the current
  view; empty directories are preserved as explicit entries. Atari file names
  are sanitized against characters forbidden in Windows paths (slashes do not
  create spurious directory levels, and DOS device names such as `CON` or `AUX`
  do not block extraction). SpartaDOS timestamps are preserved. A single
  unreadable file does not abort archiving: the rest of the archive is built
  and skipped entries are logged to the browser console. Archive names follow
  the `files_<DENSITY>_<DOS>.zip` pattern (e.g., `files_SD_D20.zip`). Archives
  are created uncompressed in pure JavaScript with zero external dependencies.
- Bulk attribute editing for marked files. The **Attributes** dialog now works
  across all supported file systems rather than SpartaDOS alone: on systems
  that only support write protection, the `H` and `A` checkboxes are hidden.
  When selected files disagree on an attribute, its checkbox shows an
  indeterminate state — leaving it unchanged preserves per-file values, while
  clicking sets or clears it across all marked files.

### Fixed

- File locking now works in LiteDOS. The module previously lacked the `setLock`
  method expected by the engine, causing the lock button to report that file
  locking was unsupported; `setAttributes` also accepts the `protected` key
  used by the UI.
- Cycles in MyDOS and SpartaDOS directory trees no longer crash the application.
  Directory traversal previously guarded only single-level sector/map chains,
  so a damaged image pointing a subdirectory back to a parent or root directory
  caused infinite recursion (`Maximum call stack size exceeded`) upon loading.
  Each directory map/sector is now expanded at most once per traversal,
  rendering a cycle-closing directory as empty while leaving healthy disks
  unchanged.

---

## 2026-08-14 — `474170f`

### Fixed

- Atari DOS 2, DOS 2.5, and MyDOS directories now stop at the first `$00`
  status entry, matching real Atari DOS. Previously the reader scanned all 64
  slots and surfaced stale entries left over from earlier disk contents as
  "ghost files" whose sectors already belonged to other active files. Deleted
  entries (`$80`) are still skipped without terminating the listing. Reference
  image: `MCP.atr`.
- Atari DOS 2 directory sectors hold 8 entries even in Double Density. Deriving
  slot count from sector size previously yielded 16 slots on DD disks, reading
  stale entries in the upper half and risking writes that real DOS would never
  find.
- MyDOS detection via root subdirectories ignores entries past the `$00` end
  marker so remnants from previous disk contents no longer influence file
  system detection.

### Note for users

Disks that previously showed entries past the directory end marker will now
list fewer items. This is not data loss: those entries were never visible on a
real Atari and did not represent active files.

---

## 2026-08-13 — `9886a50`

### Added

- Support for **CP/M 2.2 for the Atari 1090 CP/M card** — 128-byte sector
  disks in SD (720 sectors) and MD (1040 sectors): reading, importing,
  deleting, renaming, Read-Only flag, and formatting. Geometry parameters
  (system area in sectors 1–78, 64-entry directory in sectors 79–94, 1 KB
  allocation blocks of 8 sectors, no byte inversion) are taken from the DPB
  table in the card's BIOS, with block count capped by the DPB limit
  (`DSM = 118`).
- `CP/M 2.2 (Atari 1090 - SD / MD)` option in the New Disk dialog. Newly
  created disks are blank and **non-bootable** (the app does not install CP/M
  system files); formatting an existing disk preserves sectors 1–78 so bootable
  disks stay bootable.
- Documentation section 2.4.8 describing the format and DPB layout, plus an
  entry in the geometry compatibility matrix.

### Changed

- `js/cpm.js` now supports both CP/M variants via layout profiles instead of
  hardcoded constants; the class was renamed from `IndusCPM` to `CPM`.
- Export converts CP/M images to `.XFD` only for the Indus GT variant; Atari
  1090 images remain standard `.ATR` files.
- `THIRD-PARTY.txt` notes that the Atari 1090 profile does not come from
  Altirra, which does not support that format.

### Known limitations

- Only 128-byte media are supported (256-byte DPBs in the card's BIOS lack a
  reference image to verify record-to-sector mapping).
- Compatibility of modified disks with physical Atari 1090 hardware has not
  been tested.

---

## 2026-08-10 — `756fcd2`

### Fixed

- The ATR reader previously assumed every 256 B sector image had three 128-byte
  boot sectors on disk. Double-density ATR images also appear in full-slot
  (256 B) and packed layouts; assuming short slots shifted sector 4 and beyond
  by 384 B, misaligning the VTOC. Variants are now distinguished by header
  paragraph count, matching Altirra.

---

## 2026-08-09 — `843309d`

### Changed

- Updated Altirra copyright year ranges in derived module headers to reflect
  each individual source file rather than a single `2009-2015` range.

---

## 2026-08-09 — `a9f8300`

Initial public release.

### Added

- **ATRaction** — browser-based `.ATR` and `.XFD` disk image manager for 8-bit
  Atari computers with zero external dependencies.
- Support for Atari DOS 2.0S/2.0D, DOS 2.5, DOS II+/D, MyDOS 4.5x, SpartaDOS
  (SDFS), LiteDOS-SE, and CP/M 2.2 for Indus GT.
- Support for SD, MD/ED, DD, QD, DS/QD, and Custom geometries, plus new disk
  creation with system file installation.
- Allocation consistency validation with Read-Only safety mode, bilingual UI
  (Polish and English), and built-in user guide.
- Released under **GPL-2.0-or-later**, inheriting the license from derived
  disk-format and validation code based on Altirra's ATIO library (itemized in
  [THIRD-PARTY.txt](THIRD-PARTY.txt)).

  Exception: `js/dos_templates.js` contains verbatim copies of boot sectors and
  DOS system files (`DOS.SYS`, `DUP.SYS`), which are not covered by the GPL.
