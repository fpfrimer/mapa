const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { createHttpServer, createTokenService, resolveJwtSecret } = require('../server');

const TEST_SECRET = 'test-secret-with-at-least-thirty-two-characters';

function passwordHash(password) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$16384$8$1$${salt.toString('hex')}$${key.toString('hex')}`;
}

async function createFixture(options = {}) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mapa-test-'));
  await fs.writeFile(path.join(dataDir, 'users.json'), JSON.stringify([
    { id: 'user-1', username: 'editor', passwordHash: passwordHash('correct-password') }
  ]));
  await fs.writeFile(
    path.join(dataDir, 'configurations.json'),
    `${JSON.stringify(options.configurations || [])}\n`
  );
  const app = createHttpServer({
    dataDir,
    jwtSecret: TEST_SECRET,
    tokenService: options.tokenService
  });
  await new Promise((resolve, reject) => {
    app.server.once('error', reject);
    app.server.listen(0, '127.0.0.1', resolve);
  });
  const address = app.server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  return {
    ...app,
    dataDir,
    baseUrl,
    async close() {
      await new Promise((resolve) => app.server.close(resolve));
      await fs.rm(dataDir, { recursive: true, force: true });
    }
  };
}

async function login(fixture, password = 'correct-password') {
  return fetch(`${fixture.baseUrl}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'editor', password })
  });
}

test('produção exige JWT_SECRET forte', () => {
  assert.throws(
    () => resolveJwtSecret({ NODE_ENV: 'production', JWT_SECRET: 'short' }),
    /pelo menos 32 caracteres/
  );
  assert.equal(resolveJwtSecret({ NODE_ENV: 'production', JWT_SECRET: TEST_SECRET }), TEST_SECRET);
});

test('servidor entrega apenas arquivos públicos permitidos e aplica cabeçalhos', async (t) => {
  const fixture = await createFixture();
  t.after(() => fixture.close());

  const index = await fetch(`${fixture.baseUrl}/`);
  assert.equal(index.status, 200);
  assert.match(index.headers.get('content-security-policy'), /default-src 'self'/);
  assert.equal(index.headers.get('x-content-type-options'), 'nosniff');

  const logo = await fetch(`${fixture.baseUrl}/assets/brand/utfpr-logo.png`);
  assert.equal(logo.status, 200);
  assert.equal(logo.headers.get('content-type'), 'image/png');

  const icons = await fetch(`${fixture.baseUrl}/assets/icons/lucide-icons.svg`);
  assert.equal(icons.status, 200);
  assert.match(icons.headers.get('content-type'), /image\/svg\+xml/);

  for (const pathname of [
    '/data/users.json',
    '/data/configurations.json',
    '/server.js',
    '/.git/config',
    '/assets/icons/ui-icons.svg',
    '/%2e%2e/server.js',
    '/assets/../server.js'
  ]) {
    const response = await fetch(`${fixture.baseUrl}${pathname}`);
    assert.equal(response.status, 404, pathname);
  }
});

test('biblioteca exige token válido e rejeita token adulterado ou expirado', async (t) => {
  const shortTokenService = createTokenService(TEST_SECRET, 1200);
  const fixture = await createFixture({ tokenService: shortTokenService });
  t.after(() => fixture.close());

  assert.equal((await fetch(`${fixture.baseUrl}/api/configurations`)).status, 401);
  const loginResponse = await login(fixture);
  assert.equal(loginResponse.status, 200);
  const { token } = await loginResponse.json();

  const authorized = await fetch(`${fixture.baseUrl}/api/configurations`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  assert.equal(authorized.status, 200);

  const tampered = `${token.slice(0, -1)}${token.endsWith('a') ? 'b' : 'a'}`;
  assert.equal((await fetch(`${fixture.baseUrl}/api/configurations`, {
    headers: { Authorization: `Bearer ${tampered}` }
  })).status, 401);

  await new Promise((resolve) => setTimeout(resolve, 2100));
  assert.equal((await fetch(`${fixture.baseUrl}/api/configurations`, {
    headers: { Authorization: `Bearer ${token}` }
  })).status, 401);
});

test('login limita tentativas inválidas por endereço', async (t) => {
  const fixture = await createFixture();
  t.after(() => fixture.close());
  for (let attempt = 0; attempt < 5; attempt += 1) {
    assert.equal((await login(fixture, 'wrong-password')).status, 401);
  }
  const blocked = await login(fixture, 'wrong-password');
  assert.equal(blocked.status, 429);
  assert.ok(Number(blocked.headers.get('retry-after')) > 0);
});

test('CRUD autenticado preserva o formato e serializa criações concorrentes', async (t) => {
  const fixture = await createFixture();
  t.after(() => fixture.close());
  const loginResponse = await login(fixture);
  const { token } = await loginResponse.json();
  const headers = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json'
  };
  const payload = (name) => ({
    name,
    state: { periods: [], professors: [], rooms: [], disciplines: [], schedule: {} },
    counters: { period: 1 }
  });

  const creations = await Promise.all(
    Array.from({ length: 12 }, (_, index) => fetch(`${fixture.baseUrl}/api/configurations`, {
      method: 'POST', headers, body: JSON.stringify(payload(`Mapa ${index + 1}`))
    }))
  );
  assert.ok(creations.every((response) => response.status === 201));

  const listResponse = await fetch(`${fixture.baseUrl}/api/configurations`, { headers });
  const list = await listResponse.json();
  assert.equal(list.items.length, 12);

  const target = list.items[0];
  const update = await fetch(`${fixture.baseUrl}/api/configurations/${target.id}`, {
    method: 'PUT',
    headers: { ...headers, 'If-Match': `"${target.revision}"` },
    body: JSON.stringify(payload('Mapa atualizado'))
  });
  assert.equal(update.status, 200);
  const updated = await update.json();
  assert.equal(updated.name, 'Mapa atualizado');
  assert.equal(updated.revision, 2);
  assert.equal(updated.updatedBy, 'editor');

  const removal = await fetch(`${fixture.baseUrl}/api/configurations/${target.id}`, {
    method: 'DELETE', headers: { ...headers, 'If-Match': `"${updated.revision}"` }
  });
  assert.equal(removal.status, 204);
  const persisted = JSON.parse(await fs.readFile(path.join(fixture.dataDir, 'configurations.json'), 'utf8'));
  assert.equal(persisted.length, 11);
});

test('registros legados são migrados em memória sem reescrever o arquivo', async (t) => {
  const savedAt = '2025-12-11T14:50:35.643Z';
  const legacy = {
    id: 'legacy-map',
    name: 'Mapa legado',
    savedAt,
    state: { periods: [], professors: [], rooms: [], disciplines: [], schedule: {} },
    counters: { period: 1 }
  };
  const fixture = await createFixture({ configurations: [legacy] });
  t.after(() => fixture.close());
  const { token } = await (await login(fixture)).json();
  const response = await fetch(`${fixture.baseUrl}/api/configurations`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const { items } = await response.json();
  assert.deepEqual(
    {
      schemaVersion: items[0].schemaVersion,
      revision: items[0].revision,
      createdAt: items[0].createdAt,
      updatedAt: items[0].updatedAt,
      createdBy: items[0].createdBy,
      updatedBy: items[0].updatedBy
    },
    {
      schemaVersion: 1,
      revision: 1,
      createdAt: savedAt,
      updatedAt: savedAt,
      createdBy: 'legado',
      updatedBy: 'legado'
    }
  );
  const stored = JSON.parse(await fs.readFile(path.join(fixture.dataDir, 'configurations.json'), 'utf8'));
  assert.equal(stored[0].revision, undefined);
});

test('atualização e exclusão exigem revisão e detectam concorrência', async (t) => {
  const initial = {
    id: 'shared-map',
    name: 'Mapa compartilhado',
    savedAt: '2026-01-10T10:00:00.000Z',
    state: { periods: [], professors: [], rooms: [], disciplines: [], schedule: {} },
    counters: null
  };
  const fixture = await createFixture({ configurations: [initial] });
  t.after(() => fixture.close());
  const { token } = await (await login(fixture)).json();
  const { token: secondSessionToken } = await (await login(fixture)).json();
  const baseHeaders = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const body = JSON.stringify({ name: 'Primeira edição', state: initial.state, counters: null });

  assert.equal((await fetch(`${fixture.baseUrl}/api/configurations/shared-map`, {
    method: 'PUT', headers: baseHeaders, body
  })).status, 428);

  const first = await fetch(`${fixture.baseUrl}/api/configurations/shared-map`, {
    method: 'PUT', headers: { ...baseHeaders, 'If-Match': '"1"' }, body
  });
  assert.equal(first.status, 200);
  assert.equal((await first.json()).revision, 2);

  const competingBodies = ['Sessão A', 'Sessão B'].map((name) => JSON.stringify({
    name,
    state: initial.state,
    counters: null
  }));
  const competing = await Promise.all(competingBodies.map((competingBody, index) =>
    fetch(`${fixture.baseUrl}/api/configurations/shared-map`, {
      method: 'PUT',
      headers: {
        ...baseHeaders,
        Authorization: `Bearer ${index ? secondSessionToken : token}`,
        'If-Match': '"2"'
      },
      body: competingBody
    })
  ));
  assert.deepEqual(competing.map((response) => response.status).sort(), [200, 409]);
  const conflict = await competing.find((response) => response.status === 409).json();
  assert.equal(conflict.current.revision, 3);
  assert.equal(conflict.current.updatedBy, 'editor');

  const stale = await fetch(`${fixture.baseUrl}/api/configurations/shared-map`, {
    method: 'PUT', headers: { ...baseHeaders, 'If-Match': '"1"' }, body
  });
  assert.equal(stale.status, 409);
  const staleConflict = await stale.json();
  assert.equal(staleConflict.current.revision, 3);

  assert.equal((await fetch(`${fixture.baseUrl}/api/configurations/shared-map`, {
    method: 'DELETE', headers: { Authorization: `Bearer ${token}`, 'If-Match': '"1"' }
  })).status, 409);
  assert.equal((await fetch(`${fixture.baseUrl}/api/configurations/shared-map`, {
    method: 'DELETE', headers: { Authorization: `Bearer ${token}` }
  })).status, 428);
});

test('payloads perigosos, desconhecidos ou profundos são rejeitados', async (t) => {
  const fixture = await createFixture();
  t.after(() => fixture.close());
  const { token } = await (await login(fixture)).json();
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const invalidPayloads = [
    { name: 'Mapa', state: {}, unexpected: true },
    { name: 'x'.repeat(121), state: {} },
    { name: 'Mapa', state: JSON.parse('{"__proto__":{"polluted":true}}') }
  ];
  let deep = {};
  for (let level = 0; level < 20; level += 1) deep = { child: deep };
  invalidPayloads.push({ name: 'Mapa', state: deep });

  for (const payload of invalidPayloads) {
    const response = await fetch(`${fixture.baseUrl}/api/configurations`, {
      method: 'POST', headers, body: JSON.stringify(payload)
    });
    assert.equal(response.status, 400);
  }
});
