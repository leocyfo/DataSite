function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

let databases = [];
let currentDb = null;
let currentTable = null;
let currentTableData = { columns: [], rows: [] };

async function loadDatabases() {
  const res = await fetch('/api/databases');
  databases = await res.json();

  document.getElementById('sidebarFooter').innerHTML =
    `Node.js · SQLite<br>${databases.length} base${databases.length === 1 ? '' : 's'} connectée${databases.length === 1 ? '' : 's'}`;

  if (databases.length > 0) {
    // garde la base sélectionnée si elle existe encore, sinon prend la première
    const stillExists = currentDb && databases.find(d => d.id === currentDb.id);
    currentDb = stillExists ? databases.find(d => d.id === currentDb.id) : databases[0];
    currentTable = currentDb.tables[0] || null;
    await loadTableData();
  } else {
    currentDb = null;
    currentTable = null;
    currentTableData = { columns: [], rows: [] };
  }
  renderAll();
}

async function loadTableData() {
  if (!currentDb || !currentTable) {
    currentTableData = { columns: [], rows: [] };
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
        <button class="btn-delete-db" title="Supprimer cette base">🗑</button>
      </div>
    `;

    li.querySelector('.btn-delete-db').addEventListener('click', async (e) => {
      e.stopPropagation(); // évite de sélectionner la base en cliquant sur la poubelle
      const confirmed = confirm(`Supprimer définitivement « ${db.name} » et toutes ses données ?`);
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
        alert(err.message);
      }
    });
    li.addEventListener('click', async () => {
      currentDb = db;
      currentTable = db.tables[0] || null;
      await loadTableData();
      renderAll();
    });
    list.appendChild(li);
  });
}

function renderTopbar() {
  if (!currentDb) {
    document.getElementById('dbTitle').textContent = 'Aucune base sélectionnée';
    document.getElementById('dbPath').textContent = '—';
    document.getElementById('statRows').textContent = '0';
    document.getElementById('statTables').textContent = '0';
    return;
  }
  document.getElementById('dbTitle').textContent = currentDb.name;
  document.getElementById('dbPath').textContent = `./backend/db/${currentDb.name}`;
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
    tab.innerHTML = `<span>${escapeHtml(table.name)}</span><button class="btn-delete-tab" title="Supprimer cette table">×</button>`;

    tab.querySelector('span').addEventListener('click', async () => {
      currentTable = table;
      await loadTableData();
      renderAll();
    });

    tab.querySelector('.btn-delete-tab').addEventListener('click', async (e) => {
      e.stopPropagation();
      const confirmed = confirm(`Supprimer définitivement la table « ${table.name} » ?`);
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
        alert(err.message);
      }
    });

    tabsEl.appendChild(tab);
  });

  const addTab = document.createElement('div');
  addTab.className = 'tab tab-add';
  addTab.textContent = '+ table';
  addTab.addEventListener('click', openNewTableModal);
  tabsEl.appendChild(addTab);
}

function renderContent() {
  const content = document.getElementById('content');
  const toolbar = document.getElementById('contentToolbar');

  if (!currentDb) {
    toolbar.classList.remove('visible');
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

  const { columns, rows } = currentTableData;

  if (!rows || rows.length === 0) {
    content.innerHTML = `
      <div class="empty-state">
        <div class="icon">∅</div>
        <div>Aucune donnée dans cette table</div>
      </div>`;
    return;
  }

  let html = '<table><thead><tr>';
  columns.forEach(col => { html += `<th>${escapeHtml(col)}</th>`; });
  html += '</tr></thead><tbody>';

  rows.forEach(row => {
    html += `<tr data-row-id="${escapeHtml(row.id)}">`;
    columns.forEach((col, i) => {
      const cell = row[col] ?? '';
      const isId = col === 'id';
      const isNum = !isId && typeof row[col] === 'number';
      const cls = isId ? 'col-id' : `editable ${isNum ? 'cell-num' : (i === 0 ? 'cell-dim' : '')}`;
      const editableAttr = isId ? '' : 'contenteditable="true"';
      html += `<td class="${cls}" data-column="${escapeHtml(col)}" ${editableAttr}>${escapeHtml(cell)}</td>`;
    });
    html += '</tr>';
  });
  html += '</tbody></table>';
  content.innerHTML = html;

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

      try {
        const res = await fetch(`/api/${currentDb.id}/${currentTable.name}/${rowId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ [column]: newValue })
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || 'Échec de la sauvegarde');
        }
        td.classList.add('saved');
        setTimeout(() => td.classList.remove('saved'), 600);
      } catch (err) {
        alert(err.message);
        td.textContent = original;
      }
    });
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
      const label = document.createElement('label');
      label.innerHTML = `${escapeHtml(col)}<input type="text" class="row-field" data-column="${escapeHtml(col)}">`;
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
    data[input.dataset.column] = input.value;
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
      alert(
        `Aucune colonne du CSV ne correspond à celles de la table.\n` +
        `Colonnes attendues : ${validColumns.join(', ')}\n` +
        `Colonnes trouvées : ${headers.join(', ')}`
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

    alert(`${result.inserted} ligne(s) importée(s) avec succès.`);
    await loadDatabases();
    await loadTableData();
    renderAll();
  } catch (err) {
    alert('Erreur lors de l\'import : ' + err.message);
  } finally {
    e.target.value = ''; 
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

loadDatabases();
