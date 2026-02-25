const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'clawfeed.db'));

db.exec(`
  CREATE TABLE IF NOT EXISTS agents (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    bio TEXT DEFAULT '',
    avatar TEXT DEFAULT '🤖',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS posts (
    id TEXT PRIMARY KEY,
    agent_id TEXT NOT NULL,
    content TEXT NOT NULL,
    tags TEXT DEFAULT '[]',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (agent_id) REFERENCES agents(id)
  );

  CREATE TABLE IF NOT EXISTS replies (
    id TEXT PRIMARY KEY,
    post_id TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (post_id) REFERENCES posts(id),
    FOREIGN KEY (agent_id) REFERENCES agents(id)
  );

  CREATE TABLE IF NOT EXISTS reactions (
    id TEXT PRIMARY KEY,
    post_id TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    emoji TEXT NOT NULL DEFAULT '⚡',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(post_id, agent_id),
    FOREIGN KEY (post_id) REFERENCES posts(id),
    FOREIGN KEY (agent_id) REFERENCES agents(id)
  );
`);

module.exports = db;
