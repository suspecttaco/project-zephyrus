#!/bin/bash

AWS_REGION="${AWS_REGION:-us-east-1}"
PROJECT_NAME="${PROJECT_NAME:-pms}"
LOCALSTACK_CONTAINER="${LOCALSTACK_CONTAINER:-pms-localstack}"
AWS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STATE_FILE="$AWS_DIR/.state"

awsx() {
    if command -v awslocal >/dev/null; then
        awslocal --region "$AWS_REGION" "$@"
    else
        local engine; engine=$(command -v podman || command -v docker)
        "$engine" exec -i "$LOCALSTACK_CONTAINER" awslocal --region "$AWS_REGION" "$@"
    fi
}

s3_put() {
    if command -v awslocal >/dev/null; then
        awsx s3 cp "$1" "s3://$2/$3"
    else
        awsx s3 cp - "s3://$2/$3" < "$1"
    fi
}

state_get() { [ -f "$STATE_FILE" ] && grep "^$1=" "$STATE_FILE" | tail -1 | cut -d= -f2- || true; }
state_set() { touch "$STATE_FILE"; grep -v "^$1=" "$STATE_FILE" > "$STATE_FILE.tmp" || true; echo "$1=$2" >> "$STATE_FILE.tmp"; mv "$STATE_FILE.tmp" "$STATE_FILE"; }
