import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.resolve(__dirname, '../../opengravity.db');

const db = new Database(dbPath);

// --- Inicialización de Tablas ---

// Tabla de mensajes (Historial reciente)
db.exec(`
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT,
    role TEXT,
    content TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

// Tabla de memorias (Skill 6 - RAG-Lite)
db.exec(`
  CREATE TABLE IF NOT EXISTS memories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    category TEXT NOT NULL,
    content TEXT NOT NULL,
    importance INTEGER DEFAULT 3,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

// --- Funciones de Mensajería ---

export const saveMessage = (userId, role, content) => {
  const insert = db.prepare('INSERT INTO messages (user_id, role, content) VALUES (?, ?, ?)');
  insert.run(userId, role, content);
};

export const getHistory = (userId, limit = 15) => {
  const query = db.prepare(`
    SELECT role, content FROM (
      SELECT role, content, id FROM messages 
      WHERE user_id = ? 
      ORDER BY id DESC 
      LIMIT ?
    ) ORDER BY id ASC
  `);
  return query.all(userId, limit);
};

// --- Funciones de Memoria (Skill 6) ---

export const addMemory = (category, content, importance) => {
  const insert = db.prepare('INSERT INTO memories (category, content, importance) VALUES (?, ?, ?)');
  return insert.run(category, content, importance);
};

export const searchMemories = (term) => {
  const query = db.prepare(`
    SELECT * FROM memories 
    WHERE category LIKE ? OR content LIKE ? 
    ORDER BY importance DESC, created_at DESC 
    LIMIT 5
  `);
  return query.all(`%${term}%`, `%${term}%`);
};

export const checkDuplicateMemory = (category, contentSnippet) => {
  const query = db.prepare('SELECT id, content FROM memories WHERE category = ? AND content LIKE ? LIMIT 1');
  return query.get(category, `%${contentSnippet}%`);
};

export const deleteMemory = (id) => {
  const query = db.prepare('DELETE FROM memories WHERE id = ?');
  return query.run(id);
};

export const getIdentityMemories = () => {
  const query = db.prepare("SELECT category, content FROM memories WHERE category IN ('identidad', 'preferencias') ORDER BY importance DESC");
  return query.all();
};

console.log('📦 Base de datos SQLite inicializada localmente.');
