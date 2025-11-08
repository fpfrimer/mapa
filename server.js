const http = require('http');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = __dirname;
const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'configurations.json');
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

async function handleConfigurationsApi(req, res, url) {
  const { pathname } = url;
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

  const safePath = path.normalize(path.join(PUBLIC_DIR, pathname === '/' ? '/index.html' : pathname));
  if (!safePath.startsWith(PUBLIC_DIR)) {
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

ensureDataFile()
  .then(() => {
    server.listen(PORT, () => {
      console.log(`Servidor iniciado na porta ${PORT}`);
    });
  })
  .catch((error) => {
    console.error('Não foi possível iniciar o servidor.', error);
    process.exit(1);
  });
