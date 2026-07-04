const express = require('express');
const path = require('path');
const { listDatabases } = require('./db/db');
const dataRoutes = require('./routes/data');
const authRoutes = require('./routes/auth');
const { requireAuth } = require('./auth');

const app = express();
const PORT = 3000;

// limite relevée pour accepter les images importées en base64 (data URI) dans les lignes
app.use(express.json({ limit: '15mb' }));

// Sert le frontend (HTML/CSS/JS statiques) — la page elle-même ne contient
// aucune donnée sensible, seule l'API ci-dessous est protégée
app.use(express.static(path.join(__dirname, '../frontend')));

// Authentification : jamais protégées par requireAuth
app.use('/api/auth', authRoutes);

// Toutes les routes API liées aux données, protégées par authentification
app.use('/api', requireAuth, dataRoutes);

// Route de contrôle simple
app.get('/api/ping', requireAuth, (req, res) => {
  res.json({ ok: true, databases: listDatabases().map(d => d.id) });
});

app.listen(PORT, () => {
  console.log(`Serveur lancé sur http://localhost:${PORT}`);
});
