FROM n8nio/n8n:latest-debian

USER root

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    poppler-utils \
    tesseract-ocr \
    tesseract-ocr-fra \
    tesseract-ocr-eng \
  && rm -rf /var/lib/apt/lists/*

# Ensure the n8n user folder exists and is writable (Railway volume will mount here)
RUN mkdir -p /home/node/.n8n && chown -R node:node /home/node/.n8n

COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

ENTRYPOINT ["/docker-entrypoint.sh"]
