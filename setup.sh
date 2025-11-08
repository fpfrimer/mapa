#!/bin/bash
# ============================================================
# Script de configuração automática do servidor "Mapa de Horários Acadêmicos"
# ============================================================

set -e

echo "Iniciando configuração do servidor Mapa de Horários..."

# Caminho base = pasta onde o script está localizado
BASE_DIR="$(cd "$(dirname "$0")" && pwd)"

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
sudo chmod -R 777 "$BASE_DIR/data"

# --- Instalar dependências Node ---
echo "Instalando dependências..."
cd "$BASE_DIR"
npm install

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