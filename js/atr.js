/*
 * ATRaction - Atari 8-bit ATR/XFD disk image manager
 * Copyright (C) 2026 dely / blowjobb / ng
 *
 * Contains work derived from the Altirra emulator by Avery Lee, licensed
 * GPL-2.0-or-later:
 *   Altirra/source/uidisk.cpp  Copyright (C) 2009-2010 Avery Lee
 *
 * Derived here: custom disk geometry rules mirroring the Custom option of the
 *   Create New Disk dialog (boot sector count, sector size, free sector count).
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
 * Low-Level ATR Image Parser and Writer
 * Manages 16-byte ATR headers, sector geometry, reading/writing raw sectors,
 * and creating blank ATR images for SD, ED, DD, QD, and custom sizes.
 */

// Falls back to a plain, un-translated (Polish) template substitution when
// the i18n layer (js/i18n.js) has not been loaded - e.g. the Node test
// harness, which evals this file directly without loading i18n.js first.
if (typeof T === 'undefined') {
    globalThis.T = function (text) {
        var args = Array.prototype.slice.call(arguments, 1);
        var s = text;
        for (var i = 0; i < args.length; i++) s = s.split('{' + i + '}').join(args[i]);
        return s;
    };
}

class ATRImage {
    /**
     * @param {Uint8Array} buffer Raw ATR file data
     */
    constructor(buffer) {
        if (!buffer || buffer.length < 16) {
            throw new Error(T("Nieprawidłowe dane ATR: Rozmiar pliku wynosi mniej niż 16 bajtów."));
        }
        this.data = new Uint8Array(buffer);
        this.parseHeader();
    }

    parseHeader() {
        const magic = this.data[0] | (this.data[1] << 8);
        if (magic !== 0x0296) {
            if (this.data.length > 0 && this.data.length % 128 === 0) {
                this.isXFD = true;
                const len = this.data.length;
                const sectorSize = (len === 184320 || len === 368640 || len === 737280 || (len >= 180000 && len % 256 === 0)) ? 256 : 128;
                const pars = Math.floor(len / 16);
                const newData = new Uint8Array(16 + len);
                newData[0] = 0x96;
                newData[1] = 0x02;
                newData[2] = pars & 0xFF;
                newData[3] = (pars >> 8) & 0xFF;
                newData[4] = sectorSize & 0xFF;
                newData[5] = (sectorSize >> 8) & 0xFF;
                newData[6] = (pars >> 16) & 0xFF;
                newData[7] = (pars >> 24) & 0xFF;
                newData.set(this.data, 16);
                this.data = newData;
            } else {
                throw new Error(T("Nieprawidłowy nagłówek magiczny ATR/XFD: 0x{0}. Oczekiwano 0x0296 (lub pliku XFD).", magic.toString(16)));
            }
        } else {
            this.isXFD = false;
        }

        // Paragraph count (16 bytes per paragraph)
        const lowPars = this.data[2] | (this.data[3] << 8);
        const highPars = this.data[6] | (this.data[7] << 8);
        this.paragraphs = lowPars | (highPars << 16);
        this.imageSize = this.paragraphs * 16;

        // Sector size from header (128, 256 or 512)
        this.headerSectorSize = this.data[4] | (this.data[5] << 8);
        this.writeProtected = (this.data[8] & 0x01) !== 0;

        // ATR has no field for the boot sector count, images with sectors up to
        // 256 bytes keep three 128-byte boot sectors, larger ones have none.
        if (this.bootSectorCount === undefined) {
            this.bootSectorCount = (this.headerSectorSize <= 256) ? 3 : 0;
        }

        // Determine total sectors and density
        this.calculateGeometry();
    }

    calculateGeometry() {
        // Reset custom density flag on each call (may be re-called after isXFD is set)
        this.isCustomDensity = false;
        const totalPayloadBytes = this.data.length - 16;

        this.sectorSize = this.headerSectorSize;
        this.isDD = this.sectorSize >= 256;

        // Number of leading sectors stored as 128 bytes. Only meaningful when
        // the data sectors are larger than that.
        const shortBoot = this.shortBootSectors();

        if (this.isXFD) {
            this.sectorCount = Math.floor(totalPayloadBytes / this.sectorSize);
        } else {
            this.sectorCount = shortBoot + Math.floor((totalPayloadBytes - shortBoot * 128) / this.sectorSize);
        }

        // Calculate expected standard total file size (16B header + sectors payload)
        const expectedPayload = this.isXFD
            ? this.sectorCount * this.sectorSize
            : shortBoot * 128 + Math.max(0, this.sectorCount - shortBoot) * this.sectorSize;
        this.expectedTotalSize = 16 + expectedPayload;
        this.actualFileSize = this.data.length;
        this.headerReportedSize = 16 + (this.paragraphs * 16);

        // Two independent defects that used to share one flag, although they mean
        // different things:
        //  - the 16-byte header declares a payload the file does not contain, i.e.
        //    a truncated or padded dump. Nothing on such an image can be trusted,
        //    so the caller mounts it read-only. XFD has no header of its own (the
        //    one above is synthesised here, and convertToXFD() re-lays the payload
        //    without touching it), so the test only applies to real ATR files.
        //  - the payload is not a whole number of sectors: stray tail bytes.
        this.hasHeaderSizeMismatch = !this.isXFD && (this.headerReportedSize !== this.actualFileSize);
        this.hasSizeMismatch = (this.actualFileSize !== this.expectedTotalSize);

        // Identify density label
        if (!this.isDD && this.sectorCount === 720) {
            this.density = 'SS/SD (90 KB)';
            this.densityType = 'SD';
        } else if (!this.isDD && this.sectorCount === 1040) {
            this.density = 'SS/MD (130 KB)';
            this.densityType = 'ED';
        } else if (this.isDD && this.sectorCount === 720) {
            this.density = 'SS/DD (180 KB)';
            this.densityType = 'DD';
        } else if (this.isDD && this.sectorCount === 1440) {
            this.density = 'DS/DD (368 KB)';
            this.densityType = 'QD';
        } else if (this.isDD && this.sectorCount === 2880) {
            this.density = 'DS/QD (720 KB)';
            this.densityType = 'DSDD';
        } else {
            this.density = T('Custom ({0} Sektorów, {1}B)', this.sectorCount, this.sectorSize);
            this.densityType = 'CUSTOM';
            this.isCustomDensity = true;
        }
    }

    /**
     * Number of leading sectors physically stored as 128 bytes
     * @returns {number}
     */
    shortBootSectors() {
        if (this.isXFD || this.sectorSize <= 128) return 0;
        return this.bootSectorCount || 0;
    }

    /**
     * Gets byte offset of a 1-based sector in the ATR Uint8Array
     * @param {number} sector Sector number (1..sectorCount)
     * @returns {number} Byte offset
     */
    getSectorOffset(sector) {
        if (sector < 1 || sector > this.sectorCount) {
            throw new Error(T("Sektor poza zakresem: {0} (Dopuszczalne: 1..{1})", sector, this.sectorCount));
        }

        if (this.isXFD) return 16 + (sector - 1) * this.sectorSize;

        const shortBoot = this.shortBootSectors();
        if (sector <= shortBoot) return 16 + (sector - 1) * 128;
        return 16 + shortBoot * 128 + (sector - 1 - shortBoot) * this.sectorSize;
    }

    /**
     * Gets byte size of a 1-based sector
     * @param {number} sector Sector number (1..sectorCount)
     * @returns {number} Sector size in bytes
     */
    getSectorSize(sector) {
        if (this.isXFD) return this.sectorSize;
        return (sector <= this.shortBootSectors()) ? 128 : this.sectorSize;
    }

    /**
     * Reads raw bytes from a sector
     * @param {number} sector Sector number (1..sectorCount)
     * @returns {Uint8Array} Sector data
     */
    readSector(sector) {
        const offset = this.getSectorOffset(sector);
        const size = this.getSectorSize(sector);
        return this.data.subarray(offset, offset + size);
    }

    /**
     * Writes raw bytes to a sector
     * @param {number} sector Sector number (1..sectorCount)
     * @param {Uint8Array} bytes Data to write
     * @param {number} [offsetWithinSector=0]
     */
    writeSector(sector, bytes, offsetWithinSector = 0) {
        const offset = this.getSectorOffset(sector) + offsetWithinSector;
        const maxWrite = this.getSectorSize(sector) - offsetWithinSector;
        const count = Math.min(bytes.length, maxWrite);
        this.data.set(bytes.subarray(0, count), offset);
    }

    /**
     * Converts an ATR image to XFD layout in memory (all sectors 256B for DD)
     */
    convertToXFD() {
        if (this.isXFD) {
            this.calculateGeometry();
            return;
        }

        const shortBoot = this.shortBootSectors();
        if (shortBoot === 0) {
            // Every sector already has the same size - nothing to move
            this.isXFD = true;
            this.calculateGeometry();
            return;
        }

        // Re-lay the image with uniform sector size, keeping logical sectors intact
        const sectorCount = this.sectorCount;
        const sectorSize = this.sectorSize;
        const newData = new Uint8Array(16 + sectorCount * sectorSize);
        newData.set(this.data.subarray(0, 16), 0);
        for (let s = 1; s <= sectorCount; s++) {
            const src = this.readSector(s);
            newData.set(src, 16 + (s - 1) * sectorSize);
        }

        this.data = newData;
        this.isXFD = true;
        this.calculateGeometry();
    }

    /**
     * Exports the Uint8Array representing the current state of the ATR file
     * @returns {Uint8Array}
     */
    export() {
        if (this.isXFD) {
            this.convertToXFD();
            return new Uint8Array(this.data.subarray(16));
        }
        // Update ATR Header paragraph count
        const totalPars = Math.floor((this.data.length - 16) / 16);
        this.data[2] = totalPars & 0xFF;
        this.data[3] = (totalPars >> 8) & 0xFF;
        this.data[6] = (totalPars >> 16) & 0xFF;
        this.data[7] = (totalPars >> 24) & 0xFF;
        return new Uint8Array(this.data);
    }

    /**
     * Factory function to create a new blank ATR disk image
     * @param {'SD'|'ED'|'DD'|'QD'} density Density type
     * @param {number} [customSectorCount] Custom sectors if density is CUSTOM
     * @param {number} [customSectorSize=128] Custom sector size (128 or 256)
     * @param {boolean} [isXFD=false] Whether this image should be an XFD image
     * @returns {ATRImage}
     */
    static createNew(density, customSectorCount = 0, customSectorSize = 128, isXFD = false, customBootSectorCount = 3) {
        let sectorCount = 720;
        let sectorSize = 128;
        let isDD = false;
        let bootSectorCount = 3;

        switch (density) {
            case 'SD':
                sectorCount = 720;
                sectorSize = 128;
                isDD = false;
                break;
            case 'ED':
                sectorCount = 1040;
                sectorSize = 128;
                isDD = false;
                break;
            case 'DD':
                sectorCount = 720;
                sectorSize = 256;
                isDD = true;
                break;
            case 'QD':
                sectorCount = 1440;
                sectorSize = 256;
                isDD = true;
                break;
            case 'DSDD':
            case '720K':
                sectorCount = 2880;
                sectorSize = 256;
                isDD = true;
                break;
            case 'CUSTOM':
                sectorCount = customSectorCount || 720;
                sectorSize = (customSectorSize === 512 || customSectorSize === 256) ? customSectorSize : 128;
                isDD = sectorSize >= 256;
                // 512-byte sectors leave no room for short boot sectors
                bootSectorCount = sectorSize > 256 ? 0 : customBootSectorCount;
                break;
            default:
                sectorCount = 720;
                sectorSize = 128;
                isDD = false;
        }

        bootSectorCount = Math.max(0, Math.min(bootSectorCount, sectorCount));

        // Calculate total payload size
        const shortBoot = (isXFD || sectorSize <= 128) ? 0 : bootSectorCount;
        const payloadSize = isXFD
            ? sectorCount * sectorSize
            : shortBoot * 128 + (sectorCount - shortBoot) * sectorSize;

        const totalFileSize = 16 + payloadSize;
        const data = new Uint8Array(totalFileSize);

        // 16-byte ATR Header
        data[0] = 0x96;
        data[1] = 0x02;

        const totalPars = Math.floor(payloadSize / 16);
        data[2] = totalPars & 0xFF;
        data[3] = (totalPars >> 8) & 0xFF;
        data[4] = sectorSize & 0xFF;
        data[5] = (sectorSize >> 8) & 0xFF;
        data[6] = (totalPars >> 16) & 0xFF;
        data[7] = (totalPars >> 24) & 0xFF;

        const img = new ATRImage(data);
        img.bootSectorCount = bootSectorCount;
        if (isXFD) img.isXFD = true;
        img.calculateGeometry();
        return img;
    }
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = ATRImage;
}
