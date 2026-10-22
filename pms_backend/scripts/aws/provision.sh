#!/bin/bash
# Uso:                  bash scripts/aws/provision.sh
# Para borrarlo todo:   bash scripts/aws/teardown.sh
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

INSTANCE_TYPE="${INSTANCE_TYPE:-t2.micro}"
VOLUME_GB="${VOLUME_GB:-20}"
KEY_NAME="${KEY_NAME:-$PROJECT_NAME-key}"
SG_NAME="${SG_NAME:-$PROJECT_NAME-sg}"
KEY_FILE="$AWS_DIR/$KEY_NAME.pem"

ADMIN_CIDR="${ADMIN_CIDR:-127.0.0.1/32}"

echo "== 1/5 Par de claves SSH ($KEY_NAME)"
if awsx ec2 describe-key-pairs --key-names "$KEY_NAME" >/dev/null 2>&1; then
    [ -f "$KEY_FILE" ] || { echo "La clave $KEY_NAME ya existe en AWS pero falta $KEY_FILE. Bórrala con teardown.sh"; exit 1; }
    echo "ya existe, se reutiliza"
else
    awsx ec2 create-key-pair --key-name "$KEY_NAME" --query KeyMaterial --output text > "$KEY_FILE"
    chmod 400 "$KEY_FILE"
    echo "creada; clave privada en $KEY_FILE (ignorada por git)"
fi
state_set KEY_NAME "$KEY_NAME"

echo "== 2/5 Grupo de seguridad ($SG_NAME): SSH solo desde $ADMIN_CIDR; HTTP 80 y 8080 públicos"
SG_ID=$(state_get SG_ID)
if [ -z "$SG_ID" ]; then
    SG_ID=$(awsx ec2 create-security-group --group-name "$SG_NAME" --description "PMS backend" --query GroupId --output text)
    awsx ec2 authorize-security-group-ingress --group-id "$SG_ID" --protocol tcp --port 22   --cidr "$ADMIN_CIDR" >/dev/null
    awsx ec2 authorize-security-group-ingress --group-id "$SG_ID" --protocol tcp --port 80   --cidr 0.0.0.0/0 >/dev/null
    awsx ec2 authorize-security-group-ingress --group-id "$SG_ID" --protocol tcp --port 8080 --cidr 0.0.0.0/0 >/dev/null
fi
state_set SG_ID "$SG_ID"
echo "$SG_ID"

echo "== 3/5 Imagen (Ubuntu Server 22.04 LTS)"
AMI_ID=$(awsx ec2 describe-images --query 'Images[0].ImageId' --output text)
echo "$AMI_ID"

echo "== 4/5 Instancia $INSTANCE_TYPE con disco gp3 de ${VOLUME_GB} GB (se borra al terminar la instancia)"
INSTANCE_ID=$(state_get INSTANCE_ID)
if [ -z "$INSTANCE_ID" ]; then
    INSTANCE_ID=$(awsx ec2 run-instances --image-id "$AMI_ID" --instance-type "$INSTANCE_TYPE" --count 1 \
        --key-name "$KEY_NAME" --security-group-ids "$SG_ID" \
        --block-device-mappings "DeviceName=/dev/sda1,Ebs={VolumeSize=$VOLUME_GB,VolumeType=gp3,DeleteOnTermination=true}" \
        --user-data "$(cat "$AWS_DIR/userdata.sh")" \
        --tag-specifications "ResourceType=instance,Tags=[{Key=Name,Value=$PROJECT_NAME-backend}]" \
        --query 'Instances[0].InstanceId' --output text)
fi
state_set INSTANCE_ID "$INSTANCE_ID"
awsx ec2 wait instance-running --instance-ids "$INSTANCE_ID"
IP=$(awsx ec2 describe-instances --instance-ids "$INSTANCE_ID" --query 'Reservations[0].Instances[0].[PublicIpAddress,PrivateIpAddress][0]' --output text)
[ "$IP" == "None" ] && IP=$(awsx ec2 describe-instances --instance-ids "$INSTANCE_ID" --query 'Reservations[0].Instances[0].PrivateIpAddress' --output text)
state_set INSTANCE_IP "$IP"
echo "$INSTANCE_ID  ($IP)"

echo "== 5/5 Bucket S3 de artefactos (con versionado)"
ACCOUNT=$(awsx sts get-caller-identity --query Account --output text)
BUCKET="${ARTIFACT_BUCKET:-$PROJECT_NAME-artifacts-$ACCOUNT}"
awsx s3api head-bucket --bucket "$BUCKET" >/dev/null 2>&1 || awsx s3 mb "s3://$BUCKET" >/dev/null
awsx s3api put-bucket-versioning --bucket "$BUCKET" --versioning-configuration Status=Enabled
state_set ARTIFACT_BUCKET "$BUCKET"
echo "$BUCKET"

echo
echo "Listo. Para desplegar:"
echo "  bash scripts/mkpackage.sh"
echo "  ARTIFACT_BUCKET=$BUCKET SERVER_IP=$IP KEY_PATH=$KEY_FILE bash scripts/deploy.sh"
