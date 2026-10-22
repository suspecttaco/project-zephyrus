#!/bin/bash
# Uso: bash scripts/aws/teardown.sh
set -uo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

[ -f "$STATE_FILE" ] || { echo "No hay nada registrado ($STATE_FILE no existe)."; exit 0; }
INSTANCE_ID=$(state_get INSTANCE_ID); SG_ID=$(state_get SG_ID); KEY_NAME=$(state_get KEY_NAME); BUCKET=$(state_get ARTIFACT_BUCKET)

if [ -n "$INSTANCE_ID" ]; then
    echo "== Terminando instancia $INSTANCE_ID"
    awsx ec2 terminate-instances --instance-ids "$INSTANCE_ID" >/dev/null && awsx ec2 wait instance-terminated --instance-ids "$INSTANCE_ID"
fi
if [ -n "$SG_ID" ]; then
    echo "== Eliminando grupo de seguridad $SG_ID"
    for _ in 1 2 3 4 5 6; do awsx ec2 delete-security-group --group-id "$SG_ID" 2>/dev/null && break; sleep 5; done
fi
if [ -n "$KEY_NAME" ]; then
    echo "== Eliminando par de claves $KEY_NAME"
    awsx ec2 delete-key-pair --key-name "$KEY_NAME" >/dev/null; rm -f "$AWS_DIR/$KEY_NAME.pem"
fi
if [ -n "$BUCKET" ]; then
    echo "== Vaciando y eliminando bucket $BUCKET (todas sus versiones y marcadores de borrado)"
    while read -r key version; do
        [ -z "$key" ] || [ "$key" == "None" ] && continue
        awsx s3api delete-object --bucket "$BUCKET" --key "$key" --version-id "$version" </dev/null >/dev/null
    done < <(awsx s3api list-object-versions --bucket "$BUCKET" --query '[Versions,DeleteMarkers][][].[Key,VersionId]' --output text 2>/dev/null || true)
    if awsx s3api delete-bucket --bucket "$BUCKET" 2>/dev/null; then
        BUCKET=""
    else
        echo "!! No se pudo eliminar el bucket $BUCKET. Revísalo a mano."
    fi
fi
if [ -n "$BUCKET" ]; then
    echo "ARTIFACT_BUCKET=$BUCKET" > "$STATE_FILE"
    exit 1
fi
rm -f "$STATE_FILE"
echo "Listo."
