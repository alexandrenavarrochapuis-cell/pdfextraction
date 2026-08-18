#!/usr/bin/env bash
# install.sh — run Orca as an always-on headless server (`orca serve`) on Linux.
#
#   sudo bash install.sh --pairing-address 100.64.1.20
#   sudo bash install.sh --pairing-address orca.example.com --port 6768
#   sudo bash install.sh --pairing-address 100.64.1.20 --no-skills
#   sudo bash install.sh --uninstall
#
# Idempotent: re-running upgrades the AppImage in place, keeps one rollback
# copy, and restarts the service. Never touches your repos or your own $HOME.

set -euo pipefail

PORT=6768
ADDR=""
SKILLS=1
UNINSTALL=0
INSTALL_DIR=/opt/orca
SERVICE_USER=orca
SERVICE_HOME=/home/orca
UNIT=/etc/systemd/system/orca-serve.service
APPIMAGE_URL="https://github.com/stablyai/orca/releases/latest/download/orca-linux.AppImage"

while [ $# -gt 0 ]; do
  case "$1" in
    --pairing-address) ADDR="${2:-}"; shift 2 ;;
    --port) PORT="${2:-}"; shift 2 ;;
    --no-skills) SKILLS=0; shift ;;
    --uninstall) UNINSTALL=1; shift ;;
    -h|--help) sed -n '2,10p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done

[ "$(id -u)" -eq 0 ] || { echo "run me with sudo" >&2; exit 1; }

# --- uninstall ---------------------------------------------------------------
if [ "$UNINSTALL" -eq 1 ]; then
  systemctl stop orca-serve.service 2>/dev/null || true
  systemctl disable orca-serve.service 2>/dev/null || true
  rm -f "$UNIT"
  systemctl daemon-reload
  systemctl reset-failed orca-serve.service 2>/dev/null || true
  rm -rf "$INSTALL_DIR"
  echo "service and $INSTALL_DIR removed."
  echo "the '$SERVICE_USER' user and $SERVICE_HOME were left alone (agent state lives there)."
  echo "remove them too with:  sudo userdel -r $SERVICE_USER"
  exit 0
fi

# --- 0. validate -------------------------------------------------------------
if [ -z "$ADDR" ]; then
  cat >&2 <<'MSG'
--pairing-address is required.

It is the address your phone and desktop will use to reach this server. Orca
advertises it to clients; it does not change the bind address (which stays
0.0.0.0). Without it the server advertises 127.0.0.1 and nothing external can
pair with it.

Use a Tailscale IP (safest), a LAN IP, or a public hostname:

  sudo bash install.sh --pairing-address 100.64.1.20
  sudo bash install.sh --pairing-address orca.example.com
  sudo bash install.sh --pairing-address https://orca.example.com/runtime
MSG
  exit 2
fi

case "$ADDR" in
  '*'|0.0.0.0|::|'[::]') echo "wildcard addresses cannot be advertised: $ADDR" >&2; exit 2 ;;
esac

case "$PORT" in
  ''|*[!0-9]*) echo "--port must be a number: $PORT" >&2; exit 2 ;;
esac

# --- 1. prerequisites --------------------------------------------------------
echo "==> installing prerequisites"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq curl file jq xvfb zlib1g-dev >/dev/null
command -v Xvfb >/dev/null || { echo "Xvfb missing after install" >&2; exit 1; }
XVFB_PATH="$(command -v Xvfb)"
echo "    Xvfb -> $XVFB_PATH"

# --- 2. service user ---------------------------------------------------------
if ! id "$SERVICE_USER" >/dev/null 2>&1; then
  useradd --system --create-home --home-dir "$SERVICE_HOME" --shell /usr/sbin/nologin "$SERVICE_USER"
  echo "==> created service user '$SERVICE_USER'"
else
  echo "==> service user '$SERVICE_USER' already exists"
fi
install -d -o "$SERVICE_USER" -g "$SERVICE_USER" -m 755 "$SERVICE_HOME"

# --- 3. AppImage -------------------------------------------------------------
# Kept root-owned on purpose: the service must read and execute it, but must
# not be able to replace it.
echo "==> downloading Orca"
install -d -o root -g root -m 755 "$INSTALL_DIR"
TMP_IMG="$INSTALL_DIR/.orca-linux.AppImage.download"
curl -fsSL "$APPIMAGE_URL" -o "$TMP_IMG"
file "$TMP_IMG" | grep -qi "executable" || { echo "downloaded file is not an executable" >&2; rm -f "$TMP_IMG"; exit 1; }

if systemctl is-active --quiet orca-serve.service 2>/dev/null; then
  systemctl stop orca-serve.service
fi

if [ -f "$INSTALL_DIR/orca-linux.AppImage" ]; then
  mv -f "$INSTALL_DIR/orca-linux.AppImage" "$INSTALL_DIR/orca-linux.AppImage.prev"
  echo "    previous build kept at $INSTALL_DIR/orca-linux.AppImage.prev"
fi
mv -f "$TMP_IMG" "$INSTALL_DIR/orca-linux.AppImage"
chown root:root "$INSTALL_DIR/orca-linux.AppImage"
chmod 755 "$INSTALL_DIR/orca-linux.AppImage"

# Extract rather than rely on FUSE: containers and many VPS images have no
# /dev/fuse, and extracting once keeps the service's stdout to the ready line.
echo "==> extracting (no FUSE required)"
rm -rf "$INSTALL_DIR/squashfs-root"
( cd "$INSTALL_DIR" && ./orca-linux.AppImage --appimage-extract >/dev/null )
chmod -R a+rX "$INSTALL_DIR/squashfs-root"
APPRUN="$INSTALL_DIR/squashfs-root/AppRun"
[ -x "$APPRUN" ] || { echo "extraction did not produce $APPRUN" >&2; exit 1; }

# --- 4. systemd unit ---------------------------------------------------------
echo "==> writing $UNIT"
cat > "$UNIT" <<UNIT_EOF
[Unit]
Description=Orca runtime server
After=network-online.target
Wants=network-online.target
StartLimitIntervalSec=300
StartLimitBurst=5

[Service]
Type=simple
User=$SERVICE_USER
WorkingDirectory=$SERVICE_HOME
Environment=HOME=$SERVICE_HOME
Environment=LIBGL_ALWAYS_SOFTWARE=1
Environment=PATH=$SERVICE_HOME/.local/bin:/usr/local/bin:/usr/bin:/bin
ExecStart=$APPRUN serve --port $PORT --pairing-address $ADDR --json
StandardOutput=journal
StandardError=journal
KillMode=mixed
Restart=on-failure
RestartPreventExitStatus=3
RestartSec=5

[Install]
WantedBy=multi-user.target
UNIT_EOF

systemctl daemon-reload
systemctl reset-failed orca-serve.service 2>/dev/null || true
systemctl enable --quiet orca-serve.service
systemctl start orca-serve.service

# --- 5. wait for ready -------------------------------------------------------
echo "==> waiting for the runtime to come up"
READY=""
for _ in $(seq 1 60); do
  READY="$(journalctl -u orca-serve.service --since '-2 min' --output cat 2>/dev/null \
            | grep -F 'orca_server_ready' | tail -1 || true)"
  [ -n "$READY" ] && break
  systemctl is-active --quiet orca-serve.service || break
  sleep 2
done

if [ -z "$READY" ]; then
  echo
  echo "the server did not report ready. what the journal says:" >&2
  journalctl -u orca-serve.service -n 30 --no-pager >&2
  exit 1
fi

PAIR_URL="$(printf '%s' "$READY" | jq -r '.pairing.url // empty' 2>/dev/null || true)"
PAIR_OK="$(printf '%s' "$READY" | jq -r '.pairing.available // empty' 2>/dev/null || true)"
ADVERTISED="$(printf '%s' "$READY" | jq -r '.advertisedEndpoint // empty' 2>/dev/null || true)"

# --- 6. agent skills ---------------------------------------------------------
if [ "$SKILLS" -eq 1 ]; then
  echo "==> installing Orca's agent skills on this host"
  if sudo -u "$SERVICE_USER" env HOME="$SERVICE_HOME" \
        PATH="$SERVICE_HOME/.local/bin:/usr/local/bin:/usr/bin:/bin" \
        sh -c 'command -v npx >/dev/null'; then
    sudo -u "$SERVICE_USER" env HOME="$SERVICE_HOME" \
      PATH="$SERVICE_HOME/.local/bin:/usr/local/bin:/usr/bin:/bin" \
      orca-ide skills install --skill orca-cli --skill orchestration \
        --agent claude-code,gemini-cli,grok,universal || \
      echo "    skills install failed; run it yourself later (see README)"
  else
    echo "    node/npx not found for '$SERVICE_USER' — skipped."
    echo "    install Node, then:  sudo -u $SERVICE_USER -H $SERVICE_HOME/.local/bin/orca-ide skills install --skill orca-cli --skill orchestration --agent claude-code,gemini-cli,grok,universal"
  fi
fi

# --- done --------------------------------------------------------------------
cat <<DONE

Orca server is up.

  advertised   ${ADVERTISED:-ws://$ADDR:$PORT}
  service      systemctl status orca-serve
  logs         journalctl -u orca-serve -f

DONE

if [ "$PAIR_OK" = "true" ] && [ -n "$PAIR_URL" ]; then
  cat <<DONE
Pair a device with this URL (it is a single-use secret — treat it like a password):

$PAIR_URL

Open it on the phone that has the Orca app, or paste it into Orca desktop.
A fresh one is printed on every restart:

  sudo systemctl restart orca-serve && journalctl -u orca-serve --since '-1 min' -o cat | grep orca_server_ready | tail -1 | jq -r .pairing.url

DONE
else
  echo "The server is running but could not mint a pairing offer. Reason:"
  printf '%s' "$READY" | jq '.pairing' 2>/dev/null || printf '%s\n' "$READY"
fi

echo "Make sure port $PORT is reachable from your phone (Tailscale, or a firewall rule)."
