#!/usr/bin/env bash
# schedule.sh — run the dream due-check on a daily timer.
#
#   bash schedule.sh                 daily at 09:00
#   bash schedule.sh --at 22:30      daily at 22:30
#   bash schedule.sh --uninstall     remove the timer
#
# The timer does not run a dream. It runs should-dream.sh and, if a dream is
# due, sets ~/.claude/.dream-pending — the same flag the Stop hook sets. The
# next session picks it up via the Auto Dream section in CLAUDE.md.
#
# The Stop hook only fires when a session ends. This covers the days you leave
# sessions open. Both are safe to have; the flag is idempotent.
#
# Backends, in order of preference: launchd (macOS), systemd user timer
# (Linux), crontab (fallback).

set -euo pipefail

LABEL="ai.claude.dream"
CLAUDE_DIR="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
CHECK="$CLAUDE_DIR/skills/dream/should-dream.sh"
CMD="bash \"$CHECK\" && touch \"$CLAUDE_DIR/.dream-pending\""
AT="09:00"
UNINSTALL=0

while [ $# -gt 0 ]; do
  case "$1" in
    --at) AT="${2:-}"; shift 2 ;;
    --uninstall) UNINSTALL=1; shift ;;
    -h|--help) sed -n '2,9p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done

case "$AT" in
  [0-2][0-9]:[0-5][0-9]) ;;
  *) echo "--at wants HH:MM (24h), got: $AT" >&2; exit 2 ;;
esac
HOUR=${AT%%:*}
MIN=${AT##*:}
HOUR=$((10#$HOUR)); MIN=$((10#$MIN))
[ "$HOUR" -le 23 ] || { echo "--at hour out of range: $AT" >&2; exit 2; }

if [ "$UNINSTALL" -eq 0 ] && [ ! -x "$CHECK" ]; then
  echo "not found or not executable: $CHECK" >&2
  echo "run install.sh first." >&2
  exit 1
fi

# --- launchd (macOS) ---------------------------------------------------------
install_launchd() {
  local plist="$HOME/Library/LaunchAgents/$LABEL.plist"
  mkdir -p "$(dirname "$plist")"
  # & < > are not legal raw in XML character data; the command contains "&&".
  local cmd_xml=${CMD//&/&amp;}
  cmd_xml=${cmd_xml//</&lt;}
  cmd_xml=${cmd_xml//>/&gt;}
  cat > "$plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>-lc</string>
    <string>$cmd_xml</string>
  </array>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Hour</key><integer>$HOUR</integer>
    <key>Minute</key><integer>$MIN</integer>
  </dict>
  <key>RunAtLoad</key><false/>
</dict>
</plist>
PLIST
  launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
  launchctl bootstrap "gui/$(id -u)" "$plist" 2>/dev/null \
    || launchctl load -w "$plist"
  echo "scheduled via launchd, daily at $AT"
  echo "  plist: $plist"
}

uninstall_launchd() {
  local plist="$HOME/Library/LaunchAgents/$LABEL.plist"
  launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null \
    || launchctl unload -w "$plist" 2>/dev/null || true
  rm -f "$plist"
  echo "launchd job removed"
}

# --- systemd user timer (Linux) ---------------------------------------------
install_systemd() {
  local unit_dir="$HOME/.config/systemd/user"
  mkdir -p "$unit_dir"
  cat > "$unit_dir/dream-check.service" <<UNIT
[Unit]
Description=Claude dream due-check

[Service]
Type=oneshot
ExecStart=/bin/bash -lc '$CMD'
UNIT
  cat > "$unit_dir/dream-check.timer" <<UNIT
[Unit]
Description=Daily Claude dream due-check

[Timer]
OnCalendar=*-*-* $(printf '%02d:%02d' "$HOUR" "$MIN"):00
Persistent=true

[Install]
WantedBy=timers.target
UNIT
  systemctl --user daemon-reload
  systemctl --user enable --now dream-check.timer
  echo "scheduled via systemd user timer, daily at $AT"
  echo "  units: $unit_dir/dream-check.{service,timer}"
  echo "  check: systemctl --user list-timers dream-check.timer"
}

uninstall_systemd() {
  systemctl --user disable --now dream-check.timer 2>/dev/null || true
  rm -f "$HOME/.config/systemd/user/dream-check.timer" \
        "$HOME/.config/systemd/user/dream-check.service"
  systemctl --user daemon-reload 2>/dev/null || true
  echo "systemd timer removed"
}

# --- crontab (fallback) ------------------------------------------------------
install_cron() {
  local marker="# claude-dream"
  local line="$MIN $HOUR * * * $CMD $marker"
  { crontab -l 2>/dev/null | grep -v "$marker" || true; echo "$line"; } | crontab -
  echo "scheduled via crontab, daily at $AT"
  echo "  check: crontab -l | grep claude-dream"
}

uninstall_cron() {
  local marker="# claude-dream"
  if crontab -l >/dev/null 2>&1; then
    crontab -l 2>/dev/null | grep -v "$marker" | crontab - || true
  fi
  echo "crontab entry removed"
}

# --- pick a backend ----------------------------------------------------------
have_systemd_user() {
  command -v systemctl >/dev/null 2>&1 && systemctl --user show-environment >/dev/null 2>&1
}

if [ "$(uname -s)" = "Darwin" ] && command -v launchctl >/dev/null 2>&1; then
  BACKEND=launchd
elif have_systemd_user; then
  BACKEND=systemd
elif command -v crontab >/dev/null 2>&1; then
  BACKEND=cron
else
  echo "no supported scheduler found (launchd, systemd --user, or crontab)" >&2
  exit 1
fi

if [ "$UNINSTALL" -eq 1 ]; then
  "uninstall_$BACKEND"
else
  "install_$BACKEND"
  echo
  echo "the timer only sets the flag. the next session runs the dream."
fi
