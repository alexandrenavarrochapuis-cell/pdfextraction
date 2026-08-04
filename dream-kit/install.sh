#!/usr/bin/env bash
# install.sh — install the dream memory-consolidation skill.
#
#   bash install.sh                      skill only, no automation
#   bash install.sh --auto               skill + Stop hook + CLAUDE.md section
#   bash install.sh --auto --schedule    also add a daily timer (see schedule.sh)
#   bash install.sh --auto --schedule --at 22:30
#
# Idempotent. Preserves existing hooks. Never touches project source.

set -euo pipefail

KIT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLAUDE_DIR="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
SKILL_DIR="$CLAUDE_DIR/skills/dream"
SETTINGS="$CLAUDE_DIR/settings.json"
CLAUDE_MD="$CLAUDE_DIR/CLAUDE.md"
AUTO=0
SCHEDULE=0
AT=""

while [ $# -gt 0 ]; do
  case "$1" in
    --auto) AUTO=1; shift ;;
    --schedule) SCHEDULE=1; shift ;;
    --at) AT="${2:-}"; shift 2 ;;
    -h|--help) sed -n '2,9p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done

# --- 1. skill ----------------------------------------------------------------
mkdir -p "$SKILL_DIR"
cp "$KIT_DIR/skills/dream/SKILL.md" "$SKILL_DIR/SKILL.md"
cp "$KIT_DIR/skills/dream/should-dream.sh" "$SKILL_DIR/should-dream.sh"
chmod +x "$SKILL_DIR/should-dream.sh"
echo "installed skill  -> $SKILL_DIR"

maybe_schedule() {
  [ "$SCHEDULE" -eq 1 ] || return 0
  echo
  if [ -n "$AT" ]; then
    bash "$KIT_DIR/schedule.sh" --at "$AT"
  else
    bash "$KIT_DIR/schedule.sh"
  fi
}

if [ "$AUTO" -eq 0 ]; then
  echo "skill only. re-run with --auto to arm the Stop hook."
  maybe_schedule
  exit 0
fi

# --- 2. Stop hook ------------------------------------------------------------
[ -f "$SETTINGS" ] || echo '{}' > "$SETTINGS"

SETTINGS="$SETTINGS" python3 - <<'PY'
import json, os, sys

path = os.environ["SETTINGS"]
cmd = ('bash $HOME/.claude/skills/dream/should-dream.sh '
       '&& touch $HOME/.claude/.dream-pending || true')

try:
    with open(path) as fh:
        settings = json.load(fh)
except (json.JSONDecodeError, ValueError):
    sys.exit("settings.json is not valid JSON; refusing to overwrite it")
if not isinstance(settings, dict):
    sys.exit("settings.json is not a JSON object; refusing to overwrite it")

hooks = settings.setdefault("hooks", {})
stop = hooks.setdefault("Stop", [])

def mentions_dream(entry):
    if not isinstance(entry, dict):
        return False
    if "should-dream.sh" in str(entry.get("command", "")):
        return True
    return any("should-dream.sh" in str(h.get("command", ""))
               for h in entry.get("hooks", []) if isinstance(h, dict))

if any(mentions_dream(e) for e in stop):
    print("Stop hook   -> already present, left alone")
else:
    stop.append({"matcher": "", "hooks": [{"type": "command", "command": cmd}]})
    with open(path, "w") as fh:
        json.dump(settings, fh, indent=2)
        fh.write("\n")
    print("Stop hook   -> added to", path)
PY

# --- 3. CLAUDE.md ------------------------------------------------------------
touch "$CLAUDE_MD"
if grep -q '^## Auto Dream' "$CLAUDE_MD"; then
  echo "CLAUDE.md   -> section already present, left alone"
else
  cat >> "$CLAUDE_MD" <<'MD'

## Auto Dream

If `~/.claude/.dream-pending` exists at the start of a session:

1. Run the `dream` skill as a background subagent.
2. Delete the flag file.
3. Report only the skill's summary block — nothing else.

Do not interrupt or delay whatever the user is currently working on. If the
dream is still running when the user's task finishes, report it when it lands.
MD
  echo "CLAUDE.md   -> Auto Dream section appended"
fi

# --- 4. optional daily timer -------------------------------------------------
maybe_schedule

echo
echo "armed. check with:  bash $SKILL_DIR/should-dream.sh; echo due=\$?"
