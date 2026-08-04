#!/usr/bin/env bash
# should-dream.sh — is a memory consolidation due?
#
# exit 0 : due
# exit 1 : not due
#
# Due means:
#   - 24+ hours since the newest .last-dream across ~/.claude/projects/*/memory/
#     AND 5 or more session transcripts modified since then; or
#   - no .last-dream exists anywhere but at least one MEMORY.md does.
#
# Never errors on missing paths. Never writes anything.

set -o pipefail
shopt -s nullglob 2>/dev/null || true

CLAUDE_DIR="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
PROJECTS_DIR="$CLAUDE_DIR/projects"
MIN_AGE_SECONDS=86400
MIN_SESSIONS=5

mtime_of() {
  stat -c %Y "$1" 2>/dev/null || stat -f %m "$1" 2>/dev/null || echo 0
}

[ -d "$PROJECTS_DIR" ] || exit 1

# --- newest .last-dream -------------------------------------------------------
newest_ts=0
newest_ref=""
for f in "$PROJECTS_DIR"/*/memory/.last-dream; do
  [ -f "$f" ] || continue
  ts=$(tr -dc '0-9' < "$f" 2>/dev/null)
  case "$ts" in
    '' ) ts=$(mtime_of "$f") ;;
  esac
  [ -n "$ts" ] || ts=0
  if [ "$ts" -gt "$newest_ts" ] 2>/dev/null; then
    newest_ts="$ts"
    newest_ref="$f"
  fi
done

# --- no stamp yet: due if memory exists at all --------------------------------
if [ "$newest_ts" -eq 0 ]; then
  for m in "$PROJECTS_DIR"/*/memory/MEMORY.md; do
    [ -f "$m" ] && exit 0
  done
  exit 1
fi

# --- gate 1: at least 24h old -------------------------------------------------
now=$(date +%s)
[ $((now - newest_ts)) -ge "$MIN_AGE_SECONDS" ] || exit 1

# --- gate 2: at least 5 transcripts touched since then ------------------------
# Prefer a reference file stamped to the recorded epoch; fall back to the
# .last-dream file itself if this platform's touch/date can't do it.
ref="$newest_ref"
tmp_ref=$(mktemp 2>/dev/null) || tmp_ref=""
if [ -n "$tmp_ref" ]; then
  if touch -d "@$newest_ts" "$tmp_ref" 2>/dev/null; then
    ref="$tmp_ref"
  elif stamp=$(date -r "$newest_ts" +%Y%m%d%H%M.%S 2>/dev/null) &&
       touch -t "$stamp" "$tmp_ref" 2>/dev/null; then
    ref="$tmp_ref"
  fi
fi

count=$(find "$PROJECTS_DIR" -name '*.jsonl' -newer "$ref" 2>/dev/null | wc -l | tr -d ' ')
[ -n "$tmp_ref" ] && rm -f "$tmp_ref"

[ "${count:-0}" -ge "$MIN_SESSIONS" ] 2>/dev/null || exit 1
exit 0
