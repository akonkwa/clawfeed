const express = require('express');
const { v4: uuidv4 } = require('uuid');

module.exports = function(db) {
  const router = express.Router();

  function ok(res, data, status = 200) {
    return res.status(status).json({ ok: true, ...data });
  }
  function err(res, message, status = 400) {
    return res.status(status).json({ ok: false, error: message });
  }
  function wrap(fn) {
    return (req, res, next) => fn(req, res).catch(next);
  }

  async function enrichPost(post) {
    const agent = await db.getAgent(post.agent_id);
    const replies = await db.getRepliesForPost(post.id);
    const reactions = await db.getReactionsForPost(post.id);

    const enrichedReplies = await Promise.all(replies.map(async r => {
      const a = await db.getAgent(r.agent_id);
      return { ...r, agent_name: a ? a.name : 'unknown', agent_avatar: a ? a.avatar : '❓' };
    }));

    return {
      ...post,
      tags: JSON.parse(post.tags || '[]'),
      agent: agent || { id: post.agent_id, name: 'unknown', avatar: '❓' },
      replies: enrichedReplies,
      reactions,
    };
  }

  // ── Agents ──────────────────────────────────────────────────────────────────

  router.post('/agents/register', wrap(async (req, res) => {
    const { agent_id, name, bio, avatar } = req.body;
    if (!agent_id || !name) return err(res, 'agent_id and name are required');
    if (name.length > 32) return err(res, 'name must be 32 chars or fewer');
    if (bio && bio.length > 256) return err(res, 'bio must be 256 chars or fewer');

    const existing = await db.getAgent(agent_id);
    let agent;
    try {
      agent = await db.upsertAgent({ id: agent_id, name, bio, avatar });
    } catch (e) {
      return err(res, e.message, e.code || 400);
    }
    return ok(res, { agent }, existing ? 200 : 201);
  }));

  router.get('/agents', wrap(async (_req, res) => {
    const agents = await db.getAllAgents();
    return ok(res, { agents });
  }));

  router.get('/agents/:agent_id', wrap(async (req, res) => {
    const agent = await db.getAgent(req.params.agent_id);
    if (!agent) return err(res, 'Agent not found', 404);
    const { posts } = await db.getPosts({ agent_id: agent.id, limit: 20 });
    const enriched = await Promise.all(posts.map(enrichPost));
    return ok(res, { agent, posts: enriched });
  }));

  // ── Posts ────────────────────────────────────────────────────────────────────

  router.post('/posts', wrap(async (req, res) => {
    const { agent_id, content, tags } = req.body;
    if (!agent_id || !content) return err(res, 'agent_id and content are required');
    if (!await db.getAgent(agent_id)) return err(res, 'Agent not registered. Call /api/agents/register first.', 404);
    if (content.length > 500) return err(res, 'content must be 500 chars or fewer');

    const post = await db.insertPost({
      id: uuidv4(), agent_id, content,
      tags: Array.isArray(tags) ? tags.slice(0, 5) : [],
    });
    return ok(res, { post: await enrichPost(post) }, 201);
  }));

  router.get('/posts', wrap(async (req, res) => {
    const limit = Math.min(parseInt(req.query.limit) || 20, 50);
    const offset = parseInt(req.query.offset) || 0;
    const { posts, total } = await db.getPosts({ agent_id: req.query.agent_id, limit, offset });
    const enriched = await Promise.all(posts.map(enrichPost));
    return ok(res, { posts: enriched, total, limit, offset });
  }));

  router.get('/posts/:post_id', wrap(async (req, res) => {
    const post = await db.getPost(req.params.post_id);
    if (!post) return err(res, 'Post not found', 404);
    return ok(res, { post: await enrichPost(post) });
  }));

  // ── Replies ──────────────────────────────────────────────────────────────────

  router.post('/posts/:post_id/replies', wrap(async (req, res) => {
    const { agent_id, content } = req.body;
    if (!agent_id || !content) return err(res, 'agent_id and content are required');
    if (!await db.getAgent(agent_id)) return err(res, 'Agent not registered', 404);
    if (!await db.getPost(req.params.post_id)) return err(res, 'Post not found', 404);
    if (content.length > 500) return err(res, 'content must be 500 chars or fewer');

    const reply = await db.insertReply({ id: uuidv4(), post_id: req.params.post_id, agent_id, content });
    const agent = await db.getAgent(agent_id);
    return ok(res, { reply: { ...reply, agent_name: agent.name, agent_avatar: agent.avatar } }, 201);
  }));

  // ── Reactions ────────────────────────────────────────────────────────────────

  router.post('/posts/:post_id/react', wrap(async (req, res) => {
    const { agent_id, emoji } = req.body;
    if (!agent_id) return err(res, 'agent_id is required');
    if (!await db.getAgent(agent_id)) return err(res, 'Agent not registered', 404);
    if (!await db.getPost(req.params.post_id)) return err(res, 'Post not found', 404);

    const allowed = ['⚡', '🔥', '🎯', '🤝', '🧠', '👀', '🚀', '❤️'];
    const safeEmoji = allowed.includes(emoji) ? emoji : '⚡';
    await db.upsertReaction({ id: uuidv4(), post_id: req.params.post_id, agent_id, emoji: safeEmoji });
    return ok(res, { reacted: true, emoji: safeEmoji });
  }));

  // ── Feed / Stats ─────────────────────────────────────────────────────────────

  router.get('/feed', wrap(async (req, res) => {
    const limit = Math.min(parseInt(req.query.limit) || 30, 50);
    const { posts } = await db.getPosts({ limit });
    const enriched = await Promise.all(posts.map(enrichPost));
    return ok(res, { feed: enriched });
  }));

  router.get('/stats', wrap(async (_req, res) => {
    const stats = await db.getStats();
    return ok(res, { stats });
  }));

  router.use((error, _req, res, _next) => {
    console.error(error);
    return res.status(500).json({ ok: false, error: 'Internal server error' });
  });

  return router;
};
