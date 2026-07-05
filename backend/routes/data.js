const express = require('express');
const router = express.Router();
const {
  listDatabases,
  createDatabase,
  backupDatabase,
  importDatabase,
  deleteDatabase,
  reorderDatabases,
  reorderTables,
  setNodePosition,
  setNodePositions,
  setPinnedColumn,
  setColumnTotal,
  setColumnValidation,
  listIndexes,
  createIndex,
  dropIndex,
  addFormulaColumn,
  removeFormulaColumn,
  addConditionalFormat,
  removeConditionalFormat,
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
  bulkInsertRows,
  getRelations,
  getRowReferences,
  getTableReferencedBy,
  setRelation,
  removeRelation,
} = require('../db/db');

// GET /api/databases  -> liste toutes les bases + leurs tables + nb de lignes
router.get('/databases', (req, res) => {
  try {
    res.json(listDatabases());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/databases  { name, icon }  -> crée une nouvelle base vide
router.post('/databases', (req, res) => {
  try {
    const { name, icon } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Le nom de la base est requis.' });
    }
    const entry = createDatabase(name.trim(), icon);
    res.status(201).json(entry);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/databases/:dbId/backup  -> télécharge le fichier .db brut
router.get('/databases/:dbId/backup', (req, res) => {
  try {
    const { filePath, filename } = backupDatabase(req.params.dbId);
    res.download(filePath, filename);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/databases/import?name=...&icon=...  (corps: octets bruts du fichier .db)
// -> importe un fichier .db existant comme nouvelle base
router.post('/databases/import', express.raw({ type: '*/*', limit: '300mb' }), (req, res) => {
  try {
    const { name, icon } = req.query;
    if (!name || !String(name).trim()) {
      return res.status(400).json({ error: 'Le nom de la base est requis.' });
    }
    if (!req.body || !Buffer.isBuffer(req.body) || req.body.length === 0) {
      return res.status(400).json({ error: 'Aucun fichier reçu.' });
    }
    const entry = importDatabase(String(name).trim(), icon, req.body);
    res.status(201).json(entry);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/databases/order  { orderedIds: [...] } -> sauvegarde l'ordre des bases
router.put('/databases/order', (req, res) => {
  try {
    const { orderedIds } = req.body;
    if (!Array.isArray(orderedIds)) {
      return res.status(400).json({ error: 'orderedIds doit être un tableau.' });
    }
    reorderDatabases(orderedIds);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/:dbId/tables/order  { orderedNames: [...] } -> sauvegarde l'ordre des tables
router.put('/:dbId/tables/order', (req, res) => {
  try {
    const { dbId } = req.params;
    const { orderedNames } = req.body;
    if (!Array.isArray(orderedNames)) {
      return res.status(400).json({ error: 'orderedNames doit être un tableau.' });
    }
    reorderTables(dbId, orderedNames);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/databases/:dbId  -> supprime une base et son fichier
router.delete('/databases/:dbId', (req, res) => {
  try {
    deleteDatabase(req.params.dbId);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/databases/:dbId  { name } -> renomme une base
router.patch('/databases/:dbId', (req, res) => {
  try {
    const { name } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Le nom de la base est requis.' });
    }
    const entry = renameDatabase(req.params.dbId, name.trim());
    res.json(entry);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/:dbId/tables  { tableName, columns: [{name, type}] } -> crée une table
router.post('/:dbId/tables', (req, res) => {
  try {
    const { dbId } = req.params;
    const { tableName, columns } = req.body;

    if (!tableName || !tableName.trim()) {
      return res.status(400).json({ error: 'Le nom de la table est requis.' });
    }
    if (!Array.isArray(columns) || columns.length === 0) {
      return res.status(400).json({ error: 'Au moins une colonne est requise.' });
    }

    const table = createTable(dbId, tableName.trim(), columns);
    res.status(201).json(table);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/:dbId/tables/:tableName/position  { x, y } -> sauvegarde la position du nœud dans la vue schéma
router.put('/:dbId/tables/:tableName/position', (req, res) => {
  try {
    const { dbId, tableName } = req.params;
    const { x, y } = req.body;
    setNodePosition(dbId, tableName, x, y);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/:dbId/tables/positions  { positions: { tableName: {x,y}, ... } }
// -> sauvegarde plusieurs positions de nœuds en une fois (utilisé par l'agencement automatique)
router.put('/:dbId/tables/positions', (req, res) => {
  try {
    const { dbId } = req.params;
    const { positions } = req.body;
    if (!positions || typeof positions !== 'object') {
      return res.status(400).json({ error: 'positions doit être un objet.' });
    }
    setNodePositions(dbId, positions);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/:dbId/relations  -> toutes les liaisons entre tables de cette base
// (doit rester déclarée avant la route générique GET /:dbId/:tableName
// pour ne pas être masquée par elle)
router.get('/:dbId/relations', (req, res) => {
  try {
    res.json(getRelations(req.params.dbId));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/:dbId/tables/:tableName/references -> colonnes d'autres tables qui référencent cette table
// (utilisé pour avertir avant suppression)
router.get('/:dbId/tables/:tableName/references', (req, res) => {
  try {
    const { dbId, tableName } = req.params;
    res.json(getTableReferencedBy(dbId, tableName));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/:dbId/tables/:tableName  -> supprime une table
router.delete('/:dbId/tables/:tableName', (req, res) => {
  try {
    const { dbId, tableName } = req.params;
    dropTable(dbId, tableName);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/:dbId/tables/:tableName  { newName } -> renomme une table
// (doit rester déclarée avant la route générique PATCH /:dbId/:tableName/:rowId
// pour ne pas être masquée par elle)
router.patch('/:dbId/tables/:tableName', (req, res) => {
  try {
    const { dbId, tableName } = req.params;
    const { newName } = req.body;
    if (!newName || !newName.trim()) {
      return res.status(400).json({ error: 'Le nouveau nom de la table est requis.' });
    }
    const table = renameTable(dbId, tableName, newName.trim());
    res.json(table);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/:dbId/:tableName/columns  { name, type, kind } -> ajoute une colonne
// (kind : 'color' | 'image' | 'boolean' | 'date' | 'url', optionnel — pilote le rendu riche côté frontend)
router.post('/:dbId/:tableName/columns', (req, res) => {
  try {
    const { dbId, tableName } = req.params;
    const { name, type, kind } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Le nom de la colonne est requis.' });
    }
    const column = addColumn(dbId, tableName, { name: name.trim(), type, kind });
    res.status(201).json(column);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/:dbId/:tableName/computed-columns  { name, sourceColumn, refTable, refColumn }
// -> ajoute un champ calculé (compte les lignes de refTable dont refColumn correspond
// à sourceColumn sur cette ligne) ; ce n'est pas une vraie colonne SQL, juste une définition
router.post('/:dbId/:tableName/computed-columns', (req, res) => {
  try {
    const { dbId, tableName } = req.params;
    const { name, sourceColumn, refTable, refColumn } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Le nom de la colonne est requis.' });
    }
    if (!sourceColumn || !refTable || !refColumn) {
      return res.status(400).json({ error: 'La colonne source, la table et la colonne référencées sont requises.' });
    }
    const column = addComputedColumn(dbId, tableName, name.trim(), { sourceColumn, refTable, refColumn });
    res.status(201).json(column);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/:dbId/:tableName/computed-columns/:columnName -> supprime un champ calculé
router.delete('/:dbId/:tableName/computed-columns/:columnName', (req, res) => {
  try {
    const { dbId, tableName, columnName } = req.params;
    removeComputedColumn(dbId, tableName, columnName);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/:dbId/:tableName/formula-columns  { name, expression } -> ajoute un champ
// calculé à partir d'autres colonnes de la même ligne (ex: "prix * quantite")
router.post('/:dbId/:tableName/formula-columns', (req, res) => {
  try {
    const { dbId, tableName } = req.params;
    const { name, expression } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Le nom de la colonne est requis.' });
    }
    if (!expression || !expression.trim()) {
      return res.status(400).json({ error: "L'expression est requise." });
    }
    const column = addFormulaColumn(dbId, tableName, name.trim(), expression.trim());
    res.status(201).json(column);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/:dbId/:tableName/formula-columns/:columnName -> supprime un champ calculé
router.delete('/:dbId/:tableName/formula-columns/:columnName', (req, res) => {
  try {
    const { dbId, tableName, columnName } = req.params;
    removeFormulaColumn(dbId, tableName, columnName);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/:dbId/:tableName/conditional-formats  { column, operator, value, color, target }
// -> ajoute une règle de mise en forme conditionnelle (target: 'cell' | 'row')
router.post('/:dbId/:tableName/conditional-formats', (req, res) => {
  try {
    const { dbId, tableName } = req.params;
    const { column, operator, value, color, target } = req.body;
    if (!column || !operator || !color) {
      return res.status(400).json({ error: 'Colonne, opérateur et couleur sont requis.' });
    }
    const rule = addConditionalFormat(dbId, tableName, { column, operator, value, color, target });
    res.status(201).json(rule);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/:dbId/:tableName/conditional-formats/:ruleId -> supprime une règle
router.delete('/:dbId/:tableName/conditional-formats/:ruleId', (req, res) => {
  try {
    const { dbId, tableName, ruleId } = req.params;
    removeConditionalFormat(dbId, tableName, ruleId);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/:dbId/:tableName/columns/:columnName  { newName } -> renomme une colonne
router.patch('/:dbId/:tableName/columns/:columnName', (req, res) => {
  try {
    const { dbId, tableName, columnName } = req.params;
    const { newName } = req.body;
    if (!newName || !newName.trim()) {
      return res.status(400).json({ error: 'Le nouveau nom de la colonne est requis.' });
    }
    const column = renameColumn(dbId, tableName, columnName, newName.trim());
    res.json(column);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/:dbId/:tableName/pinned-column  { column } -> épingle une colonne (colonne vide/nulle pour désépingler)
router.put('/:dbId/:tableName/pinned-column', (req, res) => {
  try {
    const { dbId, tableName } = req.params;
    const { column } = req.body;
    setPinnedColumn(dbId, tableName, column || null);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/:dbId/:tableName/columns/:columnName/total  { fn } -> agrégat affiché en pied de tableau
// (fn : 'sum' | 'avg' | 'count' | 'min' | 'max', ou vide/nul pour retirer)
router.put('/:dbId/:tableName/columns/:columnName/total', (req, res) => {
  try {
    const { dbId, tableName, columnName } = req.params;
    const { fn } = req.body;
    setColumnTotal(dbId, tableName, columnName, fn || null);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/:dbId/:tableName/columns/:columnName/validation  { required, min, max, pattern, defaultValue }
// -> configure les règles de validation d'une colonne (objet vide pour tout retirer)
router.put('/:dbId/:tableName/columns/:columnName/validation', (req, res) => {
  try {
    const { dbId, tableName, columnName } = req.params;
    setColumnValidation(dbId, tableName, columnName, req.body || {});
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/:dbId/:tableName/indexes -> liste les index (et contraintes d'unicité) de la table
router.get('/:dbId/:tableName/indexes', (req, res) => {
  try {
    const { dbId, tableName } = req.params;
    res.json(listIndexes(dbId, tableName));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/:dbId/:tableName/indexes  { columns, unique } -> crée un index (unique ou non)
router.post('/:dbId/:tableName/indexes', (req, res) => {
  try {
    const { dbId, tableName } = req.params;
    const { columns, unique } = req.body;
    if (!columns || (Array.isArray(columns) && columns.length === 0)) {
      return res.status(400).json({ error: 'Au moins une colonne est requise.' });
    }
    const index = createIndex(dbId, tableName, columns, !!unique);
    res.status(201).json(index);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/:dbId/:tableName/indexes/:indexName -> supprime un index
router.delete('/:dbId/:tableName/indexes/:indexName', (req, res) => {
  try {
    const { dbId, indexName } = req.params;
    dropIndex(dbId, indexName);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/:dbId/:tableName/columns/:columnName  -> supprime une colonne
router.delete('/:dbId/:tableName/columns/:columnName', (req, res) => {
  try {
    const { dbId, tableName, columnName } = req.params;
    dropColumn(dbId, tableName, columnName);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/:dbId/:tableName/columns/:columnName/relation  { refTable, refColumn, refDisplay, cascade }
// -> lie une colonne à une autre table (clé étrangère "logique") ; cascade active la
// suppression automatique des lignes qui référencent une ligne supprimée de refTable
router.post('/:dbId/:tableName/columns/:columnName/relation', (req, res) => {
  try {
    const { dbId, tableName, columnName } = req.params;
    const { refTable, refColumn, refDisplay, cascade } = req.body;
    if (!refTable || !refColumn) {
      return res.status(400).json({ error: 'La table et la colonne référencées sont requises.' });
    }
    const relation = setRelation(dbId, tableName, columnName, refTable, refColumn, refDisplay, !!cascade);
    res.status(201).json(relation);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/:dbId/:tableName/columns/:columnName/relation  -> supprime la liaison
router.delete('/:dbId/:tableName/columns/:columnName/relation', (req, res) => {
  try {
    const { dbId, tableName, columnName } = req.params;
    removeRelation(dbId, tableName, columnName);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/:dbId/query  { sql } -> exécute une requête SELECT en lecture seule
// (doit rester déclarée avant la route générique POST /:dbId/:tableName
// pour ne pas être masquée par elle)
router.post('/:dbId/query', (req, res) => {
  try {
    const { dbId } = req.params;
    const { sql } = req.body;
    if (!sql || !sql.trim()) {
      return res.status(400).json({ error: 'La requête est requise.' });
    }
    const result = runQuery(dbId, sql);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/:dbId/:tableName  -> contenu d'une table précise
router.get('/:dbId/:tableName', (req, res) => {
  try {
    const { dbId, tableName } = req.params;
    const data = getTableData(dbId, tableName);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/:dbId/:tableName  -> insérer une ligne { colonne: valeur, ... }
router.post('/:dbId/:tableName', (req, res) => {
  try {
    const { dbId, tableName } = req.params;
    const { id } = insertRow(dbId, tableName, req.body);
    res.status(201).json({ success: true, id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/:dbId/:tableName/:rowId', (req, res) => {
  try {
    const { dbId, tableName, rowId } = req.params;
    updateRow(dbId, tableName, rowId, req.body);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/:dbId/:tableName/:rowId/references -> lignes d'autres tables qui pointent vers cette ligne
// (utilisé pour avertir avant suppression)
router.get('/:dbId/:tableName/:rowId/references', (req, res) => {
  try {
    const { dbId, tableName, rowId } = req.params;
    res.json(getRowReferences(dbId, tableName, rowId));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/:dbId/:tableName/:rowId  -> supprime une ligne
router.delete('/:dbId/:tableName/:rowId', (req, res) => {
  try {
    const { dbId, tableName, rowId } = req.params;
    deleteRow(dbId, tableName, rowId);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/:dbId/:tableName/bulk  { rows: [{...}, {...}] } -> importe plusieurs lignes (ex: CSV)
router.post('/:dbId/:tableName/bulk', (req, res) => {
  try {
    const { dbId, tableName } = req.params;
    const { rows } = req.body;
    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({ error: 'Aucune ligne à importer.' });
    }
    const result = bulkInsertRows(dbId, tableName, rows);
    res.status(201).json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
