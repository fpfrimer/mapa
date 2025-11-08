#!/bin/bash
# ============================================================
# Script para parar o servidor "Mapa de Horários Acadêmicos"
# ============================================================

set -e

SERVICE_NAME="mapa-horarios"

echo "Parando o serviço $SERVICE_NAME..."

# Verifica se o serviço existe
if systemctl list-units --full -all | grep -Fq "$SERVICE_NAME.service"; then
    sudo systemctl stop "$SERVICE_NAME"
    echo "Serviço $SERVICE_NAME parado com sucesso."

    # Mostra o status resumido
    echo
    echo "Status atual:"
    sudo systemctl --no-pager --full status "$SERVICE_NAME" | head -n 10
else
    echo "O serviço $SERVICE_NAME não foi encontrado no systemd."
    echo "Verifique o nome ou se o serviço foi criado corretamente."
fi
