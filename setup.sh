#!/bin/bash
# ============================================================
# Script de configuração automática do servidor "Mapa de Horários Acadêmicos"
# ============================================================

set -e

echo "Iniciando configuração do servidor Mapa de Horários..."

# Este script deve ser executado pelo mesmo usuário que rodará o serviço systemd
# (conforme definido em User=). Utilize sudo apenas quando necessário para ações
# administrativas, garantindo que o usuário final permaneça como proprietário dos arquivos.

# Caminho base = pasta onde o script está localizado
BASE_DIR="$(cd "$(dirname "$0")" && pwd)"
SERVICE_USER="$(whoami)"
SERVICE_GROUP="$(id -gn "$SERVICE_USER")"
# Permissões padrão do diretório de dados. Ajuste para 770 antes de executar o script
# caso outro grupo específico precise de acesso de escrita.
DATA_DIR_PERMISSIONS="${DATA_DIR_PERMISSIONS:-750}"
ENV_FILE="/etc/mapa-horarios.env"

# --- Verificar se Node.js está instalado ---
if ! command -v node >/dev/null 2>&1; then
    echo "Node.js não encontrado. Instalando Node.js 20.x..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt install -y nodejs
else
    echo "Node.js já instalado: $(node -v)"
fi

# --- Verificar se npm está disponível ---
if ! command -v npm >/dev/null 2>&1; then
    echo "npm não encontrado. Reinstalando Node.js para incluir npm..."
    sudo apt remove -y nodejs
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt install -y nodejs
else
    echo "npm já instalado: $(npm -v)"
fi

# --- Criar pasta de dados ---
echo "Verificando diretório de dados..."
mkdir -p "$BASE_DIR/data"
sudo chown -R "$SERVICE_USER":"$SERVICE_GROUP" "$BASE_DIR/data"
sudo find "$BASE_DIR/data" -type d -exec chmod "$DATA_DIR_PERMISSIONS" {} +
sudo find "$BASE_DIR/data" -type f -exec chmod 640 {} + 2>/dev/null || true

# --- Instalar dependências Node ---
echo "Instalando dependências..."
cd "$BASE_DIR"
npm ci --omit=dev

# --- Criar configuração protegida do serviço ---
if [ ! -f "$ENV_FILE" ]; then
    echo "Criando configuração segura em $ENV_FILE..."
    JWT_SECRET_VALUE="$(node -e "process.stdout.write(require('crypto').randomBytes(32).toString('hex'))")"
    sudo bash -c "umask 077; printf '%s\n' 'JWT_SECRET=$JWT_SECRET_VALUE' 'HOST=127.0.0.1' 'MAPA_DATA_DIR=$BASE_DIR/data' > '$ENV_FILE'"
else
    echo "Mantendo configuração existente em $ENV_FILE."
fi

# --- Criar serviço systemd ---
echo "Criando serviço systemd..."
SERVICE_FILE="/etc/systemd/system/mapa-horarios.service"

sudo bash -c "cat > $SERVICE_FILE" <<EOF
[Unit]
Description=Servidor do Mapa de Horários Acadêmicos
After=network.target

[Service]
User=$(whoami)
WorkingDirectory=$BASE_DIR
ExecStart=/usr/bin/node $BASE_DIR/server.js
Restart=always
Environment=NODE_ENV=production
EnvironmentFile=$ENV_FILE

[Install]
WantedBy=multi-user.target
EOF

# --- Ativar serviço ---
echo "Ativando serviço..."
sudo systemctl daemon-reload
sudo systemctl enable mapa-horarios
sudo systemctl restart mapa-horarios

# --- Mostrar status resumido ---
echo "Status do serviço:"
sudo systemctl --no-pager --full status mapa-horarios | head -n 15

echo "Instalação concluída."
echo "Acesse a aplicação em: http://localhost:3000"
echo "Use 'sudo systemctl status mapa-horarios' para verificar o status do serviço."
