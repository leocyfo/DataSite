// ============================================================
// Ce fichier appelle le vrai backend Node.js/Express en local
// (voir backend/routes/data.js pour les routes disponibles)
// ============================================================

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
    li.innerHTML = `
      <div class="db-item-left">
        <div class="db-icon">${db.icon}</div>
        <div class="db-meta">
          <div class="db-name">${db.name}</div>
          <div class="db-sub">${db.tables.length} tables · ${totalRows} lignes</div>
        </div>
      </div>
      <div class="db-item-right">
        <div class="db-status"></div>
        <button class="btn-delete-db" title="Supprimer cette base">🗑</button>
      </div>
    `;

    li.querySelector('.btn-delete-db').addEventListener('click', async (e) => {
      e.stopPropagation();
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
    tab.innerHTML = `<span>${table.name}</span><button class="btn-delete-tab" title="Supprimer cette table">×</button>`;

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

  // onglet "+" toujours visible pour ajouter une table à la base courante
  const addTab = document.createElement('div');
  addTab.className = 'tab tab-add';
  addTab.textContent = '+ table';
  addTab.addEventListener('click', openNewTableModal);
  tabsEl.appendChild(addTab);
}

function renderContent() {
  const content = document.getElementById('content');

  // Aucune base du tout
  if (!currentDb) {
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

  // Base sans aucune table : proposer d'en créer une
  if (!currentTable) {
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
  columns.forEach(col => { html += `<th>${col}</th>`; });
  html += '</tr></thead><tbody>';

  rows.forEach(row => {
    html += '<tr>';
    columns.forEach((col, i) => {
      const cell = row[col];
      const isNum = typeof cell === 'number';
      const cls = isNum ? 'cell-num' : (i === 0 ? 'cell-dim' : '');
      html += `<td class="${cls}">${cell}</td>`;
    });
    html += '</tr>';
  });
  html += '</tbody></table>';
  content.innerHTML = html;
}

function renderAll() {
  renderSidebar();
  renderTopbar();
  renderTabs();
  renderContent();
}

// ============================================================
// MODALE : créer une nouvelle base
// ============================================================

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

    // sélectionne la base fraîchement créée
    currentDb = databases.find(d => d.id === data.id);
    currentTable = null;
    renderAll();
  } catch (err) {
    errorNewDb.textContent = err.message;
  }
});

// ============================================================
// MODALE : créer une nouvelle table
// ============================================================

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
  addColumnRow(); // au moins une colonne par défaut
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

loadDatabases();
