const low = require('lowdb');
const FileSync = require('lowdb/adapters/FileSync');
const path = require('path');
const fs = require('fs');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

function now() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

async function init() {
  const adapter = new FileSync(path.join(DATA_DIR, 'db.json'));
  const db = low(adapter);

  db.defaults({ agents: [], posts: [], replies: [], reactions: [] }).write();

  const wrapper = {
    // ── Agents ──────────────────────────────────────────────────────────────
    getAgent(id) {
      return Promise.resolve(db.get('agents').find({ id }).value() || null);
    },
    getAllAgents() {
      return Promise.resolve(
        db.get('agents').orderBy('created_at', 'desc').value()
      );
    },
    upsertAgent({ id, name, bio, avatar }) {
      const existing = db.get('agents').find({ id }).value();
      // Check name uniqueness against other agents
      const nameTaken = db.get('agents').find(a => a.name === name && a.id !== id).value();
      if (nameTaken) {
        return Promise.reject(Object.assign(new Error(`Name "${name}" is already taken. Choose a different name.`), { code: 409 }));
      }
      if (existing) {
        db.get('agents').find({ id }).assign({
          name,
          bio: bio !== undefined ? bio : existing.bio,
          avatar: avatar || existing.avatar,
        }).write();
      } else {
        db.get('agents').push({
          id, name,
          bio: bio || '',
          avatar: avatar || '🤖',
          created_at: now(),
        }).write();
      }
      return Promise.resolve(db.get('agents').find({ id }).value());
    },

    // ── Posts ────────────────────────────────────────────────────────────────
    getPost(id) {
      return Promise.resolve(db.get('posts').find({ id }).value() || null);
    },
    getPosts({ agent_id, limit = 20, offset = 0 } = {}) {
      let q = db.get('posts').orderBy('created_at', 'desc');
      if (agent_id) q = q.filter({ agent_id });
      const total = q.value().length;
      const posts = q.slice(offset, offset + limit).value();
      return Promise.resolve({ posts, total });
    },
    insertPost({ id, agent_id, content, tags }) {
      const post = { id, agent_id, content, tags: JSON.stringify(tags || []), created_at: now() };
      db.get('posts').push(post).write();
      return Promise.resolve(post);
    },

    // ── Replies ──────────────────────────────────────────────────────────────
    getRepliesForPost(post_id) {
      return Promise.resolve(
        db.get('replies').filter({ post_id }).orderBy('created_at', 'asc').value()
      );
    },
    insertReply({ id, post_id, agent_id, content }) {
      const reply = { id, post_id, agent_id, content, created_at: now() };
      db.get('replies').push(reply).write();
      return Promise.resolve(reply);
    },

    // ── Reactions ────────────────────────────────────────────────────────────
    getReactionsForPost(post_id) {
      const reactions = db.get('reactions').filter({ post_id }).value();
      const counts = {};
      for (const r of reactions) counts[r.emoji] = (counts[r.emoji] || 0) + 1;
      return Promise.resolve(Object.entries(counts).map(([emoji, count]) => ({ emoji, count })));
    },
    upsertReaction({ id, post_id, agent_id, emoji }) {
      const existing = db.get('reactions').find({ post_id, agent_id }).value();
      if (existing) {
        db.get('reactions').find({ post_id, agent_id }).assign({ emoji }).write();
      } else {
        db.get('reactions').push({ id, post_id, agent_id, emoji, created_at: now() }).write();
      }
      return Promise.resolve();
    },

    // ── Stats ────────────────────────────────────────────────────────────────
    getStats() {
      const agents = db.get('agents').value().length;
      const posts = db.get('posts').value().length;
      const replies = db.get('replies').value().length;
      const reactions = db.get('reactions').value().length;
      const topAgents = db.get('agents').map(a => ({
        name: a.name,
        avatar: a.avatar,
        post_count: db.get('posts').filter({ agent_id: a.id }).value().length,
      })).orderBy('post_count', 'desc').slice(0, 5).value();
      return Promise.resolve({ agents, posts, replies, reactions, top_agents: topAgents });
    },
  };

  return wrapper;
}

module.exports = { init };
