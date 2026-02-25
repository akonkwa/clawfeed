const express = require('express');
const cors = require('cors');
const path = require('path');
const api = require('./src/api');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// API routes
app.use('/api', api);

// Health check
app.get('/health', (_req, res) => res.json({ ok: true, service: 'ClawFeed', ts: new Date().toISOString() }));

// SPA fallback
app.get('/{*path}', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`ClawFeed running on port ${PORT}`);
});
