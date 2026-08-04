<#
.SYNOPSIS
  Install the dream memory-consolidation skill on Windows.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File install.ps1
  Skill only, no automation.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File install.ps1 -Auto
  Skill + Stop hook + CLAUDE.md section.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File install.ps1 -Auto -Schedule -At 22:30
  ...and a daily scheduled task.

.NOTES
  Idempotent. Preserves existing hooks. Never touches project source.
  Windows PowerShell 5.1 and PowerShell 7 both work.
#>

[CmdletBinding()]
param(
    [switch] $Auto,
    [switch] $Schedule,
    [string] $At = '09:00'
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

$KitDir    = Split-Path -Parent $MyInvocation.MyCommand.Path
$ClaudeDir = if ($env:CLAUDE_CONFIG_DIR) { $env:CLAUDE_CONFIG_DIR } else { Join-Path $env:USERPROFILE '.claude' }
$SkillDir  = Join-Path $ClaudeDir 'skills\dream'
$Settings  = Join-Path $ClaudeDir 'settings.json'
$ClaudeMd  = Join-Path $ClaudeDir 'CLAUDE.md'

# --- 1. skill ----------------------------------------------------------------
New-Item -ItemType Directory -Force -Path $SkillDir | Out-Null

$skillSource = Join-Path (Split-Path -Parent $KitDir) 'skills\dream\SKILL.md'
if (-not (Test-Path -LiteralPath $skillSource)) {
    throw "SKILL.md not found at $skillSource - run this from the kit's windows\ directory."
}

Copy-Item -LiteralPath $skillSource                            -Destination (Join-Path $SkillDir 'SKILL.md')         -Force
Copy-Item -LiteralPath (Join-Path $KitDir 'should-dream.ps1')  -Destination (Join-Path $SkillDir 'should-dream.ps1') -Force
Copy-Item -LiteralPath (Join-Path $KitDir 'dream-check.ps1')   -Destination (Join-Path $SkillDir 'dream-check.ps1')  -Force

Write-Host "installed skill  -> $SkillDir"

function Invoke-MaybeSchedule {
    if (-not $Schedule) { return }
    Write-Host ''
    & (Join-Path $KitDir 'schedule.ps1') -At $At
}

if (-not $Auto) {
    Write-Host 'skill only. re-run with -Auto to arm the Stop hook.'
    Invoke-MaybeSchedule
    exit 0
}

# --- 2. Stop hook ------------------------------------------------------------
# cmd.exe expands %USERPROFILE%, so the stored command stays portable.
$hookCommand = 'powershell -NoProfile -ExecutionPolicy Bypass -File "%USERPROFILE%\.claude\skills\dream\dream-check.ps1"'

if (Test-Path -LiteralPath $Settings) {
    $rawSettings = Get-Content -LiteralPath $Settings -Raw
    if ([string]::IsNullOrWhiteSpace($rawSettings)) { $rawSettings = '{}' }
    try {
        $settings = $rawSettings | ConvertFrom-Json
    } catch {
        throw 'settings.json is not valid JSON; refusing to overwrite it'
    }
    if ($settings -isnot [PSCustomObject]) {
        throw 'settings.json is not a JSON object; refusing to overwrite it'
    }
} else {
    $settings = [PSCustomObject]@{}
}

if (-not $settings.PSObject.Properties.Match('hooks').Count) {
    $settings | Add-Member -NotePropertyName 'hooks' -NotePropertyValue ([PSCustomObject]@{})
}
$hooks = $settings.hooks

if (-not $hooks.PSObject.Properties.Match('Stop').Count) {
    $hooks | Add-Member -NotePropertyName 'Stop' -NotePropertyValue @()
}
$stop = @($hooks.Stop)

$alreadyPresent = $false
foreach ($entry in $stop) {
    if (($entry | ConvertTo-Json -Depth 20 -Compress) -match 'dream-check|should-dream') {
        $alreadyPresent = $true
    }
}

if ($alreadyPresent) {
    Write-Host 'Stop hook   -> already present, left alone'
} else {
    $newEntry = [PSCustomObject]@{
        matcher = ''
        hooks   = @([PSCustomObject]@{ type = 'command'; command = $hookCommand })
    }
    $hooks.Stop = @($stop + $newEntry)
    ($settings | ConvertTo-Json -Depth 20) | Set-Content -LiteralPath $Settings -Encoding UTF8
    Write-Host "Stop hook   -> added to $Settings"
}

# --- 3. CLAUDE.md ------------------------------------------------------------
if (-not (Test-Path -LiteralPath $ClaudeMd)) {
    New-Item -ItemType File -Force -Path $ClaudeMd | Out-Null
}

$claudeMdText = Get-Content -LiteralPath $ClaudeMd -Raw
if ($null -eq $claudeMdText) { $claudeMdText = '' }

if ($claudeMdText -match '(?m)^## Auto Dream') {
    Write-Host 'CLAUDE.md   -> section already present, left alone'
} else {
    $section = @'

## Auto Dream

If `~/.claude/.dream-pending` exists at the start of a session:

1. Run the `dream` skill as a background subagent.
2. Delete the flag file.
3. Report only the skill's summary block — nothing else.

Do not interrupt or delay whatever the user is currently working on. If the
dream is still running when the user's task finishes, report it when it lands.
'@
    Add-Content -LiteralPath $ClaudeMd -Value $section -Encoding UTF8
    Write-Host 'CLAUDE.md   -> Auto Dream section appended'
}

# --- 4. optional daily task --------------------------------------------------
Invoke-MaybeSchedule

Write-Host ''
Write-Host "armed. check with:  powershell -File `"$SkillDir\should-dream.ps1`"; `$LASTEXITCODE"
