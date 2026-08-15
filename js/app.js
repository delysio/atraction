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
 * Atari 8-bit ATR Disk Manager UI Controller
 * Manages DOM events, Drag and Drop, File Table rendering, Modal dialogs,
 * Previews (ATASCII text & Hex Viewer), and Disk operations.
 */

document.addEventListener('DOMContentLoaded', () => {
    const diskManager = new DiskManager();
    let currentFiles = [];
    let selectedFileObj = null;
    let activeDirPath = '';

    // Checkbox marks, kept apart from selectedFileObj: that one still drives
    // rename, delete and preview, which act on exactly one entry.
    //
    // getDirectory() rebuilds its file objects on every call, so a mark cannot
    // hold a reference - the key is the name within the directory it was made
    // in. Marks survive re-renders (the search box re-renders on every
    // keystroke) and are dropped when the listing itself changes underneath.
    const markedFiles = new Set();
    const markKey = (file) => `${activeDirPath}|${file.fullName}`;

    function clearMarks() {
        markedFiles.clear();
    }

    /**
     * Marked entries of the current view, in the order they are listed.
     * @returns {Array<Object>}
     */
    function getMarkedFiles() {
        return currentFiles.filter(f => markedFiles.has(markKey(f)));
    }

    /**
     * Drives the header checkbox from the marks of the current view: ticked
     * when every visible entry is marked, indeterminate when only some are.
     */
    function syncSelectAllCheckbox() {
        if (!chkSelectAll) return;
        const visible = currentFiles.length;
        const marked = getMarkedFiles().length;
        chkSelectAll.disabled = visible === 0;
        chkSelectAll.checked = visible > 0 && marked === visible;
        chkSelectAll.indeterminate = marked > 0 && marked < visible;
    }

    // DOM Elements
    const btnNewDisk = document.getElementById('btnNewDisk');
    const btnOpenDisk = document.getElementById('btnOpenDisk');
    const btnSaveDisk = document.getElementById('btnSaveDisk');
    const btnFormatDisk = document.getElementById('btnFormatDisk');
    const btnManual = document.getElementById('btnManual');
    const modalManual = document.getElementById('modalManual');

    const btnAddFile = document.getElementById('btnAddFile');
    const btnCreateDir = document.getElementById('btnCreateDir');
    const btnExtractFile = document.getElementById('btnExtractFile');
    const btnExtractSelected = document.getElementById('btnExtractSelected');
    const btnRenameFile = document.getElementById('btnRenameFile');
    const btnToggleLock = document.getElementById('btnToggleLock');
    const btnEditAttributes = document.getElementById('btnEditAttributes');
    const btnDeleteFile = document.getElementById('btnDeleteFile');
    const btnPreviewFile = document.getElementById('btnPreviewFile');
    const btnDirAtascii = document.getElementById('btnDirAtascii');

    // Modal Attributes Elements
    const modalAttributes = document.getElementById('modalAttributes');
    const attrFileNameLabel = document.getElementById('attrFileNameLabel');
    const attrMixedHint = document.getElementById('attrMixedHint');
    const attrRowHidden = document.getElementById('attrRowHidden');
    const attrRowArchive = document.getElementById('attrRowArchive');
    const chkAttrProtect = document.getElementById('chkAttrProtect');
    const chkAttrHidden = document.getElementById('chkAttrHidden');
    const chkAttrArchive = document.getElementById('chkAttrArchive');
    const btnSaveAttributesConfirm = document.getElementById('btnSaveAttributesConfirm');

    // Modal ATASCII Directory View Elements
    const modalDirAtascii = document.getElementById('modalDirAtascii');
    const dirAtasciiFormatted = document.getElementById('dirAtasciiFormatted');

    const searchInput = document.getElementById('searchInput');
    const chkSelectAll = document.getElementById('chkSelectAll');
    const fileTableBody = document.getElementById('fileTableBody');
    const emptyState = document.getElementById('emptyState');
    const dirTree = document.getElementById('dirTree');
    const dropZone = document.getElementById('dropZone');
    const dropOverlay = document.getElementById('dropOverlay');

    const fileInputATR = document.getElementById('fileInputATR');
    const fileInputImport = document.getElementById('fileInputImport');

    // Stats & Badges
    const currentDiskBadge = document.getElementById('currentDiskBadge');
    const activeDiskContainer = document.getElementById('activeDiskContainer');
    const dosBadge = document.getElementById('dosBadge');
    const metricDensity = document.getElementById('metricDensity');
    const metricSectors = document.getElementById('metricSectors');
    const metricFreeSectors = document.getElementById('metricFreeSectors');
    const metricFreeBytes = document.getElementById('metricFreeBytes');
    const diskProgressFill = document.getElementById('diskProgressFill');
    const statusLeft = document.getElementById('statusLeft');

    // Modals
    const modalNewDisk = document.getElementById('modalNewDisk');
    const btnCreateDiskConfirm = document.getElementById('btnCreateDiskConfirm');
    const newDiskDensity = document.getElementById('newDiskDensity');
    const newDiskDOS = document.getElementById('newDiskDOS');

    const modalCreateDir = document.getElementById('modalCreateDir');
    const createDirInput = document.getElementById('createDirInput');
    const btnCreateDirConfirm = document.getElementById('btnCreateDirConfirm');

    const modalPreview = document.getElementById('modalPreview');
    const previewTitle = document.getElementById('previewTitle');
    const tabText = document.getElementById('tabText');
    const tabHex = document.getElementById('tabHex');
    const previewTextContent = document.getElementById('previewTextContent');
    const previewHexContent = document.getElementById('previewHexContent');

    const modalRename = document.getElementById('modalRename');
    const renameInput = document.getElementById('renameInput');
    const btnRenameConfirm = document.getElementById('btnRenameConfirm');

    // Modal Import Result Elements
    const modalImportResult = document.getElementById('modalImportResult');
    const importResultTitle = document.getElementById('importResultTitle');
    const importResultSummary = document.getElementById('importResultSummary');
    const importSuccessContainer = document.getElementById('importSuccessContainer');
    const importSuccessList = document.getElementById('importSuccessList');
    const importFailureContainer = document.getElementById('importFailureContainer');
    const importFailureList = document.getElementById('importFailureList');

    // Toast Notifications
    function showToast(message, type = 'info') {
        const container = document.getElementById('toastContainer');
        if (!container) return;
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        
        let iconHtml = '';
        if (type === 'success') {
            iconHtml = '<svg class="toast-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>';
        } else if (type === 'error') {
            iconHtml = '<svg class="toast-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>';
        } else {
            iconHtml = '<svg class="toast-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>';
        }

        toast.innerHTML = `${iconHtml}<span class="toast-message">${message}</span>`;
        container.appendChild(toast);
        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateY(8px)';
            setTimeout(() => toast.remove(), 300);
        }, 3500);
    }

    // Modal helpers
    function openModal(modalEl) {
        modalEl.classList.add('active');
    }
    function closeModal(modalEl) {
        modalEl.classList.remove('active');
    }

    document.querySelectorAll('[data-close]').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const modalId = btn.getAttribute('data-close');
            const targetModal = document.getElementById(modalId);
            if (targetModal) closeModal(targetModal);
        });
    });

    document.querySelectorAll('.modal-backdrop').forEach(backdrop => {
        backdrop.addEventListener('click', (e) => {
            if (e.target === backdrop) {
                closeModal(backdrop);
            }
        });
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' || e.key === 'Esc' || e.keyCode === 27) {
            const activeModals = document.querySelectorAll('.modal-backdrop.active');
            activeModals.forEach(modal => closeModal(modal));
        }
    });

    // -------------------------------------------------------------
    // ATR Disk Loading & UI Updates
    // -------------------------------------------------------------
    function updateActiveDiskBadge(fileName) {
        if (!currentDiskBadge) return;
        if (fileName) {
            let displayName = fileName;
            if (fileName.length > 40) {
                const lastDotIdx = fileName.lastIndexOf('.');
                if (lastDotIdx > 0 && lastDotIdx < fileName.length - 1) {
                    const extNoDot = fileName.substring(lastDotIdx + 1);
                    const base = fileName.substring(0, lastDotIdx);
                    const maxBaseLen = 40 - 3 - extNoDot.length;
                    if (maxBaseLen > 0) {
                        displayName = base.substring(0, maxBaseLen) + '...' + extNoDot;
                    } else {
                        displayName = fileName.substring(0, 37) + '...';
                    }
                } else {
                    displayName = fileName.substring(0, 37) + '...';
                }
            }
            currentDiskBadge.textContent = displayName;
            currentDiskBadge.title = fileName;
            currentDiskBadge.className = 'active-disk-name loaded';
            if (activeDiskContainer) {
                activeDiskContainer.className = 'active-disk-pill loaded';
                activeDiskContainer.title = T('Załadowany obraz ATR: {0}', fileName);
            }
        } else {
            currentDiskBadge.textContent = T('Brak Obrazu');
            currentDiskBadge.title = T('Brak otwartego obrazu ATR');
            currentDiskBadge.className = 'active-disk-name empty';
            if (activeDiskContainer) {
                activeDiskContainer.className = 'active-disk-pill';
                activeDiskContainer.title = T('Brak otwartego obrazu ATR');
            }
        }
    }

    function loadATRBuffer(buffer, fileName = 'disk.atr') {
        try {
            diskManager.load(buffer);
            updateActiveDiskBadge(fileName);

            btnSaveDisk.disabled = false;
            btnFormatDisk.disabled = false;
            btnAddFile.disabled = (diskManager.getDiskStats().isReadOnly === true);

            activeDirPath = '';
            clearMarks();
            refreshUI();
            showToast(T('Wczytano obraz ATR: {0} ({1})', fileName, diskManager.dosType), 'success');
        } catch (err) {
            showToast(T('Błąd wczytywania ATR: {0}', err.message), 'error');
        }
    }

    function refreshUI() {
        if (!diskManager.atr) {
            emptyState.style.display = 'flex';
            fileTableBody.innerHTML = '';
            return;
        }

        const stats = diskManager.getDiskStats();
        dosBadge.textContent = stats.dosType;
        metricDensity.textContent = stats.density;
        metricSectors.textContent = stats.sectorCount;

        const diskWarningNotice = document.getElementById('diskWarningNotice');
        const diskWarningTitle = document.getElementById('diskWarningTitle');
        const diskWarningText = document.getElementById('diskWarningText');

        if (stats.isUnrealistic) {
            const nonStdTitle = T('Niestandardowe parametry dysku');
            metricFreeSectors.innerHTML = `<span style="color: #ef4444; font-weight: bold; font-size: 15px;" title="${nonStdTitle}">?</span>`;
            metricFreeBytes.innerHTML = `<span style="color: #ef4444; font-weight: bold; font-size: 15px;" title="${nonStdTitle}">?</span>`;
            diskProgressFill.style.width = '100%';
            diskProgressFill.style.backgroundColor = '#6b7280';
        } else {
            metricFreeSectors.textContent = stats.freeSectors;
            metricFreeBytes.textContent = stats.freeBytes.toLocaleString() + ' B';
            const usedPercent = Math.min(100, Math.round((stats.usedSectors / stats.sectorCount) * 100));
            diskProgressFill.style.width = `${usedPercent}%`;
            diskProgressFill.style.backgroundColor = '';
        }

        if (diskWarningNotice) {
            if (stats.isSizeNonStandard && stats.nonStandardSizeNotice) {
                diskWarningNotice.style.display = 'block';
                if (diskWarningTitle) diskWarningTitle.textContent = T("Niestandardowy rozmiar / parametry dysku");
                if (diskWarningText) diskWarningText.textContent = stats.nonStandardSizeNotice;
            } else {
                diskWarningNotice.style.display = 'none';
            }
        }

        const diskReadOnlyNotice = document.getElementById('diskReadOnlyNotice');
        const diskReadOnlyTitle = document.getElementById('diskReadOnlyTitle');
        const diskReadOnlyText = document.getElementById('diskReadOnlyText');
        if (diskReadOnlyNotice) {
            if (stats.isReadOnly && stats.validationError) {
                diskReadOnlyNotice.style.display = 'block';
                diskReadOnlyNotice.style.color = '#ef4444';
                diskReadOnlyNotice.style.background = 'rgba(239, 68, 68, 0.1)';
                diskReadOnlyNotice.style.borderColor = 'rgba(239, 68, 68, 0.3)';
                if (diskReadOnlyTitle) diskReadOnlyTitle.textContent = T("Tylko do odczytu (Read-Only)");
                if (diskReadOnlyText) diskReadOnlyText.textContent = stats.validationError;
            } else if (!stats.isReadOnly && stats.validationWarning) {
                diskReadOnlyNotice.style.display = 'block';
                diskReadOnlyNotice.style.color = '#f59e0b';
                diskReadOnlyNotice.style.background = 'rgba(245, 158, 11, 0.1)';
                diskReadOnlyNotice.style.borderColor = 'rgba(245, 158, 11, 0.3)';
                if (diskReadOnlyTitle) diskReadOnlyTitle.textContent = T("Uwaga: zagubione sektory");
                if (diskReadOnlyText) diskReadOnlyText.textContent = stats.validationWarning;
            } else {
                diskReadOnlyNotice.style.display = 'none';
            }
        }
        btnAddFile.disabled = (stats.isReadOnly === true);

        // Render Directory Tree
        renderDirTree();

        // Render File Table
        renderFileTable();
    }    function renderDirTree() {
        const dirTreeCard = document.getElementById('dirTreeCard');
        const supportsSubdirs = (diskManager.dosType === 'MyDOS' || diskManager.dosType === 'SpartaDOS');

        if (!supportsSubdirs) {
            if (dirTreeCard) dirTreeCard.style.display = 'none';
            activeDirPath = '';
            return;
        }

        if (dirTreeCard) dirTreeCard.style.display = '';

        dirTree.innerHTML = `
            <li class="tree-item ${activeDirPath === '' ? 'active' : ''}" data-path="">
                <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"/></svg>
                <span>[ROOT]</span>
            </li>
        `;

        if (diskManager.dosType === 'MyDOS' || diskManager.dosType === 'SpartaDOS') {
            const allFiles = diskManager.getFiles();
            function addSubdirs(files, parentEl, level = 0) {
                files.filter(f => f.isDir && f.isValid).forEach(dir => {
                    const li = document.createElement('li');
                    li.className = `tree-item ${activeDirPath === dir.fullPath ? 'active' : ''}`;
                    li.style.paddingLeft = `${10 + level * 14}px`;
                    li.setAttribute('data-path', dir.fullPath);
                    const prefix = level > 0 ? `<span style="opacity:0.4; margin-right:4px; font-family:monospace;">└</span>` : '';
                    li.innerHTML = `
                        ${prefix}<svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"/></svg>
                        <span>${dir.fullName}</span>
                    `;
                    dirTree.appendChild(li);
                    if (dir.subFiles && dir.subFiles.length > 0) {
                        addSubdirs(dir.subFiles, parentEl, level + 1);
                    }
                });
            }
            addSubdirs(allFiles, dirTree, 0);
        }

        // Tree click handlers
        dirTree.querySelectorAll('.tree-item').forEach(item => {
            item.addEventListener('click', () => {
                dirTree.querySelectorAll('.tree-item').forEach(i => i.classList.remove('active'));
                item.classList.add('active');
                activeDirPath = item.getAttribute('data-path') || '';
                renderFileTable();
            });
        });
    }

    function renderFileTable() {
        fileTableBody.innerHTML = '';
        selectedFileObj = null;
        updateToolbarButtonState();

        const allFiles = diskManager.getFiles();
        let displayFiles = allFiles.filter(f => !f.isDeleted);

        // Filter by subdirectory path if MyDOS or SpartaDOS
        if (activeDirPath) {
            function findSubDir(files, path) {
                for (const f of files) {
                    if (f.isDir && f.fullPath === path) {
                        return (f.subFiles || []).filter(sub => !sub.isDeleted);
                    }
                    if (f.subFiles && f.subFiles.length > 0) {
                        const res = findSubDir(f.subFiles, path);
                        if (res !== null) return res;
                    }
                }
                return null;
            }
            displayFiles = findSubDir(allFiles, activeDirPath) || [];
        }

        // Search Filter
        const query = searchInput.value.toLowerCase().trim();
        if (query) {
            displayFiles = displayFiles.filter(f => f.fullName.toLowerCase().includes(query));
        }

        currentFiles = displayFiles;

        if (displayFiles.length === 0 && !activeDirPath) {
            emptyState.style.display = 'flex';
            statusLeft.textContent = T('Pusty katalog ({0}).', diskManager.dosType);
            syncSelectAllCheckbox();
            updateToolbarButtonState();
            return;
        }

        emptyState.style.display = 'none';
        const pathLabel = activeDirPath ? T('Ścieżka: /{0}', activeDirPath) : T('Katalog główny');
        statusLeft.textContent = T('{0} ({1} elementów).', pathLabel, displayFiles.length);

        // Render ".." (Parent Directory) row when inside a subdirectory
        if (activeDirPath) {
            const upTr = document.createElement('tr');
            upTr.style.cursor = 'pointer';
            upTr.innerHTML = `
                <td colspan="7" style="color: var(--color-primary); font-weight: 600;">
                    <div class="file-name-cell">
                        <span class="file-icon file-icon-dir" style="margin-right: 6px;">
                            <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 19l-7-7 7-7m8 14l-7-7 7-7"/></svg>
                        </span>
                        <span>.. [${T('Katalog nadrzędny')}]</span>
                    </div>
                </td>
            `;
            upTr.addEventListener('dblclick', () => {
                const parts = activeDirPath.split('/');
                parts.pop();
                activeDirPath = parts.join('/');
                refreshUI();
            });
            upTr.addEventListener('click', () => {
                const parts = activeDirPath.split('/');
                parts.pop();
                activeDirPath = parts.join('/');
                refreshUI();
            });
            fileTableBody.appendChild(upTr);
        }

        displayFiles.forEach(file => {
            const tr = document.createElement('tr');

            // Icon & Name
            const iconHtml = file.isDir
                ? `<span class="file-icon file-icon-dir"><svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"/></svg></span>`
                : `<span class="file-icon file-icon-file"><svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"/></svg></span>`;

            // Attributes
            let attrBadge = '';
            const isSparta = (diskManager.dosType === 'SpartaDOS' || diskManager.dosType === 'SDFS');

            if (file.isDir) attrBadge += `<span class="badge badge-orange">DIR</span> `;
            
            if (isSparta) {
                if (file.isArchived) attrBadge += `<span class="badge badge-orange" title="Archive (Bit 2)">A</span> `;
                if (file.isHidden) attrBadge += `<span class="badge badge-orange" title="Hidden (Bit 1)">H</span> `;
                if (file.isProtected || file.isLocked) attrBadge += `<span class="badge badge-orange" title="Protected (Bit 0)">P</span> `;
            } else {
                if (file.isLocked) attrBadge += `<span class="badge badge-orange">LOCK</span> `;
            }

            if (file.isDeleted) attrBadge += `<span class="badge badge-blue">DEL</span> `;
            if (!attrBadge) attrBadge = `<span style="color: var(--text-muted);">-</span>`;

            tr.innerHTML = `
                <td class="col-check"><input type="checkbox" class="row-check"></td>
                <td><div class="file-name-cell">${iconHtml}<span>${file.fullName}</span></div></td>
                <td>${file.sectorCount || 0}</td>
                <td>${file.sizeBytes !== undefined ? file.sizeBytes.toLocaleString() : '-'}</td>
                <td>${file.startSector || '-'}</td>
                <td>${attrBadge}</td>
                <td>
                    <div class="file-actions">
                        <button class="btn btn-secondary btn-sm action-preview" ${file.isDir ? 'disabled style="opacity:0.3"' : ''} title="${T('Podgląd / Hex')}">
                            <svg width="12" height="12" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/></svg>
                        </button>
                        <button class="btn btn-secondary btn-sm action-extract" ${file.isDir ? 'disabled style="opacity:0.3"' : ''} title="${T('Pobierz')}">
                            <svg width="12" height="12" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/></svg>
                        </button>
                    </div>
                </td>
            `;

            // Checkbox mark, restored from the set so it survives re-renders
            const rowCheck = tr.querySelector('.row-check');
            rowCheck.checked = markedFiles.has(markKey(file));
            rowCheck.addEventListener('change', () => {
                if (rowCheck.checked) markedFiles.add(markKey(file));
                else markedFiles.delete(markKey(file));
                syncSelectAllCheckbox();
                updateToolbarButtonState();
            });

            // Selection Event
            tr.addEventListener('click', (e) => {
                if (e.target.closest('.file-actions')) return;
                if (e.target.closest('.row-check')) return;
                fileTableBody.querySelectorAll('tr').forEach(r => r.classList.remove('selected'));
                tr.classList.add('selected');
                selectedFileObj = file;
                updateToolbarButtonState();
            });

            // Double Click to enter Directory
            if (file.isDir) {
                tr.addEventListener('dblclick', (e) => {
                    e.stopPropagation();
                    activeDirPath = file.fullPath;
                    refreshUI();
                });
            }

            // Action Buttons
            tr.querySelector('.action-preview').addEventListener('click', () => {
                selectedFileObj = file;
                openPreviewModal();
            });

            tr.querySelector('.action-extract').addEventListener('click', () => {
                selectedFileObj = file;
                extractSelectedFile();
            });

            fileTableBody.appendChild(tr);
        });

        syncSelectAllCheckbox();
        updateToolbarButtonState();
    }

    function findSubDirObject(files, path) {
        if (!path) return null;
        for (const f of files) {
            if (f.isDir && f.fullPath === path) return f;
            if (f.subFiles && f.subFiles.length > 0) {
                const res = findSubDirObject(f.subFiles, path);
                if (res) return res;
            }
        }
        return null;
    }

    function updateToolbarButtonState() {
        const hasSelection = selectedFileObj !== null;
        const isDir = hasSelection && selectedFileObj.isDir === true;
        const canCreateDir = diskManager.atr && (diskManager.dosType === 'MyDOS' || diskManager.dosType === 'SpartaDOS');
        const isRO = diskManager.getDiskStats().isReadOnly === true;

        // Marks drive the bulk actions; a single click-selection still drives
        // the rest. Attributes work on whichever of the two is in play, so it
        // needs at least one non-directory entry on either side.
        const marked = getMarkedFiles();
        const markedFileCount = marked.filter(f => !f.isDir).length;
        const hasAttrTarget = markedFileCount > 0 || (hasSelection && !isDir);

        btnCreateDir.disabled = !canCreateDir || isRO;
        btnExtractFile.disabled = !hasSelection || isDir;
        btnRenameFile.disabled = !hasSelection || isRO;
        btnToggleLock.disabled = !hasSelection || isDir || isRO;
        btnDeleteFile.disabled = !hasSelection || isRO;
        btnPreviewFile.disabled = !hasSelection || isDir;
        if (btnDirAtascii) btnDirAtascii.disabled = !diskManager.atr;
        if (btnExtractSelected) btnExtractSelected.disabled = marked.length === 0;

        if (btnEditAttributes) {
            // Every filesystem here carries a read-only bit, so the dialog is
            // useful everywhere; only SpartaDOS adds Hidden and Archive to it.
            btnEditAttributes.style.display = 'inline-flex';
            btnEditAttributes.disabled = !hasAttrTarget || isRO;
        }
    }

    // Search filter input listener
    searchInput.addEventListener('input', () => {
        renderFileTable();
    });

    // Header checkbox: acts on what is on screen, so a search filter narrows
    // its reach to the matching rows rather than the whole directory.
    if (chkSelectAll) {
        chkSelectAll.addEventListener('change', () => {
            const select = chkSelectAll.checked;
            currentFiles.forEach(f => {
                if (select) markedFiles.add(markKey(f));
                else markedFiles.delete(markKey(f));
            });
            fileTableBody.querySelectorAll('.row-check').forEach(cb => { cb.checked = select; });
            syncSelectAllCheckbox();
            updateToolbarButtonState();
        });
    }

    // -------------------------------------------------------------
    // Open & Save Disk Actions
    // -------------------------------------------------------------
    btnOpenDisk.addEventListener('click', () => fileInputATR.click());

    fileInputATR.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (event) => {
            loadATRBuffer(new Uint8Array(event.target.result), file.name);
        };
        reader.readAsArrayBuffer(file);
        fileInputATR.value = '';
    });

    /**
     * Generates downloadable ATR filename according to XX_XXX.atr pattern
     * XX = Density (SD, MD, DD, QD)
     * XXX = DOS type (D2P, MYD, SDX, D25, D20)
     * @returns {string} E.g., SD_D2P.atr, DD_SDX.atr, QD_MYD.atr
     */
    function getFormattedATRFilename() {
        if (!diskManager || !diskManager.atr) return 'SD_D2P.atr';

        // 1. Density (2 chars: SD, MD, DD, QD)
        let densityCode = 'SD';
        const dType = diskManager.atr.densityType || '';
        if (dType === 'ED' || dType === 'MD') {
            densityCode = 'MD';
        } else if (dType === 'DD') {
            densityCode = 'DD';
        } else if (dType === 'QD') {
            densityCode = 'QD';
        } else if (dType === 'DSDD' || dType === '720K') {
            densityCode = '720K';
        } else {
            densityCode = 'SD';
        }

        // 2. DOS Type (3 chars)
        let dosCode = 'D2P';
        const dosType = diskManager.dosType || '';

        if (dosType.includes('DOS II+') || dosType.includes('D2P') || dosType === 'DOS2PLUS') {
            dosCode = 'D2P';
        } else if (dosType.includes('LiteDOS') || dosType.includes('LTD') || dosType === 'LiteDOS-SE') {
            dosCode = 'LTD';
        } else if (dosType.includes('MyDOS') || dosType === 'MYD') {
            dosCode = 'MYD';
        } else if (dosType.includes('Sparta') || dosType.includes('SDX') || dosType === 'SpartaDOS') {
            dosCode = 'SDX';
        } else if (dosType.includes('2.5') || dosType === 'D25') {
            dosCode = 'D25';
        } else if (dosType.includes('2.0') || dosType.includes('Atari DOS') || dosType === 'D20') {
            dosCode = 'D20';
        } else if (dosType.includes('CP/M') || dosType.includes('CPM') || dosType === 'CP/M 2.2 (Indus GT)') {
            dosCode = 'CPM';
        } else {
            dosCode = 'D2P';
        }

        // Indus GT CP/M images are conventionally headerless XFD; the Atari 1090
        // ones are plain ATR, so the container follows the CP/M profile.
        const cpmContainer = (diskManager.dos && diskManager.dos.profile) ? diskManager.dos.profile.container : null;
        const ext = (cpmContainer === 'xfd' || (diskManager.atr && diskManager.atr.isXFD)) ? 'xfd' : 'atr';
        return `${densityCode}_${dosCode}.${ext}`;
    }

    btnSaveDisk.addEventListener('click', () => {
        if (!diskManager.atr) return;
        try {
            const exportedBytes = diskManager.export();
            const blob = new Blob([exportedBytes], { type: 'application/octet-stream' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;

            const filename = getFormattedATRFilename();
            a.download = filename;
            a.click();
            URL.revokeObjectURL(url);
            showToast(T(`Wyeksportowano i pobrano plik {0}.`, filename), "success");
        } catch (err) {
            showToast(T(`Błąd zapisu ATR: {0}`, err.message), "error");
        }
    });

    // -------------------------------------------------------------
    // Create New ATR & Format Disk
    // -------------------------------------------------------------
    /**
     * Reads the custom geometry fields: boot sectors 0..255, sector count
     * bootSectorCount..65535, and no boot sectors at all with 512-byte sectors.
     */
    function readCustomGeometry() {
        const sectorSize = parseInt(document.getElementById('newDiskSectorSize').value, 10) || 128;
        let bootSectorCount = parseInt(document.getElementById('newDiskBootSectors').value, 10);
        if (!Number.isFinite(bootSectorCount)) bootSectorCount = 3;
        bootSectorCount = Math.max(0, Math.min(255, bootSectorCount));
        if (sectorSize > 256) bootSectorCount = 0;

        let sectorCount = parseInt(document.getElementById('newDiskSectorCount').value, 10);
        if (!Number.isFinite(sectorCount)) sectorCount = 720;
        sectorCount = Math.max(bootSectorCount, Math.min(65535, sectorCount));

        return { sectorCount, sectorSize, bootSectorCount };
    }

    function updateCustomGeometryUI() {
        const isCustom = newDiskDensity.value === 'CUSTOM';
        const group = document.getElementById('customGeometryGroup');
        const info = document.getElementById('customGeometryInfo');
        const bootInput = document.getElementById('newDiskBootSectors');
        const btnConfirm = document.getElementById('btnCreateDiskConfirm');

        if (group) group.style.display = isCustom ? 'block' : 'none';
        if (!isCustom) {
            if (btnConfirm) btnConfirm.disabled = false;
            return;
        }

        const geom = readCustomGeometry();
        // 512-byte sectors have no short boot sectors, so the field is meaningless
        if (bootInput) {
            bootInput.disabled = geom.sectorSize > 256;
            if (geom.sectorSize > 256) bootInput.value = 0;
        }

        const problem = DiskManager.checkFormatSupport(newDiskDOS.value, geom);
        const shortBoot = geom.sectorSize > 128 ? geom.bootSectorCount : 0;
        const bytes = shortBoot * 128 + (geom.sectorCount - shortBoot) * geom.sectorSize;

        if (info) {
            const size = T('{0} sekt. x {1} B = {2} KB (plik {3} B)', geom.sectorCount, geom.sectorSize, (bytes / 1024).toFixed(1), (16 + bytes).toLocaleString());
            const note = geom.sectorSize > 128 && geom.bootSectorCount !== 3
                ? '<br>' + T('Uwaga: format ATR nie zapisuje liczby sektorów startowych — przy ponownym wczytaniu obrazu o sektorach 256 B zostaną odczytane 3.')
                : '';
            info.innerHTML = problem
                ? `<span style="color: var(--danger, #c0392b);">${problem}</span><br>${size}`
                : `${size}${note}`;
        }
        if (btnConfirm) btnConfirm.disabled = !!problem;
    }

    function updateNewDiskDensityOptions() {
        const dosVal = newDiskDOS.value;
        const optSD = document.getElementById('optSD');
        const optMD = document.getElementById('optMD');
        const optDD = document.getElementById('optDD');
        const optQD = document.getElementById('optQD');
        const optDSDD = document.getElementById('optDSDD');
        const chkInstallSystem = document.getElementById('chkInstallSystem');

        if (dosVal === 'NONE') {
            // An unformatted image only makes sense with a geometry of your own
            [optSD, optMD, optDD, optQD, optDSDD].forEach(o => { if (o) o.style.display = 'block'; });
            newDiskDensity.disabled = false;
            if (chkInstallSystem) { chkInstallSystem.checked = false; chkInstallSystem.disabled = true; }
            updateCustomGeometryUI();
            return;
        }

        if (dosVal === 'CPM') {
            if (optSD) optSD.style.display = 'none';
            if (optMD) optMD.style.display = 'none';
            if (optDD) optDD.style.display = 'block';
            if (optQD) optQD.style.display = 'none';
            if (optDSDD) optDSDD.style.display = 'none';
            if (newDiskDensity.value !== 'CUSTOM') newDiskDensity.value = 'DD';
            newDiskDensity.disabled = false;
        } else if (dosVal === 'CPM1090') {
            // The 1090 card reads 128-byte media only; MD/ED is the size its
            // BIOS is set up for, SD works but leaves part of the DPB unused
            if (optSD) optSD.style.display = 'block';
            if (optMD) optMD.style.display = 'block';
            if (optDD) optDD.style.display = 'none';
            if (optQD) optQD.style.display = 'none';
            if (optDSDD) optDSDD.style.display = 'none';
            if (newDiskDensity.value === 'DD' || newDiskDensity.value === 'QD' || newDiskDensity.value === 'DSDD') {
                newDiskDensity.value = 'MD';
            } else if (newDiskDensity.value !== 'CUSTOM' && newDiskDensity.value !== 'SD') {
                newDiskDensity.value = 'MD';
            }
            newDiskDensity.disabled = false;
        } else if (dosVal === 'DOS2') {
            // Atari DOS 2.0S only ever shipped for the classic SD disk
            if (optSD) optSD.style.display = 'block';
            if (optMD) optMD.style.display = 'none';
            if (optDD) optDD.style.display = 'none';
            if (optQD) optQD.style.display = 'none';
            if (optDSDD) optDSDD.style.display = 'none';
            if (newDiskDensity.value !== 'CUSTOM') newDiskDensity.value = 'SD';
            newDiskDensity.disabled = false;
        } else if (dosVal === 'DOS25') {
            // DOS 2.5 supports SD (720) and MD/ED (1040, 130 KB) only
            if (optSD) optSD.style.display = 'block';
            if (optMD) optMD.style.display = 'block';
            if (optDD) optDD.style.display = 'none';
            if (optQD) optQD.style.display = 'none';
            if (optDSDD) optDSDD.style.display = 'none';
            if (newDiskDensity.value === 'DD' || newDiskDensity.value === 'QD' || newDiskDensity.value === 'DSDD') {
                newDiskDensity.value = 'SD';
            }
            newDiskDensity.disabled = false;
        } else if (dosVal === 'DOS2PLUS') {
            if (optSD) optSD.style.display = 'block';
            if (optMD) optMD.style.display = 'block';
            if (optDD) optDD.style.display = 'block';
            if (optQD) optQD.style.display = 'none';
            if (optDSDD) optDSDD.style.display = 'none';
            if (newDiskDensity.value === 'QD' || newDiskDensity.value === 'DSDD' || newDiskDensity.value === 'DD' && newDiskDensity.disabled) {
                newDiskDensity.value = 'SD';
            }
            newDiskDensity.disabled = false;
        } else {
            if (optSD) optSD.style.display = 'block';
            if (optMD) optMD.style.display = 'block';
            if (optDD) optDD.style.display = 'block';
            if (optQD) optQD.style.display = 'block';
            if (optDSDD) optDSDD.style.display = 'block';
            newDiskDensity.disabled = false;
        }

        // System files are never installed on a custom geometry - the templates
        // only exist for the standard densities.
        const isCustom = newDiskDensity.value === 'CUSTOM';
        if (chkInstallSystem) {
            if (isCustom || dosVal === 'SpartaDOS' || dosVal === 'CPM' || dosVal === 'CPM1090') {
                chkInstallSystem.checked = false;
                chkInstallSystem.disabled = true;
            } else {
                chkInstallSystem.disabled = false;
                chkInstallSystem.checked = true;
            }
        }

        updateCustomGeometryUI();
    }

    newDiskDOS.addEventListener('change', updateNewDiskDensityOptions);
    newDiskDensity.addEventListener('change', updateNewDiskDensityOptions);
    ['newDiskSectorCount', 'newDiskBootSectors', 'newDiskSectorSize'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('input', updateCustomGeometryUI);
        if (el) el.addEventListener('change', updateCustomGeometryUI);
    });

    btnNewDisk.addEventListener('click', () => {
        updateNewDiskDensityOptions();
        openModal(modalNewDisk);
    });

    btnCreateDiskConfirm.addEventListener('click', () => {
        const density = newDiskDensity.value;
        const dos = newDiskDOS.value;
        const chkInstallSystem = document.getElementById('chkInstallSystem');
        const installSys = chkInstallSystem ? chkInstallSystem.checked : true;
        const custom = density === 'CUSTOM' ? readCustomGeometry() : null;

        try {
            diskManager.createNew(density, dos, installSys, custom);
            closeModal(modalNewDisk);

            const filename = getFormattedATRFilename();
            updateActiveDiskBadge(filename);

            btnSaveDisk.disabled = false;
            btnFormatDisk.disabled = false;
            btnAddFile.disabled = false;
            activeDirPath = '';
            clearMarks();
            refreshUI();
            showToast(T(`Utworzono nowy dysk {0}`, filename), 'success');
        } catch (err) {
            showToast(T(`Błąd tworzenia dysku: {0}`, err.message), 'error');
        }
    });

    btnFormatDisk.addEventListener('click', () => {
        if (!diskManager.atr) return;
        if (confirm(T(`Czy na pewno chcesz sformatować dysk? Wszystkie dane zostaną utracone.`))) {
            try {
                const dosType = diskManager.dosType.includes('LiteDOS') ? 'LiteDOS' : (diskManager.dosType.includes('MyDOS') ? 'MyDOS' : (diskManager.dosType.includes('Sparta') ? 'SpartaDOS' : (diskManager.dosType.includes('CP/M') || diskManager.dosType.includes('CPM') ? (diskManager.dosType.includes('1090') ? 'CPM1090' : 'CPM') : (diskManager.dosType.includes('2.5') ? 'DOS2.5' : 'Atari DOS'))));
                diskManager.format(dosType);
                clearMarks();
                refreshUI();
                showToast(T("Dysk został pomyślnie sformatowany."), "success");
            } catch (err) {
                showToast(T(`Błąd formatowania: {0}`, err.message), "error");
            }
        }
    });

    if (btnManual && modalManual) {
        btnManual.addEventListener('click', () => {
            openModal(modalManual);
        });
    }

    // Helper to find subdirectory object by path
    function findSubDirObject(files, path) {
        if (!path) return null;
        for (const f of files) {
            if (f.isDir && f.fullPath === path) return f;
            if (f.subFiles && f.subFiles.length > 0) {
                const res = findSubDirObject(f.subFiles, path);
                if (res) return res;
            }
        }
        return null;
    }

    async function processBatchImport(filesList) {
        if (!diskManager.atr) {
            showToast(T("Najpierw wczytaj obraz .ATR / .XFD lub utwórz nowy dysk."), "info");
            return;
        }

        const stats = diskManager.getDiskStats();
        if (stats.isReadOnly) {
            showToast(T("Dysk jest w trybie tylko do odczytu. Import jest zablokowany."), "error");
            return;
        }

        const files = Array.from(filesList || []);
        if (files.length === 0) return;

        const dataFiles = [];
        const skippedImageFiles = [];

        files.forEach(f => {
            const ext = f.name.toLowerCase();
            if (ext.endsWith('.atr') || ext.endsWith('.xfd')) {
                skippedImageFiles.push(f.name);
            } else {
                dataFiles.push(f);
            }
        });

        if (dataFiles.length === 0) {
            if (skippedImageFiles.length > 0) {
                showToast(T("Obrazy dysków (.ATR / .XFD) należy otworzyć zamiast importować."), "info");
            }
            return;
        }

        // Asynchronously read file buffers
        const loadedFiles = await Promise.all(dataFiles.map(file => {
            return new Promise((resolve) => {
                const reader = new FileReader();
                reader.onload = (e) => {
                    resolve({
                        name: file.name,
                        bytes: new Uint8Array(e.target.result),
                        size: file.size
                    });
                };
                reader.onerror = () => {
                    resolve({
                        name: file.name,
                        bytes: null,
                        error: T("Błąd odczytu z dysku lokalnego")
                    });
                };
                reader.readAsArrayBuffer(file);
            });
        }));

        const activeDirObj = findSubDirObject(diskManager.getFiles(), activeDirPath);
        const successes = [];
        const failures = [];

        for (const item of loadedFiles) {
            if (!item.bytes) {
                failures.push({ name: item.name, error: item.error || T("Błąd pliku") });
                continue;
            }

            try {
                diskManager.importFile(item.name, item.bytes, activeDirObj);
                successes.push({ name: item.name, size: item.bytes.length });
            } catch (err) {
                failures.push({ name: item.name, error: err.message || T("Błąd zapisu") });
            }
        }

        refreshUI();

        if (failures.length === 0 && skippedImageFiles.length === 0) {
            if (successes.length === 1) {
                showToast(T(`Zaimportowano plik: {0}`, successes[0].name), 'success');
            } else {
                showToast(T(`Pomyślnie zaimportowano {0} plików.`, successes.length), 'success');
            }
        } else {
            const total = successes.length + failures.length;
            if (importResultSummary) {
                if (failures.length > 0) {
                    importResultSummary.innerHTML = `
                        <div style="font-weight: 700; margin-bottom: 2px; color: #ef4444;">
                            ${T('Niektóre pliki nie mogły zostać zaimportowane ({0} z {1} zapisanych)', successes.length, total)}
                        </div>
                        <div style="color: var(--text-secondary); margin-top: 4px;">
                            ${T('Powodem odrzucenia jest zbyt mała wolna powierzchnia dysku, nieprawidłowy format nazwy lub zablokowany katalog.')}
                        </div>
                    `;
                } else {
                    importResultSummary.innerHTML = `
                        <div style="font-weight: 700; margin-bottom: 2px; color: var(--color-success);">
                            ${T('Zaimportowano {0} z {1} plików.', successes.length, total)}
                        </div>
                    `;
                }
            }

            if (importSuccessContainer && importSuccessList) {
                if (successes.length > 0) {
                    importSuccessContainer.style.display = 'block';
                    importSuccessList.innerHTML = successes.map(s => `
                        <li>
                            <span>${s.name}</span>
                            <span style="color: var(--text-muted); font-size: 11px;">(${s.size.toLocaleString()} B)</span>
                        </li>
                    `).join('');
                } else {
                    importSuccessContainer.style.display = 'none';
                    importSuccessList.innerHTML = '';
                }
            }

            if (importFailureContainer && importFailureList) {
                if (failures.length > 0 || skippedImageFiles.length > 0) {
                    importFailureContainer.style.display = 'block';
                    let failureHtml = failures.map(f => `
                        <li>
                            <span>${f.name}</span>
                            <span class="file-error-reason">${f.error}</span>
                        </li>
                    `).join('');

                    skippedImageFiles.forEach(name => {
                        failureHtml += `
                            <li>
                                <span>${name}</span>
                                <span class="file-error-reason">${T('Obraz ATR/XFD - pominięto')}</span>
                            </li>
                        `;
                    });

                    importFailureList.innerHTML = failureHtml;
                } else {
                    importFailureContainer.style.display = 'none';
                    importFailureList.innerHTML = '';
                }
            }

            openModal(modalImportResult);
        }
    }

    btnAddFile.addEventListener('click', () => fileInputImport.click());

    fileInputImport.addEventListener('change', (e) => {
        if (e.target.files && e.target.files.length > 0) {
            processBatchImport(e.target.files);
        }
        fileInputImport.value = '';
    });

    btnCreateDir.addEventListener('click', () => {
        if (!diskManager.atr) return;
        createDirInput.value = '';
        openModal(modalCreateDir);
    });

    btnCreateDirConfirm.addEventListener('click', () => {
        const dirName = createDirInput.value.trim();
        if (!dirName) return;

        try {
            const activeDirObj = findSubDirObject(diskManager.getFiles(), activeDirPath);
            diskManager.createDirectory(dirName, activeDirObj);
            closeModal(modalCreateDir);
            refreshUI();
            showToast(T(`Utworzono podkatalog: {0}`, dirName), 'success');
        } catch (err) {
            showToast(T(`Błąd tworzenia podkatalogu: {0}`, err.message), 'error');
        }
    });

    function extractSelectedFile() {
        if (!selectedFileObj) return;
        try {
            const bytes = diskManager.extractFile(selectedFileObj, 'raw');
            const blob = new Blob([bytes], { type: 'application/octet-stream' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = selectedFileObj.fullName;
            a.click();
            URL.revokeObjectURL(url);
            showToast(T(`Pobrano plik: {0}`, selectedFileObj.fullName), 'success');
        } catch (err) {
            showToast(T(`Błąd pobierania: {0}`, err.message), 'error');
        }
    }
    btnExtractFile.addEventListener('click', extractSelectedFile);

    /**
     * Copies one entry into the archive, descending into subdirectories.
     * Paths are relative to the current view, so what lands in the archive is
     * what the user sees on the list.
     *
     * @param {ZipWriter} zip
     * @param {Object} file
     * @param {string} prefix Path built so far, '' or ending with '/'
     * @param {Object} report Counters and the list of entries that failed
     */
    function addEntryToZip(zip, file, prefix, report) {
        const segment = ZipWriter.sanitizeSegment(file.fullName);

        if (file.isDir) {
            // The directory tree carries deleted entries too; the listing hides
            // them, and their sectors may already belong to somebody else.
            const children = (file.subFiles || []).filter(f => !f.isDeleted);
            if (children.length === 0) {
                // Nothing would record an empty directory otherwise - a
                // directory that holds files is implied by their paths.
                zip.addDirectory(prefix + segment, file.date);
                return;
            }
            for (const child of children) addEntryToZip(zip, child, prefix + segment + '/', report);
            return;
        }

        try {
            const bytes = diskManager.extractFile(file, 'raw');
            zip.addFile(prefix + segment, bytes, file.date);
            report.files++;
        } catch (err) {
            // One unreadable file must not cost the user the whole archive.
            report.failed.push(`${prefix}${segment}: ${err.message}`);
        }
    }

    function extractMarkedToZip() {
        const marked = getMarkedFiles();
        if (marked.length === 0) return;

        try {
            const zip = new ZipWriter();
            const report = { files: 0, failed: [] };
            for (const file of marked) addEntryToZip(zip, file, '', report);

            if (zip.length === 0) {
                // Empty selection and a selection nothing could be read from
                // are two different problems, and only one is the user's doing.
                if (report.failed.length > 0) {
                    console.warn('ATRaction: pominięte pozycje eksportu ZIP\n' + report.failed.join('\n'));
                    showToast(T('Nie udało się odczytać żadnej z {0} zaznaczonych pozycji (szczegóły w konsoli).',
                        report.failed.length), 'error');
                } else {
                    showToast(T('Nie ma czego spakować: zaznaczone katalogi są puste.'), 'info');
                }
                return;
            }

            // The prefix keeps the archive apart from the disk image itself,
            // which the Save Disk button names by the same density/DOS pattern.
            const zipName = 'files_' + getFormattedATRFilename().replace(/\.(atr|xfd)$/i, '') + '.zip';
            const blob = new Blob([zip.build()], { type: 'application/zip' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = zipName;
            a.click();
            URL.revokeObjectURL(url);

            if (report.failed.length > 0) {
                console.warn('ATRaction: pominięte pozycje eksportu ZIP\n' + report.failed.join('\n'));
                showToast(T('Spakowano {0} plików do {1}; pominięto {2} nieczytelnych (szczegóły w konsoli).',
                    report.files, zipName, report.failed.length), 'error');
            } else {
                showToast(T('Spakowano {0} plików do {1}.', report.files, zipName), 'success');
            }
        } catch (err) {
            showToast(T('Błąd pakowania ZIP: {0}', err.message), 'error');
        }
    }
    if (btnExtractSelected) btnExtractSelected.addEventListener('click', extractMarkedToZip);

    btnDeleteFile.addEventListener('click', () => {
        if (!selectedFileObj) return;
        const fileName = selectedFileObj.fullName;
        if (confirm(T(`Czy na pewno chcesz usunąć plik '{0}'?`, fileName))) {
            try {
                diskManager.deleteFile(selectedFileObj);
                // The name is gone; leaving its key behind would silently mark
                // any future file that reuses it.
                markedFiles.delete(markKey(selectedFileObj));
                refreshUI();
                showToast(T(`Usunięto plik {0}`, fileName), 'success');
            } catch (err) {
                showToast(T(`Błąd usuwania: {0}`, err.message), 'error');
            }
        }
    });

    btnToggleLock.addEventListener('click', () => {
        if (!selectedFileObj || selectedFileObj.isDir) return;
        const fileName = selectedFileObj.fullName;
        try {
            const newLockState = !selectedFileObj.isLocked;
            diskManager.setLock(selectedFileObj, newLockState);
            refreshUI();
            showToast(T(`Zmieniono atrybuty pliku {0}`, fileName), 'success');
        } catch (err) {
            showToast(T(`Błąd zmiany atrybutów: {0}`, err.message), 'error');
        }
    });

    /**
     * Files the attribute dialog works on: the marked ones when there are any,
     * otherwise the single click-selected entry. Directories are left out -
     * the dialog edits file attributes only.
     * @returns {Array<Object>}
     */
    function getAttributeTargets() {
        const marked = getMarkedFiles().filter(f => !f.isDir);
        if (marked.length > 0) return marked;
        if (selectedFileObj && !selectedFileObj.isDir) return [selectedFileObj];
        return [];
    }

    function isSpartaFilesystem() {
        return diskManager.dosType === 'SpartaDOS' || diskManager.dosType === 'SDFS';
    }

    // Three states, not two: true and false where every target agrees, null
    // where they differ - which the checkbox shows as indeterminate and the
    // save step reads as "leave this attribute alone".
    const triState = (files, pick) => {
        const first = !!pick(files[0]);
        return files.every(f => !!pick(f) === first) ? first : null;
    };
    const setTriCheckbox = (chk, value) => {
        chk.indeterminate = (value === null);
        chk.checked = (value === true);
    };
    const readTriCheckbox = (chk) => (chk.indeterminate ? undefined : chk.checked);

    if (btnEditAttributes) {
        btnEditAttributes.addEventListener('click', () => {
            const targets = getAttributeTargets();
            if (targets.length === 0) return;
            const sparta = isSpartaFilesystem();

            attrFileNameLabel.textContent = targets.length === 1
                ? T(`Plik: {0}`, targets[0].fullName)
                : T(`Zaznaczone pliki: {0}`, targets.length);
            attrMixedHint.style.display = targets.length > 1 ? 'block' : 'none';

            // Only SDFS carries Hidden and Archive; everywhere else the
            // read-only bit is the whole attribute set.
            attrRowHidden.style.display = sparta ? 'flex' : 'none';
            attrRowArchive.style.display = sparta ? 'flex' : 'none';

            setTriCheckbox(chkAttrProtect, triState(targets, f => f.isProtected || f.isLocked));
            setTriCheckbox(chkAttrHidden, triState(targets, f => f.isHidden));
            setTriCheckbox(chkAttrArchive, triState(targets, f => f.isArchived));
            openModal(modalAttributes);
        });
    }

    if (btnSaveAttributesConfirm) {
        btnSaveAttributesConfirm.addEventListener('click', () => {
            const targets = getAttributeTargets();
            if (targets.length === 0) return;
            const sparta = isSpartaFilesystem();

            const attrs = { protected: readTriCheckbox(chkAttrProtect) };
            if (sparta) {
                attrs.hidden = readTriCheckbox(chkAttrHidden);
                attrs.archived = readTriCheckbox(chkAttrArchive);
            }

            const failed = [];
            let changed = 0;
            for (const file of targets) {
                try {
                    if (sparta) {
                        diskManager.setAttributes(file, attrs);
                    } else if (attrs.protected !== undefined) {
                        // Atari DOS 2, MyDOS and LiteDOS expose the bit through
                        // setLock; only SpartaDOS has a full attribute setter.
                        diskManager.setLock(file, attrs.protected);
                    }
                    changed++;
                } catch (err) {
                    failed.push(`${file.fullName}: ${err.message}`);
                }
            }

            closeModal(modalAttributes);
            refreshUI();

            if (failed.length > 0) {
                console.warn('ATRaction: nieudane zmiany atrybutów\n' + failed.join('\n'));
                showToast(T(`Zmieniono atrybuty {0} plików, {1} pominięto (szczegóły w konsoli).`,
                    changed, failed.length), 'error');
            } else if (targets.length === 1) {
                showToast(T(`Zaktualizowano atrybuty pliku {0}`, targets[0].fullName), 'success');
            } else {
                showToast(T(`Zaktualizowano atrybuty {0} plików.`, changed), 'success');
            }
        });
    }

    // -------------------------------------------------------------
    // ATASCII Directory Art View Modal
    // -------------------------------------------------------------
    function openDirAtasciiModal() {
        if (!diskManager.atr) return;

        // Formatted ATASCII Directory Listing
        const filesToDisplay = (currentFiles && currentFiles.length > 0) ? currentFiles : diskManager.getFiles();
        let formattedStr = '';

        // Top Header
        const dirTitle = activeDirPath ? `PATH: /${activeDirPath}` : `DIRECTORY: ${diskManager.dosType}`;
        const headerBytes = ATASCII.stringToBytes(dirTitle, false);
        formattedStr += ATASCII.bytesToAtariFontString(headerBytes) + '\n';
        formattedStr += ATASCII.bytesToAtariFontString(ATASCII.stringToBytes('--------------------', false)) + '\n';

        filesToDisplay.forEach(f => {
            const lineBytes = [];
            // Lock indicator
            lineBytes.push(f.isLocked || f.isProtected ? 0x2A : 0x20); // '*' or ' '
            lineBytes.push(0x20); // space

            // Name (8 bytes)
            if (f.nameBytes && f.nameBytes.length >= 8) {
                for (let i = 0; i < 8; i++) lineBytes.push(f.nameBytes[i]);
            } else {
                const namePadded = (f.name || '').padEnd(8, ' ');
                const nBytes = ATASCII.stringToBytes(namePadded, false);
                for (let i = 0; i < 8; i++) lineBytes.push(nBytes[i] || 0x20);
            }

            // Ext (3 bytes) - joined directly without any separator space
            if (f.extBytes && f.extBytes.length >= 3) {
                for (let i = 0; i < 3; i++) lineBytes.push(f.extBytes[i]);
            } else {
                const extPadded = (f.ext || '').padEnd(3, ' ');
                const eBytes = ATASCII.stringToBytes(extPadded, false);
                for (let i = 0; i < 3; i++) lineBytes.push(eBytes[i] || 0x20);
            }

            lineBytes.push(0x20); // space

            // Sectors / Size (4 bytes)
            const secVal = f.sectorCount !== undefined ? f.sectorCount : 0;
            const secStr = secVal.toString().padStart(4, ' ');
            const sBytes = ATASCII.stringToBytes(secStr, false);
            for (let i = 0; i < 4; i++) lineBytes.push(sBytes[i] || 0x20);

            lineBytes.push(0x9B); // EOL

            formattedStr += ATASCII.bytesToAtariFontString(new Uint8Array(lineBytes));
        });

        // Bottom Footer
        formattedStr += ATASCII.bytesToAtariFontString(ATASCII.stringToBytes('--------------------', false)) + '\n';
        const freeSecs = metricFreeSectors ? metricFreeSectors.textContent : '---';
        const footerStr = `${freeSecs} FREE SECTORS`;
        formattedStr += ATASCII.bytesToAtariFontString(ATASCII.stringToBytes(footerStr, false)) + '\n';

        dirAtasciiFormatted.textContent = formattedStr;

        openModal(modalDirAtascii);
    }

    if (btnDirAtascii) {
        btnDirAtascii.addEventListener('click', openDirAtasciiModal);
    }

    btnRenameFile.addEventListener('click', () => {
        if (!selectedFileObj) return;
        renameInput.value = selectedFileObj.fullName;
        openModal(modalRename);
    });

    btnRenameConfirm.addEventListener('click', () => {
        if (!selectedFileObj) return;
        const newName = renameInput.value.trim();
        if (!newName) return;

        try {
            const oldKey = markKey(selectedFileObj);
            diskManager.renameFile(selectedFileObj, newName);
            markedFiles.delete(oldKey);
            closeModal(modalRename);
            refreshUI();
            showToast(T(`Zmieniono nazwę na: {0}`, newName), 'success');
        } catch (err) {
            showToast(T(`Błąd zmiany nazwy: {0}`, err.message), 'error');
        }
    });

    // -------------------------------------------------------------
    // Preview & Hex Viewer Modal
    // -------------------------------------------------------------
    btnPreviewFile.addEventListener('click', () => openPreviewModal());

    function openPreviewModal() {
        if (!selectedFileObj || selectedFileObj.isDir) return;
        previewTitle.textContent = T(`Podgląd: {0}`, selectedFileObj.fullName);

        try {
            const rawBytes = diskManager.readFile(selectedFileObj);

            if (isAtariFontActive) {
                previewTextContent.textContent = ATASCII.bytesToAtariFontString(rawBytes);
            } else {
                previewTextContent.textContent = ATASCII.bytesToString(rawBytes, true);
            }
            previewHexContent.textContent = generateHexDump(rawBytes);

            // Reset scroll positions to top (0, 0)
            previewTextContent.scrollTop = 0;
            previewHexContent.scrollTop = 0;
            const modalBody = modalPreview.querySelector('.modal-body');
            if (modalBody) modalBody.scrollTop = 0;

            // Set text tab active
            tabText.classList.add('active');
            tabHex.classList.remove('active');
            previewTextContent.style.display = 'block';
            previewHexContent.style.display = 'none';

            openModal(modalPreview);

            setTimeout(() => {
                previewTextContent.scrollTop = 0;
                previewHexContent.scrollTop = 0;
                if (modalBody) modalBody.scrollTop = 0;
            }, 10);
        } catch (err) {
            showToast(T(`Błąd podglądu pliku: {0}`, err.message), 'error');
        }
    }

    tabText.addEventListener('click', () => {
        tabText.classList.add('active');
        tabHex.classList.remove('active');
        previewTextContent.style.display = 'block';
        previewHexContent.style.display = 'none';
        previewTextContent.scrollTop = 0;
    });

    tabHex.addEventListener('click', () => {
        tabHex.classList.add('active');
        tabText.classList.remove('active');
        previewHexContent.style.display = 'block';
        previewTextContent.style.display = 'none';
        previewHexContent.scrollTop = 0;
    });

    const btnToggleAtariFont = document.getElementById('btnToggleAtariFont');
    let isAtariFontActive = false;

    if (btnToggleAtariFont) {
        btnToggleAtariFont.addEventListener('click', () => {
            isAtariFontActive = !isAtariFontActive;
            if (isAtariFontActive) {
                previewTextContent.classList.add('use-atari-font');
                previewHexContent.classList.add('use-atari-font');
                btnToggleAtariFont.classList.add('btn-primary');
                btnToggleAtariFont.classList.remove('btn-secondary');
                btnToggleAtariFont.innerHTML = `
                    <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg>
                    Font: ATASCII
                `;
            } else {
                previewTextContent.classList.remove('use-atari-font');
                previewHexContent.classList.remove('use-atari-font');
                btnToggleAtariFont.classList.add('btn-secondary');
                btnToggleAtariFont.classList.remove('btn-primary');
                btnToggleAtariFont.innerHTML = `
                    <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 5h12M9 5v14m0 0H7m2 0h2m4-4h6m-3-3v6m0 0h-2m2 0h2"/></svg>
                    Font: PC
                `;
            }

            // Re-render preview content with active font mapping
            if (selectedFileObj) {
                try {
                    const rawBytes = diskManager.readFile(selectedFileObj);
                    if (isAtariFontActive) {
                        previewTextContent.textContent = ATASCII.bytesToAtariFontString(rawBytes);
                    } else {
                        previewTextContent.textContent = ATASCII.bytesToString(rawBytes, true);
                    }
                    previewHexContent.textContent = generateHexDump(rawBytes);
                } catch (err) {}
            }
        });
    }

    function hexViewerAsciiChar(b, isAtariFont) {
        b = b & 0xFF;
        if (isAtariFont) {
            return String.fromCharCode(b + 0xE000);
        }

        // Standard font fallback
        if (b === 0x9B || b === 0x0A || b === 0x0D || b === 0x00) {
            return '.';
        }
        const char = ATASCII.byteToChar(b);
        return (char === '\n' || char === '\r' || char === '\0') ? '.' : char;
    }

    function generateHexDump(bytes) {
        let dump = '';
        for (let i = 0; i < bytes.length; i += 16) {
            const addrHex = i.toString(16).padStart(6, '0').toUpperCase();
            let hexBytes = '';
            let asciiChars = '';

            for (let j = 0; j < 16; j++) {
                if (i + j < bytes.length) {
                    const b = bytes[i + j];
                    hexBytes += b.toString(16).padStart(2, '0').toUpperCase() + ' ';
                    asciiChars += hexViewerAsciiChar(b, isAtariFontActive);
                } else {
                    hexBytes += '   ';
                }
            }
            dump += `$${addrHex}: ${hexBytes} | ${asciiChars}\n`;
        }
        return dump;
    }

    // -------------------------------------------------------------
    // Drag & Drop Handlers
    // -------------------------------------------------------------
    dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropOverlay.classList.add('active');
    });

    dropZone.addEventListener('dragleave', (e) => {
        if (e.relatedTarget === null || !dropZone.contains(e.relatedTarget)) {
            dropOverlay.classList.remove('active');
        }
    });

    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropOverlay.classList.remove('active');

        const files = e.dataTransfer.files;
        if (!files || files.length === 0) return;

        if (files.length === 1 && (files[0].name.toLowerCase().endsWith('.atr') || files[0].name.toLowerCase().endsWith('.xfd'))) {
            const firstFile = files[0];
            const reader = new FileReader();
            reader.onload = (event) => {
                loadATRBuffer(new Uint8Array(event.target.result), firstFile.name);
            };
            reader.readAsArrayBuffer(firstFile);
        } else {
            processBatchImport(files);
        }
    });

    // -------------------------------------------------------------
    // Language Toggle (PL / EN)
    // -------------------------------------------------------------
    const btnLangToggle = document.getElementById('btnLangToggle');
    const btnLangToggleLabel = document.getElementById('btnLangToggleLabel');

    function updateLangToggleLabel() {
        if (btnLangToggleLabel) btnLangToggleLabel.textContent = (getLang() === 'en') ? 'PL' : 'EN';
    }

    function refreshDynamicTranslations() {
        // Static HTML (data-i18n / -html / -title / -placeholder) is handled by applyStaticTranslations().
        // Everything below is generated at runtime and must be re-rendered to pick up the new language.
        const wasLoaded = currentDiskBadge && currentDiskBadge.classList.contains('loaded');
        updateActiveDiskBadge(wasLoaded ? currentDiskBadge.title : undefined);
        refreshUI();

        // applyStaticTranslations() has just restored the preview modal's generic
        // heading from its data-i18n original; put the previewed file name back.
        if (modalPreview.classList.contains('active') && selectedFileObj) {
            previewTitle.textContent = T(`Podgląd: {0}`, selectedFileObj.fullName);
        }
    }

    if (btnLangToggle) {
        btnLangToggle.addEventListener('click', () => {
            setLang(getLang() === 'en' ? 'pl' : 'en');
            applyStaticTranslations();
            updateLangToggleLabel();
            refreshDynamicTranslations();
        });
    }

    // Apply any previously saved language preference (localStorage) right away on load.
    applyStaticTranslations();
    updateLangToggleLabel();
});
