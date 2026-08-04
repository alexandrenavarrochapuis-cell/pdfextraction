<#
.SYNOPSIS
  Is a memory consolidation due?

.DESCRIPTION
  Exit 0 : due
  Exit 1 : not due

  Due means:
    - 24+ hours since the newest .last-dream across ~\.claude\projects\*\memory\
      AND 5 or more session transcripts modified since then; or
    - no .last-dream exists anywhere but at least one MEMORY.md does.

  Never errors on missing paths. Never writes anything.
#>

[CmdletBinding()]
param()

$ErrorActionPreference = 'SilentlyContinue'

$ClaudeDir   = if ($env:CLAUDE_CONFIG_DIR) { $env:CLAUDE_CONFIG_DIR } else { Join-Path $env:USERPROFILE '.claude' }
$ProjectsDir = Join-Path $ClaudeDir 'projects'
$MinAgeSeconds = 86400
$MinSessions   = 5

if (-not (Test-Path -LiteralPath $ProjectsDir)) { exit 1 }

# --- newest .last-dream ------------------------------------------------------
$newest = $null
foreach ($stamp in Get-ChildItem -Path $ProjectsDir -Filter '.last-dream' -Recurse -Force -File) {
    if ($stamp.Directory.Name -ne 'memory') { continue }

    $raw = (Get-Content -LiteralPath $stamp.FullName -Raw) -replace '[^0-9]', ''
    $when = $null
    if ($raw) {
        try { $when = [DateTimeOffset]::FromUnixTimeSeconds([int64]$raw).UtcDateTime } catch { $when = $null }
    }
    if (-not $when) { $when = $stamp.LastWriteTimeUtc }

    if (-not $newest -or $when -gt $newest) { $newest = $when }
}

# --- no stamp yet: due if memory exists at all -------------------------------
if (-not $newest) {
    foreach ($index in Get-ChildItem -Path $ProjectsDir -Filter 'MEMORY.md' -Recurse -Force -File) {
        if ($index.Directory.Name -eq 'memory') { exit 0 }
    }
    exit 1
}

# --- gate 1: at least 24h old ------------------------------------------------
if (([DateTime]::UtcNow - $newest).TotalSeconds -lt $MinAgeSeconds) { exit 1 }

# --- gate 2: at least 5 transcripts touched since then -----------------------
$count = @(
    Get-ChildItem -Path $ProjectsDir -Filter '*.jsonl' -Recurse -Force -File |
        Where-Object { $_.LastWriteTimeUtc -gt $newest }
).Count

if ($count -ge $MinSessions) { exit 0 }
exit 1
