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

EXT_DIR="/home/aguser/.antigravity/extensions"
if [ -d "/app/extensions/ag-connect-helper" ]; then
  mkdir -p "$EXT_DIR/ag-connect-helper"
  cp /app/extensions/ag-connect-helper/* "$EXT_DIR/ag-connect-helper/"
  cat > "$EXT_DIR/extensions.json" << 'EXTJSON'
[{"identifier":{"id":"ag-connect.ag-connect-helper"},"version":"0.0.1","location":{"$mid":1,"path":"/home/aguser/.antigravity/extensions/ag-connect-helper","scheme":"file"},"relativeLocation":"ag-connect-helper","metadata":{"installedTimestamp":0}}]
EXTJSON
  echo "[entrypoint] Installed ag-connect-helper extension"
fi

if [ ! -f /home/aguser/.config/Antigravity/workspace-initialized ]; then
  mkdir -p /home/aguser/.config/Antigravity
  touch /home/aguser/.config/Antigravity/workspace-initialized
  FOLDER_ARGS="--folder-uri=$FOLDER_URI"
else
  FOLDER_ARGS=""
fi

echo "[entrypoint] Starting Antigravity IDE with remote debugging on port 9222..."
if [ -n "$FOLDER_ARGS" ]; then
  echo "[entrypoint] Opening initial folder: $FOLDER_URI"
fi

antigravity \
  --no-sandbox \
  --disable-gpu \
  --disable-dev-shm-usage \
  --wait \
  --remote-debugging-port=9222 \
  $FOLDER_ARGS \
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
    echo "[entrypoint] Antigravity exited, restarting..."
    sleep 2
    FOLDER_URI="file://${WORKSPACE_FOLDER:-/workspace}"
    antigravity \
      --no-sandbox \
      --disable-gpu \
      --disable-dev-shm-usage \
      --wait \
      --remote-debugging-port=9222 \
      &
    AG_PID=$!
    for i in $(seq 1 60); do
      sleep 1
      if ! kill -0 $AG_PID 2>/dev/null; then
        echo "[entrypoint] ERROR: Antigravity restart failed"
        break
      fi
      if curl -s http://localhost:9222/json/version > /dev/null 2>&1; then
        echo "[entrypoint] Antigravity IDE restarted (PID: $AG_PID)"
        break
      fi
    done
  fi
  sleep 5
done

