# dream — memory consolidation for Claude Code

Claude Code on the phone is a control surface, not a machine. Sessions run on
your desktop or in a cloud sandbox and the phone drives them, so every setup
step has to be one paste: zero file transfers, zero typing of paths.

`dream` scans recent session transcripts, pulls out corrections, preferences,
decisions and recurring patterns, and merges them into persistent memory files
under `~/.claude/projects/<project>/memory/`. It keeps `MEMORY.md` under 200
lines and archives anything that has gone quiet.

## Install

```bash
bash dream-kit/install.sh --auto   # skill + Stop hook + CLAUDE.md section
bash dream-kit/install.sh          # skill only, no automation
```

The installer is idempotent: re-running it will not duplicate the hook or the
`CLAUDE.md` section, and it merges into an existing `settings.json` rather than
replacing it.

## What gets installed

| Path | What it is |
| --- | --- |
| `~/.claude/skills/dream/SKILL.md` | the four-phase consolidation procedure |
| `~/.claude/skills/dream/should-dream.sh` | due-check, exit 0 = due |
| `~/.claude/settings.json` → `hooks.Stop` | sets `.dream-pending` on session exit |
| `~/.claude/CLAUDE.md` → `## Auto Dream` | tells the next session to pick the flag up |

## Daily use

| You type | What happens |
| --- | --- |
| `/dream` | full consolidation now |
| `dream dry run` | shows the diff, writes nothing |
| `dream, last 3 days only` | narrows the transcript window |
| `dream, focus on Scotty decisions` | steers what gets promoted |

Auto mode needs nothing from you. The Stop hook checks on every session exit and
the next session picks up the flag.

The first run against a project always backs up the memory directory and does a
dry run first — it prints the proposed diff and waits for your approval before
writing anything.

## Verify it is armed

```bash
python3 -m json.tool ~/.claude/settings.json | grep -A6 '"Stop"'
bash ~/.claude/skills/dream/should-dream.sh; echo "due=$?"
```

`due=0` means a dream is pending, `due=1` means not yet. Force one:

```bash
touch ~/.claude/.dream-pending
```

## Weekly check, two minutes on the phone

```bash
wc -l ~/.claude/projects/*/memory/MEMORY.md
grep -ri "yesterday\|last week\|recently" ~/.claude/projects/*/memory/ | head
```

Line count should stay under 200. The grep should return nothing — if relative
dates are surviving, the consolidate phase is being skipped and phase 3 needs to
be stricter.

Skim `corrections.md` once a week too. That file is where drift shows up first:
if it is accumulating entries that contradict each other, memory is being
written faster than it is being consolidated.

## Turn it off

```bash
rm -f ~/.claude/.dream-pending
python3 - <<'PY'
import json, os
p = os.path.expanduser('~/.claude/settings.json')
s = json.load(open(p))

def is_dream(entry):
    if 'should-dream.sh' in str(entry.get('command', '')):
        return True
    return any('should-dream.sh' in str(h.get('command', ''))
               for h in entry.get('hooks', []) if isinstance(h, dict))

hooks = s.get('hooks', {})
if 'Stop' in hooks:
    hooks['Stop'] = [h for h in hooks['Stop'] if not is_dream(h)]
json.dump(s, open(p, 'w'), indent=2)
PY
```

The skill stays installed and `/dream` still works manually.

## What not to put in memory

Memory files are plain Markdown on disk, unencrypted, and they get read into
every session. The redaction gate in phase 2 is a mitigation, not a guarantee.
Keep credentials, client data, and non-public commercial terms out of prompts in
the first place. What Claude never sees, it cannot write down.

## Note on transcript paths

Different Claude Code installs lay transcripts out differently —
`~/.claude/projects/<slug>/sessions/*.jsonl` on some, flat
`~/.claude/projects/<slug>/*.jsonl` on others. Both the skill and
`should-dream.sh` match `*.jsonl` anywhere under `~/.claude/projects`, so they
work either way.
