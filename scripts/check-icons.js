#!/usr/bin/env node
const fs = require('node:fs');

const SPRITE_PATH = 'assets/icons/lucide-icons.svg';
const LEGACY_SPRITE = 'ui-icons.svg';
const sourceFiles = ['index.html', 'script.js', 'server.js'];
const sprite = fs.readFileSync(SPRITE_PATH, 'utf8');
const symbols = new Set(Array.from(sprite.matchAll(/<symbol\s+id="(icon-[a-z0-9-]+)"/g), (match) => match[1]));
const references = new Set();
const errors = [];

sourceFiles.forEach((file) => {
  const content = fs.readFileSync(file, 'utf8');
  if (content.includes(LEGACY_SPRITE)) {
    errors.push(`${file}: referência ao sprite legado ${LEGACY_SPRITE}`);
  }
  for (const match of content.matchAll(/lucide-icons\.svg#(icon-[a-z0-9-]+)/g)) {
    references.add(match[1]);
  }
  if (file === 'script.js') {
    for (const match of content.matchAll(/['"](icon-[a-z0-9-]+)['"]/g)) {
      if (!match[1].startsWith('icon-button') && !match[1].startsWith('icon--')) {
        references.add(match[1]);
      }
    }
  }
});

for (const reference of references) {
  if (!symbols.has(reference)) errors.push(`símbolo referenciado não existe: ${reference}`);
}
for (const symbol of symbols) {
  if (!references.has(symbol)) errors.push(`símbolo não utilizado no sprite: ${symbol}`);
}
if (!sprite.includes('Lucide Static v1.28.0') || !fs.existsSync('assets/icons/LICENSE-LUCIDE.txt')) {
  errors.push('atribuição ou licença do Lucide ausente');
}

if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log(`${symbols.size} ícones Lucide válidos e em uso.`);
