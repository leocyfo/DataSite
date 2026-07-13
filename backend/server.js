const express = require('express');
const path = require('path');
const { listDatabases } = require('./db/db');
const dataRoutes = require('./routes/data');

const app = express();
// surchageable par le harnais de vérification (jsdom), pour ne jamais
// toucher au vrai port pendant le développement/les tests
const PORT = process.env.DATASITE_PORT || 3000;

// limite relevée pour accepter les images importées en base64 (data URI) dans les lignes
app.use(express.json({ limit: '15mb' }));

// Sert le frontend (HTML/CSS/JS statiques)
app.use(express.static(path.join(__dirname, '../frontend')));

// outil local mono-utilisateur : pas d'authentification
app.use('/api', dataRoutes);

// Route de contrôle simple
app.get('/api/ping', (req, res) => {
  res.json({ ok: true, databases: listDatabases().map(d => d.id) });
});

app.listen(PORT, () => {
  console.log(`Serveur lancé sur http://localhost:${PORT}`);
});
