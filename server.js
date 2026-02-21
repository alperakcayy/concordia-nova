// server.js
// Statik dosya sunucusu + sosyal API + PostgreSQL bağlantısı
// Cloud Run uyumlu PORT ve Cloud SQL desteği

const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const { Pool } = require('pg');

// --- Cloud Run uyumlu port ---
const PORT = process.env.PORT || 8080;
const PUBLIC_DIR = path.join(__dirname);

// --- PostgreSQL Pool ---
const instanceConn = process.env.INSTANCE_CONNECTION_NAME || '';
const dbHost = process.env.DB_HOST || (instanceConn ? `/cloudsql/${instanceConn}` : '127.0.0.1');
const dbPort = process.env.DB_PORT ? parseInt(process.env.DB_PORT, 10) : 5432;
const dbUser = process.env.DB_USER || 'postgres';
const dbPassword = process.env.DB_PASSWORD || '';
const dbName = process.env.DB_NAME || 'concordia';

const pool = new Pool({
  user: dbUser,
  password: dbPassword,
  host: dbHost,
  port: dbPort,
  database: dbName,
  max: 5,
  idleTimeoutMillis: 10000,
  connectionTimeoutMillis: 5000,
});

// --- Helper: run query ---
async function query(sql, params = []) {
  const client = await pool.connect();
  try {
    const res = await client.query(sql, params);
    return res;
  } finally {
    client.release();
  }
}

// --- Helper: parse int ---
function parseIntSafe(val, defaultVal = null) {
  const num = parseInt(val, 10);
  return isNaN(num) ? defaultVal : num;
}

// --- MIME types ---
const mimeTypes = {
  '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', 
  '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.txt': 'text/plain', '.mp4': 'video/mp4',
  '.webm': 'video/webm', '.ogg': 'video/ogg', '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav', 'default': 'application/octet-stream'
};

function safeJoin(base, target) {
  const targetPath = path.normalize(path.join(base, target));
  return targetPath.startsWith(base) ? targetPath : null;
}

function streamFile(filePath, res) {
  const ext = path.extname(filePath).toLowerCase();
  const contentType = mimeTypes[ext] || mimeTypes.default;
  res.setHeader('Cache-Control', 'public, max-age=60');
  const stream = fs.createReadStream(filePath);
  stream.on('error', () => { res.writeHead(500); res.end('Internal Server Error'); });
  res.writeHead(200, { 'Content-Type': contentType });
  stream.pipe(res);
}

// --- parse JSON body ---
function parseJSONBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => { body += chunk.toString(); if (body.length > 1e6) req.destroy(); });
    req.on('end', () => {
      if (!body) return resolve({});
      try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

// --- API handlers ---
async function handleAPI(req, res, parsedUrl) {
  const pathname = parsedUrl.pathname;

  if (pathname === '/api/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', now: new Date().toISOString() }));
    return;
  }

  // --- GET user by username ---
  if (pathname === '/api/users' && req.method === 'GET') {
    try {
      const username = (parsedUrl.query.username || '').trim();
      if (!username) return res.writeHead(400).end(JSON.stringify({ error: 'username required' }));
      const result = await query('SELECT id, username FROM users WHERE username = $1', [username]);
      if (result.rows.length === 0) return res.writeHead(404).end(JSON.stringify({ error: 'user not found' }));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ user: result.rows[0] }));
    } catch (err) {
      console.error(err);
      res.writeHead(500).end(JSON.stringify({ error: 'database error' }));
    }
    return;
  }

  // --- POST user ---
  if (pathname === '/api/users' && req.method === 'POST') {
    try {
      const body = await parseJSONBody(req);
      const username = (body.username || '').trim();
      if (!username) return res.writeHead(400).end(JSON.stringify({ error: 'username required' }));
      const insert = await query('INSERT INTO users(username) VALUES($1) ON CONFLICT (username) DO NOTHING RETURNING id, username', [username]);
      if (insert.rowCount === 0) {
        const exist = await query('SELECT id, username FROM users WHERE username=$1', [username]);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ user: exist.rows[0], existed: true }));
      } else {
        res.writeHead(201, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ user: insert.rows[0], existed: false }));
      }
    } catch (err) {
      console.error(err);
      res.writeHead(500).end(JSON.stringify({ error: 'database error' }));
    }
    return;
  }

  // --- POST tweet ---
  if (pathname === '/api/tweets' && req.method === 'POST') {
    try {
      const body = await parseJSONBody(req);
      const user_id = parseIntSafe(body.user_id);
      const content = (body.content || '').trim();
      if (!user_id || !content || content.length > 280) return res.writeHead(400).end(JSON.stringify({ error: 'valid user_id and content required' }));
      await query('INSERT INTO tweets(user_id, content, created_at) VALUES($1,$2,NOW())', [user_id, content]);
      res.writeHead(201, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'tweet created' }));
    } catch (err) {
      console.error(err);
      res.writeHead(500).end(JSON.stringify({ error: 'database error' }));
    }
    return;
  }

  // --- GET tweets ---
  if (pathname === '/api/tweets' && req.method === 'GET') {
    try {
      const user_id = parseIntSafe(parsedUrl.query.user_id);
      const sql = user_id
        ? 'SELECT t.id, t.user_id, t.content, t.created_at, u.username FROM tweets t JOIN users u ON u.id=t.user_id WHERE t.user_id=$1 ORDER BY t.created_at DESC LIMIT 50'
        : 'SELECT t.id, t.user_id, t.content, t.created_at, u.username FROM tweets t JOIN users u ON u.id=t.user_id ORDER BY t.created_at DESC LIMIT 50';
      const params = user_id ? [user_id] : [];
      const result = await query(sql, params);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result.rows));
    } catch (err) {
      console.error(err);
      res.writeHead(500).end(JSON.stringify({ error: 'database error' }));
    }
    return;
  }

  // --- Other API endpoints follow same pattern ---
  // /api/follow, /api/unfollow, /api/followers, /api/following, /api/messages

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'api endpoint not found' }));
}

// --- HTTP server ---
const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }

  const parsedUrl = url.parse(req.url || '/', true);
  let pathname = decodeURIComponent(parsedUrl.pathname || '/');

  if (pathname.startsWith('/api/')) { await handleAPI(req, res, parsedUrl); return; }

  if (req.method !== 'GET') { res.writeHead(405); res.end('Method Not Allowed'); return; }
  if (pathname === '/' || pathname === '') pathname = '/index.html';
  if (pathname.endsWith('/')) pathname = path.join(pathname, 'index.html');
  pathname = pathname.replace(/\.\.(\/|\\)/g, '');
  const filePath = safeJoin(PUBLIC_DIR, pathname);
  if (!filePath) { res.writeHead(400); res.end('Bad Request'); return; }

  fs.stat(filePath, (err, stats) => {
    if (err) { res.writeHead(404); res.end('<h1>404 - Not Found</h1>'); return; }
    if (stats.isDirectory()) {
      const indexPath = path.join(filePath, 'index.html');
      fs.stat(indexPath, (ie, ist) => {
        if (ie || !ist.isFile()) { res.writeHead(404); res.end('Not Found'); return; }
        streamFile(indexPath, res);
      });
      return;
    }
    if (stats.isFile()) { streamFile(filePath, res); return; }
    res.writeHead(404); res.end('Not Found');
  });
});

// --- Start server ---
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server listening on ${PORT}. PUBLIC_DIR: ${PUBLIC_DIR}`);
  console.log('DB host:', dbHost, 'DB name:', dbName, 'DB user:', dbUser ? 'set' : 'not-set');
});

// --- Graceful shutdown ---
async function shutdown() {
  console.log('Shutting down...');
  try { await pool.end(); } catch (e) { console.error('Error closing DB pool', e); }
  server.close(() => { console.log('HTTP server closed'); process.exit(0); });
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
