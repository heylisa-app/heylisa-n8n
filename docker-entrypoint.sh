#!/bin/sh
set -e

mkdir -p /home/node/.n8n
chown -R node:node /home/node/.n8n || true

exec su node -s /bin/sh -c "n8n"
