# orca-kit — Orca on your PC, plus an always-on server

[Orca](https://github.com/stablyai/orca) is an ADE: you fan one prompt across
several coding agents, each in its own git worktree, and merge the winner. It is
a desktop app, so it cannot be installed from a Claude Code web session — this
kit is the one-paste installer instead, same shape as `dream-kit`.

Two machines, two jobs:

| | Runs | Why |
| --- | --- | --- |
| **Your Windows PC** | the Orca desktop app | the cockpit — worktrees, diffs, terminals, design mode |
| **Your Linux server** | `orca serve` under systemd | agents keep working when the PC is asleep; the phone pairs here |

You do not need both. The PC alone is a complete setup — the server is what
makes it always-on.

## Install on Windows

```powershell
git clone -b claude/orca-setup-54ic3b https://github.com/alexandrenavarrochapuis-cell/pdfextraction.git $HOME\orca-kit-src
powershell -ExecutionPolicy Bypass -File $HOME\orca-kit-src\orca-kit\windows\install.ps1
```

(Already cloned? `git -C $HOME\orca-kit-src pull` first.)

**`-b` is required:** `orca-kit/` lives on the `claude/orca-setup-54ic3b`
branch, not on the default branch. Without it the clone succeeds and the install
line then fails on a path that does not exist.

It downloads the signed `orca-windows-setup.exe`, checks its Authenticode
signature, runs it, confirms the app landed, and then installs Orca's `orca-cli`
and `orchestration` skills for Claude Code, Gemini CLI and Grok. No elevation
needed — it is a per-user install under `%LOCALAPPDATA%\Programs\orca`.

| Flag | |
| --- | --- |
| `-Silent` | pass `/S` so the installer window never appears |
| `-SkipSkills` | app only, leave Claude Code alone |
| `-SkipApp` | skills only — use to retry after installing Node |
| `-Diagnose` | print the environment report and install nothing |

The skills step needs Node on PATH. Without it the app still installs and the
script tells you the command to run later.

### Which agents get the skills

`orca-cli` and `orchestration` are installed for four targets, so Claude,
Gemini and Grok can all drive Orca worktrees and terminals:

| target | where it lands |
| --- | --- |
| `claude-code` | `~/.claude/skills` |
| `gemini-cli` | reads the shared `~/.agents/skills` |
| `grok` | `~/.grok/skills` |
| `universal` | `~/.agents/skills` — anything else reading the shared dir |

These are the **skills CLI's** agent ids, not Orca's. Gemini's is `gemini-cli`,
not `gemini`, and Grok keeps its own directory — so `universal` on its own
reaches neither.

The real files live in `~/.agents/skills`; the per-agent directories are
symlinks into it. Creating a directory symlink on Windows needs Developer Mode
or an elevated shell, so if that fails the script retries automatically with
`--copy`, which writes real copies. The trade-off is that copies no longer
share one source of truth, so re-run the script after an Orca upgrade.

### If it goes wrong, one paste is enough

However the run ends, the script prints a report between two markers:

```
----------------- copy from here -----------------
...
------------------ to here -----------------------
```

Copy that block and send it. It carries the PowerShell and Windows versions,
whether you were elevated, your execution policy, Node/npm/npx/git versions,
which of the four candidate install paths exist and at what version, the
installer's exit code, the Authenticode status, the skills CLI's own output,
and — on a failure — the exception type and the exact line that threw.

**It is redacted.** Username, hostname, domain and profile paths are replaced
with `<user>`, `<host>`, `<domain>` and `<profile>` before anything is printed
or written. A full unredacted PowerShell transcript is saved next to it for
your own use; that one is local-only, so do not paste it.

To collect the report without installing anything:

```powershell
powershell -ExecutionPolicy Bypass -File $HOME\orca-kit-src\orca-kit\windows\install.ps1 -Diagnose
```

## Install the always-on server

On the Linux box (Ubuntu 20.04+/Debian stable, glibc 2.31+):

```bash
git clone -b claude/orca-setup-54ic3b https://github.com/alexandrenavarrochapuis-cell/pdfextraction.git ~/orca-kit-src 2>/dev/null || git -C ~/orca-kit-src pull
sudo bash ~/orca-kit-src/orca-kit/server/install.sh --pairing-address 100.64.1.20
```

Replace `100.64.1.20` with the address your phone will actually use to reach the
box. A [Tailscale](https://tailscale.com) IP is the safest choice; a LAN IP or a
public hostname also work, as does a full reverse-proxy URL
(`https://orca.example.com/runtime`).

**`--pairing-address` is required and it is not the bind address.** Orca always
binds `0.0.0.0`; this is only what it advertises to clients. Leave it out and
the server advertises `127.0.0.1`, which nothing outside the box can pair with.

The script installs the AppImage to `/opt/orca` (root-owned, so the service
cannot overwrite its own binary), extracts it so no FUSE is needed, creates a
non-root `orca` service user, writes `/etc/systemd/system/orca-serve.service`,
starts it, and prints the pairing URL.

| Flag | |
| --- | --- |
| `--pairing-address <addr>` | required; what clients dial |
| `--port <n>` | default `6768` |
| `--no-skills` | skip the agent skills install |
| `--uninstall` | stop the service, remove the unit and `/opt/orca` |

Re-run it any time to upgrade: it keeps one rollback copy at
`/opt/orca/orca-linux.AppImage.prev` and restarts the service.

### Running as root fails on purpose

Electron refuses to start as root without `--no-sandbox`, so the unit runs as
the `orca` user and Chromium keeps its sandbox. That is why the script makes a
service user instead of taking the shortcut.

## Pair your phone

Install the Orca companion app — [iOS](https://apps.apple.com/us/app/orca-ide/id6766130217)
or [Android APK](https://github.com/stablyai/orca/releases/download/mobile-android-v0.0.43/app-release.apk) —
then open the pairing URL the installer printed.

The pairing URL is a **single-use secret**. Treat it like a password: it carries
a device token and a public key. Do not paste it into a chat or an issue.

A fresh one on demand:

```bash
sudo systemctl restart orca-serve
journalctl -u orca-serve --since '-1 min' -o cat | grep orca_server_ready | tail -1 | jq -r .pairing.url
```

Keep port `6768` off the public internet. Tailscale, a VPN, or a firewall rule
scoped to your own addresses — an open Orca port is a remote shell on that box.

## Daily use

In the desktop app: add a repo, sign in to your agents, then fan a prompt across
several of them and merge the one you like.

From Claude Code, the `orca-cli` skill is what makes this scriptable:

```text
orca status --json
orca worktree create --name my-task --agent claude --prompt "..." --json
orca worktree ps --json
orca terminal send --terminal <handle> --text "..." --enter --json
```

**On Linux, outside an Orca terminal, use `orca-ide`, not `orca`.** Bare `orca`
is normally the GNOME screen reader (`/usr/bin/orca`) and running it starts
speech on the machine. Inside Orca's own terminals `orca` always resolves to the
Orca CLI on every platform, Windows included.

## Verify

On the server:

```bash
systemctl status orca-serve
journalctl -u orca-serve -f
sudo -u orca -H /home/orca/.local/bin/orca-ide status --json | jq '.result.runtime.state'
```

`"ready"` means the runtime is up. On Windows, open Orca and run `orca status --json`
in one of its terminals.

## Turn it off

```bash
sudo systemctl stop orca-serve && sudo systemctl disable orca-serve   # pause
sudo bash ~/orca-kit-src/orca-kit/server/install.sh --uninstall       # remove
```

The uninstall leaves `/home/orca` alone, because agent state and any worktrees
live there. `sudo userdel -r orca` removes that too.

On Windows, uninstall from **Settings → Apps → Orca**. The skills are separate:

```powershell
npx --yes skills remove orca-cli orchestration --global -y
```

That clears them from every agent they were installed for.

## What was actually tested

Verified here against **Orca 1.4.184** on Ubuntu:

- the three release URLs resolve, and `orca-linux.AppImage` downloads (205 MB)
- extraction, the non-root service user, and `AppRun serve --json` — the ready
  JSON matches the documented schema and `--pairing-address` is advertised
  correctly
- `orca-ide status --json` reaching the runtime, and `orca skills install`
  resolving to the `npx skills add ...` command the Windows script runs
- all four agent targets accepted by a real install: `~/.claude/skills` and
  `~/.grok/skills` get symlinks into `~/.agents/skills`, and the `--copy`
  fallback writes real copies instead
- the server script's argument validation, download, extraction, and the exact
  unit file it writes

Not tested here, because this container has neither:

- **systemd** — the unit is written and verified by inspection, and its
  `ExecStart` line was run by hand exactly as written, but `systemctl enable/start`
  never executed
- **Windows** — the `.exe` was never run. What was exercised, under PowerShell
  7.6.5 with the platform guard stubbed out: the full `-Diagnose` run, the
  environment probe's fallbacks for Windows-only APIs, report assembly and
  emission, the failure path (correct exception type, line number, and exit 1),
  and the redaction function against simulated Windows values including
  lowercase paths — verified to leak no username, hostname or domain. The
  path-resolution logic is unit-tested under `Set-StrictMode`. Signature
  checking and the installer's exit code are handled but unproven.

If the Windows run surprises you, send me the output and I will fix it.
