#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Uso: scripts/add-user.sh <username> <senha> [opções]

Adiciona uma nova entrada ao arquivo data/users.json utilizando o mesmo formato
de hash (scrypt) aceito pelo servidor.

Opções:
  --id <valor>     Define manualmente o campo "id" do usuário.
  --file <caminho> Caminho alternativo para o arquivo de usuários (padrão: data/users.json).
  -h, --help       Mostra este texto e sai.
USAGE
}

if [[ ${1:-} == "-h" || ${1:-} == "--help" ]]; then
  usage
  exit 0
fi

if [[ $# -lt 2 ]]; then
  echo "Erro: informe <username> e <senha>." >&2
  usage >&2
  exit 1
fi

username="$1"
password="$2"
shift 2

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "$PROJECT_ROOT"
USERS_FILE="$PROJECT_ROOT/data/users.json"
custom_id=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --id)
      if [[ $# -lt 2 ]]; then
        echo "Erro: --id requer um valor." >&2
        exit 1
      fi
      custom_id="$2"
      shift 2
      ;;
    --file)
      if [[ $# -lt 2 ]]; then
        echo "Erro: --file requer um caminho." >&2
        exit 1
      fi
      USERS_FILE="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Opção desconhecida: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

node - "$USERS_FILE" "$username" "$password" "${custom_id:-}" <<'NODE'
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const [, , fileArg, usernameArg, passwordArg, customIdArg] = process.argv;

function fail(message) {
  console.error(message);
  process.exit(1);
}

const usersFile = path.resolve(fileArg || path.join(__dirname, '..', 'data', 'users.json'));
const username = (usernameArg || '').trim();
const password = passwordArg || '';
const providedId = (customIdArg || '').trim();

if (!username) {
  fail('Usuário inválido.');
}
if (!password) {
  fail('Senha inválida.');
}

fs.mkdirSync(path.dirname(usersFile), { recursive: true });
let raw = '[]';
try {
  raw = fs.readFileSync(usersFile, 'utf-8');
} catch (error) {
  if (error.code !== 'ENOENT') {
    fail(`Não foi possível abrir ${usersFile}: ${error.message}`);
  }
}

let parsed;
try {
  parsed = raw.trim() ? JSON.parse(raw) : [];
} catch (error) {
  fail('Arquivo de usuários contém JSON inválido.');
}

if (!Array.isArray(parsed)) {
  fail('Arquivo de usuários deve conter um array JSON.');
}

const sanitizeEntry = (entry) => {
  if (!entry || typeof entry !== 'object') return null;
  const id = typeof entry.id === 'string' ? entry.id : null;
  const user = typeof entry.username === 'string' ? entry.username.trim() : '';
  const hash = typeof entry.passwordHash === 'string' ? entry.passwordHash : '';
  if (!id || !user || !hash) return null;
  return { id, username: user, passwordHash: hash };
};

const users = parsed.map(sanitizeEntry).filter(Boolean);

if (users.some((u) => u.username === username)) {
  fail(`Já existe um usuário com o login "${username}".`);
}

const params = { N: 16384, r: 8, p: 1 };
const salt = crypto.randomBytes(16);
const keyLength = 64;
const derived = crypto.scryptSync(password, salt, keyLength, params);
const passwordHash = `scrypt$${params.N}$${params.r}$${params.p}$${salt.toString('hex')}$${derived.toString('hex')}`;

const slugify = (value) =>
  value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();

const baseId = providedId || (slugify(username) ? `user-${slugify(username)}` : `user-${Date.now()}`);
const ids = new Set(users.map((u) => u.id));
let userId = baseId;
if (providedId) {
  if (ids.has(userId)) {
    fail(`Já existe um usuário com o id "${userId}".`);
  }
} else {
  let suffix = 1;
  while (ids.has(userId)) {
    userId = `${baseId}-${suffix++}`;
  }
}

users.push({ id: userId, username, passwordHash });
users.sort((a, b) => a.username.localeCompare(b.username, 'pt-BR', { sensitivity: 'base' }));

fs.writeFileSync(usersFile, `${JSON.stringify(users, null, 2)}\n`, 'utf-8');
console.log(`Usuário "${username}" criado com ID "${userId}".`);
NODE
