# Production image: builds the app once, then serves it with `vite preview`,
# which mounts the same data proxies plus the Ohjiya X account routes.
# (The upstream Dockerfile runs the dev server and bind-mounts the source.)
FROM node:24.14.0-slim@sha256:d8e448a56fc63242f70026718378bd4b00f8c82e78d20eefb199224a4d8e33d8

ENV PUPPETEER_SKIP_DOWNLOAD=1
WORKDIR /app
RUN chown node:node /app
USER node

COPY --chown=node:node package.json package-lock.json ./
RUN npm ci
COPY --chown=node:node . .
RUN npm run build

# Runtime state: cache, session ledger and entitlement cache (a mounted volume).
RUN mkdir -p /app/.gev-cache /app/.gev-logs

ENV HOST=0.0.0.0
ENV PORT=4173
EXPOSE 4173
CMD ["npx", "vite", "preview", "--host", "0.0.0.0", "--port", "4173", "--strictPort"]
