/*
 * ATRaction - Atari 8-bit ATR/XFD disk image manager
 * Copyright (C) 2026 dely / blowjobb / ng
 *
 * The LiteDOS-SE support - cluster allocation map, VTOC/directory geometry and
 * entry format - follows the technical section of the LiteDOS-SE user manual by
 * Mr Atari (http://www.mr-atari.com/).
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
 * LiteDOS-SE File System Parser, Reader, and Writer
 * Supports LiteDOS cluster-based allocation, double-cluster VTOC & directory area,
 * 10-bit and 16-bit sector linking, file import, deletion, renaming, locking, and formatting.
 *
 * Layout per "LiteDOS manual fix.pdf", technical section (pages 8-9):
 *   Sector 360, LiteDOS-SE variant (ID bits 7..6 = 01):
 *     $00 1 byte   ID, low 6 bits = clusterSize - 1
 *     $01 2 bytes  disk size in sectors
 *     $03 2 bytes  free space in sectors
 *     $05 5 bytes  zero
 *     $0A 118 (SD) or 128 (DD) bytes  cluster bitmap, first bit = cluster 0,
 *                  1 = free, 0 = occupied
 *   Sector 360, LiteDOS 2.x variant (ID bits 7..6 = 10), seen on Numen (DSDD):
 *     $03 "LiteDOS(c)MrA", $10 "------VTOC------", $20 64-byte bitmap,
 *     $60 "-----512BIT-----", $71 3 bytes free space, then "FreeSectors"
 *
 * The VTOC plus directory span two clusters aligned to a double-cluster boundary
 * and always containing sector 360; the directory starts at sector 361 and wraps
 * inside that block. Every directory sector holds 8 entries, also in double
 * density ("For compatibility, LiteDOS stores 8 names in a directory-sector,
 * although on DD there is room for 16 names").
 */

const LITEDOS_DIR_ENTRIES_PER_SECTOR = 8;

if (typeof T === 'undefined') {
    globalThis.T = function (text) {
        var args = Array.prototype.slice.call(arguments, 1);
        var s = text;
        for (var i = 0; i < args.length; i++) s = s.split('{' + i + '}').join(args[i]);
        return s;
    };
}

class LiteDOS {
    /**
     * @param {ATRImage} atr 
     */
    constructor(atr) {
        this.atr = atr;
        this.dosType = 'LiteDOS-SE';
        this.initVTOC();
        this.validate();
    }

    /**
     * Detects if an ATR image is LiteDOS
     * @param {ATRImage} atr 
     * @returns {boolean}
     */
    static detect(atr) {
        if (!atr || atr.sectorCount < 368) return false;
        try {
            const vtoc = atr.readSector(360);
            const variant = vtoc[0] & 0xC0;
            // ID bits 7..6: 01 = LiteDOS-SE, 10 = LiteDOS 2.x
            if (variant !== 0x40 && variant !== 0x80) return false;

            // Cluster size is a power of two between 1 and 64 (manual, page 8 table)
            const clusterSize = (vtoc[0] & 0x3F) + 1;
            if (clusterSize > 64 || (clusterSize & (clusterSize - 1)) !== 0) return false;

            const totSectors = vtoc[1] | (vtoc[2] << 8);
            if (totSectors < 16 || totSectors > atr.sectorCount + 10) return false;

            // LiteDOS 2.x writes an ASCII signature right behind the size field.
            // Requiring it keeps arbitrary sector 360 data (SpartaDOS, CP/M) from
            // being taken for a LiteDOS volume.
            if (variant === 0x80) {
                return ATASCII.bytesToString(vtoc.subarray(3, 10), false) === 'LiteDOS';
            }

            // LiteDOS-SE keeps $05..$09 zeroed
            for (let i = 5; i < 10; i++) if (vtoc[i] !== 0) return false;

            return true;
        } catch (e) {
            return false;
        }
    }

    initVTOC() {
        const vtoc = this.atr.readSector(360);
        this.idByte = vtoc[0];
        this.variant = vtoc[0] & 0xC0;
        this.clusterSize = (vtoc[0] & 0x3F) + 1;
        this.totalSectors = vtoc[1] | (vtoc[2] << 8);

        if (this.variant === 0x80) {
            // LiteDOS 2.x: 512-bit bitmap at $20, 24-bit free counter at $71
            this.bitmapOffset = 0x20;
            this.bitmapBytes = 64;
            this.freeOffset = 0x71;
            this.freeWidth = 3;
        } else {
            this.bitmapOffset = 0x0A;
            this.bitmapBytes = (this.atr.getSectorSize(360) >= 256) ? 128 : 118;
            this.freeOffset = 0x03;
            this.freeWidth = 2;
        }

        this.freeSectors = 0;
        for (let i = 0; i < this.freeWidth; i++) {
            this.freeSectors |= (vtoc[this.freeOffset + i] || 0) << (8 * i);
        }

        // Link width follows the disk size only; per file it is taken from the
        // status byte ($46 = 16-bit link, $42 = 10-bit link + file number).
        this.use16BitLink = this.atr.sectorCount > 1024;

        // The VTOC occupies two clusters aligned to a double-cluster boundary and
        // containing sector 360. This reproduces the manual's table exactly:
        // cs 1->360..361, 2->360..363, 4->360..367, 8->352..367, 16->352..383,
        // 32->320..383, 64->256..383.
        this.totalVtocSectors = this.clusterSize * 2;
        this.vtocStart = Math.floor(360 / this.totalVtocSectors) * this.totalVtocSectors;
        this.vtocEnd = this.vtocStart + this.totalVtocSectors - 1;

        this.clusterCount = Math.min(
            this.bitmapBytes * 8,
            Math.ceil((this.totalSectors || this.atr.sectorCount) / this.clusterSize)
        );
    }

    /**
     * @param {number} sector
     * @returns {number} Index of the cluster holding the sector
     */
    clusterOf(sector) {
        return Math.floor(sector / this.clusterSize);
    }

    /**
     * True for boot sectors and for the VTOC / directory double cluster
     * @param {number} sector
     * @returns {boolean}
     */
    isSystemSector(sector) {
        return sector <= 3 || (sector >= this.vtocStart && sector <= this.vtocEnd);
    }

    /**
     * True when any sector of the cluster is a boot or VTOC sector
     * @param {number} cluster
     * @returns {boolean}
     */
    isSystemCluster(cluster) {
        const first = cluster * this.clusterSize;
        const last = first + this.clusterSize - 1;
        return first <= 3 || (last >= this.vtocStart && first <= this.vtocEnd);
    }

    /**
     * Generates directory sector list starting at 361, wrapping inside [vtocStart, vtocEnd]
     * @returns {Array<number>}
     */
    getDirectorySectors() {
        const dirSectors = [];
        let curSec = 361;
        for (let i = 0; i < this.totalVtocSectors - 1; i++) {
            if (curSec > this.vtocEnd) curSec = this.vtocStart;
            if (curSec === 360) {
                curSec++;
                if (curSec > this.vtocEnd) curSec = this.vtocStart;
            }
            if (curSec < 1 || curSec > this.atr.sectorCount) break;

            try {
                const secData = this.atr.readSector(curSec);
                if (this.isDirSector(secData)) {
                    dirSectors.push(curSec);
                } else {
                    break;
                }
            } catch (e) {
                break;
            }
            curSec++;
        }
        return dirSectors;
    }

    isDirSector(secData) {
        if (!secData || secData.length < 16) return false;
        const entriesCnt = Math.min(LITEDOS_DIR_ENTRIES_PER_SECTOR, Math.floor(secData.length / 16));
        for (let i = 0; i < entriesCnt; i++) {
            const off = i * 16;
            const flag = secData[off];
            if (flag === 0x00 || flag === 0x80) continue;
            if ((flag & 0x40) !== 0) {
                const nameBytes = secData.subarray(off + 5, off + 16);
                if (typeof ATASCII !== 'undefined' && ATASCII.checkCharInName) {
                    if (ATASCII.checkCharInName(nameBytes, true) === 0) return false;
                } else {
                    for (let b of nameBytes) {
                        if (b !== 0 && (b < 32 || b > 126)) return false;
                    }
                }
            } else {
                return false;
            }
        }
        return true;
    }

    validate() {
        this.isReadOnly = false;
        this.validationError = null;
        this.validationWarning = null;

        const usedClusters = new Set();
        for (let c = 0; c < this.clusterCount; c++) {
            if (this.isSystemCluster(c)) usedClusters.add(c);
        }

        const files = this.getDirectory();
        for (const file of files) {
            if (file.isValid && !file.isDeleted && file.sectors) {
                file.sectors.forEach(s => usedClusters.add(this.clusterOf(s)));
            }
        }

        // LiteDOS has no DOS.SYS: its 2k kernel lives in the allocated but
        // file-less clusters at the very start of the disk ("In this unavailable
        // space the bootloader is stored", manual page 8). Treat the leading run
        // of allocated, unclaimed clusters as that reserved system area, so a
        // bootable LiteDOS disk is not reported as full of lost sectors.
        this.systemAreaEnd = 0;
        for (let c = 0; c < this.clusterCount; c++) {
            if (this.isSystemCluster(c)) continue;          // boot / VTOC, already reserved
            if (this.isClusterFree(c) || usedClusters.has(c)) break;
            usedClusters.add(c);
            this.systemAreaEnd = (c + 1) * this.clusterSize - 1;
        }

        let freeInBitmap = 0, usedMarkedFree = 0, freeMarkedAllocated = 0;
        for (let c = 0; c < this.clusterCount; c++) {
            const isFree = this.isClusterFree(c);
            if (isFree) freeInBitmap += this.clusterSize;
            if (this.isSystemCluster(c)) continue;
            if (usedClusters.has(c)) {
                if (isFree) usedMarkedFree++;
            } else if (!isFree) {
                freeMarkedAllocated++;
            }
        }

        if (usedMarkedFree > 0) {
            this.isReadOnly = true;
            this.validationError = T("Błędna bitmapa alokacji w LiteDOS: zajęte sektory są oznaczone jako wolne w VTOC. Obraz zamontowano w trybie tylko do odczytu.");
        } else if (this.freeSectors !== freeInBitmap) {
            this.validationWarning = T("Uwaga: licznik wolnych sektorów LiteDOS ({0}) nie zgadza się z bitmapą ({1}).", this.freeSectors, freeInBitmap);
        } else if (freeMarkedAllocated > 0) {
            this.validationWarning = T("Uwaga: bitmapa alokacji w LiteDOS zawiera {0} zagubionych klastrów (oznaczonych jako zajęte, choć żaden plik ich nie używa).", freeMarkedAllocated);
        }
    }

    /**
     * Checks if a sector is marked free in LiteDOS bitmap
     * @param {number} sector 
     * @returns {boolean}
     */
    isClusterFree(cluster) {
        if (cluster < 0 || cluster >= this.clusterCount) return false;

        const rel = cluster >> 3;
        if (rel >= this.bitmapBytes) return false;

        const vtoc = this.atr.readSector(360);
        const byteIdx = this.bitmapOffset + rel;
        if (byteIdx >= vtoc.length) return false;

        return (vtoc[byteIdx] & (0x80 >> (cluster & 7))) !== 0;
    }

    isSectorFree(sector) {
        if (sector < 1 || sector > this.atr.sectorCount) return false;
        return this.isClusterFree(this.clusterOf(sector));
    }

    /**
     * Marks a whole cluster free or used. LiteDOS allocates by cluster, so the
     * free-space counter moves by clusterSize sectors, not by one.
     * @param {number} cluster
     * @param {boolean} free
     */
    setClusterFree(cluster, free) {
        if (cluster < 0 || cluster >= this.clusterCount) return;

        const rel = cluster >> 3;
        if (rel >= this.bitmapBytes) return;

        const vtoc = this.atr.readSector(360);
        const byteIdx = this.bitmapOffset + rel;
        if (byteIdx >= vtoc.length) return;

        const bitMask = 0x80 >> (cluster & 7);
        const wasFree = (vtoc[byteIdx] & bitMask) !== 0;

        if (free) {
            vtoc[byteIdx] |= bitMask;
            if (!wasFree) this.freeSectors += this.clusterSize;
        } else {
            vtoc[byteIdx] &= ~bitMask;
            if (wasFree) this.freeSectors -= this.clusterSize;
        }

        for (let i = 0; i < this.freeWidth; i++) {
            vtoc[this.freeOffset + i] = (this.freeSectors >> (8 * i)) & 0xFF;
        }
        this.atr.writeSector(360, vtoc);
    }

    /**
     * Frees the cluster a sector belongs to
     * @param {number} sector
     * @param {boolean} free
     */
    setSectorFree(sector, free) {
        if (sector < 1 || sector > this.atr.sectorCount) return;
        this.setClusterFree(this.clusterOf(sector), free);
    }

    /**
     * Allocates the next free cluster
     * @returns {number} Cluster index, or -1 when the disk is full
     */
    allocateCluster() {
        for (let c = 0; c < this.clusterCount; c++) {
            if (this.isSystemCluster(c)) continue;
            if (this.isClusterFree(c)) {
                this.setClusterFree(c, false);
                return c;
            }
        }
        return -1;
    }

    /**
     * Allocates a cluster and returns its usable sectors
     * @returns {Array<number>}
     */
    allocateSectors() {
        const cluster = this.allocateCluster();
        if (cluster < 0) return [];

        const sectors = [];
        for (let i = 0; i < this.clusterSize; i++) {
            const s = cluster * this.clusterSize + i;
            if (s >= 1 && s <= this.atr.sectorCount && !this.isSystemSector(s)) sectors.push(s);
        }
        return sectors;
    }

    /**
     * Reads all directory entries
     * @returns {Array<Object>}
     */
    getDirectory() {
        const files = [];
        const dirSectors = this.getDirectorySectors();
        let globalIndex = 0;

        for (const sector of dirSectors) {
            let secData;
            try {
                secData = this.atr.readSector(sector);
            } catch (e) {
                continue;
            }
            const entriesPerSec = Math.min(LITEDOS_DIR_ENTRIES_PER_SECTOR, Math.floor(secData.length / 16));

            for (let entry = 0; entry < entriesPerSec; entry++) {
                const off = entry * 16;
                const flag = secData[off];

                if (flag === 0x00) {
                    globalIndex++;
                    continue;
                }

                const isDeleted = flag === 0x80;
                const isValid = (flag & 0x40) !== 0;
                const sectorCount = secData[off + 1] | (secData[off + 2] << 8);
                const startSector = secData[off + 3] | (secData[off + 4] << 8);
                const nameBytes = secData.subarray(off + 5, off + 13);
                const extBytes = secData.subarray(off + 13, off + 16);

                const name = ATASCII.bytesToString(nameBytes, false).trim();
                const ext = ATASCII.bytesToString(extBytes, false).trim();
                const fullName = ext ? `${name}.${ext}` : name;

                let sectors = [];
                let sizeBytes = 0;

                if (isValid && !isDeleted && startSector >= 1 && startSector <= this.atr.sectorCount) {
                    try {
                        const fileInfo = this.traceFileSectors(startSector, (flag & 0x04) !== 0);
                        sectors = fileInfo.sectors;
                        sizeBytes = fileInfo.sizeBytes;
                    } catch (e) {}
                }

                files.push({
                    dirSector: sector,
                    dirOffset: off,
                    entryIndex: globalIndex,
                    flag,
                    isValid,
                    isDeleted,
                    isLocked: (flag & 0x20) !== 0,
                    isDir: false,
                    sectorCount,
                    startSector,
                    name,
                    ext,
                    fullName,
                    sectors,
                    sizeBytes
                });

                globalIndex++;
            }
        }
        return files;
    }

    /**
     * Traces sector chain of a file
     * @param {number} startSector 
     * @param {boolean} is16BitLink 
     * @returns {Object} { sectors, sizeBytes }
     */
    traceFileSectors(startSector, is16BitLink = false) {
        const sectors = [];
        let sizeBytes = 0;
        let curSec = startSector;
        const visited = new Set();

        while (curSec >= 1 && curSec <= this.atr.sectorCount && !visited.has(curSec)) {
            visited.add(curSec);
            sectors.push(curSec);

            const secData = this.atr.readSector(curSec);
            const secSize = secData.length;
            const payloadSize = secSize - 3;

            const b3 = secData[secSize - 3];
            const b2 = secData[secSize - 2];
            const chunkSize = secData[secSize - 1];

            // 16-bit link on disks above 1024 sectors, otherwise a 10-bit link
            // whose upper 6 bits carry the relative file number
            const nextSec = is16BitLink ? ((b3 << 8) | b2) : (((b3 & 0x03) << 8) | b2);

            sizeBytes += Math.min(chunkSize, payloadSize);

            if (nextSec === 0) break;
            curSec = nextSec;
        }

        return { sectors, sizeBytes };
    }

    /**
     * Reads raw content bytes of a file
     * @param {Object} fileObj 
     * @returns {Uint8Array}
     */
    readFile(fileObj) {
        if (!fileObj.startSector) return new Uint8Array(0);

        const fileInfo = this.traceFileSectors(fileObj.startSector, (fileObj.flag & 0x04) !== 0);

        const result = new Uint8Array(fileInfo.sizeBytes);
        let writeOffset = 0;

        for (const secNum of fileInfo.sectors) {
            const secData = this.atr.readSector(secNum);
            const secSize = secData.length;
            const payloadSize = secSize - 3;
            const chunkSize = Math.min(secData[secSize - 1], payloadSize);

            result.set(secData.subarray(0, chunkSize), writeOffset);
            writeOffset += chunkSize;
        }

        return result;
    }

    /**
     * Imports a file into LiteDOS filesystem
     * @param {string} filename 
     * @param {Uint8Array} fileBytes 
     * @returns {Object}
     */
    importFile(filename, fileBytes) {
        const f83 = ATASCII.formatFilename83(filename);

        const secSize = this.atr.getSectorSize(4);
        const payloadSize = secSize - 3;
        const sectorsNeeded = Math.max(1, Math.ceil(fileBytes.length / payloadSize));
        // Space is handed out in whole clusters
        const clustersNeeded = Math.ceil(sectorsNeeded / this.clusterSize);

        if (clustersNeeded * this.clusterSize > this.freeSectors) {
            throw new Error(T("Brak wolnego miejsca na dysku LiteDOS. Wymagane: {0} sektorów, Dostępne: {1}", clustersNeeded * this.clusterSize, this.freeSectors));
        }

        // Duplicate check
        const nameUpper = f83.fullName.toUpperCase();
        const existingFiles = this.getDirectory();
        for (const file of existingFiles) {
            if (file.isValid && !file.isDeleted && file.fullName.toUpperCase() === nameUpper) {
                throw new Error(T("Plik '{0}' już istnieje na dysku.", f83.fullName));
            }
        }

        // Find available directory slot
        const dirSectors = this.getDirectorySectors();
        let targetSector = 0;
        let targetOff = 0;
        let targetIndex = -1;
        let globalIndex = 0;

        for (const sector of dirSectors) {
            const secData = this.atr.readSector(sector);
            const entriesPerSec = Math.min(LITEDOS_DIR_ENTRIES_PER_SECTOR, Math.floor(secData.length / 16));
            for (let entry = 0; entry < entriesPerSec; entry++) {
                const off = entry * 16;
                const flag = secData[off];
                if (flag === 0x00 || flag === 0x80) {
                    targetSector = sector;
                    targetOff = off;
                    targetIndex = globalIndex;
                    break;
                }
                globalIndex++;
            }
            if (targetIndex !== -1) break;
        }

        if (targetIndex === -1) {
            throw new Error(T("Katalog dysku LiteDOS jest pełny."));
        }

        // Allocate whole clusters until enough sectors are available
        const allocatedSectors = [];
        const allocatedClusters = [];
        while (allocatedSectors.length < sectorsNeeded) {
            const cluster = this.allocateCluster();
            if (cluster < 0) {
                allocatedClusters.forEach(c => this.setClusterFree(c, true));
                throw new Error(T("Nie udało się przydzielić klastrów w LiteDOS."));
            }
            allocatedClusters.push(cluster);
            for (let i = 0; i < this.clusterSize && allocatedSectors.length < sectorsNeeded; i++) {
                const s = cluster * this.clusterSize + i;
                if (s >= 1 && s <= this.atr.sectorCount && !this.isSystemSector(s)) allocatedSectors.push(s);
            }
        }

        // Write sector data
        let readOffset = 0;
        const fileId = targetIndex & 0x3F;
        const is16Bit = this.use16BitLink;

        for (let i = 0; i < sectorsNeeded; i++) {
            const currentSec = allocatedSectors[i];
            const nextSec = (i < sectorsNeeded - 1) ? allocatedSectors[i + 1] : 0;
            const chunkSize = Math.min(payloadSize, fileBytes.length - readOffset);

            const sectorBuf = new Uint8Array(secSize);
            sectorBuf.set(fileBytes.subarray(readOffset, readOffset + chunkSize), 0);
            readOffset += chunkSize;

            if (is16Bit) {
                sectorBuf[secSize - 3] = (nextSec >> 8) & 0xFF;
                sectorBuf[secSize - 2] = nextSec & 0xFF;
            } else {
                sectorBuf[secSize - 3] = ((fileId & 0x3F) << 2) | ((nextSec >> 8) & 0x03);
                sectorBuf[secSize - 2] = nextSec & 0xFF;
            }
            sectorBuf[secSize - 1] = chunkSize;

            this.atr.writeSector(currentSec, sectorBuf);
        }

        // Write directory entry
        const dirSec = this.atr.readSector(targetSector);
        dirSec[targetOff] = is16Bit ? 0x46 : 0x42;
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

    deleteFile(fileObj) {
        if (fileObj.isLocked) {
            throw new Error(T("Plik '{0}' jest zablokowany (Read-Only).", fileObj.fullName));
        }
        if (fileObj.sectors && fileObj.sectors.length > 0) {
            // Free by cluster, since that is the unit LiteDOS allocates in
            const clusters = new Set(fileObj.sectors.map(s => this.clusterOf(s)));
            clusters.forEach(c => { if (!this.isSystemCluster(c)) this.setClusterFree(c, true); });
        }

        const dirSec = this.atr.readSector(fileObj.dirSector);
        dirSec[fileObj.dirOffset] = 0x80;
        this.atr.writeSector(fileObj.dirSector, dirSec);
    }

    renameFile(fileObj, newFilename) {
        const f83 = ATASCII.formatFilename83(newFilename);
        const nameUpper = f83.fullName.toUpperCase();

        const existingFiles = this.getDirectory();
        for (const file of existingFiles) {
            if (file.isValid && !file.isDeleted && file.fullName.toUpperCase() === nameUpper) {
                throw new Error(T("Plik '{0}' już istnieje na dysku.", f83.fullName));
            }
        }

        const dirSec = this.atr.readSector(fileObj.dirSector);
        dirSec.set(f83.atasciiName, fileObj.dirOffset + 5);
        this.atr.writeSector(fileObj.dirSector, dirSec);
    }

    setAttributes(fileObj, attrs = {}) {
        const dirSec = this.atr.readSector(fileObj.dirSector);
        let flag = dirSec[fileObj.dirOffset];
        if (attrs.isLocked !== undefined) {
            if (attrs.isLocked) flag |= 0x20;
            else flag &= ~0x20;
        }
        dirSec[fileObj.dirOffset] = flag;
        this.atr.writeSector(fileObj.dirSector, dirSec);
    }

    /**
     * Formats disk under LiteDOS-SE
     * @param {ATRImage} atr 
     * @param {number} [clusterSize=1] 
     * @returns {LiteDOS}
     */
    static formatDisk(atr, clusterSize = 1) {
        const sectorCount = atr.sectorCount;
        const isDD = atr.isDD;
        const secSize = isDD ? 256 : 128;

        // Round the cluster size up to a power of two in 1..64 (manual, page 8)
        let cSize = 1;
        while (cSize < Math.max(1, Math.min(64, clusterSize))) cSize *= 2;

        // The VTOC is two clusters, aligned to a double-cluster boundary and
        // containing sector 360
        const totalVtocSectors = cSize * 2;
        const vtocStart = Math.floor(360 / totalVtocSectors) * totalVtocSectors;
        const vtocEnd = vtocStart + totalVtocSectors - 1;

        // LiteDOS-SE keeps the bitmap in bytes $0A..$7F (SD) or $0A..$89 (DD)
        const bitmapBytes = isDD ? 128 : 118;
        const clusterCount = Math.ceil(sectorCount / cSize);
        if (clusterCount > bitmapBytes * 8) {
            throw new Error(T("Rozmiar klastra {0} jest za mały dla {1} sektorów: bitmapa LiteDOS mieści {2} klastrów.", cSize, sectorCount, bitmapBytes * 8));
        }

        // Clear VTOC & Directory sectors
        const emptySec = new Uint8Array(secSize);
        for (let s = vtocStart; s <= vtocEnd; s++) {
            if (s >= 1 && s <= sectorCount) {
                atr.writeSector(s, emptySec);
            }
        }

        // Initialize VTOC Sector 360. ID bits 7..6 are "01" for LiteDOS-SE; the
        // "10" variant carries a different header that this writer does not emit.
        const vtoc = new Uint8Array(secSize);
        vtoc[0] = 0x40 | ((cSize - 1) & 0x3F);
        vtoc[1] = sectorCount & 0xFF;
        vtoc[2] = (sectorCount >> 8) & 0xFF;

        // Mark every cluster free (1) except the boot and VTOC clusters
        let freeSectors = 0;
        for (let c = 0; c < clusterCount; c++) {
            const first = c * cSize;
            const last = first + cSize - 1;
            if (first <= 3 || (last >= vtocStart && first <= vtocEnd)) continue;
            vtoc[10 + (c >> 3)] |= 0x80 >> (c & 7);
            freeSectors += cSize;
        }
        vtoc[3] = freeSectors & 0xFF;
        vtoc[4] = (freeSectors >> 8) & 0xFF;
        atr.writeSector(360, vtoc);

        return new LiteDOS(atr);
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = LiteDOS;
}
