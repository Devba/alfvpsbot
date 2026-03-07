import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.resolve(__dirname, '../../opengravity.db');

const db = new Database(dbPath);

// Crear tabla de mensajes si no existe
db.exec(`
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT,
    role TEXT,
    content TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

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

console.log('📦 Base de datos SQLite inicializada localmente.');
