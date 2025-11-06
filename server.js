const express = require('express');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;

const app = express();
const port = process.env.PORT || 3000;

const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'configurations.json');

app.use(express.json({ limit: '5mb' }));

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

app.get('/api/configurations', async (req, res) => {
  try {
    const configs = await readConfigurations();
    res.json({ items: configs });
  } catch (error) {
    console.error('Erro ao listar configurações.', error);
    res.status(500).json({ message: 'Não foi possível listar as configurações salvas.' });
  }
});

app.post('/api/configurations', async (req, res) => {
  try {
    const input = sanitizeConfigurationInput(req.body);
    if (!input) {
      return res.status(400).json({ message: 'Dados de configuração inválidos.' });
    }
    const configs = await readConfigurations();
    const id = generateConfigId();
    const savedAt = new Date().toISOString();
    const entry = { id, name: input.name, savedAt, state: input.state, counters: input.counters };
    configs.push(entry);
    await writeConfigurations(configs);
    res.status(201).json(entry);
  } catch (error) {
    console.error('Erro ao salvar configuração.', error);
    res.status(500).json({ message: 'Não foi possível salvar a configuração.' });
  }
});

app.put('/api/configurations/:id', async (req, res) => {
  const { id } = req.params;
  if (!id) {
    return res.status(400).json({ message: 'Identificador inválido.' });
  }
  try {
    const input = sanitizeConfigurationInput(req.body);
    if (!input) {
      return res.status(400).json({ message: 'Dados de configuração inválidos.' });
    }
    const configs = await readConfigurations();
    const index = configs.findIndex((item) => item.id === id);
    if (index === -1) {
      return res.status(404).json({ message: 'Configuração não encontrada.' });
    }
    const savedAt = new Date().toISOString();
    const updated = {
      id,
      name: input.name,
      savedAt,
      state: input.state,
      counters: input.counters
    };
    configs[index] = updated;
    await writeConfigurations(configs);
    res.json(updated);
  } catch (error) {
    console.error('Erro ao atualizar configuração.', error);
    res.status(500).json({ message: 'Não foi possível atualizar a configuração.' });
  }
});

app.delete('/api/configurations/:id', async (req, res) => {
  const { id } = req.params;
  if (!id) {
    return res.status(400).json({ message: 'Identificador inválido.' });
  }
  try {
    const configs = await readConfigurations();
    const filtered = configs.filter((item) => item.id !== id);
    if (filtered.length === configs.length) {
      return res.status(404).json({ message: 'Configuração não encontrada.' });
    }
    await writeConfigurations(filtered);
    res.status(204).end();
  } catch (error) {
    console.error('Erro ao remover configuração.', error);
    res.status(500).json({ message: 'Não foi possível remover a configuração.' });
  }
});

app.use(express.static(path.join(__dirname)));

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

ensureDataFile()
  .then(() => {
    app.listen(port, () => {
      console.log(`Servidor iniciado na porta ${port}`);
    });
  })
  .catch((error) => {
    console.error('Não foi possível iniciar o servidor.', error);
    process.exit(1);
  });
