const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

// surchageable par le harnais de vérification (jsdom), pour ne jamais
// toucher aux vraies bases pendant le développement/les tests
const DB_DIR = process.env.DATASITE_DB_DIR || __dirname;
fs.mkdirSync(DB_DIR, { recursive: true });
const REGISTRY_PATH = path.join(DB_DIR, 'registry.json');

function loadRegistry() {
  if (!fs.existsSync(REGISTRY_PATH)) return [];
  return JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf-8'));
}

function saveRegistry(registry) {
  // écrit dans un fichier temporaire puis renomme — renommage atomique, donc
  // le fichier final contient toujours soit l'ancien contenu complet soit le
  // nouveau, jamais un état à moitié écrit (même pattern que les 8 autres
  // outils du hub)
  const tmpPath = `${REGISTRY_PATH}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(registry, null, 2));
  fs.renameSync(tmpPath, REGISTRY_PATH);
}

function safeIdentifier(name) {
  return String(name).replace(/[^a-zA-Z0-9_]/g, '_');
}

function makeTableId() {
  return `t${Date.now()}${Math.floor(Math.random() * 1000)}`;
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

  // migration douce : les tables créées avant l'ajout des identifiants
  // stables (tableIds) n'en ont pas encore — on en attribue un ici, à la
  // première lecture, plutôt que d'exiger une migration à part. Persisté
  // seulement si quelque chose a effectivement changé.
  let migre = false;

  const resultat = registry.map((entry) => {
    const { id, name, icon, tableOrder } = entry;
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

    entry.tableIds = entry.tableIds || {};
    const tableInfo = ordered.map(tableName => {
      if (!entry.tableIds[tableName]) {
        entry.tableIds[tableName] = makeTableId();
        migre = true;
      }
      return {
        name: tableName,
        id: entry.tableIds[tableName],
        rowCount: db.prepare(`SELECT COUNT(*) as c FROM "${tableName}"`).get().c,
      };
    });

    return { id, name, icon, tables: tableInfo, nodePositions: entry.nodePositions || {} };
  });

  if (migre) saveRegistry(registry);
  return resultat;
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

function reorderColumns(dbId, tableName, orderedNames) {
  const registry = loadRegistry();
  const entry = registry.find(d => d.id === dbId);
  if (!entry) throw new Error(`Base de données inconnue: ${dbId}`);
  const safeTable = safeIdentifier(tableName);
  entry.columnOrder = entry.columnOrder || {};
  entry.columnOrder[safeTable] = orderedNames;
  saveRegistry(registry);
}

function getColumnOrder(dbId, tableName) {
  const registry = loadRegistry();
  const entry = registry.find(d => d.id === dbId);
  const safeTable = safeIdentifier(tableName);
  return (entry && entry.columnOrder && entry.columnOrder[safeTable]) || [];
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

// pour une ligne donnée, cherche dans les autres tables toutes celles qui la référencent
// via une liaison logique (utilisé pour avertir avant suppression)
function getRowReferences(dbId, tableName, rowId) {
  const db = getConnection(dbId);
  const safeTable = safeIdentifier(tableName);
  const row = db.prepare(`SELECT * FROM "${safeTable}" WHERE id = ?`).get(rowId);
  if (!row) return [];

  return getRelations(dbId)
    .filter(r => r.refTable === safeTable)
    .map(rel => {
      const value = row[rel.refColumn];
      if (value === undefined || value === null || value === '') return null;
      const count = db.prepare(`SELECT COUNT(*) as c FROM "${rel.table}" WHERE "${rel.column}" = ?`).get(value).c;
      return count > 0 ? { table: rel.table, column: rel.column, count, cascade: !!rel.cascade } : null;
    })
    .filter(Boolean);
}

// liste les colonnes d'autres tables qui référencent cette table (avant suppression de table)
function getTableReferencedBy(dbId, tableName) {
  const safeTable = safeIdentifier(tableName);
  return getRelations(dbId)
    .filter(r => r.refTable === safeTable)
    .map(r => ({ table: r.table, column: r.column }));
}

function setRelation(dbId, table, column, refTable, refColumn, refDisplay, cascade) {
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
  const relation = { table: safeTable, column: safeCol, refTable: safeRefTable, refColumn: safeRefColumn, refDisplay: safeRefDisplay, cascade: !!cascade };
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

// les "kinds" sont des types d'affichage riches (couleur, image, case à cocher...)
// qui n'existent pas nativement en SQLite : on les stocke dans un type SQL de base
// et on garde le kind à part (registry.json) pour piloter le rendu côté frontend
const KIND_STORAGE_TYPE = {
  color: 'TEXT',
  image: 'TEXT',
  boolean: 'INTEGER',
  date: 'TEXT',
  url: 'TEXT',
};

function resolveColumnDef(col) {
  const kind = Object.prototype.hasOwnProperty.call(KIND_STORAGE_TYPE, col.kind) ? col.kind : null;
  const type = kind ? KIND_STORAGE_TYPE[kind] : (VALID_TYPES.includes(col.type) ? col.type : 'TEXT');
  return { type, kind };
}

function getColumnKinds(dbId, tableName) {
  const registry = loadRegistry();
  const entry = registry.find(d => d.id === dbId);
  const safeTable = safeIdentifier(tableName);
  return (entry && entry.columnKinds && entry.columnKinds[safeTable]) || {};
}

function setColumnKind(dbId, tableName, columnName, kind) {
  const registry = loadRegistry();
  const entry = registry.find(d => d.id === dbId);
  if (!entry) return;

  const safeTable = safeIdentifier(tableName);
  const safeCol = safeIdentifier(columnName);
  entry.columnKinds = entry.columnKinds || {};
  entry.columnKinds[safeTable] = entry.columnKinds[safeTable] || {};

  if (kind) {
    entry.columnKinds[safeTable][safeCol] = kind;
  } else {
    delete entry.columnKinds[safeTable][safeCol];
  }
  saveRegistry(registry);
}

// colonnes calculées : pas de vraie colonne SQL, juste une définition
// { sourceColumn, refTable, refColumn } — la valeur est calculée à la lecture
// (COUNT des lignes de refTable dont refColumn == la valeur de sourceColumn sur cette ligne)
function getComputedColumns(dbId, tableName) {
  const registry = loadRegistry();
  const entry = registry.find(d => d.id === dbId);
  const safeTable = safeIdentifier(tableName);
  return (entry && entry.computedColumns && entry.computedColumns[safeTable]) || {};
}

function addComputedColumn(dbId, tableName, colName, def) {
  const db = getConnection(dbId);
  const safeTable = safeIdentifier(tableName);
  const safeCol = safeIdentifier(colName);
  const safeSourceCol = safeIdentifier(def.sourceColumn);
  const safeRefTable = safeIdentifier(def.refTable);
  const safeRefCol = safeIdentifier(def.refColumn);

  const tableCols = db.prepare(`PRAGMA table_info("${safeTable}")`).all().map(c => c.name);
  if (!tableCols.includes(safeSourceCol)) throw new Error(`Colonne source inconnue: ${safeSourceCol}`);
  if (tableCols.includes(safeCol)) throw new Error(`Une colonne "${safeCol}" existe déjà dans cette table.`);

  const refCols = db.prepare(`PRAGMA table_info("${safeRefTable}")`).all().map(c => c.name);
  if (refCols.length === 0) throw new Error(`Table référencée inconnue: ${safeRefTable}`);
  if (!refCols.includes(safeRefCol)) throw new Error(`Colonne référencée inconnue: ${safeRefCol}`);

  const registry = loadRegistry();
  const entry = registry.find(d => d.id === dbId);
  if (!entry) throw new Error(`Base de données inconnue: ${dbId}`);

  entry.computedColumns = entry.computedColumns || {};
  entry.computedColumns[safeTable] = entry.computedColumns[safeTable] || {};
  const definition = { sourceColumn: safeSourceCol, refTable: safeRefTable, refColumn: safeRefCol };
  entry.computedColumns[safeTable][safeCol] = definition;
  saveRegistry(registry);

  return { name: safeCol, kind: 'computed', ...definition };
}

function removeComputedColumn(dbId, tableName, colName) {
  const registry = loadRegistry();
  const entry = registry.find(d => d.id === dbId);
  if (!entry) throw new Error(`Base de données inconnue: ${dbId}`);

  const safeTable = safeIdentifier(tableName);
  const safeCol = safeIdentifier(colName);
  if (entry.computedColumns && entry.computedColumns[safeTable]) {
    delete entry.computedColumns[safeTable][safeCol];
  }
  saveRegistry(registry);
}

// --- champs calculés sur la même ligne (ex: prix * quantite) ---
// évaluateur d'expression arithmétique restreint (+ - * / et parenthèses, pas de eval())
// pour éviter d'exécuter du code arbitraire à partir d'une expression enregistrée
function tokenizeExpression(expr) {
  const tokens = [];
  const re = /\s*([A-Za-z_][A-Za-z0-9_]*|\d+(?:\.\d+)?|[+\-*/()])/g;
  let match;
  let lastIndex = 0;
  while ((match = re.exec(expr)) !== null) {
    if (match.index !== lastIndex) throw new Error(`Expression invalide près de "${expr.slice(lastIndex)}"`);
    tokens.push(match[1]);
    lastIndex = re.lastIndex;
  }
  if (lastIndex !== expr.length) throw new Error(`Expression invalide près de "${expr.slice(lastIndex)}"`);
  if (tokens.length === 0) throw new Error('Expression vide.');
  return tokens;
}

function parseExpressionTokens(tokens, allowedColumns) {
  let pos = 0;
  const peek = () => tokens[pos];
  const next = () => tokens[pos++];

  function parsePrimary() {
    const tok = next();
    if (tok === undefined) throw new Error('Expression incomplète.');
    if (tok === '(') {
      const value = parseAddSub();
      if (next() !== ')') throw new Error('Parenthèse fermante manquante.');
      return value;
    }
    if (/^\d+(\.\d+)?$/.test(tok)) return { type: 'num', value: Number(tok) };
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(tok)) {
      if (!allowedColumns.includes(tok)) throw new Error(`Colonne inconnue dans l'expression : "${tok}"`);
      return { type: 'col', name: tok };
    }
    throw new Error(`Jeton inattendu : "${tok}"`);
  }

  function parseMulDiv() {
    let node = parsePrimary();
    while (peek() === '*' || peek() === '/') node = { type: 'binop', op: next(), left: node, right: parsePrimary() };
    return node;
  }

  function parseAddSub() {
    let node = parseMulDiv();
    while (peek() === '+' || peek() === '-') node = { type: 'binop', op: next(), left: node, right: parseMulDiv() };
    return node;
  }

  const ast = parseAddSub();
  if (pos !== tokens.length) throw new Error(`Jeton inattendu : "${tokens[pos]}"`);
  return ast;
}

function compileFormula(expression, allowedColumns) {
  return parseExpressionTokens(tokenizeExpression(expression), allowedColumns);
}

function evalFormulaAst(node, row) {
  if (node.type === 'num') return node.value;
  if (node.type === 'col') {
    const v = Number(row[node.name]);
    return Number.isNaN(v) ? 0 : v;
  }
  const l = evalFormulaAst(node.left, row);
  const r = evalFormulaAst(node.right, row);
  switch (node.op) {
    case '+': return l + r;
    case '-': return l - r;
    case '*': return l * r;
    case '/': return r === 0 ? null : l / r;
    default: return null;
  }
}

// mise en forme conditionnelle : colore une cellule ou toute la ligne selon la
// valeur d'une colonne (comparaison simple, évaluée côté frontend à l'affichage)
const FORMAT_OPERATORS = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'contains'];

function getConditionalFormats(dbId, tableName) {
  const registry = loadRegistry();
  const entry = registry.find(d => d.id === dbId);
  const safeTable = safeIdentifier(tableName);
  return (entry && entry.conditionalFormats && entry.conditionalFormats[safeTable]) || [];
}

function addConditionalFormat(dbId, tableName, rule) {
  const registry = loadRegistry();
  const entry = registry.find(d => d.id === dbId);
  if (!entry) throw new Error(`Base de données inconnue: ${dbId}`);

  if (!FORMAT_OPERATORS.includes(rule.operator)) throw new Error(`Opérateur inconnu: ${rule.operator}`);
  if (!/^#[0-9a-fA-F]{6}$/.test(rule.color || '')) throw new Error('Couleur invalide (attendu : #rrggbb).');

  const safeTable = safeIdentifier(tableName);
  entry.conditionalFormats = entry.conditionalFormats || {};
  entry.conditionalFormats[safeTable] = entry.conditionalFormats[safeTable] || [];

  const newRule = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    column: safeIdentifier(rule.column),
    operator: rule.operator,
    value: rule.value,
    color: rule.color,
    target: rule.target === 'row' ? 'row' : 'cell',
  };
  entry.conditionalFormats[safeTable].push(newRule);
  saveRegistry(registry);
  return newRule;
}

function removeConditionalFormat(dbId, tableName, ruleId) {
  const registry = loadRegistry();
  const entry = registry.find(d => d.id === dbId);
  if (!entry) throw new Error(`Base de données inconnue: ${dbId}`);
  const safeTable = safeIdentifier(tableName);
  if (entry.conditionalFormats && entry.conditionalFormats[safeTable]) {
    entry.conditionalFormats[safeTable] = entry.conditionalFormats[safeTable].filter(r => r.id !== ruleId);
  }
  saveRegistry(registry);
}

function getFormulaColumns(dbId, tableName) {
  const registry = loadRegistry();
  const entry = registry.find(d => d.id === dbId);
  const safeTable = safeIdentifier(tableName);
  return (entry && entry.formulaColumns && entry.formulaColumns[safeTable]) || {};
}

function addFormulaColumn(dbId, tableName, colName, expression) {
  const db = getConnection(dbId);
  const safeTable = safeIdentifier(tableName);
  const safeCol = safeIdentifier(colName);
  const tableCols = db.prepare(`PRAGMA table_info("${safeTable}")`).all().map(c => c.name);
  if (tableCols.includes(safeCol)) throw new Error(`Une colonne "${safeCol}" existe déjà dans cette table.`);

  compileFormula(expression, tableCols); // valide la syntaxe et les noms de colonnes tout de suite

  const registry = loadRegistry();
  const entry = registry.find(d => d.id === dbId);
  if (!entry) throw new Error(`Base de données inconnue: ${dbId}`);
  entry.formulaColumns = entry.formulaColumns || {};
  entry.formulaColumns[safeTable] = entry.formulaColumns[safeTable] || {};
  entry.formulaColumns[safeTable][safeCol] = { expression };
  saveRegistry(registry);

  return { name: safeCol, kind: 'formula', expression };
}

function removeFormulaColumn(dbId, tableName, colName) {
  const registry = loadRegistry();
  const entry = registry.find(d => d.id === dbId);
  if (!entry) throw new Error(`Base de données inconnue: ${dbId}`);
  const safeTable = safeIdentifier(tableName);
  const safeCol = safeIdentifier(colName);
  if (entry.formulaColumns && entry.formulaColumns[safeTable]) {
    delete entry.formulaColumns[safeTable][safeCol];
  }
  saveRegistry(registry);
}

function createTable(dbId, tableName, columns) {
  const db = getConnection(dbId);
  const safeTable = safeIdentifier(tableName);

  const resolved = columns.map(col => ({ safeName: safeIdentifier(col.name), ...resolveColumnDef(col) }));
  const colDefs = resolved.map(c => `"${c.safeName}" ${c.type}`).join(', ');

  db.exec(`
    CREATE TABLE IF NOT EXISTS "${safeTable}" (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ${colDefs}
    )
  `);

  // ajoute la nouvelle table à la fin de l'ordre sauvegardé, avec un
  // identifiant stable qui survivra à un futur renommage (voir renameTable)
  const registry = loadRegistry();
  const entry = registry.find(d => d.id === dbId);
  if (entry) {
    entry.tableOrder = entry.tableOrder || [];
    if (!entry.tableOrder.includes(safeTable)) entry.tableOrder.push(safeTable);
    entry.tableIds = entry.tableIds || {};
    if (!entry.tableIds[safeTable]) entry.tableIds[safeTable] = makeTableId();
    saveRegistry(registry);
  }

  resolved.forEach(c => {
    if (c.kind) setColumnKind(dbId, safeTable, c.safeName, c.kind);
  });

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
    if (entry.nodePositions) {
      delete entry.nodePositions[safeTable];
    }
    if (entry.tableIds) {
      delete entry.tableIds[safeTable];
    }
    if (entry.columnKinds) {
      delete entry.columnKinds[safeTable];
    }
    if (entry.pinnedColumns) {
      delete entry.pinnedColumns[safeTable];
    }
    if (entry.computedColumns) {
      delete entry.computedColumns[safeTable];
      // retire aussi les champs calculés d'autres tables qui pointaient vers celle-ci
      Object.values(entry.computedColumns).forEach(defs => {
        Object.keys(defs).forEach(colName => {
          if (defs[colName].refTable === safeTable) delete defs[colName];
        });
      });
    }
    if (entry.totalsRow) {
      delete entry.totalsRow[safeTable];
    }
    if (entry.columnValidation) {
      delete entry.columnValidation[safeTable];
    }
    if (entry.formulaColumns) {
      delete entry.formulaColumns[safeTable];
    }
    if (entry.conditionalFormats) {
      delete entry.conditionalFormats[safeTable];
    }
    if (entry.columnOrder) {
      delete entry.columnOrder[safeTable];
    }
    saveRegistry(registry);
  }
}

const TOTAL_FUNCTIONS = ['sum', 'avg', 'count', 'min', 'max'];

function getTotalsConfig(dbId, tableName) {
  const registry = loadRegistry();
  const entry = registry.find(d => d.id === dbId);
  const safeTable = safeIdentifier(tableName);
  return (entry && entry.totalsRow && entry.totalsRow[safeTable]) || {};
}

function setColumnTotal(dbId, tableName, columnName, fn) {
  const registry = loadRegistry();
  const entry = registry.find(d => d.id === dbId);
  if (!entry) throw new Error(`Base de données inconnue: ${dbId}`);

  const safeTable = safeIdentifier(tableName);
  const safeCol = safeIdentifier(columnName);
  entry.totalsRow = entry.totalsRow || {};
  entry.totalsRow[safeTable] = entry.totalsRow[safeTable] || {};

  if (fn && TOTAL_FUNCTIONS.includes(fn)) {
    entry.totalsRow[safeTable][safeCol] = fn;
  } else {
    delete entry.totalsRow[safeTable][safeCol];
  }
  saveRegistry(registry);
}

// règles de validation par colonne : requis, min/max (numérique), motif (regex),
// valeur par défaut (appliquée uniquement à l'insertion, jamais lors d'une mise à jour)
function getColumnValidation(dbId, tableName) {
  const registry = loadRegistry();
  const entry = registry.find(d => d.id === dbId);
  const safeTable = safeIdentifier(tableName);
  return (entry && entry.columnValidation && entry.columnValidation[safeTable]) || {};
}

function setColumnValidation(dbId, tableName, columnName, rules) {
  const registry = loadRegistry();
  const entry = registry.find(d => d.id === dbId);
  if (!entry) throw new Error(`Base de données inconnue: ${dbId}`);

  const safeTable = safeIdentifier(tableName);
  const safeCol = safeIdentifier(columnName);
  entry.columnValidation = entry.columnValidation || {};
  entry.columnValidation[safeTable] = entry.columnValidation[safeTable] || {};

  const r = rules || {};
  const hasAnyRule = r.required || r.min != null && r.min !== '' || r.max != null && r.max !== '' || r.pattern || r.defaultValue;
  if (hasAnyRule) {
    entry.columnValidation[safeTable][safeCol] = {
      required: !!r.required,
      min: r.min != null && r.min !== '' ? Number(r.min) : null,
      max: r.max != null && r.max !== '' ? Number(r.max) : null,
      pattern: r.pattern || null,
      defaultValue: r.defaultValue != null && r.defaultValue !== '' ? r.defaultValue : null,
    };
  } else {
    delete entry.columnValidation[safeTable][safeCol];
  }
  saveRegistry(registry);
}

// valide (et applique les valeurs par défaut sur) les données d'une ligne avant
// insertion/mise à jour ; lève une erreur descriptive si une règle est violée
function validateRowData(dbId, tableName, data, { isInsert }) {
  const validation = getColumnValidation(dbId, tableName);
  const errors = [];

  Object.entries(validation).forEach(([col, rules]) => {
    let value = Object.prototype.hasOwnProperty.call(data, col) ? data[col] : undefined;

    if (isInsert && (value === undefined || value === null || value === '') && rules.defaultValue != null) {
      value = rules.defaultValue;
      data[col] = value;
    }

    if (value === undefined) return; // colonne non fournie lors d'une mise à jour partielle : pas de contrôle

    const isEmpty = value === null || value === '';
    if (rules.required && isEmpty) {
      errors.push(`Le champ "${col}" est obligatoire.`);
      return;
    }
    if (isEmpty) return;

    if (rules.min != null || rules.max != null) {
      const num = Number(value);
      if (!Number.isNaN(num)) {
        if (rules.min != null && num < rules.min) errors.push(`"${col}" doit être ≥ ${rules.min}.`);
        if (rules.max != null && num > rules.max) errors.push(`"${col}" doit être ≤ ${rules.max}.`);
      }
    }
    if (rules.pattern) {
      try {
        const re = new RegExp(rules.pattern);
        if (!re.test(String(value))) errors.push(`"${col}" ne respecte pas le format attendu.`);
      } catch {
        // motif regex invalide : ignoré silencieusement plutôt que de bloquer toute saisie
      }
    }
  });

  if (errors.length > 0) throw new Error(errors.join(' '));
}

function getPinnedColumn(dbId, tableName) {
  const registry = loadRegistry();
  const entry = registry.find(d => d.id === dbId);
  const safeTable = safeIdentifier(tableName);
  return (entry && entry.pinnedColumns && entry.pinnedColumns[safeTable]) || null;
}

function setPinnedColumn(dbId, tableName, columnName) {
  const registry = loadRegistry();
  const entry = registry.find(d => d.id === dbId);
  if (!entry) throw new Error(`Base de données inconnue: ${dbId}`);

  const safeTable = safeIdentifier(tableName);
  entry.pinnedColumns = entry.pinnedColumns || {};
  if (columnName) {
    entry.pinnedColumns[safeTable] = safeIdentifier(columnName);
  } else {
    delete entry.pinnedColumns[safeTable];
  }
  saveRegistry(registry);
}

function setNodePosition(dbId, tableName, x, y) {
  const registry = loadRegistry();
  const entry = registry.find(d => d.id === dbId);
  if (!entry) throw new Error(`Base de données inconnue: ${dbId}`);

  const safeTable = safeIdentifier(tableName);
  entry.nodePositions = entry.nodePositions || {};
  entry.nodePositions[safeTable] = { x: Number(x) || 0, y: Number(y) || 0 };
  saveRegistry(registry);
}

function setNodePositions(dbId, positions) {
  const registry = loadRegistry();
  const entry = registry.find(d => d.id === dbId);
  if (!entry) throw new Error(`Base de données inconnue: ${dbId}`);

  entry.nodePositions = entry.nodePositions || {};
  Object.entries(positions || {}).forEach(([tableName, pos]) => {
    if (!pos) return;
    const safeTable = safeIdentifier(tableName);
    entry.nodePositions[safeTable] = { x: Number(pos.x) || 0, y: Number(pos.y) || 0 };
  });
  saveRegistry(registry);
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
  // plafonne la table référencée (évite de charger des dizaines de milliers
  // de lignes juste pour peupler une liste déroulante), puis complète avec
  // les valeurs réellement utilisées par les lignes déjà chargées pour
  // qu'aucune relation existante ne se retrouve orpheline hors de la fenêtre
  // des 200 premières lignes
  const RELATION_OPTIONS_LIMIT = 200;
  relations.forEach(rel => {
    const limited = db.prepare(
      `SELECT "${rel.refColumn}" as id, "${rel.refDisplay}" as label FROM "${rel.refTable}" LIMIT ${RELATION_OPTIONS_LIMIT}`
    ).all();
    const limitedIds = new Set(limited.map(o => String(o.id)));
    const used = [...new Set(rows.map(r => r[rel.column]).filter(v => v != null))];
    const missing = used.filter(v => !limitedIds.has(String(v)));
    const extra = missing.length
      ? db.prepare(
          `SELECT "${rel.refColumn}" as id, "${rel.refDisplay}" as label FROM "${rel.refTable}" WHERE "${rel.refColumn}" IN (${missing.map(() => '?').join(',')})`
        ).all(...missing)
      : [];
    relationOptions[rel.column] = [...limited, ...extra];
  });

  const columnKinds = getColumnKinds(dbId, tableName);
  const pinnedColumn = getPinnedColumn(dbId, tableName);

  // colonnes calculées/formule invalides : masquées comme avant (la table
  // reste utilisable), mais désormais signalées via `warnings` plutôt que
  // disparaître sans explication — voir loadTableData() côté frontend
  const warnings = [];

  // colonnes calculées : devenues orphelines si la table/colonne référencée
  // a été supprimée depuis
  const existingTables = new Set(
    db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`).all().map(r => r.name)
  );
  Object.entries(getComputedColumns(dbId, tableName)).forEach(([colName, def]) => {
    if (!columns.includes(def.sourceColumn) || !existingTables.has(def.refTable)) {
      warnings.push(`La colonne calculée « ${colName} » a été masquée : sa colonne source ou sa table référencée n'existe plus.`);
      return;
    }
    const refCols = db.prepare(`PRAGMA table_info("${def.refTable}")`).all().map(c => c.name);
    if (!refCols.includes(def.refColumn)) {
      warnings.push(`La colonne calculée « ${colName} » a été masquée : sa colonne référencée n'existe plus.`);
      return;
    }

    const counts = {};
    db.prepare(`SELECT "${def.refColumn}" as k, COUNT(*) as c FROM "${def.refTable}" GROUP BY "${def.refColumn}"`)
      .all()
      .forEach(r => { counts[r.k] = r.c; });

    rows.forEach(row => { row[colName] = counts[row[def.sourceColumn]] || 0; });
    columns.push(colName);
    columnTypes[colName] = 'INTEGER';
    columnKinds[colName] = 'computed';
  });

  // champs calculés sur la même ligne : devenus invalides si la colonne
  // source a été supprimée/renommée depuis
  Object.entries(getFormulaColumns(dbId, tableName)).forEach(([colName, def]) => {
    try {
      const ast = compileFormula(def.expression, columns);
      rows.forEach(row => { row[colName] = evalFormulaAst(ast, row); });
      columns.push(colName);
      columnTypes[colName] = 'REAL';
      columnKinds[colName] = 'formula';
    } catch {
      warnings.push(`Le champ formule « ${colName} » a été masqué : son expression n'est plus valide (colonne source manquante ?).`);
    }
  });

  const totals = getTotalsConfig(dbId, tableName);
  const columnValidation = getColumnValidation(dbId, tableName);
  const indexes = listIndexes(dbId, tableName);
  const formulas = getFormulaColumns(dbId, tableName);
  const conditionalFormats = getConditionalFormats(dbId, tableName);

  // applique l'ordre d'affichage sauvegardé (colonnes calculées/formule incluses,
  // comme pinnedColumn) ; les colonnes non listées (nouvelles depuis) suivent à la fin
  const savedOrder = getColumnOrder(dbId, tableName);
  if (savedOrder.length) {
    const reordered = [...savedOrder.filter(c => columns.includes(c)), ...columns.filter(c => !savedOrder.includes(c))];
    columns.length = 0;
    columns.push(...reordered);
  }

  return { columns, columnTypes, columnKinds, rows, relations, relationOptions, pinnedColumn, totals, columnValidation, indexes, formulas, conditionalFormats, warnings };
}

// index/unicité : de vrais index SQLite (créés/supprimés directement en base),
// pas juste une préférence côté registry — l'unicité est donc appliquée par SQLite lui-même
function listIndexes(dbId, tableName) {
  const db = getConnection(dbId);
  const safeTable = safeIdentifier(tableName);
  return db.prepare(`PRAGMA index_list("${safeTable}")`).all().map(idx => ({
    name: idx.name,
    unique: !!idx.unique,
    columns: db.prepare(`PRAGMA index_info("${idx.name}")`).all().map(c => c.name),
  }));
}

function createIndex(dbId, tableName, columns, unique) {
  const db = getConnection(dbId);
  const safeTable = safeIdentifier(tableName);
  const safeCols = (Array.isArray(columns) ? columns : [columns]).map(safeIdentifier);
  if (safeCols.length === 0) throw new Error('Au moins une colonne est requise pour créer un index.');

  const indexName = `idx_${safeTable}_${safeCols.join('_')}`;
  try {
    db.exec(`CREATE ${unique ? 'UNIQUE ' : ''}INDEX IF NOT EXISTS "${indexName}" ON "${safeTable}" (${safeCols.map(c => `"${c}"`).join(', ')})`);
  } catch (err) {
    if (String(err.message).includes('UNIQUE constraint failed')) {
      throw new Error("Impossible de créer cet index unique : des valeurs en double existent déjà dans cette colonne.");
    }
    throw err;
  }
  return { name: indexName, unique: !!unique, columns: safeCols };
}

function dropIndex(dbId, indexName) {
  const db = getConnection(dbId);
  db.exec(`DROP INDEX IF EXISTS "${safeIdentifier(indexName)}"`);
}

function insertRow(dbId, tableName, data) {
  const db = getConnection(dbId);
  const safeTable = safeIdentifier(tableName);
  const realCols = db.prepare(`PRAGMA table_info("${safeTable}")`).all().map(c => c.name);

  validateRowData(dbId, safeTable, data, { isInsert: true });

  // ignore les clés qui ne correspondent à aucune vraie colonne (ex : colonnes calculées)
  const cols = Object.keys(data).filter(c => c !== 'id' && realCols.includes(c));
  const safeCols = cols.map(safeIdentifier);
  const placeholders = safeCols.map(() => '?').join(', ');
  const colsQuoted = safeCols.map(c => `"${c}"`).join(', ');
  const values = cols.map(c => data[c]);

  let info;
  try {
    info = db.prepare(
      `INSERT INTO "${safeTable}" (${colsQuoted}) VALUES (${placeholders})`
    ).run(...values);
  } catch (err) {
    if (String(err.message).includes('UNIQUE constraint failed')) {
      throw new Error('Valeur en double : une autre ligne a déjà cette valeur dans une colonne unique.');
    }
    throw err;
  }

  return { id: info.lastInsertRowid };
}

// supprime une ligne, puis en cascade toute ligne d'une autre table qui la référence
// via une relation marquée "cascade" ; le visited protège contre un cycle de cascades
function deleteRow(dbId, tableName, rowId, visited) {
  const db = getConnection(dbId);
  const safeTable = safeIdentifier(tableName);
  const seen = visited || new Set();
  const visitKey = `${safeTable}:${rowId}`;
  if (seen.has(visitKey)) return;
  seen.add(visitKey);

  const cascadingRelations = getRelations(dbId).filter(r => r.refTable === safeTable && r.cascade);
  if (cascadingRelations.length > 0) {
    const row = db.prepare(`SELECT * FROM "${safeTable}" WHERE id = ?`).get(rowId);
    if (row) {
      cascadingRelations.forEach(rel => {
        const value = row[rel.refColumn];
        if (value === undefined || value === null || value === '') return;
        const childRows = db.prepare(`SELECT id FROM "${rel.table}" WHERE "${rel.column}" = ?`).all(value);
        childRows.forEach(child => deleteRow(dbId, rel.table, child.id, seen));
      });
    }
  }

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
    if (entry.nodePositions && entry.nodePositions[safeTable]) {
      entry.nodePositions[safeNewTable] = entry.nodePositions[safeTable];
      delete entry.nodePositions[safeTable];
    }
    if (entry.tableIds && entry.tableIds[safeTable]) {
      // la valeur (l'identifiant stable) ne change pas, seule la clé suit le
      // nouveau nom — c'est précisément ce qui permet à un code externe ayant
      // mémorisé cet id (voir resolveTableId) de retrouver la table malgré
      // le renommage
      entry.tableIds[safeNewTable] = entry.tableIds[safeTable];
      delete entry.tableIds[safeTable];
    }
    if (entry.columnKinds && entry.columnKinds[safeTable]) {
      entry.columnKinds[safeNewTable] = entry.columnKinds[safeTable];
      delete entry.columnKinds[safeTable];
    }
    if (entry.pinnedColumns && entry.pinnedColumns[safeTable]) {
      entry.pinnedColumns[safeNewTable] = entry.pinnedColumns[safeTable];
      delete entry.pinnedColumns[safeTable];
    }
    if (entry.computedColumns) {
      if (entry.computedColumns[safeTable]) {
        entry.computedColumns[safeNewTable] = entry.computedColumns[safeTable];
        delete entry.computedColumns[safeTable];
      }
      // met à jour les champs calculés d'autres tables qui référençaient l'ancien nom
      Object.values(entry.computedColumns).forEach(defs => {
        Object.values(defs).forEach(def => {
          if (def.refTable === safeTable) def.refTable = safeNewTable;
        });
      });
    }
    if (entry.totalsRow && entry.totalsRow[safeTable]) {
      entry.totalsRow[safeNewTable] = entry.totalsRow[safeTable];
      delete entry.totalsRow[safeTable];
    }
    if (entry.columnValidation && entry.columnValidation[safeTable]) {
      entry.columnValidation[safeNewTable] = entry.columnValidation[safeTable];
      delete entry.columnValidation[safeTable];
    }
    if (entry.formulaColumns && entry.formulaColumns[safeTable]) {
      entry.formulaColumns[safeNewTable] = entry.formulaColumns[safeTable];
      delete entry.formulaColumns[safeTable];
    }
    if (entry.conditionalFormats && entry.conditionalFormats[safeTable]) {
      entry.conditionalFormats[safeNewTable] = entry.conditionalFormats[safeTable];
      delete entry.conditionalFormats[safeTable];
    }
    if (entry.columnOrder && entry.columnOrder[safeTable]) {
      entry.columnOrder[safeNewTable] = entry.columnOrder[safeTable];
      delete entry.columnOrder[safeTable];
    }
    saveRegistry(registry);
  }

  return { name: safeNewTable };
}

function addColumn(dbId, tableName, column) {
  const db = getConnection(dbId);
  const safeTable = safeIdentifier(tableName);
  const safeName = safeIdentifier(column.name);
  const { type, kind } = resolveColumnDef(column);
  db.exec(`ALTER TABLE "${safeTable}" ADD COLUMN "${safeName}" ${type}`);
  if (kind) setColumnKind(dbId, safeTable, safeName, kind);
  return { name: safeName, type, kind };
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
  }
  if (entry && entry.columnKinds && entry.columnKinds[safeTable] && entry.columnKinds[safeTable][safeCol]) {
    entry.columnKinds[safeTable][safeNewCol] = entry.columnKinds[safeTable][safeCol];
    delete entry.columnKinds[safeTable][safeCol];
  }
  if (entry && entry.pinnedColumns && entry.pinnedColumns[safeTable] === safeCol) {
    entry.pinnedColumns[safeTable] = safeNewCol;
  }
  if (entry && entry.computedColumns) {
    const ownDefs = entry.computedColumns[safeTable];
    if (ownDefs) {
      Object.values(ownDefs).forEach(def => {
        if (def.sourceColumn === safeCol) def.sourceColumn = safeNewCol;
      });
    }
    Object.values(entry.computedColumns).forEach(defs => {
      Object.values(defs).forEach(def => {
        if (def.refTable === safeTable && def.refColumn === safeCol) def.refColumn = safeNewCol;
      });
    });
  }
  if (entry && entry.totalsRow && entry.totalsRow[safeTable] && entry.totalsRow[safeTable][safeCol]) {
    entry.totalsRow[safeTable][safeNewCol] = entry.totalsRow[safeTable][safeCol];
    delete entry.totalsRow[safeTable][safeCol];
  }
  if (entry && entry.columnValidation && entry.columnValidation[safeTable] && entry.columnValidation[safeTable][safeCol]) {
    entry.columnValidation[safeTable][safeNewCol] = entry.columnValidation[safeTable][safeCol];
    delete entry.columnValidation[safeTable][safeCol];
  }
  if (entry && entry.conditionalFormats && entry.conditionalFormats[safeTable]) {
    entry.conditionalFormats[safeTable].forEach(rule => {
      if (rule.column === safeCol) rule.column = safeNewCol;
    });
  }
  if (entry && entry.columnOrder && entry.columnOrder[safeTable]) {
    entry.columnOrder[safeTable] = entry.columnOrder[safeTable].map(c => (c === safeCol ? safeNewCol : c));
  }
  if (entry) saveRegistry(registry);

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
  }
  if (entry && entry.columnKinds && entry.columnKinds[safeTable]) {
    delete entry.columnKinds[safeTable][safeCol];
  }
  if (entry && entry.pinnedColumns && entry.pinnedColumns[safeTable] === safeCol) {
    delete entry.pinnedColumns[safeTable];
  }
  if (entry && entry.computedColumns) {
    if (entry.computedColumns[safeTable]) {
      Object.keys(entry.computedColumns[safeTable]).forEach(colName => {
        if (entry.computedColumns[safeTable][colName].sourceColumn === safeCol) {
          delete entry.computedColumns[safeTable][colName];
        }
      });
    }
    Object.values(entry.computedColumns).forEach(defs => {
      Object.keys(defs).forEach(colName => {
        if (defs[colName].refTable === safeTable && defs[colName].refColumn === safeCol) {
          delete defs[colName];
        }
      });
    });
  }
  if (entry && entry.totalsRow && entry.totalsRow[safeTable]) {
    delete entry.totalsRow[safeTable][safeCol];
  }
  if (entry && entry.columnValidation && entry.columnValidation[safeTable]) {
    delete entry.columnValidation[safeTable][safeCol];
  }
  if (entry && entry.conditionalFormats && entry.conditionalFormats[safeTable]) {
    entry.conditionalFormats[safeTable] = entry.conditionalFormats[safeTable].filter(rule => rule.column !== safeCol);
  }
  if (entry && entry.columnOrder && entry.columnOrder[safeTable]) {
    entry.columnOrder[safeTable] = entry.columnOrder[safeTable].filter(c => c !== safeCol);
  }
  if (entry) saveRegistry(registry);
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

function listSavedQueries(dbId) {
  const registry = loadRegistry();
  const entry = registry.find(d => d.id === dbId);
  return (entry && entry.savedQueries) || [];
}

function saveNamedQuery(dbId, name, sql) {
  const trimmedName = String(name || '').trim();
  const trimmedSql = String(sql || '').trim();
  if (!trimmedName) throw new Error('Le nom de la requête est requis.');
  if (!trimmedSql) throw new Error('La requête SQL est requise.');

  const registry = loadRegistry();
  const entry = registry.find(d => d.id === dbId);
  if (!entry) throw new Error(`Base de données inconnue: ${dbId}`);
  entry.savedQueries = entry.savedQueries || [];

  const query = { id: `q${Date.now()}${Math.floor(Math.random() * 1000)}`, name: trimmedName, sql: trimmedSql };
  entry.savedQueries.push(query);
  saveRegistry(registry);
  return query;
}

function deleteSavedQuery(dbId, queryId) {
  const registry = loadRegistry();
  const entry = registry.find(d => d.id === dbId);
  if (!entry) throw new Error(`Base de données inconnue: ${dbId}`);
  entry.savedQueries = (entry.savedQueries || []).filter(q => q.id !== queryId);
  saveRegistry(registry);
}

function updateRow(dbId, tableName, rowId, data) {
  const db = getConnection(dbId);
  const safeTable = safeIdentifier(tableName);
  const realCols = db.prepare(`PRAGMA table_info("${safeTable}")`).all().map(c => c.name);

  validateRowData(dbId, safeTable, data, { isInsert: false });

  const cols = Object.keys(data).filter(c => c !== 'id' && realCols.includes(c));
  if (cols.length === 0) return;

  const safeCols = cols.map(safeIdentifier);
  const setClause = safeCols.map(c => `"${c}" = ?`).join(', ');
  const values = cols.map(c => data[c]);
  try {
    db.prepare(`UPDATE "${safeTable}" SET ${setClause} WHERE id = ?`).run(...values, rowId);
  } catch (err) {
    if (String(err.message).includes('UNIQUE constraint failed')) {
      throw new Error('Valeur en double : une autre ligne a déjà cette valeur dans une colonne unique.');
    }
    throw err;
  }
}

function bulkInsertRows(dbId, tableName, rows) {
  const db = getConnection(dbId);
  const safeTable = safeIdentifier(tableName);
  if (!rows || rows.length === 0) return { inserted: 0 };
  const realCols = db.prepare(`PRAGMA table_info("${safeTable}")`).all().map(c => c.name);

  const cols = Object.keys(rows[0]).filter(c => c !== 'id' && realCols.includes(c));
  const safeCols = cols.map(safeIdentifier);
  const placeholders = safeCols.map(() => '?').join(', ');
  const colsQuoted = safeCols.map(c => `"${c}"`).join(', ');
  const stmt = db.prepare(`INSERT INTO "${safeTable}" (${colsQuoted}) VALUES (${placeholders})`);

  const insertMany = db.transaction((rowsToInsert) => {
    for (const row of rowsToInsert) {
      stmt.run(...cols.map(c => row[c] ?? null));
    }
  });
  try {
    insertMany(rows);
  } catch (err) {
    if (String(err.message).includes('UNIQUE constraint failed')) {
      throw new Error("Import annulé : des valeurs en double violent une contrainte d'unicité (aucune ligne n'a été importée).");
    }
    throw err;
  }

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
  reorderColumns,
  setNodePosition,
  setNodePositions,
  getPinnedColumn,
  setPinnedColumn,
  setColumnTotal,
  getColumnValidation,
  setColumnValidation,
  listIndexes,
  createIndex,
  dropIndex,
  getFormulaColumns,
  addFormulaColumn,
  removeFormulaColumn,
  getConditionalFormats,
  addConditionalFormat,
  removeConditionalFormat,
  getComputedColumns,
  addComputedColumn,
  removeComputedColumn,
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
  listSavedQueries,
  saveNamedQuery,
  deleteSavedQuery,
  bulkInsertRows,
  getRelations,
  getTableRelations,
  getRowReferences,
  getTableReferencedBy,
  setRelation,
  removeRelation,
};
