FROM n8nio/n8n:latest

USER root

# Ensure the n8n user folder exists and is writable (Railway volume will mount here)
RUN mkdir -p /home/node/.n8n && chown -R node:node /home/node

COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

ENTRYPOINT ["/docker-entrypoint.sh"]
