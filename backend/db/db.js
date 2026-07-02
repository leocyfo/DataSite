const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const DB_DIR = __dirname;
const REGISTRY_PATH = path.join(DB_DIR, 'registry.json');

// ============================================================
// Le registre garde la liste des bases créées (id, nom, icône,
// fichier, ordre, ordre des tables). Stocké dans registry.json.
// ============================================================

function loadRegistry() {
  if (!fs.existsSync(REGISTRY_PATH)) return [];
  return JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf-8'));
}

function saveRegistry(registry) {
  fs.writeFileSync(REGISTRY_PATH, JSON.stringify(registry, null, 2));
}

function slugify(name) {
  return name
    .toString()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'base';
}

const connections = {};

function getConnection(dbId) {
  const registry = loadRegistry();
  const config = registry.find(d => d.id === dbId);
  if (!config) throw new Error(`Base de données inconnue: ${dbId}`);

  if (!connections[dbId]) {
    const filePath = path.join(DB_DIR, config.file);
    connections[dbId] = new Database(filePath);
  }
  return connections[dbId];
}

function listDatabases() {
  const registry = loadRegistry()
    .slice()
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

  return registry.map(({ id, name, icon, tableOrder }) => {
    const db = getConnection(id);
    const existingTables = db.prepare(`
      SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'
    `).all().map(r => r.name);

    // applique l'ordre sauvegardé, puis ajoute à la fin les tables
    // qui n'y figurent pas encore (nouvelles tables, robustesse)
    const order = tableOrder || [];
    const ordered = [
      ...order.filter(n => existingTables.includes(n)),
      ...existingTables.filter(n => !order.includes(n)),
    ];

    const tableInfo = ordered.map(tableName => ({
      name: tableName,
      rowCount: db.prepare(`SELECT COUNT(*) as c FROM "${tableName}"`).get().c
    }));

    return { id, name, icon, tables: tableInfo };
  });
}

function createDatabase(name, icon) {
  const registry = loadRegistry();
  let id = slugify(name);

  let suffix = 1;
  let uniqueId = id;
  while (registry.find(d => d.id === uniqueId)) {
    uniqueId = `${id}_${suffix++}`;
  }
  id = uniqueId;

  const file = `${id}.db`;
  const filePath = path.join(DB_DIR, file);

  const db = new Database(filePath);
  connections[id] = db;

  const entry = {
    id,
    name,
    icon: icon || '🗂️',
    file,
    order: registry.length,
    tableOrder: [],
  };
  registry.push(entry);
  saveRegistry(registry);

  return entry;
}

function deleteDatabase(dbId) {
  const registry = loadRegistry();
  const config = registry.find(d => d.id === dbId);
  if (!config) throw new Error(`Base de données inconnue: ${dbId}`);

  if (connections[dbId]) {
    connections[dbId].close();
    delete connections[dbId];
  }

  const filePath = path.join(DB_DIR, config.file);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

  const updated = registry.filter(d => d.id !== dbId);
  saveRegistry(updated);
}

// réordonne les bases selon un tableau d'ids dans le nouvel ordre voulu
function reorderDatabases(orderedIds) {
  const registry = loadRegistry();
  orderedIds.forEach((id, index) => {
    const entry = registry.find(d => d.id === id);
    if (entry) entry.order = index;
  });
  saveRegistry(registry);
}

// réordonne les tables d'une base selon un tableau de noms dans le nouvel ordre
function reorderTables(dbId, orderedNames) {
  const registry = loadRegistry();
  const entry = registry.find(d => d.id === dbId);
  if (!entry) throw new Error(`Base de données inconnue: ${dbId}`);
  entry.tableOrder = orderedNames;
  saveRegistry(registry);
}

const VALID_TYPES = ['TEXT', 'INTEGER', 'REAL'];

function createTable(dbId, tableName, columns) {
  const db = getConnection(dbId);
  const safeTable = tableName.replace(/[^a-zA-Z0-9_]/g, '_');

  const colDefs = columns.map(col => {
    const safeName = col.name.replace(/[^a-zA-Z0-9_]/g, '_');
    const type = VALID_TYPES.includes(col.type) ? col.type : 'TEXT';
    return `"${safeName}" ${type}`;
  }).join(', ');

  db.exec(`
    CREATE TABLE IF NOT EXISTS "${safeTable}" (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ${colDefs}
    )
  `);

  // ajoute la nouvelle table à la fin de l'ordre sauvegardé
  const registry = loadRegistry();
  const entry = registry.find(d => d.id === dbId);
  if (entry) {
    entry.tableOrder = entry.tableOrder || [];
    if (!entry.tableOrder.includes(safeTable)) entry.tableOrder.push(safeTable);
    saveRegistry(registry);
  }

  return { name: safeTable, rowCount: 0 };
}

function dropTable(dbId, tableName) {
  const db = getConnection(dbId);
  const safeTable = tableName.replace(/[^a-zA-Z0-9_]/g, '_');
  db.exec(`DROP TABLE IF EXISTS "${safeTable}"`);

  const registry = loadRegistry();
  const entry = registry.find(d => d.id === dbId);
  if (entry && entry.tableOrder) {
    entry.tableOrder = entry.tableOrder.filter(n => n !== safeTable);
    saveRegistry(registry);
  }
}

function getTableData(dbId, tableName) {
  const db = getConnection(dbId);
  const columns = db.prepare(`PRAGMA table_info("${tableName}")`).all().map(c => c.name);
  const rows = db.prepare(`SELECT * FROM "${tableName}"`).all();
  return { columns, rows };
}

module.exports = {
  getConnection,
  listDatabases,
  createDatabase,
  deleteDatabase,
  reorderDatabases,
  reorderTables,
  createTable,
  dropTable,
  getTableData,
};
