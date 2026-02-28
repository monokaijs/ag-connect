#!/bin/bash
set -e

export DISPLAY=:99

rm -f /tmp/.X99-lock /tmp/.X11-unix/X99 2>/dev/null || true
mkdir -p /tmp/.X11-unix 2>/dev/null || true
Xvfb :99 -screen 0 1920x1080x24 -ac +extension GLX +render -noreset &
XVFB_PID=$!

sleep 2

if ! xdpyinfo -display :99 > /dev/null 2>&1; then
  echo "[entrypoint] ERROR: Xvfb failed to start"
  exit 1
fi
echo "[entrypoint] Xvfb started on display :99"

dbus-daemon --session --fork --address="unix:path=/tmp/dbus-session" 2>/dev/null || true
export DBUS_SESSION_BUS_ADDRESS="unix:path=/tmp/dbus-session"

FOLDER_URI="file://${WORKSPACE_FOLDER:-/workspace}"

echo "[entrypoint] Starting Antigravity IDE with remote debugging on port 9222..."
echo "[entrypoint] Opening folder: $FOLDER_URI"
antigravity \
  --no-sandbox \
  --disable-gpu \
  --disable-dev-shm-usage \
  --wait \
  --remote-debugging-port=9222 \
  --folder-uri="$FOLDER_URI" \
  &
AG_PID=$!

for i in $(seq 1 60); do
  sleep 1
  if ! kill -0 $AG_PID 2>/dev/null; then
    echo "[entrypoint] ERROR: Antigravity exited prematurely"
    exit 1
  fi
  if curl -s http://localhost:9222/json/version > /dev/null 2>&1; then
    echo "[entrypoint] Antigravity IDE ready (PID: $AG_PID)"
    break
  fi
done

socat TCP-LISTEN:9223,fork,reuseaddr,bind=0.0.0.0 TCP:127.0.0.1:9222 &
SOCAT_PID=$!
echo "[entrypoint] socat forwarding 0.0.0.0:9223 -> 127.0.0.1:9222"

echo "[entrypoint] All services running."
echo "[entrypoint]   - Antigravity IDE debug port: 9222 (external: 9223)"

cleanup() {
  echo "[entrypoint] Shutting down..."
  kill $SOCAT_PID 2>/dev/null || true
  kill $AG_PID 2>/dev/null || true
  kill $XVFB_PID 2>/dev/null || true
  exit 0
}

trap cleanup SIGTERM SIGINT

while true; do
  if ! kill -0 $AG_PID 2>/dev/null; then
    echo "[entrypoint] Antigravity exited"
    cleanup
  fi
  sleep 5
done

