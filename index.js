const express = require('express');
const cors = require('cors');
const path = require('path');
const { init } = require('./src/db');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Health check (mounted before DB init so Railway can reach it immediately)
app.get('/health', (_req, res) => res.json({ ok: true, service: 'ClawFeed', ts: new Date().toISOString() }));

// Init DB then mount API + start server
init().then((db) => {
  const api = require('./src/api')(db);
  app.use('/api', api);

  app.get('/{*path}', (_req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  });

  app.listen(PORT, () => {
    console.log(`ClawFeed running on port ${PORT}`);
  });
}).catch(err => {
  console.error('Failed to init DB:', err);
  process.exit(1);
});
