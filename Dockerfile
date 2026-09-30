# ---------------------------------------------------------------------------
# Single image running both processes:
#   - the Fastify API + static frontend, on $PORT (public)
#   - the Python inference service, on 127.0.0.1:8001 (never exposed)
#
# Keeping them in one container preserves the security property from
# SECURITY.md — the model service has no authentication of its own and is safe
# only because nothing outside the host can reach it.
# ---------------------------------------------------------------------------
FROM node:20-bookworm-slim

# python3-venv because Debian bookworm marks the system Python
# externally-managed (PEP 668) and refuses system-wide pip installs.
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 python3-venv ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# --- Python dependencies (own layer so Node changes do not rebuild them) ----
COPY ml/requirements.txt ./ml/requirements.txt
RUN python3 -m venv /opt/venv \
 && /opt/venv/bin/pip install --no-cache-dir --upgrade pip \
 && /opt/venv/bin/pip install --no-cache-dir -r ml/requirements.txt
ENV PATH="/opt/venv/bin:$PATH"

# --- Node dependencies ------------------------------------------------------
COPY package.json package-lock.json ./
COPY server/package.json ./server/package.json
# Dev dependencies are needed to compile TypeScript; the build is pruned below.
RUN npm ci

# --- Application ------------------------------------------------------------
COPY . .
RUN npm run build && npm prune --omit=dev

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    ML_HOST=127.0.0.1 \
    ML_PORT=8001 \
    ML_SERVICE_URL=http://127.0.0.1:8001

# Render overrides this with its own $PORT.
ENV PORT=4000
EXPOSE 4000

CMD ["./scripts/start.sh"]
