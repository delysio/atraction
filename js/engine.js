/*
 * ATRaction - Atari 8-bit ATR/XFD disk image manager
 * Copyright (C) 2026 dely / blowjobb / ng
 *
 * Contains work derived from the Altirra emulator by Avery Lee, licensed
 * GPL-2.0-or-later:
 *   ATIO/source/diskfs.cpp     Copyright (C) 2009-2014 Avery Lee
 *   ATIO/source/diskimage.cpp  Copyright (C) 2008-2025 Avery Lee
 *   Altirra/source/uidisk.cpp  Copyright (C) 2009-2010 Avery Lee
 *
 * Derived here: the filesystem detection order and its boot signatures
 *   (ATDiskMountImage), the read-only validation mechanism, and
 *   checkFormatSupport(), which follows IsCurrentFormatSupported().
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
 * High-Level DiskManager Coordinator
 * Wraps low-level ATR Image and DOS handlers (Atari DOS/DOS 2.5, MyDOS, SpartaDOS).
 * Provides a unified API for load, save, create, format, file CRUD operations, and stats.
 */

if (typeof T === 'undefined') {
    globalThis.T = function (text) {
        var args = Array.prototype.slice.call(arguments, 1);
        var s = text;
        for (var i = 0; i < args.length; i++) s = s.split('{' + i + '}').join(args[i]);
        return s;
    };
}

class DiskManager {
    constructor() {
        this.atr = null;
        this.dos = null;
        this.dosType = 'UNKNOWN';
    }

    /**
     * Loads an ATR image from raw bytes
     * @param {Uint8Array} bytes 
     */
    load(bytes) {
        this.atr = new ATRImage(bytes);
        this.detectDOS();
    }

    /**
     * Describes an ATR header that disagrees with the file it sits in, or null
     * when the two match. A short image lost data in transfer; a long one has
     * something appended. Either way the geometry the header promises is not the
     * geometry present, so the sector the app would write to need not be the
     * sector the header points at.
     * @returns {string|null}
     */
    headerSizeMismatchNotice() {
        if (!this.atr || !this.atr.hasHeaderSizeMismatch) return null;
        const declared = this.atr.headerReportedSize;
        const actual = this.atr.actualFileSize;
        const diff = Math.abs(actual - declared);
        const detail = (actual < declared)
            ? T("brakuje {0} B", diff.toLocaleString())
            : T("nadmiarowe {0} B", diff.toLocaleString());
        return T("Nagłówek ATR deklaruje obraz o rozmiarze {0} B, a plik ma {1} B ({2}). Obraz jest niekompletny lub uszkodzony i został zamontowany w trybie tylko do odczytu (read-only).",
            declared.toLocaleString(), actual.toLocaleString(), detail);
    }

    /**
     * Why the loaded image must not be written to, or null when writing is fine.
     * @returns {string|null}
     */
    readOnlyReason() {
        const headerNotice = this.headerSizeMismatchNotice();
        if (headerNotice) return headerNotice;
        if (this.dos && this.dos.isReadOnly) {
            return this.dos.validationError ||
                T("Obraz jest zamontowany w trybie tylko do odczytu (Read-Only) z powodu błędów w alokacji dysku.");
        }
        return null;
    }

    /**
     * Automatically detects DOS format from image headers and VTOC
     */
    detectDOS() {
        const sec1 = this.atr.readSector(1);
        const sec360 = (this.atr.sectorCount >= 360) ? this.atr.readSector(360) : null;

        // Check LiteDOS FIRST
        if (typeof LiteDOS !== 'undefined' && LiteDOS.detect(this.atr)) {
            try {
                this.dos = new LiteDOS(this.atr);
                this.dosType = 'LiteDOS-SE';
                if (this.dos && this.dos.validate) this.dos.validate();
                return;
            } catch (e) { }
        }

        // Check CP/M 2.2 (Indus GT / Atari 1090) FIRST
        const cpmProfile = (typeof CPM !== 'undefined') ? CPM.detectProfile(this.atr) : null;
        if (cpmProfile) {
            try {
                this.dos = new CPM(this.atr, cpmProfile);
                this.dosType = cpmProfile.dosType;
                // Do not force isXFD here: sector access is already geometry
                // aware, and flipping the flag without converting the data
                // shifts every sector of an ATR-backed image by 384 bytes.
                // export() still emits XFD through convertToXFD().
                if (this.dos && this.dos.validate) this.dos.validate();
                return;
            } catch (e) { }
        }

        // SpartaDOS by boot signature. "$80 is the signature byte
        // for SDX SD/DD disks; $40 is for DD 512." Checking it here also keeps
        // 512-byte volumes, whose sector 360 is ordinary file data, from being
        // taken for a DOS 2 disk.
        if (sec1[7] === 0x80 || sec1[7] === 0x40) {
            try {
                const sparta = new SpartaDOS(this.atr);
                if (sparta.boot.sectorMap > 0 && sparta.boot.sectorMap <= this.atr.sectorCount) {
                    this.dos = sparta;
                    this.dosType = 'SpartaDOS';
                    return;
                }
            } catch (e) { }
        }

        // Check MyDOS / DOS 2 VTOC Sector 360 FIRST
        if (sec360) {
            const vtocByte = sec360[0];
            const totSectors = sec360[1] | (sec360[2] << 8);

            // DOS 2 keeps 2..5 in VTOC byte 0, but MyDOS stores (bitmap pages + 2)
            // there, so a large volume carries a much higher value - $23 (35) on a
            // 65535-sector 16 MB disk. Accept anything whose implied VTOC still fits
            // between the boot sectors and the root directory; otherwise sector 360
            // is not a VTOC at all.
            const vtocSectorSize = this.atr.getSectorSize(360);
            const vtocSpan = (vtocByte >= 3) ? Math.ceil(256 * (vtocByte - 2) / vtocSectorSize) : 1;
            const vtocPlausible = (vtocByte === 0 || vtocByte >= 2) && vtocByte <= 35 && (360 - (vtocSpan - 1)) > 3;

            if (vtocPlausible && totSectors >= 700 && totSectors <= this.atr.sectorCount + 10) {
                // Check if MyDOS subdirectories are present in root directory
                // (sectors 361..368). Only up to the end of the directory: a
                // subdirectory entry past the $00 marker is a leftover from the
                // disk's previous contents and must not decide the format.
                let hasMyDOSSubdirs = false;
                let dirEnded = false;
                for (let s = 361; s <= 368 && s <= this.atr.sectorCount && !dirEnded; s++) {
                    try {
                        const secData = this.atr.readSector(s);
                        // DOS 2 / MyDOS directory sectors always hold 8 entries,
                        // even in double density
                        const dirBytes = Math.min(secData.length, 128);
                        for (let e = 0; e < dirBytes; e += 16) {
                            const flag = secData[e];
                            if (flag === 0x00) { dirEnded = true; break; }
                            if (flag !== 0x80 && (flag & 0x10) !== 0 && (flag & 0x88) === 0) {
                                const sectorCount = secData[e + 1] | (secData[e + 2] << 8);
                                const startSector = secData[e + 3] | (secData[e + 4] << 8);
                                if (startSector >= 4 && startSector <= this.atr.sectorCount && sectorCount === 8) {
                                    const nameBytes = secData.subarray(e + 5, e + 16);
                                    if (typeof ATASCII !== 'undefined' && ATASCII.checkCharInName && ATASCII.checkCharInName(nameBytes, true) > 0) {
                                        hasMyDOSSubdirs = true;
                                        break;
                                    }
                                }
                            }
                        }
                    } catch (err) { }
                    if (hasMyDOSSubdirs) break;
                }

                // MyDOS signatures:
                // 1. Subdirectories present (bit 0x10 in directory flags)
                // 2. Boot sector byte 0 === 0x4D ('M')
                // 3. Large disk (> 1040 sectors) except DOS II+ MD (totSectors === 1009)
                // 4. Multi-page VTOC (byte 0 above 5) - DOS 2 never writes one
                const isMyDOS = hasMyDOSSubdirs || sec1[0] === 0x4D || vtocByte > 5 ||
                    (this.atr.sectorCount > 1040 && totSectors !== 1009);

                if (isMyDOS) {
                    this.dos = new MyDOS(this.atr);
                    this.dosType = 'MyDOS';
                    if (this.dos && this.dos.validate) this.dos.validate();
                    return;
                }

                // Atari DOS / DOS 2.5 / DOS II+/D
                try {
                    this.dos = new AtariDOS2(this.atr);
                    this.dosType = this.dos.dosType;
                    if (this.dos && this.dos.validate) this.dos.validate();
                    return;
                } catch (e) { }
            }
        }

        // Check SpartaDOS Boot Signature
        const spartaSmap = sec1[9] | (sec1[10] << 8);
        const spartaSCount = sec1[11] | (sec1[12] << 8);
        // Sector size code: 128 -> 128 B, 0 -> 256 B, 1 -> 512 B
        if (spartaSmap > 0 && spartaSmap <= this.atr.sectorCount && spartaSCount > 0 &&
            (sec1[31] === 0 || sec1[31] === 128 || sec1[31] === 1)) {
            try {
                const sparta = new SpartaDOS(this.atr);
                if (sparta.boot.sectorMap > 0) {
                    this.dos = sparta;
                    this.dosType = 'SpartaDOS';
                    if (this.dos && this.dos.validate) this.dos.validate();
                    return;
                }
            } catch (e) {
                // Not SpartaDOS
            }
        }

        // Fallback to Atari DOS
        try {
            this.dos = new AtariDOS2(this.atr);
            this.dosType = this.dos.dosType || 'Atari DOS';
            if (this.dos && this.dos.validate) this.dos.validate();
        } catch (e) {
            this.dos = null;
            this.dosType = 'RAW / Unknown';
        }
    }

    /**
     * Gets all file and folder entries in current image
     * @returns {Array<Object>}
     */
    getFiles() {
        if (!this.dos || !this.dos.getDirectory) return [];
        return this.dos.getDirectory();
    }

    /**
     * Reads raw bytes of a file
     * @param {Object} fileObj 
     * @returns {Uint8Array}
     */
    readFile(fileObj) {
        if (!this.dos || !this.dos.readFile) throw new Error(T("Moduł odczytu DOS nie jest dostępny."));
        return this.dos.readFile(fileObj);
    }

    /**
     * Extracts file as Uint8Array (Raw) or converted ATASCII text string
     * @param {Object} fileObj 
     * @param {'raw'|'text'} mode 
     * @returns {Uint8Array|string}
     */
    extractFile(fileObj, mode = 'raw') {
        const rawBytes = this.readFile(fileObj);
        if (mode === 'text') {
            return ATASCII.bytesToString(rawBytes, true);
        }
        return rawBytes;
    }

    /**
     * Creates a new subdirectory on the current disk image
     * @param {string} dirName Subdirectory name
     * @param {Object} [parentDirObj] Optional parent directory file object
     */
    createDirectory(dirName, parentDirObj = null) {
        if (!this.dos || !this.dos.createDirectory) {
            throw new Error(T("Tworzenie podkatalogów nie jest obsługiwane dla DOS ({0}).", this.dosType));
        }
        const readOnly = this.readOnlyReason();
        if (readOnly) throw new Error(readOnly);
        let parentSector = undefined;
        if (parentDirObj) {
            parentSector = parentDirObj.startSector;
        }
        return this.dos.createDirectory(dirName, parentSector);
    }

    /**
     * Imports a new file from PC
     * @param {string} filename 
     * @param {Uint8Array} fileBytes 
     * @param {Object|number} [targetDirObj] Optional target directory file object or sector
     * @returns {Object}
     */
    importFile(filename, fileBytes, targetDirObj = null) {
        if (!this.dos || !this.dos.importFile) {
            throw new Error(T("Operacje zapisu nie są obsługiwane dla wykrytego DOS ({0}).", this.dosType));
        }
        const readOnly = this.readOnlyReason();
        if (readOnly) throw new Error(readOnly);
        let targetSector = undefined;
        if (targetDirObj && typeof targetDirObj === 'object') {
            targetSector = targetDirObj.startSector;
        } else if (typeof targetDirObj === 'number') {
            targetSector = targetDirObj;
        }
        return this.dos.importFile(filename, fileBytes, targetSector);
    }

    /**
     * Deletes a file from the disk image
     * @param {Object} fileObj 
     */
    deleteFile(fileObj) {
        if (!this.dos || !this.dos.deleteFile) {
            throw new Error(T("Usuwanie plików nie jest obsługiwane dla DOS ({0}).", this.dosType));
        }
        const readOnly = this.readOnlyReason();
        if (readOnly) throw new Error(readOnly);
        this.dos.deleteFile(fileObj);
    }

    /**
     * Renames a file inside the disk image
     * @param {Object} fileObj 
     * @param {string} newName 
     */
    renameFile(fileObj, newName) {
        if (!this.dos || !this.dos.renameFile) {
            throw new Error(T("Zmiana nazwy nie jest obsługiwana dla DOS ({0}).", this.dosType));
        }
        const readOnly = this.readOnlyReason();
        if (readOnly) throw new Error(readOnly);
        this.dos.renameFile(fileObj, newName);
    }

    /**
     * Toggles lock status on a file
     * @param {Object} fileObj 
     * @param {boolean} lock 
     */
    setLock(fileObj, lock) {
        if (!this.dos || !this.dos.setLock) {
            throw new Error(T("Blokowanie plików nie jest obsługiwane dla DOS ({0}).", this.dosType));
        }
        const readOnly = this.readOnlyReason();
        if (readOnly) throw new Error(readOnly);
        this.dos.setLock(fileObj, lock);
    }

    /**
     * Sets file attributes (A, H, P) for SpartaDOS SDFS
     * @param {Object} fileObj 
     * @param {Object} attrs { protected?: boolean, hidden?: boolean, archived?: boolean }
     */
    setAttributes(fileObj, attrs) {
        if (!this.dos || !this.dos.setAttributes) {
            throw new Error(T("Edycja atrybutów A H P nie jest obsługiwana dla {0}.", this.dosType));
        }
        const readOnly = this.readOnlyReason();
        if (readOnly) throw new Error(readOnly);
        this.dos.setAttributes(fileObj, attrs);
    }

    /**
     * Maps a DOS selector onto a CP/M layout profile. The two CP/M variants
     * share one module and differ only by profile, so every place that has to
     * tell them apart - geometry checks, creation, formatting, export - goes
     * through here rather than matching on strings of its own.
     * @param {string} dosType
     * @returns {Object|null} The profile, or null when this is not a CP/M type
     */
    static cpmProfileFor(dosType) {
        if (typeof CPM === 'undefined') return null;
        switch (dosType) {
            case 'CPM1090':
            case 'CP/M 2.2 (Atari 1090)':
                return CPM.PROFILES.ATARI1090;
            case 'CPM':
            case 'CP/M':
            case 'CP/M 2.2 (Indus GT)':
                return CPM.PROFILES.INDUS;
            default:
                return null;
        }
    }

    /**
     * Checks whether a filesystem can be put on the given geometry.
     * @param {string} dosType
     * @param {{sectorCount: number, sectorSize: number, bootSectorCount: number}} geom
     * @returns {string|null} null when supported, otherwise the reason
     */
    static checkFormatSupport(dosType, geom) {
        const { sectorCount, sectorSize, bootSectorCount } = geom;

        if (sectorSize !== 128 && sectorSize !== 256 && sectorSize !== 512) {
            return T('Rozmiar sektora musi wynosić 128, 256 lub 512 bajtów.');
        }
        if (sectorCount < bootSectorCount || sectorCount > 65535) {
            return T('Liczba sektorów musi mieścić się w zakresie {0}..65535.', bootSectorCount);
        }

        switch (dosType) {
            case 'NONE':
                return null;

            case 'DOS2PLUS':
            case 'DOS II+/D':
                // DOS II+/D: 720 sectors SD or DD; adds 1040 x 128 B (MD)
                if (bootSectorCount !== 3) return T('DOS II+/D wymaga 3 sektorów startowych.');
                if (sectorSize !== 128 && sectorSize !== 256) return T('DOS II+/D obsługuje sektory 128 lub 256 bajtów.');
                if (sectorCount === 1040) {
                    if (sectorSize !== 128) return T('Dysk 1040-sektorowy (ED) wymaga sektorów 128-bajtowych.');
                } else if (sectorCount !== 720) {
                    return T('DOS II+/D obsługuje wyłącznie 720 lub 1040 sektorów.');
                }
                return null;

            case 'Atari DOS':
            case 'DOS2':
            case 'DOS20':
                // Atari DOS 2.0S only ever shipped for the classic SD disk
                if (bootSectorCount !== 3) return T('Atari DOS 2.0S wymaga 3 sektorów startowych.');
                if (sectorSize !== 128) return T('Atari DOS 2.0S obsługuje wyłącznie sektory 128-bajtowe (SD).');
                if (sectorCount !== 720) return T('Atari DOS 2.0S obsługuje wyłącznie dyski SD (720 sektorów).');
                return null;

            case 'DOS2.5':
            case 'DOS25':
                // DOS 2.5 supports SD (720) and MD/ED (1040, 130 KB) only - never DD/QD
                if (bootSectorCount !== 3) return T('Atari DOS 2.5 wymaga 3 sektorów startowych.');
                if (sectorSize !== 128) return T('Atari DOS 2.5 obsługuje wyłącznie sektory 128-bajtowe.');
                if (sectorCount !== 720 && sectorCount !== 1040) return T('Atari DOS 2.5 obsługuje wyłącznie dyski SD (720) lub MD (1040 sektorów).');
                return null;

            case 'MyDOS':
                if (bootSectorCount !== 3) return T('MyDOS wymaga 3 sektorów startowych.');
                if (sectorSize !== 128 && sectorSize !== 256) return T('MyDOS obsługuje sektory 128 lub 256 bajtów.');
                if (sectorCount < 720) return T('MyDOS wymaga co najmniej 720 sektorów.');
                return null;

            case 'SpartaDOS':
            case 'Sparta DOS':
                // SDFS only constrains the sector count; it derives
                // its own boot reservation from the sector size (1 sector at 512 B,
                // otherwise 3).
                if (sectorCount < 16) return T('SpartaDOS wymaga co najmniej 16 sektorów.');
                return null;

            case 'CPM':
            case 'CP/M':
            case 'CP/M 2.2 (Indus GT)':
                if (sectorSize !== 256) return T('CP/M 2.2 (Indus GT) wymaga sektorów 256-bajtowych.');
                if (sectorCount < 64 || sectorCount > 44 + 256 * 4) return T('CP/M 2.2 (Indus GT) obsługuje od 64 do 1068 sektorów.');
                return null;

            case 'CPM1090':
            case 'CP/M 2.2 (Atari 1090)': {
                // Only the 128-byte media are covered - the card's BIOS also
                // carries DPBs for 256-byte disks, but nothing to verify them
                // against, so they stay out until a reference image shows up.
                const p1090 = DiskManager.cpmProfileFor(dosType);
                const minSec = p1090 ? p1090.minSectors : 102;
                const maxSec = p1090 ? p1090.maxSectors : 1040;
                if (sectorSize !== 128) return T('CP/M 2.2 (Atari 1090) wymaga sektorów 128-bajtowych.');
                if (sectorCount < minSec || sectorCount > maxSec) {
                    return T('CP/M 2.2 (Atari 1090) obsługuje od {0} do {1} sektorów.', minSec, maxSec);
                }
                return null;
            }

            case 'LiteDOS':
            case 'LiteDOS-SE':
                return T('Tworzenie nowych obrazów LiteDOS nie jest obsługiwane.');

            default:
                return null;
        }
    }

    /**
     * Creates a new blank ATR disk image and formats it under selected DOS
     * @param {'SD'|'MD'|'ED'|'DD'|'QD'|'DSDD'|'CUSTOM'} density
     * @param {'DOS2'|'DOS25'|'DOS2PLUS'|'MyDOS'|'SpartaDOS'|'CPM'|'NONE'} dosType
     * @param {boolean} [installSystem=true] Whether to install system boot sectors and DOS.SYS / DUP.SYS
     * @param {Object} [custom] Geometry for density 'CUSTOM': {sectorCount, sectorSize, bootSectorCount}
     */
    createNew(density, dosType = 'DOS2PLUS', installSystem = true, custom = null) {
        let actualDensity = density;
        const cpmProfile = DiskManager.cpmProfileFor(dosType);
        // Indus CP/M images travel as headerless XFD, the 1090 ones as ATR
        const isCPM = !!cpmProfile && cpmProfile.container === 'xfd';
        if (cpmProfile) {
            if (density !== 'CUSTOM') {
                // Each variant only reads its own kind of medium, so anything
                // the caller asks for outside that list becomes the native one:
                // 180 KB DD for the Indus GT, 130 KB MD/ED for the 1090 card.
                const requested = (density === 'MD') ? 'ED' : density;
                actualDensity = cpmProfile.densities.includes(requested) ? requested : cpmProfile.densities[0];
            }
        } else if (density === 'MD') {
            actualDensity = 'ED';
        }

        if (actualDensity === 'CUSTOM') {
            const geom = {
                sectorCount: Math.max(1, Math.min(65535, custom && custom.sectorCount || 720)),
                sectorSize: (custom && custom.sectorSize) || 128,
                bootSectorCount: custom && custom.bootSectorCount !== undefined ? custom.bootSectorCount : 3
            };
            if (geom.sectorSize > 256) geom.bootSectorCount = 0;

            const problem = DiskManager.checkFormatSupport(dosType, geom);
            if (problem) throw new Error(problem);

            // System files are never installed on a custom geometry
            installSystem = false;
            this.atr = ATRImage.createNew('CUSTOM', geom.sectorCount, geom.sectorSize, isCPM, geom.bootSectorCount);
        } else {
            this.atr = ATRImage.createNew(actualDensity, 0, 128, isCPM);

            // Standard densities go through the same compatibility check as a
            // custom geometry, so e.g. "MD" stays out of reach for Atari DOS
            // 2.0S even if requested by something other than the dropdown
            // (which already restricts the visible options).
            const geom = {
                sectorCount: this.atr.sectorCount,
                sectorSize: this.atr.sectorSize,
                bootSectorCount: this.atr.bootSectorCount
            };
            const problem = DiskManager.checkFormatSupport(dosType, geom);
            if (problem) throw new Error(problem);
        }
        const isDD = this.atr.isDD;

        if (dosType === 'NONE') {
            this.dos = null;
            this.dosType = 'RAW / Unknown';
            return;
        }

        if (dosType === 'DOS2PLUS' || dosType === 'DOS II+/D') {
            this.dos = AtariDOS2.formatDisk(this.atr, dosType);
            this.dosType = 'DOS II+/D';
            if (installSystem && typeof DOS_TEMPLATES !== 'undefined' && DOS_TEMPLATES.DOS2PLUS) {
                const tmpl = DOS_TEMPLATES.DOS2PLUS;
                const bootB64 = isDD ? (tmpl.bootB64_DD || tmpl.sysB64_DD) : (tmpl.bootB64_SD || tmpl.sysB64_SD);
                if (bootB64) {
                    const bootBytes = base64ToUint8Array(bootB64);
                    this.atr.writeSector(1, bootBytes.subarray(0, 128));
                    this.atr.writeSector(2, bootBytes.subarray(128, 256));
                    this.atr.writeSector(3, bootBytes.subarray(256, 384));
                    // The boot record identifies the DOS, so re-read it now that it exists
                    this.dos.initVTOC();
                }

                const filesDict = isDD ? tmpl.files_DD : tmpl.files_SD;
                if (filesDict && filesDict['DOS.SYS']) {
                    const dosSysBytes = base64ToUint8Array(filesDict['DOS.SYS']);
                    this.importFile('DOS.SYS', dosSysBytes);
                }
            }
        } else if (dosType === 'MyDOS') {
            this.dos = MyDOS.formatDisk(this.atr);
            this.dosType = 'MyDOS';
            if (installSystem && typeof DOS_TEMPLATES !== 'undefined' && DOS_TEMPLATES.MYDOS) {
                const tmpl = DOS_TEMPLATES.MYDOS;
                const bootB64 = isDD ? (tmpl.bootB64_DD || tmpl.sysB64_DD) : (tmpl.bootB64_SD || tmpl.sysB64_SD);
                if (bootB64) {
                    const bootBytes = base64ToUint8Array(bootB64);
                    this.atr.writeSector(1, bootBytes.subarray(0, 128));
                    this.atr.writeSector(2, bootBytes.subarray(128, 256));
                    this.atr.writeSector(3, bootBytes.subarray(256, 384));
                }

                const filesDict = isDD ? tmpl.files_DD : tmpl.files_SD;
                if (filesDict) {
                    if (filesDict['DOS.SYS']) {
                        this.importFile('DOS.SYS', base64ToUint8Array(filesDict['DOS.SYS']));
                    }
                    if (filesDict['DUP.SYS']) {
                        this.importFile('DUP.SYS', base64ToUint8Array(filesDict['DUP.SYS']));
                    }
                }
            }
        } else if (dosType === 'Atari DOS' || dosType === 'DOS2' || dosType === 'DOS20') {
            this.dos = AtariDOS2.formatDisk(this.atr, 'Atari DOS');
            this.dosType = 'Atari DOS';
            if (installSystem && typeof DOS_TEMPLATES !== 'undefined' && DOS_TEMPLATES.DOS2) {
                const tmpl = DOS_TEMPLATES.DOS2;
                const bootB64 = tmpl.bootB64_SD || tmpl.sysB64_SD;
                if (bootB64) {
                    const bootBytes = base64ToUint8Array(bootB64);
                    this.atr.writeSector(1, bootBytes.subarray(0, 128));
                    this.atr.writeSector(2, bootBytes.subarray(128, 256));
                    this.atr.writeSector(3, bootBytes.subarray(256, 384));
                }

                const filesDict = tmpl.files_SD;
                if (filesDict) {
                    if (filesDict['DOS.SYS']) this.importFile('DOS.SYS', base64ToUint8Array(filesDict['DOS.SYS']));
                    if (filesDict['DUP.SYS']) this.importFile('DUP.SYS', base64ToUint8Array(filesDict['DUP.SYS']));
                }
            }
        } else if (dosType === 'DOS2.5' || dosType === 'DOS25') {
            this.dos = AtariDOS2.formatDisk(this.atr, 'DOS2.5');
            this.dosType = 'DOS2.5';
            if (installSystem && typeof DOS_TEMPLATES !== 'undefined' && DOS_TEMPLATES.DOS25) {
                const tmpl = DOS_TEMPLATES.DOS25;
                // DOS 2.5 uses the same boot sectors on SD and MD/ED - verified
                // byte-for-byte on the reference disks; only DOS.SYS itself
                // differs between the two (an embedded geometry table).
                const bootB64 = tmpl.bootB64_SD || tmpl.sysB64_SD;
                if (bootB64) {
                    const bootBytes = base64ToUint8Array(bootB64);
                    this.atr.writeSector(1, bootBytes.subarray(0, 128));
                    this.atr.writeSector(2, bootBytes.subarray(128, 256));
                    this.atr.writeSector(3, bootBytes.subarray(256, 384));
                }

                const filesDict = (this.atr.sectorCount === 1040) ? (tmpl.files_ED || tmpl.files_SD) : tmpl.files_SD;
                if (filesDict) {
                    if (filesDict['DOS.SYS']) this.importFile('DOS.SYS', base64ToUint8Array(filesDict['DOS.SYS']));
                    if (filesDict['DUP.SYS']) this.importFile('DUP.SYS', base64ToUint8Array(filesDict['DUP.SYS']));
                }
            }
        } else if (dosType === 'SpartaDOS' || dosType === 'Sparta DOS') {
            this.dos = SpartaDOS.formatDisk(this.atr);
            this.dosType = 'SpartaDOS';
        } else if (dosType === 'LiteDOS' || dosType === 'LiteDOS-SE') {
            throw new Error(T("Tworzenie nowych obrazów w formacie LiteDOS nie jest obsługiwane. Aplikacja jedynie odczytuje, modyfikuje i formatuje istniejące dyski LiteDOS."));
        } else if (cpmProfile) {
            this.formatAsCPM(cpmProfile);
        } else {
            this.dos = AtariDOS2.formatDisk(this.atr, dosType);
            this.dosType = dosType;
        }
        if (this.dos && this.dos.validate) this.dos.validate();
    }

    /**
     * Lays a fresh CP/M directory on the mounted image. The reserved system
     * tracks are left untouched, so a bootable disk keeps its CP/M system;
     * a disk created here has none and will not boot.
     * @param {Object} profile
     */
    formatAsCPM(profile) {
        CPM.formatDisk(this.atr, profile);
        this.dos = new CPM(this.atr, profile);
        this.dosType = profile.dosType;
        if (profile.container === 'xfd' && this.atr.convertToXFD) this.atr.convertToXFD();
    }

    /**
     * Formats current loaded image
     * @param {'Atari DOS'|'DOS2.5'|'MyDOS'|'SpartaDOS'|'LiteDOS'} dosType
     */
    format(dosType = 'Atari DOS') {
        if (!this.atr) throw new Error(T("Brak wczytanego obrazu ATR."));

        if (dosType === 'SpartaDOS' || dosType === 'Sparta DOS') {
            this.dos = SpartaDOS.formatDisk(this.atr);
            this.dosType = 'SpartaDOS';
        } else if (dosType === 'MyDOS') {
            this.dos = MyDOS.formatDisk(this.atr);
            this.dosType = 'MyDOS';
        } else if (dosType === 'LiteDOS' || dosType === 'LiteDOS-SE') {
            let clusterSize = this.atr.sectorCount > 1440 ? 8 : (this.atr.sectorCount > 1040 ? 4 : (this.atr.sectorCount > 720 ? 2 : 1));
            // The LiteDOS bitmap holds 944 (SD) or 1024 (DD) clusters; grow the
            // cluster size until the whole disk fits into it.
            const maxClusters = (this.atr.isDD ? 128 : 118) * 8;
            while (clusterSize < 64 && Math.ceil(this.atr.sectorCount / clusterSize) > maxClusters) {
                clusterSize *= 2;
            }
            this.dos = LiteDOS.formatDisk(this.atr, clusterSize);
            this.dosType = 'LiteDOS-SE';
        } else if (DiskManager.cpmProfileFor(dosType)) {
            this.formatAsCPM(DiskManager.cpmProfileFor(dosType));
        } else {
            this.dos = AtariDOS2.formatDisk(this.atr, dosType);
            this.dosType = dosType;
        }
        if (this.dos && this.dos.validate) this.dos.validate();
    }

    /**
     * Exports updated ATR file byte array
     * @returns {Uint8Array}
     */
    export() {
        if (!this.atr) throw new Error(T("Brak wczytanego obrazu ATR."));
        // Only the Indus GT variant is passed around as a headerless XFD; the
        // 1090 images are ordinary, Atari-bootable ATR files and must stay that way.
        if (typeof CPM !== 'undefined' && this.dos instanceof CPM && this.dos.profile.container === 'xfd') {
            if (this.atr.convertToXFD) this.atr.convertToXFD();
        }
        return this.atr.export();
    }

    /**
     * Returns disk status metrics
     * @returns {Object}
     */
    getDiskStats() {
        if (!this.atr) {
            return {
                density: 'N/A',
                dosType: 'None',
                sectorCount: 0,
                freeSectors: 0,
                usedSectors: 0,
                totalBytes: 0,
                freeBytes: 0
            };
        }

        let freeSectors = 0;
        if (this.dos) {
            freeSectors = this.dos.freeSectors !== undefined ? this.dos.freeSectors : (this.dos.boot ? this.dos.boot.freeSectors : 0);
            if (this.dos.freeSectorsED) freeSectors += this.dos.freeSectorsED;
        }

        const sectorCount = this.atr.sectorCount;
        const isUnrealistic = isNaN(freeSectors) || freeSectors < 0 || freeSectors > sectorCount;
        let hasSizeMismatch = this.atr.hasSizeMismatch || false;

        // Check if DOS type doesn't match standard sector count
        if (this.dosType === 'Atari DOS' && sectorCount !== 720) {
            hasSizeMismatch = true;
        } else if (this.dosType === 'DOS2.5' && sectorCount !== 1040 && sectorCount !== 720) {
            hasSizeMismatch = true;
        }

        // MyDOS and SpartaDOS address any geometry up to 65535 sectors by design,
        // so a sector count outside the five floppy formats is normal there and
        // must not be reported as a risky, non-standard image.
        const variableGeometryDOS = (this.dosType === 'MyDOS' || this.dosType === 'SpartaDOS');
        const isCustomDensity = (this.atr.isCustomDensity || false) && !variableGeometryDOS;
        const isSizeNonStandard = hasSizeMismatch || isCustomDensity || isUnrealistic;

        // A header contradicting the file is reported through the read-only panel
        // (readOnlyReason()), not here, so the two panels never echo each other.
        let nonStandardSizeNotice = null;
        if (hasSizeMismatch) {
            const actual = this.atr.actualFileSize ? this.atr.actualFileSize.toLocaleString() : '0';
            const expected = this.atr.expectedTotalSize ? this.atr.expectedTotalSize.toLocaleString() : '0';
            nonStandardSizeNotice = T("Niestandardowy rozmiar obrazu dysku ({0} sektorów, rozmiar pliku: {1} B, oczekiwano: {2} B dla {3}). Modyfikowanie plików na tym obrazie może doprowadzić do uszkodzenia danych.", sectorCount, actual, expected, this.dosType);
        } else if (isCustomDensity) {
            nonStandardSizeNotice = T("Niestandardowa gęstość dysku ({0} sektorów). Modyfikowanie plików może dać nieprzewidziane efekty.", sectorCount);
        } else if (isUnrealistic) {
            nonStandardSizeNotice = T("Niestandardowe parametry dysku (odczytane wolne sektory wykraczają poza pojemność). Zachowaj ostrożność.");
        }

        const usedSectors = isUnrealistic ? 0 : Math.max(0, sectorCount - freeSectors);
        const avgSectorSize = this.atr.isDD ? 256 : 128;
        const totalBytes = this.atr.imageSize - 16;
        const freeBytes = freeSectors * (avgSectorSize - 3);

        return {
            density: this.atr.density,
            densityType: this.atr.densityType,
            dosType: this.dosType,
            sectorCount: sectorCount,
            freeSectors: freeSectors,
            usedSectors: usedSectors,
            totalBytes: totalBytes,
            freeBytes: Math.max(0, freeBytes),
            isUnrealistic: isUnrealistic,
            isSizeNonStandard: isSizeNonStandard,
            nonStandardSizeNotice: nonStandardSizeNotice,
            isReadOnly: !!this.readOnlyReason(),
            validationError: this.readOnlyReason(),
            validationWarning: this.dos && this.dos.validationWarning ? this.dos.validationWarning : null
        };
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = DiskManager;
}
