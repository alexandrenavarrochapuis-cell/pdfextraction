#!/usr/bin/env bash
# install.sh — install the dream memory-consolidation skill.
#
#   bash install.sh          skill only, no automation
#   bash install.sh --auto   skill + Stop hook + CLAUDE.md section
#
# Idempotent. Preserves existing hooks. Never touches project source.

set -euo pipefail

KIT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLAUDE_DIR="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
SKILL_DIR="$CLAUDE_DIR/skills/dream"
SETTINGS="$CLAUDE_DIR/settings.json"
CLAUDE_MD="$CLAUDE_DIR/CLAUDE.md"
AUTO=0

for arg in "$@"; do
  case "$arg" in
    --auto) AUTO=1 ;;
    -h|--help) sed -n '2,8p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) echo "unknown option: $arg" >&2; exit 2 ;;
  esac
done

# --- 1. skill ----------------------------------------------------------------
mkdir -p "$SKILL_DIR"
cp "$KIT_DIR/skills/dream/SKILL.md" "$SKILL_DIR/SKILL.md"
cp "$KIT_DIR/skills/dream/should-dream.sh" "$SKILL_DIR/should-dream.sh"
chmod +x "$SKILL_DIR/should-dream.sh"
echo "installed skill  -> $SKILL_DIR"

if [ "$AUTO" -eq 0 ]; then
  echo "skill only. re-run with --auto to arm the Stop hook."
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

echo
echo "armed. check with:  bash $SKILL_DIR/should-dream.sh; echo due=\$?"
