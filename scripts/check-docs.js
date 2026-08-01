const fs = require('node:fs');
const path = require('node:path');
const packageJson = require('../package.json');

const root = path.resolve(__dirname, '..');
const manualDir = path.join(root, 'docs', 'manual');
const metadataPath = path.join(manualDir, 'metadata.tex');
const requiredSources = [
  'manual-usuario.tex',
  'manual-administrador.tex',
  'common.tex',
  'metadata.tex',
  'chapters/usuario.tex',
  'chapters/administrador.tex'
];
const requiredFigures = [
  '01-login.png',
  '02-hub.png',
  '03-novo-semestre.png',
  '04-editor.png',
  '05-cadastros.png',
  '06-grade.png',
  '07-selecao-multipla.png',
  '08-horarios-livres.png',
  '09-estado-salvamento.png',
  '10-conflito.png',
  '11-impressao.png'
];

function fail(message) {
  console.error(`Documentação inválida: ${message}`);
  process.exitCode = 1;
}

for (const relativePath of requiredSources) {
  if (!fs.existsSync(path.join(manualDir, relativePath))) {
    fail(`arquivo ausente: docs/manual/${relativePath}`);
  }
}

for (const filename of requiredFigures) {
  const figurePath = path.join(manualDir, 'figures', 'generated', filename);
  if (!fs.existsSync(figurePath) || fs.statSync(figurePath).size < 1_000) {
    fail(`figura ausente ou vazia: ${filename}; execute npm run docs:figures`);
  }
}

if (fs.existsSync(metadataPath)) {
  const metadata = fs.readFileSync(metadataPath, 'utf8');
  const match = metadata.match(/\\newcommand\{\\AppVersion\}\{([^}]+)\}/);
  if (!match || match[1] !== packageJson.version) {
    fail(`AppVersion deve ser ${packageJson.version}, conforme package.json`);
  }
}

if (!process.exitCode) {
  console.log('Fontes, metadados e figuras dos manuais estão consistentes.');
}
