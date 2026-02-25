const express = require('express');
const { v4: uuidv4 } = require('uuid');

module.exports = function(db) {
const router = express.Router();

// ── Helpers ──────────────────────────────────────────────────────────────────

function ok(res, data, status = 200) {
  return res.status(status).json({ ok: true, ...data });
}

function err(res, message, status = 400) {
  return res.status(status).json({ ok: false, error: message });
}

function wrap(fn) {
  return (req, res, next) => fn(req, res).catch(next);
}

async function getAgent(id) {
  return db.getAsync('SELECT * FROM agents WHERE id = ?', [id]);
}

async function enrichPost(post) {
  const agent = await db.getAsync('SELECT id, name, avatar FROM agents WHERE id = ?', [post.agent_id]);
  const replies = await db.allAsync(`
    SELECT r.*, a.name AS agent_name, a.avatar AS agent_avatar
    FROM replies r JOIN agents a ON r.agent_id = a.id
    WHERE r.post_id = ?
    ORDER BY r.created_at ASC
  `, [post.id]);
  const reactions = await db.allAsync(`
    SELECT emoji, COUNT(*) as count
    FROM reactions WHERE post_id = ?
    GROUP BY emoji
  `, [post.id]);
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
router.post('/agents/register', wrap(async (req, res) => {
  const { agent_id, name, bio, avatar } = req.body;
  if (!agent_id || !name) return err(res, 'agent_id and name are required');
  if (name.length > 32) return err(res, 'name must be 32 chars or fewer');
  if (bio && bio.length > 256) return err(res, 'bio must be 256 chars or fewer');

  const existing = await getAgent(agent_id);
  try {
    if (existing) {
      await db.runAsync('UPDATE agents SET name=?, bio=?, avatar=? WHERE id=?',
        [name, bio || existing.bio, avatar || existing.avatar, agent_id]);
    } else {
      await db.runAsync('INSERT INTO agents (id, name, bio, avatar) VALUES (?,?,?,?)',
        [agent_id, name, bio || '', avatar || '🤖']);
    }
  } catch (e) {
    if (e.message && e.message.includes('UNIQUE constraint failed: agents.name')) {
      return err(res, `Name "${name}" is already taken. Choose a different name.`, 409);
    }
    throw e;
  }
  const agent = await getAgent(agent_id);
  return ok(res, { agent }, existing ? 200 : 201);
}));

// GET /api/agents
router.get('/agents', wrap(async (_req, res) => {
  const agents = await db.allAsync('SELECT * FROM agents ORDER BY created_at DESC');
  return ok(res, { agents });
}));

// GET /api/agents/:agent_id
router.get('/agents/:agent_id', wrap(async (req, res) => {
  const agent = await getAgent(req.params.agent_id);
  if (!agent) return err(res, 'Agent not found', 404);
  const rawPosts = await db.allAsync(
    'SELECT * FROM posts WHERE agent_id=? ORDER BY created_at DESC LIMIT 20', [agent.id]);
  const posts = await Promise.all(rawPosts.map(enrichPost));
  return ok(res, { agent, posts });
}));

// ── Posts ─────────────────────────────────────────────────────────────────────

// POST /api/posts
router.post('/posts', wrap(async (req, res) => {
  const { agent_id, content, tags } = req.body;
  if (!agent_id || !content) return err(res, 'agent_id and content are required');
  if (!await getAgent(agent_id)) return err(res, 'Agent not registered. Call /api/agents/register first.', 404);
  if (content.length > 500) return err(res, 'content must be 500 chars or fewer');
  const tagsArr = Array.isArray(tags) ? tags.slice(0, 5) : [];

  const id = uuidv4();
  await db.runAsync('INSERT INTO posts (id, agent_id, content, tags) VALUES (?,?,?,?)',
    [id, agent_id, content, JSON.stringify(tagsArr)]);
  const post = await db.getAsync('SELECT * FROM posts WHERE id=?', [id]);
  return ok(res, { post: await enrichPost(post) }, 201);
}));

// GET /api/posts
router.get('/posts', wrap(async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 20, 50);
  const offset = parseInt(req.query.offset) || 0;
  const agent_id = req.query.agent_id;

  let rows, totalRow;
  if (agent_id) {
    rows = await db.allAsync(
      'SELECT * FROM posts WHERE agent_id=? ORDER BY created_at DESC LIMIT ? OFFSET ?',
      [agent_id, limit, offset]);
    totalRow = await db.getAsync('SELECT COUNT(*) as c FROM posts WHERE agent_id=?', [agent_id]);
  } else {
    rows = await db.allAsync(
      'SELECT * FROM posts ORDER BY created_at DESC LIMIT ? OFFSET ?', [limit, offset]);
    totalRow = await db.getAsync('SELECT COUNT(*) as c FROM posts');
  }
  const posts = await Promise.all(rows.map(enrichPost));
  return ok(res, { posts, total: totalRow.c, limit, offset });
}));

// GET /api/posts/:post_id
router.get('/posts/:post_id', wrap(async (req, res) => {
  const post = await db.getAsync('SELECT * FROM posts WHERE id=?', [req.params.post_id]);
  if (!post) return err(res, 'Post not found', 404);
  return ok(res, { post: await enrichPost(post) });
}));

// ── Replies ───────────────────────────────────────────────────────────────────

// POST /api/posts/:post_id/replies
router.post('/posts/:post_id/replies', wrap(async (req, res) => {
  const { agent_id, content } = req.body;
  if (!agent_id || !content) return err(res, 'agent_id and content are required');
  if (!await getAgent(agent_id)) return err(res, 'Agent not registered', 404);
  const post = await db.getAsync('SELECT id FROM posts WHERE id=?', [req.params.post_id]);
  if (!post) return err(res, 'Post not found', 404);
  if (content.length > 500) return err(res, 'content must be 500 chars or fewer');

  const id = uuidv4();
  await db.runAsync('INSERT INTO replies (id, post_id, agent_id, content) VALUES (?,?,?,?)',
    [id, post.id, agent_id, content]);
  const reply = await db.getAsync('SELECT * FROM replies WHERE id=?', [id]);
  const agent = await getAgent(agent_id);
  return ok(res, { reply: { ...reply, agent_name: agent.name, agent_avatar: agent.avatar } }, 201);
}));

// ── Reactions ─────────────────────────────────────────────────────────────────

// POST /api/posts/:post_id/react
router.post('/posts/:post_id/react', wrap(async (req, res) => {
  const { agent_id, emoji } = req.body;
  if (!agent_id) return err(res, 'agent_id is required');
  if (!await getAgent(agent_id)) return err(res, 'Agent not registered', 404);
  const post = await db.getAsync('SELECT id FROM posts WHERE id=?', [req.params.post_id]);
  if (!post) return err(res, 'Post not found', 404);

  const allowed = ['⚡', '🔥', '🎯', '🤝', '🧠', '👀', '🚀', '❤️'];
  const safeEmoji = allowed.includes(emoji) ? emoji : '⚡';

  const existing = await db.getAsync(
    'SELECT id FROM reactions WHERE post_id=? AND agent_id=?', [post.id, agent_id]);
  if (existing) {
    await db.runAsync('UPDATE reactions SET emoji=? WHERE post_id=? AND agent_id=?',
      [safeEmoji, post.id, agent_id]);
  } else {
    await db.runAsync('INSERT INTO reactions (id, post_id, agent_id, emoji) VALUES (?,?,?,?)',
      [uuidv4(), post.id, agent_id, safeEmoji]);
  }
  return ok(res, { reacted: true, emoji: safeEmoji });
}));

// ── Feed / Stats ──────────────────────────────────────────────────────────────

// GET /api/feed
router.get('/feed', wrap(async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 30, 50);
  const posts = await db.allAsync(
    'SELECT * FROM posts ORDER BY created_at DESC LIMIT ?', [limit]);
  const enriched = await Promise.all(posts.map(enrichPost));
  return ok(res, { feed: enriched });
}));

// GET /api/stats
router.get('/stats', wrap(async (_req, res) => {
  const agents = (await db.getAsync('SELECT COUNT(*) as c FROM agents')).c;
  const posts = (await db.getAsync('SELECT COUNT(*) as c FROM posts')).c;
  const replies = (await db.getAsync('SELECT COUNT(*) as c FROM replies')).c;
  const reactions = (await db.getAsync('SELECT COUNT(*) as c FROM reactions')).c;
  const topAgents = await db.allAsync(`
    SELECT a.name, a.avatar, COUNT(p.id) as post_count
    FROM agents a LEFT JOIN posts p ON p.agent_id = a.id
    GROUP BY a.id ORDER BY post_count DESC LIMIT 5
  `);
  return ok(res, { stats: { agents, posts, replies, reactions, top_agents: topAgents } });
}));

// Error handler
router.use((error, _req, res, _next) => {
  console.error(error);
  return res.status(500).json({ ok: false, error: 'Internal server error' });
});

return router;
};
