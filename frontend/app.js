(() => {
    const state = {
        currentPath: '',
        items: [],
        selectedIndex: null,
        dragSource: null,
        contextMenu: { visible: false, file: null },
    };

    const elements = {
        breadcrumbs: document.getElementById('breadcrumbs'),
        fileTableBody: document.getElementById('file-table-body'),
        emptyState: document.getElementById('empty-state'),
        dropzone: document.getElementById('dropzone'),
        fileInput: document.getElementById('file-input'),
        createFolderBtn: document.getElementById('create-folder-btn'),
        deleteBtn: document.getElementById('delete-btn'),
        renameBtn: document.getElementById('rename-btn'),
        downloadBtn: document.getElementById('download-btn'),
        shareBtn: document.getElementById('share-btn'),
        unshareBtn: document.getElementById('unshare-btn'),
        logoutBtn: document.getElementById('logout-btn'),
        modalBackdrop: document.getElementById('modal-backdrop'),
        modalTitle: document.getElementById('modal-title'),
        modalInput: document.getElementById('modal-input'),
        linkCardsContainer: document.getElementById('link-cards-container'),
        modalMessage: document.getElementById('modal-message'),
        modalCancel: document.getElementById('modal-cancel'),
        modalOk: document.getElementById('modal-ok'),
        toast: document.getElementById('toast'),
        contextMenu: null,
    };

    // Cache for share status
    const shareStatusCache = new Map();

    function showToast(message) {
        const t = elements.toast;
        t.textContent = message;
        t.style.display = 'block';
        clearTimeout(showToast._timer);
        showToast._timer = setTimeout(() => {
            t.style.display = 'none';
        }, 3000);
    }

    function apiFetch(url, options = {}) {
        const opts = {
            ...options,
            headers: {
                'Accept': 'application/json',
                ...(options.headers || {}),
            },
        };

        return fetch(url, opts).then(async (resp) => {
            if (resp.status === 401) {
                window.location.href = '/login.html';
                return Promise.reject(new Error('Unauthorized'));
            }
            let data = null;
            const text = await resp.text();
            if (text) {
                try {
                    data = JSON.parse(text);
                } catch {
                    data = text;
                }
            }
            if (!resp.ok) {
                const detail = data && typeof data === 'object' && data.detail
                    ? (Array.isArray(data.detail) ? data.detail[0].msg || data.detail[0] : data.detail)
                    : resp.statusText;
                throw new Error(detail || 'Ошибка запроса');
            }
            return data;
        });
    }

    function formatBytes(bytes) {
        if (bytes === 0) return '0 Б';
        const k = 1024;
        const sizes = ['Б', 'КБ', 'МБ', 'ГБ', 'ТБ'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        const num = bytes / Math.pow(k, i);
        return `${num.toFixed(num >= 10 ? 0 : 1)} ${sizes[i]}`;
    }

    function formatDate(timestamp) {
        const d = new Date(timestamp * 1000);
        return d.toLocaleString();
    }

    async function updateSelection(index) {
        state.selectedIndex = index;
        const rows = elements.fileTableBody.querySelectorAll('.file-row');
        rows.forEach((row, idx) => {
            row.classList.toggle('selected', idx === index);
        });

        const selected = state.items[index] || null;
        const hasSelection = !!selected;

        elements.deleteBtn.disabled = !hasSelection;
        elements.renameBtn.disabled = !hasSelection;
        elements.shareBtn.disabled = !hasSelection || (selected && selected.is_dir);
        elements.downloadBtn.disabled = !hasSelection || (selected && selected.is_dir);

        // Check share status for unshare button
        if (hasSelection && selected && !selected.is_dir) {
            try {
                const status = await checkShareStatus(selected.path);
                elements.unshareBtn.disabled = !status.has_link;
            } catch (err) {
                console.error('Failed to check share status:', err);
                elements.unshareBtn.disabled = true;
            }
        } else {
            elements.unshareBtn.disabled = true;
        }
    }

    async function checkShareStatus(filePath) {
        // Check cache first
        if (shareStatusCache.has(filePath)) {
            return shareStatusCache.get(filePath);
        }

        try {
            const qs = `?path=${encodeURIComponent(filePath)}`;
            const status = await apiFetch(`/files/share/status${qs}`);
            shareStatusCache.set(filePath, status);
            return status;
        } catch (err) {
            // If error, assume no link
            const status = { has_link: false };
            shareStatusCache.set(filePath, status);
            return status;
        }
    }

    function isAncestorPath(parent, child) {
        if (!parent) return false;
        if (parent === child) return true;
        const prefix = parent.endsWith('/') ? parent : parent + '/';
        return child.startsWith(prefix);
    }

    async function moveItem(sourcePath, targetDir) {
        await apiFetch('/files/move', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                source_path: sourcePath,
                target_dir: targetDir || '',
            }),
        });
        showToast('Перемещено');
        loadList(state.currentPath);
    }

    function isArchiveFile(name) {
        const lower = name.toLowerCase();
        return lower.endsWith('.zip') || lower.endsWith('.tar') || lower.endsWith('.tar.gz') || lower.endsWith('.tgz');
    }

    function createContextMenuElement() {
        if (elements.contextMenu) return;
        const menu = document.createElement('div');
        menu.id = 'context-menu';
        menu.className = 'context-menu';
        menu.style.display = 'none';
        document.body.appendChild(menu);
        elements.contextMenu = menu;

        document.addEventListener('click', (e) => {
            if (!menu.contains(e.target) && !e.target.closest('.file-actions-btn')) {
                hideContextMenu();
            }
        });
    }

    function hideContextMenu() {
        if (!elements.contextMenu) return;
        elements.contextMenu.style.display = 'none';
        state.contextMenu = { visible: false, file: null };
    }

    function openContextMenuForFile(file, anchorEl) {
        if (!elements.contextMenu) {
            createContextMenuElement();
        }
        const menu = elements.contextMenu;
        menu.innerHTML = '';

        if (isArchiveFile(file.name)) {
            const item = document.createElement('div');
            item.className = 'context-menu-item';
            item.innerHTML = '<span>📦</span> Разархивировать…';
            item.addEventListener('click', (e) => {
                e.stopPropagation();
                hideContextMenu();
                openUnarchiveModeDialog(file);
            });
            menu.appendChild(item);
        }

        if (!menu.children.length) {
            return;
        }

        const rect = anchorEl.getBoundingClientRect();
        const menuWidth = 220;
        menu.style.minWidth = `${menuWidth}px`;
        let top = rect.bottom + window.scrollY + 4;
        let left = rect.right + window.scrollX - menuWidth;

        // Проверка, чтобы меню не выходило за границы экрана
        if (left < 0) {
            left = rect.left + window.scrollX;
        }
        if (top + 100 > window.innerHeight + window.scrollY) {
            top = rect.top + window.scrollY - 100;
        }

        menu.style.top = `${top}px`;
        menu.style.left = `${left}px`;
        menu.style.display = 'block';

        state.contextMenu = { visible: true, file };
    }

    async function unarchiveFile(path, mode) {
        await apiFetch('/files/unarchive', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ path, mode }),
        });
        showToast('Архив разархивирован');
        loadList(state.currentPath);
    }

    function openUnarchiveModeDialog(file) {
        const originalOk = elements.modalOk.textContent;
        const originalCancel = elements.modalCancel.textContent;

        elements.modalOk.innerHTML = '<span>📁</span> В эту папку';
        elements.modalCancel.innerHTML = '<span>📂</span> В новую папку';

        const restoreLabels = () => {
            elements.modalOk.textContent = originalOk;
            elements.modalCancel.textContent = originalCancel;
        };

        openModal({
            title: 'Разархивировать архив',
            showInput: false,
            message: `Выберите, куда разархивировать архив «${file.name}»:`,
            linkCards: null,
            onOk: async () => {
                try {
                    await unarchiveFile(file.path, 'same_folder');
                } catch (err) {
                    console.error(err);
                    showToast(err.message || 'Не удалось разархивировать');
                } finally {
                    restoreLabels();
                }
            },
        });

        const handleCancelClick = async (e) => {
            e.stopPropagation();
            elements.modalCancel.removeEventListener('click', handleCancelClick);
            try {
                await unarchiveFile(file.path, 'new_subfolder');
            } catch (err) {
                console.error(err);
                showToast(err.message || 'Не удалось разархивировать');
            } finally {
                restoreLabels();
            }
        };

        elements.modalCancel.addEventListener('click', handleCancelClick);
    }

    function buildBreadcrumbs(path) {
        const container = elements.breadcrumbs;
        container.innerHTML = '';

        const segments = path ? path.split('/') : [];
        const parts = [{ name: 'Корень', path: '' }];
        let accum = '';
        for (const segment of segments) {
            accum = accum ? `${accum}/${segment}` : segment;
            parts.push({ name: segment, path: accum });
        }

        parts.forEach((part, idx) => {
            const span = document.createElement('span');
            span.className = 'breadcrumb-segment';
            span.textContent = part.name || 'Корень';
            span.addEventListener('click', () => {
                navigateTo(part.path);
            });

            // Drag & drop на хлебные крошки
            span.addEventListener('dragover', (e) => {
                if (!state.dragSource) return;
                e.preventDefault();
                if (e.dataTransfer) {
                    e.dataTransfer.dropEffect = 'move';
                }
            });

            span.addEventListener('drop', async (e) => {
                if (!state.dragSource) return;
                e.preventDefault();
                const targetDir = part.path; // '' для корня
                if (state.dragSource.is_dir && isAncestorPath(state.dragSource.path, targetDir)) {
                    showToast('Нельзя переместить папку внутрь самой себя');
                    return;
                }
                try {
                    await moveItem(state.dragSource.path, targetDir);
                } catch (err) {
                    console.error(err);
                    showToast(err.message || 'Не удалось переместить');
                }
            });

            container.appendChild(span);

            if (idx < parts.length - 1) {
                const sep = document.createElement('span');
                sep.className = 'breadcrumb-separator';
                sep.textContent = '/';
                container.appendChild(sep);
            }
        });
    }

    async function renderList() {
        const tbody = elements.fileTableBody;
        tbody.innerHTML = '';

        if (!state.items.length) {
            elements.emptyState.style.display = 'block';
        } else {
            elements.emptyState.style.display = 'none';
        }

        // Check share status for all files
        const statusPromises = state.items
            .filter(item => !item.is_dir)
            .map(item => checkShareStatus(item.path).then(status => ({ path: item.path, status })));

        const statuses = await Promise.all(statusPromises);
        const statusMap = new Map(statuses.map(s => [s.path, s.status]));

        state.items.forEach((item, index) => {
            const tr = document.createElement('tr');
            tr.className = 'file-row';

            const tdName = document.createElement('td');
            tdName.className = 'file-name';
            const icon = document.createElement('span');
            icon.className = 'file-icon';
            icon.textContent = item.is_dir ? '📁' : '📄';
            const nameSpan = document.createElement('span');
            nameSpan.textContent = item.name;

            // Add share indicator for files with active links
            if (!item.is_dir) {
                const fileStatus = statusMap.get(item.path);
                if (fileStatus && fileStatus.has_link) {
                    const shareIndicator = document.createElement('span');
                    shareIndicator.className = 'file-share-indicator';
                    shareIndicator.textContent = ' 🔗';
                    shareIndicator.title = 'Публичная ссылка активна';
                    nameSpan.appendChild(shareIndicator);
                }
            }

            tdName.appendChild(icon);
            tdName.appendChild(nameSpan);

            // Кнопка "три точки" для файлов
            if (!item.is_dir) {
                const actionsBtn = document.createElement('button');
                actionsBtn.type = 'button';
                actionsBtn.className = 'file-actions-btn';
                actionsBtn.textContent = '⋯';
                actionsBtn.title = 'Действия';
                actionsBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    openContextMenuForFile(item, actionsBtn);
                });
                tdName.appendChild(actionsBtn);
            }

            const tdType = document.createElement('td');
            tdType.className = 'file-type';
            tdType.textContent = item.is_dir ? 'Папка' : 'Файл';

            const tdSize = document.createElement('td');
            tdSize.className = 'file-size';
            tdSize.textContent = item.is_dir ? '' : formatBytes(item.size);

            const tdModified = document.createElement('td');
            tdModified.className = 'file-modified';
            tdModified.textContent = formatDate(item.modified_at);

            tr.appendChild(tdName);
            tr.appendChild(tdType);
            tr.appendChild(tdSize);
            tr.appendChild(tdModified);

            // Drag & drop для перемещения
            tr.draggable = true;

            tr.addEventListener('dragstart', (e) => {
                state.dragSource = { path: item.path, is_dir: item.is_dir };
                tr.classList.add('dragging');
                if (e.dataTransfer) {
                    e.dataTransfer.effectAllowed = 'move';
                }
            });

            tr.addEventListener('dragend', () => {
                state.dragSource = null;
                tr.classList.remove('dragging');
                // Убрать drop-target со всех строк
                document.querySelectorAll('.file-row.drop-target').forEach(row => {
                    row.classList.remove('drop-target');
                });
            });

            // Для папок - обработка drop
            if (item.is_dir) {
                tr.addEventListener('dragenter', (e) => {
                    if (!state.dragSource || state.dragSource.path === item.path) return;
                    if (state.dragSource.is_dir && isAncestorPath(state.dragSource.path, item.path)) return;
                    e.preventDefault();
                    tr.classList.add('drop-target');
                });

                tr.addEventListener('dragover', (e) => {
                    if (!state.dragSource || state.dragSource.path === item.path) return;
                    if (state.dragSource.is_dir && isAncestorPath(state.dragSource.path, item.path)) return;
                    e.preventDefault();
                    if (e.dataTransfer) {
                        e.dataTransfer.dropEffect = 'move';
                    }
                    tr.classList.add('drop-target');
                });

                tr.addEventListener('dragleave', (e) => {
                    // Проверяем, что мы действительно покидаем элемент (не переходим на дочерний)
                    if (!e.currentTarget.contains(e.relatedTarget)) {
                        tr.classList.remove('drop-target');
                    }
                });

                tr.addEventListener('drop', async (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    tr.classList.remove('drop-target');
                    if (!state.dragSource || state.dragSource.path === item.path) return;
                    if (state.dragSource.is_dir && isAncestorPath(state.dragSource.path, item.path)) {
                        showToast('Нельзя переместить папку внутрь самой себя');
                        return;
                    }
                    try {
                        await moveItem(state.dragSource.path, item.path);
                    } catch (err) {
                        console.error(err);
                        showToast(err.message || 'Не удалось переместить');
                    }
                });
            }

            tr.addEventListener('click', (event) => {
                if (event.detail === 2) {
                    if (item.is_dir) {
                        navigateTo(item.path);
                    } else {
                        updateSelection(index);
                    }
                } else {
                    updateSelection(index);
                }
            });

            tbody.appendChild(tr);
        });

        updateSelection(null);
    }

    function navigateTo(path) {
        loadList(path);
    }

    function loadList(path) {
        const effectivePath = (path || '').replace(/^\/+/, '');
        const qs = effectivePath ? `?path=${encodeURIComponent(effectivePath)}` : '';
        // Clear share status cache when loading new directory
        shareStatusCache.clear();
        apiFetch(`/files/list${qs}`)
            .then((data) => {
                state.currentPath = data.current_path || '';
                state.items = data.items || [];
                buildBreadcrumbs(state.currentPath);
                renderList();
            })
            .catch((err) => {
                console.error(err);
                showToast(err.message || 'Не удалось загрузить список файлов');
            });
    }

    function openModal({ title, placeholder, initialValue = '', message = '', linkCards = null, onOk, showInput = true }) {
        elements.modalTitle.textContent = title;
        elements.modalInput.value = initialValue;
        elements.modalInput.placeholder = placeholder || '';
        elements.modalInput.style.display = showInput ? 'block' : 'none';
        elements.modalMessage.textContent = message || '';
        elements.modalMessage.style.display = message ? 'block' : 'none';

        // Clear and populate link cards container
        elements.linkCardsContainer.innerHTML = '';
        if (linkCards && linkCards.length > 0) {
            linkCards.forEach(card => {
                elements.linkCardsContainer.appendChild(card);
            });
            elements.linkCardsContainer.style.display = 'flex';
        } else {
            elements.linkCardsContainer.style.display = 'none';
        }

        elements.modalBackdrop.style.display = 'flex';
        if (showInput) {
            elements.modalInput.focus();
        }

        function cleanup() {
            elements.modalBackdrop.style.display = 'none';
            elements.modalOk.removeEventListener('click', handleOk);
            elements.modalCancel.removeEventListener('click', handleCancel);
        }

        function handleOk() {
            const value = elements.modalInput.value.trim();
            cleanup();
            if (onOk) onOk(value);
        }

        function handleCancel() {
            cleanup();
        }

        elements.modalOk.addEventListener('click', handleOk);
        elements.modalCancel.addEventListener('click', handleCancel);
    }

    function createLinkCard(label, url) {
        const card = document.createElement('div');
        card.className = 'link-card';

        const labelDiv = document.createElement('div');
        labelDiv.className = 'link-label';
        const isDirect = label.includes('Прямая');
        const icon = document.createElement('span');
        icon.textContent = isDirect ? '⚡' : '🌐';
        icon.style.marginRight = '8px';
        icon.style.fontSize = '16px';
        labelDiv.appendChild(icon);
        const labelText = document.createTextNode(label);
        labelDiv.appendChild(labelText);

        const urlContainer = document.createElement('div');
        urlContainer.className = 'link-url-container';

        const urlCode = document.createElement('code');
        urlCode.className = 'link-url';
        urlCode.textContent = url;

        const copyBtn = document.createElement('button');
        copyBtn.className = 'link-copy-btn';
        const copyIcon = document.createElement('span');
        copyIcon.textContent = '📋';
        copyIcon.style.marginRight = '6px';
        copyBtn.appendChild(copyIcon);
        const copyText = document.createTextNode('Копировать');
        copyBtn.appendChild(copyText);
        copyBtn.addEventListener('click', () => {
            if (navigator.clipboard) {
                navigator.clipboard.writeText(url)
                    .then(() => {
                        copyIcon.textContent = '✓';
                        copyText.textContent = ' Скопировано!';
                        setTimeout(() => {
                            copyIcon.textContent = '📋';
                            copyText.textContent = ' Копировать';
                        }, 2000);
                    })
                    .catch(() => {
                        showToast('Не удалось скопировать ссылку');
                    });
            } else {
                // Fallback: select text
                const range = document.createRange();
                range.selectNode(urlCode);
                window.getSelection().removeAllRanges();
                window.getSelection().addRange(range);
                try {
                    document.execCommand('copy');
                    copyIcon.textContent = '✓';
                    copyText.textContent = ' Скопировано!';
                    setTimeout(() => {
                        copyIcon.textContent = '📋';
                        copyText.textContent = ' Копировать';
                    }, 2000);
                } catch (err) {
                    showToast('Не удалось скопировать ссылку');
                }
            }
        });

        urlContainer.appendChild(urlCode);
        urlContainer.appendChild(copyBtn);
        card.appendChild(labelDiv);
        card.appendChild(urlContainer);

        return card;
    }

    function handleCreateFolder() {
        openModal({
            title: 'Новая папка',
            placeholder: 'Имя папки',
            onOk: (name) => {
                if (!name) return;
                apiFetch('/files/folder', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({ path: state.currentPath, name }),
                })
                    .then(() => {
                        showToast('Папка создана');
                        loadList(state.currentPath);
                    })
                    .catch((err) => {
                        console.error(err);
                        showToast(err.message || 'Не удалось создать папку');
                    });
            },
        });
    }

    function handleDelete() {
        const selected = state.items[state.selectedIndex];
        if (!selected) return;

        const confirmed = window.confirm(`Удалить «${selected.name}»?${selected.is_dir ? ' Папка будет удалена вместе со всем содержимым.' : ''}`);
        if (!confirmed) return;

        apiFetch('/files/delete', {
            method: 'DELETE',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ path: selected.path }),
        })
            .then(() => {
                showToast('Удалено');
                loadList(state.currentPath);
            })
            .catch((err) => {
                console.error(err);
                showToast(err.message || 'Не удалось удалить');
            });
    }

    function handleRename() {
        const selected = state.items[state.selectedIndex];
        if (!selected) return;

        openModal({
            title: 'Переименовать',
            initialValue: selected.name,
            onOk: (newName) => {
                if (!newName || newName === selected.name) return;

                apiFetch('/files/rename', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        old_path: selected.path,
                        new_name: newName,
                    }),
                })
                    .then(() => {
                        showToast('Переименовано');
                        loadList(state.currentPath);
                    })
                    .catch((err) => {
                        console.error(err);
                        showToast(err.message || 'Не удалось переименовать');
                    });
            },
        });
    }

    function handleDownload() {
        const selected = state.items[state.selectedIndex];
        if (!selected || selected.is_dir) return;

        const url = `/files/download?path=${encodeURIComponent(selected.path)}`;
        window.location.href = url;
    }

    function handleShare() {
        const selected = state.items[state.selectedIndex];
        if (!selected || selected.is_dir) return;

        apiFetch('/files/share', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ path: selected.path }),
        })
            .then((data) => {
                const directUrl = data.direct_url || data.url || '';
                const pageUrl = data.page_url || '';

                // If link already exists, ask user what to do
                if (data.exists) {
                    const choice = window.confirm(
                        'У этого файла уже есть публичная ссылка. Показать существующую или создать новую?\n\n' +
                        'OK - показать существующую\nОтмена - создать новую'
                    );

                    if (!choice) {
                        // User wants to create new - delete old and create new
                        return apiFetch('/files/share', {
                            method: 'DELETE',
                            headers: {
                                'Content-Type': 'application/json',
                            },
                            body: JSON.stringify({ path: selected.path }),
                        }).then(() => {
                            // Now create new link
                            return apiFetch('/files/share', {
                                method: 'POST',
                                headers: {
                                    'Content-Type': 'application/json',
                                },
                                body: JSON.stringify({ path: selected.path }),
                            });
                        }).then((newData) => {
                            showShareModal(newData.direct_url || newData.url || '', newData.page_url || '');
                            shareStatusCache.delete(selected.path);
                            loadList(state.currentPath);
                        });
                    }
                }

                showShareModal(directUrl, pageUrl);
                shareStatusCache.delete(selected.path);
                loadList(state.currentPath);
            })
            .catch((err) => {
                console.error(err);
                showToast(err.message || 'Не удалось получить ссылку');
            });
    }

    function showShareModal(directUrl, pageUrl) {
        const linkCards = [];

        if (directUrl) {
            linkCards.push(createLinkCard('Прямая ссылка (сразу скачивает файл)', directUrl));
        }
        if (pageUrl) {
            linkCards.push(createLinkCard('Страница скачивания (непрямая ссылка)', pageUrl));
        }

        openModal({
            title: 'Публичная ссылка',
            showInput: false,
            message: linkCards.length > 0 ? 'Этой ссылкой можно поделиться — файл будет доступен без авторизации.' : '',
            linkCards: linkCards,
            onOk: () => {
                // Just close modal
            },
        });
    }

    function handleUnshare() {
        const selected = state.items[state.selectedIndex];
        if (!selected || selected.is_dir) return;

        const confirmed = window.confirm(
            `Закрыть публичный доступ к файлу «${selected.name}»?\n\n` +
            'После этого файл нельзя будет скачать по публичным ссылкам.'
        );
        if (!confirmed) return;

        apiFetch('/files/share', {
            method: 'DELETE',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ path: selected.path }),
        })
            .then(() => {
                showToast('Публичный доступ закрыт');
                shareStatusCache.delete(selected.path);
                loadList(state.currentPath);
                updateSelection(state.selectedIndex);
            })
            .catch((err) => {
                console.error(err);
                showToast(err.message || 'Не удалось закрыть доступ');
            });
    }

    function handleFilesSelected(files) {
        if (!files || !files.length) return;

        const formData = new FormData();
        formData.append('path', state.currentPath || '');
        Array.from(files).forEach((file) => {
            formData.append('files', file);
        });

        apiFetch('/files/upload', {
            method: 'POST',
            body: formData,
        })
            .then(() => {
                showToast('Файлы загружены');
                loadList(state.currentPath);
            })
            .catch((err) => {
                console.error(err);
                showToast(err.message || 'Не удалось загрузить файлы');
            });
    }

    function setupDragAndDrop() {
        const dz = elements.dropzone;

        ['dragenter', 'dragover'].forEach((eventName) => {
            dz.addEventListener(eventName, (e) => {
                e.preventDefault();
                e.stopPropagation();
                dz.classList.add('dragover');
            });
        });

        ['dragleave', 'drop'].forEach((eventName) => {
            dz.addEventListener(eventName, (e) => {
                e.preventDefault();
                e.stopPropagation();
                if (eventName === 'drop') {
                    const dt = e.dataTransfer;
                    const files = dt && dt.files;
                    handleFilesSelected(files);
                }
                dz.classList.remove('dragover');
            });
        });

        document.addEventListener('dragover', (e) => {
            e.preventDefault();
        });
        document.addEventListener('drop', (e) => {
            e.preventDefault();
        });
    }

    function setupEvents() {
        elements.createFolderBtn.addEventListener('click', handleCreateFolder);
        elements.deleteBtn.addEventListener('click', handleDelete);
        elements.renameBtn.addEventListener('click', handleRename);
        elements.downloadBtn.addEventListener('click', handleDownload);
        elements.shareBtn.addEventListener('click', handleShare);
        elements.unshareBtn.addEventListener('click', handleUnshare);

        elements.fileInput.addEventListener('change', (e) => {
            handleFilesSelected(e.target.files);
            elements.fileInput.value = '';
        });

        elements.logoutBtn.addEventListener('click', () => {
            apiFetch('/auth/logout', {
                method: 'POST',
            }).finally(() => {
                window.location.href = '/login.html';
            });
        });

        setupDragAndDrop();
    }

    function init() {
        createContextMenuElement();
        setupEvents();
        loadList('');
    }

    window.addEventListener('DOMContentLoaded', init);
})();

