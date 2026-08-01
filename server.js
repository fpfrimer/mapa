const http = require('http');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const fsp = fs.promises;
const ROOT_DIR = __dirname;
const DEFAULT_PORT = 3000;
const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_TOKEN_TTL_MS = 60 * 60 * 1000;
const MAX_BODY_SIZE = 5 * 1024 * 1024;
const MAX_NAME_LENGTH = 120;
const MAX_ID_LENGTH = 128;
const MAX_JSON_DEPTH = 12;
const MAX_JSON_NODES = 50_000;
const CONFIGURATION_SCHEMA_VERSION = 2;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_FAILURES = 5;

const PUBLIC_FILES = new Map([
  ['/', 'index.html'],
  ['/index.html', 'index.html'],
  ['/styles.css', 'styles.css'],
  ['/script.js', 'script.js'],
  ['/assets/brand/utfpr-logo.png', 'assets/brand/utfpr-logo.png'],
  ['/assets/icons/lucide-icons.svg', 'assets/icons/lucide-icons.svg']
]);

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.png': 'image/png'
};

function resolveJwtSecret(env = process.env) {
  const configured = typeof env.JWT_SECRET === 'string' ? env.JWT_SECRET : '';
  if (configured.length >= 32) return configured;
  if (env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET deve conter pelo menos 32 caracteres em produção.');
  }
  if (configured) {
    console.warn('JWT_SECRET curto ignorado; usando segredo temporário de desenvolvimento.');
  } else {
    console.warn('JWT_SECRET não definido; sessões serão invalidadas ao reiniciar o servidor.');
  }
  return crypto.randomBytes(32).toString('hex');
}

function parsePositiveNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeName(value) {
  if (typeof value !== 'string') return '';
  const normalized = value.trim();
  return normalized.length <= MAX_NAME_LENGTH ? normalized : '';
}

function isSafeId(value) {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_ID_LENGTH &&
    /^[A-Za-z0-9._:-]+$/.test(value)
  );
}

function validateJsonTree(root) {
  const stack = [{ value: root, depth: 0 }];
  let nodes = 0;
  while (stack.length) {
    const { value, depth } = stack.pop();
    nodes += 1;
    if (nodes > MAX_JSON_NODES || depth > MAX_JSON_DEPTH) return false;
    if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) continue;
    if (typeof value !== 'object') return false;
    if (!Array.isArray(value)) {
      const prototype = Object.getPrototypeOf(value);
      if (prototype !== Object.prototype && prototype !== null) return false;
    }
    for (const [key, child] of Object.entries(value)) {
      if (key === '__proto__' || key === 'prototype' || key === 'constructor') return false;
      stack.push({ value: child, depth: depth + 1 });
    }
  }
  return true;
}

function generateConfigId() {
  return `config-${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`;
}

function base64UrlEncode(value) {
  return Buffer.from(value).toString('base64url');
}

function base64UrlDecode(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error('TOKEN_INVALID');
  }
  const decoded = Buffer.from(value, 'base64url');
  if (decoded.toString('base64url') !== value) throw new Error('TOKEN_INVALID');
  return decoded;
}

function createTokenService(secret, ttlMs = DEFAULT_TOKEN_TTL_MS) {
  function create(user) {
    const now = Date.now();
    const header = base64UrlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
    const payload = base64UrlEncode(
      JSON.stringify({
        sub: user.id,
        username: user.username,
        iat: Math.floor(now / 1000),
        exp: Math.floor((now + ttlMs) / 1000)
      })
    );
    const input = `${header}.${payload}`;
    const signature = crypto.createHmac('sha256', secret).update(input).digest('base64url');
    return { token: `${input}.${signature}`, expiresAt: now + ttlMs };
  }

  function verify(token) {
    if (typeof token !== 'string') throw new Error('TOKEN_INVALID');
    const parts = token.split('.');
    if (parts.length !== 3) throw new Error('TOKEN_INVALID');
    const [encodedHeader, encodedPayload, signature] = parts;
    const header = JSON.parse(base64UrlDecode(encodedHeader).toString('utf8'));
    if (header.alg !== 'HS256' || header.typ !== 'JWT') throw new Error('TOKEN_INVALID');
    const expected = crypto
      .createHmac('sha256', secret)
      .update(`${encodedHeader}.${encodedPayload}`)
      .digest();
    const provided = base64UrlDecode(signature);
    if (expected.length !== provided.length || !crypto.timingSafeEqual(expected, provided)) {
      throw new Error('TOKEN_INVALID');
    }
    const payload = JSON.parse(base64UrlDecode(encodedPayload).toString('utf8'));
    if (
      !isSafeId(payload.sub) ||
      !normalizeName(payload.username) ||
      !Number.isInteger(payload.iat) ||
      !Number.isInteger(payload.exp) ||
      payload.exp <= Math.floor(Date.now() / 1000) ||
      payload.iat > Math.floor(Date.now() / 1000) + 60
    ) {
      throw new Error(payload.exp <= Math.floor(Date.now() / 1000) ? 'TOKEN_EXPIRED' : 'TOKEN_INVALID');
    }
    return payload;
  }

  return { create, verify };
}

function createStorage(dataDir) {
  const configurationsFile = path.join(dataDir, 'configurations.json');
  const usersFile = path.join(dataDir, 'users.json');
  let mutationQueue = Promise.resolve();

  async function ensureFile(file) {
    await fsp.mkdir(dataDir, { recursive: true });
    try {
      await fsp.access(file, fs.constants.F_OK);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      await fsp.writeFile(file, '[]\n', { encoding: 'utf8', mode: 0o640, flag: 'wx' }).catch((writeError) => {
        if (writeError.code !== 'EEXIST') throw writeError;
      });
    }
  }

  async function readArray(file) {
    await ensureFile(file);
    const raw = await fsp.readFile(file, 'utf8');
    const parsed = raw.trim() ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) throw new Error('DATA_INVALID');
    return parsed;
  }

  async function writeArrayAtomic(file, value) {
    await ensureFile(file);
    const temporary = path.join(
      dataDir,
      `.${path.basename(file)}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`
    );
    try {
      await fsp.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
        encoding: 'utf8',
        mode: 0o640,
        flag: 'wx'
      });
      await fsp.rename(temporary, file);
    } finally {
      await fsp.unlink(temporary).catch((error) => {
        if (error.code !== 'ENOENT') throw error;
      });
    }
  }

  function sanitizeStoredConfiguration(entry) {
    if (!entry || typeof entry !== 'object') return null;
    const id = isSafeId(entry.id) ? entry.id : generateConfigId();
    const name = normalizeName(entry.name);
    const legacySavedAt = typeof entry.savedAt === 'string' && !Number.isNaN(Date.parse(entry.savedAt))
      ? entry.savedAt
      : new Date().toISOString();
    const createdAt = typeof entry.createdAt === 'string' && !Number.isNaN(Date.parse(entry.createdAt))
      ? entry.createdAt
      : legacySavedAt;
    const updatedAt = typeof entry.updatedAt === 'string' && !Number.isNaN(Date.parse(entry.updatedAt))
      ? entry.updatedAt
      : legacySavedAt;
    const schemaVersion = Number.isInteger(entry.schemaVersion) && entry.schemaVersion > 0
      ? entry.schemaVersion
      : 1;
    const revision = Number.isInteger(entry.revision) && entry.revision > 0 ? entry.revision : 1;
    const createdBy = normalizeName(entry.createdBy) || 'legado';
    const updatedBy = normalizeName(entry.updatedBy) || createdBy;
    const state = entry.state && typeof entry.state === 'object' && validateJsonTree(entry.state)
      ? entry.state
      : null;
    const counters = entry.counters && typeof entry.counters === 'object' && validateJsonTree(entry.counters)
      ? entry.counters
      : null;
    return name && state
      ? {
          id,
          name,
          schemaVersion,
          revision,
          createdAt,
          updatedAt,
          savedAt: updatedAt,
          createdBy,
          updatedBy,
          state,
          counters
        }
      : null;
  }

  async function readConfigurations() {
    return (await readArray(configurationsFile)).map(sanitizeStoredConfiguration).filter(Boolean);
  }

  function mutateConfigurations(operation) {
    const result = mutationQueue.then(async () => {
      const configurations = await readConfigurations();
      const outcome = await operation(configurations);
      if (outcome.write) await writeArrayAtomic(configurationsFile, outcome.configurations);
      return outcome.result;
    });
    mutationQueue = result.catch(() => undefined);
    return result;
  }

  async function readUsers() {
    const users = await readArray(usersFile);
    return users
      .map((entry) => {
        if (!entry || !isSafeId(entry.id)) return null;
        const username = normalizeName(entry.username);
        const passwordHash = typeof entry.passwordHash === 'string' ? entry.passwordHash : '';
        return username && passwordHash ? { id: entry.id, username, passwordHash } : null;
      })
      .filter(Boolean);
  }

  return {
    ensure: () => Promise.all([ensureFile(configurationsFile), ensureFile(usersFile)]),
    readConfigurations,
    readUsers,
    mutateConfigurations
  };
}

function verifyPasswordHash(password, storedHash) {
  if (typeof password !== 'string' || typeof storedHash !== 'string') return false;
  const parts = storedHash.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, nText, rText, pText, saltHex, keyHex] = parts;
  if (!/^[a-f0-9]+$/i.test(saltHex) || !/^[a-f0-9]+$/i.test(keyHex)) return false;
  const salt = Buffer.from(saltHex, 'hex');
  const storedKey = Buffer.from(keyHex, 'hex');
  const N = Number(nText);
  const r = Number(rText);
  const p = Number(pText);
  if (!salt.length || !storedKey.length || !Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) {
    return false;
  }
  try {
    const derived = crypto.scryptSync(password, salt, storedKey.length, { N, r, p });
    return derived.length === storedKey.length && crypto.timingSafeEqual(derived, storedKey);
  } catch (error) {
    return false;
  }
}

function securityHeaders(contentType = '') {
  const headers = {
    'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'",
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Resource-Policy': 'same-origin'
  };
  if (contentType) headers['Content-Type'] = contentType;
  return headers;
}

function sendJson(res, status, data, extraHeaders = {}) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    ...securityHeaders('application/json; charset=utf-8'),
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body),
    ...extraHeaders
  });
  res.end(body);
}

function sendEmpty(res, status) {
  res.writeHead(status, { ...securityHeaders(), 'Cache-Control': 'no-store' });
  res.end();
}

async function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    let rejected = false;
    req.on('data', (chunk) => {
      if (rejected) return;
      size += chunk.length;
      if (size > MAX_BODY_SIZE) {
        rejected = true;
        reject(new Error('PAYLOAD_TOO_LARGE'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (rejected) return;
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve(raw ? JSON.parse(raw) : {});
      } catch (error) {
        reject(new Error('INVALID_JSON'));
      }
    });
    req.on('error', reject);
  });
}

function sanitizeConfigurationInput(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const allowed = new Set(['name', 'state', 'counters']);
  if (Object.keys(payload).some((key) => !allowed.has(key))) return null;
  const name = normalizeName(payload.name);
  const state = payload.state && typeof payload.state === 'object' && !Array.isArray(payload.state)
    ? payload.state
    : null;
  const counters = payload.counters === null || payload.counters === undefined
    ? null
    : payload.counters;
  if (
    !name ||
    !state ||
    !validateJsonTree(state) ||
    (counters !== null && (typeof counters !== 'object' || Array.isArray(counters) || !validateJsonTree(counters)))
  ) {
    return null;
  }
  return { name, state, counters };
}

function extractBearerToken(req) {
  const value = req.headers.authorization;
  const match = typeof value === 'string' ? value.match(/^Bearer ([A-Za-z0-9_.-]+)$/) : null;
  return match ? match[1] : '';
}

function parseRevisionHeader(req) {
  const value = req.headers['if-match'];
  if (typeof value !== 'string') return null;
  const match = value.trim().match(/^"([1-9]\d*)"$/);
  return match ? Number(match[1]) : null;
}

function conflictMetadata(entry) {
  return {
    id: entry.id,
    revision: entry.revision,
    updatedAt: entry.updatedAt,
    savedAt: entry.savedAt,
    updatedBy: entry.updatedBy
  };
}

function requestAddress(req) {
  return req.socket?.remoteAddress || 'unknown';
}

function createApp(options = {}) {
  const env = options.env || process.env;
  const rootDir = options.rootDir || ROOT_DIR;
  const dataDir = options.dataDir || env.MAPA_DATA_DIR || path.join(rootDir, 'data');
  const storage = options.storage || createStorage(dataDir);
  const tokenService = options.tokenService || createTokenService(
    options.jwtSecret || resolveJwtSecret(env),
    parsePositiveNumber(env.AUTH_TOKEN_TTL_MS, DEFAULT_TOKEN_TTL_MS)
  );
  const loginAttempts = new Map();

  function requireAuthentication(req, res) {
    const token = extractBearerToken(req);
    if (!token) {
      sendJson(res, 401, { message: 'Autenticação necessária.' });
      return null;
    }
    try {
      return tokenService.verify(token);
    } catch (error) {
      sendJson(res, 401, { message: 'Token inválido ou expirado.' });
      return null;
    }
  }

  function rateLimitStatus(req) {
    const key = requestAddress(req);
    const now = Date.now();
    const current = loginAttempts.get(key);
    if (!current || current.resetAt <= now) {
      loginAttempts.delete(key);
      return { key, blocked: false, retryAfter: 0 };
    }
    return {
      key,
      blocked: current.failures >= LOGIN_MAX_FAILURES,
      retryAfter: Math.max(Math.ceil((current.resetAt - now) / 1000), 1)
    };
  }

  function recordLoginFailure(key) {
    const now = Date.now();
    const current = loginAttempts.get(key);
    if (!current || current.resetAt <= now) {
      loginAttempts.set(key, { failures: 1, resetAt: now + LOGIN_WINDOW_MS });
    } else {
      current.failures += 1;
    }
  }

  async function authenticate(username, password) {
    const users = await storage.readUsers();
    const candidate = users.find((user) => user.username === username);
    if (!candidate || !verifyPasswordHash(password, candidate.passwordHash)) return null;
    return { id: candidate.id, username: candidate.username };
  }

  async function handleLogin(req, res) {
    if (req.method !== 'POST') {
      sendJson(res, 405, { message: 'Método não suportado.' }, { Allow: 'POST' });
      return;
    }
    const limit = rateLimitStatus(req);
    if (limit.blocked) {
      sendJson(res, 429, { message: 'Muitas tentativas. Tente novamente mais tarde.' }, {
        'Retry-After': String(limit.retryAfter)
      });
      return;
    }
    const payload = await parseJsonBody(req);
    const username = normalizeName(payload.username);
    const password = typeof payload.password === 'string' && payload.password.length <= 1024
      ? payload.password
      : '';
    if (!username || !password) {
      sendJson(res, 400, { message: 'Usuário e senha são obrigatórios.' });
      return;
    }
    const user = await authenticate(username, password);
    if (!user) {
      recordLoginFailure(limit.key);
      sendJson(res, 401, { message: 'Usuário ou senha inválidos.' });
      return;
    }
    loginAttempts.delete(limit.key);
    const token = tokenService.create(user);
    sendJson(res, 200, {
      token: token.token,
      expiresAt: new Date(token.expiresAt).toISOString(),
      user
    });
  }

  async function handleConfigurations(req, res, url) {
    const actor = requireAuthentication(req, res);
    if (!actor) return;
    const parts = url.pathname.split('/').filter(Boolean);
    const id = parts.length === 3 ? decodeURIComponent(parts[2]) : '';

    if (req.method === 'GET' && parts.length === 2) {
      sendJson(res, 200, { items: await storage.readConfigurations() });
      return;
    }

    if (req.method === 'POST' && parts.length === 2) {
      const input = sanitizeConfigurationInput(await parseJsonBody(req));
      if (!input) {
        sendJson(res, 400, { message: 'Dados de configuração inválidos.' });
        return;
      }
      const entry = await storage.mutateConfigurations(async (items) => {
        const now = new Date().toISOString();
        const created = {
          id: generateConfigId(),
          name: input.name,
          schemaVersion: CONFIGURATION_SCHEMA_VERSION,
          revision: 1,
          createdAt: now,
          updatedAt: now,
          savedAt: now,
          createdBy: actor.username,
          updatedBy: actor.username,
          state: input.state,
          counters: input.counters
        };
        items.push(created);
        return { write: true, configurations: items, result: created };
      });
      sendJson(res, 201, entry);
      return;
    }

    if (!isSafeId(id)) {
      sendJson(res, parts.length === 3 ? 400 : 405, {
        message: parts.length === 3 ? 'Identificador inválido.' : 'Método não suportado.'
      });
      return;
    }

    if (req.method === 'PUT') {
      const expectedRevision = parseRevisionHeader(req);
      if (!expectedRevision) {
        sendJson(res, 428, { message: 'Informe a revisão atual em If-Match.' });
        return;
      }
      const input = sanitizeConfigurationInput(await parseJsonBody(req));
      if (!input) {
        sendJson(res, 400, { message: 'Dados de configuração inválidos.' });
        return;
      }
      const outcome = await storage.mutateConfigurations(async (items) => {
        const index = items.findIndex((item) => item.id === id);
        if (index === -1) {
          return { write: false, configurations: items, result: { status: 'missing' } };
        }
        const current = items[index];
        if (current.revision !== expectedRevision) {
          return {
            write: false,
            configurations: items,
            result: { status: 'conflict', current: conflictMetadata(current) }
          };
        }
        const updatedAt = new Date().toISOString();
        const entry = {
          ...current,
          name: input.name,
          schemaVersion: CONFIGURATION_SCHEMA_VERSION,
          revision: current.revision + 1,
          updatedAt,
          savedAt: updatedAt,
          updatedBy: actor.username,
          state: input.state,
          counters: input.counters
        };
        items[index] = entry;
        return { write: true, configurations: items, result: { status: 'updated', entry } };
      });
      if (outcome.status === 'missing') {
        sendJson(res, 404, { message: 'Configuração não encontrada.' });
        return;
      }
      if (outcome.status === 'conflict') {
        sendJson(res, 409, {
          message: 'A configuração foi alterada por outra sessão.',
          current: outcome.current
        });
        return;
      }
      sendJson(res, 200, outcome.entry);
      return;
    }

    if (req.method === 'DELETE') {
      const expectedRevision = parseRevisionHeader(req);
      if (!expectedRevision) {
        sendJson(res, 428, { message: 'Informe a revisão atual em If-Match.' });
        return;
      }
      const outcome = await storage.mutateConfigurations(async (items) => {
        const index = items.findIndex((item) => item.id === id);
        if (index === -1) {
          return { write: false, configurations: items, result: { status: 'missing' } };
        }
        const current = items[index];
        if (current.revision !== expectedRevision) {
          return {
            write: false,
            configurations: items,
            result: { status: 'conflict', current: conflictMetadata(current) }
          };
        }
        items.splice(index, 1);
        return { write: true, configurations: items, result: { status: 'removed' } };
      });
      if (outcome.status === 'missing') {
        sendJson(res, 404, { message: 'Configuração não encontrada.' });
        return;
      }
      if (outcome.status === 'conflict') {
        sendJson(res, 409, {
          message: 'A configuração foi alterada por outra sessão.',
          current: outcome.current
        });
        return;
      }
      sendEmpty(res, 204);
      return;
    }

    sendJson(res, 405, { message: 'Método não suportado.' });
  }

  async function serveStatic(req, res, pathname) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      sendJson(res, 405, { message: 'Método não suportado.' });
      return;
    }
    let decoded;
    try {
      decoded = decodeURIComponent(pathname);
    } catch (error) {
      sendJson(res, 400, { message: 'Caminho inválido.' });
      return;
    }
    const relative = PUBLIC_FILES.get(decoded);
    if (!relative) {
      sendJson(res, 404, { message: 'Arquivo não encontrado.' });
      return;
    }
    const target = path.join(rootDir, relative);
    const data = await fsp.readFile(target);
    const headers = {
      ...securityHeaders(MIME_TYPES[path.extname(target)] || 'application/octet-stream'),
      'Cache-Control': relative === 'index.html' ? 'no-cache' : 'public, max-age=3600',
      'Content-Length': data.length
    };
    res.writeHead(200, headers);
    res.end(req.method === 'HEAD' ? undefined : data);
  }

  async function handler(req, res) {
    try {
      const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
      if (url.pathname === '/api/login') {
        await handleLogin(req, res);
      } else if (url.pathname === '/api/logout') {
        if (req.method !== 'POST') sendJson(res, 405, { message: 'Método não suportado.' });
        else sendEmpty(res, 204);
      } else if (url.pathname === '/api/configurations' || url.pathname.startsWith('/api/configurations/')) {
        await handleConfigurations(req, res, url);
      } else if (url.pathname.startsWith('/api/')) {
        sendJson(res, 404, { message: 'Endpoint não encontrado.' });
      } else {
        await serveStatic(req, res, url.pathname);
      }
    } catch (error) {
      if (error.message === 'INVALID_JSON') {
        sendJson(res, 400, { message: 'JSON inválido.' });
      } else if (error.message === 'PAYLOAD_TOO_LARGE') {
        sendJson(res, 413, { message: 'Payload excede o limite permitido.' });
      } else {
        console.error('Erro inesperado no servidor.', error);
        if (!res.headersSent) sendJson(res, 500, { message: 'Erro interno do servidor.' });
        else res.end();
      }
    }
  }

  return { handler, storage, tokenService };
}

function createHttpServer(options = {}) {
  const app = createApp(options);
  const server = http.createServer(app.handler);
  server.on('clientError', (error, socket) => {
    if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
  });
  return { server, ...app };
}

async function startServer() {
  const port = parsePositiveNumber(process.env.PORT, DEFAULT_PORT);
  const host = process.env.HOST || DEFAULT_HOST;
  const app = createHttpServer();
  await app.storage.ensure();
  app.server.listen(port, host, () => {
    console.log(`Servidor iniciado em http://${host}:${port}`);
  });
}

if (require.main === module) {
  startServer().catch((error) => {
    console.error('Não foi possível iniciar o servidor.', error);
    process.exitCode = 1;
  });
}

module.exports = {
  createApp,
  createHttpServer,
  createStorage,
  createTokenService,
  resolveJwtSecret,
  sanitizeConfigurationInput,
  validateJsonTree,
  verifyPasswordHash
};
