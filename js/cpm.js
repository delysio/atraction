/*
 * ATRaction - Atari 8-bit ATR/XFD disk image manager
 * Copyright (C) 2026 dely / blowjobb / ng
 *
 * Contains work derived from the Altirra emulator by Avery Lee, licensed
 * GPL-2.0-or-later:
 *   ATIO/source/diskfscpm.cpp  Copyright (C) 2009-2021 Avery Lee
 *
 * Derived here: the CP/M 2.2 (Indus GT) filesystem layout and its inverted byte
 * encoding. The Atari 1090 profile is not from Altirra, which does not support
 * that format - its geometry was read out of the DPB table in the card's own
 * CP/M BIOS and checked against reference images.
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
 * CP/M 2.2 Filesystem Module for Atraction
 * Supports reading, extracting, importing, deleting, renaming, and formatting
 * CP/M 2.2 disks written by two different Atari hosts.
 *
 * Both share one filesystem - a 64-entry flat directory in the first two
 * allocation blocks, 1 KB blocks, 8-bit block numbers - and differ only in
 * where that directory sits, how many sectors make up a block, and whether the
 * bytes are inverted on the way to the disk. Those differences live in the
 * profile objects below; everything under them is common code.
 *
 * Indus GT (256-byte sectors, every byte inverted):
 *   sectors 1..36    reserved system tracks (2 tracks of 18 sectors)
 *   sectors 37..44   64-entry directory (blocks 0-1)
 *   block b          starts at sector 37 + b*4
 *   On the standard 180 KB / 720 sector disk that gives 171 blocks, the last of
 *   which ends exactly on sector 720.
 *
 * Atari 1090 CP/M card (128-byte sectors, bytes stored as-is):
 *   sectors 1..78    reserved system tracks (OFF = 3 tracks of SPT = 26 records)
 *   sectors 79..94   64-entry directory (blocks 0-1)
 *   block b          starts at sector 79 + b*8
 *   A CP/M record is one Atari sector and the mapping is linear, the BIOS
 *   publishes no sector translation table. The DPB reserves 119 blocks
 *   (DSM = 118), which is what the 130 KB / 1040 sector disk gets; a shorter
 *   medium is capped by its own size instead.
 */

if (typeof T === 'undefined') {
    globalThis.T = function (text) {
        var args = Array.prototype.slice.call(arguments, 1);
        var s = text;
        for (var i = 0; i < args.length; i++) s = s.split('{' + i + '}').join(args[i]);
        return s;
    };
}

/**
 * Fills in the parts of a profile that follow from the rest of it, so that no
 * layout constant is ever written down twice.
 * @param {Object} p
 * @returns {Object}
 */
function makeCPMProfile(p) {
    const dirBytes = p.dirSectorCount * p.sectorSize;
    return Object.assign({}, p, {
        // Last sector of the directory area
        dirLastSector: p.dirFirstSector + p.dirSectorCount - 1,
        // Sectors ahead of block 0, i.e. the reserved system tracks
        reservedSectors: p.dirFirstSector - 1,
        // The directory fills whole blocks, so the first data block is simply
        // how many blocks it takes up (2 on both profiles, AL0 = $C0)
        firstDataBlock: dirBytes / (p.sectorsPerBlock * p.sectorSize),
        blockSize: p.sectorsPerBlock * p.sectorSize,
        entriesPerSector: p.sectorSize / 32,
        dirEntryCount: dirBytes / 32
    });
}

class CPM {
    static ERASED = 0xE5;

    /** Layouts this module can read. Sector sizes differ, so they never collide. */
    static PROFILES = {
        INDUS: makeCPMProfile({
            id: 'INDUS',
            dosType: 'CP/M 2.2 (Indus GT)',
            sectorSize: 256,
            dirFirstSector: 37,
            dirSectorCount: 8,
            sectorsPerBlock: 4,
            // Every byte is stored inverted on an Indus GT disk
            invertMask: 0xFF,
            // No BIOS DPB to consult, so the medium is the only ceiling
            maxBlocks: null,
            minSectors: 64,
            maxSectors: 44 + 256 * 4,
            // Standard media this variant is created on, native one first
            densities: ['DD'],
            // Indus CP/M images are conventionally passed around headerless
            container: 'xfd',
            bootSignature: [0xF3, 0x22, 0x55, 0x7F]
        }),
        ATARI1090: makeCPMProfile({
            id: 'ATARI1090',
            dosType: 'CP/M 2.2 (Atari 1090)',
            sectorSize: 128,
            dirFirstSector: 79,
            dirSectorCount: 16,
            sectorsPerBlock: 8,
            invertMask: 0x00,
            // DPB in the card's BIOS: DSM = 118, so blocks 0..118 exist
            maxBlocks: 119,
            // Directory plus at least one data block
            minSectors: 102,
            // Only the 128-byte formats are supported; the BIOS also carries
            // DPBs for 256-byte media (SPT = 36), but no reference image of one
            // has turned up to check the record-to-sector mapping against.
            maxSectors: 1040,
            // MD/ED first: 1040 sectors is what the BIOS DPB is dimensioned for
            densities: ['ED', 'SD'],
            container: 'atr',
            bootSignature: null
        })
    };

    /**
     * Total allocation blocks, directory included.
     * @param {number} sectorCount
     * @param {Object} profile
     * @returns {number}
     */
    static totalBlocks(sectorCount, profile) {
        const physical = Math.floor((sectorCount - profile.reservedSectors) / profile.sectorsPerBlock);
        // A BIOS that publishes a DSM wins over the raw size of the medium: a
        // block the real system will not hand out must not be handed out here
        // either, or the two would disagree about what is free.
        return profile.maxBlocks === null ? physical : Math.min(profile.maxBlocks, physical);
    }

    /**
     * @param {ATRImage} atr
     * @param {Object} [profile] Layout to use; auto-detected when omitted
     */
    constructor(atr, profile = null) {
        this.atr = atr;
        this.profile = profile || CPM.detectProfile(atr) || CPM.PROFILES.INDUS;
        this.dosType = this.profile.dosType;
        this.isReadOnly = false;
        this.freeSectors = 0;
        this.usedBlocks = new Set();
        this.validate();
    }

    /** Byte as the computer sees it, whatever the disk stores. @returns {number} */
    decode(byte) {
        return byte ^ this.profile.invertMask;
    }

    /** Byte as the disk stores it. @returns {number} */
    encode(byte) {
        return byte ^ this.profile.invertMask;
    }

    /**
     * Validates disk structure and calculates used/free blocks and sectors.
     */
    validate() {
        const prof = this.profile;
        if (!this.atr || this.atr.sectorCount < prof.dirLastSector) {
            throw new Error(T("Obraz dysku jest zbyt mały dla CP/M 2.2 (wymagane min. {0} sektorów).", prof.dirLastSector));
        }
        this.usedBlocks.clear();
        this.isReadOnly = false;
        this.validationError = null;
        this.validationWarning = null;

        // CP/M has no allocation bitmap - free space is derived from the
        // directory, so the only structural fault possible is a block claimed
        // by two extents, or a block that lies outside the disk.
        this.totalBlocks = CPM.totalBlocks(this.atr.sectorCount, prof);
        this.dataBlockCount = Math.max(0, this.totalBlocks - prof.firstDataBlock);

        const claimed = new Set();
        let doubleAllocated = 0;
        let outOfRange = 0;

        for (let sec = prof.dirFirstSector; sec <= prof.dirLastSector; sec++) {
            let secData;
            try {
                secData = this.atr.readSector(sec);
            } catch (err) {
                continue;   // partial image
            }
            for (let off = 0; off < prof.sectorSize; off += 32) {

                if (this.decode(secData[off]) === CPM.ERASED) continue;

                for (let b = 16; b < 32; b++) {
                    const blk = this.decode(secData[off + b]);
                    if (blk === 0) continue;
                    if (blk < prof.firstDataBlock || blk >= this.totalBlocks) {
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
        this.freeSectors = freeBlocks * prof.sectorsPerBlock;

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
        return this.profile.dirFirstSector + block * this.profile.sectorsPerBlock;
    }

    /**
     * Checks if physical sector is free
     * @param {number} sector
     * @returns {boolean}
     */
    isSectorFree(sector) {
        const prof = this.profile;
        if (sector <= prof.dirLastSector || sector > this.atr.sectorCount) return false;
        const block = Math.floor((sector - prof.dirFirstSector) / prof.sectorsPerBlock);
        return !this.usedBlocks.has(block);
    }

    /**
     * Reads directory and groups file extents into unified file objects.
     * @returns {Array<Object>}
     */
    getDirectory() {
        const prof = this.profile;
        const extents = [];
        for (let sec = prof.dirFirstSector; sec <= prof.dirLastSector; sec++) {
            const secData = this.atr.readSector(sec);
            for (let off = 0; off < prof.sectorSize; off += 32) {
                const user = this.decode(secData[off]);
                if (user <= 15) {
                    let name = '';
                    let ext = '';
                    for (let i = 1; i <= 8; i++) name += String.fromCharCode(this.decode(secData[off + i]) & 0x7F);
                    for (let i = 9; i <= 11; i++) ext += String.fromCharCode(this.decode(secData[off + i]) & 0x7F);

                    const isLocked = (this.decode(secData[off + 9]) & 0x80) !== 0;
                    const ex = this.decode(secData[off + 12]);
                    const s2 = this.decode(secData[off + 14]);
                    const logicalExt = (ex & 31) | ((s2 & 15) << 5);
                    const rc = this.decode(secData[off + 15]);
                    const blocks = [];
                    for (let b = 16; b < 32; b++) {
                        const blk = this.decode(secData[off + b]);
                        if (blk >= prof.firstDataBlock && blk < this.totalBlocks) blocks.push(blk);
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
                    for (let i = 0; i < this.profile.sectorsPerBlock; i++) allSectors.push(base + i);
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
     * Reads file data from disk, undoing the profile's byte inversion.
     * @param {Object} fileObj
     * @returns {Uint8Array}
     */
    readFile(fileObj) {
        if (!fileObj || !fileObj.sectors) throw new Error(T("Nieprawidłowy obiekt pliku CP/M."));
        const secSize = this.profile.sectorSize;
        const buffer = new Uint8Array(fileObj.sectors.length * secSize);
        for (let i = 0; i < fileObj.sectors.length; i++) {
            const secData = this.atr.readSector(fileObj.sectors[i]);
            for (let j = 0; j < secSize; j++) {
                buffer[i * secSize + j] = this.decode(secData[j]);
            }
        }
        return buffer.subarray(0, fileObj.sizeBytes);
    }

    /**
     * Deletes a file by marking all its directory extent entries with 0xE5.
     * @param {Object} fileObj
     */
    deleteFile(fileObj) {
        if (!fileObj || !fileObj.dirEntries) throw new Error(T("Nieprawidłowy obiekt pliku do usunięcia."));
        if (fileObj.isLocked) throw new Error(T("Plik {0} jest zabezpieczony przed zapisem.", fileObj.fullName));

        for (const entry of fileObj.dirEntries) {
            const secData = this.atr.readSector(entry.sector);
            secData[entry.offset] = this.encode(CPM.ERASED);
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
                const attrBit = this.decode(secData[entry.offset + 1 + i]) & 0x80;
                secData[entry.offset + 1 + i] = this.encode((name.charCodeAt(i) & 0x7F) | attrBit);
            }
            for (let i = 0; i < 3; i++) {
                const attrBit = this.decode(secData[entry.offset + 9 + i]) & 0x80;
                secData[entry.offset + 9 + i] = this.encode((ext.charCodeAt(i) & 0x7F) | attrBit);
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
            const normByte = this.decode(secData[entry.offset + 9]);
            const newNorm = lock ? (normByte | 0x80) : (normByte & 0x7F);
            secData[entry.offset + 9] = this.encode(newNorm);
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
        const prof = this.profile;

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
        const totalBlocksNeeded = Math.ceil((totalRecords * 128) / prof.blockSize);

        if (this.freeSectors / prof.sectorsPerBlock < totalBlocksNeeded) {
            throw new Error(T("Brak wolnego miejsca na dysku CP/M 2.2. Wymagane bloki: {0}, wolne: {1}.", totalBlocksNeeded, this.freeSectors / prof.sectorsPerBlock));
        }

        // Collect available free allocation blocks
        const freeBlocksList = [];
        for (let b = prof.firstDataBlock; b < this.totalBlocks; b++) {
            if (!this.usedBlocks.has(b)) freeBlocksList.push(b);
            if (freeBlocksList.length === totalBlocksNeeded) break;
        }

        // Prepare padded data buffer (padded with 0x1A CP/M EOF)
        const paddedLen = totalBlocksNeeded * prof.blockSize;
        const paddedData = new Uint8Array(paddedLen);
        paddedData.fill(0x1A);
        if (fileBytes && dataLen > 0) {
            paddedData.set(fileBytes.subarray(0, Math.min(dataLen, paddedLen)), 0);
        }

        // Write physical sectors in the profile's on-disk encoding
        let blockIdx = 0;
        for (const blk of freeBlocksList) {
            for (let s = 0; s < prof.sectorsPerBlock; s++) {
                const physSec = this.blockToSector(blk) + s;
                const start = (blockIdx * prof.sectorsPerBlock + s) * prof.sectorSize;
                const chunk = paddedData.subarray(start, start + prof.sectorSize);
                const outChunk = new Uint8Array(prof.sectorSize);
                for (let i = 0; i < prof.sectorSize; i++) outChunk[i] = this.encode(chunk[i]);
                this.atr.writeSector(physSec, outChunk);
            }
            blockIdx++;
        }

        // Create directory extent entries (up to 16 blocks per extent)
        const extentsCount = Math.ceil(totalBlocksNeeded / 16) || 1;
        let blocksAssigned = 0;
        for (let ex = 0; ex < extentsCount; ex++) {
            const extBlocksCount = Math.min(16, totalBlocksNeeded - blocksAssigned);
            const recordsInExt = (ex === extentsCount - 1) ? (totalRecords - ex * 128) : 128;

            // Find an empty directory entry (0xE5 or > 15)
            let foundSec = -1, foundOff = -1;
            for (let sec = prof.dirFirstSector; sec <= prof.dirLastSector && foundSec === -1; sec++) {
                const secData = this.atr.readSector(sec);
                for (let off = 0; off < prof.sectorSize; off += 32) {
                    const u = this.decode(secData[off]);
                    if (u === CPM.ERASED || u > 15) {
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

            for (let i = 0; i < 32; i++) {
                dirSecData[foundOff + i] = this.encode(entry[i]);
            }
            this.atr.writeSector(foundSec, dirSecData);
        }

        this.validate();
        return { name: name.trim(), ext: ext.trim(), startSector: this.blockToSector(freeBlocksList[0]) };
    }

    /**
     * Picks the CP/M layout an image is written in.
     * @param {ATRImage} atr
     * @returns {Object|null} Matching profile, or null when the image is not CP/M
     */
    static detectProfile(atr) {
        for (const key of Object.keys(CPM.PROFILES)) {
            const profile = CPM.PROFILES[key];
            if (CPM.matchesProfile(atr, profile)) return profile;
        }
        return null;
    }

    /**
     * Static detection of a CP/M 2.2 filesystem on an ATR image.
     * @param {ATRImage} atr
     * @returns {boolean}
     */
    static detect(atr) {
        return CPM.detectProfile(atr) !== null;
    }

    /**
     * Tests one specific CP/M layout against an image. The directory area is
     * the only reliable evidence: both layouts put a fixed 64-entry directory
     * at a fixed sector, and no Atari filesystem writes anything that passes
     * the entry checks below at those offsets.
     * @param {ATRImage} atr
     * @param {Object} profile
     * @returns {boolean}
     */
    static matchesProfile(atr, profile) {
        if (!atr || atr.sectorCount < profile.minSectors || atr.sectorCount > profile.maxSectors) return false;
        if (atr.sectorCount < profile.dirLastSector) return false;
        if (atr.getSectorSize(profile.dirFirstSector) !== profile.sectorSize) return false;

        const mask = profile.invertMask;

        if (profile.bootSignature) {
            try {
                const boot = atr.readSector(1);
                const sig = profile.bootSignature;
                let hit = true;
                for (let i = 0; i < sig.length; i++) {
                    if (boot[i] !== sig[i]) { hit = false; break; }
                }
                if (hit) return true;
            } catch (err) {
                return false;
            }
        }

        const totalBlocks = CPM.totalBlocks(atr.sectorCount, profile);

        try {
            let validEntries = 0;
            let emptyEntries = 0;
            let totalEntries = 0;

            for (let sec = profile.dirFirstSector; sec <= profile.dirLastSector; sec++) {
                const secData = atr.readSector(sec);
                for (let off = 0; off < profile.sectorSize; off += 32) {
                    totalEntries++;
                    const u = secData[off] ^ mask;

                    if (u === CPM.ERASED) { emptyEntries++; continue; }   // erased entry
                    if (u > 15) return false;                            // not a user number

                    // File name: printable ASCII, high bit carries the attributes
                    let printable = 0;
                    for (let i = 1; i <= 11; i++) {
                        const c = (secData[off + i] ^ mask) & 0x7F;
                        if (c < 0x20 || c > 0x7E) return false;
                        if (c !== 0x20) printable++;
                    }
                    if (printable === 0) return false;

                    // Record count of one extent never exceeds 128
                    if ((secData[off + 15] ^ mask) > 128) return false;

                    // Allocation map: 0 = unused, otherwise a data block
                    for (let b = 16; b < 32; b++) {
                        const blk = secData[off + b] ^ mask;
                        if (blk !== 0 && (blk < profile.firstDataBlock || blk >= totalBlocks)) return false;
                    }
                    validEntries++;
                }
            }

            // A freshly formatted disk has no files at all - accept it when the
            // whole directory area is erased, which no other Atari format
            // produces at these offsets.
            return validEntries > 0 || emptyEntries === totalEntries;
        } catch (err) {
            return false;
        }
    }

    /**
     * Formats a disk as CP/M 2.2. The reserved system tracks are left alone, so
     * reformatting a bootable disk keeps its CP/M system intact.
     * @param {ATRImage} atr
     * @param {Object} [profile] Layout to write; defaults to the Indus GT one
     */
    static formatDisk(atr, profile = CPM.PROFILES.INDUS) {
        if (!atr || atr.sectorCount <= profile.dirLastSector) {
            throw new Error(T("Obraz jest zbyt mały do sformatowania w CP/M 2.2."));
        }
        const mask = profile.invertMask;

        // Directory area filled with the erased-entry marker
        const emptyDirSec = new Uint8Array(profile.sectorSize);
        emptyDirSec.fill(CPM.ERASED ^ mask);
        for (let sec = profile.dirFirstSector; sec <= profile.dirLastSector; sec++) {
            atr.writeSector(sec, emptyDirSec);
        }
        // Data area zeroed out, in the profile's on-disk encoding
        for (let sec = profile.dirLastSector + 1; sec <= atr.sectorCount; sec++) {
            const emptyDataSec = new Uint8Array(atr.getSectorSize(sec));
            emptyDataSec.fill(0x00 ^ mask);
            atr.writeSector(sec, emptyDataSec);
        }
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = CPM;
}
