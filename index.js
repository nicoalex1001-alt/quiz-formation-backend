const express = require('express');
const cors = require('cors');
const Database = require('better-sqlite3');
const path = require('path');

const app = express();
const PORT = 3001;

app.use(cors());
app.use(express.json());

const db = new Database(path.join(__dirname, 'quiz.db'));

db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nom TEXT NOT NULL,
    intitule TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS apprenants (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER,
    prenom TEXT,
    nom TEXT,
    token TEXT UNIQUE NOT NULL,
    FOREIGN KEY (session_id) REFERENCES sessions(id)
  );

  CREATE TABLE IF NOT EXISTS reponses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    apprenant_id INTEGER,
    question_id INTEGER,
    reponse TEXT,
    correct INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (apprenant_id) REFERENCES apprenants(id)
  );

  CREATE TABLE IF NOT EXISTS questions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER,
    question TEXT NOT NULL,
    choix TEXT NOT NULL,
    bonne_reponse TEXT NOT NULL,
    FOREIGN KEY (session_id) REFERENCES sessions(id)
  );
`);

// — ROUTES —

// Récupérer les questions d'une session
app.get('/api/session/:id/questions', (req, res) => {
  const questions = db.prepare(
    'SELECT * FROM questions WHERE session_id = ?'
  ).all(req.params.id);
  res.json(questions);
});

// Test
app.get('/', (req, res) => {
  res.json({ status: 'OK', message: 'Serveur quiz en ligne' });
});

// Identifier un apprenant par token
app.get('/api/apprenant/:token', (req, res) => {
  const apprenant = db.prepare(
    'SELECT a.*, s.intitule FROM apprenants a JOIN sessions s ON a.session_id = s.id WHERE a.token = ?'
  ).get(req.params.token);
  if (!apprenant) return res.status(404).json({ error: 'Token invalide' });
  res.json(apprenant);
});

// Soumettre les réponses d'un apprenant
app.post('/api/reponses', (req, res) => {
  const { apprenant_id, reponses } = req.body;
  const insert = db.prepare(
    'INSERT INTO reponses (apprenant_id, question_id, reponse, correct) VALUES (?, ?, ?, ?)'
  );
  const insertMany = db.transaction((items) => {
    for (const r of items) insert.run(apprenant_id, r.question_id, r.reponse, r.correct);
  });
  insertMany(reponses);
  res.json({ success: true });
});

// Résultats d'une session (dashboard formateur)
app.get('/api/session/:id/resultats', (req, res) => {
  const resultats = db.prepare(`
    SELECT a.prenom, a.nom, COUNT(r.id) as nb_reponses,
    SUM(r.correct) as score
    FROM apprenants a
    LEFT JOIN reponses r ON r.apprenant_id = a.id
    WHERE a.session_id = ?
    GROUP BY a.id
  `).all(req.params.id);
  res.json(resultats);
});

// Ajouter des questions à une session
app.post('/api/session/:id/questions', (req, res) => {
  const { questions } = req.body;
  const insert = db.prepare(
    'INSERT INTO questions (session_id, question, choix, bonne_reponse) VALUES (?, ?, ?, ?)'
  );
  for (const q of questions) {
    insert.run(req.params.id, q.question, JSON.stringify(q.choix), q.bonne_reponse);
  }
  res.json({ success: true });
});

// Créer une session avec ses apprenants
app.post('/api/session', (req, res) => {
  const { nom, intitule, apprenants } = req.body;
  const session = db.prepare('INSERT INTO sessions (nom, intitule) VALUES (?, ?)');
  const insertApp = db.prepare('INSERT INTO apprenants (session_id, prenom, nom, token) VALUES (?, ?, ?, ?)');
  const crypto = require('crypto');
  const tokens = [];
  const sessionRow = session.run(nom, intitule);
  for (const a of apprenants) {
    const token = crypto.randomBytes(8).toString('hex');
    insertApp.run(sessionRow.lastInsertRowid, a.prenom, a.nom, token);
    tokens.push({ ...a, token });
  }
  res.json({ session_id: sessionRow.lastInsertRowid, apprenants: tokens });
});

// Générer les QR codes d'une session
const QRCode = require('qrcode');

app.get('/api/session/:id/qrcodes', async (req, res) => {
  const apprenants = db.prepare(
    'SELECT * FROM apprenants WHERE session_id = ?'
  ).all(req.params.id);

  const BASE_URL = 'http://localhost:3000';
  let html = `<html><head><meta charset="utf-8">
    <style>
      body { font-family: sans-serif; padding: 20px; }
      .card { display: inline-block; margin: 20px; text-align: center; padding: 20px; border: 1px solid #ddd; border-radius: 12px; }
      h2 { color: #4F46E5; }
    </style></head><body>
    <h1>QR Codes — Session ${req.params.id}</h1>`;

  for (const a of apprenants) {
    const url = `${BASE_URL}/?token=${a.token}`;
    const qr = await QRCode.toDataURL(url);
    html += `<div class="card">
      <img src="${qr}" width="200"/><br>
      <strong>${a.prenom} ${a.nom}</strong><br>
      <small>${url}</small>
    </div>`;
  }

  html += '</body></html>';
  res.send(html);
});

app.listen(PORT, () => {
  console.log(`Serveur démarré sur http://localhost:${PORT}`);
});