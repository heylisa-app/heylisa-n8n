FROM n8nio/n8n:latest-debian

USER root

# --- Fix Debian Buster EOL repos (deb.debian.org -> archive.debian.org) ---
RUN set -eux; \
  sed -i 's|http://deb.debian.org/debian|http://archive.debian.org/debian|g' /etc/apt/sources.list; \
  sed -i 's|http://security.debian.org/debian-security|http://archive.debian.org/debian-security|g' /etc/apt/sources.list || true; \
  echo 'Acquire::Check-Valid-Until "false";' > /etc/apt/apt.conf.d/99no-check-valid-until; \
  apt-get -o Acquire::Check-Valid-Until=false update; \
  apt-get install -y --no-install-recommends \
    poppler-utils \
    tesseract-ocr \
    tesseract-ocr-fra \
    tesseract-ocr-eng; \
  rm -rf /var/lib/apt/lists/*

# Ensure the n8n user folder exists and is writable (Railway volume will mount here)
RUN mkdir -p /home/node/.n8n && chown -R node:node /home/node/.n8n

COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

ENTRYPOINT ["/docker-entrypoint.sh"]
