/*
 * ATRaction - Atari 8-bit ATR/XFD disk image manager
 * Copyright (C) 2026 dely / blowjobb / ng
 *
 * Contains work derived from the Altirra emulator by Avery Lee, licensed
 * GPL-2.0-or-later:
 *   ATIO/source/diskfsdos2.cpp  Copyright (C) 2009-2015 Avery Lee
 *
 * Derived here: the DOS 2.5 second allocation map (VTOC2), the reserved-sector rules
 *   and the allocation validator, following ATDiskFSDOS2::Validate / ::InitNew.
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
 * Atari DOS and DOS 2.5 File System Parser and Manipulator
 * Handles VTOC Sector 360 / 1024, Directory Sectors 361-368, Sector chaining,
 * file reading, importing, deleting, renaming, locking, and formatting.
 */

if (typeof T === 'undefined') {
    globalThis.T = function (text) {
        var args = Array.prototype.slice.call(arguments, 1);
        var s = text;
        for (var i = 0; i < args.length; i++) s = s.split('{' + i + '}').join(args[i]);
        return s;
    };
}

class AtariDOS2 {
    /**
     * @param {ATRImage} atr Image instance
     */
    constructor(atr) {
        this.atr = atr;
        this.dosType = 'DOS2'; // 'DOS2.0' or 'DOS2.5'
        this.initVTOC();
        this.validate();
    }

    initVTOC() {
        const vtoc = this.atr.readSector(360);
        this.vtocType = vtoc[0];
        this.totalSectors = vtoc[1] | (vtoc[2] << 8);
        this.freeSectors = vtoc[3] | (vtoc[4] << 8);

        // In single and double density the VTOC of DOS II+/D is indistinguishable
        // from Atari DOS 2.0, so the DOS is identified by its boot record instead.
        // Byte 0 carries the DOS id: $C4 = DOS II+/D, $4D = MyDOS, $00 = Atari DOS.
        this.hasDos2PlusBoot = AtariDOS2.hasDos2PlusBootSignature(this.atr);

        if (this.vtocType === 3 || this.totalSectors === 1009 || this.totalSectors === 1027) {
            this.isDos2PlusMD = true;
            this.isDos25 = false;
            this.dosType = 'DOS II+/D';
        } else if (this.atr.sectorCount === 1040) {
            this.isDos25 = true;
            this.isDos2PlusMD = false;
            this.dosType = 'DOS2.5';
            // Read VTOC2 at sector 1024. Layout:
            //   bytes 0..83   copy of the sector 360 bitmap for sectors 48..719
            //   bytes 84..121 bitmap for sectors 720..1023
            //   bytes 122-123 number of free sectors above sector 719
            const vtoc2 = this.atr.readSector(1024);
            this.freeSectorsED = vtoc2[122] | (vtoc2[123] << 8);
        } else {
            this.isDos25 = false;
            this.isDos2PlusMD = false;
            this.dosType = this.hasDos2PlusBoot ? 'DOS II+/D' : 'Atari DOS';
        }
    }

    /**
     * Detects the DOS II+/D boot record ($C4, 3 boot sectors, its SEC/BCS stub).
     * Verified against the shipped template and the third-party disk
     * _disks/Forever5.atr, which carries the same signature.
     * @param {ATRImage} atr
     * @returns {boolean}
     */
    static hasDos2PlusBootSignature(atr) {
        const boot = atr.readSector(1);
        return boot[0] === 0xC4 && boot[1] === 0x03 && boot[6] === 0x38 && boot[7] === 0xB0;
    }

    validate() {
        this.isReadOnly = false;
        this.validationError = null;
        this.validationWarning = null;

        const usedSectors = new Set();
        // Highest sector the file system can actually address. DOS II+/D reaches
        // 1023 just like DOS 2.5 - its VTOC2 in sector 359 is a 10-byte map of
        // sectors 944..1023 - so on a 1040-sector image the last 17 sectors carry
        // no bitmap bit at all and must stay out of the allocation audit.
        const isDos2PlusMD = this.isDos2PlusMD || this.vtocType === 3;
        const maxSec = isDos2PlusMD ? 1023 : (this.isDos25 ? 1023 : 719);

        // System sectors
        for (let s = 1; s <= 3; s++) usedSectors.add(s);
        usedSectors.add(360);
        // Sector 720 is the permanently reserved last sector of an 810 floppy on
        // every DOS 2 derivative that can address past it, not just DOS 2.5.
        // "Reserved" is not "occupied": no data lives there, so a bitmap that
        // calls it free is untidy rather than dangerous and must not lock the
        // image - handing sector 720 out would overwrite nothing.
        const reservedSectors = new Set();
        if (this.isDos25 || isDos2PlusMD) reservedSectors.add(720);
        reservedSectors.forEach(s => usedSectors.add(s));
        if (this.isDos25) usedSectors.add(1024);
        if (isDos2PlusMD) usedSectors.add(359);
        for (let s = 361; s <= 368; s++) usedSectors.add(s);

        const files = this.getDirectory();
        for (const file of files) {
            if (file.isValid && !file.isDeleted && file.sectors) {
                file.sectors.forEach(s => usedSectors.add(s));
            }
        }

        let freeInBitmap = 0, usedMarkedFree = 0, freeMarkedAllocated = 0;
        const limitSec = Math.min(this.atr.sectorCount, maxSec);
        for (let s = 1; s <= limitSec; s++) {
            if (s === 360 || (this.isDos25 && s === 1024) || (isDos2PlusMD && s === 359)) continue;
            const isFree = this.isSectorFree(s);
            if (isFree) freeInBitmap++;
            const isUsed = usedSectors.has(s);
            if (isUsed && isFree) {
                if (!reservedSectors.has(s)) usedMarkedFree++;
            } else if (!isUsed && !isFree) {
                freeMarkedAllocated++;
            }
        }

        // DOS 2.5 splits the free-sector count in two: the counter in sector 360
        // covers sectors 0..719 and the one in VTOC2 covers the 720..1023 area.
        // The whole disk is only full when both read zero - testing sector 360
        // alone locks a disk that still has room in its extended area.
        const freeSectorsTotal = this.freeSectors + (this.freeSectorsED || 0);

        if (usedMarkedFree > 0) {
            this.isReadOnly = true;
            this.validationError = T("Błędna bitmapa alokacji: zajęte sektory są oznaczone jako wolne w VTOC. Obraz zamontowano w trybie tylko do odczytu (read-only), aby zapobiec uszkodzeniu danych.");
        } else if (freeMarkedAllocated > 0 && freeSectorsTotal === 0) {
            this.isReadOnly = true;
            this.validationError = T("Błędna bitmapa alokacji w VTOC (brak wolnych sektorów w bitmapie mimo wolnej przestrzeni). Obraz zamontowano w trybie tylko do odczytu (read-only), aby zapobiec uszkodzeniu danych.");
        } else if (freeMarkedAllocated > 0) {
            this.validationWarning = T("Uwaga: bitmapa alokacji w VTOC zawiera zagubione sektory (oznaczone jako zajęte, choć żaden plik ich nie używa).");
        }
    }

    /**
     * Checks if a sector is marked free in VTOC bitmap
     * @param {number} sector (1..sectorCount)
     * @returns {boolean}
     */
    isSectorFree(sector) {
        if (sector < 1 || sector > this.atr.sectorCount) return false;

        const maxSec360 = (this.isDos2PlusMD || this.vtocType === 3) ? 943 : 719;

        if (sector <= maxSec360) {
            const vtoc = this.atr.readSector(360);
            const byteIdx = 10 + Math.floor(sector / 8);
            const bitMask = 0x80 >> (sector % 8);
            return (vtoc[byteIdx] & bitMask) !== 0;
        } else if (sector >= 944 && sector <= 1023 && (this.isDos2PlusMD || this.vtocType === 3)) {
            // The VTOC2 of DOS II+/D is 10 bytes wide: sectors 944..1023 only.
            const vtoc2 = this.atr.readSector(359);
            const relSec = sector - 944;
            const byteIdx = Math.floor(relSec / 8);
            const bitMask = 0x80 >> (relSec % 8);
            return (vtoc2[byteIdx] & bitMask) !== 0;
        } else if (sector >= 720 && sector <= 1023 && this.isDos25) {
            const vtoc2 = this.atr.readSector(1024);
            const relSec = sector - 720;
            const byteIdx = 84 + Math.floor(relSec / 8);
            const bitMask = 0x80 >> (relSec % 8);
            return (vtoc2[byteIdx] & bitMask) !== 0;
        }
        return false;
    }

    /**
     * Sets a sector free or used in VTOC bitmap
     * @param {number} sector (1..sectorCount)
     * @param {boolean} free true to free, false to mark used
     */
    setSectorFree(sector, free) {
        if (sector < 1 || sector > this.atr.sectorCount) return;

        const maxSec360 = (this.isDos2PlusMD || this.vtocType === 3) ? 943 : 719;

        if (sector <= maxSec360) {
            const vtoc = this.atr.readSector(360);
            const byteIdx = 10 + Math.floor(sector / 8);
            const bitMask = 0x80 >> (sector % 8);

            const wasFree = (vtoc[byteIdx] & bitMask) !== 0;
            if (free) {
                vtoc[byteIdx] |= bitMask;
                if (!wasFree) this.freeSectors++;
            } else {
                vtoc[byteIdx] &= ~bitMask;
                if (wasFree) this.freeSectors--;
            }
            vtoc[3] = this.freeSectors & 0xFF;
            vtoc[4] = (this.freeSectors >> 8) & 0xFF;
            this.atr.writeSector(360, vtoc);

            // DOS 2.5 keeps a copy of the sectors 48..719 bitmap in VTOC2
            if (this.isDos25 && sector >= 48 && sector <= 719) {
                const vtoc2 = this.atr.readSector(1024);
                vtoc2[(sector >> 3) - 6] = vtoc[byteIdx];
                this.atr.writeSector(1024, vtoc2);
            }
        } else if (sector >= 944 && sector <= 1023 && (this.isDos2PlusMD || this.vtocType === 3)) {
            // Mirror of isSectorFree(): writing past sector 1023 would run off the
            // 10-byte VTOC2 and corrupt the bytes after it in sector 359.
            const vtoc2 = this.atr.readSector(359);
            const relSec = sector - 944;
            const byteIdx = Math.floor(relSec / 8);
            const bitMask = 0x80 >> (relSec % 8);

            const wasFree = (vtoc2[byteIdx] & bitMask) !== 0;
            if (free) {
                vtoc2[byteIdx] |= bitMask;
                if (!wasFree) this.freeSectors++;
            } else {
                vtoc2[byteIdx] &= ~bitMask;
                if (wasFree) this.freeSectors--;
            }
            this.atr.writeSector(359, vtoc2);

            const vtoc = this.atr.readSector(360);
            vtoc[3] = this.freeSectors & 0xFF;
            vtoc[4] = (this.freeSectors >> 8) & 0xFF;
            this.atr.writeSector(360, vtoc);
        } else if (sector >= 720 && sector <= 1023 && this.isDos25) {
            const vtoc2 = this.atr.readSector(1024);
            const relSec = sector - 720;
            const byteIdx = 84 + Math.floor(relSec / 8);
            const bitMask = 0x80 >> (relSec % 8);

            const wasFree = (vtoc2[byteIdx] & bitMask) !== 0;
            if (free) {
                vtoc2[byteIdx] |= bitMask;
                if (!wasFree) this.freeSectorsED++;
            } else {
                vtoc2[byteIdx] &= ~bitMask;
                if (wasFree) this.freeSectorsED--;
            }
            vtoc2[122] = this.freeSectorsED & 0xFF;
            vtoc2[123] = (this.freeSectorsED >> 8) & 0xFF;
            this.atr.writeSector(1024, vtoc2);
        }
    }

    /**
     * Allocates the next free sector from VTOC
     * @returns {number} Allocated sector number or 0 if disk full
     */
    allocateSector() {
        // Preferred range for data sectors in DOS 2: sector 4..359, then 369..719, then 720..1023
        const ranges = [];
        if (this.isDos2PlusMD) {
            ranges.push([4, 358]);
            ranges.push([369, 719]);
            ranges.push([720, 1040]);
        } else {
            ranges.push([4, 359]);
            ranges.push([369, 719]);
            // DOS 2.5 pre-marks sector 720 as allocated and never uses it
            if (this.isDos25) ranges.push([721, 1023]);
        }

        for (const [start, end] of ranges) {
            for (let s = start; s <= end; s++) {
                if (s <= this.atr.sectorCount && this.isSectorFree(s)) {
                    this.setSectorFree(s, false);
                    return s;
                }
            }
        }
        return 0; // Disk full
    }

    /**
     * Reads all directory entries (sectors 361..368)
     * @returns {Array<Object>} List of file objects
     */
    getDirectory() {
        const files = [];
        let globalEntryIndex = 0;
        let brokenDir = false;

        for (let sector = 361; sector <= 368; sector++) {
            const secData = this.atr.readSector(sector);
            // Entry count depends on sector size: 16 bytes per entry
            const entriesPerSector = Math.floor(secData.length / 16);
            let sectorEmpty = true;

            for (let entry = 0; entry < entriesPerSector; entry++) {
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
                    // All-zero entry = end of directory (stop checking after end-of-dir)
                    brokenDir = true;
                    globalEntryIndex++;
                    continue;
                }

                sectorEmpty = false;
                const isDeleted = flag === 0x80;
                const dfs = (flag & 0x9C) === 0; // Accept only valid DOS 2 flags
                if (brokenDir && !isDeleted && !dfs) {
                    globalEntryIndex++;
                    continue;
                }
                if (!isDeleted && !dfs) {
                    brokenDir = true;
                    globalEntryIndex++;
                    continue;
                }

                const sectorCount = secData[off + 1] | (secData[off + 2] << 8);
                const startSector = secData[off + 3] | (secData[off + 4] << 8);

                if (!isDeleted && startSector > this.atr.sectorCount) {
                    brokenDir = true;
                    globalEntryIndex++;
                    continue;
                }

                const isValid = (flag & 0x40) !== 0 && !isDeleted && dfs;
                const isLocked = (flag & 0x20) !== 0;

                if (isValid || isDeleted) {
                    const nameBytes = secData.subarray(off + 5, off + 13);
                    const extBytes = secData.subarray(off + 13, off + 16);

                    const nameStr = ATASCII.bytesToString(nameBytes, false).trim();
                    const extStr = ATASCII.bytesToString(extBytes, false).trim();
                    const fullName = extStr ? `${nameStr}.${extStr}` : nameStr;

                    // Trace file sectors & byte length
                    const sectorInfo = (isValid && startSector > 0) ? this.traceFileSectors(startSector, globalEntryIndex) : { sectors: [], totalBytes: 0 };

                    files.push({
                        index: globalEntryIndex,
                        dirSector: sector,
                        dirOffset: off,
                        flag: flag,
                        isValid: isValid,
                        isDeleted: isDeleted,
                        isLocked: isLocked,
                        isDir: false,
                        name: nameStr,
                        ext: extStr,
                        nameBytes: new Uint8Array(nameBytes),
                        extBytes: new Uint8Array(extBytes),
                        fullName: fullName,
                        startSector: startSector,
                        sectorCount: sectorCount,
                        sizeBytes: sectorInfo.totalBytes,
                        sectors: sectorInfo.sectors
                    });
                }
                globalEntryIndex++;
            }
        }
        return files;
    }

    /**
     * Follows the sector link chain of a file to collect sectors and size
     * @param {number} startSector 
     * @param {number} fileId 
     * @returns {{sectors: Array<number>, totalBytes: number}}
     */
    traceFileSectors(startSector, fileId) {
        const sectors = [];
        let currentSector = startSector;
        let totalBytes = 0;
        const visited = new Set();

        while (currentSector > 0 && currentSector <= this.atr.sectorCount && !visited.has(currentSector)) {
            visited.add(currentSector);
            sectors.push(currentSector);

            const secData = this.atr.readSector(currentSector);
            const secSize = secData.length;
            const payloadSize = secSize - 3;
            const dataLen = Math.min(secData[secSize - 1], payloadSize);
            totalBytes += dataLen;

            // Link bytes at end of sector (offset secSize - 3, secSize - 2)
            const nextSecHi = secData[secSize - 3] & 0x03;
            const nextSecLo = secData[secSize - 2];
            const nextSector = (nextSecHi << 8) | nextSecLo;

            if (nextSector === 0 || nextSector === currentSector) break;
            currentSector = nextSector;
        }

        return { sectors, totalBytes };
    }

    /**
     * Reads file contents byte-by-byte following DOS 2 sector chain
     * @param {Object} fileObj 
     * @returns {Uint8Array}
     */
    readFile(fileObj) {
        const result = new Uint8Array(fileObj.sizeBytes);
        let writeOffset = 0;

        let currentSector = fileObj.startSector;
        const visited = new Set();

        while (currentSector > 0 && currentSector <= this.atr.sectorCount && !visited.has(currentSector)) {
            visited.add(currentSector);
            const secData = this.atr.readSector(currentSector);
            const secSize = secData.length;
            const payloadSize = secSize - 3;
            const dataLen = Math.min(secData[secSize - 1], payloadSize);

            for (let i = 0; i < dataLen && writeOffset < result.length; i++) {
                result[writeOffset++] = secData[i];
            }

            const nextSecHi = secData[secSize - 3] & 0x03;
            const nextSecLo = secData[secSize - 2];
            const nextSector = (nextSecHi << 8) | nextSecLo;

            if (nextSector === 0) break;
            currentSector = nextSector;
        }

        return result;
    }

    /**
     * Imports/Adds a new file to the disk
     * @param {string} filename Standard ASCII filename
     * @param {Uint8Array} fileBytes File content bytes
     * @returns {Object} Added file object
     */
    importFile(filename, fileBytes) {
        const f83 = ATASCII.formatFilename83(filename);

        const sectorSize = this.atr.getSectorSize(4);
        const payloadSize = sectorSize - 3;
        const entriesPerSector = Math.floor(sectorSize / 16);

        // Calculate needed sectors
        const sectorsNeeded = Math.max(1, Math.ceil(fileBytes.length / payloadSize));

        // Check free sector availability
        const freeCount = this.freeSectors + (this.isDos25 ? this.freeSectorsED : 0);
        if (sectorsNeeded > freeCount) {
            throw new Error(T("Brak wolnego miejsca na dysku. Wymagane: {0} sektorów, Dostępne: {1}", sectorsNeeded, freeCount));
        }

        // Check for duplicate filename (case-insensitive duplicate detection)
        const nameUpper = f83.fullName.toUpperCase();
        for (let sector = 361; sector <= 368; sector++) {
            const secData = this.atr.readSector(sector);
            for (let e = 0; e < entriesPerSector; e++) {
                const off = e * 16;
                const flag = secData[off];
                if (flag === 0x00 || flag === 0x80) continue;
                if ((flag & 0x40) === 0) continue;
                const nameBytes = secData.subarray(off + 5, off + 13);
                const extBytes = secData.subarray(off + 13, off + 16);
                const existingName = ATASCII.bytesToString(nameBytes, false).trim();
                const existingExt = ATASCII.bytesToString(extBytes, false).trim();
                const existingFull = (existingExt ? `${existingName}.${existingExt}` : existingName).toUpperCase();
                if (existingFull === nameUpper) {
                    throw new Error(T("Plik '{0}' już istnieje na dysku.", f83.fullName));
                }
            }
        }

        // Find available directory entry slot
        let targetSector = 0;
        let targetOff = 0;
        let targetIndex = -1;
        let globalIndex = 0;

        for (let sector = 361; sector <= 368 && targetIndex === -1; sector++) {
            const secData = this.atr.readSector(sector);
            for (let entry = 0; entry < entriesPerSector; entry++) {
                const off = entry * 16;
                const flag = secData[off];
                if (flag === 0x00 || flag === 0x80) { // empty or deleted slot
                    targetSector = sector;
                    targetOff = off;
                    targetIndex = globalIndex;
                    break;
                }
                globalIndex++;
            }
        }

        if (targetIndex === -1) {
            throw new Error(T("Katalog jest pełny. Maksymalna liczba plików to {0}.", 8 * entriesPerSector));
        }

        // Allocate sectors and build data chain
        const allocatedSectors = [];
        for (let i = 0; i < sectorsNeeded; i++) {
            const sec = this.allocateSector();
            if (!sec) {
                // Rollback allocated sectors if failed
                allocatedSectors.forEach(s => this.setSectorFree(s, true));
                throw new Error(T("Nie udało się przydzielić sektorów na dysku (dysk jest pełny lub zfragmentowany)."));
            }
            allocatedSectors.push(sec);
        }

        // Write sector data with DOS 2 headers
        let readOffset = 0;
        const fileId = targetIndex & 0x3F;

        for (let i = 0; i < sectorsNeeded; i++) {
            const currentSec = allocatedSectors[i];
            const nextSec = (i < sectorsNeeded - 1) ? allocatedSectors[i + 1] : 0;
            const chunkSize = Math.min(payloadSize, fileBytes.length - readOffset);

            const sectorBuf = new Uint8Array(sectorSize);
            // Payload
            sectorBuf.set(fileBytes.subarray(readOffset, readOffset + chunkSize), 0);
            readOffset += chunkSize;

            // Link Bytes at end of sector (offset sectorSize - 3, sectorSize - 2, sectorSize - 1)
            sectorBuf[sectorSize - 3] = ((fileId & 0x3F) << 2) | ((nextSec >> 8) & 0x03);
            sectorBuf[sectorSize - 2] = nextSec & 0xFF;
            sectorBuf[sectorSize - 1] = chunkSize;

            this.atr.writeSector(currentSec, sectorBuf);
        }

        // Write Directory Entry
        // Flag 0x42 = in-use | DOS 2. For DOS 2.5 sectors >720, still 0x42 (not 0x03 which means open-for-write)
        const dirSectorData = this.atr.readSector(targetSector);
        dirSectorData[targetOff] = 0x42;
        dirSectorData[targetOff + 1] = sectorsNeeded & 0xFF;
        dirSectorData[targetOff + 2] = (sectorsNeeded >> 8) & 0xFF;
        dirSectorData[targetOff + 3] = allocatedSectors[0] & 0xFF;
        dirSectorData[targetOff + 4] = (allocatedSectors[0] >> 8) & 0xFF;

        dirSectorData.set(f83.atasciiName, targetOff + 5);
        this.atr.writeSector(targetSector, dirSectorData);

        return {
            name: f83.fullName,
            sectors: allocatedSectors,
            sizeBytes: fileBytes.length
        };
    }

    /**
     * Deletes a file and frees its sectors
     * @param {Object} fileObj 
     */
    deleteFile(fileObj) {
        if (fileObj.isLocked) {
            throw new Error(T("Plik '{0}' jest zablokowany (Tylko do odczytu). Odblokuj go najpierw.", fileObj.fullName));
        }

        // Free sectors in VTOC
        if (fileObj.sectors && fileObj.sectors.length > 0) {
            fileObj.sectors.forEach(sec => this.setSectorFree(sec, true));
        }

        // Mark directory entry as deleted (0x80)
        const dirSectorData = this.atr.readSector(fileObj.dirSector);
        dirSectorData[fileObj.dirOffset] = 0x80;
        this.atr.writeSector(fileObj.dirSector, dirSectorData);
    }

    /**
     * Renames a file
     * @param {Object} fileObj 
     * @param {string} newFilename 
     */
    renameFile(fileObj, newFilename) {
        if (fileObj.isLocked) {
            throw new Error(T("Plik '{0}' jest zablokowany. Odblokuj go najpierw.", fileObj.fullName));
        }

        const f83 = ATASCII.formatFilename83(newFilename);
        const dirSectorData = this.atr.readSector(fileObj.dirSector);
        dirSectorData.set(f83.atasciiName, fileObj.dirOffset + 5);
        this.atr.writeSector(fileObj.dirSector, dirSectorData);
    }

    /**
     * Toggles lock / unlock status of a file
     * @param {Object} fileObj 
     * @param {boolean} lock 
     */
    setLock(fileObj, lock) {
        const dirSectorData = this.atr.readSector(fileObj.dirSector);
        if (lock) {
            dirSectorData[fileObj.dirOffset] |= 0x20;
        } else {
            dirSectorData[fileObj.dirOffset] &= ~0x20;
        }
        this.atr.writeSector(fileObj.dirSector, dirSectorData);
    }

    /**
     * Formats the disk under Atari DOS, DOS 2.5, or DOS II+/D
     * @param {'Atari DOS'|'DOS2.5'|'DOS II+/D'} dosType 
     */
    static formatDisk(atr, dosType = 'Atari DOS') {
        const isDos2Plus = dosType === 'DOS II+/D' || dosType === 'DOS2PLUS';
        const isDos25 = dosType === 'DOS2.5' || (atr.sectorCount === 1040 && !isDos2Plus);

        // Clear all directory sectors (361..368) to 0x00
        const emptySector = new Uint8Array(atr.isDD ? 256 : 128);
        for (let s = 361; s <= 368; s++) {
            atr.writeSector(s, emptySector);
        }

        // Initialize VTOC Sector 360
        const vtoc = new Uint8Array(atr.isDD ? 256 : 128);
        if (isDos2Plus && atr.sectorCount === 1040) {
            vtoc[0] = 0x03; // DOS II+ MD VTOC type 3
            const totalUsable = 1027; // 1040 total - 13 system sectors (1..3 boot, 359 VTOC2, 360 VTOC1, 361..368 Dir)
            vtoc[1] = totalUsable & 0xFF;
            vtoc[2] = (totalUsable >> 8) & 0xFF;
            vtoc[3] = totalUsable & 0xFF;
            vtoc[4] = (totalUsable >> 8) & 0xFF;

            // Set bits for sectors 4..358 and 369..943 as free (1)
            for (let s = 0; s <= 943; s++) {
                const byteIdx = 10 + Math.floor(s / 8);
                const bitMask = 0x80 >> (s % 8);
                if ((s >= 4 && s <= 358) || (s >= 369 && s <= 943)) {
                    vtoc[byteIdx] |= bitMask;
                }
            }
            atr.writeSector(360, vtoc);

            // Initialize VTOC2 at sector 359 for sectors 944..1040
            const vtoc2 = new Uint8Array(128);
            for (let s = 944; s <= 1040; s++) {
                const relSec = s - 944;
                const byteIdx = Math.floor(relSec / 8);
                const bitMask = 0x80 >> (relSec % 8);
                vtoc2[byteIdx] |= bitMask;
            }
            atr.writeSector(359, vtoc2);

        } else {
            vtoc[0] = 0x02; // DOS 2 VTOC type

            // 720 - 3 boot - 1 VTOC - 8 directory - sector 720, which classic
            // DOS 2 cannot address through its 90-byte bitmap.
            const availSectors = isDos25 ? 707 : (atr.sectorCount - 13);
            vtoc[1] = availSectors & 0xFF;
            vtoc[2] = (availSectors >> 8) & 0xFF;
            vtoc[3] = availSectors & 0xFF;
            vtoc[4] = (availSectors >> 8) & 0xFF;

            // Set all bits for sectors 4..359 and 369..719 as free (1)
            for (let s = 0; s <= 719; s++) {
                const byteIdx = 10 + Math.floor(s / 8);
                const bitMask = 0x80 >> (s % 8);

                // Mark reserved sectors (0..3 boot, 360 vtoc, 361..368 dir) as used (0)
                if ((s >= 4 && s <= 359) || (s >= 369 && s <= 719)) {
                    vtoc[byteIdx] |= bitMask;
                }
            }
            atr.writeSector(360, vtoc);

            // If DOS 2.5 ED (1040 sectors), initialize VTOC2 at sector 1024
            if (isDos25 && atr.sectorCount === 1040) {
                // VTOC2: bytes 0..83 mirror the sector 360 bitmap for sectors
                // 48..719, bytes 84..121 map sectors 720..1023, bytes 122-123
                // hold the number of free sectors above sector 719.
                const vtoc2 = new Uint8Array(128);
                for (let i = 0; i <= 83; i++) {
                    vtoc2[i] = vtoc[16 + i];   // sector 360 byte for sector 48 is 10 + 48/8 = 16
                }

                // Set bits for sectors 721..1023 as free (1). Sector 720 stays
                // allocated: DOS 2.x cannot address it and DOS 2.5 premarks it,
                const edFree = 303;
                for (let relSec = 1; relSec <= edFree; relSec++) {
                    const byteIdx = 84 + Math.floor(relSec / 8);
                    const bitMask = 0x80 >> (relSec % 8);
                    vtoc2[byteIdx] |= bitMask;
                }

                vtoc2[122] = edFree & 0xFF; // 303 free sectors in ED area (721..1023)
                vtoc2[123] = (edFree >> 8) & 0xFF;
                atr.writeSector(1024, vtoc2);
            }
        }

        return new AtariDOS2(atr);
    }
}
