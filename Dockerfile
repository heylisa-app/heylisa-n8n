FROM node:22.23.4-alpine AS ops01-cli
WORKDIR /opt/ops01-cli
COPY sentinel/package.json sentinel/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts \
    && mkdir -p bin \
    && node -e 'require("fs").copyFileSync("node_modules/@vercel/vc-native-linux-"+process.arch+"-musl/bin/vercel","bin/vercel")' \
    && chmod 755 bin/vercel && bin/vercel --version

FROM n8nio/n8n:2.42.5

USER root

COPY --from=ops01-cli /opt/ops01-cli/bin/vercel /opt/ops01-cli/bin/vercel
COPY --from=ops01-cli /usr/local/bin/node /opt/ops01-node/bin/node
COPY sentinel /opt/ops01
ENV N8N_CUSTOM_EXTENSIONS=/opt/ops01/nodes
# Keep generic shell and file-trigger execution disabled. The custom node has a
# fixed executable and checks the immutable calling workflow ID before credentials.
ENV NODES_EXCLUDE='["n8n-nodes-base.executeCommand","n8n-nodes-base.localFileTrigger"]'
RUN mkdir -p /tmp/ops01-cli && chown node:node /tmp/ops01-cli

# Ensure the n8n user folder exists and is writable (Railway volume will mount here)
RUN mkdir -p /home/node/.n8n && chown -R node:node /home/node

COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

ENTRYPOINT ["/docker-entrypoint.sh"]
