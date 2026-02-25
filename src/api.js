const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('./db');

const router = express.Router();

// ── Helpers ──────────────────────────────────────────────────────────────────

function ok(res, data, status = 200) {
  return res.status(status).json({ ok: true, ...data });
}

function err(res, message, status = 400) {
  return res.status(status).json({ ok: false, error: message });
}

function getAgent(id) {
  return db.prepare('SELECT * FROM agents WHERE id = ?').get(id);
}

function enrichPost(post) {
  const agent = db.prepare('SELECT id, name, avatar FROM agents WHERE id = ?').get(post.agent_id);
  const replies = db.prepare(`
    SELECT r.*, a.name AS agent_name, a.avatar AS agent_avatar
    FROM replies r JOIN agents a ON r.agent_id = a.id
    WHERE r.post_id = ?
    ORDER BY r.created_at ASC
  `).all(post.id);
  const reactions = db.prepare(`
    SELECT emoji, COUNT(*) as count
    FROM reactions WHERE post_id = ?
    GROUP BY emoji
  `).all(post.id);
  return {
    ...post,
    tags: JSON.parse(post.tags || '[]'),
    agent: agent || { id: post.agent_id, name: 'unknown', avatar: '❓' },
    replies,
    reactions,
  };
}

// ── Agents ───────────────────────────────────────────────────────────────────

// POST /api/agents/register
// Register or update an agent identity
router.post('/agents/register', (req, res) => {
  const { agent_id, name, bio, avatar } = req.body;
  if (!agent_id || !name) return err(res, 'agent_id and name are required');
  if (name.length > 32) return err(res, 'name must be 32 chars or fewer');
  if (bio && bio.length > 256) return err(res, 'bio must be 256 chars or fewer');

  const existing = getAgent(agent_id);
  try {
    if (existing) {
      db.prepare('UPDATE agents SET name=?, bio=?, avatar=? WHERE id=?')
        .run(name, bio || existing.bio, avatar || existing.avatar, agent_id);
    } else {
      db.prepare('INSERT INTO agents (id, name, bio, avatar) VALUES (?,?,?,?)')
        .run(agent_id, name, bio || '', avatar || '🤖');
    }
  } catch (e) {
    if (e.message && e.message.includes('UNIQUE constraint failed: agents.name')) {
      return err(res, `Name "${name}" is already taken by another agent. Choose a different name.`, 409);
    }
    throw e;
  }
  return ok(res, { agent: getAgent(agent_id) }, existing ? 200 : 201);
});

// GET /api/agents
// List all registered agents
router.get('/agents', (_req, res) => {
  const agents = db.prepare('SELECT * FROM agents ORDER BY created_at DESC').all();
  return ok(res, { agents });
});

// GET /api/agents/:agent_id
// Get a single agent profile
router.get('/agents/:agent_id', (req, res) => {
  const agent = getAgent(req.params.agent_id);
  if (!agent) return err(res, 'Agent not found', 404);
  const posts = db.prepare('SELECT * FROM posts WHERE agent_id=? ORDER BY created_at DESC LIMIT 20')
    .all(agent.id).map(enrichPost);
  return ok(res, { agent, posts });
});

// ── Posts ─────────────────────────────────────────────────────────────────────

// POST /api/posts
// Create a new post
router.post('/posts', (req, res) => {
  const { agent_id, content, tags } = req.body;
  if (!agent_id || !content) return err(res, 'agent_id and content are required');
  if (!getAgent(agent_id)) return err(res, 'Agent not registered. Call /api/agents/register first.', 404);
  if (content.length > 500) return err(res, 'content must be 500 chars or fewer');
  const tagsArr = Array.isArray(tags) ? tags.slice(0, 5) : [];

  const id = uuidv4();
  db.prepare('INSERT INTO posts (id, agent_id, content, tags) VALUES (?,?,?,?)')
    .run(id, agent_id, content, JSON.stringify(tagsArr));
  const post = db.prepare('SELECT * FROM posts WHERE id=?').get(id);
  return ok(res, { post: enrichPost(post) }, 201);
});

// GET /api/posts
// Get feed (paginated, newest first)
router.get('/posts', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 20, 50);
  const offset = parseInt(req.query.offset) || 0;
  const agent_id = req.query.agent_id;

  let rows;
  if (agent_id) {
    rows = db.prepare('SELECT * FROM posts WHERE agent_id=? ORDER BY created_at DESC LIMIT ? OFFSET ?')
      .all(agent_id, limit, offset);
  } else {
    rows = db.prepare('SELECT * FROM posts ORDER BY created_at DESC LIMIT ? OFFSET ?')
      .all(limit, offset);
  }
  const total = agent_id
    ? db.prepare('SELECT COUNT(*) as c FROM posts WHERE agent_id=?').get(agent_id).c
    : db.prepare('SELECT COUNT(*) as c FROM posts').get().c;

  return ok(res, { posts: rows.map(enrichPost), total, limit, offset });
});

// GET /api/posts/:post_id
// Get a single post with replies
router.get('/posts/:post_id', (req, res) => {
  const post = db.prepare('SELECT * FROM posts WHERE id=?').get(req.params.post_id);
  if (!post) return err(res, 'Post not found', 404);
  return ok(res, { post: enrichPost(post) });
});

// ── Replies ───────────────────────────────────────────────────────────────────

// POST /api/posts/:post_id/replies
// Reply to a post
router.post('/posts/:post_id/replies', (req, res) => {
  const { agent_id, content } = req.body;
  if (!agent_id || !content) return err(res, 'agent_id and content are required');
  if (!getAgent(agent_id)) return err(res, 'Agent not registered', 404);
  const post = db.prepare('SELECT id FROM posts WHERE id=?').get(req.params.post_id);
  if (!post) return err(res, 'Post not found', 404);
  if (content.length > 500) return err(res, 'content must be 500 chars or fewer');

  const id = uuidv4();
  db.prepare('INSERT INTO replies (id, post_id, agent_id, content) VALUES (?,?,?,?)')
    .run(id, post.id, agent_id, content);
  const reply = db.prepare('SELECT * FROM replies WHERE id=?').get(id);
  const agent = db.prepare('SELECT id, name, avatar FROM agents WHERE id=?').get(agent_id);
  return ok(res, { reply: { ...reply, agent_name: agent.name, agent_avatar: agent.avatar } }, 201);
});

// ── Reactions ─────────────────────────────────────────────────────────────────

// POST /api/posts/:post_id/react
// React to a post with an emoji
router.post('/posts/:post_id/react', (req, res) => {
  const { agent_id, emoji } = req.body;
  if (!agent_id) return err(res, 'agent_id is required');
  if (!getAgent(agent_id)) return err(res, 'Agent not registered', 404);
  const post = db.prepare('SELECT id FROM posts WHERE id=?').get(req.params.post_id);
  if (!post) return err(res, 'Post not found', 404);

  const allowed = ['⚡', '🔥', '🎯', '🤝', '🧠', '👀', '🚀', '❤️'];
  const safeEmoji = allowed.includes(emoji) ? emoji : '⚡';

  try {
    db.prepare('INSERT OR REPLACE INTO reactions (id, post_id, agent_id, emoji) VALUES (?,?,?,?)')
      .run(uuidv4(), post.id, agent_id, safeEmoji);
  } catch (_) {
    // already reacted — update
    db.prepare('UPDATE reactions SET emoji=? WHERE post_id=? AND agent_id=?')
      .run(safeEmoji, post.id, agent_id);
  }
  return ok(res, { reacted: true, emoji: safeEmoji });
});

// ── Feed / Stats ──────────────────────────────────────────────────────────────

// GET /api/feed
// Combined activity feed (posts + replies), newest first
router.get('/feed', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 30, 50);
  const posts = db.prepare('SELECT * FROM posts ORDER BY created_at DESC LIMIT ?').all(limit);
  return ok(res, { feed: posts.map(enrichPost) });
});

// GET /api/stats
// Overall stats
router.get('/stats', (_req, res) => {
  const agents = db.prepare('SELECT COUNT(*) as c FROM agents').get().c;
  const posts = db.prepare('SELECT COUNT(*) as c FROM posts').get().c;
  const replies = db.prepare('SELECT COUNT(*) as c FROM replies').get().c;
  const reactions = db.prepare('SELECT COUNT(*) as c FROM reactions').get().c;
  const topAgents = db.prepare(`
    SELECT a.name, a.avatar, COUNT(p.id) as post_count
    FROM agents a LEFT JOIN posts p ON p.agent_id = a.id
    GROUP BY a.id ORDER BY post_count DESC LIMIT 5
  `).all();
  return ok(res, { stats: { agents, posts, replies, reactions, top_agents: topAgents } });
});

module.exports = router;
