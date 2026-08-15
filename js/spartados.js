/*
 * ATRaction - Atari 8-bit ATR/XFD disk image manager
 * Copyright (C) 2026 dely / blowjobb / ng
 *
 * Contains work derived from the Altirra emulator by Avery Lee, licensed
 * GPL-2.0-or-later:
 *   ATIO/source/diskfssdx2.cpp  Copyright (C) 2009-2015 Avery Lee
 *
 * Derived here: the SDFS allocation bitmap layout and the sector-size code convention
 *   of boot byte 31 (128 -> 128 B, 0 -> 256 B, 1 -> 512 B).
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
 * SpartaDOS / SDFS (SpartaDOS File System) Parser, Reader, and Writer
 * Supports reading SpartaDOS boot block, directory trees (MAIN and subdirectories),
 * Sector Maps (SUSB chains), file data extraction, file importing, deletion, renaming, locking, and directory formatting.
 */

if (typeof T === 'undefined') {
    globalThis.T = function (text) {
        var args = Array.prototype.slice.call(arguments, 1);
        var s = text;
        for (var i = 0; i < args.length; i++) s = s.split('{' + i + '}').join(args[i]);
        return s;
    };
}

class SpartaDOS {
    /**
     * @param {ATRImage} atr Image instance
     */
    constructor(atr) {
        this.atr = atr;
        this.dosType = 'SpartaDOS';
        this.parseBootSector();
        this.validate();
    }

    /**
     * Cross-checks the allocation bitmap against the directory tree
     */
    validate() {
        this.isReadOnly = false;
        this.validationError = null;
        this.validationWarning = null;

        const used = new Set();
        const claim = (s) => {
            if (s >= 1 && s <= this.atr.sectorCount) used.add(s);
        };

        const bootSectors = (this.boot.sectorSize > 256) ? 1 : 3;
        for (let s = 1; s <= bootSectors; s++) claim(s);
        for (let i = 0; i < (this.boot.bitmapSectors || 0); i++) claim(this.boot.firstBitmap + i);

        const visitedDirs = new Set();
        const walk = (mapSec) => {
            if (!mapSec || visitedDirs.has(mapSec)) return;
            visitedDirs.add(mapSec);

            const { dataSectors, mapSectors } = this.readSectorMap(mapSec);
            mapSectors.forEach(claim);
            dataSectors.forEach(claim);
            if (dataSectors.length === 0) return;

            const secSize = this.boot.sectorSize || 128;
            const header = this.readStreamBytes(dataSectors, 0, 23);
            const dirLen = header[3] | (header[4] << 8) | (header[5] << 16);
            const totalBytes = dataSectors.length * secSize;
            const maxBytes = (dirLen > 0 && dirLen <= totalBytes) ? dirLen : totalBytes;

            for (let off = 23; off + 23 <= maxBytes; off += 23) {
                const entry = this.readStreamBytes(dataSectors, off, 23);
                const flag = entry[0];
                if (flag === 0x00) break;
                if ((flag & 0x10) !== 0) continue;      // deleted
                const entryMap = entry[1] | (entry[2] << 8);
                if (!entryMap) continue;

                if ((flag & 0x20) !== 0) {
                    walk(entryMap);
                } else {
                    const info = this.readSectorMap(entryMap);
                    info.mapSectors.forEach(claim);
                    info.dataSectors.forEach(claim);
                }
            }
        };

        try {
            walk(this.boot.sectorMap);
        } catch (e) {
            this.validationWarning = T("Nie udało się w pełni przejść drzewa katalogów SpartaDOS podczas weryfikacji alokacji.");
            return;
        }

        // Audit the volume the boot block declares, not the file it was dumped
        // into: an over-sized image (e.g. a 720-sector volume stored in a
        // 1120-sector ATR) carries trailing sectors that belong to no volume and
        // therefore have no meaningful bitmap bit.
        const volumeSectors = (this.boot.sectorCount > 0)
            ? Math.min(this.atr.sectorCount, this.boot.sectorCount)
            : this.atr.sectorCount;

        // The original SpartaDOS formatter permanently marks the last sector of
        // the volume as in use, whatever the volume size - seen on 720-sector
        // floppies (where it is also the sector an 810 cannot reach) and on
        // 1040-sector ones alike, while images written by this app and by
        // Altirra leave it free. It is reserved, not leaked. Claim it only when
        // the bitmap really does say "allocated", so a volume whose last sector
        // is genuinely free still behaves normally.
        if (volumeSectors >= 1 && !this.isSectorFree(volumeSectors)) claim(volumeSectors);

        let freeInBitmap = 0, usedMarkedFree = 0, freeMarkedAllocated = 0;
        for (let s = 1; s <= volumeSectors; s++) {
            const free = this.isSectorFree(s);
            if (free) freeInBitmap++;
            if (used.has(s)) {
                if (free) usedMarkedFree++;
            } else if (!free) {
                freeMarkedAllocated++;
            }
        }

        if (usedMarkedFree > 0) {
            this.isReadOnly = true;
            this.validationError = T("Błędna mapa bitowa SpartaDOS: sektory zajęte przez pliki są oznaczone jako wolne. Obraz zamontowano w trybie tylko do odczytu (read-only), aby zapobiec uszkodzeniu danych.");
        } else if (this.boot.freeSectors !== freeInBitmap) {
            this.isReadOnly = true;
            this.validationError = T("Niespójny licznik wolnych sektorów SpartaDOS (blok boot: {0}, mapa bitowa: {1}). Obraz zamontowano w trybie tylko do odczytu (read-only).", this.boot.freeSectors, freeInBitmap);
        } else if (freeMarkedAllocated > 0) {
            this.validationWarning = T("Uwaga: mapa bitowa SpartaDOS zawiera {0} zagubionych sektorów (oznaczone jako zajęte, choć żaden plik ich nie używa).", freeMarkedAllocated);
        }
    }

    /**
     * Checks whether a sector is marked free in the SpartaDOS bitmap
     * @param {number} sec
     * @returns {boolean}
     */
    isSectorFree(sec) {
        if (sec < 0 || sec > this.atr.sectorCount) return false;

        const bitsPerBmSec = (this.boot.sectorSize || 128) * 8;
        const bmSecIndex = Math.floor(sec / bitsPerBmSec);
        if (bmSecIndex >= (this.boot.bitmapSectors || 1)) return false;

        const bmData = this.atr.readSector((this.boot.firstBitmap || 4) + bmSecIndex);
        const relBit = sec % bitsPerBmSec;
        const bIdx = Math.floor(relBit / 8);
        if (bIdx >= bmData.length) return false;

        return (bmData[bIdx] & (0x80 >> (relBit % 8))) !== 0;
    }

    parseBootSector() {
        const sec1 = this.atr.readSector(1);
        // Byte 31 is the sector size code: 128 -> 128 B, 0 -> 256 B, 1 -> 512 B
        let secSize = sec1[31] === 128 ? 128 : (sec1[31] === 1 ? 512 : 256);
        const declared = sec1[33] | (sec1[34] << 8);
        if (declared === 128 || declared === 256 || declared === 512) {
            secSize = declared;
        }
        this.boot = {
            sectorMap: sec1[9] | (sec1[10] << 8),
            sectorCount: sec1[11] | (sec1[12] << 8),
            freeSectors: sec1[13] | (sec1[14] << 8),
            bitmapSectors: sec1[15],
            firstBitmap: sec1[16] | (sec1[17] << 8),
            volumeName: ATASCII.bytesToString(sec1.subarray(22, 30), false).trim(),
            sectorSize: secSize,
            version: sec1[32],
            slotsPerMap: sec1[35] || ((secSize === 256) ? 126 : 62)
        };
    }

    get freeSectors() {
        return this.boot.freeSectors;
    }

    /**
     * Allocates a free sector from the SpartaDOS bitmap
     * @returns {number} Allocated sector number
     */
    allocateSector() {
        if (this.boot.freeSectors <= 0) {
            throw new Error(T("Dysk pełny: brak wolnych sektorów."));
        }

        const numBitmapSectors = this.boot.bitmapSectors || 1;
        const firstBitmapSec = this.boot.firstBitmap || 4;
        const secSize = this.boot.sectorSize || 256;
        const bitsPerBmSec = secSize * 8;

        for (let bmIdx = 0; bmIdx < numBitmapSectors; bmIdx++) {
            const bmSecNum = firstBitmapSec + bmIdx;
            const bmData = this.atr.readSector(bmSecNum);

            for (let bIdx = 0; bIdx < bmData.length; bIdx++) {
                if (bmData[bIdx] > 0) {
                    for (let bit = 0; bit < 8; bit++) {
                        const mask = 0x80 >> bit;
                        if ((bmData[bIdx] & mask) !== 0) {
                            const sec = bmIdx * bitsPerBmSec + bIdx * 8 + bit;
                            if (sec >= 1 && sec <= this.atr.sectorCount) {
                                // Mark sector as used (0)
                                bmData[bIdx] &= ~mask;
                                this.atr.writeSector(bmSecNum, bmData);

                                // Update boot sector free count
                                this.boot.freeSectors--;
                                const sec1 = this.atr.readSector(1);
                                sec1[13] = this.boot.freeSectors & 0xFF;
                                sec1[14] = (this.boot.freeSectors >> 8) & 0xFF;
                                this.atr.writeSector(1, sec1);

                                return sec;
                            }
                        }
                    }
                }
            }
        }

        throw new Error(T("Dysk pełny: wyczerpano bitmapę sektorów."));
    }

    /**
     * Marks a sector as free in the SpartaDOS bitmap
     * @param {number} sec 
     */
    freeSector(sec) {
        if (sec <= 0 || sec > this.atr.sectorCount) return;

        const numBitmapSectors = this.boot.bitmapSectors || 1;
        const firstBitmapSec = this.boot.firstBitmap || 4;
        const secSize = this.boot.sectorSize || 256;
        const bitsPerBmSec = secSize * 8;

        const bmSecIndex = Math.floor(sec / bitsPerBmSec);
        if (bmSecIndex >= numBitmapSectors) return;

        const bmSecNum = firstBitmapSec + bmSecIndex;
        const bmData = this.atr.readSector(bmSecNum);

        const relBit = sec % bitsPerBmSec;
        const bIdx = Math.floor(relBit / 8);
        const mask = 0x80 >> (relBit % 8);

        if (bIdx < bmData.length) {
            bmData[bIdx] |= mask;
            this.atr.writeSector(bmSecNum, bmData);

            this.boot.freeSectors++;
            const sec1 = this.atr.readSector(1);
            sec1[13] = this.boot.freeSectors & 0xFF;
            sec1[14] = (this.boot.freeSectors >> 8) & 0xFF;
            this.atr.writeSector(1, sec1);
        }
    }

    /**
     * Reads SUSB sector map chain to collect data sector numbers for a file or directory
     * @param {number} sectorMapSector 
     * @returns {{dataSectors: Array<number>, mapSectors: Array<number>}}
     */
    readSectorMap(sectorMapSector) {
        const dataSectors = [];
        const mapSectors = [];
        let curMapSec = sectorMapSector;
        const visitedMaps = new Set();

        while (curMapSec > 0 && curMapSec <= this.atr.sectorCount && !visitedMaps.has(curMapSec)) {
            visitedMaps.add(curMapSec);
            mapSectors.push(curMapSec);

            const mapData = this.atr.readSector(curMapSec);
            const nextMapSec = mapData[0] | (mapData[1] << 8);

            // Sector list in map sector starts at byte offset 4 (pairs of sector numbers)
            for (let i = 4; i < mapData.length; i += 2) {
                const s = mapData[i] | (mapData[i + 1] << 8);
                if (s === 0) break;
                if (s <= this.atr.sectorCount) {
                    dataSectors.push(s);
                }
            }

            if (nextMapSec === 0 || nextMapSec === curMapSec) break;
            curMapSec = nextMapSec;
        }

        return { dataSectors, mapSectors };
    }

    /**
     * Reads raw bytes of a file or directory by traversing its sector map
     * @param {number} sectorMapSector 
     * @param {number} [byteLen] 
     * @returns {Uint8Array}
     */
    readFileBytes(sectorMapSector, byteLen) {
        const { dataSectors } = this.readSectorMap(sectorMapSector);
        
        let totalBytes = 0;
        const chunks = dataSectors.map(sec => {
            const secData = this.atr.readSector(sec);
            totalBytes += secData.length;
            return secData;
        });

        const targetLen = (byteLen !== undefined && byteLen > 0) ? Math.min(byteLen, totalBytes) : totalBytes;
        const result = new Uint8Array(targetLen);
        let writeOff = 0;

        for (const chunk of chunks) {
            const copyLen = Math.min(chunk.length, targetLen - writeOff);
            result.set(chunk.subarray(0, copyLen), writeOff);
            writeOff += copyLen;
            if (writeOff >= targetLen) break;
        }

        return result;
    }

    /**
     * Reads `byteLen` bytes from logical offset `byteOffset` across a list of sectors
     * @param {Array<number>} dataSectors 
     * @param {number} byteOffset 
     * @param {number} byteLen 
     * @returns {Uint8Array}
     */
    readStreamBytes(dataSectors, byteOffset, byteLen) {
        const secSize = this.boot.sectorSize || 128;
        const result = new Uint8Array(byteLen);
        for (let i = 0; i < byteLen; i++) {
            const pos = byteOffset + i;
            const secIdx = Math.floor(pos / secSize);
            if (secIdx < dataSectors.length) {
                const secNum = dataSectors[secIdx];
                const secBuf = this.atr.readSector(secNum);
                result[i] = secBuf[pos % secSize];
            } else {
                result[i] = 0; // out of bounds
            }
        }
        return result;
    }

    /**
     * Writes buffer `buf` to logical offset `byteOffset` across a list of sectors
     * @param {Array<number>} dataSectors 
     * @param {number} byteOffset 
     * @param {Uint8Array} buf 
     */
    writeStreamBytes(dataSectors, byteOffset, buf) {
        const secSize = this.boot.sectorSize || 128;
        const sectorsToModify = new Set();
        for (let i = 0; i < buf.length; i++) {
            const pos = byteOffset + i;
            const secIdx = Math.floor(pos / secSize);
            if (secIdx < dataSectors.length) {
                sectorsToModify.add(secIdx);
            }
        }
        for (const secIdx of sectorsToModify) {
            const secNum = dataSectors[secIdx];
            const secBuf = this.atr.readSector(secNum);
            for (let i = 0; i < buf.length; i++) {
                const pos = byteOffset + i;
                if (Math.floor(pos / secSize) === secIdx) {
                    secBuf[pos % secSize] = buf[i];
                }
            }
            this.atr.writeSector(secNum, secBuf);
        }
    }

    /**
     * Finds an empty slot or allocates space in target directory, then writes a 23-byte entry
     * @param {number} targetDirMapSec 
     * @param {Uint8Array} entryBuf 
     */
    writeEntryToDirectory(targetDirMapSec, entryBuf) {
        let { dataSectors } = this.readSectorMap(targetDirMapSec);
        if (dataSectors.length === 0) {
            throw new Error(T("Nieprawidłowy sektor mapy katalogu docelowego."));
        }

        const secSize = this.boot.sectorSize || 128;
        const headerBuf = this.readStreamBytes(dataSectors, 0, 23);
        const currentDirLen = headerBuf[3] | (headerBuf[4] << 8) | (headerBuf[5] << 16);

        let targetOffset = -1;
        for (let off = 23; ; off += 23) {
            if (off + 23 > dataSectors.length * secSize) {
                // We need to allocate a new directory data sector and append to sector map
                const newDirSecNum = this.allocateSector();
                const newDirSecBuf = new Uint8Array(secSize); // 0x00 initialized
                this.atr.writeSector(newDirSecNum, newDirSecBuf);

                const { mapSectors } = this.readSectorMap(targetDirMapSec);
                const lastMapSecNum = mapSectors[mapSectors.length - 1];
                const lastMapBuf = this.atr.readSector(lastMapSecNum);
                let addedToMap = false;
                for (let i = 4; i < lastMapBuf.length; i += 2) {
                    if ((lastMapBuf[i] | (lastMapBuf[i + 1] << 8)) === 0) {
                        lastMapBuf[i] = newDirSecNum & 0xFF;
                        lastMapBuf[i + 1] = (newDirSecNum >> 8) & 0xFF;
                        this.atr.writeSector(lastMapSecNum, lastMapBuf);
                        addedToMap = true;
                        break;
                    }
                }
                if (!addedToMap) {
                    // Allocate a new map sector
                    const newMapSecNum = this.allocateSector();
                    const newMapBuf = new Uint8Array(secSize);
                    newMapBuf[2] = lastMapSecNum & 0xFF;
                    newMapBuf[3] = (lastMapSecNum >> 8) & 0xFF;
                    newMapBuf[4] = newDirSecNum & 0xFF;
                    newMapBuf[5] = (newDirSecNum >> 8) & 0xFF;
                    this.atr.writeSector(newMapSecNum, newMapBuf);

                    lastMapBuf[0] = newMapSecNum & 0xFF;
                    lastMapBuf[1] = (newMapSecNum >> 8) & 0xFF;
                    this.atr.writeSector(lastMapSecNum, lastMapBuf);
                }

                // Refresh dataSectors
                dataSectors = this.readSectorMap(targetDirMapSec).dataSectors;
            }

            const slotBuf = this.readStreamBytes(dataSectors, off, 1);
            const flag = slotBuf[0];
            if (flag === 0x00 || (flag & 0x10) !== 0) {
                targetOffset = off;
                break;
            }
        }

        this.writeStreamBytes(dataSectors, targetOffset, entryBuf);

        if (targetOffset + 23 > currentDirLen) {
            const newDirLen = targetOffset + 23;
            headerBuf[3] = newDirLen & 0xFF;
            headerBuf[4] = (newDirLen >> 8) & 0xFF;
            headerBuf[5] = (newDirLen >> 16) & 0xFF;
            this.writeStreamBytes(dataSectors, 0, headerBuf);
        }
    }

    /**
     * Reads full directory hierarchy starting from MAIN directory map
     * @param {number} [mapSector=this.boot.sectorMap] 
     * @param {string} [dirName='MAIN'] 
     * @param {string} [parentPath='']
     * @param {Set<number>} [visitedDirs] Directory map sectors already expanded
     * @returns {Array<Object>} List of files and directories
     */
    getDirectory(mapSector = this.boot.sectorMap, dirName = 'MAIN', parentPath = '', visitedDirs = new Set()) {
        // A subdirectory entry pointing back at MAIN - or at any directory
        // already expanded - would recurse without end. The sector map is what
        // identifies a directory, so expanding each map at most once per walk
        // bounds the whole traversal by the size of the disk. A damaged image
        // then shows that directory as empty instead of taking down the page.
        if (visitedDirs.has(mapSector)) return [];
        visitedDirs.add(mapSector);

        const files = [];
        const { dataSectors } = this.readSectorMap(mapSector);
        if (dataSectors.length === 0) return [];

        const secSize = this.boot.sectorSize || 128;
        const headerBuf = this.readStreamBytes(dataSectors, 0, 23);
        const dirLen = headerBuf[3] | (headerBuf[4] << 8) | (headerBuf[5] << 16);
        const totalDataBytes = dataSectors.length * secSize;
        const maxBytes = (dirLen > 0 && dirLen <= totalDataBytes) ? dirLen : totalDataBytes;

        let globalIndex = 0;

        for (let i = 23; i + 23 <= maxBytes; i += 23) {
            const entryBuf = this.readStreamBytes(dataSectors, i, 23);
            const flag = entryBuf[0];
            if (flag === 0x00) break; // End of directory marker

            const isDeleted = (flag & 0x10) !== 0;
            const isDir = (flag & 0x20) !== 0;
            const isProtected = (flag & 0x01) !== 0; // P (Protect)
            const isHidden = (flag & 0x02) !== 0;    // H (Hidden)
            const isArchived = (flag & 0x04) !== 0;  // A (Archive)

            const entryMapSec = entryBuf[1] | (entryBuf[2] << 8);
            const fileSize = entryBuf[3] | (entryBuf[4] << 8) | (entryBuf[5] << 16);

            const nameBytes = entryBuf.subarray(6, 14);
            const extBytes = entryBuf.subarray(14, 17);

            const nameStr = ATASCII.bytesToString(nameBytes, false).trim();
            const extStr = ATASCII.bytesToString(extBytes, false).trim();
            const fullName = extStr ? `${nameStr}.${extStr}` : nameStr;
            const fullPath = parentPath ? `${parentPath}/${fullName}` : fullName;

            const day = entryBuf[17];
            const month = entryBuf[18];
            const year = entryBuf[19];
            const dateStr = (day > 0 && month > 0) ? `${day.toString().padStart(2, '0')}/${month.toString().padStart(2, '0')}/${year.toString().padStart(2, '0')}` : '-';

            const fileSectorInfo = (!isDeleted && entryMapSec > 0) ? this.readSectorMap(entryMapSec) : { dataSectors: [] };

            const secIdx = Math.floor(i / secSize);
            const secNum = dataSectors[secIdx] || 0;
            const secOffset = i % secSize;

            const fileObj = {
                index: globalIndex++,
                dirSector: mapSector,
                dirOffset: i,
                dirSecNum: secNum,
                dirSecOffset: secOffset,
                flag: flag,
                isValid: !isDeleted,
                isDeleted: isDeleted,
                isLocked: isProtected,
                isProtected: isProtected,
                isHidden: isHidden,
                isArchived: isArchived,
                isDir: isDir,
                name: nameStr,
                ext: extStr,
                nameBytes: new Uint8Array(nameBytes),
                extBytes: new Uint8Array(extBytes),
                fullName: fullName,
                fullPath: fullPath,
                startSector: entryMapSec,
                sectorCount: fileSectorInfo.dataSectors.length,
                sizeBytes: fileSize,
                sectors: fileSectorInfo.dataSectors,
                date: dateStr,
                subFiles: []
            };

            // Recurse subdirectories
            if (isDir && !isDeleted && entryMapSec > 0) {
                fileObj.subFiles = this.getDirectory(entryMapSec, fullName, fullPath, visitedDirs);
            }

            files.push(fileObj);
        }

        return files;
    }

    /**
     * Reads raw bytes of a file in SpartaDOS
     * @param {Object} fileObj 
     * @returns {Uint8Array}
     */
    readFile(fileObj) {
        return this.readFileBytes(fileObj.startSector, fileObj.sizeBytes);
    }

    /**
     * Checks if a file or directory with the given 8.3 name already exists in target directory
     * @param {number} dirMapSec Sector map of target directory
     * @param {string} targetFullName Upper-case formatted full name (e.g. "TEST.TXT" or "DIRNAME")
     * @returns {boolean}
     */
    fileExistsInDir(dirMapSec, targetFullName) {
        const targetUpper = targetFullName.toUpperCase();
        const { dataSectors } = this.readSectorMap(dirMapSec);
        if (dataSectors.length === 0) return false;

        const secSize = this.boot.sectorSize || 128;
        const headerBuf = this.readStreamBytes(dataSectors, 0, 23);
        const dirLen = headerBuf[3] | (headerBuf[4] << 8) | (headerBuf[5] << 16);
        const totalDataBytes = dataSectors.length * secSize;
        const maxBytes = (dirLen > 0 && dirLen <= totalDataBytes) ? dirLen : totalDataBytes;

        for (let i = 23; i + 23 <= maxBytes; i += 23) {
            const entryBuf = this.readStreamBytes(dataSectors, i, 23);
            const flag = entryBuf[0];
            if (flag === 0x00) break;
            if ((flag & 0x10) !== 0) continue; // Skip deleted entries

            const nameBytes = entryBuf.subarray(6, 14);
            const extBytes = entryBuf.subarray(14, 17);
            const nameStr = ATASCII.bytesToString(nameBytes, false).trim();
            const extStr = ATASCII.bytesToString(extBytes, false).trim();
            const existingFull = (extStr ? `${nameStr}.${extStr}` : nameStr).toUpperCase();

            if (existingFull === targetUpper) {
                return true;
            }
        }
        return false;
    }

    /**
     * Imports a file into SpartaDOS
     * @param {string} filename File name (e.g., TEST.COM)
     * @param {Uint8Array} fileBytes Raw bytes of file
     * @param {number} [targetDirMapSec=this.boot.sectorMap] Sector map of target directory
     */
    importFile(filename, fileBytes, targetDirMapSec = this.boot.sectorMap) {
        const sanitized = ATASCII.formatFilename83(filename);

        // Check for duplicate filename in target directory
        if (this.fileExistsInDir(targetDirMapSec, sanitized.fullName)) {
            throw new Error(T("Plik '{0}' już istnieje w tym katalogu.", sanitized.fullName));
        }

        const nameStr = sanitized.name.padEnd(8, ' ');
        const extStr = sanitized.ext.padEnd(3, ' ');

        const nameBytes = ATASCII.stringToBytes(nameStr);
        const extBytes = ATASCII.stringToBytes(extStr);

        // 1. Work out how much space the file needs, data plus sector map
        const secSize = this.boot.sectorSize || 128;
        const totalDataSecs = Math.max(1, Math.ceil(fileBytes.length / secSize));
        const maxDataSecsPerMap = Math.floor((secSize - 4) / 2);
        const mapSectorsCount = Math.max(1, Math.ceil(totalDataSecs / maxDataSecsPerMap));
        const sectorsNeeded = totalDataSecs + mapSectorsCount;

        if (sectorsNeeded > this.boot.freeSectors) {
            throw new Error(T("Brak miejsca na dysku SpartaDOS. Wymagane: {0} sektorów, Dostępne: {1}", sectorsNeeded, this.boot.freeSectors));
        }

        // Allocate everything up front so a failure can be rolled back cleanly
        // instead of leaving orphaned sectors marked as used in the bitmap.
        const dataSectors = [];
        const mapSectors = [];
        try {
            for (let i = 0; i < totalDataSecs; i++) dataSectors.push(this.allocateSector());
            for (let i = 0; i < mapSectorsCount; i++) mapSectors.push(this.allocateSector());
        } catch (err) {
            dataSectors.forEach(s => this.freeSector(s));
            mapSectors.forEach(s => this.freeSector(s));
            throw err;
        }

        // Write file payload to data sectors
        for (let i = 0; i < totalDataSecs; i++) {
            const secNum = dataSectors[i];
            const secBuf = new Uint8Array(secSize);
            const chunk = fileBytes.subarray(i * secSize, (i + 1) * secSize);
            secBuf.set(chunk, 0);
            this.atr.writeSector(secNum, secBuf);
        }

        // 2. Build the SUSB sector map chain for the file
        for (let i = 0; i < mapSectorsCount; i++) {
            const mapSecNum = mapSectors[i];
            const mapBuf = new Uint8Array(secSize);

            const nextMapSec = (i + 1 < mapSectorsCount) ? mapSectors[i + 1] : 0;
            const prevMapSec = (i > 0) ? mapSectors[i - 1] : 0;

            mapBuf[0] = nextMapSec & 0xFF;
            mapBuf[1] = (nextMapSec >> 8) & 0xFF;
            mapBuf[2] = prevMapSec & 0xFF;
            mapBuf[3] = (prevMapSec >> 8) & 0xFF;

            const startIdx = i * maxDataSecsPerMap;
            const endIdx = Math.min(totalDataSecs, (i + 1) * maxDataSecsPerMap);

            let writeOff = 4;
            for (let d = startIdx; d < endIdx; d++) {
                mapBuf[writeOff] = dataSectors[d] & 0xFF;
                mapBuf[writeOff + 1] = (dataSectors[d] >> 8) & 0xFF;
                writeOff += 2;
            }

            this.atr.writeSector(mapSecNum, mapBuf);
        }

        const startSectorMap = mapSectors[0];

        // 3. Write Directory Entry (23 bytes) into target directory
        const now = new Date();
        const day = now.getDate();
        const month = now.getMonth() + 1;
        const year = now.getFullYear() % 100;
        const hours = now.getHours();
        const mins = now.getMinutes();
        const secs = now.getSeconds();

        const entryBuf = new Uint8Array(23);
        entryBuf[0] = 0x08; // Flag: In use
        entryBuf[1] = startSectorMap & 0xFF;
        entryBuf[2] = (startSectorMap >> 8) & 0xFF;

        const fLen = fileBytes.length;
        entryBuf[3] = fLen & 0xFF;
        entryBuf[4] = (fLen >> 8) & 0xFF;
        entryBuf[5] = (fLen >> 16) & 0xFF;

        entryBuf.set(nameBytes, 6);
        entryBuf.set(extBytes, 14);

        entryBuf[17] = day;
        entryBuf[18] = month;
        entryBuf[19] = year;
        entryBuf[20] = hours;
        entryBuf[21] = mins;
        entryBuf[22] = secs;

        try {
            this.writeEntryToDirectory(targetDirMapSec, entryBuf);
        } catch (err) {
            // Directory could not take the entry - give the file space back
            dataSectors.forEach(s => this.freeSector(s));
            mapSectors.forEach(s => this.freeSector(s));
            throw err;
        }
    }

    /**
     * Deletes a file in SpartaDOS
     * @param {Object} fileObj 
     */
    deleteFile(fileObj) {
        if (!fileObj || !fileObj.dirSector || fileObj.dirOffset === undefined) {
            throw new Error(T("Nieprawidłowy obiekt pliku do usunięcia."));
        }

        const { dataSectors: dirDataSectors } = this.readSectorMap(fileObj.dirSector);
        if (dirDataSectors.length === 0) throw new Error(T("Nie znaleziono sektora katalogu."));

        const entryBuf = this.readStreamBytes(dirDataSectors, fileObj.dirOffset, 23);
        entryBuf[0] |= 0x10; // Set deleted flag (bit 4: 0x10)
        entryBuf[0] &= ~0x08; // Clear in-use flag
        this.writeStreamBytes(dirDataSectors, fileObj.dirOffset, entryBuf);

        // Free data and sector map sectors of the deleted file
        if (fileObj.startSector > 0) {
            const { dataSectors, mapSectors } = this.readSectorMap(fileObj.startSector);
            for (const s of dataSectors) this.freeSector(s);
            for (const m of mapSectors) this.freeSector(m);
        }
    }

    /**
     * Renames a file in SpartaDOS
     * @param {Object} fileObj 
     * @param {string} newName 
     */
    renameFile(fileObj, newName) {
        if (!fileObj || !fileObj.dirSector || fileObj.dirOffset === undefined) {
            throw new Error(T("Nieprawidłowy obiekt pliku do zmiany nazwy."));
        }

        const sanitized = ATASCII.formatFilename83(newName);
        const nameStr = sanitized.name.padEnd(8, ' ');
        const extStr = sanitized.ext.padEnd(3, ' ');

        const { dataSectors: dirDataSectors } = this.readSectorMap(fileObj.dirSector);
        if (dirDataSectors.length === 0) throw new Error(T("Nie znaleziono sektora katalogu."));

        const entryBuf = this.readStreamBytes(dirDataSectors, fileObj.dirOffset, 23);
        entryBuf.set(ATASCII.stringToBytes(nameStr), 6);
        entryBuf.set(ATASCII.stringToBytes(extStr), 14);
        this.writeStreamBytes(dirDataSectors, fileObj.dirOffset, entryBuf);
    }

    /**
     * Sets or clears SDFS file attributes (A, H, P) in SpartaDOS
     * @param {Object} fileObj 
     * @param {Object} attrs { protected?: boolean, hidden?: boolean, archived?: boolean }
     */
    setAttributes(fileObj, attrs = {}) {
        if (!fileObj || !fileObj.dirSector || fileObj.dirOffset === undefined) {
            throw new Error(T("Nieprawidłowy obiekt pliku."));
        }

        const { dataSectors: dirDataSectors } = this.readSectorMap(fileObj.dirSector);
        if (dirDataSectors.length === 0) throw new Error(T("Nie znaleziono sektora katalogu."));

        const entryBuf = this.readStreamBytes(dirDataSectors, fileObj.dirOffset, 23);
        let flag = entryBuf[0];

        if (attrs.protected !== undefined) {
            if (attrs.protected) flag |= 0x01;  // Bit 0: P (Protect)
            else flag &= ~0x01;
        }

        if (attrs.hidden !== undefined) {
            if (attrs.hidden) flag |= 0x02;     // Bit 1: H (Hidden)
            else flag &= ~0x02;
        }

        if (attrs.archived !== undefined) {
            if (attrs.archived) flag |= 0x04;   // Bit 2: A (Archive)
            else flag &= ~0x04;
        }

        entryBuf[0] = flag;
        this.writeStreamBytes(dirDataSectors, fileObj.dirOffset, entryBuf);

        fileObj.flag = flag;
        fileObj.isProtected = (flag & 0x01) !== 0;
        fileObj.isLocked = fileObj.isProtected;
        fileObj.isHidden = (flag & 0x02) !== 0;
        fileObj.isArchived = (flag & 0x04) !== 0;
    }

    /**
     * Locks or unlocks a file in SpartaDOS
     * @param {Object} fileObj 
     * @param {boolean} lock 
     */
    setLock(fileObj, lock) {
        this.setAttributes(fileObj, { protected: lock });
    }

    /**
     * Creates a new subdirectory in SpartaDOS
     * @param {string} dirName Directory name (e.g. SUBDIR)
     * @param {number} [parentMapSec=this.boot.sectorMap] Sector map of parent directory
     */
    createDirectory(dirName, parentMapSec = this.boot.sectorMap) {
        const sanitized = ATASCII.formatFilename83(dirName);

        if (this.fileExistsInDir(parentMapSec, sanitized.fullName)) {
            throw new Error(T("Plik lub katalog '{0}' już istnieje w tym katalogu.", sanitized.fullName));
        }

        const nameStr = sanitized.name.padEnd(8, ' ');
        const extStr = sanitized.ext.padEnd(3, ' ');

        const nameBytes = ATASCII.stringToBytes(nameStr);
        const extBytes = ATASCII.stringToBytes(extStr);

        const secSize = this.boot.sectorSize || 128;

        // 1. Allocate Sector Map sector and Data sector for the new subdirectory
        if (this.boot.freeSectors < 2) {
            throw new Error(T("Brak miejsca na dysku SpartaDOS. Wymagane: 2 sektory, Dostępne: {0}", this.boot.freeSectors));
        }
        const subDirMapSec = this.allocateSector();
        let subDirDataSec;
        try {
            subDirDataSec = this.allocateSector();
        } catch (err) {
            this.freeSector(subDirMapSec);
            throw err;
        }

        // 2. Initialize subDirMapSec (SUSB map sector for the subdirectory)
        const mapBuf = new Uint8Array(secSize);
        mapBuf[0] = 0; mapBuf[1] = 0; // Next map = 0
        mapBuf[2] = 0; mapBuf[3] = 0; // Prev map = 0
        mapBuf[4] = subDirDataSec & 0xFF;
        mapBuf[5] = (subDirDataSec >> 8) & 0xFF;
        this.atr.writeSector(subDirMapSec, mapBuf);

        // 3. Initialize subDirDataSec (First data sector for the subdirectory)
        const dataBuf = new Uint8Array(secSize);
        dataBuf[0] = 0x28; // Flags: In use + Subdirectory (0x08 | 0x20)
        dataBuf[1] = parentMapSec & 0xFF; // Parent directory map sector
        dataBuf[2] = (parentMapSec >> 8) & 0xFF;

        // Initial directory length = 23 bytes (header entry length)
        dataBuf[3] = 23; dataBuf[4] = 0; dataBuf[5] = 0;
        dataBuf.set(nameBytes, 6); // Subdirectory name in header

        this.atr.writeSector(subDirDataSec, dataBuf);

        // 4. Write 23-byte directory entry into Parent Directory
        const now = new Date();
        const day = now.getDate();
        const month = now.getMonth() + 1;
        const year = now.getFullYear() % 100;
        const hours = now.getHours();
        const mins = now.getMinutes();
        const secs = now.getSeconds();

        const entryBuf = new Uint8Array(23);
        entryBuf[0] = 0x28; // Flag: In use + Directory
        entryBuf[1] = subDirMapSec & 0xFF;
        entryBuf[2] = (subDirMapSec >> 8) & 0xFF;
        entryBuf[3] = 23; entryBuf[4] = 0; entryBuf[5] = 0; // Dir length
        entryBuf.set(nameBytes, 6);
        entryBuf.set(extBytes, 14);
        entryBuf[17] = day; entryBuf[18] = month; entryBuf[19] = year;
        entryBuf[20] = hours; entryBuf[21] = mins; entryBuf[22] = secs;

        try {
            this.writeEntryToDirectory(parentMapSec, entryBuf);
        } catch (err) {
            this.freeSector(subDirDataSec);
            this.freeSector(subDirMapSec);
            throw err;
        }
    }

    /**
     * Formats an ATR disk image under SpartaDOS / SDFS
     * @param {ATRImage} atr 
     * @returns {SpartaDOS}
     */
    static formatDisk(atr) {
        const sectorCount = atr.sectorCount;
        const secSize = atr.getSectorSize(Math.min(4, sectorCount));
        const bitsPerBmSec = secSize * 8;
        // 512-byte volumes use a single boot sector
        const bootSectorCount = secSize >= 512 ? 1 : 3;
        // The bitmap addresses sectors 0..sectorCount, so it needs sectorCount+1 bits
        const numBmSecs = Math.ceil((sectorCount + 1) / bitsPerBmSec);
        const firstBmSec = bootSectorCount + 1;
        const firstMainMapSec = firstBmSec + numBmSecs;
        const firstMainDataSec = firstMainMapSec + 1;
        const firstFreeSec = firstMainDataSec + 1;

        // "$80 is the signature byte for SDX SD/DD disks;
        // $40 is for DD 512."
        const s1 = new Uint8Array(atr.getSectorSize(1));
        const bootCode = (secSize >= 512)
            ? [0x00, 0x01, 0x00, 0x04, 0xE0, 0x07, 0x4C, 0x40, 0x04]   // load $0400, init $07E0, JMP $0440
            : [0x00, 0x03, 0x00, 0x30, 0xE0, 0x07, 0x4C, 0x80, 0x30];
        s1.set(bootCode, 0);
        s1[1] = bootSectorCount;
        s1[9] = firstMainMapSec & 0xFF;
        s1[10] = (firstMainMapSec >> 8) & 0xFF;
        s1[11] = sectorCount & 0xFF;
        s1[12] = (sectorCount >> 8) & 0xFF;

        // Sectors firstFreeSec..sectorCount inclusive are free
        const freeSec = sectorCount - firstFreeSec + 1;
        s1[13] = freeSec & 0xFF;
        s1[14] = (freeSec >> 8) & 0xFF;
        s1[15] = numBmSecs & 0xFF;
        s1[16] = firstBmSec & 0xFF;
        s1[17] = (firstBmSec >> 8) & 0xFF;
        s1[18] = firstFreeSec & 0xFF;
        s1[19] = (firstFreeSec >> 8) & 0xFF;
        s1[20] = firstFreeSec & 0xFF;
        s1[21] = (firstFreeSec >> 8) & 0xFF;

        const volName = "SPARTDOS";
        for (let i = 0; i < 8; i++) {
            s1[22 + i] = volName.charCodeAt(i);
        }
        s1[30] = Math.ceil(sectorCount / 18) || 40;
        s1[31] = secSize < 512 ? (secSize & 0xFF) : 1;   // 128 -> 128, 256 -> 0, 512 -> 1
        s1[32] = 0x21; // SDFS 2.1
        s1[33] = secSize & 0xFF;
        s1[34] = (secSize >> 8) & 0xFF;
        s1[35] = ((secSize - 4) >> 1) & 0xFF;   // sector map entries per map sector
        s1[36] = 0x00;
        s1[37] = 0x01;
        s1[38] = 0x37; // Volume sequence number
        s1[39] = 0x00; // Volume random number
        atr.writeSector(1, s1);

        // Sector 2: Boot loader stub (6502 RTS with carry set so DOS/BIOS knows
        // it's a non-bootable SDFS disk). Only present when the volume reserves
        // more than one boot sector - with 512-byte sectors sector 2 is bitmap.
        if (bootSectorCount >= 3) {
            const s2 = new Uint8Array(atr.getSectorSize(2));
            s2.set([0xA9, 0x60, 0x8D, 0x40, 0x07, 0x38, 0x60], 0);
            atr.writeSector(2, s2);
        }

        // Clear bitmap sectors
        for (let b = 0; b < numBmSecs; b++) {
            atr.writeSector(firstBmSec + b, new Uint8Array(secSize));
        }

        // Set free bits in bitmap sectors for sectors from firstFreeSec to sectorCount
        for (let s = firstFreeSec; s <= sectorCount; s++) {
            const bIndex = Math.floor(s / bitsPerBmSec);
            const bmSecNum = firstBmSec + bIndex;
            const relBit = s % bitsPerBmSec;
            const byteIdx = Math.floor(relBit / 8);
            const bitMask = 0x80 >> (relBit % 8);

            const bmData = atr.readSector(bmSecNum);
            bmData[byteIdx] |= bitMask;
            atr.writeSector(bmSecNum, bmData);
        }

        // Sector Map for MAIN directory
        const sm = new Uint8Array(secSize);
        sm[4] = firstMainDataSec & 0xFF;
        sm[5] = (firstMainDataSec >> 8) & 0xFF;
        atr.writeSector(firstMainMapSec, sm);

        // Directory payload for MAIN directory
        const d6 = new Uint8Array(secSize);
        d6[0] = 0x28; // Flags: In use + Directory
        d6[3] = 23; d6[4] = 0; d6[5] = 0; // Directory length = 23 bytes
        const mainName = "MAIN    ";
        for (let i = 0; i < 8; i++) {
            d6[6 + i] = mainName.charCodeAt(i);
        }
        atr.writeSector(firstMainDataSec, d6);

        return new SpartaDOS(atr);
    }
}
