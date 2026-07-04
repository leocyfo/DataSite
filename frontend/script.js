function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function showToast(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  toast.addEventListener('click', () => toast.remove());
  container.appendChild(toast);
  setTimeout(() => {
    toast.classList.add('toast-out');
    toast.addEventListener('animationend', () => toast.remove());
  }, 4000);
}

function showConfirm(message, title = 'Confirmer') {
  const modal = document.getElementById('modalConfirm');
  document.getElementById('confirmTitle').textContent = title;
  document.getElementById('confirmMessage').textContent = message;
  modal.classList.add('open');

  return new Promise(resolve => {
    const okBtn = document.getElementById('confirmOk');
    const cancelBtn = document.getElementById('confirmCancel');

    const cleanup = (result) => {
      modal.classList.remove('open');
      okBtn.removeEventListener('click', onOk);
      cancelBtn.removeEventListener('click', onCancel);
      modal.removeEventListener('click', onOverlay);
      resolve(result);
    };
    const onOk = () => cleanup(true);
    const onCancel = () => cleanup(false);
    const onOverlay = (e) => { if (e.target === modal) cleanup(false); };

    okBtn.addEventListener('click', onOk);
    cancelBtn.addEventListener('click', onCancel);
    modal.addEventListener('click', onOverlay);
  });
}

let databases = [];
let currentDb = null;
let currentTable = null;
let currentTableData = { columns: [], columnTypes: {}, rows: [] };
let searchQuery = '';
let sortState = { column: null, dir: 'asc' };
let currentPage = 1;
const PAGE_SIZE = 50;
let selectedRowIds = new Set();
let undoStack = [];
let redoStack = [];
const UNDO_LIMIT = 20;

function resetTableView() {
  searchQuery = '';
  sortState = { column: null, dir: 'asc' };
  currentPage = 1;
  selectedRowIds = new Set();
  undoStack = [];
  redoStack = [];
  const searchInput = document.getElementById('searchInput');
  if (searchInput) searchInput.value = '';
  updateUndoButton();
  updateRedoButton();
  updateSelectionUi();
}

function updateUndoButton() {
  const btn = document.getElementById('btnUndo');
  if (!btn) return;
  btn.disabled = undoStack.length === 0;
  btn.title = undoStack.length
    ? `Annuler la dernière modification de cellule (${undoStack.length} en mémoire)`
    : 'Annuler la dernière modification de cellule';
}

function updateRedoButton() {
  const btn = document.getElementById('btnRedo');
  if (!btn) return;
  btn.disabled = redoStack.length === 0;
  btn.title = redoStack.length
    ? `Rétablir la modification annulée (${redoStack.length} en mémoire)`
    : 'Rétablir la modification annulée';
}

function updateSelectionUi() {
  const btn = document.getElementById('btnDeleteSelected');
  if (!btn) return;
  if (selectedRowIds.size === 0) {
    btn.hidden = true;
  } else {
    btn.hidden = false;
    btn.textContent = `🗑 Supprimer (${selectedRowIds.size})`;
  }
}

function resolveRelationLabel(col, value) {
  const relation = (currentTableData.relations || []).find(r => r.column === col);
  if (!relation || value == null) return null;
  const options = (currentTableData.relationOptions && currentTableData.relationOptions[col]) || [];
  const match = options.find(o => String(o.id) === String(value));
  return match ? match.label : null;
}

function getDisplayRows() {
  let rows = currentTableData.rows || [];

  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    rows = rows.filter(row =>
      currentTableData.columns.some(col => {
        if (String(row[col] ?? '').toLowerCase().includes(q)) return true;
        const label = resolveRelationLabel(col, row[col]);
        return label != null && String(label).toLowerCase().includes(q);
      })
    );
  }

  if (sortState.column) {
    const col = sortState.column;
    const dir = sortState.dir === 'asc' ? 1 : -1;
    rows = [...rows].sort((a, b) => {
      const va = a[col];
      const vb = b[col];
      if (va == null && vb == null) return 0;
      if (va == null) return -1 * dir;
      if (vb == null) return 1 * dir;
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir;
      return String(va).localeCompare(String(vb)) * dir;
    });
  }

  return rows;
}

async function loadDatabases() {
  const res = await fetch('/api/databases');
  databases = await res.json();

  document.getElementById('sidebarFooter').innerHTML =
    `Node.js · SQLite<br>${databases.length} base${databases.length === 1 ? '' : 's'} connectée${databases.length === 1 ? '' : 's'}`;

  if (databases.length > 0) {
    // garde la base sélectionnée si elle existe encore, sinon prend la première
    const stillExistsDb = currentDb && databases.find(d => d.id === currentDb.id);
    currentDb = stillExistsDb ? databases.find(d => d.id === currentDb.id) : databases[0];

    // garde la table sélectionnée si elle existe encore, sinon prend la première
    const stillExistsTable = currentTable && currentDb.tables.find(t => t.name === currentTable.name);
    currentTable = stillExistsTable ? currentDb.tables.find(t => t.name === currentTable.name) : (currentDb.tables[0] || null);

    await loadTableData();
  } else {
    currentDb = null;
    currentTable = null;
    currentTableData = { columns: [], columnTypes: {}, rows: [] };
  }
  renderAll();
}

async function loadTableData() {
  if (!currentDb || !currentTable) {
    currentTableData = { columns: [], columnTypes: {}, rows: [] };
    return;
  }
  const res = await fetch(`/api/${currentDb.id}/${currentTable.name}`);
  currentTableData = await res.json();
}

function enableDragReorder(container, itemSelector, direction, onDrop) {
  let draggedEl = null;

  container.addEventListener('dragstart', (e) => {
    const item = e.target.closest(itemSelector);
    if (!item || !container.contains(item)) return;
    draggedEl = item;
    item.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
  });

  container.addEventListener('dragover', (e) => {
    if (!draggedEl) return;
    e.preventDefault();
    const item = e.target.closest(itemSelector);
    if (!item || item === draggedEl) return;

    const rect = item.getBoundingClientRect();
    const before = direction === 'vertical'
      ? (e.clientY - rect.top) < rect.height / 2
      : (e.clientX - rect.left) < rect.width / 2;

    if (before) {
      container.insertBefore(draggedEl, item);
    } else {
      container.insertBefore(draggedEl, item.nextSibling);
    }
  });

  container.addEventListener('dragend', () => {
    if (!draggedEl) return;
    draggedEl.classList.remove('dragging');
    draggedEl = null;
    const items = Array.from(container.querySelectorAll(itemSelector));
    onDrop(items);
  });
}

function renderSidebar() {
  const list = document.getElementById('dbList');
  list.innerHTML = '';

  if (databases.length === 0) {
    list.innerHTML = `<li class="db-empty">Aucune base pour l'instant.<br>Cliquez sur « + Nouvelle base ».</li>`;
    return;
  }

  databases.forEach(db => {
    const totalRows = db.tables.reduce((s, t) => s + t.rowCount, 0);
    const li = document.createElement('li');
    li.className = 'db-item' + (currentDb && db.id === currentDb.id ? ' active' : '');
    li.draggable = true;
    li.dataset.dbId = db.id;
    li.innerHTML = `
      <div class="db-item-left">
        <div class="db-icon">${escapeHtml(db.icon)}</div>
        <div class="db-meta">
          <div class="db-name">${escapeHtml(db.name)}</div>
          <div class="db-sub">${db.tables.length} tables · ${totalRows} lignes</div>
        </div>
      </div>
      <div class="db-item-right">
        <div class="db-status"></div>
        <button class="btn-rename-db" title="Renommer cette base">✎</button>
        <button class="btn-delete-db" title="Supprimer cette base">🗑</button>
      </div>
    `;

    li.querySelector('.btn-rename-db').addEventListener('click', async (e) => {
      e.stopPropagation();
      const newName = prompt('Nouveau nom de la base :', db.name);
      if (!newName || !newName.trim() || newName.trim() === db.name) return;

      try {
        const res = await fetch(`/api/databases/${db.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: newName.trim() })
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || 'Échec du renommage');
        }
        await loadDatabases();
      } catch (err) {
        showToast(err.message, 'error');
      }
    });

    li.querySelector('.btn-delete-db').addEventListener('click', async (e) => {
      e.stopPropagation(); // évite de sélectionner la base en cliquant sur la poubelle
      const confirmed = await showConfirm(`Supprimer définitivement « ${db.name} » et toutes ses données ?`, 'Supprimer la base');
      if (!confirmed) return;

      try {
        const res = await fetch(`/api/databases/${db.id}`, { method: 'DELETE' });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || 'Échec de la suppression');
        }

        if (currentDb && currentDb.id === db.id) {
          currentDb = null;
          currentTable = null;
        }
        await loadDatabases();
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
    li.addEventListener('click', async () => {
      currentDb = db;
      currentTable = db.tables[0] || null;
      resetTableView();
      await loadTableData();
      renderAll();
    });
    list.appendChild(li);
  });
}

function renderBreadcrumbPath(fullPath) {
  const dbPathEl = document.getElementById('dbPath');
  dbPathEl.dataset.fullPath = fullPath;

  const segments = fullPath.split('/').filter(s => s && s !== '.');
  dbPathEl.innerHTML = segments
    .map(seg => `<span class="crumb">${escapeHtml(seg)}</span>`)
    .join('<span class="crumb-sep">›</span>');
}

function renderTopbar() {
  if (!currentDb) {
    document.getElementById('dbTitle').textContent = 'Aucune base sélectionnée';
    renderBreadcrumbPath('—');
    document.getElementById('statRows').textContent = '0';
    document.getElementById('statTables').textContent = '0';
    return;
  }
  document.getElementById('dbTitle').textContent = currentDb.name;
  renderBreadcrumbPath(`./backend/db/${currentDb.name}`);
  const totalRows = currentDb.tables.reduce((s, t) => s + t.rowCount, 0);
  document.getElementById('statRows').textContent = totalRows;
  document.getElementById('statTables').textContent = currentDb.tables.length;
}

function renderTabs() {
  const tabsEl = document.getElementById('tabs');
  tabsEl.innerHTML = '';
  if (!currentDb) return;

  currentDb.tables.forEach(table => {
    const tab = document.createElement('div');
    tab.className = 'tab' + (currentTable && table.name === currentTable.name ? ' active' : '');
    tab.draggable = true;
    tab.dataset.tableName = table.name;
    tab.innerHTML = `<span>${escapeHtml(table.name)}</span><button class="btn-rename-tab" title="Renommer cette table">✎</button><button class="btn-delete-tab" title="Supprimer cette table">×</button>`;

    tab.querySelector('span').addEventListener('click', async () => {
      currentTable = table;
      resetTableView();
      await loadTableData();
      renderAll();
    });

    tab.querySelector('.btn-rename-tab').addEventListener('click', async (e) => {
      e.stopPropagation();
      const newName = prompt('Nouveau nom de la table :', table.name);
      if (!newName || !newName.trim() || newName.trim() === table.name) return;

      try {
        const res = await fetch(`/api/${currentDb.id}/tables/${table.name}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ newName: newName.trim() })
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || 'Échec du renommage');
        }
        if (currentTable && currentTable.name === table.name) {
          currentTable = { ...currentTable, name: newName.trim() };
        }
        await loadDatabases();
      } catch (err) {
        showToast(err.message, 'error');
      }
    });

    tab.querySelector('.btn-delete-tab').addEventListener('click', async (e) => {
      e.stopPropagation();
      const confirmed = await showConfirm(`Supprimer définitivement la table « ${table.name} » ?`, 'Supprimer la table');
      if (!confirmed) return;

      try {
        const res = await fetch(`/api/${currentDb.id}/tables/${table.name}`, { method: 'DELETE' });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || 'Échec de la suppression');
        }
        if (currentTable && currentTable.name === table.name) {
          currentTable = null;
        }
        await loadDatabases();
      } catch (err) {
        showToast(err.message, 'error');
      }
    });

    tabsEl.appendChild(tab);
  });

  const addTab = document.createElement('div');
  addTab.className = 'tab tab-add';
  addTab.textContent = '+ table';
  addTab.addEventListener('click', openNewTableModal);
  tabsEl.appendChild(addTab);

  const queryTab = document.createElement('div');
  queryTab.className = 'tab tab-add';
  queryTab.textContent = '🖥 SQL';
  queryTab.addEventListener('click', openQueryModal);
  tabsEl.appendChild(queryTab);
}

function renderContent() {
  const content = document.getElementById('content');
  const toolbar = document.getElementById('contentToolbar');
  const pagination = document.getElementById('pagination');

  if (!currentDb) {
    toolbar.classList.remove('visible');
    pagination.innerHTML = '';
    content.innerHTML = `
      <div class="empty-state">
        <div class="icon">🗂️</div>
        <div>Créez votre première base de données</div>
        <button class="btn-primary-empty" id="btnCreateFirstDb">+ Nouvelle base</button>
      </div>`;
    document.getElementById('btnCreateFirstDb')
      .addEventListener('click', openNewDbModal);
    return;
  }

  if (!currentTable) {
    toolbar.classList.remove('visible');
    pagination.innerHTML = '';
    content.innerHTML = `
      <div class="empty-state">
        <div class="icon">∅</div>
        <div>Cette base n'a pas encore de table</div>
        <button class="btn-primary-empty" id="btnCreateFirstTable">+ Créer une table</button>
      </div>`;
    document.getElementById('btnCreateFirstTable')
      .addEventListener('click', openNewTableModal);
    return;
  }

  toolbar.classList.add('visible');

  const { columns, columnTypes } = currentTableData;
  const allRows = currentTableData.rows || [];

  if (allRows.length === 0) {
    pagination.innerHTML = '';
    content.innerHTML = `
      <div class="empty-state">
        <div class="icon">∅</div>
        <div>Aucune donnée dans cette table</div>
      </div>`;
    return;
  }

  const filteredRows = getDisplayRows();

  if (filteredRows.length === 0) {
    pagination.innerHTML = '';
    content.innerHTML = `
      <div class="empty-state">
        <div class="icon">∅</div>
        <div>Aucun résultat pour « ${escapeHtml(searchQuery)} »</div>
      </div>`;
    return;
  }

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE));
  currentPage = Math.min(Math.max(1, currentPage), totalPages);
  const pageRows = filteredRows.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const pageRowIds = pageRows.map(r => String(r.id));
  const allPageSelected = pageRowIds.length > 0 && pageRowIds.every(id => selectedRowIds.has(id));

  let html = '<table><thead><tr>';
  html += `<th class="col-select"><input type="checkbox" id="selectAllCheckbox" ${allPageSelected ? 'checked' : ''}></th>`;
  columns.forEach(col => {
    const isSorted = sortState.column === col;
    const arrow = isSorted ? (sortState.dir === 'asc' ? ' ▲' : ' ▼') : '';
    html += `<th class="sortable" data-column="${escapeHtml(col)}">${escapeHtml(col)}${arrow}</th>`;
  });
  html += '<th class="col-actions"></th>';
  html += '</tr></thead><tbody>';

  pageRows.forEach(row => {
    const rowId = String(row.id);
    const isSelected = selectedRowIds.has(rowId);
    html += `<tr data-row-id="${escapeHtml(rowId)}"${isSelected ? ' class="row-selected"' : ''}>`;
    html += `<td class="col-select"><input type="checkbox" class="row-select" ${isSelected ? 'checked' : ''}></td>`;
    columns.forEach((col, i) => {
      const cell = row[col] ?? '';
      const isId = col === 'id';
      const relation = (currentTableData.relations || []).find(r => r.column === col);

      if (relation) {
        const options = (currentTableData.relationOptions && currentTableData.relationOptions[col]) || [];
        html += `<td class="rel-cell" data-column="${escapeHtml(col)}"><select class="rel-select">`;
        html += `<option value="">—</option>`;
        options.forEach(opt => {
          const isSelected = cell !== '' && String(opt.id) === String(cell);
          html += `<option value="${escapeHtml(opt.id)}"${isSelected ? ' selected' : ''}>${escapeHtml(opt.label)}</option>`;
        });
        html += `</select></td>`;
        return;
      }

      const isNum = !isId && typeof row[col] === 'number';
      const cls = isId ? 'col-id' : `editable ${isNum ? 'cell-num' : (i === 0 ? 'cell-dim' : '')}`;
      const editableAttr = isId ? '' : 'contenteditable="true"';
      html += `<td class="${cls}" data-column="${escapeHtml(col)}" ${editableAttr}>${escapeHtml(cell)}</td>`;
    });
    html += `<td class="col-actions"><button class="btn-delete-row" title="Supprimer cette ligne">🗑</button></td>`;
    html += '</tr>';
  });
  html += '</tbody></table>';
  content.innerHTML = html;

  renderPagination(totalPages, filteredRows.length);

  content.querySelectorAll('thead th.sortable').forEach(th => {
    th.addEventListener('click', () => {
      const col = th.dataset.column;
      if (sortState.column === col) {
        sortState.dir = sortState.dir === 'asc' ? 'desc' : 'asc';
      } else {
        sortState.column = col;
        sortState.dir = 'asc';
      }
      currentPage = 1;
      renderContent();
    });
  });

  const selectAllCheckbox = document.getElementById('selectAllCheckbox');
  if (selectAllCheckbox) {
    selectAllCheckbox.addEventListener('change', () => {
      if (selectAllCheckbox.checked) {
        pageRowIds.forEach(id => selectedRowIds.add(id));
      } else {
        pageRowIds.forEach(id => selectedRowIds.delete(id));
      }
      updateSelectionUi();
      renderContent();
    });
  }

  content.querySelectorAll('tbody tr').forEach(tr => {
    const checkbox = tr.querySelector('.row-select');
    checkbox.addEventListener('change', () => {
      const rowId = tr.dataset.rowId;
      if (checkbox.checked) {
        selectedRowIds.add(rowId);
      } else {
        selectedRowIds.delete(rowId);
      }
      updateSelectionUi();
      tr.classList.toggle('row-selected', checkbox.checked);
    });
  });

  content.querySelectorAll('.btn-delete-row').forEach(btn => {
    btn.addEventListener('click', async () => {
      const rowId = btn.closest('tr').dataset.rowId;
      const confirmed = await showConfirm('Supprimer définitivement cette ligne ?', 'Supprimer la ligne');
      if (!confirmed) return;

      try {
        const res = await fetch(`/api/${currentDb.id}/${currentTable.name}/${rowId}`, { method: 'DELETE' });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || 'Échec de la suppression');
        }
        selectedRowIds.delete(rowId);
        updateSelectionUi();
        await loadDatabases();
        await loadTableData();
        renderAll();
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  });

  content.querySelectorAll('td.rel-cell select.rel-select').forEach(select => {
    const original = select.value;

    select.addEventListener('change', async () => {
      const newValue = select.value;
      const tr = select.closest('tr');
      const rowId = tr.dataset.rowId;
      const column = select.closest('td').dataset.column;

      try {
        const res = await fetch(`/api/${currentDb.id}/${currentTable.name}/${rowId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ [column]: newValue === '' ? null : newValue })
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || 'Échec de la sauvegarde');
        }
        undoStack.push({ dbId: currentDb.id, tableName: currentTable.name, rowId, column, oldValue: original, newValue });
        if (undoStack.length > UNDO_LIMIT) undoStack.shift();
        redoStack = [];
        updateUndoButton();
        updateRedoButton();
      } catch (err) {
        showToast(err.message, 'error');
        select.value = original;
      }
    });
  });

  content.querySelectorAll('td.editable').forEach(td => {
    const original = td.textContent;

    td.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        td.blur();
      }
    });

    td.addEventListener('blur', async () => {
      const newValue = td.textContent.trim();
      if (newValue === original) return;

      const tr = td.closest('tr');
      const rowId = tr.dataset.rowId;
      const column = td.dataset.column;
      const colType = columnTypes ? columnTypes[column] : undefined;

      if (colType === 'INTEGER' && newValue !== '' && !/^-?\d+$/.test(newValue)) {
        showToast(`La colonne « ${column} » attend un nombre entier.`, 'error');
        td.textContent = original;
        return;
      }
      if (colType === 'REAL' && newValue !== '' && !/^-?\d+(\.\d+)?$/.test(newValue)) {
        showToast(`La colonne « ${column} » attend un nombre décimal.`, 'error');
        td.textContent = original;
        return;
      }

      try {
        const res = await fetch(`/api/${currentDb.id}/${currentTable.name}/${rowId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ [column]: newValue === '' ? null : newValue })
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || 'Échec de la sauvegarde');
        }
        undoStack.push({ dbId: currentDb.id, tableName: currentTable.name, rowId, column, oldValue: original, newValue });
        if (undoStack.length > UNDO_LIMIT) undoStack.shift();
        redoStack = [];
        updateUndoButton();
        updateRedoButton();
        td.classList.add('saved');
        setTimeout(() => td.classList.remove('saved'), 600);
      } catch (err) {
        showToast(err.message, 'error');
        td.textContent = original;
      }
    });
  });
}

function renderPagination(totalPages, totalRows) {
  const pagination = document.getElementById('pagination');
  if (totalPages <= 1) {
    pagination.innerHTML = '';
    return;
  }

  pagination.innerHTML = `
    <button class="btn-page" id="btnPrevPage" ${currentPage === 1 ? 'disabled' : ''}>‹ Précédent</button>
    <span class="page-info">Page ${currentPage} / ${totalPages} · ${totalRows} lignes</span>
    <button class="btn-page" id="btnNextPage" ${currentPage === totalPages ? 'disabled' : ''}>Suivant ›</button>
  `;

  document.getElementById('btnPrevPage').addEventListener('click', () => {
    if (currentPage > 1) { currentPage--; renderContent(); }
  });
  document.getElementById('btnNextPage').addEventListener('click', () => {
    if (currentPage < totalPages) { currentPage++; renderContent(); }
  });
}

function renderAll() {
  renderSidebar();
  renderTopbar();
  renderTabs();
  renderContent();
}

const modalNewDb = document.getElementById('modalNewDb');
const formNewDb = document.getElementById('formNewDb');
const errorNewDb = document.getElementById('errorNewDb');

function openNewDbModal() {
  errorNewDb.textContent = '';
  formNewDb.reset();
  modalNewDb.classList.add('open');
  document.getElementById('inputDbName').focus();
}

function closeNewDbModal() {
  modalNewDb.classList.remove('open');
}

document.getElementById('btnNewDb').addEventListener('click', openNewDbModal);
document.getElementById('cancelNewDb').addEventListener('click', closeNewDbModal);
modalNewDb.addEventListener('click', (e) => {
  if (e.target === modalNewDb) closeNewDbModal();
});

formNewDb.addEventListener('submit', async (e) => {
  e.preventDefault();
  errorNewDb.textContent = '';

  const name = document.getElementById('inputDbName').value.trim();
  const icon = document.getElementById('inputDbIcon').value.trim();

  try {
    const res = await fetch('/api/databases', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, icon })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Erreur inconnue');

    closeNewDbModal();
    await loadDatabases();

    currentDb = databases.find(d => d.id === data.id);
    currentTable = null;
    renderAll();
  } catch (err) {
    errorNewDb.textContent = err.message;
  }
});

const modalNewTable = document.getElementById('modalNewTable');
const formNewTable = document.getElementById('formNewTable');
const errorNewTable = document.getElementById('errorNewTable');
const columnsList = document.getElementById('columnsList');

let columnCount = 0;

function addColumnRow(name = '', type = 'TEXT') {
  columnCount++;
  const row = document.createElement('div');
  row.className = 'column-row';
  row.innerHTML = `
    <span class="col-drag-handle" draggable="true" title="Glisser pour réordonner">⋮⋮</span>
    <input type="text" class="col-name" placeholder="nom de la colonne" value="${name}" required>
    <select class="col-type">
      <option value="TEXT">Texte</option>
      <option value="INTEGER">Entier</option>
      <option value="REAL">Décimal</option>
    </select>
    <button type="button" class="btn-remove-col" title="Supprimer">×</button>
  `;
  row.querySelector('.col-type').value = type;
  row.querySelector('.btn-remove-col').addEventListener('click', () => row.remove());
  columnsList.appendChild(row);
}

function openNewTableModal() {
  if (!currentDb) return;
  errorNewTable.textContent = '';
  formNewTable.reset();
  columnsList.innerHTML = '';
  addColumnRow(); 
  modalNewTable.classList.add('open');
  document.getElementById('inputTableName').focus();
}

function closeNewTableModal() {
  modalNewTable.classList.remove('open');
}

document.getElementById('btnAddColumn').addEventListener('click', () => addColumnRow());
document.getElementById('cancelNewTable').addEventListener('click', closeNewTableModal);
modalNewTable.addEventListener('click', (e) => {
  if (e.target === modalNewTable) closeNewTableModal();
});

formNewTable.addEventListener('submit', async (e) => {
  e.preventDefault();
  errorNewTable.textContent = '';

  const tableName = document.getElementById('inputTableName').value.trim();
  const rows = Array.from(columnsList.querySelectorAll('.column-row'));
  const columns = rows.map(row => ({
    name: row.querySelector('.col-name').value.trim(),
    type: row.querySelector('.col-type').value
  })).filter(c => c.name);

  if (columns.length === 0) {
    errorNewTable.textContent = 'Ajoutez au moins une colonne.';
    return;
  }

  try {
    const res = await fetch(`/api/${currentDb.id}/tables`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tableName, columns })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Erreur inconnue');

    closeNewTableModal();
    await loadDatabases();

    currentTable = currentDb.tables.find(t => t.name === data.name) || currentDb.tables[0];
    await loadTableData();
    renderAll();
  } catch (err) {
    errorNewTable.textContent = err.message;
  }
});

const modalNewRow = document.getElementById('modalNewRow');
const formNewRow = document.getElementById('formNewRow');
const errorNewRow = document.getElementById('errorNewRow');
const rowFieldsList = document.getElementById('rowFieldsList');

function openNewRowModal() {
  if (!currentTable) return;
  errorNewRow.textContent = '';
  rowFieldsList.innerHTML = '';

  currentTableData.columns
    .filter(col => col !== 'id')
    .forEach(col => {
      const relation = (currentTableData.relations || []).find(r => r.column === col);
      const label = document.createElement('label');

      if (relation) {
        const options = (currentTableData.relationOptions && currentTableData.relationOptions[col]) || [];
        let selectHtml = `<select class="row-field" data-column="${escapeHtml(col)}"><option value="">—</option>`;
        options.forEach(opt => {
          selectHtml += `<option value="${escapeHtml(opt.id)}">${escapeHtml(opt.label)}</option>`;
        });
        selectHtml += `</select>`;
        label.innerHTML = `${escapeHtml(col)}${selectHtml}`;
      } else {
        const type = currentTableData.columnTypes ? currentTableData.columnTypes[col] : undefined;
        const inputType = (type === 'INTEGER' || type === 'REAL') ? 'number' : 'text';
        const stepAttr = type === 'REAL' ? ' step="any"' : '';
        label.innerHTML = `${escapeHtml(col)}<input type="${inputType}" class="row-field" data-column="${escapeHtml(col)}"${stepAttr}>`;
      }

      rowFieldsList.appendChild(label);
    });

  modalNewRow.classList.add('open');
  const firstInput = rowFieldsList.querySelector('input');
  if (firstInput) firstInput.focus();
}

function closeNewRowModal() {
  modalNewRow.classList.remove('open');
}

document.getElementById('btnAddRow').addEventListener('click', openNewRowModal);
document.getElementById('cancelNewRow').addEventListener('click', closeNewRowModal);
modalNewRow.addEventListener('click', (e) => {
  if (e.target === modalNewRow) closeNewRowModal();
});

formNewRow.addEventListener('submit', async (e) => {
  e.preventDefault();
  errorNewRow.textContent = '';

  const data = {};
  rowFieldsList.querySelectorAll('.row-field').forEach(input => {
    data[input.dataset.column] = input.value === '' ? null : input.value;
  });

  try {
    const res = await fetch(`/api/${currentDb.id}/${currentTable.name}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    const result = await res.json();
    if (!res.ok) throw new Error(result.error || 'Erreur inconnue');

    closeNewRowModal();
    await loadDatabases();
    await loadTableData();
    renderAll();
  } catch (err) {
    errorNewRow.textContent = err.message;
  }
});

function parseCsv(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim() !== '');
  if (lines.length === 0) return { headers: [], rows: [] };

  const parseLine = (line) => {
    const result = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        result.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    result.push(current.trim());
    return result;
  };

  const headers = parseLine(lines[0]);
  const rows = lines.slice(1).map(parseLine).map(values => {
    const obj = {};
    headers.forEach((h, i) => { obj[h] = values[i] ?? ''; });
    return obj;
  });

  return { headers, rows };
}

function setupDropdownMenu(triggerId, dropdownId) {
  const trigger = document.getElementById(triggerId);
  const dropdown = document.getElementById(dropdownId);

  trigger.addEventListener('click', (e) => {
    e.stopPropagation();
    const isOpen = dropdown.classList.contains('open');
    document.querySelectorAll('.menu-dropdown.open').forEach(d => d.classList.remove('open'));
    if (!isOpen) dropdown.classList.add('open');
  });
  // les clics sur les options du menu ferment le menu naturellement en remontant
  // jusqu'au listener global ci-dessous, après avoir déclenché leur propre action
}

document.addEventListener('click', () => {
  document.querySelectorAll('.menu-dropdown.open').forEach(d => d.classList.remove('open'));
});

setupDropdownMenu('btnFileMenu', 'fileMenuDropdown');

document.getElementById('btnImportCsv').addEventListener('click', () => {
  if (!currentTable) return;
  document.getElementById('csvFileInput').click();
});

document.getElementById('csvFileInput').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file || !currentDb || !currentTable) return;

  try {
    const text = await file.text();
    const { headers, rows } = parseCsv(text);

    // ne garde que les colonnes du CSV qui correspondent à des colonnes existantes de la table
    const validColumns = currentTableData.columns.filter(c => c !== 'id');
    const matchedHeaders = headers.filter(h => validColumns.includes(h));

    if (matchedHeaders.length === 0) {
      showToast(
        `Aucune colonne du CSV ne correspond à celles de la table.\n` +
        `Colonnes attendues : ${validColumns.join(', ')}\n` +
        `Colonnes trouvées : ${headers.join(', ')}`,
        'error'
      );
      return;
    }

    const cleanedRows = rows.map(row => {
      const obj = {};
      matchedHeaders.forEach(h => { obj[h] = row[h]; });
      return obj;
    });

    const res = await fetch(`/api/${currentDb.id}/${currentTable.name}/bulk`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rows: cleanedRows })
    });
    const result = await res.json();
    if (!res.ok) throw new Error(result.error || 'Échec de l\'import');

    showToast(`${result.inserted} ligne(s) importée(s) avec succès.`, 'success');
    await loadDatabases();
    await loadTableData();
    renderAll();
  } catch (err) {
    showToast('Erreur lors de l\'import : ' + err.message, 'error');
  } finally {
    e.target.value = ''; 
  }
});

const modalEditColumns = document.getElementById('modalEditColumns');
const editColumnsList = document.getElementById('editColumnsList');
const errorEditColumns = document.getElementById('errorEditColumns');
const formAddColumn = document.getElementById('formAddColumn');

async function fetchTableColumns(dbId, tableName) {
  const res = await fetch(`/api/${dbId}/${tableName}`);
  if (!res.ok) return [];
  const data = await res.json();
  return data.columns || [];
}

function renderEditColumnsList() {
  editColumnsList.innerHTML = '';

  currentTableData.columns.filter(c => c !== 'id').forEach(col => {
    const type = currentTableData.columnTypes ? currentTableData.columnTypes[col] : 'TEXT';
    const relation = (currentTableData.relations || []).find(r => r.column === col);

    const block = document.createElement('div');
    block.className = 'edit-column-block';

    const row = document.createElement('div');
    row.className = 'edit-column-row';
    row.innerHTML = `
      <input type="text" class="edit-col-name" value="${escapeHtml(col)}">
      <span class="edit-col-type">${escapeHtml(type)}</span>
      <button type="button" class="btn-link-col${relation ? ' linked' : ''}" title="${relation ? `Lié à ${relation.refTable}.${relation.refColumn}` : 'Lier à une autre table'}">🔗</button>
      <button type="button" class="btn-save-col" title="Renommer">✓</button>
      <button type="button" class="btn-remove-col" title="Supprimer la colonne">×</button>
    `;

    const relPanel = document.createElement('div');
    relPanel.className = 'rel-panel';
    relPanel.hidden = !relation;
    const otherTables = (currentDb.tables || []).map(t => t.name).filter(n => n !== currentTable.name);
    relPanel.innerHTML = `
      <select class="rel-ref-table">
        <option value="">— Aucune liaison —</option>
        ${otherTables.map(t => `<option value="${escapeHtml(t)}"${relation && relation.refTable === t ? ' selected' : ''}>${escapeHtml(t)}</option>`).join('')}
      </select>
      <select class="rel-ref-column"></select>
      <select class="rel-ref-display"></select>
      <button type="button" class="btn-save-rel" title="Enregistrer la liaison">✓</button>
    `;

    async function populateRefSelects(refTable) {
      const colSelect = relPanel.querySelector('.rel-ref-column');
      const dispSelect = relPanel.querySelector('.rel-ref-display');
      colSelect.innerHTML = '';
      dispSelect.innerHTML = '';
      if (!refTable) return;

      const refCols = await fetchTableColumns(currentDb.id, refTable);
      refCols.forEach(c => {
        const opt1 = document.createElement('option');
        opt1.value = c;
        opt1.textContent = c;
        colSelect.appendChild(opt1);

        const opt2 = document.createElement('option');
        opt2.value = c;
        opt2.textContent = c;
        dispSelect.appendChild(opt2);
      });

      if (relation && relation.refTable === refTable) {
        colSelect.value = relation.refColumn;
        dispSelect.value = relation.refDisplay;
      } else {
        colSelect.value = 'id';
        const firstNonId = refCols.find(c => c !== 'id');
        if (firstNonId) dispSelect.value = firstNonId;
      }
    }

    relPanel.querySelector('.rel-ref-table').addEventListener('change', (e) => {
      populateRefSelects(e.target.value);
    });

    if (relation) populateRefSelects(relation.refTable);

    relPanel.querySelector('.btn-save-rel').addEventListener('click', async () => {
      const refTable = relPanel.querySelector('.rel-ref-table').value;
      errorEditColumns.textContent = '';

      try {
        if (!refTable) {
          if (relation) {
            const res = await fetch(`/api/${currentDb.id}/${currentTable.name}/columns/${col}/relation`, { method: 'DELETE' });
            if (!res.ok) {
              const data = await res.json().catch(() => ({}));
              throw new Error(data.error || 'Échec de la suppression de la liaison');
            }
          }
        } else {
          const refColumn = relPanel.querySelector('.rel-ref-column').value;
          const refDisplay = relPanel.querySelector('.rel-ref-display').value;
          const res = await fetch(`/api/${currentDb.id}/${currentTable.name}/columns/${col}/relation`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ refTable, refColumn, refDisplay })
          });
          if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            throw new Error(data.error || 'Échec de la liaison');
          }
        }
        await loadTableData();
        renderEditColumnsList();
        renderContent();
      } catch (err) {
        errorEditColumns.textContent = err.message;
      }
    });

    row.querySelector('.btn-link-col').addEventListener('click', () => {
      relPanel.hidden = !relPanel.hidden;
    });

    row.querySelector('.btn-save-col').addEventListener('click', async () => {
      const input = row.querySelector('.edit-col-name');
      const newName = input.value.trim();
      if (!newName || newName === col) return;

      try {
        const res = await fetch(`/api/${currentDb.id}/${currentTable.name}/columns/${col}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ newName })
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || 'Échec du renommage');
        }
        errorEditColumns.textContent = '';
        await loadTableData();
        renderEditColumnsList();
        renderContent();
      } catch (err) {
        errorEditColumns.textContent = err.message;
      }
    });

    row.querySelector('.btn-remove-col').addEventListener('click', async () => {
      const confirmed = await showConfirm(`Supprimer définitivement la colonne « ${col} » et ses données ?`, 'Supprimer la colonne');
      if (!confirmed) return;

      try {
        const res = await fetch(`/api/${currentDb.id}/${currentTable.name}/columns/${col}`, { method: 'DELETE' });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || 'Échec de la suppression');
        }
        errorEditColumns.textContent = '';
        await loadTableData();
        renderEditColumnsList();
        renderContent();
      } catch (err) {
        errorEditColumns.textContent = err.message;
      }
    });

    block.appendChild(row);
    block.appendChild(relPanel);
    editColumnsList.appendChild(block);
  });
}

function openEditColumnsModal() {
  if (!currentTable) return;
  errorEditColumns.textContent = '';
  formAddColumn.reset();
  renderEditColumnsList();
  modalEditColumns.classList.add('open');
}

function closeEditColumnsModal() {
  modalEditColumns.classList.remove('open');
}

document.getElementById('btnEditColumns').addEventListener('click', openEditColumnsModal);
document.getElementById('closeEditColumns').addEventListener('click', closeEditColumnsModal);
modalEditColumns.addEventListener('click', (e) => {
  if (e.target === modalEditColumns) closeEditColumnsModal();
});

formAddColumn.addEventListener('submit', async (e) => {
  e.preventDefault();
  errorEditColumns.textContent = '';

  const name = document.getElementById('inputNewColName').value.trim();
  const type = document.getElementById('inputNewColType').value;
  if (!name) return;

  try {
    const res = await fetch(`/api/${currentDb.id}/${currentTable.name}/columns`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, type })
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || "Échec de l'ajout");
    }
    formAddColumn.reset();
    await loadTableData();
    renderEditColumnsList();
    renderContent();
  } catch (err) {
    errorEditColumns.textContent = err.message;
  }
});

const modalQuery = document.getElementById('modalQuery');
const queryInput = document.getElementById('queryInput');
const errorQuery = document.getElementById('errorQuery');
const queryResults = document.getElementById('queryResults');

function openQueryModal() {
  if (!currentDb) return;
  errorQuery.textContent = '';
  queryResults.innerHTML = '';
  modalQuery.classList.add('open');
  queryInput.focus();
}

function closeQueryModal() {
  modalQuery.classList.remove('open');
}

document.getElementById('closeQuery').addEventListener('click', closeQueryModal);
modalQuery.addEventListener('click', (e) => {
  if (e.target === modalQuery) closeQueryModal();
});

document.getElementById('btnRunQuery').addEventListener('click', async () => {
  const sql = queryInput.value.trim();
  errorQuery.textContent = '';
  queryResults.innerHTML = '';
  if (!sql || !currentDb) return;

  try {
    const res = await fetch(`/api/${currentDb.id}/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sql })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Erreur inconnue');

    if (data.rows.length === 0) {
      queryResults.innerHTML = '<div class="query-empty">Aucun résultat.</div>';
      return;
    }

    let html = '<table><thead><tr>';
    data.columns.forEach(col => { html += `<th>${escapeHtml(col)}</th>`; });
    html += '</tr></thead><tbody>';
    data.rows.forEach(row => {
      html += '<tr>';
      data.columns.forEach(col => { html += `<td>${escapeHtml(row[col])}</td>`; });
      html += '</tr>';
    });
    html += '</tbody></table>';
    queryResults.innerHTML = html;
  } catch (err) {
    errorQuery.textContent = err.message;
  }
});

function toCsv(columns, rows) {
  const escapeCsv = (val) => {
    const s = String(val ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [columns.map(escapeCsv).join(',')];
  rows.forEach(row => lines.push(columns.map(c => escapeCsv(row[c])).join(',')));
  return lines.join('\r\n');
}

function downloadFile(filename, content, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function getExportRows() {
  const rows = getDisplayRows();
  if (selectedRowIds.size > 0) return rows.filter(r => selectedRowIds.has(String(r.id)));
  return rows;
}

document.getElementById('btnExportCsv').addEventListener('click', () => {
  if (!currentTable) return;
  const csv = toCsv(currentTableData.columns, getExportRows());
  downloadFile(`${currentTable.name}.csv`, csv, 'text/csv;charset=utf-8');
});

document.getElementById('btnExportJson').addEventListener('click', () => {
  if (!currentTable) return;
  downloadFile(`${currentTable.name}.json`, JSON.stringify(getExportRows(), null, 2), 'application/json');
});

document.getElementById('searchInput').addEventListener('input', (e) => {
  searchQuery = e.target.value;
  currentPage = 1;
  renderContent();
});

document.getElementById('btnDeleteSelected').addEventListener('click', async () => {
  if (!currentDb || !currentTable || selectedRowIds.size === 0) return;
  const ids = Array.from(selectedRowIds);
  const confirmed = await showConfirm(`Supprimer définitivement ${ids.length} ligne(s) sélectionnée(s) ?`, 'Supprimer la sélection');
  if (!confirmed) return;

  try {
    const results = await Promise.all(ids.map(id =>
      fetch(`/api/${currentDb.id}/${currentTable.name}/${id}`, { method: 'DELETE' })
    ));
    const failed = results.filter(r => !r.ok).length;
    const succeeded = results.length - failed;
    selectedRowIds = new Set();
    updateSelectionUi();
    await loadDatabases();
    await loadTableData();
    renderAll();
    if (succeeded > 0) showToast(`${succeeded} ligne(s) supprimée(s).`, 'success');
    if (failed > 0) showToast(`${failed} suppression(s) ont échoué.`, 'error');
  } catch (err) {
    showToast(err.message, 'error');
  }
});

document.getElementById('btnUndo').addEventListener('click', async () => {
  const last = undoStack.pop();
  updateUndoButton();
  if (!last) return;

  try {
    const res = await fetch(`/api/${last.dbId}/${last.tableName}/${last.rowId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [last.column]: last.oldValue === '' ? null : last.oldValue })
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || 'Échec de l\'annulation');
    }
    redoStack.push(last);
    updateRedoButton();
    await loadTableData();
    renderAll();
    showToast('Modification annulée.', 'success');
  } catch (err) {
    showToast(err.message, 'error');
  }
});

document.getElementById('btnRedo').addEventListener('click', async () => {
  const last = redoStack.pop();
  updateRedoButton();
  if (!last) return;

  try {
    const res = await fetch(`/api/${last.dbId}/${last.tableName}/${last.rowId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [last.column]: last.newValue === '' ? null : last.newValue })
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || 'Échec du rétablissement');
    }
    undoStack.push(last);
    if (undoStack.length > UNDO_LIMIT) undoStack.shift();
    updateUndoButton();
    await loadTableData();
    renderAll();
    showToast('Modification rétablie.', 'success');
  } catch (err) {
    showToast(err.message, 'error');
  }
});

enableDragReorder(document.getElementById('dbList'), '.db-item', 'vertical', (items) => {
  const orderedIds = items.map(el => el.dataset.dbId);
  databases.sort((a, b) => orderedIds.indexOf(a.id) - orderedIds.indexOf(b.id));

  fetch('/api/databases/order', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ orderedIds })
  }).catch(err => console.error('Échec sauvegarde ordre des bases :', err));
});
enableDragReorder(document.getElementById('tabs'), '.tab:not(.tab-add)', 'horizontal', (items) => {
  if (!currentDb) return;
  const orderedNames = items.map(el => el.dataset.tableName);
  currentDb.tables.sort((a, b) => orderedNames.indexOf(a.name) - orderedNames.indexOf(b.name));

  fetch(`/api/${currentDb.id}/tables/order`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ orderedNames })
  }).catch(err => console.error('Échec sauvegarde ordre des tables :', err));
});

enableDragReorder(document.getElementById('columnsList'), '.column-row', 'vertical', () => {});

const sidebar = document.getElementById('sidebar');
const sidebarBackdrop = document.getElementById('sidebarBackdrop');
const btnSidebarToggle = document.getElementById('btnSidebarToggle');
const btnMobileMenu = document.getElementById('btnMobileMenu');

function setSidebarCollapsed(collapsed) {
  sidebar.classList.toggle('collapsed', collapsed);
  btnSidebarToggle.title = collapsed ? 'Agrandir la sidebar' : 'Réduire la sidebar';
  localStorage.setItem('sidebarCollapsed', collapsed ? '1' : '0');
}

if (localStorage.getItem('sidebarCollapsed') === '1') {
  setSidebarCollapsed(true);
}

btnSidebarToggle.addEventListener('click', () => {
  setSidebarCollapsed(!sidebar.classList.contains('collapsed'));
});

function openMobileSidebar() {
  sidebar.classList.add('mobile-open');
  sidebarBackdrop.classList.add('visible');
}

function closeMobileSidebar() {
  sidebar.classList.remove('mobile-open');
  sidebarBackdrop.classList.remove('visible');
}

btnMobileMenu.addEventListener('click', () => {
  if (sidebar.classList.contains('mobile-open')) closeMobileSidebar();
  else openMobileSidebar();
});

sidebarBackdrop.addEventListener('click', closeMobileSidebar);

// referme le tiroir mobile dès qu'une base est sélectionnée
document.getElementById('dbList').addEventListener('click', (e) => {
  if (e.target.closest('.db-item')) closeMobileSidebar();
});

document.getElementById('breadcrumb').addEventListener('click', async () => {
  const fullPath = document.getElementById('dbPath').dataset.fullPath;
  if (!fullPath || fullPath === '—') return;

  try {
    await navigator.clipboard.writeText(fullPath);
    showToast('Chemin copié dans le presse-papiers.', 'success');
  } catch (err) {
    showToast('Impossible de copier le chemin.', 'error');
  }
});

loadDatabases();
