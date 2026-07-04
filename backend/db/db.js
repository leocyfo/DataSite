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

function safeIdentifier(name) {
  return String(name).replace(/[^a-zA-Z0-9_]/g, '_');
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

const SQLITE_HEADER = Buffer.from('SQLite format 3\0', 'binary');

function backupDatabase(dbId) {
  const registry = loadRegistry();
  const config = registry.find(d => d.id === dbId);
  if (!config) throw new Error(`Base de données inconnue: ${dbId}`);

  // s'assure que toutes les écritures en attente (WAL) sont bien sur disque
  if (connections[dbId]) {
    connections[dbId].pragma('wal_checkpoint(TRUNCATE)');
  }

  return {
    filePath: path.join(DB_DIR, config.file),
    filename: `${config.name}.db`,
  };
}

function importDatabase(name, icon, fileBuffer) {
  if (fileBuffer.length < 16 || !fileBuffer.subarray(0, 16).equals(SQLITE_HEADER)) {
    throw new Error("Le fichier fourni n'est pas une base SQLite valide.");
  }

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
  fs.writeFileSync(filePath, fileBuffer);

  try {
    const db = new Database(filePath);
    db.pragma('quick_check');
    connections[id] = db;
  } catch (err) {
    fs.unlinkSync(filePath);
    throw new Error("Impossible d'ouvrir le fichier importé : " + err.message);
  }

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

function reorderDatabases(orderedIds) {
  const registry = loadRegistry();
  orderedIds.forEach((id, index) => {
    const entry = registry.find(d => d.id === id);
    if (entry) entry.order = index;
  });
  saveRegistry(registry);
}

function reorderTables(dbId, orderedNames) {
  const registry = loadRegistry();
  const entry = registry.find(d => d.id === dbId);
  if (!entry) throw new Error(`Base de données inconnue: ${dbId}`);
  entry.tableOrder = orderedNames;
  saveRegistry(registry);
}

function getRelations(dbId) {
  const registry = loadRegistry();
  const entry = registry.find(d => d.id === dbId);
  return (entry && entry.relations) || [];
}

function getTableRelations(dbId, tableName) {
  const db = getConnection(dbId);
  const safeTable = safeIdentifier(tableName);

  return getRelations(dbId).filter(r => {
    if (r.table !== safeTable) return false;
    // ignore les relations orphelines (table/colonnes référencées disparues)
    const refCols = db.prepare(`PRAGMA table_info("${r.refTable}")`).all().map(c => c.name);
    return refCols.includes(r.refColumn) && refCols.includes(r.refDisplay);
  });
}

function setRelation(dbId, table, column, refTable, refColumn, refDisplay) {
  const db = getConnection(dbId);
  const safeTable = safeIdentifier(table);
  const safeCol = safeIdentifier(column);
  const safeRefTable = safeIdentifier(refTable);
  const safeRefColumn = safeIdentifier(refColumn);
  const safeRefDisplay = safeIdentifier(refDisplay || refColumn);

  const tableCols = db.prepare(`PRAGMA table_info("${safeTable}")`).all().map(c => c.name);
  if (!tableCols.includes(safeCol)) throw new Error(`Colonne inconnue: ${safeCol}`);

  const refCols = db.prepare(`PRAGMA table_info("${safeRefTable}")`).all().map(c => c.name);
  if (refCols.length === 0) throw new Error(`Table référencée inconnue: ${safeRefTable}`);
  if (!refCols.includes(safeRefColumn)) throw new Error(`Colonne référencée inconnue: ${safeRefColumn}`);
  if (!refCols.includes(safeRefDisplay)) throw new Error(`Colonne d'affichage inconnue: ${safeRefDisplay}`);

  const registry = loadRegistry();
  const entry = registry.find(d => d.id === dbId);
  if (!entry) throw new Error(`Base de données inconnue: ${dbId}`);

  entry.relations = (entry.relations || []).filter(r => !(r.table === safeTable && r.column === safeCol));
  const relation = { table: safeTable, column: safeCol, refTable: safeRefTable, refColumn: safeRefColumn, refDisplay: safeRefDisplay };
  entry.relations.push(relation);
  saveRegistry(registry);

  return relation;
}

function removeRelation(dbId, table, column) {
  const registry = loadRegistry();
  const entry = registry.find(d => d.id === dbId);
  if (!entry) throw new Error(`Base de données inconnue: ${dbId}`);

  const safeTable = safeIdentifier(table);
  const safeCol = safeIdentifier(column);
  entry.relations = (entry.relations || []).filter(r => !(r.table === safeTable && r.column === safeCol));
  saveRegistry(registry);
}

const VALID_TYPES = ['TEXT', 'INTEGER', 'REAL'];

function createTable(dbId, tableName, columns) {
  const db = getConnection(dbId);
  const safeTable = safeIdentifier(tableName);

  const colDefs = columns.map(col => {
    const safeName = safeIdentifier(col.name);
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
  const safeTable = safeIdentifier(tableName);
  db.exec(`DROP TABLE IF EXISTS "${safeTable}"`);

  const registry = loadRegistry();
  const entry = registry.find(d => d.id === dbId);
  if (entry) {
    if (entry.tableOrder) {
      entry.tableOrder = entry.tableOrder.filter(n => n !== safeTable);
    }
    if (entry.relations) {
      entry.relations = entry.relations.filter(r => r.table !== safeTable && r.refTable !== safeTable);
    }
    saveRegistry(registry);
  }
}

function getTableData(dbId, tableName) {
  const db = getConnection(dbId);
  const safeTable = safeIdentifier(tableName);
  const columnInfo = db.prepare(`PRAGMA table_info("${safeTable}")`).all();
  const columns = columnInfo.map(c => c.name);
  const columnTypes = Object.fromEntries(columnInfo.map(c => [c.name, c.type]));
  const rows = db.prepare(`SELECT * FROM "${safeTable}"`).all();

  const relations = getTableRelations(dbId, tableName);
  const relationOptions = {};
  relations.forEach(rel => {
    relationOptions[rel.column] = db.prepare(
      `SELECT "${rel.refColumn}" as id, "${rel.refDisplay}" as label FROM "${rel.refTable}"`
    ).all();
  });

  return { columns, columnTypes, rows, relations, relationOptions };
}

function insertRow(dbId, tableName, data) {
  const db = getConnection(dbId);
  const safeTable = safeIdentifier(tableName);

  const cols = Object.keys(data).filter(c => c !== 'id');
  const safeCols = cols.map(safeIdentifier);
  const placeholders = safeCols.map(() => '?').join(', ');
  const colsQuoted = safeCols.map(c => `"${c}"`).join(', ');
  const values = cols.map(c => data[c]);

  const info = db.prepare(
    `INSERT INTO "${safeTable}" (${colsQuoted}) VALUES (${placeholders})`
  ).run(...values);

  return { id: info.lastInsertRowid };
}

function deleteRow(dbId, tableName, rowId) {
  const db = getConnection(dbId);
  const safeTable = safeIdentifier(tableName);
  db.prepare(`DELETE FROM "${safeTable}" WHERE id = ?`).run(rowId);
}

function renameDatabase(dbId, newName) {
  const registry = loadRegistry();
  const entry = registry.find(d => d.id === dbId);
  if (!entry) throw new Error(`Base de données inconnue: ${dbId}`);
  entry.name = newName;
  saveRegistry(registry);
  return entry;
}

function renameTable(dbId, tableName, newTableName) {
  const db = getConnection(dbId);
  const safeTable = safeIdentifier(tableName);
  const safeNewTable = safeIdentifier(newTableName);
  db.exec(`ALTER TABLE "${safeTable}" RENAME TO "${safeNewTable}"`);

  const registry = loadRegistry();
  const entry = registry.find(d => d.id === dbId);
  if (entry) {
    if (entry.tableOrder) {
      entry.tableOrder = entry.tableOrder.map(n => (n === safeTable ? safeNewTable : n));
    }
    if (entry.relations) {
      entry.relations = entry.relations.map(r => ({
        ...r,
        table: r.table === safeTable ? safeNewTable : r.table,
        refTable: r.refTable === safeTable ? safeNewTable : r.refTable,
      }));
    }
    saveRegistry(registry);
  }

  return { name: safeNewTable };
}

function addColumn(dbId, tableName, column) {
  const db = getConnection(dbId);
  const safeTable = safeIdentifier(tableName);
  const safeName = safeIdentifier(column.name);
  const type = VALID_TYPES.includes(column.type) ? column.type : 'TEXT';
  db.exec(`ALTER TABLE "${safeTable}" ADD COLUMN "${safeName}" ${type}`);
  return { name: safeName, type };
}

function renameColumn(dbId, tableName, columnName, newColumnName) {
  const db = getConnection(dbId);
  const safeTable = safeIdentifier(tableName);
  const safeCol = safeIdentifier(columnName);
  const safeNewCol = safeIdentifier(newColumnName);
  db.exec(`ALTER TABLE "${safeTable}" RENAME COLUMN "${safeCol}" TO "${safeNewCol}"`);

  const registry = loadRegistry();
  const entry = registry.find(d => d.id === dbId);
  if (entry && entry.relations) {
    entry.relations = entry.relations.map(r => ({
      ...r,
      column: (r.table === safeTable && r.column === safeCol) ? safeNewCol : r.column,
      refColumn: (r.refTable === safeTable && r.refColumn === safeCol) ? safeNewCol : r.refColumn,
      refDisplay: (r.refTable === safeTable && r.refDisplay === safeCol) ? safeNewCol : r.refDisplay,
    }));
    saveRegistry(registry);
  }

  return { name: safeNewCol };
}

function dropColumn(dbId, tableName, columnName) {
  const db = getConnection(dbId);
  const safeTable = safeIdentifier(tableName);
  const safeCol = safeIdentifier(columnName);
  db.exec(`ALTER TABLE "${safeTable}" DROP COLUMN "${safeCol}"`);

  const registry = loadRegistry();
  const entry = registry.find(d => d.id === dbId);
  if (entry && entry.relations) {
    entry.relations = entry.relations.filter(r =>
      !(r.table === safeTable && r.column === safeCol) &&
      !(r.refTable === safeTable && (r.refColumn === safeCol || r.refDisplay === safeCol))
    );
    saveRegistry(registry);
  }
}

function runQuery(dbId, sql) {
  const db = getConnection(dbId);
  const trimmed = String(sql || '').trim();

  if (!/^select\b/i.test(trimmed)) {
    throw new Error('Seules les requêtes SELECT sont autorisées.');
  }
  if (/;\s*\S/.test(trimmed)) {
    throw new Error('Une seule requête SELECT à la fois est autorisée.');
  }

  const stmt = db.prepare(trimmed);
  const rows = stmt.all();
  const columns = stmt.columns().map(c => c.name);
  return { columns, rows };
}

function updateRow(dbId, tableName, rowId, data) {
  const db = getConnection(dbId);
  const safeTable = safeIdentifier(tableName);

  const cols = Object.keys(data).filter(c => c !== 'id');
  if (cols.length === 0) return;

  const safeCols = cols.map(safeIdentifier);
  const setClause = safeCols.map(c => `"${c}" = ?`).join(', ');
  const values = cols.map(c => data[c]);
  db.prepare(`UPDATE "${safeTable}" SET ${setClause} WHERE id = ?`).run(...values, rowId);
}

function bulkInsertRows(dbId, tableName, rows) {
  const db = getConnection(dbId);
  const safeTable = safeIdentifier(tableName);
  if (!rows || rows.length === 0) return { inserted: 0 };

  const cols = Object.keys(rows[0]).filter(c => c !== 'id');
  const safeCols = cols.map(safeIdentifier);
  const placeholders = safeCols.map(() => '?').join(', ');
  const colsQuoted = safeCols.map(c => `"${c}"`).join(', ');
  const stmt = db.prepare(`INSERT INTO "${safeTable}" (${colsQuoted}) VALUES (${placeholders})`);

  const insertMany = db.transaction((rowsToInsert) => {
    for (const row of rowsToInsert) {
      stmt.run(...cols.map(c => row[c] ?? null));
    }
  });
  insertMany(rows);

  return { inserted: rows.length };
}

module.exports = {
  getConnection,
  listDatabases,
  createDatabase,
  backupDatabase,
  importDatabase,
  deleteDatabase,
  reorderDatabases,
  reorderTables,
  createTable,
  dropTable,
  getTableData,
  insertRow,
  updateRow,
  deleteRow,
  renameDatabase,
  renameTable,
  addColumn,
  renameColumn,
  dropColumn,
  runQuery,
  bulkInsertRows,
  getRelations,
  getTableRelations,
  setRelation,
  removeRelation,
};
