#!/bin/bash
set -e

VER=$(node -p "require('./package.json').version")
BUILD_DIR="./build"
DIST_DIR="./dist"
BINARIES_DIR="./binaries"
ARCHIVE_NAME="pms_be_${VER}.tgz"

echo "=========================================="
echo "Iniciando empaquetado de producción v$VER"
echo "=========================================="

rm -rf $BUILD_DIR $DIST_DIR $BINARIES_DIR
mkdir -p $BUILD_DIR $BINARIES_DIR

echo "Compilando TypeScript..."
npx tsc

echo "Ofuscando código compilado..."
node scripts/obfuscate.js $DIST_DIR

cp package.json package-lock.json ecosystem.config.js $BUILD_DIR/
cp -r $DIST_DIR $BUILD_DIR/dist

echo "Comprimiendo archivo $ARCHIVE_NAME..."
tar -czf $BINARIES_DIR/$ARCHIVE_NAME -C $BUILD_DIR .

echo "=========================================="
echo "Paquete generado exitosamente en $BINARIES_DIR/$ARCHIVE_NAME"
echo "=========================================="
