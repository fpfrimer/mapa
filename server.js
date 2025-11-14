const http = require('http');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const fsp = fs.promises;

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = __dirname;
const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'configurations.json');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const JWT_SECRET = process.env.JWT_SECRET || 'planner-local-secret';
const AUTH_TOKEN_TTL_MS = Number(process.env.AUTH_TOKEN_TTL_MS) || 60 * 60 * 1000;
const MAX_BODY_SIZE = 5 * 1024 * 1024; // 5MB

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2'
};

function generateConfigId() {
  const random = Math.random().toString(36).slice(2, 8);
  return `config-${Date.now().toString(36)}-${random}`;
}

function normalizeName(value) {
  return typeof value === 'string' ? value.trim() : '';
}

async function ensureDataFile() {
  await fsp.mkdir(DATA_DIR, { recursive: true });
  try {
    await fsp.access(DATA_FILE, fs.constants.F_OK);
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      await fsp.writeFile(DATA_FILE, '[]\n', 'utf-8');
    } else {
      throw error;
    }
  }
}

async function ensureUsersFile() {
  await fsp.mkdir(DATA_DIR, { recursive: true });
  try {
    await fsp.access(USERS_FILE, fs.constants.F_OK);
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      await fsp.writeFile(USERS_FILE, '[]\n', 'utf-8');
    } else {
      throw error;
    }
  }
}

function sanitizeUserRecord(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const id = typeof entry.id === 'string' ? entry.id : null;
  const username = typeof entry.username === 'string' ? entry.username.trim() : '';
  const passwordHash = typeof entry.passwordHash === 'string' ? entry.passwordHash : '';
  if (!id || !username || !passwordHash) {
    return null;
  }
  return { id, username, passwordHash };
}

async function readUsers() {
  await ensureUsersFile();
  try {
    const raw = await fsp.readFile(USERS_FILE, 'utf-8');
    if (!raw.trim()) {
      return [];
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.map(sanitizeUserRecord).filter(Boolean);
  } catch (error) {
    console.error('Erro ao analisar arquivo de usuários.', error);
    return [];
  }
}

function verifyPasswordHash(password, storedHash) {
  if (typeof password !== 'string' || typeof storedHash !== 'string') {
    return false;
  }
  const parts = storedHash.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') {
    return false;
  }
  const [, nStr, rStr, pStr, saltHex, keyHex] = parts;
  const salt = Buffer.from(saltHex, 'hex');
  const storedKey = Buffer.from(keyHex, 'hex');
  if (!salt.length || !storedKey.length) {
    return false;
  }
  const params = {
    N: Number(nStr) || 16384,
    r: Number(rStr) || 8,
    p: Number(pStr) || 1
  };
  try {
    const derived = crypto.scryptSync(password, salt, storedKey.length, params);
    if (derived.length !== storedKey.length) {
      return false;
    }
    return crypto.timingSafeEqual(derived, storedKey);
  } catch (error) {
    console.error('Falha ao verificar hash de senha.', error);
    return false;
  }
}

async function authenticateUser(username, password) {
  const users = await readUsers();
  const candidate = users.find((user) => user.username === username);
  if (!candidate) {
    return null;
  }
  const isValid = verifyPasswordHash(password, candidate.passwordHash);
  if (!isValid) {
    return null;
  }
  return { id: candidate.id, username: candidate.username };
}

function base64UrlEncode(buffer) {
  return Buffer.from(buffer)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function base64UrlDecode(input) {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
  const padding = '='.repeat((4 - (normalized.length % 4 || 4)) % 4);
  return Buffer.from(`${normalized}${padding}`, 'base64');
}

function createAuthToken(user) {
  const issuedAtMs = Date.now();
  const expiresAtMs = issuedAtMs + AUTH_TOKEN_TTL_MS;
  const header = { alg: 'HS256', typ: 'JWT' };
  const payload = {
    sub: user.id,
    username: user.username,
    iat: Math.floor(issuedAtMs / 1000),
    exp: Math.floor(expiresAtMs / 1000)
  };
  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signature = crypto.createHmac('sha256', JWT_SECRET).update(signingInput).digest();
  const encodedSignature = base64UrlEncode(signature);
  return { token: `${signingInput}.${encodedSignature}`, expiresAt: expiresAtMs };
}

function verifyAuthToken(token) {
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new Error('TOKEN_INVALID');
  }
  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const expectedSignature = crypto.createHmac('sha256', JWT_SECRET).update(signingInput).digest();
  const providedSignature = base64UrlDecode(encodedSignature);
  if (expectedSignature.length !== providedSignature.length) {
    throw new Error('TOKEN_INVALID');
  }
  if (!crypto.timingSafeEqual(expectedSignature, providedSignature)) {
    throw new Error('TOKEN_INVALID');
  }
  const payloadRaw = base64UrlDecode(encodedPayload).toString('utf-8');
  const payload = JSON.parse(payloadRaw);
  if (typeof payload.exp === 'number') {
    const expiresAtMs = payload.exp * 1000;
    if (expiresAtMs <= Date.now()) {
      throw new Error('TOKEN_EXPIRED');
    }
  }
  return payload;
}

function extractBearerToken(req) {
  const header = req.headers['authorization'];
  if (!header || typeof header !== 'string') {
    return '';
  }
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : '';
}

async function requireAuthentication(req, res) {
  const token = extractBearerToken(req);
  if (!token) {
    sendJson(res, 401, { message: 'Credenciais não enviadas.' });
    return null;
  }
  try {
    const payload = verifyAuthToken(token);
    return payload;
  } catch (error) {
    const status = error.message === 'TOKEN_EXPIRED' ? 401 : 403;
    sendJson(res, status, { message: 'Token inválido ou expirado.' });
    return null;
  }
}

async function readConfigurations() {
  await ensureDataFile();
  const raw = await fsp.readFile(DATA_FILE, 'utf-8');
  if (!raw.trim()) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .map((entry) => {
        if (!entry || typeof entry !== 'object') return null;
        const id = typeof entry.id === 'string' ? entry.id : generateConfigId();
        const name = normalizeName(entry.name);
        if (!name) return null;
        const savedAt = typeof entry.savedAt === 'string' ? entry.savedAt : new Date().toISOString();
        const state = entry.state && typeof entry.state === 'object' ? entry.state : null;
        if (!state) return null;
        const counters = entry.counters && typeof entry.counters === 'object' ? entry.counters : null;
        return { id, name, savedAt, state, counters };
      })
      .filter(Boolean);
  } catch (error) {
    console.error('Erro ao analisar arquivo de configurações.', error);
    return [];
  }
}

async function writeConfigurations(configs) {
  await ensureDataFile();
  const payload = JSON.stringify(configs, null, 2);
  await fsp.writeFile(DATA_FILE, `${payload}\n`, 'utf-8');
}

function sanitizeConfigurationInput(payload) {
  if (!payload || typeof payload !== 'object') {
    return null;
  }
  const name = normalizeName(payload.name);
  if (!name) {
    return null;
  }
  const state = payload.state && typeof payload.state === 'object' ? payload.state : null;
  if (!state) {
    return null;
  }
  const counters = payload.counters && typeof payload.counters === 'object' ? payload.counters : null;
  return { name, state, counters };
}

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body)
  });
  res.end(body);
}

function sendEmpty(res, status) {
  res.writeHead(status);
  res.end();
}

function sendText(res, status, text) {
  res.writeHead(status, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Length': Buffer.byteLength(text)
  });
  res.end(text);
}

async function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > MAX_BODY_SIZE) {
        reject(new Error('PAYLOAD_TOO_LARGE'));
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
        reject(new Error('INVALID_JSON'));
      }
    });
    req.on('error', (error) => {
      reject(error);
    });
  });
}

function extractConfigId(pathname) {
  const parts = pathname.split('/').filter(Boolean);
  if (parts.length === 3) {
    return decodeURIComponent(parts[2]);
  }
  return '';
}

async function handleAuthRoutes(req, res, url) {
  if (url.pathname === '/api/login') {
    if (req.method !== 'POST') {
      sendJson(res, 405, { message: 'Método não suportado.' });
      return true;
    }
    try {
      const payload = await parseJsonBody(req);
      const username = typeof payload.username === 'string' ? payload.username.trim() : '';
      const password = typeof payload.password === 'string' ? payload.password : '';
      if (!username || !password) {
        sendJson(res, 400, { message: 'Usuário e senha são obrigatórios.' });
        return true;
      }
      const user = await authenticateUser(username, password);
      if (!user) {
        sendJson(res, 401, { message: 'Usuário ou senha inválidos.' });
        return true;
      }
      const tokenInfo = createAuthToken(user);
      sendJson(res, 200, {
        token: tokenInfo.token,
        expiresAt: new Date(tokenInfo.expiresAt).toISOString(),
        user: { id: user.id, username: user.username }
      });
      return true;
    } catch (error) {
      if (error.message === 'INVALID_JSON') {
        sendJson(res, 400, { message: 'JSON inválido.' });
        return true;
      }
      if (error.message === 'PAYLOAD_TOO_LARGE') {
        sendJson(res, 413, { message: 'Payload excede o limite permitido.' });
        return true;
      }
      console.error('Erro ao processar login.', error);
      sendJson(res, 500, { message: 'Não foi possível realizar o login.' });
      return true;
    }
  }

  if (url.pathname === '/api/logout') {
    if (req.method !== 'POST') {
      sendJson(res, 405, { message: 'Método não suportado.' });
      return true;
    }
    sendEmpty(res, 204);
    return true;
  }

  return false;
}

async function handleConfigurationsApi(req, res, url) {
  const { pathname } = url;
  const requiresAuth = req.method !== 'GET';
  if (requiresAuth) {
    const authorized = await requireAuthentication(req, res);
    if (!authorized) {
      return;
    }
  }
  if (req.method === 'GET' && pathname === '/api/configurations') {
    try {
      const configs = await readConfigurations();
      sendJson(res, 200, { items: configs });
    } catch (error) {
      console.error('Erro ao listar configurações.', error);
      sendJson(res, 500, { message: 'Não foi possível listar as configurações salvas.' });
    }
    return;
  }

  if (req.method === 'POST' && pathname === '/api/configurations') {
    try {
      const payload = await parseJsonBody(req);
      const input = sanitizeConfigurationInput(payload);
      if (!input) {
        sendJson(res, 400, { message: 'Dados de configuração inválidos.' });
        return;
      }
      const configs = await readConfigurations();
      const id = generateConfigId();
      const savedAt = new Date().toISOString();
      const entry = { id, name: input.name, savedAt, state: input.state, counters: input.counters };
      configs.push(entry);
      await writeConfigurations(configs);
      sendJson(res, 201, entry);
    } catch (error) {
      if (error.message === 'INVALID_JSON') {
        sendJson(res, 400, { message: 'JSON inválido.' });
        return;
      }
      if (error.message === 'PAYLOAD_TOO_LARGE') {
        sendJson(res, 413, { message: 'Payload excede o limite permitido.' });
        return;
      }
      console.error('Erro ao salvar configuração.', error);
      sendJson(res, 500, { message: 'Não foi possível salvar a configuração.' });
    }
    return;
  }

  if (req.method === 'PUT' && pathname.startsWith('/api/configurations/')) {
    const id = extractConfigId(pathname);
    if (!id) {
      sendJson(res, 400, { message: 'Identificador inválido.' });
      return;
    }
    try {
      const payload = await parseJsonBody(req);
      const input = sanitizeConfigurationInput(payload);
      if (!input) {
        sendJson(res, 400, { message: 'Dados de configuração inválidos.' });
        return;
      }
      const configs = await readConfigurations();
      const index = configs.findIndex((item) => item.id === id);
      if (index === -1) {
        sendJson(res, 404, { message: 'Configuração não encontrada.' });
        return;
      }
      const savedAt = new Date().toISOString();
      const updated = { id, name: input.name, savedAt, state: input.state, counters: input.counters };
      configs[index] = updated;
      await writeConfigurations(configs);
      sendJson(res, 200, updated);
    } catch (error) {
      if (error.message === 'INVALID_JSON') {
        sendJson(res, 400, { message: 'JSON inválido.' });
        return;
      }
      if (error.message === 'PAYLOAD_TOO_LARGE') {
        sendJson(res, 413, { message: 'Payload excede o limite permitido.' });
        return;
      }
      console.error('Erro ao atualizar configuração.', error);
      sendJson(res, 500, { message: 'Não foi possível atualizar a configuração.' });
    }
    return;
  }

  if (req.method === 'DELETE' && pathname.startsWith('/api/configurations/')) {
    const id = extractConfigId(pathname);
    if (!id) {
      sendJson(res, 400, { message: 'Identificador inválido.' });
      return;
    }
    try {
      const configs = await readConfigurations();
      const filtered = configs.filter((item) => item.id !== id);
      if (filtered.length === configs.length) {
        sendJson(res, 404, { message: 'Configuração não encontrada.' });
        return;
      }
      await writeConfigurations(filtered);
      sendEmpty(res, 204);
    } catch (error) {
      console.error('Erro ao remover configuração.', error);
      sendJson(res, 500, { message: 'Não foi possível remover a configuração.' });
    }
    return;
  }

  sendJson(res, 405, { message: 'Método não suportado.' });
}

async function serveStatic(req, res, pathname) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    sendJson(res, 405, { message: 'Método não suportado.' });
    return;
  }

  const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/g, '');
  const safePath = path.normalize(path.join(PUBLIC_DIR, relative));
  const isInsidePublic =
    safePath === PUBLIC_DIR || safePath.startsWith(`${PUBLIC_DIR}${path.sep}`);
  if (!isInsidePublic) {
    sendJson(res, 403, { message: 'Acesso negado.' });
    return;
  }

  try {
    let targetPath = safePath;
    const stats = await fsp.stat(targetPath);
    if (stats.isDirectory()) {
      targetPath = path.join(targetPath, 'index.html');
    }
    const ext = path.extname(targetPath).toLowerCase();
    const mime = MIME_TYPES[ext] || 'application/octet-stream';
    if (req.method === 'HEAD') {
      res.writeHead(200, { 'Content-Type': mime });
      res.end();
      return;
    }
    const data = await fsp.readFile(targetPath);
    res.writeHead(200, { 'Content-Type': mime });
    res.end(data);
  } catch (error) {
    if (req.method === 'GET') {
      try {
        const indexPath = path.join(PUBLIC_DIR, 'index.html');
        const data = await fsp.readFile(indexPath);
        res.writeHead(200, { 'Content-Type': MIME_TYPES['.html'] });
        res.end(data);
      } catch (fallbackError) {
        console.error('Erro ao servir arquivo estático.', fallbackError);
        sendJson(res, 404, { message: 'Arquivo não encontrado.' });
      }
    } else {
      sendJson(res, 404, { message: 'Arquivo não encontrado.' });
    }
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    if (await handleAuthRoutes(req, res, url)) {
      return;
    }
    if (url.pathname.startsWith('/api/configurations')) {
      await handleConfigurationsApi(req, res, url);
    } else {
      await serveStatic(req, res, url.pathname);
    }
  } catch (error) {
    console.error('Erro inesperado no servidor.', error);
    if (!res.headersSent) {
      sendJson(res, 500, { message: 'Erro interno do servidor.' });
    } else {
      res.end();
    }
  }
});

server.on('clientError', (err, socket) => {
  if (socket.writable) {
    socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
  }
});

Promise.all([ensureDataFile(), ensureUsersFile()])
  .then(() => {
    server.listen(PORT, () => {
      console.log(`Servidor iniciado na porta ${PORT}`);
    });
  })
  .catch((error) => {
    console.error('Não foi possível iniciar o servidor.', error);
    process.exit(1);
  });
