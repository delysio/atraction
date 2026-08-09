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
 * ATASCII (Atari ASCII) Character Converter & Utility Module
 * Supports conversion between ATASCII bytes, Unicode characters, and Canvas font rendering.
 */

const ATASCII = (function() {
    // ATASCII control & graphics characters ($00-$1F) mapped to Unicode symbols
    const atasciiToUnicodeMap = [
        '\u2665', '\u2510', '\u250C', '\u2518', '\u2514', '\u253C', '\u2550', '\u255E',
        '\u2557', '\u255D', '\u2554', '\u255A', '\u2560', '\u2569', '\u2566', '\u2563',
        '\u2551', '\u2580', '\u2584', '\u258C', '\u2590', '\u2591', '\u2592', '\u2593',
        '\u2594', '\u2595', '\u2596', '\u2597', '\u2598', '\u2599', '\u259A', '\u259B'
    ];

    /**
     * Converts a single ATASCII byte to a displayable Unicode character
     * @param {number} b Byte (0-255)
     * @returns {string} Single character string
     */
    function byteToChar(b) {
        b = b & 0xFF;
        if (b === 0x9B) return '\n'; // Atari EOL
        if (b === 0x7F) return '\u2590'; // Tab key / graphics symbol
        if (b === 0x9D) return ' '; // Clear screen character
        
        let c = b & 0x7F; // strip inverse bit for base char lookup
        if (c < 32) {
            return atasciiToUnicodeMap[c] || '.';
        }
        return String.fromCharCode(c);
    }

    /**
     * Converts a Uint8Array of ATASCII bytes to a UTF-8 text string
     * @param {Uint8Array} bytes
     * @param {boolean} convertEOL If true, translates $9B (155) to \n
     * @returns {string}
     */
    function bytesToString(bytes, convertEOL = true) {
        let str = '';
        for (let i = 0; i < bytes.length; i++) {
            const b = bytes[i];
            if (b === 0x9B && convertEOL) {
                str += '\n';
            } else if (b >= 32 && b <= 126) {
                str += String.fromCharCode(b);
            } else if (b < 32) {
                str += atasciiToUnicodeMap[b] || '.';
            } else {
                // High ATASCII / Inverse
                const base = b & 0x7F;
                if (base >= 32 && base <= 126) {
                    str += String.fromCharCode(base);
                } else if (base < 32) {
                    str += atasciiToUnicodeMap[base] || '.';
                } else {
                    str += '.';
                }
            }
        }
        return str;
    }

    /**
     * Converts an ASCII/UTF-8 string into ATASCII bytes
     * @param {string} str
     * @param {boolean} convertEOL If true, converts \n and \r\n to $9B
     * @returns {Uint8Array}
     */
    function stringToBytes(str, convertEOL = true) {
        const result = [];
        for (let i = 0; i < str.length; i++) {
            const ch = str.charAt(i);
            const code = str.charCodeAt(i);

            if (ch === '\r') {
                if (i + 1 < str.length && str.charAt(i + 1) === '\n') {
                    if (convertEOL) {
                        result.push(0x9B);
                        i++; // skip \n
                    }
                } else if (convertEOL) {
                    result.push(0x9B);
                }
            } else if (ch === '\n') {
                if (convertEOL) {
                    result.push(0x9B);
                } else {
                    result.push(0x0A);
                }
            } else if (code >= 32 && code <= 126) {
                result.push(code);
            } else {
                // Try reverse mapping or fallback to space/question
                result.push(code <= 255 ? code : 0x3F);
            }
        }
        return new Uint8Array(result);
    }

    /**
     * Sanitizes and parses a filename into valid Atari 8.3 format (8 chars name, 3 chars ext)
     * @param {string} rawName 
     * @returns {{name: string, ext: string, fullName: string, atasciiName: Uint8Array}}
     */
    function formatFilename83(rawName) {
        let namePart = '';
        let extPart = '';

        // Strip path if present
        const basename = rawName.split(/[/\\]/).pop().toUpperCase().trim();
        const dotIdx = basename.lastIndexOf('.');

        if (dotIdx !== -1) {
            namePart = basename.substring(0, dotIdx);
            extPart = basename.substring(dotIdx + 1);
        } else {
            namePart = basename;
        }

        // Clean characters: A-Z, 0-9, underline, hyphens, and @ allowed in Atari DOS / MyDOS
        namePart = namePart.replace(/[^A-Z0-9_\-@]/g, '').substring(0, 8);
        extPart = extPart.replace(/[^A-Z0-9_\-@]/g, '').substring(0, 3);

        // In MyDOS/Atari DOS specifications, the first character of filename may not be a number
        if (/^[0-9]/.test(namePart)) {
            namePart = ('F' + namePart).substring(0, 8);
        }

        if (!namePart) namePart = 'UNNAMED';

        // Pad name with spaces to 8 chars and ext to 3 chars for directory storage
        const paddedName = namePart.padEnd(8, ' ');
        const paddedExt = extPart.padEnd(3, ' ');

        const fullName = extPart ? `${namePart}.${extPart}` : namePart;

        // Build 11-byte ATASCII name array
        const atasciiName = new Uint8Array(11);
        for (let i = 0; i < 8; i++) {
            atasciiName[i] = paddedName.charCodeAt(i);
        }
        for (let i = 0; i < 3; i++) {
            atasciiName[8 + i] = paddedExt.charCodeAt(i);
        }

        return {
            name: namePart,
            ext: extPart,
            paddedName: paddedName,
            paddedExt: paddedExt,
            fullName: fullName,
            atasciiName: atasciiName
        };
    }

    /**
     * Checks if a filename (up to 11 raw ATASCII bytes) is valid according to Atari DOS / MyDOS rules.
     * @param {Uint8Array} d Array of filename and extension bytes
     * @param {boolean} md True if checking for MyDOS or DOS >= 7 (allows '@' and '_')
     * @returns {number} 1 if valid DOS name, -1 if non-standard DOS name, 0 if invalid (unprintable/ctrl chars)
     */
    function checkCharInName(d, md) {
        let len = d.length;
        let isIC = false;
        let isND = false;
        let firstLT = false;
        while (len-- > 0) {
            if (len === 7 || len === 10) firstLT = false;
            if (d[len] & 0x80) isIC = true;
            const c = d[len] & 0x7F;
            if (c < 0x20 || c >= 0x7D) return 0;
            if (c !== 0x20) {
                firstLT = true;
            } else {
                if (firstLT) isND = true;
                continue;
            }
            if (!(c >= 0x30 && c <= 0x39) && !(c >= 0x41 && c <= 0x5A) && !(c >= 0x61 && c <= 0x7A)) {
                if (!((c === 0x40 || c === 0x5F) && md)) {
                    isND = true;
                }
            }
            if (len === 0 && (c === 0x20 || (c >= 0x30 && c <= 0x39))) {
                isND = true;
            }
        }
        return (!isIC && !isND && firstLT ? 1 : -1);
    }

    /**
     * Converts raw ATASCII bytes into Unicode characters mapped to Atari WOFF font (0xE000 range)
     * All 256 ATASCII character & semigraphics glyphs (0x00 - 0xFF) are mapped to 0xE000 + b.
     * @param {Uint8Array} bytes
     * @returns {string}
     */
    function bytesToAtariFontString(bytes) {
        let str = '';
        for (let i = 0; i < bytes.length; i++) {
            const b = bytes[i];
            if (b === 0x9B) {
                str += '\n'; // EOL newline
            } else {
                str += String.fromCharCode((b & 0xFF) + 0xE000);
            }
        }
        return str;
    }

    return {
        byteToChar,
        bytesToString,
        bytesToAtariFontString,
        stringToBytes,
        formatFilename83,
        checkCharInName
    };
})();

if (typeof module !== 'undefined' && module.exports) {
    module.exports = ATASCII;
}

