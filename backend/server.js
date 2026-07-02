const express = require('express');
const path = require('path');
const { listDatabases } = require('./db/db');
const dataRoutes = require('./routes/data');

const app = express();
const PORT = 3000;

app.use(express.json());

// Sert le frontend (HTML/CSS/JS statiques)
app.use(express.static(path.join(__dirname, '../frontend')));

// Toutes les routes API liées aux données
app.use('/api', dataRoutes);

// Route de contrôle simple
app.get('/api/ping', (req, res) => {
  res.json({ ok: true, databases: listDatabases().map(d => d.id) });
});

app.listen(PORT, () => {
  console.log(`Serveur lancé sur http://localhost:${PORT}`);
});
