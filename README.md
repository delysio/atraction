
# ATRaction :: Atari 8-Bit ATR Disk Manager
## Technical Documentation and User Manual

[Polska wersja / Polish version](README.pl.md)
---

## 1. Introduction and Application Overview

**ATRaction** is an advanced, highly specialized web application (Single Page Application - SPA) designed for creating, reading, modifying, and analyzing floppy disk images (`.ATR` and `.XFD` formats) used by 8-bit Atari computers (400/800, XL, and XE series).

The application was built from the ground up in pure JavaScript (ES6+), HTML5, and CSS3, with zero external libraries or frameworks. All data processing is performed entirely client-side inside the user's web browser using direct binary manipulations on `Uint8Array` buffers. This ensures instantaneous responsiveness, complete privacy and data security, and full autonomy without reliance on remote servers.

### Key Features:
- **Broad File System Support**: Atari DOS 2.0S, DOS 2.5, DOS II+/D, MyDOS 4.5x, SpartaDOS (SDFS), **LiteDOS-SE**, and **CP/M 2.2** in two variants — for the **Indus GT** drive and for the **Atari 1090** CP/M cartridge.
- **Support for ATR Images and Raw XFD Files**: Automatic detection and virtual handling of raw `.XFD` images (headerless sector dumps) with export back to clean raw XFD format.
- **Support for All Standard Densities and Custom Geometries**: SD (Single Density), MD/ED (Medium/Enhanced Density), DD (Double Density), QD (Quad Density), DS/QD (720 KB), and fully customizable **Custom** geometries (arbitrary sector count, 128/256/512 B sectors, and configurable boot sector count).
- **File Operations and ZIP Archiving**: Adding files, deleting files and empty subdirectories, renaming (ATASCII 8.3 / CP/M format), toggling file protection status (Lock/Unlock / Read-Only), single and bulk attribute editing (**P/H/A** for SpartaDOS SDFS, write-protection flag for other systems), and exporting individual files or entire directory trees into **ZIP** archives.
- **Hierarchical Subdirectories**: Creating and navigating directory trees in MyDOS and SpartaDOS.
- **Advanced Content Viewer**: Integrated text viewer with ATASCII decoding and a Hex Viewer with real-time typeface toggle between **PC (UTF-8)** and authentic **ATASCII font**.
- **Read-Only Safety Mode**: Thorough sector allocation consistency validation across all supported file systems — identifying corrupted bitmaps/allocation maps and safely reading damaged disks without risking data corruption. Validation rules were reconstructed from the ATIO library source code of the Altirra emulator.
- **Built-in DOS Templates**: Automatic installation of boot sectors and system files (`DOS.SYS`, `DUP.SYS`) when creating new disks in standard densities — for Atari DOS 2.0S, Atari DOS 2.5, DOS II+/D, and MyDOS 4.5x. All template files are byte-for-byte identical to original disk images of each respective DOS.
- **Intelligent Output File Naming**: Automatically suggests conventional file names matching `DENSITY_DOS.atr` or `DENSITY_DOS.xfd` (e.g., `SD_D20.atr`, `MD_D25.atr`, `DD_SDX.atr`, `DD_CPM.xfd`).

---

## 2. Supported File Formats, Disk Geometries, and File Systems

### 2.1. Disk Image Container Formats

ATRaction provides comprehensive support for the two primary disk container formats used in 8-bit Atari emulation and modern flash-based hardware peripherals:

#### 1. `.ATR` Format (Atari Disk Image)
- **Overview**: The standard and most popular disk image container format, created by Nick Kennedy for the SIO2PC interface.
- **Structure**: Consists of a 16-byte binary header followed by sequential raw disk sectors.
- **Boot Sectors**:
  - The ATR header lacks a dedicated field for the boot sector count. On Atari hardware, **the first 3 sectors are always 128 bytes** due to floppy drive controller ROM constraints (Atari 810/1050), which always boot sectors 1–3 in 128-byte single-density mode.
  - **Ambiguity in Double Density**: How these three sectors are *physically stored in the file* varies. Three distinct container layouts exist:
    1. **Short layout** (typical) — three 128 B slots; sector 4 begins at file offset $16 + 384$;
    2. **Full slots** — every boot sector occupies a full 256 B slot, with only the first 128 B containing valid data;
    3. **Packed layout** — three 128 B sectors concatenated sequentially, with the remainder of the third 256 B slot padded with zeros.
  - ATRaction detects these variants identically to Altirra — by inspecting the **paragraph count in the ATR header**. One paragraph is 16 bytes, and a 256 B sector corresponds to exactly 16 paragraphs; hence, an integer number of full 256 B sectors always yields a multiple of 16 paragraphs. A $3 \times 128$ B prefix adds 24 paragraphs ($384 / 16 = 24$), leaving a remainder of 8 modulo 16. A non-zero remainder indicates the short layout; a remainder of zero indicates one of the other two variants (distinguished by checking whether the second 128-byte slot holds data while the fifth is empty).
  - This distinction is critical: assuming the short layout for an image with full slots shifts **every sector from 4 upwards by 384 bytes**, rendering the VTOC misplaced and all file data corrupted. ATRaction therefore tracks two values: *logical boot sectors* (how many sectors the Atari OS reads as 128 bytes, always 3) and *physical boot sectors* (how many 128-byte slots exist in the file, 3 or 0). The former determines sector size, while the latter determines file offsets.
  - When creating a disk with a **Custom geometry**, the boot sector count (0–255) is user-configurable; however, for 256 B sectors, reopening the file will always restore the standard count of 3 (a constraint of the ATR header format itself).
  - For **512 B sectors**, short boot sectors do not exist — all sectors in the image share identical length.
  - Sectors starting from `bootSectorCount + 1` onward take the full sector size declared in the header.
- **Payload Size Formula**, where $B$ = count of short (128 B) boot sectors:
  - $\text{Payload} = B \times 128 + (N_{\text{sec}} - B) \times \text{SectorSize}$
  - For standard SD/ED ($B=3$, 128 B sectors), this simplifies to $N_{\text{sec}} \times 128$.
  - For standard DD/QD/720K ($B=3$, 256 B sectors), this simplifies to $384 + (N_{\text{sec}} - 3) \times 256$.
  - Total `.ATR` file size: $\text{File Size} = 16\text{ B (Header)} + \text{Payload}$.

#### Detailed ATR Header Layout (16 Bytes):
| Offset (Hex) | Offset (Dec) | Type / Length | Description / Value |
| :---: | :---: | :---: | :--- |
| `0x00 - 0x01` | `0 - 1` | `Uint16LE` (2B) | **Magic Header**: Fixed identifier `0x0296` (`0x96`, `0x02`). |
| `0x02 - 0x03` | `2 - 3` | `Uint16LE` (2B) | **Paragraph Count (Low 16 bits)**: 1 paragraph = 16 bytes. Value $= \lfloor \text{Payload} / 16 \rfloor$. |
| `0x04 - 0x05` | `4 - 5` | `Uint16LE` (2B) | **Data Sector Size**: `128`, `256`, or `512` bytes. |
| `0x06 - 0x07` | `6 - 7` | `Uint16LE` (2B) | **Paragraph Count (High 16 bits)**: Extension for large MyDOS / SpartaDOS partitions (> 1 MB). |
| `0x08` | `8` | `Uint8` (1B) | **Write Protection**: Bit 0 = 1 denotes write-protected image (`0x01`). Remaining bits must be `0`. |
| `0x09 - 0x0F` | `9 - 15` | `Bytes` (7B) | **Reserved**: Filled with `0x00`. |

#### 2. `.XFD` Format (Raw Sector Dump)
- **Overview**: Headerless raw sector dump, originally popularized by the XF551 emulator software.
- **Uniform Sector Size**: Unlike ATR, **all sectors in an XFD file have identical length** (128, 256, or 512 B) — short boot sectors are not present.
- **File Size Formula**: $\text{File Size} = N_{\text{sec}} \times \text{SectorSize}$.
- **Detection and Handling in ATRaction**:
  - ATRaction detects XFD files automatically on upload (absence of magic `0x0296` with total size divisible by 128 B).
  - A virtual ATR header is synthesized in memory to allow transparent editing.
  - On export, the disk is converted back into a clean raw `.XFD` image — every sector is mapped into a uniform grid so that contents remain identical regardless of whether they originated from an ATR container with short boot sectors.

---

### 2.2. Disk Geometry Specifications

ATRaction supports all standard 8-bit Atari floppy disk geometries as well as custom geometries mirroring Altirra's *Create New Disk → Custom* interface:

| Geometry | Density Description | Sectors ($N_{\text{sec}}$) | Sector Size | Boot Sectors | Payload Capacity | ATR File Size | XFD File Size |
| :---: | :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| **SD** | Single Density (SS/SD) | 720 | 128 B | 3 | **90 KB** (92,160 B) | 92,176 B | 92,160 B |
| **MD / ED** | Medium / Enhanced Density (SS/MD) | 1040 | 128 B | 3 | **130 KB** (133,120 B) | 133,136 B | 133,120 B |
| **DD** | Double Density (SS/DD) | 720 | 256 B | 3 | **180 KB** (183,936 B) | 183,952 B | 184,320 B |
| **QD** | Quad Density / DSDD | 1440 | 256 B | 3 | **368 KB** (368,256 B) | 368,272 B | 368,640 B |
| **720K** | DS/QD (Double Sided Quad Density) | 2880 | 256 B | 3 | **720 KB** (737,280 B) | 737,296 B | 737,280 B |
| **Custom** | Custom Geometry / Hard Disk Partition | 1 .. 65,535 | 128 / 256 / **512** B | 0 .. 255 | Variable, up to ~32 MB | $16 + \text{Payload}$ | $N_{\text{sec}} \times \text{Size}$ |

#### Calculating Sector Offset in Memory ($B$ = short boot sector count, $S$ = 1-indexed sector number):
- **In XFD format**: $\text{Offset} = 16 + (S - 1) \times \text{SectorSize}$
- **In ATR format**:
  - If $S \le B$: $\text{Offset} = 16 + (S - 1) \times 128$
  - If $S > B$: $\text{Offset} = 16 + B \times 128 + (S - 1 - B) \times \text{SectorSize}$
  - For standard SD/ED ($B=0$ effectively since sector size is 128 B) and DD/QD/720K ($B=3$), the formula simplifies to standard offsets.

---

### 2.3. File System and Geometry Compatibility Matrix

The table below reflects `DiskManager.checkFormatSupport()` (equivalent to Altirra's `IsCurrentFormatSupported()` in *Create New Disk*), extended to cover file systems unique to ATRaction. The disk creation dialog dynamically filters available density choices according to these rules:

| File System | SD (90K) | MD/ED (130K) | DD (180K) | QD (368K) | 720K | Custom |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| **Atari DOS 2.0S** | Yes | No | No | No | No | No (except standard SD geometry) |
| **Atari DOS 2.5** | Yes | Yes | No | No | No | No (except standard SD/MD) |
| **DOS II+/D** | Yes | Yes (VTOC2 in sec. 359) | Yes | No | No | Yes (720 or 1040 sec., 128/256 B, 3 boot) |
| **MyDOS 4.5x** | Yes | Yes | Yes | Yes | Yes | Yes (from 720 sec., 128/256 B, up to 65,535 sec.) |
| **SpartaDOS (SDFS)** | Yes | Yes | Yes | Yes | Yes | Yes (from 16 sec., **128/256/512 B**, up to 65,535 sec.) |
| **LiteDOS-SE** | – | – | – | – | – | New disk creation not supported — read/write/format existing images only |
| **CP/M 2.2 (Indus GT)** | No | No | Yes | No | No | Yes (64–1068 sec., 256 B only) |
| **CP/M 2.2 (Atari 1090)** | Yes | Yes | No | No | No | Yes (102–1040 sec., 128 B only) |
| **None (Unformatted)** | Yes | Yes | Yes | Yes | Yes | Yes (any geometry) |

Verification is enforced before creating an image. If an incompatible combination is chosen, disk creation is prevented and a clear diagnostic message is shown. **Atari DOS 2.0S and Atari DOS 2.5 adhere to strict historic constraints compared to DOS II+/D**: although their VTOC structures in SD/DD can appear identical, original Atari DOS 2.0S and 2.5 releases never shipped on densities outside SD/MD. Therefore, the creation dialog and formatter reject those combinations. **For Custom geometries, system file installation (DOS.SYS / DUP.SYS) is always disabled** — binary boot templates exist only for standard densities and would fail to boot on arbitrary geometries.

---

### 2.4. Supported File Systems

#### 1. Atari DOS 2.0S (`Atari DOS`)
- **Target Density**: Single Density only (720 sectors of 128 B) — original DOS 2.0S was never distributed on other geometries.
- **VTOC Structure**: Sector 360 contains type byte `0x02`, total usable sector count `707` (matching Atari DOS 2 and Altirra's `ATDiskFSDOS2::InitNew`), and a sector bitmap (sectors 4..359 and 369..719; sector 720 is permanently reserved because standard DOS 2 cannot address it in its 90-byte bitmap).
- **Directory**: Sectors 361–368, holding up to 64 directory entries. Each directory sector holds **exactly 8 entries** of 16 bytes each — even in double density where the upper half of a 256-byte sector remains unused (`ATDiskFSDOS2::LoadDirectory` reads 8 entries per sector regardless of density).
- **Sector Links**: The last 3 bytes of each sector store a link to the next sector (bytes `secSize-3` and `secSize-2`) and payload byte count (`secSize-1`).
- **System File Installation**: Boot sectors and system files `DOS.SYS` (4,875 B) and `DUP.SYS` (5,126 B) are extracted verbatim from original Atari DOS 2.0S master disks.
- **ATASCII Art and Special Directory Entries**:
  - The directory reader permits arbitrary ATASCII characters (including graphics glyphs and box-drawing characters used for scene directory art, e.g., on demo disks such as `Sheol Side A.atr`).
  - Entries with start sector `0` or length `0` are displayed faithfully according to disk content.
- **Directory End Marker (`$00`)**:
  - A status byte of `$00` marks an **unallocated slot** and terminates the directory: DOS stops scanning and does not inspect subsequent slots or sectors. ATRaction behaves identically (`AtariDOS2.isDirectoryEnd`), matching Altirra's `ATDiskFSDOS2::LoadDirectory`.
  - This prevents "ghost files" from appearing on disks that were overwritten with fewer files than previously contained. Entries past the `$00` marker may look structurally valid, but point to sectors now owned by other files. Listing them would be deceptive, reading them returns corrupt data, and deleting them would release active sectors in the VTOC.
  - A **deleted entry** (`$80`) does not end the directory — it is skipped during lookups. New files reuse deleted slots or the first `$00` marker slot, maintaining directory continuity.
- **Broken Entry Filtering (`brokenDir`)**:
  - To distinguish deliberate ATASCII graphics entries from residual data from earlier disk formats, the engine validates status flags and start sector boundaries.
  - An illegal status flag activates `brokenDir = true`, safely suppressing remaining unformatted junk data.

#### 2. Atari DOS 2.5 (`DOS2.5`)
- **Target Densities**: SD (720 sectors) and MD/ED (1040 sectors of 128 B, 130 KB) — never DD, QD, or 720K.
- **VTOC Structure**:
  - Sector 360 manages the primary 720 sectors (`vtocType = 2`), identical to standard DOS 2.
  - Sector 1024 contains an auxiliary **VTOC2** block: bytes `0..83` duplicate the bitmap for sectors 48–719 from sector 360, bytes `84..121` hold the bitmap for extended sectors 720–1023, and bytes `122..123` store the free sector count for the extended range (720–1023). Sector 720 remains reserved in this region (`byte 100 = 0x7F`).
  - In total, an MD DOS 2.5 disk offers 707 (base area) + 303 (extended area, sectors 721–1023) = 1,010 free sectors when freshly formatted.
  - On SD disks (720 sectors), VTOC2 is omitted and the image is identified simply as `Atari DOS`.
- **Directory**: Sectors 361–368 (flat directory in the base area).
- **System File Installation**: ATRaction installs the SD or MD template depending on chosen density. Boot sectors (384 B) are **byte-for-byte identical** between SD and MD; however, `DOS.SYS` (4,625 B) differs across 43 bytes due to embedded geometry tables; `DUP.SYS` (5,126 B) is shared.

#### 3. DOS II+/D (`DOS II+/D`)
- **Target Densities**: SD (720 sectors, 128 B), MD (1040 sectors, 128 B), and DD (720 sectors, 256 B), created by Stefan Dorndorf.
- **Detection in SD/DD**: In SD and DD, the VTOC of DOS II+/D is structurally identical to Atari DOS 2. Recognition relies on the **boot sector signature**: byte 0 of sector 1 equals `0xC4` coupled with signature startup code bytes (`38 B0` at offset 6–7), verified against period software disks (`_disks/Forever5.atr`).
- **VTOC Structure in MD**:
  - Sector 360 contains type byte `0x03` and total usable sector count `1009`, mapping sectors 0..943.
  - Sector 359 acts as an auxiliary bitmap (VTOC2) managing sectors 944..1023 (10 bytes). **The highest addressable sector in DOS II+/D is 1023, identical to DOS 2.5** — on a 1040-sector image, the final 17 sectors are unmapped and excluded from validation. Sector 720 is reserved.
- **Directory**: Sectors 361–368.

#### 4. MyDOS 4.5x (`MyDOS`)
- **Target Densities**: All standard densities (SD 90K, MD 130K, DD 180K, QD 368K, DS/QD 720K), plus hard disks and RAMdisks up to 16 MB (up to 65,535 sectors, including custom geometries). Authored by Charles Marslett and Robert Puff (1988).
- **VTOC Bitmap Model** *(verified on physical QD media `_disks/XL Digital.atr` and Altirra's `ATDiskFSDOS2::InitNew`)*:
  - Allocation is represented as **one contiguous bitstream**: sector $N$ corresponds to bit $N$, starting from byte 10 of sector 360.
  - The bitstream is measured in 256-byte pages. Page 0 is sector 360 (up to 943 sectors fit in a single sector in SD, or one 256 B sector in DD). Additional pages decrement downward: sector 359, 358, etc.
  - Byte 0 of sector 360 (`vtocByte`) encodes page count + 2: `0x02` for disks up to 943/1023 sectors (1 VTOC sector), `0x03` up to ~1,968 sectors, `0x04` for larger disks (e.g. DS/QD 2880 sectors → 2 VTOC sectors). On large hard disks, this value reaches up to `0x23` (35 pages / 33 VTOC sectors for 16 MB).
  - The `total` field (bytes 1–2 of VTOC) stores *usable data sectors* (physical sectors minus 3 boot sectors, minus VTOC sectors, minus 8 root directory sectors), not raw physical capacity.
- **16-bit Sector Linking**: Disks larger than 943 sectors switch to full 16-bit sector numbers (bit `0x04` set in directory flag, giving flag value `0x46` instead of `0x42`).
- **Subdirectory Architecture**:
  - Root directory and every subdirectory occupy a contiguous block of **8 consecutive sectors**, holding up to **64 files or subdirectories** (8 entries per directory sector).
  - No hard limit on subdirectory depth or quantity across the disk.
  - Subdirectories are marked with bit `0x10` in their directory flag byte.
  - Deleting a subdirectory is permitted only when it is completely empty.
- **Naming and Validation**:
  - Strict 8.3 ATASCII formatting is enforced (letters, digits, `_`, `@`; no leading digits).
  - Standard Atari wildcards (`*` and `?`) are supported.

#### 5. SpartaDOS (`SpartaDOS` / SDFS)
- **Target Densities**: All densities using the SpartaDOS File System (SDFS), including Custom geometries with **512 B sectors**.
- **SDFS Architecture**:
  - Sector 1 contains the **Boot Block** with pointers to the sector map (`sectorMap`), total sector count, and root directory.
  - Sector size is stored at bytes 33–34 and in byte 31 (`128` → 128 B, `0` → 256 B, `1` → 512 B). Byte 7 holds the file system signature: `0x80` for SD/DD volumes, `0x40` for 512 B volumes.
  - Boot sector count depends on sector size: **3** for sectors up to 256 B, and **1** for 512 B sectors (with 512 B sectors, sector 2 is already part of the allocation bitmap).
  - Each file and directory possesses an independent **Sector Map** (SUSB block chain referencing data sectors).
  - Full hierarchical tree structure without arbitrary depth limits. Subdirectories can only be deleted when empty.
- **File Attributes (P / H / A)**:
  - Byte 0 of each directory entry stores SDFS status flags:
    - **`P` (Protected)**: Read-only protection against modification, renaming, and deletion.
    - **`H` (Hidden)**: Hidden from standard directory listings.
    - **`A` (Archive)**: Archive / modification tracking flag.
  - ATRaction allows inspecting and editing `P`, `H`, and `A` attributes individually or in bulk via the **Attributes** dialog.
- **Transactional Allocation**: Allocation and file writes allocate both data sectors and sector maps before committing directory records. If an error occurs, allocated sectors are safely freed, preventing orphaned sectors in the bitmap.

#### 6. LiteDOS-SE (`LiteDOS-SE`)
- **Target Usage**: Inspecting, editing, and formatting existing LiteDOS-SE disks by Mr Atari. **Creating new LiteDOS images from scratch is not supported** due to the lack of standalone boot templates.
- **Supported Variants**:
  - **LiteDOS-SE (Classic)**: Bits 7–6 of sector 360 ID byte equal `01`. Byte `$00` holds cluster size, `$01-$02` total sectors, `$03-$04` free sectors, `$05-$09` are zero, and the cluster bitmap begins at offset `$0A`.
  - **LiteDOS 2.x**: Bits equal `10`, `LiteDOS` text signature at offset `$03`, 512-bit bitmap at `$20`, 24-bit free sector counter at `$71`.
- **Cluster-based Allocation**: Space is allocated in **clusters** (powers of two from 1 to 64 sectors). The cluster size is chosen to fit the disk size into a 512-bit or 1024-bit bitmap.
- **VTOC and Directory Area**: Occupies two clusters aligned to double-cluster boundaries encompassing sector 360. The directory begins at sector 361 and wraps within this area. Directory traversal stops at the first `$00` marker (deleted entries `$80` are skipped). Locked files (`0x20`) are protected against deletion and renaming.
- **System Kernel Area**: LiteDOS lacks a `DOS.SYS` file — its compact ~2 KB kernel resides in clusters immediately following the VTOC, marked allocated in the bitmap. Validation recognizes this system area and avoids reporting false lost clusters.

#### 7. CP/M 2.2 for Indus GT (`CP/M 2.2 (Indus GT)`)
- **Target Density**: Disks with 256-byte sectors for Indus GT disk drives running an onboard Z80 CP/M 2.2 system (64–1068 sectors, 180 KB DD).
- **Bitwise Byte Inversion (XOR 0xFF)**: All directory header bytes and sector contents are stored inverted on disk (`byte ^ 0xFF`). ATRaction transparently handles inversion on read and write.
- **Directory and Allocation**:
  - Sectors 1–36 are reserved system tracks.
  - The directory occupies logical sectors 37–44 (allocation blocks 0–1, up to 64 32-byte directory extents).
  - Allocation block size is 1 KB (4 sectors of 256 B). Block $b$ starts at physical sector $37 + 4b$; user data starts at block 2.
  - File size is computed from the **highest extent**: $\text{Size} = \text{ExtentNr} \times 16384 + \min(\text{RC}, 128) \times 128$. Because CP/M tracks size in 128-byte records, file length is rounded up to multiples of 128 B.
  - Supports the **Read-Only (R/O)** attribute bit on the first extension character.
- **Detection**: Recognized either by the boot signature `$F3 $22 $55 $7F` in sector 1 (matching Altirra's `ATDiskMountImage`) or by directory structural analysis.

#### 8. CP/M 2.2 for Atari 1090 (`CP/M 2.2 (Atari 1090)`)
- **Target Densities**: 128-byte sector disks (SD 720 or MD 1040 sectors) for the Atari 1090 expansion system with CP/M cartridge. Operates **without byte inversion** — data is stored directly.
- **Geometry Source**: Parameters originate from the DPB table in the card's BIOS: `SPT = 26`, `BSH = 3`, `BLM = 7`, `EXM = 0`, `DSM = 118`, `DRM = 63`, `AL0 = $C0`, `CKS = 16`, `OFF = 3`. No sector translation/interleave table is used (linear 1:1 mapping).
- **Structure**:
  - Sectors 1–78 form the system track area (3 tracks of 26 records).
  - Directory occupies sectors 79–94 (blocks 0–1, up to 64 extents).
  - Allocation block is 1 KB (8 sectors of 128 B). Block $b$ begins at sector $79 + 8b$.
  - Total block count is the lesser of the DPB limit (119 blocks) and media physical capacity.
- **Container**: Handled as standard bootable `.ATR` images (not converted to `.XFD`).

---

### 2.5. Allocation Validation, Non-Standard Disk Sizes, and Read-Only Mode

Validation rules mirror the source code of Altirra's **ATIO** library across all supported file systems:

- **Directory Tree Traversal**: On image load, ATRaction traverses all directory structures, collects sectors/blocks owned by active files and subdirectories, and compares them against the on-disk allocation map.
- **Non-Standard Disk Size Detection**: The physical `.ATR` file size and header paragraph count are evaluated against expected payload geometry. If a file is truncated or padded, a warning is raised in the sidebar. Variations in sector counts for MyDOS and SpartaDOS images are not flagged, as both natively support arbitrary geometries up to 65,535 sectors.
- **Mounting in Read-Only Mode**: Disks are locked to read-only mode if severe corruption is discovered:
  - Header declares a size mismatching actual file length (truncated or corrupted transfers);
  - A sector or block owned by an active file is marked free in the allocation map;
  - Free sector counter contradicts the count of free bits in the allocation map;
  - A sector or block is cross-linked between multiple files;
  - A directory entry references sectors outside physical disk boundaries.
- **Non-Fatal Warnings**: If only **lost sectors** (sectors marked allocated in the bitmap but unreferenced by any file) are detected, the image remains fully writable and an informational notice is displayed.
- **System-Specific Rules**:
  - *Atari DOS 2 / DOS II+/D*: Sector 720 is reserved. If a disk bitmap marks sector 720 as free, it remains writable since no active data is jeopardized.
  - *DOS 2.5*: VTOC2 (sector 1024) is verified against sector 360. Free space sums both base (0–719) and extended (720–1023) counters.
  - *SpartaDOS*: Free sector count is verified against the boot block. The last sector of a volume is permitted to be marked allocated (historic SpartaDOS formatter convention).
  - *CP/M*: Directory entries are validated for overlapping blocks or out-of-bounds references.
- **Safety**: In Read-Only mode, files can still be viewed and downloaded to PC, while all modifying operations (adding files, deleting, renaming, formatting) are disabled.

---

## 3. User Interface Guide

The interface is organized into 4 primary functional sections:
- **Header**: Loading `.ATR`/`.XFD` images, creating new disks, saving modified images, switching language, and opening the **User Guide**.
- **Sidebar**: Displays disk metrics (DOS type, density, total sectors, free sectors/bytes, visual usage meter, validation notices) and the hierarchical subdirectory tree.
- **Toolbar**: Houses file actions (add, rename, delete, preview, single and ZIP extraction, attribute editing, lock toggling, ATASCII directory view).
- **File Table (Main Workspace)**: Tabular file listing showing sector counts, byte sizes, starting sectors, attributes, and inline actions. The first column provides checkboxes for multi-file selection.

#### Two Ways of Selecting Files

The file table separates **row clicking** (highlights a single row) from **checkbox selection** (marks multiple rows):

| Action Button | Targets |
|---|---|
| Extract File | Currently clicked (highlighted) row |
| Rename | Currently clicked (highlighted) row |
| Delete | Currently clicked (highlighted) row |
| Preview / Hex | Currently clicked (highlighted) row |
| Lock / Unlock | Currently clicked (highlighted) row |
| Download ZIP | All entries marked with checkboxes |
| Attributes | Marked checkboxes; falls back to clicked row if no checkboxes are marked |

Mass deletion and mass renaming are intentionally not supported to prevent accidental data loss. Bulk lock toggling is performed through the **Attributes** dialog.

The header checkbox selects/deselects all **visible** rows in the active folder (respecting active search filters). Checkbox selections persist across folder navigation and search queries, and reset when formatting or loading a new disk.

### 3.1. Header Actions
- **Open ATR / XFD**: Opens a file picker. Supports **Drag & Drop** anywhere onto the application window.
- **New Disk**: Opens the disk creation dialog with file system selection (Atari DOS 2.0S, 2.5, DOS II+/D, MyDOS, SpartaDOS, CP/M 2.2, or unformatted) and density selection (Standard or Custom).
- **Save ATR / XFD**: Downloads the modified disk image. File names are suggested automatically (e.g., `SD_D20.atr`, `MD_D25.atr`, `DD_CPM.xfd`).
- **Language Toggle (PL / EN)**: Switches the entire user interface and user manual between Polish and English in real time.
- **User Guide**: Opens the comprehensive embedded documentation modal.

### 3.2. Sidebar
- **Disk Parameters**: Live indicators for file system, density, sector count, free sectors, and free bytes.
- **Directory Tree**: Collapsible tree navigation for MyDOS and SpartaDOS subdirectories (hidden automatically for single-tier file systems).

### 3.3. File Table & Toolbar
- **Add File**: Imports binary or text files from the PC into the active Atari disk directory.
- **New Directory**: Creates a new subdirectory (MyDOS and SpartaDOS).
- **Extract File**: Downloads the selected file directly to the PC.
- **Download ZIP**: Packages all checkbox-marked files and folders into an uncompressed `.ZIP` archive. Marked subdirectories are traversed recursively, Windows-incompatible path characters are safely sanitized, and SpartaDOS timestamps are preserved.
- **Rename**: Renames the selected file/folder (sanitizes input to 8.3 ATASCII/CPM format and checks for duplicate names).
- **Lock / Unlock**: Toggles the write-protect flag on the selected file.
- **Edit Attributes**: Opens the attribute editor. Provides `Protected`, `Hidden`, and `Archive` for SpartaDOS SDFS, or write-protection toggling for other file systems. Supports indeterminate states for mixed selections.
- **Delete**: Deletes the selected file or empty subdirectory and frees its sectors.
- **Preview / Hex**: Opens text and hexadecimal inspection dialogs.
- **ATASCII Directory**: Renders the directory in authentic 40-column Atari screen layout using the Atari system font.
- **Search Filter**: Real-time substring filter for files in the active view.

---

## 4. Step-by-Step Tutorials

### Tutorial 1: Creating a New ATR / XFD Disk Image

1. Click **New Disk** on the top header.
2. Select the desired **File System / DOS**:
   - `Atari DOS 2.0S (SD)` — *Authentic DOS 2.0S master (SD only)*.
   - `Atari DOS 2.5 (SD / MD)` — *Standard DOS 2.5 supporting 130 KB MD*.
   - `DOS II+/D (SD / MD / DD)` — *Recommended for standard gaming and utility software*.
   - `MyDOS 4.5x` — *Recommended when subdirectory trees are required*.
   - `Sparta DOS` — *Advanced SDFS environment supporting 512 B sectors*.
   - `CP/M 2.2 (Indus GT - DD 180 KB)` — *For Indus GT CP/M drives*.
   - `CP/M 2.2 (Atari 1090 - SD / MD)` — *For Atari 1090 CP/M cartridge*.
   - `None (Unformatted)` — *Raw blank disk container*.
3. Choose **Density & Disk Size**:
   - `SD` (90 KB), `MD` (130 KB), `DD` (180 KB), `QD` (368 KB), `720K` (720 KB), or **`Custom`**.
   - Available densities adapt automatically to match the chosen DOS compatibility rules.
4. Ensure **Install DOS system files** is checked if you want a bootable disk (installs matching boot sectors and `DOS.SYS` / `DUP.SYS`).
5. Click **Create Disk**.

---

### Tutorial 1b: Creating a Custom Geometry Disk

1. Select density **`Custom`** in step 3 above. Three configuration fields will appear:
   - **Sector count** — from the boot sector count up to 65,535.
   - **Boot sectors** — 0–255 (disabled automatically for 512-byte sectors).
   - **Sector size** — 128, 256, or 512 bytes (512 B supported by SpartaDOS only).
2. The dialog calculates and previews the resulting payload and image size in real time.
3. If an invalid combination is chosen, a diagnostic message explains the conflict and disables creation.
4. Click **Create Disk** to proceed.

---

### Tutorial 2: Uploading and Managing Files

1. **Uploading files from PC**:
   - Click **Add File** on the toolbar.
   - Choose files from your computer (e.g. `.XEX`, `.COM`, `.OBJ`, `.BAS`, `.TXT`).
   - File names are automatically sanitized and converted to uppercase 8.3 ATASCII.
2. **Locking a file**:
   - Click the file row and click **Lock/Unlock**.
3. **Editing attributes (Single or Bulk)**:
   - Mark files using checkboxes (or click a single row) and click **Attributes**.
   - Adjust `Protected`, `Hidden`, or `Archive` flags and confirm.
4. **Renaming**:
   - Click a file row, select **Rename**, enter a new valid 8.3 name, and confirm.
5. **Deleting**:
   - Click a file or empty subdirectory and select **Delete**.
6. **Exporting and Downloading ZIP Archives**:
   - To export a single file, highlight it and click **Extract File**.
   - To export multiple files or entire subdirectories, mark them with checkboxes and click **Download ZIP**.

---

### Tutorial 3: Managing Subdirectories in MyDOS and SpartaDOS

1. Open or create an image formatted as **MyDOS** or **SpartaDOS**.
2. Click **New Directory** on the toolbar, enter a directory name (e.g., `GAMES`), and confirm.
3. To enter the folder:
   - Double-click its row in the file table **OR**
   - Click the folder name in the **Directory Tree** in the sidebar.
4. To return to the parent directory, click the `.. [Parent directory]` row or select `[ROOT]` in the sidebar tree.

---

### Tutorial 4: File Content Inspection (Text & Hex Viewer)

1. Select a file and click **Preview / Hex** (or the eye icon).
2. The modal offers two tabs:
   - **Text**: Displays text with ATASCII-to-Unicode conversion.
   - **Hex**: Provides an address offset dump, hexadecimal byte values, and ASCII representation.
3. **Typeface toggle**:
   - Use the **Font** button at the top of the preview modal to alternate between:
     - **`Font: PC`**: Default system PC font with control character escaping.
     - **`Font: ATASCII`**: Authentic 8-bit Atari system typeface showing inverse video, box-drawing, and graphical glyphs.

---

## 5. Character Encoding: ATASCII vs PC (UTF-8)

8-bit Atari computers utilize **ATASCII** (Atari Standard Code for Information Interchange).

### Key Differences:
1. **End-Of-Line (EOL)**:
   - ATASCII uses byte value `0x9B` (155 decimal) for End-Of-Line.
   - PC standards use `0x0A` (`\n`) or `0x0D 0x0A` (`\r\n`).
   - ATRaction automatically converts `0x9B` to `\n` in the text preview while preserving the raw binary stream untouched during import and export.
2. **Inverse Video**:
   - Byte values `0x80`–`0xFF` represent inverted characters.
3. **Graphic Glyphs**:
   - Byte codes `0x00`–`0x1F` and `0x60`–`0x7F` represent unique Atari graphical characters (cards, corners, borders, arrows). In **`Font: ATASCII`** mode, ATRaction renders these symbols accurately.

---

## 6. Active ATR Disk Badge and Interface Layout

- **Active Disk Badge**: Prominently displays the currently opened `.ATR` or `.XFD` image name in the header, styled with authentic Atari amber accents.
- **Conditional Directory Tree**: Visible only for hierarchical file systems (`MyDOS` and `SpartaDOS`), automatically hidden for flat single-tier file systems.
- **Always Accessible Manual**: The **User Guide** button opens complete reference documentation at any time without navigating away from the workspace.

---

## 7. Credits & Acknowledgements

ATRaction was built with valuable knowledge, specifications, and code principles shared by:

### Mono – atari8fs
- **Author:** Mono
- **Project:** atari8fs – Atari 8-bit file system access library
- **Website:** [http://mono.i-demo.pl/](http://mono.i-demo.pl/)

File system implementations for **Atari DOS 2.0S**, **DOS 2.5**, **DOS II+/D**, and **MyDOS 4.5x** were informed by the ATR format, VTOC layouts, and directory structures documented by Mono in the **atari8fs** project. Boot sectors and system files (`DOS.SYS`, `DUP.SYS`) installed on newly created Atari DOS disks were extracted directly from authentic master disks.

### Avery Lee – Altirra
- **Author:** Avery Lee
- **Project:** Altirra – 8-bit Atari computer emulator
- **Website:** [https://www.virtualdub.org/altirra.html](https://www.virtualdub.org/altirra.html)

Source code from Altirra's **ATIO** library (`diskfs.cpp`, `diskfsdos2.cpp`, `diskfssdx2.cpp`, `diskfscpm.cpp`) served as the reference for: the paged MyDOS VTOC bitmap model for disks >943 sectors, the two-part DOS 2.5 VTOC2 bitmap and counters, SpartaDOS SDFS bitmap and detection signatures (including 512 B sector volumes), Indus GT CP/M 2.2 byte inversion and allocation (the Atari 1090 profile is independent), format detection rules (`ATDiskMountImage`), and allocation consistency validation with *Read-Only* protection (`ATDiskFSValidationReport`). The Custom geometry creation dialog mirrors the *Custom* option from Altirra's *Create New Disk* dialog (`ATNewDiskDialog`).

### Mr Atari – LiteDOS-SE
- **Author:** Mr Atari
- **Project:** LiteDOS-SE – lightweight file system for Atari 8-bit computers
- **Website:** [http://www.mr-atari.com/](http://www.mr-atari.com/)

**LiteDOS-SE** support — cluster allocation maps, two-cluster VTOC geometry, variant detection (Classic LiteDOS-SE and LiteDOS 2.x), and directory entry formats — is based on the technical documentation of the LiteDOS-SE user manual.

---

## 8. License

**ATRaction** is free software licensed under the **GNU General Public License, version 2 or any later version** (`GPL-2.0-or-later`). The full text of the license is available in the [LICENSE.txt](LICENSE.txt) file.

The choice of license reflects that components handling disk formats — extended MyDOS VTOC, SDFS bitmap, Indus GT CP/M 2.2, DOS 2.5 allocation maps, format detection rules, and read-only validation — are derived from the **ATIO** library of the **Altirra** emulator (© 2009–2021 Avery Lee), licensed under GPL-2.0-or-later. Reconstructing these mechanisms with open reference source code makes those sections derivative works, and ATRaction accordingly inherits the GPL.

**Exception:** The file `js/dos_templates.js` contains literal copies of boot sectors and system binaries (`DOS.SYS`, `DUP.SYS`) from Atari DOS 2.0S, DOS 2.5, DOS II+/D, MyDOS 4.5x, and LiteDOS-SE. These are not the original work of this project, are not covered by the GPL, and no rights are granted to them — each remains the property of its respective rights holder.

A complete itemized breakdown of third-party assets and code origins is available in [THIRD-PARTY.txt](THIRD-PARTY.txt).

---

*Documentation generated for ATRaction (v2026.08).*
