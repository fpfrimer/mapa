#!/usr/bin/env node
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');

const forbiddenTrackedFiles = new Set([
  'data/configurations.json',
  'data/users.json'
]);
const forbiddenPatterns = [
  { pattern: /planner[-]local-secret/, message: 'segredo JWT padrão encontrado' },
  { pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/, message: 'chave privada encontrada' }
];

const gitResult = spawnSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
  encoding: 'utf8'
});
if (gitResult.status !== 0 || typeof gitResult.stdout !== 'string') {
  throw gitResult.error || new Error(gitResult.stderr || 'Não foi possível consultar os arquivos Git.');
}
const tracked = gitResult.stdout
  .split('\0')
  .filter(Boolean);
const errors = [];

tracked.forEach((file) => {
  if (forbiddenTrackedFiles.has(file)) {
    errors.push(`${file}: arquivo de runtime não pode ser versionado`);
    return;
  }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) return;
  const content = fs.readFileSync(file, 'utf8');
  forbiddenPatterns.forEach(({ pattern, message }) => {
    if (pattern.test(content)) errors.push(`${file}: ${message}`);
  });
});

if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log('Nenhum arquivo sensível conhecido está versionado.');
