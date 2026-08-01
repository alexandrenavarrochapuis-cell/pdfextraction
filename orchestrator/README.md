# Voice orchestration layer

You talk, it directs Claude Code agents. Local Python service, Windows first.

Two halves. The voice layer is an OpenAI Realtime API session that holds the
orchestration tools directly --- there is no second LLM between your voice and
the tools. The worker layer is `claude -p` headless subprocesses, one per task,
each in its own git worktree, resumable by session id. State lives in SQLite;
that is the source of truth for what is running, not the voice model's context.

## Layout

| module | what it does |
| --- | --- |
| `config.py` | env-driven config, workspace map, permission allowlist, Max-aware defaults |
| `state.py` | SQLite task store, WAL mode, fuzzy label lookup for voice |
| `workers.py` | spawn, worktree isolation, resume, semaphore, JSON result parsing |
| `tools.py` | the four tool schemas plus dispatch |
| `voice.py` | Realtime websocket client, audio in/out, barge-in, tool calls |
| `audio.py` | device enumeration and pinning |
| `notifier.py` | 3 s poll loop that announces finished tasks without interrupting |
| `textmode.py` | the same tool loop over stdin, for debugging without a mic |
| `main.py` | entrypoint, workspace validation, Ctrl+C worker teardown |
| `cleanup.py` | prune finished worktrees |

## Setup

`--text` mode needs nothing beyond the standard library. Audio needs the rest:

```
pip install -r orchestrator/requirements.txt
```

Configure by environment. Workspaces are semicolon-separated `name=path` pairs,
because Windows paths contain colons:

```
set WORKSPACES=api=C:\src\api;site=C:\src\site
set OPENAI_API_KEY=sk-...
set WORKTREE_ROOT=C:\wt
```

Everything else has a working default. The ones worth knowing:

| var | default | notes |
| --- | --- | --- |
| `MAX_CONCURRENT_WORKERS` | `2` | do not raise it, see below |
| `WORKER_MODEL` | `sonnet` | Max has a separate weekly Sonnet cap |
| `WORKTREE_ROOT` | `%SystemDrive%\wt` | keep it short, worktrees hit MAX_PATH |
| `NOTIFY_MODE` | `on_complete` | `quiet` disables spoken announcements |
| `PUSH_TO_TALK` / `PTT_HOTKEY` | `1` / `ctrl+shift+space` | toggle, not hold |
| `INPUT_DEVICE` / `OUTPUT_DEVICE` | system default | index or name substring |
| `EXTRA_ALLOWED_TOOLS` | empty | semicolon-separated extra permission rules |

## Running

```
python -m orchestrator.main --text        # debug over stdin, no microphone
python -m orchestrator.main               # voice
python -m orchestrator.main --list-devices
python -m orchestrator.cleanup --dry-run
```

Text mode commands:

```
spawn [workspace] <label> :: <prompt>
check [active|recent|all|failed]
followup <task> :: <prompt>
result <task>
watch
```

## Constraints this code is built around

These are not preferences. Changing them breaks auth, billing, or the user's
own interactive Claude sessions.

- **No `--bare`.** It skips OAuth and keychain reads and expects
  `ANTHROPIC_API_KEY`. On a Max subscription that either fails auth or silently
  bills at API rates. `workers._assert_safe()` refuses to launch if the flag
  reappears.
- **No `ANTHROPIC_API_KEY` in the worker environment.** `workers._env()` strips
  it, along with the parent's session id --- a worker that inherits the
  orchestrator's session would make every follow-up resume the wrong
  conversation.
- **No `--dangerously-skip-permissions`.** The allowlist in `config.py` does
  this job. If a task needs something not allowed, add a narrow rule. Note the
  space before the star: `Bash(git diff *)` prefix-matches `git diff`, while
  `Bash(git diff*)` would also match `git diff-index`.
- **Follow-ups reuse the original `cwd`.** Session id lookup is scoped to the
  project directory and its worktrees, so `state.tasks.cwd` is replayed
  verbatim on resume.
- **Two workers at a time.** Max usage is shared across claude.ai, Desktop and
  Claude Code on five hour windows plus weekly caps.

## Windows notes

- `claude` resolves to `claude.cmd`; `config.resolve_claude_bin()` uses
  `shutil.which`, which consults `PATHEXT`, and everything runs `shell=False`.
- Worker processes get their own process group and are torn down with
  `taskkill /T /F` so no orphaned `claude` survives a Ctrl+C.
- Git worktrees fail on long paths. Keep `WORKTREE_ROOT` near the drive root.
- Pick a WASAPI device with `--list-devices` and pin it; MME adds latency that
  barge-in cannot afford.

## Tests

```
python -m unittest discover -s orchestrator/tests -t .
```

Barge-in is covered explicitly, both at the buffer level and over a real
websocket against a stub Realtime server: when `input_audio_buffer.speech_started`
arrives, queued audio is dropped before any await, so no network round trip can
sit between the user speaking and the voice stopping.
