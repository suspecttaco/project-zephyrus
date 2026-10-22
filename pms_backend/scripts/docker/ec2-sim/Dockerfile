# Servidor que hace de instancia EC2 (Ubuntu 22.04) para probar el despliegue sin AWS:
FROM ubuntu:22.04

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update \
    && apt-get install -y --no-install-recommends openssh-server curl ca-certificates gnupg tar \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && npm install -g pm2 \
    && rm -rf /var/lib/apt/lists/*

RUN (id ubuntu >/dev/null 2>&1 || useradd -m -s /bin/bash ubuntu) \
    && usermod -p '*' ubuntu \
    && mkdir -p /run/sshd /home/ubuntu/pms-backend \
    && chown -R ubuntu:ubuntu /home/ubuntu \
    && echo "PasswordAuthentication no" >> /etc/ssh/sshd_config

RUN printf '%s\n' \
    '#!/bin/sh' \
    'set -e' \
    'mkdir -p /home/ubuntu/.ssh' \
    'cp /tmp/authorized_key.pub /home/ubuntu/.ssh/authorized_keys' \
    'chown -R ubuntu:ubuntu /home/ubuntu/.ssh' \
    'chmod 700 /home/ubuntu/.ssh' \
    'chmod 600 /home/ubuntu/.ssh/authorized_keys' \
    'exec /usr/sbin/sshd -D -e' \
    > /entrypoint.sh \
    && chmod +x /entrypoint.sh

EXPOSE 22 8080
ENTRYPOINT ["/entrypoint.sh"]
