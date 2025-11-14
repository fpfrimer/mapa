#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Uso: scripts/remove-user.sh <username|id> [opções]

Remove uma entrada existente do arquivo data/users.json utilizando o login ou o ID.

Opções:
  --file <caminho> Caminho alternativo para o arquivo de usuários (padrão: data/users.json).
  -h, --help       Mostra este texto e sai.
USAGE
}

if [[ ${1:-} == "-h" || ${1:-} == "--help" ]]; then
  usage
  exit 0
fi

if [[ $# -lt 1 ]]; then
  echo "Erro: informe o identificador do usuário (username ou id)." >&2
  usage >&2
  exit 1
fi

identifier="$1"
shift

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "$PROJECT_ROOT"
USERS_FILE="$PROJECT_ROOT/data/users.json"

while [[ $# -gt 0 ]]; do
  case "$1" in
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

node - "$USERS_FILE" "$identifier" <<'NODE'
const fs = require('fs');
const path = require('path');

const [, , fileArg, identifierArg] = process.argv;

function fail(message) {
  console.error(message);
  process.exit(1);
}

const usersFile = path.resolve(fileArg || path.join(__dirname, '..', 'data', 'users.json'));
const identifier = (identifierArg || '').trim();
if (!identifier) {
  fail('Identificador inválido.');
}

let raw;
try {
  raw = fs.readFileSync(usersFile, 'utf-8');
} catch (error) {
  if (error.code === 'ENOENT') {
    fail(`Arquivo ${usersFile} não encontrado.`);
  }
  fail(`Não foi possível abrir ${usersFile}: ${error.message}`);
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
const index = users.findIndex((u) => u.username === identifier || u.id === identifier);
if (index === -1) {
  fail(`Nenhum usuário encontrado com identificador "${identifier}".`);
}

const [removed] = users.splice(index, 1);
fs.writeFileSync(usersFile, `${JSON.stringify(users, null, 2)}\n`, 'utf-8');
console.log(`Usuário "${removed.username}" removido.`);
NODE
