/*
 * ATRaction - Atari 8-bit ATR/XFD disk image manager
 * Copyright (C) 2026 dely / blowjobb / ng
 *
 * Contains work derived from the Altirra emulator by Avery Lee, licensed
 * GPL-2.0-or-later:
 *   ATIO/source/diskfsdos2.cpp  Copyright (C) 2009-2015 Avery Lee
 *
 * Derived here: the paged, multi-sector MyDOS VTOC bitmap model, verified against
 *   ATDiskFSDOS2::InitNew.
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
 * MyDOS 4.5x File System Parser and Manipulator
 * Supports SD (90K), ED (130K), DD (180K), QD (368K / 1440 sectors x 256B) and
 * DS/QD (720K / 2880 sectors x 256B) images, hierarchical subdirectories,
 * sector allocation, file import/delete/rename/lock, and formatting.
 *
 * VTOC layout (verified against a real MyDOS QD image, _disks/XL Digital.atr):
 *  - the allocation bitmap is one contiguous bit array; the bit for sector N
 *    sits at bit N, counted from byte 10 of sector 360 onwards,
 *  - the bitmap is measured in 128-byte "units". Unit 0 is the first half of
 *    sector 360; on 256-byte-sector disks unit 1 is the second half of the very
 *    same sector, and only when more units are needed does the VTOC grow
 *    downwards into sectors 359, 358, ...,
 *  - VTOC byte 0 holds (number of units + 1): 2 for <=943 sectors, 3 for a
 *    1040- or 1440-sector disk, 4 for a 2880-sector disk.
 */

const MYDOS_DIR_ENTRIES_PER_SECTOR = 8;   // 8 entries per directory sector, also in double density
const MYDOS_DIR_BYTES_PER_SECTOR = MYDOS_DIR_ENTRIES_PER_SECTOR * 16;
const MYDOS_MAX_SHORTLINK_SECTORS = 943;  // above this MyDOS switches to 16-bit sector links

if (typeof T === 'undefined') {
    globalThis.T = function (text) {
        var args = Array.prototype.slice.call(arguments, 1);
        var s = text;
        for (var i = 0; i < args.length; i++) s = s.split('{' + i + '}').join(args[i]);
        return s;
    };
}

class MyDOS {
    /**
     * @param {ATRImage} atr Image instance
     */
    constructor(atr) {
        this.atr = atr;
        this.dosType = 'MyDOS';
        this.initVTOC();
        this.validate();
    }

    /**
     * Computes the VTOC geometry for a disk of the given size
     * @param {number} sectorCount
     * @param {number} sectorSize 128 or 256
     * @returns {{units: number, unitsPerSector: number, vtocSectorCount: number, vtocByte: number}}
     */
    static vtocGeometry(sectorCount, sectorSize) {
        //   the first VTOC sector holds 118 bytes (944 sector bits); beyond that
        //   the VTOC grows in 256-byte pages - which is two paired sectors in
        //   single density and one sector in double density.
        //     943 sector SD -> $02, 1 sector      1023 sector DD -> $02, 1 sector
        //     944 sector SD -> $03, 2 sectors     1024 sector DD -> $03, 1 sector
        //    1968 sector SD -> $04, 4 sectors     1968 sector DD -> $04, 2 sectors
        let vtocSectorCount = 1;
        let vtocByte = 0x02;
        let pages = 0;

        if (sectorSize === 128) {
            if (sectorCount > 943) {
                pages = (sectorCount + 1 + 80 + 2047) >> 11;
                vtocSectorCount = pages * 2;      // allocated in pairs in SD
                vtocByte = pages + 2;
            }
        } else if (sectorCount >= 1024) {
            pages = (sectorCount + 1 + 80 + 2047) >> 11;
            vtocSectorCount = pages;
            vtocByte = pages + 2;
        }

        return {
            pages: pages,
            unitsPerSector: Math.max(1, Math.floor(sectorSize / 128)),
            vtocSectorCount: vtocSectorCount,
            vtocByte: vtocByte,
            bitmapBytes: pages ? 256 * pages : sectorSize
        };
    }

    initVTOC() {
        const vtoc = this.atr.readSector(360);
        this.vtocByte = vtoc[0];
        this.totalSectors = vtoc[1] | (vtoc[2] << 8);
        this.freeSectors = vtoc[3] | (vtoc[4] << 8);
        this.sectorSize = this.atr.getSectorSize(360);

        // the number of 256-byte pages comes from byte 0, and the bitmap is one
        // contiguous byte stream spread over sectors 360, 359, 358...
        const pages = this.vtocByte >= 2 ? this.vtocByte - 2 : 0;
        this.vtocPages = pages;
        this.bitmapBytes = pages ? 256 * pages : this.sectorSize;
        this.vtocSectorCount = pages ? Math.ceil(this.bitmapBytes / this.sectorSize) : 1;
        this.firstVtocSector = 360 - (this.vtocSectorCount - 1);

        // Disks above 943 sectors cannot address every sector through the
        // 10-bit DOS 2 links, so MyDOS stores full 16-bit sector numbers.
        this.useFileId = this.atr.sectorCount <= MYDOS_MAX_SHORTLINK_SECTORS;
    }

    /**
     * Locates the bitmap bit of a sector inside the (possibly multi-sector) VTOC
     * @param {number} sector
     * @returns {{sector: number, offset: number, mask: number}|null}
     */
    vtocBitLocation(sector) {
        if (sector < 0 || sector > this.atr.sectorCount) return null;

        const byteIndex = 10 + (sector >> 3);          // byte inside the contiguous bitmap stream
        if (byteIndex >= this.bitmapBytes) return null;

        const vtocSector = 360 - Math.floor(byteIndex / this.sectorSize);
        if (vtocSector < 1 || vtocSector > this.atr.sectorCount) return null;

        return {
            sector: vtocSector,
            offset: byteIndex % this.sectorSize,
            mask: 0x80 >> (sector & 7)
        };
    }

    /**
     * True when the sector holds VTOC or root directory data
     * @param {number} sector
     * @returns {boolean}
     */
    isSystemSector(sector) {
        return (sector >= this.firstVtocSector && sector <= 368);
    }

    validate() {
        this.isReadOnly = false;
        this.validationError = null;
        this.validationWarning = null;

        const usedSectors = new Set();
        for (let s = 1; s <= 3; s++) usedSectors.add(s);
        for (let s = this.firstVtocSector; s <= 368; s++) usedSectors.add(s);

        const collectFiles = (fileList) => {
            for (const file of fileList) {
                if (file.isValid && !file.isDeleted) {
                    if (file.sectors) {
                        file.sectors.forEach(s => usedSectors.add(s));
                    }
                    if (file.isDir) {
                        // A subdirectory occupies `sectorCount` consecutive sectors
                        // starting at startSector; it has no sector chain of its own.
                        for (let i = 0; i < (file.sectorCount || 0); i++) {
                            usedSectors.add(file.startSector + i);
                        }
                        if (file.subFiles) collectFiles(file.subFiles);
                    }
                }
            }
        };
        collectFiles(this.getDirectory());

        let freeInBitmap = 0, usedMarkedFree = 0, freeMarkedAllocated = 0;
        const limitSec = this.atr.sectorCount;
        for (let s = 1; s <= limitSec; s++) {
            if (s <= 3 || this.isSystemSector(s)) continue;
            const isFree = this.isSectorFree(s);
            if (isFree) freeInBitmap++;
            const isUsed = usedSectors.has(s);
            if (isUsed && isFree) {
                usedMarkedFree++;
            } else if (!isUsed && !isFree) {
                freeMarkedAllocated++;
            }
        }

        if (usedMarkedFree > 0) {
            this.isReadOnly = true;
            this.validationError = T("Błędna bitmapa alokacji: zajęte sektory są oznaczone jako wolne w VTOC. Obraz zamontowano w trybie tylko do odczytu (read-only), aby zapobiec uszkodzeniu danych.");
        } else if (freeMarkedAllocated > 0 && this.freeSectors === 0) {
            this.isReadOnly = true;
            this.validationError = T("Błędna bitmapa alokacji w VTOC (brak wolnych sektorów w bitmapie mimo wolnej przestrzeni). Obraz zamontowano w trybie tylko do odczytu (read-only), aby zapobiec uszkodzeniu danych.");
        } else if (freeMarkedAllocated > 0) {
            this.validationWarning = T("Uwaga: bitmapa alokacji w VTOC zawiera zagubione sektory (oznaczone jako zajęte, choć żaden plik ich nie używa).");
        }
    }

    /**
     * Checks if a sector is free in MyDOS VTOC
     * @param {number} sector 
     * @returns {boolean}
     */
    isSectorFree(sector) {
        if (sector < 1 || sector > this.atr.sectorCount) return false;

        const loc = this.vtocBitLocation(sector);
        if (!loc) return false;

        const vtocData = this.atr.readSector(loc.sector);
        if (loc.offset >= vtocData.length) return false;

        return (vtocData[loc.offset] & loc.mask) !== 0;
    }

    /**
     * Sets a sector free or used in MyDOS VTOC
     * @param {number} sector 
     * @param {boolean} free 
     */
    setSectorFree(sector, free) {
        if (sector < 1 || sector > this.atr.sectorCount) return;

        const loc = this.vtocBitLocation(sector);
        if (!loc) return;

        const vtocData = this.atr.readSector(loc.sector);
        if (loc.offset >= vtocData.length) return;

        const wasFree = (vtocData[loc.offset] & loc.mask) !== 0;

        if (free) {
            vtocData[loc.offset] |= loc.mask;
            if (!wasFree) this.freeSectors++;
        } else {
            vtocData[loc.offset] &= ~loc.mask;
            if (wasFree) this.freeSectors--;
        }

        this.atr.writeSector(loc.sector, vtocData);

        // Update free sector count in main VTOC Sector 360
        const mainVtoc = this.atr.readSector(360);
        mainVtoc[3] = this.freeSectors & 0xFF;
        mainVtoc[4] = (this.freeSectors >> 8) & 0xFF;
        this.atr.writeSector(360, mainVtoc);
    }

    /**
     * Allocates next available free sector
     * @returns {number} Allocated sector or 0 if full
     */
    allocateSector() {
        for (let s = 4; s <= this.atr.sectorCount; s++) {
            if (!this.isSystemSector(s) && this.isSectorFree(s)) {
                this.setSectorFree(s, false);
                return s;
            }
        }
        return 0;
    }

    /**
     * Reads directory hierarchy starting from root (sectors 361-368)
     * @param {number} [startSector=361] 
     * @param {string} [parentPath=''] 
     * @returns {Array<Object>} List of file and directory objects
     */
    getDirectory(startSector = 361, parentPath = '') {
        const files = [];
        let globalEntryIndex = 0;
        let brokenDir = false;

        const dirSectors = [];
        if (startSector === 361) {
            for (let s = 361; s <= 368; s++) dirSectors.push(s);
        } else {
            // Subdirectory chain
            let cur = startSector;
            const visited = new Set();
            while (cur > 0 && cur <= this.atr.sectorCount && !visited.has(cur)) {
                visited.add(cur);
                dirSectors.push(cur);
                // In MyDOS subdirs, directory sectors may be chained or allocated as 8 sectors
                if (dirSectors.length >= 8) break;
                cur++;
            }
        }

        for (const sector of dirSectors) {
            const secData = this.atr.readSector(sector);
            // A MyDOS directory sector always holds 8 entries; on double density
            // the upper half of the sector stays unused (64 files per directory).
            const entriesPerSec = Math.min(MYDOS_DIR_ENTRIES_PER_SECTOR, Math.floor(secData.length / 16));

            for (let entry = 0; entry < entriesPerSec; entry++) {
                const off = entry * 16;
                const flag = secData[off];

                let isZero = true;
                for (let i = 0; i < 16; i++) {
                    if (secData[off + i] !== 0) {
                        isZero = false;
                        break;
                    }
                }
                if (isZero || flag === 0x00) {
                    brokenDir = true;
                    globalEntryIndex++;
                    continue;
                }

                const isDeleted = flag === 0x80 || (flag & 0x80) !== 0;
                const dfl = (flag & 0x88) === 0; // Accept only valid MyDOS flags (b0xxX-0Xxx)
                if (brokenDir && !isDeleted && !dfl) {
                    globalEntryIndex++;
                    continue;
                }
                if (!isDeleted && !dfl) {
                    brokenDir = true;
                    globalEntryIndex++;
                    continue;
                }

                const sectorCount = secData[off + 1] | (secData[off + 2] << 8);
                const fileStart = secData[off + 3] | (secData[off + 4] << 8);

                if (!isDeleted && fileStart > this.atr.sectorCount) {
                    brokenDir = true;
                    globalEntryIndex++;
                    continue;
                }

                const isDir = (flag & 0x10) !== 0 && !isDeleted && sectorCount === 8;
                const isValid = !isDeleted && dfl && ((flag & 0x40) !== 0 || isDir);
                const isLocked = (flag & 0x20) !== 0;

                if (isValid || isDeleted) {
                    const nameBytes = secData.subarray(off + 5, off + 13);
                    const extBytes = secData.subarray(off + 13, off + 16);

                    const nameStr = ATASCII.bytesToString(nameBytes, false).trim();
                    const extStr = ATASCII.bytesToString(extBytes, false).trim();
                    const fullName = extStr ? `${nameStr}.${extStr}` : nameStr;
                    const fullPath = parentPath ? `${parentPath}/${fullName}` : fullName;

                    const sectorInfo = isValid && !isDir ? this.traceFileSectors(fileStart, flag) : { sectors: [], totalBytes: 0 };

                    const fileObj = {
                        index: globalEntryIndex,
                        dirSector: sector,
                        dirOffset: off,
                        flag: flag,
                        isValid: isValid,
                        isDeleted: isDeleted,
                        isLocked: isLocked,
                        isDir: isDir,
                        name: nameStr,
                        ext: extStr,
                        nameBytes: new Uint8Array(nameBytes),
                        extBytes: new Uint8Array(extBytes),
                        fullName: fullName,
                        fullPath: fullPath,
                        startSector: fileStart,
                        sectorCount: sectorCount,
                        sizeBytes: sectorInfo.totalBytes,
                        sectors: sectorInfo.sectors,
                        subFiles: []
                    };

                    // Recurse subdirectories
                    if (isDir && isValid && fileStart > 0) {
                        fileObj.subFiles = this.getDirectory(fileStart, fullPath);
                    }

                    files.push(fileObj);
                }
                globalEntryIndex++;
            }
        }

        return files;
    }

    /**
     * Decides whether a file uses DOS 2 links (6-bit file id + 10-bit sector)
     * or MyDOS extended links (16-bit sector number).
     * Bit 2 of the directory flag marks extended files, see $46 vs $42.
     * @param {number} [flag] Directory entry flag byte
     * @returns {boolean}
     */
    usesFileId(flag) {
        if (flag !== undefined && flag !== null) return (flag & 0x04) === 0;
        return this.useFileId;
    }

    /**
     * Follows file sector chain in MyDOS (128B or 256B sectors)
     * @param {number} startSector
     * @param {number} [flag] Directory entry flag byte
     * @returns {{sectors: Array<number>, totalBytes: number}}
     */
    traceFileSectors(startSector, flag) {
        const sectors = [];
        let curSec = startSector;
        let totalBytes = 0;
        const visited = new Set();

        while (curSec > 0 && curSec <= this.atr.sectorCount && !visited.has(curSec)) {
            visited.add(curSec);
            sectors.push(curSec);

            const secData = this.atr.readSector(curSec);
            const secSize = secData.length;
            const payloadSize = secSize - 3;
            const dataLen = secData[secSize - 1];

            totalBytes += Math.min(dataLen, payloadSize);

            const useFileId = this.usesFileId(flag);
            const nextSecHi = useFileId ? (secData[secSize - 3] & 0x03) : secData[secSize - 3];
            const nextSecLo = secData[secSize - 2];
            const nextSector = (nextSecHi << 8) | nextSecLo;

            if (nextSector === 0 || nextSector === curSec) break;
            curSec = nextSector;
        }

        return { sectors, totalBytes };
    }

    /**
     * Reads file payload from MyDOS disk
     * @param {Object} fileObj 
     * @returns {Uint8Array}
     */
    readFile(fileObj) {
        const result = new Uint8Array(fileObj.sizeBytes);
        let writeOffset = 0;

        let curSec = fileObj.startSector;
        const visited = new Set();

        while (curSec > 0 && curSec <= this.atr.sectorCount && !visited.has(curSec)) {
            visited.add(curSec);
            const secData = this.atr.readSector(curSec);
            const secSize = secData.length;
            const payloadSize = secSize - 3;
            const dataLen = Math.min(secData[secSize - 1], payloadSize);

            for (let i = 0; i < dataLen && writeOffset < result.length; i++) {
                result[writeOffset++] = secData[i];
            }

            const useFileId = this.usesFileId(fileObj.flag);
            const nextSecHi = useFileId ? (secData[secSize - 3] & 0x03) : secData[secSize - 3];
            const nextSecLo = secData[secSize - 2];
            const nextSector = (nextSecHi << 8) | nextSecLo;

            if (nextSector === 0) break;
            curSec = nextSector;
        }

        return result;
    }

    /**
     * Creates a new subdirectory in MyDOS
     * @param {string} dirName Subdirectory name (e.g. SUBDIR)
     * @param {number} [dirStartSector=361] Parent directory start sector
     */
    createDirectory(dirName, dirStartSector = 361) {
        const f83 = ATASCII.formatFilename83(dirName);
        const nameBytes = ATASCII.stringToBytes(f83.paddedName);
        const extBytes = ATASCII.stringToBytes(f83.paddedExt);

        const sectorSize = this.atr.getSectorSize(4);

        if (this.freeSectors < 8) {
            throw new Error(T("Brak miejsca w obrazie MyDOS. Wymagane: 8 sektorów, Dostępne: {0}", this.freeSectors));
        }

        // A MyDOS subdirectory is a run of 8 consecutive sectors: the directory
        // entry stores only the first sector, so the block must not be split.
        let runStart = 0;
        for (let s = 4; s + 7 <= this.atr.sectorCount; s++) {
            let fits = true;
            for (let i = 0; i < 8; i++) {
                if (this.isSystemSector(s + i) || !this.isSectorFree(s + i)) { fits = false; break; }
            }
            if (fits) { runStart = s; break; }
        }
        if (!runStart) {
            throw new Error(T("Brak 8 kolejnych wolnych sektorów wymaganych przez podkatalog MyDOS."));
        }

        const allocatedSectors = [];
        for (let i = 0; i < 8; i++) {
            this.setSectorFree(runStart + i, false);
            allocatedSectors.push(runStart + i);
        }

        // Clear subdirectory sectors
        for (const s of allocatedSectors) {
            this.atr.writeSector(s, new Uint8Array(sectorSize));
        }

        // Find empty/deleted entry slot in parent directory
        const dirSectors = [];
        if (dirStartSector === 361) {
            for (let s = 361; s <= 368; s++) dirSectors.push(s);
        } else {
            let cur = dirStartSector;
            const visited = new Set();
            while (cur > 0 && cur <= this.atr.sectorCount && !visited.has(cur)) {
                visited.add(cur);
                dirSectors.push(cur);
                if (dirSectors.length >= 8) break;
                cur++;
            }
        }

        let written = false;
        for (const s of dirSectors) {
            const secData = this.atr.readSector(s);
            const entries = Math.min(MYDOS_DIR_ENTRIES_PER_SECTOR, Math.floor(secData.length / 16));

            for (let e = 0; e < entries; e++) {
                const off = e * 16;
                const flag = secData[off];

                if (flag === 0x00 || flag === 0x80) {
                    secData[off] = 0x52; // Subdirectory flag in MyDOS ($52 = in-use | subdir | DOS 2.0)
                    secData[off + 1] = 8 & 0xFF; // Sector count = 8
                    secData[off + 2] = 0;
                    secData[off + 3] = allocatedSectors[0] & 0xFF; // First sector
                    secData[off + 4] = (allocatedSectors[0] >> 8) & 0xFF;

                    secData.set(nameBytes, off + 5);
                    secData.set(extBytes, off + 13);

                    this.atr.writeSector(s, secData);
                    written = true;
                    break;
                }
            }
            if (written) break;
        }

        if (!written) {
            allocatedSectors.forEach(s => this.setSectorFree(s, true));
            throw new Error(T("Katalog nadrzędny jest pełny (maksymalnie {0} pozycji).", MYDOS_DIR_ENTRIES_PER_SECTOR * 8));
        }
    }

    /**
     * Adds a new file to MyDOS
     * @param {string} filename 
     * @param {Uint8Array} fileBytes 
     * @param {number} [dirStartSector=361] 
     * @returns {Object}
     */
    importFile(filename, fileBytes, dirStartSector = 361) {
        const f83 = ATASCII.formatFilename83(filename);
        const sectorSize = this.atr.getSectorSize(4);
        const payloadSize = sectorSize - 3;

        const sectorsNeeded = Math.max(1, Math.ceil(fileBytes.length / payloadSize));
        if (sectorsNeeded > this.freeSectors) {
            throw new Error(T("Brak miejsca w obrazie MyDOS. Wymagane: {0} sektorów, Dostępne: {1}", sectorsNeeded, this.freeSectors));
        }

        // Find free dir entry slot
        let targetSector = 0;
        let targetOff = 0;
        let targetIndex = -1;

        const dirSectors = [];
        if (dirStartSector === 361) {
            for (let s = 361; s <= 368; s++) dirSectors.push(s);
        } else {
            let cur = dirStartSector;
            const visited = new Set();
            while (cur > 0 && cur <= this.atr.sectorCount && !visited.has(cur)) {
                visited.add(cur);
                dirSectors.push(cur);
                if (dirSectors.length >= 8) break;
                cur++;
            }
        }
        let globalIdx = 0;
        const nameUpper = f83.fullName.toUpperCase();
        for (const s of dirSectors) {
            const secData = this.atr.readSector(s);
            const entries = Math.min(MYDOS_DIR_ENTRIES_PER_SECTOR, Math.floor(secData.length / 16));
            for (let e = 0; e < entries; e++) {
                const off = e * 16;
                const flag = secData[off];
                if (flag === 0x00 || flag === 0x80) {
                    if (targetSector === 0) {
                        targetSector = s;
                        targetOff = off;
                        targetIndex = globalIdx;
                    }
                } else if ((flag & 0x40) !== 0) {
                    const nameBytes = secData.subarray(off + 5, off + 13);
                    const extBytes = secData.subarray(off + 13, off + 16);
                    const existingName = ATASCII.bytesToString(nameBytes, false).trim();
                    const existingExt = ATASCII.bytesToString(extBytes, false).trim();
                    const existingFull = (existingExt ? `${existingName}.${existingExt}` : existingName).toUpperCase();
                    if (existingFull === nameUpper) {
                        throw new Error(T("Plik '{0}' już istnieje w tym katalogu.", f83.fullName));
                    }
                }
                globalIdx++;
            }
        }

        if (targetSector === 0) {
            throw new Error(T("Katalog jest pełny (maksymalnie {0} pozycji).", MYDOS_DIR_ENTRIES_PER_SECTOR * 8));
        }

        // Allocate sectors
        const allocatedSectors = [];
        for (let i = 0; i < sectorsNeeded; i++) {
            const sec = this.allocateSector();
            if (!sec) {
                allocatedSectors.forEach(s => this.setSectorFree(s, true));
                throw new Error(T("Nie udało się przydzielić sektorów."));
            }
            allocatedSectors.push(sec);
        }

        // Write file sector data
        let readOffset = 0;
        for (let i = 0; i < sectorsNeeded; i++) {
            const curSec = allocatedSectors[i];
            const nextSec = (i < sectorsNeeded - 1) ? allocatedSectors[i + 1] : 0;
            const chunkSize = Math.min(payloadSize, fileBytes.length - readOffset);

            const sectorBuf = new Uint8Array(sectorSize);
            sectorBuf.set(fileBytes.subarray(readOffset, readOffset + chunkSize), 0);
            readOffset += chunkSize;

            // Link bytes: DOS 2.0 format (with file_id) for <=943 sectors,
            // extended 16-bit format for larger disks (ED/QD/DS-QD)
            const useFileId = this.useFileId;
            if (useFileId) {
                sectorBuf[sectorSize - 3] = ((targetIndex & 0x3F) << 2) | ((nextSec >> 8) & 0x03);
            } else {
                sectorBuf[sectorSize - 3] = (nextSec >> 8) & 0xFF;
            }
            sectorBuf[sectorSize - 2] = nextSec & 0xFF;
            sectorBuf[sectorSize - 1] = chunkSize;

            this.atr.writeSector(curSec, sectorBuf);
        }

        // Write Directory Entry
        // Flag $42 for DOS 2.0 links, $46 for MyDOS extended 16-bit links
        const dirSec = this.atr.readSector(targetSector);
        dirSec[targetOff] = this.useFileId ? 0x42 : 0x46;
        dirSec[targetOff + 1] = sectorsNeeded & 0xFF;
        dirSec[targetOff + 2] = (sectorsNeeded >> 8) & 0xFF;
        dirSec[targetOff + 3] = allocatedSectors[0] & 0xFF;
        dirSec[targetOff + 4] = (allocatedSectors[0] >> 8) & 0xFF;
        dirSec.set(f83.atasciiName, targetOff + 5);

        this.atr.writeSector(targetSector, dirSec);

        return {
            name: f83.fullName,
            sectors: allocatedSectors,
            sizeBytes: fileBytes.length
        };
    }

    /**
     * Deletes a file in MyDOS
     * @param {Object} fileObj 
     */
    deleteFile(fileObj) {
        if (fileObj.isLocked) {
            throw new Error(T("Plik '{0}' jest zablokowany.", fileObj.fullName));
        }

        if (fileObj.isDir) {
            for (let i = 0; i < fileObj.sectorCount; i++) {
                this.setSectorFree(fileObj.startSector + i, true);
            }
        } else if (fileObj.sectors && fileObj.sectors.length > 0) {
            fileObj.sectors.forEach(sec => this.setSectorFree(sec, true));
        }

        const dirSec = this.atr.readSector(fileObj.dirSector);
        dirSec[fileObj.dirOffset] = 0x80;
        this.atr.writeSector(fileObj.dirSector, dirSec);
    }

    /**
     * Renames a file in MyDOS
     * @param {Object} fileObj 
     * @param {string} newFilename 
     */
    renameFile(fileObj, newFilename) {
        if (fileObj.isLocked) {
            throw new Error(T("Plik '{0}' jest zablokowany.", fileObj.fullName));
        }

        const f83 = ATASCII.formatFilename83(newFilename);
        const dirSec = this.atr.readSector(fileObj.dirSector);
        dirSec.set(f83.atasciiName, fileObj.dirOffset + 5);
        this.atr.writeSector(fileObj.dirSector, dirSec);
    }

    /**
     * Toggles lock on a file
     * @param {Object} fileObj 
     * @param {boolean} lock 
     */
    setLock(fileObj, lock) {
        const dirSec = this.atr.readSector(fileObj.dirSector);
        if (lock) {
            dirSec[fileObj.dirOffset] |= 0x20;
        } else {
            dirSec[fileObj.dirOffset] &= ~0x20;
        }
        this.atr.writeSector(fileObj.dirSector, dirSec);
    }

    /**
     * Formats disk under MyDOS (supports SD, ED, DD, and QD 368K / 1440 sectors)
     * @param {ATRImage} atr 
     */
    static formatDisk(atr) {
        const sectorCount = atr.sectorCount;
        const secSize = atr.getSectorSize(360);
        const geom = MyDOS.vtocGeometry(sectorCount, secSize);
        const firstVtocSector = 360 - (geom.vtocSectorCount - 1);

        // Clear dir sectors (361..368)
        const emptySec = new Uint8Array(secSize);
        for (let s = 361; s <= 368; s++) {
            atr.writeSector(s, emptySec);
        }

        // The bitmap is one contiguous byte stream spread over sectors
        // 360, 359, 358... - stream byte B lives in sector 360 - B/secSize.
        const vtocSectors = [];
        for (let i = 0; i < geom.vtocSectorCount; i++) {
            vtocSectors.push(new Uint8Array(secSize));
        }
        const streamByte = (byteIndex, value) => {
            if (byteIndex >= geom.bitmapBytes) return;
            const idx = Math.floor(byteIndex / secSize);                   // 0 = sector 360
            vtocSectors[idx][byteIndex % secSize] |= value;
        };

        // Usable data sectors: everything except the 3 boot sectors,
        // the VTOC sectors and the 8 directory sectors.
        const availSectors = sectorCount - 3 - 8 - geom.vtocSectorCount;

        const vtoc = vtocSectors[0];
        vtoc[0] = geom.vtocByte;
        // MyDOS stores the total *data* sectors (usable sectors) in bytes 1-2, not the physical count.
        vtoc[1] = availSectors & 0xFF;
        vtoc[2] = (availSectors >> 8) & 0xFF;
        vtoc[3] = availSectors & 0xFF;
        vtoc[4] = (availSectors >> 8) & 0xFF;

        // Mark every data sector free (bit = 1); boot, VTOC and directory stay 0.
        for (let s = 4; s <= sectorCount; s++) {
            if (s >= firstVtocSector && s <= 368) continue;
            streamByte(10 + (s >> 3), 0x80 >> (s & 7));
        }

        for (let i = 0; i < geom.vtocSectorCount; i++) {
            atr.writeSector(360 - i, vtocSectors[i]);
        }

        return new MyDOS(atr);
    }
}
