/*
 * ATRaction - Atari 8-bit ATR/XFD disk image manager
 * Copyright (C) 2026 dely / blowjobb / ng
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
 * Minimal ZIP writer for bulk export.
 *
 * Everything is stored uncompressed (method 0). A whole Atari disk holds at
 * most ~360 KB, so deflate would buy nothing worth an extra dependency or the
 * asynchronous API that CompressionStream would force on the caller.
 *
 * Written: local file header, central directory, end-of-central-directory.
 * Left out deliberately: data descriptors (sizes are known up front), Zip64
 * (no Atari disk comes close to 4 GB) and encryption.
 */

class ZipWriter {

    constructor() {
        /** @type {Array<Object>} */
        this.entries = [];
    }

    /**
     * CRC-32 lookup table (IEEE polynomial), built once on first use.
     * @returns {Uint32Array}
     */
    static crcTable() {
        if (!ZipWriter._crcTable) {
            const table = new Uint32Array(256);
            for (let n = 0; n < 256; n++) {
                let c = n;
                for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
                table[n] = c >>> 0;
            }
            ZipWriter._crcTable = table;
        }
        return ZipWriter._crcTable;
    }

    /**
     * @param {Uint8Array} bytes
     * @returns {number} CRC-32 as an unsigned 32-bit value
     */
    static crc32(bytes) {
        const table = ZipWriter.crcTable();
        let c = 0xFFFFFFFF;
        for (let i = 0; i < bytes.length; i++) c = table[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
        return (c ^ 0xFFFFFFFF) >>> 0;
    }

    /**
     * Makes one Atari filename safe as a single path segment on the host.
     *
     * A slash matters most: an Atari directory entry may hold any byte, and a
     * name like "A/B" would fabricate a directory level inside the archive that
     * does not exist on the disk. The rest is what Windows refuses in a path.
     *
     * @param {string} name
     * @returns {string}
     */
    static sanitizeSegment(name) {
        let s = String(name === undefined || name === null ? '' : name);
        s = s.replace(/[\x00-\x1F\x7F]/g, '_');   // control characters
        s = s.replace(/[\\/:*?"<>|]/g, '_');      // reserved in Windows paths
        s = s.replace(/[. ]+$/, '');              // Windows drops these silently
        // Device names are reserved whatever the extension is, so CON.TXT is
        // just as unusable as CON when the archive is unpacked on Windows.
        if (/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\..*)?$/i.test(s)) s = '_' + s;
        return s === '' ? '_' : s;
    }

    /**
     * Converts a SpartaDOS date string to the MS-DOS date word used by ZIP.
     * Other filesystems carry no timestamp, so their entries land on the epoch
     * ZIP itself starts at.
     *
     * @param {string} [dateStr] Date as `DD/MM/YY`, as SpartaDOS reports it
     * @returns {{date: number, time: number}}
     */
    static dosDateTime(dateStr) {
        let year = 1980, month = 1, day = 1;
        const m = /^(\d{2})\/(\d{2})\/(\d{2})$/.exec(String(dateStr || ''));
        if (m) {
            const dd = +m[1], mm = +m[2], yy = +m[3];
            // Two-digit year: the Atari era opens in 1979, so 79-99 is the 20th
            // century and 00-78 the 21st. ZIP cannot express anything earlier
            // than 1980, which is exactly where the fallback sits.
            const full = yy >= 79 ? 1900 + yy : 2000 + yy;
            if (dd >= 1 && dd <= 31 && mm >= 1 && mm <= 12 && full >= 1980 && full <= 2107) {
                year = full; month = mm; day = dd;
            }
        }
        // SDFS stores a time too, but the directory reader does not expose it,
        // so every entry sits at midnight.
        return { date: ((year - 1980) << 9) | (month << 5) | day, time: 0 };
    }

    /**
     * @param {string} path Full path inside the archive, '/' separated
     * @param {Uint8Array} bytes
     * @param {string} [dateStr]
     */
    addFile(path, bytes, dateStr) {
        const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || 0);
        const stamp = ZipWriter.dosDateTime(dateStr);
        this.entries.push({
            name: path,
            data: data,
            crc: ZipWriter.crc32(data),
            date: stamp.date,
            time: stamp.time,
            isDir: false
        });
    }

    /**
     * Records a directory. Only needed to keep empty ones - a directory that
     * holds files is implied by their paths.
     * @param {string} path
     * @param {string} [dateStr]
     */
    addDirectory(path, dateStr) {
        const name = path.endsWith('/') ? path : path + '/';
        const stamp = ZipWriter.dosDateTime(dateStr);
        this.entries.push({
            name: name,
            data: new Uint8Array(0),
            crc: 0,
            date: stamp.date,
            time: stamp.time,
            isDir: true
        });
    }

    /**
     * @returns {number} How many entries the archive holds
     */
    get length() {
        return this.entries.length;
    }

    /**
     * Assembles the archive.
     * @returns {Uint8Array}
     */
    build() {
        const encoder = new TextEncoder();
        const named = this.entries.map(e => Object.assign({}, e, { nameBytes: encoder.encode(e.name) }));

        let localSize = 0, centralSize = 0;
        for (const e of named) {
            localSize += 30 + e.nameBytes.length + e.data.length;
            centralSize += 46 + e.nameBytes.length;
        }

        const out = new Uint8Array(localSize + centralSize + 22);
        const view = new DataView(out.buffer);
        let pos = 0;

        for (const e of named) {
            e.offset = pos;
            view.setUint32(pos, 0x04034B50, true);          // local file header
            view.setUint16(pos + 4, 20, true);              // version needed
            view.setUint16(pos + 6, 0x0800, true);          // flags: UTF-8 names
            view.setUint16(pos + 8, 0, true);               // method: stored
            view.setUint16(pos + 10, e.time, true);
            view.setUint16(pos + 12, e.date, true);
            view.setUint32(pos + 14, e.crc, true);
            view.setUint32(pos + 18, e.data.length, true);  // compressed size
            view.setUint32(pos + 22, e.data.length, true);  // uncompressed size
            view.setUint16(pos + 26, e.nameBytes.length, true);
            view.setUint16(pos + 28, 0, true);              // extra field length
            pos += 30;
            out.set(e.nameBytes, pos); pos += e.nameBytes.length;
            out.set(e.data, pos); pos += e.data.length;
        }

        const centralStart = pos;
        for (const e of named) {
            view.setUint32(pos, 0x02014B50, true);          // central directory header
            view.setUint16(pos + 4, 20, true);              // version made by
            view.setUint16(pos + 6, 20, true);              // version needed
            view.setUint16(pos + 8, 0x0800, true);
            view.setUint16(pos + 10, 0, true);
            view.setUint16(pos + 12, e.time, true);
            view.setUint16(pos + 14, e.date, true);
            view.setUint32(pos + 16, e.crc, true);
            view.setUint32(pos + 20, e.data.length, true);
            view.setUint32(pos + 24, e.data.length, true);
            view.setUint16(pos + 28, e.nameBytes.length, true);
            view.setUint16(pos + 30, 0, true);              // extra field length
            view.setUint16(pos + 32, 0, true);              // comment length
            view.setUint16(pos + 34, 0, true);              // disk number start
            view.setUint16(pos + 36, 0, true);              // internal attributes
            view.setUint32(pos + 38, e.isDir ? 0x10 : 0, true); // MS-DOS directory bit
            view.setUint32(pos + 42, e.offset, true);
            pos += 46;
            out.set(e.nameBytes, pos); pos += e.nameBytes.length;
        }

        view.setUint32(pos, 0x06054B50, true);              // end of central directory
        view.setUint16(pos + 4, 0, true);                   // this disk
        view.setUint16(pos + 6, 0, true);                   // disk with central directory
        view.setUint16(pos + 8, named.length, true);
        view.setUint16(pos + 10, named.length, true);
        view.setUint32(pos + 12, centralSize, true);
        view.setUint32(pos + 16, centralStart, true);
        view.setUint16(pos + 20, 0, true);                  // archive comment length

        return out;
    }
}
