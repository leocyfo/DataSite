
const Database = require('better-sqlite3');
const path = require('path');

function seedClients() {
  const db = new Database(path.join(__dirname, 'clients.db'));
  db.exec(`
    DROP TABLE IF EXISTS utilisateurs;
    CREATE TABLE utilisateurs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nom TEXT, email TEXT, ville TEXT, actif TEXT
    );
    DROP TABLE IF EXISTS commandes;
    CREATE TABLE commandes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id INTEGER, montant REAL, statut TEXT
    );
  `);
  const insertUser = db.prepare('INSERT INTO utilisateurs (nom, email, ville, actif) VALUES (?, ?, ?, ?)');
  [
    ['Marie Tremblay', 'marie.t@mail.com', 'Montréal', 'oui'],
    ['Léo Bouchard', 'leo.b@mail.com', 'Québec', 'oui'],
    ['Amina Cissé', 'amina.c@mail.com', 'Sherbrooke', 'non'],
    ['Julien Roy', 'julien.r@mail.com', 'Laval', 'oui'],
    ['Sofia Ndiaye', 'sofia.n@mail.com', 'Gatineau', 'oui'],
  ].forEach(row => insertUser.run(...row));

  const insertOrder = db.prepare('INSERT INTO commandes (client_id, montant, statut) VALUES (?, ?, ?)');
  [
    [1, 89.90, 'livrée'],
    [2, 34.50, 'en cours'],
    [4, 120.00, 'livrée'],
  ].forEach(row => insertOrder.run(...row));

  db.close();
  console.log('clients.db créée');
}

function seedCapteurs() {
  const db = new Database(path.join(__dirname, 'capteurs.db'));
  db.exec(`
    DROP TABLE IF EXISTS mesures;
    CREATE TABLE mesures (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      capteur TEXT, valeur REAL, unite TEXT, horodatage TEXT
    );
  `);
  const insert = db.prepare('INSERT INTO mesures (capteur, valeur, unite, horodatage) VALUES (?, ?, ?, ?)');
  [
    ['temp_salon', 21.4, '°C', '2026-07-01 08:00'],
    ['temp_salon', 21.8, '°C', '2026-07-01 09:00'],
    ['humidite_cave', 62, '%', '2026-07-01 08:00'],
    ['temp_exterieur', 18.2, '°C', '2026-07-01 08:00'],
  ].forEach(row => insert.run(...row));

  db.close();
  console.log('capteurs.db créée');
}

function seedInventaire() {
  const db = new Database(path.join(__dirname, 'inventaire.db'));
  db.exec(`
    DROP TABLE IF EXISTS produits;
    CREATE TABLE produits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nom TEXT, quantite INTEGER, prix REAL, categorie TEXT
    );
    DROP TABLE IF EXISTS fournisseurs;
    CREATE TABLE fournisseurs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nom TEXT, pays TEXT
    );
  `);
  const insertProduit = db.prepare('INSERT INTO produits (nom, quantite, prix, categorie) VALUES (?, ?, ?, ?)');
  [
    ['Câble USB-C', 42, 8.99, 'électronique'],
    ['Tournevis', 15, 12.50, 'outils'],
    ['Carnet A5', 88, 3.20, 'bureau'],
    ['Ampoule LED', 60, 4.75, 'maison'],
  ].forEach(row => insertProduit.run(...row));

  const insertFournisseur = db.prepare('INSERT INTO fournisseurs (nom, pays) VALUES (?, ?)');
  [
    ['TechDistrib', 'Canada'],
    ['OutilPro', 'France'],
  ].forEach(row => insertFournisseur.run(...row));

  db.close();
  console.log('inventaire.db créée');
}

seedClients();
seedCapteurs();
seedInventaire();
console.log('Toutes les bases sont prêtes.');
