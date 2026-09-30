#!/usr/bin/env bash
# Starts the inference service and the API in one container, and makes the
# container exit if either one dies so the platform restarts it.
set -euo pipefail

echo "[start] applying database migrations"
node server/dist/db/cli.js migrate

echo "[start] seeding reference data (idempotent)"
node server/dist/db/cli.js seed

echo "[start] launching inference service on ${ML_HOST:-127.0.0.1}:${ML_PORT:-8001}"
python3 ml/serve.py &
ML_PID=$!

# Give the model a moment to load so the first request does not see a 503.
for _ in $(seq 1 30); do
  if node -e "fetch('http://${ML_HOST:-127.0.0.1}:${ML_PORT:-8001}/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" 2>/dev/null; then
    echo "[start] inference service ready"
    break
  fi
  sleep 1
done

echo "[start] launching API on 0.0.0.0:${PORT:-4000}"
node server/dist/index.js &
API_PID=$!

# If either process exits, stop the other and let the platform restart us.
wait -n "$ML_PID" "$API_PID"
EXIT=$?
echo "[start] a process exited with ${EXIT}; shutting down"
kill "$ML_PID" "$API_PID" 2>/dev/null || true
exit "$EXIT"
