FROM n8nio/n8n:latest

USER root

# Install PDF tools + OCR (works on both Alpine and Debian-based images)
RUN set -eux; \
  if [ -f /etc/alpine-release ]; then \
    apk add --no-cache poppler-utils tesseract-ocr tesseract-ocr-data-fra tesseract-ocr-data-eng; \
  else \
    apt-get update; \
    apt-get install -y --no-install-recommends poppler-utils tesseract-ocr; \
    rm -rf /var/lib/apt/lists/*; \
  fi

# Keep your existing Railway volume permissions logic
RUN mkdir -p /home/node/.n8n && chown -R node:node /home/node/.n8n

COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

ENTRYPOINT ["/docker-entrypoint.sh"]
