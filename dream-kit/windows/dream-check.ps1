<#
.SYNOPSIS
  Run the due check and, if a dream is due, set the pending flag.

.DESCRIPTION
  This is what the Stop hook and the scheduled task invoke. Keeping it in its
  own file avoids embedding a multi-clause PowerShell one-liner inside JSON.

  It sets the flag. It never runs a dream — the next session does that.
#>

[CmdletBinding()]
param()

$ErrorActionPreference = 'SilentlyContinue'

$ClaudeDir = if ($env:CLAUDE_CONFIG_DIR) { $env:CLAUDE_CONFIG_DIR } else { Join-Path $env:USERPROFILE '.claude' }
$Check     = Join-Path $ClaudeDir 'skills\dream\should-dream.ps1'
$Flag      = Join-Path $ClaudeDir '.dream-pending'

if (-not (Test-Path -LiteralPath $Check)) { exit 0 }

& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $Check | Out-Null

if ($LASTEXITCODE -eq 0) {
    New-Item -ItemType File -Force -Path $Flag | Out-Null
}

# Always succeed: this runs from a hook and must never block the session.
exit 0
