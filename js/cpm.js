/*
 * ATRaction - Atari 8-bit ATR/XFD disk image manager
 * Copyright (C) 2026 dely / blowjobb / ng
 *
 * Contains work derived from the Altirra emulator by Avery Lee, licensed
 * GPL-2.0-or-later:
 *   ATIO/source/diskfscpm.cpp  Copyright (C) 2009-2021 Avery Lee
 *
 * Derived here: the CP/M 2.2 (Indus GT) filesystem layout and its inverted byte encoding.
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
 * Indus GT CP/M 2.2 Filesystem Module for Atraction
 * Supports reading, extracting, importing, deleting, renaming, and formatting
 * CP/M 2.2 disks for Indus GT Atari floppy drives.
 *
 * Geometry:
 *   sectors 1..36    reserved system tracks (2 tracks of 18 sectors)
 *   from sector 37   (sectorCount - 36) / 4 allocation blocks of 1 KB
 *                    block 0-1 = 64-entry directory (sectors 37..44)
 *                    data blocks start at 2; block b starts at sector 37 + b*4
 *   256-byte sectors only, 64..1068 sectors
 * On the standard 180 KB / 720 sector disk that gives 171 blocks, the last of
 * which ends exactly on sector 720.
 *
 * Every byte is stored inverted on disk.
 */

if (typeof T === 'undefined') {
    globalThis.T = function (text) {
        var args = Array.prototype.slice.call(arguments, 1);
        var s = text;
        for (var i = 0; i < args.length; i++) s = s.split('{' + i + '}').join(args[i]);
        return s;
    };
}

class IndusCPM {
    static DIR_FIRST_SECTOR = 37;
    static DIR_LAST_SECTOR = 44;
    static SECTORS_PER_BLOCK = 4;
    static FIRST_DATA_BLOCK = 2;
    static ERASED = 0xE5;
    static MIN_SECTORS = 64;
    static MAX_SECTORS = 44 + 256 * 4;

    /** Total allocation blocks, directory included: (sectors - 36) / 4 */
    static totalBlocks(sectorCount) {
        return (sectorCount - 36) >> 2;
    }
    /**
     * @param {ATRImage} atr
     */
    constructor(atr) {
        this.atr = atr;
        this.dosType = 'CP/M 2.2 (Indus GT)';
        this.isReadOnly = false;
        this.freeSectors = 0;
        this.usedBlocks = new Set();
        this.validate();
    }

    /**
     * Validates disk structure and calculates used/free blocks and sectors.
     */
    validate() {
        if (!this.atr || this.atr.sectorCount < IndusCPM.DIR_LAST_SECTOR) {
            throw new Error(T("Obraz dysku jest zbyt mały dla CP/M 2.2 (wymagane min. {0} sektorów).", IndusCPM.DIR_LAST_SECTOR));
        }
        this.usedBlocks.clear();
        this.isReadOnly = false;
        this.validationError = null;
        this.validationWarning = null;

        // CP/M has no allocation bitmap - free space is derived from the
        // directory, so the only structural fault possible is a block claimed
        // by two extents, or a block that lies outside the disk.
        this.totalBlocks = IndusCPM.totalBlocks(this.atr.sectorCount);
        this.dataBlockCount = Math.max(0, this.totalBlocks - IndusCPM.FIRST_DATA_BLOCK);

        const claimed = new Set();
        let doubleAllocated = 0;
        let outOfRange = 0;

        for (let sec = IndusCPM.DIR_FIRST_SECTOR; sec <= IndusCPM.DIR_LAST_SECTOR; sec++) {
            let secData;
            try {
                secData = this.atr.readSector(sec);
            } catch (err) {
                continue;   // partial image
            }
            for (let off = 0; off < 256; off += 32) {

                if ((secData[off] ^ 0xFF) === IndusCPM.ERASED) continue;

                for (let b = 16; b < 32; b++) {
                    const blk = secData[off + b] ^ 0xFF;
                    if (blk === 0) continue;
                    if (blk < IndusCPM.FIRST_DATA_BLOCK || blk >= this.totalBlocks) {
                        outOfRange++;
                    } else if (claimed.has(blk)) {
                        doubleAllocated++;
                    } else {
                        claimed.add(blk);
                        this.usedBlocks.add(blk);
                    }
                }
            }
        }

        const freeBlocks = Math.max(0, this.dataBlockCount - this.usedBlocks.size);
        this.freeSectors = freeBlocks * IndusCPM.SECTORS_PER_BLOCK;

        if (doubleAllocated > 0) {
            this.isReadOnly = true;
            this.validationError = T("Uszkodzony katalog CP/M: {0} bloków jest przypisanych do więcej niż jednego pliku. Obraz zamontowano w trybie tylko do odczytu, aby zapobiec utracie danych.", doubleAllocated);
        } else if (outOfRange > 0) {
            this.isReadOnly = true;
            this.validationError = T("Uszkodzony katalog CP/M: {0} wpisów wskazuje bloki poza obszarem danych dysku. Obraz zamontowano w trybie tylko do odczytu.", outOfRange);
        }
    }

    /**
     * First physical sector of an allocation block
     * @param {number} block
     * @returns {number}
     */
    blockToSector(block) {
        return IndusCPM.DIR_FIRST_SECTOR + block * IndusCPM.SECTORS_PER_BLOCK;
    }

    /**
     * Checks if physical sector is free
     * @param {number} sector
     * @returns {boolean}
     */
    isSectorFree(sector) {
        if (sector <= IndusCPM.DIR_LAST_SECTOR || sector > this.atr.sectorCount) return false;
        const block = Math.floor((sector - IndusCPM.DIR_FIRST_SECTOR) / IndusCPM.SECTORS_PER_BLOCK);
        return !this.usedBlocks.has(block);
    }

    /**
     * Reads directory and groups file extents into unified file objects.
     * @returns {Array<Object>}
     */
    getDirectory() {
        const extents = [];
        for (let sec = IndusCPM.DIR_FIRST_SECTOR; sec <= IndusCPM.DIR_LAST_SECTOR; sec++) {
            const secData = this.atr.readSector(sec);
            for (let off = 0; off < 256; off += 32) {
                const user = secData[off] ^ 0xFF;
                if (user <= 15) {
                    let name = '';
                    let ext = '';
                    for (let i = 1; i <= 8; i++) name += String.fromCharCode((secData[off + i] ^ 0xFF) & 0x7F);
                    for (let i = 9; i <= 11; i++) ext += String.fromCharCode((secData[off + i] ^ 0xFF) & 0x7F);
                    
                    const isLocked = ((secData[off + 9] ^ 0xFF) & 0x80) !== 0;
                    const ex = secData[off + 12] ^ 0xFF;
                    const s2 = secData[off + 14] ^ 0xFF;
                    const logicalExt = (ex & 31) | ((s2 & 15) << 5);
                    const rc = secData[off + 15] ^ 0xFF;
                    const blocks = [];
                    for (let b = 16; b < 32; b++) {
                        const blk = secData[off + b] ^ 0xFF;
                        if (blk >= IndusCPM.FIRST_DATA_BLOCK && blk < this.totalBlocks) blocks.push(blk);
                    }
                    extents.push({
                        user,
                        name: name.trim(),
                        ext: ext.trim(),
                        isLocked,
                        logicalExt,
                        rc,
                        blocks,
                        dirSector: sec,
                        dirOffset: off
                    });
                }
            }
        }

        // Group extents by user + filename
        const fileMap = new Map();
        for (const ext of extents) {
            const key = `${ext.user}:${ext.name}.${ext.ext}`;
            if (!fileMap.has(key)) {
                fileMap.set(key, {
                    user: ext.user,
                    name: ext.name,
                    ext: ext.ext,
                    isLocked: ext.isLocked,
                    extentsList: []
                });
            }
            fileMap.get(key).extentsList.push(ext);
        }

        const files = [];
        let fileIdx = 1;
        for (const [key, file] of fileMap) {
            file.extentsList.sort((a, b) => a.logicalExt - b.logicalExt);
            const allSectors = [];
            const dirEntries = [];
            for (const ext of file.extentsList) {
                dirEntries.push({ sector: ext.dirSector, offset: ext.dirOffset });
                for (const blk of ext.blocks) {
                    const base = this.blockToSector(blk);
                    for (let i = 0; i < IndusCPM.SECTORS_PER_BLOCK; i++) allSectors.push(base + i);
                }
            }
            // CP/M derives the size from the highest extent, not from the sum of
            // the record counts, which stays correct if an extent is missing
            // (ATDiskFSCPM::Init: extent * 16384 + min(recordCount, 128) * 128)
            const last = file.extentsList[file.extentsList.length - 1];
            const sizeBytes = last.logicalExt * 16384 + Math.min(last.rc, 128) * 128;
            const fullName = file.ext ? `${file.name}.${file.ext}` : file.name;
            const displayFullName = file.user > 0 ? `${fullName} [U${file.user}]` : fullName;

            // Prepare Uint8Array for name and ext in ATASCII representation for UI compatibility
            const nameBytes = new Uint8Array(file.name.length);
            for (let i = 0; i < file.name.length; i++) nameBytes[i] = file.name.charCodeAt(i);
            const extBytes = new Uint8Array(file.ext.length);
            for (let i = 0; i < file.ext.length; i++) extBytes[i] = file.ext.charCodeAt(i);

            files.push({
                index: fileIdx++,
                user: file.user,
                dirSector: dirEntries[0].sector,
                dirOffset: dirEntries[0].offset,
                dirEntries: dirEntries,
                flag: 0,
                isValid: true,
                isDeleted: false,
                isLocked: file.isLocked,
                isDir: false,
                name: file.name,
                ext: file.ext,
                nameBytes: nameBytes,
                extBytes: extBytes,
                fullName: displayFullName,
                startSector: allSectors[0] || 0,
                sectorCount: allSectors.length,
                sizeBytes: sizeBytes,
                sectors: allSectors
            });
        }
        return files;
    }

    /**
     * Reads file data from disk by XORing physical sector data with 0xFF.
     * @param {Object} fileObj
     * @returns {Uint8Array}
     */
    readFile(fileObj) {
        if (!fileObj || !fileObj.sectors) throw new Error(T("Nieprawidłowy obiekt pliku CP/M."));
        const buffer = new Uint8Array(fileObj.sectors.length * 256);
        for (let i = 0; i < fileObj.sectors.length; i++) {
            const secData = this.atr.readSector(fileObj.sectors[i]);
            for (let j = 0; j < 256; j++) {
                buffer[i * 256 + j] = secData[j] ^ 0xFF;
            }
        }
        return buffer.subarray(0, fileObj.sizeBytes);
    }

    /**
     * Deletes a file by marking all its directory extent entries with 0xE5 (XORed with 0xFF = 0x1A).
     * @param {Object} fileObj
     */
    deleteFile(fileObj) {
        if (!fileObj || !fileObj.dirEntries) throw new Error(T("Nieprawidłowy obiekt pliku do usunięcia."));
        if (fileObj.isLocked) throw new Error(T("Plik {0} jest zabezpieczony przed zapisem.", fileObj.fullName));

        for (const entry of fileObj.dirEntries) {
            const secData = this.atr.readSector(entry.sector);
            secData[entry.offset] = IndusCPM.ERASED ^ 0xFF;
            this.atr.writeSector(entry.sector, secData);
        }
        this.validate();
    }

    /**
     * Renames a file across all its extents.
     * @param {Object} fileObj
     * @param {string} newNameStr
     */
    renameFile(fileObj, newNameStr) {
        if (!fileObj || !fileObj.dirEntries) throw new Error(T("Nieprawidłowy obiekt pliku do zmiany nazwy."));
        if (fileObj.isLocked) throw new Error(T("Plik {0} jest zabezpieczony przed zapisem.", fileObj.fullName));

        const clean = newNameStr.replace(/\s+/g, '').toUpperCase();
        const parts = clean.split('.');
        let name = parts[0] || 'UNNAMED';
        let ext = parts[1] || '';
        if (name.length > 8) name = name.substring(0, 8);
        if (ext.length > 3) ext = ext.substring(0, 3);
        name = name.padEnd(8, ' ');
        ext = ext.padEnd(3, ' ');

        for (const entry of fileObj.dirEntries) {
            const secData = this.atr.readSector(entry.sector);
            for (let i = 0; i < 8; i++) {
                const attrBit = secData[entry.offset + 1 + i] & 0x80;
                secData[entry.offset + 1 + i] = ((name.charCodeAt(i) ^ 0xFF) & 0x7F) | attrBit;
            }
            for (let i = 0; i < 3; i++) {
                const attrBit = secData[entry.offset + 9 + i] & 0x80;
                secData[entry.offset + 9 + i] = ((ext.charCodeAt(i) ^ 0xFF) & 0x7F) | attrBit;
            }
            this.atr.writeSector(entry.sector, secData);
        }
        this.validate();
    }

    /**
     * Toggles Read-Only (Lock) status on byte 9 of each extent.
     * @param {Object} fileObj
     * @param {boolean} lock
     */
    setLock(fileObj, lock) {
        if (!fileObj || !fileObj.dirEntries) throw new Error(T("Nieprawidłowy obiekt pliku."));
        for (const entry of fileObj.dirEntries) {
            const secData = this.atr.readSector(entry.sector);
            const normByte = secData[entry.offset + 9] ^ 0xFF;
            const newNorm = lock ? (normByte | 0x80) : (normByte & 0x7F);
            secData[entry.offset + 9] = newNorm ^ 0xFF;
            this.atr.writeSector(entry.sector, secData);
        }
        this.validate();
    }

    /**
     * Sets file attributes (supports protected / lock attribute).
     * @param {Object} fileObj
     * @param {Object} attrs
     */
    setAttributes(fileObj, attrs = {}) {
        if (attrs.protected !== undefined) {
            this.setLock(fileObj, attrs.protected);
        }
    }

    /**
     * Subdirectories are not supported in CP/M 2.2.
     */
    createDirectory(dirName, parentSector) {
        throw new Error(T("System plików CP/M 2.2 nie obsługuje podkatalogów."));
    }

    /**
     * Imports a new file into the CP/M filesystem.
     * @param {string} filename
     * @param {Uint8Array} fileBytes
     * @param {number} [targetSector]
     */
    importFile(filename, fileBytes, targetSector = null) {
        if (this.isReadOnly) {
            throw new Error(T("Obraz jest zamontowany w trybie tylko do odczytu."));
        }

        const clean = filename.replace(/\s+/g, '').toUpperCase();
        const parts = clean.split('.');
        let name = parts[0] || 'UNNAMED';
        let ext = parts[1] || '';
        if (name.length > 8) name = name.substring(0, 8);
        if (ext.length > 3) ext = ext.substring(0, 3);
        name = name.padEnd(8, ' ');
        ext = ext.padEnd(3, ' ');

        // Remove existing file with the same name if any
        const existing = this.getDirectory().find(f => f.name === name.trim() && f.ext === ext.trim());
        if (existing) {
            if (existing.isLocked) throw new Error(T("Plik {0} istnieje i jest zabezpieczony przed zapisem.", existing.fullName));
            this.deleteFile(existing);
        }

        const dataLen = fileBytes ? fileBytes.length : 0;
        const totalRecords = Math.max(1, Math.ceil(dataLen / 128));
        const totalBlocksNeeded = Math.ceil((totalRecords * 128) / 1024);

        if (this.freeSectors / 4 < totalBlocksNeeded) {
            throw new Error(T("Brak wolnego miejsca na dysku CP/M 2.2. Wymagane bloki: {0}, wolne: {1}.", totalBlocksNeeded, this.freeSectors / 4));
        }

        // Collect available free allocation blocks (2..170)
        const freeBlocksList = [];
        for (let b = IndusCPM.FIRST_DATA_BLOCK; b < this.totalBlocks; b++) {
            if (!this.usedBlocks.has(b)) freeBlocksList.push(b);
            if (freeBlocksList.length === totalBlocksNeeded) break;
        }

        // Prepare padded data buffer (padded with 0x1A CP/M EOF)
        const paddedLen = totalBlocksNeeded * 1024;
        const paddedData = new Uint8Array(paddedLen);
        paddedData.fill(0x1A);
        if (fileBytes && dataLen > 0) {
            paddedData.set(fileBytes.subarray(0, Math.min(dataLen, paddedLen)), 0);
        }

        // Write physical sectors (XORed with 0xFF)
        let blockIdx = 0;
        for (const blk of freeBlocksList) {
            for (let s = 0; s < 4; s++) {
                const physSec = this.blockToSector(blk) + s;
                const chunk = paddedData.subarray((blockIdx * 4 + s) * 256, (blockIdx * 4 + s + 1) * 256);
                const xorChunk = new Uint8Array(256);
                for (let i = 0; i < 256; i++) xorChunk[i] = chunk[i] ^ 0xFF;
                this.atr.writeSector(physSec, xorChunk);
            }
            blockIdx++;
        }

        // Create directory extent entries (up to 16 blocks per extent)
        const extentsCount = Math.ceil(totalBlocksNeeded / 16) || 1;
        let blocksAssigned = 0;
        for (let ex = 0; ex < extentsCount; ex++) {
            const extBlocksCount = Math.min(16, totalBlocksNeeded - blocksAssigned);
            const recordsInExt = (ex === extentsCount - 1) ? (totalRecords - ex * 128) : 128;

            // Find an empty directory entry (0xE5 or > 15) in sectors 37..44
            let foundSec = -1, foundOff = -1;
            for (let sec = IndusCPM.DIR_FIRST_SECTOR; sec <= IndusCPM.DIR_LAST_SECTOR && foundSec === -1; sec++) {
                const secData = this.atr.readSector(sec);
                for (let off = 0; off < 256; off += 32) {
                    const u = secData[off] ^ 0xFF;
                    if (u === IndusCPM.ERASED || u > 15) {
                        foundSec = sec;
                        foundOff = off;
                        break;
                    }
                }
            }

            if (foundSec === -1) {
                throw new Error(T("Katalog dysku CP/M 2.2 jest pełny (brak wolnych wpisów)."));
            }

            const dirSecData = this.atr.readSector(foundSec);
            const entry = new Uint8Array(32);
            entry[0] = 0x00; // User 0
            for (let i = 0; i < 8; i++) entry[1 + i] = name.charCodeAt(i);
            for (let i = 0; i < 3; i++) entry[9 + i] = ext.charCodeAt(i);
            entry[12] = ex & 0x1F;   // EX holds the low 5 bits, S2 the rest
            entry[13] = 0x00; // S1
            entry[14] = (ex >> 5) & 0xFF; // S2
            entry[15] = recordsInExt & 0xFF;

            for (let i = 0; i < 16; i++) {
                if (i < extBlocksCount) {
                    entry[16 + i] = freeBlocksList[blocksAssigned + i];
                } else {
                    entry[16 + i] = 0x00;
                }
            }
            blocksAssigned += extBlocksCount;

            // XOR entry with 0xFF and write to sector
            for (let i = 0; i < 32; i++) {
                dirSecData[foundOff + i] = entry[i] ^ 0xFF;
            }
            this.atr.writeSector(foundSec, dirSecData);
        }

        this.validate();
        return { name: name.trim(), ext: ext.trim(), startSector: this.blockToSector(freeBlocksList[0]) };
    }

    /**
     * Static detection of Indus GT CP/M 2.2 filesystem on an ATR image.
     * @param {ATRImage} atr
     * @returns {boolean}
     */
    static detect(atr) {
        // The Indus GT CP/M layout is fixed: 256-byte sectors, 36 reserved
        // sectors, then 171 blocks of 1 KB (blocks 0-1 hold the 64-entry
        // directory in sectors 37..44).
        if (!atr || atr.sectorCount < IndusCPM.MIN_SECTORS || atr.sectorCount > IndusCPM.MAX_SECTORS) return false;
        if (atr.getSectorSize(IndusCPM.DIR_FIRST_SECTOR) !== 256) return false;

        try {
            const boot = atr.readSector(1);
            if (boot[0] === 0xF3 && boot[1] === 0x22 && boot[2] === 0x55 && boot[3] === 0x7F) return true;
        } catch (err) {
            return false;
        }

        const totalBlocks = IndusCPM.totalBlocks(atr.sectorCount);

        try {
            let validEntries = 0;
            let emptyEntries = 0;
            let totalEntries = 0;

            for (let sec = IndusCPM.DIR_FIRST_SECTOR; sec <= IndusCPM.DIR_LAST_SECTOR; sec++) {
                const secData = atr.readSector(sec);
                for (let off = 0; off < 256; off += 32) {
                    totalEntries++;
                    const u = secData[off] ^ 0xFF;

                    if (u === 0xE5) { emptyEntries++; continue; }   // erased entry
                    if (u > 15) return false;                        // not a user number

                    // File name: printable ASCII, high bit carries the attributes
                    let printable = 0;
                    for (let i = 1; i <= 11; i++) {
                        const c = (secData[off + i] ^ 0xFF) & 0x7F;
                        if (c < 0x20 || c > 0x7E) return false;
                        if (c !== 0x20) printable++;
                    }
                    if (printable === 0) return false;

                    // Record count of one extent never exceeds 128
                    if ((secData[off + 15] ^ 0xFF) > 128) return false;

                    // Allocation map: 0 = unused, otherwise a data block
                    for (let b = 16; b < 32; b++) {
                        const blk = secData[off + b] ^ 0xFF;
                        if (blk !== 0 && (blk < IndusCPM.FIRST_DATA_BLOCK || blk >= totalBlocks)) return false;
                    }
                    validEntries++;
                }
            }

            // A freshly formatted disk has no files at all - accept it when the
            // whole 2 KB directory area is erased, which no other Atari format
            // produces at these offsets.
            return validEntries > 0 || emptyEntries === totalEntries;
        } catch (err) {
            return false;
        }
    }

    /**
     * Formats a disk as CP/M 2.2 for Indus GT.
     * @param {ATRImage} atr
     */
    static formatDisk(atr) {
        if (!atr || atr.sectorCount < 37) {
            throw new Error(T("Obraz jest zbyt mały do sformatowania w CP/M 2.2."));
        }
        // Directory sectors 37..44 filled with 0xE5 ^ 0xFF = 0x1A
        const emptyDirSec = new Uint8Array(256);
        emptyDirSec.fill(0x1A);
        for (let sec = 37; sec <= 44; sec++) {
            atr.writeSector(sec, emptyDirSec);
        }
        // Data sectors 45..sectorCount filled with 0xFF (empty in XORed storage)
        for (let sec = 45; sec <= atr.sectorCount; sec++) {
            const emptyDataSec = new Uint8Array(atr.getSectorSize(sec));
            emptyDataSec.fill(0xFF);
            atr.writeSector(sec, emptyDataSec);
        }
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = IndusCPM;
}
