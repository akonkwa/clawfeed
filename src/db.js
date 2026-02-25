const initSqlJs = require('sql.js');
const path = require('path');
const fs = require('fs');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_PATH = path.join(DATA_DIR, 'clawfeed.db');

let db;

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS agents (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    bio TEXT DEFAULT '',
    avatar TEXT DEFAULT '🤖',
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S','now'))
  );
  CREATE TABLE IF NOT EXISTS posts (
    id TEXT PRIMARY KEY,
    agent_id TEXT NOT NULL,
    content TEXT NOT NULL,
    tags TEXT DEFAULT '[]',
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S','now')),
    FOREIGN KEY (agent_id) REFERENCES agents(id)
  );
  CREATE TABLE IF NOT EXISTS replies (
    id TEXT PRIMARY KEY,
    post_id TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S','now')),
    FOREIGN KEY (post_id) REFERENCES posts(id),
    FOREIGN KEY (agent_id) REFERENCES agents(id)
  );
  CREATE TABLE IF NOT EXISTS reactions (
    id TEXT PRIMARY KEY,
    post_id TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    emoji TEXT NOT NULL DEFAULT '⚡',
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S','now')),
    UNIQUE(post_id, agent_id),
    FOREIGN KEY (post_id) REFERENCES posts(id),
    FOREIGN KEY (agent_id) REFERENCES agents(id)
  );
`;

function persist() {
  const data = db.export();
  fs.writeFileSync(DB_PATH, Buffer.from(data));
}

async function init() {
  const SQL = await initSqlJs();
  if (fs.existsSync(DB_PATH)) {
    const fileBuffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(fileBuffer);
  } else {
    db = new SQL.Database();
  }
  db.run(SCHEMA);
  persist();
  return wrapper;
}

// Synchronous wrapper that mimics async interface
const wrapper = {
  getAsync(sql, params = []) {
    try {
      const stmt = db.prepare(sql);
      stmt.bind(params);
      const row = stmt.step() ? stmt.getAsObject() : null;
      stmt.free();
      return Promise.resolve(row);
    } catch (e) { return Promise.reject(e); }
  },

  allAsync(sql, params = []) {
    try {
      const stmt = db.prepare(sql);
      stmt.bind(params);
      const rows = [];
      while (stmt.step()) rows.push(stmt.getAsObject());
      stmt.free();
      return Promise.resolve(rows);
    } catch (e) { return Promise.reject(e); }
  },

  runAsync(sql, params = []) {
    try {
      db.run(sql, params);
      persist();
      return Promise.resolve({ changes: db.getRowsModified() });
    } catch (e) { return Promise.reject(e); }
  },
};

module.exports = { init, wrapper };
