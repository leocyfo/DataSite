const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const DB_DIR = __dirname;
const REGISTRY_PATH = path.join(DB_DIR, 'registry.json');


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
  const registry = loadRegistry();
  return registry.map(({ id, name, icon }) => {
    const db = getConnection(id);
    const tables = db.prepare(`
      SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'
    `).all().map(r => r.name);

    const tableInfo = tables.map(tableName => ({
      name: tableName,
      rowCount: db.prepare(`SELECT COUNT(*) as c FROM "${tableName}"`).get().c
    }));

    return { id, name, icon, tables: tableInfo };
  });
}

function createDatabase(name, icon) {
  const registry = loadRegistry();
  let id = slugify(name);

  // évite les doublons d'id
  let suffix = 1;
  let uniqueId = id;
  while (registry.find(d => d.id === uniqueId)) {
    uniqueId = `${id}_${suffix++}`;
  }
  id = uniqueId;

  const file = `${id}.db`;
  const filePath = path.join(DB_DIR, file);

  // crée le fichier .db (vide, sans table)
  const db = new Database(filePath);
  connections[id] = db;

  const entry = { id, name, icon: icon || '🗂️', file };
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

  return { name: safeTable, rowCount: 0 };
}

function dropTable(dbId, tableName) {
  const db = getConnection(dbId);
  const safeTable = tableName.replace(/[^a-zA-Z0-9_]/g, '_');
  db.exec(`DROP TABLE IF EXISTS "${safeTable}"`);
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
  createTable,
  dropTable, 
  getTableData,
};
