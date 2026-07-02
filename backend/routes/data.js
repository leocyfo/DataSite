const express = require('express');
const router = express.Router();
const {
  listDatabases,
  createDatabase,
  deleteDatabase,
  createTable,
  getTableData,
  getConnection,
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

// DELETE /api/databases/:dbId  -> supprime une base et son fichier
router.delete('/databases/:dbId', (req, res) => {
  try {
    deleteDatabase(req.params.dbId);
    res.json({ success: true });
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
    const db = getConnection(dbId);
    const data = req.body;

    const cols = Object.keys(data);
    const placeholders = cols.map(() => '?').join(', ');
    const stmt = db.prepare(
      `INSERT INTO "${tableName}" (${cols.join(', ')}) VALUES (${placeholders})`
    );
    const info = stmt.run(...Object.values(data));

    res.status(201).json({ success: true, id: info.lastInsertRowid });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
