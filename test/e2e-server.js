const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { createHttpServer } = require('../server');

async function main() {
  const port = Number.parseInt(process.env.PORT || '43210', 10);
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mapa-e2e-'));
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync('correct-password', salt, 64, { N: 16384, r: 8, p: 1 });
  const passwordHash = `scrypt$16384$8$1$${salt.toString('hex')}$${key.toString('hex')}`;
  await fs.writeFile(path.join(dataDir, 'users.json'), JSON.stringify([
    { id: 'e2e-user', username: 'editor', passwordHash }
  ]));
  await fs.writeFile(path.join(dataDir, 'configurations.json'), '[]\n');

  const app = createHttpServer({
    dataDir,
    jwtSecret: 'e2e-secret-with-at-least-thirty-two-characters'
  });
  await new Promise((resolve, reject) => {
    app.server.once('error', reject);
    app.server.listen(port, '127.0.0.1', resolve);
  });

  async function shutdown() {
    await new Promise((resolve) => app.server.close(resolve));
    await fs.rm(dataDir, { recursive: true, force: true });
    process.exit(0);
  }
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
