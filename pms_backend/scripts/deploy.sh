#!/bin/bash
# Uso: SERVER_IP=203.0.113.10 KEY_PATH=./mi_clave_ec2.pem bash scripts/deploy.sh
# Para el servidor simulado (scripts/docker/ec2-sim): SERVER_IP=localhost SSH_PORT=2222 KEY_PATH=scripts/docker/ec2-sim/mi_clave_ec2
# Si defines ARTIFACT_BUCKET, además se guarda una copia versionada del paquete en S3 (LocalStack, ver scripts/aws).
set -e

SERVER_USER="${SERVER_USER:-ubuntu}"
SERVER_IP="${SERVER_IP:?Define SERVER_IP con la IP del servidor}"
SSH_PORT="${SSH_PORT:-22}"
KEY_PATH="${KEY_PATH:?Define KEY_PATH con la ruta de la clave .pem}"
REMOTE_DIR="${REMOTE_DIR:-/home/$SERVER_USER/pms-backend}"
ENV_FILE="${ENV_FILE:-.env.production}"
VER=$(node -p "require('./package.json').version")
ARCHIVE_NAME="pms_be_${VER}.tgz"

SSH_OPTS=(-i "$KEY_PATH" -o StrictHostKeyChecking=accept-new -o BatchMode=yes)
remote() { ssh "${SSH_OPTS[@]}" -p "$SSH_PORT" "$SERVER_USER@$SERVER_IP" "$@"; }
copy() { scp "${SSH_OPTS[@]}" -P "$SSH_PORT" "$1" "$SERVER_USER@$SERVER_IP:$2"; }

if [ ! -f "binaries/$ARCHIVE_NAME" ]; then
    echo "No existe binaries/$ARCHIVE_NAME. Ejecuta primero: bash scripts/mkpackage.sh"
    exit 1
fi

if [ -n "${ARTIFACT_BUCKET:-}" ]; then
    source "$(dirname "${BASH_SOURCE[0]}")/aws/lib.sh"
    echo "Guardando copia del paquete en s3://$ARTIFACT_BUCKET/releases/$ARCHIVE_NAME (LocalStack)..."
    s3_put "binaries/$ARCHIVE_NAME" "$ARTIFACT_BUCKET" "releases/$ARCHIVE_NAME"
fi

echo "=========================================="
echo "Iniciando despliegue hacia $SERVER_USER@$SERVER_IP:$SSH_PORT"
echo "=========================================="

echo "Transferiendo paquete de aplicación..."
remote "mkdir -p $REMOTE_DIR"
copy "binaries/$ARCHIVE_NAME" "$REMOTE_DIR/"
if [ -f "$ENV_FILE" ]; then
    echo "Transfiriendo $ENV_FILE como .env..."
    copy "$ENV_FILE" "$REMOTE_DIR/.env"
else
    echo "(No hay $ENV_FILE local: se usa el .env que ya exista en el servidor)"
fi

echo "Ejecutando actualización de servicio en servidor..."
remote "bash -s" << EOF2
set -e
cd $REMOTE_DIR
rm -rf dist
tar -xzf $ARCHIVE_NAME
rm -f $ARCHIVE_NAME
npm ci --omit=dev
pm2 startOrRestart ecosystem.config.js --env production
pm2 save
pm2 status
EOF2

echo "=========================================="
echo "Despliegue finalizado exitosamente."
echo "=========================================="
