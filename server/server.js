const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const { store, MOVE_VALUES } = require('./store');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (req.method === 'OPTIONS') {
      return handleOptions(req, res);
    }

    if (url.pathname.startsWith('/api/')) {
      await handleApi(req, res, url);
      return;
    }

    await serveStatic(req, res, url);
  } catch (error) {
    console.error('Server error', error);
    sendJson(res, 500, { error: 'Internal server error.' });
  }
});

function handleOptions(req, res) {
  const headers = {
    'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
  if (req.headers.origin) {
    headers['Access-Control-Allow-Origin'] = req.headers.origin;
    headers['Access-Control-Allow-Credentials'] = 'true';
    headers.Vary = 'Origin';
  } else {
    headers['Access-Control-Allow-Origin'] = '*';
  }
  res.writeHead(204, headers);
  res.end();
}

async function handleApi(req, res, url) {
  const token = parseCookies(req).session || null;
  try {
    if (req.method === 'POST' && url.pathname === '/api/auth/login') {
      const body = await parseBody(req);
      const { username } = body;
      const { token: sessionToken, user } = store.createSession(username);
      sendJson(
        req,
        res,
        200,
        { user },
        {
          'Set-Cookie': cookieHeader('session', sessionToken, {
            httpOnly: true,
            maxAge: 60 * 60 * 24 * 30,
          }),
        }
      );
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/auth/logout') {
      if (token) {
        store.endSession(token);
      }
      sendJson(
        req,
        res,
        200,
        { success: true },
        {
          'Set-Cookie': cookieHeader('session', '', {
            httpOnly: true,
            maxAge: 0,
          }),
        }
      );
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/auth/session') {
      const user = store.getUserBySession(token);
      sendJson(req, res, 200, { user });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/lobbies') {
      const lobbies = store.listLobbies();
      sendJson(req, res, 200, { lobbies });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/lobbies') {
      const body = await parseBody(req);
      const lobby = store.createLobby(token, body || {});
      sendJson(req, res, 201, { lobby });
      return;
    }

    if (req.method === 'DELETE' && url.pathname.startsWith('/api/lobbies/')) {
      const lobbyId = url.pathname.split('/')[3];
      const result = store.cancelLobby(token, lobbyId);
      sendJson(req, res, 200, result);
      return;
    }

    if (req.method === 'POST' && url.pathname.startsWith('/api/lobbies/') && url.pathname.endsWith('/join')) {
      const parts = url.pathname.split('/');
      const lobbyId = parts[3];
      const game = store.joinLobby(token, lobbyId);
      sendJson(req, res, 200, { game });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/games') {
      const user = store.requireUser(token);
      const games = store.listUserGames(user.id);
      sendJson(req, res, 200, { games });
      return;
    }

    if (req.method === 'GET' && url.pathname.startsWith('/api/games/')) {
      const gameId = url.pathname.split('/')[3];
      const game = store.getGame(gameId);
      if (!game) {
        sendJson(req, res, 404, { error: 'Game not found.' });
        return;
      }
      sendJson(req, res, 200, { game });
      return;
    }

    if (req.method === 'POST' && url.pathname.startsWith('/api/games/') && url.pathname.endsWith('/move')) {
      const parts = url.pathname.split('/');
      const gameId = parts[3];
      const body = await parseBody(req);
      const { move } = body || {};
      const game = store.submitMove(token, gameId, move);
      sendJson(req, res, 200, { game });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/ai/start') {
      const body = await parseBody(req);
      const game = store.startAiGame(token, body || {});
      sendJson(req, res, 201, { game });
      return;
    }

    if (req.method === 'GET' && url.pathname.startsWith('/api/profile/')) {
      const username = decodeURIComponent(url.pathname.split('/')[3] || '');
      const profile = store.getProfile(username);
      if (!profile) {
        sendJson(req, res, 404, { error: 'Profile not found.' });
        return;
      }
      sendJson(req, res, 200, profile);
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/constants') {
      sendJson(req, res, 200, { moves: MOVE_VALUES });
      return;
    }

    sendJson(req, res, 404, { error: 'Not found.' });
  } catch (error) {
    console.error('API error', error);
    sendJson(req, res, 400, { error: error.message || 'Request failed.' });
  }
}

async function serveStatic(req, res, url) {
  let filePath = path.join(PUBLIC_DIR, url.pathname === '/' ? '/index.html' : url.pathname);
  if (filePath.endsWith('/')) {
    filePath = path.join(filePath, 'index.html');
  }
  try {
    const stat = await fs.promises.stat(filePath);
    if (stat.isDirectory()) {
      filePath = path.join(filePath, 'index.html');
    }
    const stream = fs.createReadStream(filePath);
    res.writeHead(200, { 'Content-Type': contentType(filePath) });
    stream.pipe(res);
  } catch (error) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  }
}

function sendJson(req, res, statusCode, payload, extraHeaders = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...extraHeaders,
  };
  if (req.headers.origin) {
    headers['Access-Control-Allow-Origin'] = req.headers.origin;
    headers['Access-Control-Allow-Credentials'] = 'true';
    headers.Vary = 'Origin';
  } else {
    headers['Access-Control-Allow-Origin'] = '*';
  }
  res.writeHead(statusCode, headers);
  res.end(JSON.stringify(payload));
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 1e6) {
        reject(new Error('Payload too large.'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!data) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(data));
      } catch (error) {
        reject(new Error('Invalid JSON payload.'));
      }
    });
  });
}

function parseCookies(req) {
  const header = req.headers.cookie || '';
  const result = {};
  header.split(';').forEach((pair) => {
    const [key, value] = pair.split('=').map((part) => part && part.trim());
    if (key && value) {
      result[key] = decodeURIComponent(value);
    }
  });
  return result;
}

function cookieHeader(name, value, { httpOnly = false, maxAge = null } = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  if (httpOnly) parts.push('HttpOnly');
  parts.push('Path=/');
  parts.push('SameSite=Lax');
  if (maxAge !== null) {
    parts.push(`Max-Age=${maxAge}`);
  }
  return parts.join('; ');
}

function contentType(filePath) {
  const ext = path.extname(filePath);
  switch (ext) {
    case '.html':
      return 'text/html; charset=utf-8';
    case '.css':
      return 'text/css; charset=utf-8';
    case '.js':
      return 'application/javascript; charset=utf-8';
    case '.json':
      return 'application/json; charset=utf-8';
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.svg':
      return 'image/svg+xml';
    default:
      return 'application/octet-stream';
  }
}

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
  });
}

module.exports = { server };
