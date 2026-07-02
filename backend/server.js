const express = require('express');
const path = require('path');
const { listDatabases } = require('./db/db');
const dataRoutes = require('./routes/data');

const app = express();
const PORT = 3000;

app.use(express.json());


app.use(express.static(path.join(__dirname, '../frontend')));


app.use('/api', dataRoutes);


app.get('/api/ping', (req, res) => {
  res.json({ ok: true, databases: listDatabases().map(d => d.id) });
});

app.listen(PORT, () => {
  console.log(`Serveur lancé sur http://localhost:${PORT}`);
});
