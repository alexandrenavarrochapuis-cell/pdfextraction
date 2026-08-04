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
bash dream-kit/install.sh --auto              # skill + Stop hook + CLAUDE.md section
bash dream-kit/install.sh --auto --schedule   # ...and a daily timer at 09:00
bash dream-kit/install.sh                     # skill only, no automation
```

The installer is idempotent: re-running it will not duplicate the hook or the
`CLAUDE.md` section, and it merges into an existing `settings.json` rather than
replacing it.

### Windows

Native PowerShell, no WSL and no Git Bash needed:

```powershell
git clone -b claude/dream-memory-consolidation-j1ks1p https://github.com/alexandrenavarrochapuis-cell/pdfextraction.git $HOME\dream-kit-src
powershell -ExecutionPolicy Bypass -File $HOME\dream-kit-src\dream-kit\windows\install.ps1 -Auto -Schedule
```

(Already cloned? `git -C $HOME\dream-kit-src pull` first.)

**`-b` is required:** `dream-kit/` lives on the `claude/dream-memory-consolidation-j1ks1p`
branch, not on the default branch. Without it the clone succeeds and the
install line then fails on a path that does not exist.

| File | |
| --- | --- |
| `windows\install.ps1` | `-Auto`, `-Schedule`, `-At HH:MM` — same behaviour as `install.sh` |
| `windows\should-dream.ps1` | due check, exit 0 = due |
| `windows\dream-check.ps1` | what the hook and the task call: check, then set the flag |
| `windows\schedule.ps1` | daily task via Task Scheduler, `-Uninstall` to remove |

The Stop hook is stored as
`powershell -NoProfile -ExecutionPolicy Bypass -File "%USERPROFILE%\.claude\skills\dream\dream-check.ps1"`
— `cmd.exe` expands `%USERPROFILE%`, so the entry stays valid across machines.

Works on Windows PowerShell 5.1 and PowerShell 7. The scheduled task registers
under your own user, so no elevation is needed.

### macOS and Linux, one paste

Memory is only worth consolidating where your session history actually lives.
A cloud sandbox is wiped between sessions, so run this on the machine you work
on:

```bash
git clone -b claude/dream-memory-consolidation-j1ks1p https://github.com/alexandrenavarrochapuis-cell/pdfextraction.git ~/dream-kit-src 2>/dev/null || git -C ~/dream-kit-src pull
bash ~/dream-kit-src/dream-kit/install.sh --auto --schedule
```

Then, in a Claude Code session on that machine: `dream dry run`.

## Scheduling

The Stop hook only fires when a session ends. `schedule.sh` covers the days you
leave sessions open:

```bash
bash dream-kit/schedule.sh                # daily at 09:00
bash dream-kit/schedule.sh --at 22:30     # daily at 22:30
bash dream-kit/schedule.sh --uninstall    # remove it
```

It picks a backend automatically: **launchd** on macOS, a **systemd user timer**
on Linux, **crontab** as a fallback. On Windows use `windows\schedule.ps1`,
which registers a **Task Scheduler** task. Re-running replaces the existing
entry rather than stacking a second one.

The timer never runs a dream itself — it runs the due-check and sets
`.dream-pending`, exactly like the Stop hook. The next session does the work.
That keeps consolidation inside a session that can show you the diff and stop
for approval.

## What gets installed

| Path | What it is |
| --- | --- |
| `~/.claude/skills/dream/SKILL.md` | the four-phase consolidation procedure |
| `~/.claude/skills/dream/should-dream.sh` | due-check, exit 0 = due |
| `~/.claude/skills/dream/*.ps1` | the same two, on Windows, plus `dream-check.ps1` |
| `~/.claude/settings.json` → `hooks.Stop` | sets `.dream-pending` on session exit |
| `~/.claude/CLAUDE.md` → `## Auto Dream` | tells the next session to pick the flag up |
| launchd / systemd / cron / Task Scheduler | optional daily due-check (`--schedule`) |

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

On Windows:

```powershell
(Get-Content $HOME\.claude\settings.json -Raw | ConvertFrom-Json).hooks.Stop | ConvertTo-Json -Depth 10
powershell -File $HOME\.claude\skills\dream\should-dream.ps1; "due=$LASTEXITCODE"
Get-ScheduledTask -TaskName ClaudeDreamCheck | Select-Object TaskName, State
```

Force one:

```powershell
New-Item -ItemType File -Force -Path $HOME\.claude\.dream-pending
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
bash dream-kit/schedule.sh --uninstall
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

On Windows:

```powershell
powershell -ExecutionPolicy Bypass -File $HOME\dream-kit-src\dream-kit\windows\schedule.ps1 -Uninstall
Remove-Item $HOME\.claude\.dream-pending -Force -ErrorAction SilentlyContinue

$p = "$HOME\.claude\settings.json"
$s = Get-Content $p -Raw | ConvertFrom-Json
$s.hooks.Stop = @($s.hooks.Stop | Where-Object {
    ($_ | ConvertTo-Json -Depth 20 -Compress) -notmatch 'dream-check|should-dream'
})
[System.IO.File]::WriteAllText($p, ($s | ConvertTo-Json -Depth 20),
                               (New-Object System.Text.UTF8Encoding $false))
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
