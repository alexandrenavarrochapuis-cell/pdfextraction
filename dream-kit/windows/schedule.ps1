<#
.SYNOPSIS
  Run the dream due-check on a daily Windows scheduled task.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File schedule.ps1
  Daily at 09:00.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File schedule.ps1 -At 22:30

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File schedule.ps1 -Uninstall

.NOTES
  The task does not run a dream. It runs the due check and, if one is due, sets
  ~\.claude\.dream-pending — the same flag the Stop hook sets. The next session
  picks it up via the Auto Dream section in CLAUDE.md.

  The Stop hook only fires when a session ends. This covers the days you leave
  sessions open. Both are safe to have; the flag is idempotent.

  Registers under the current user, no elevation required.
#>

[CmdletBinding()]
param(
    [string] $At = '09:00',
    [switch] $Uninstall
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

$TaskName  = 'ClaudeDreamCheck'
$ClaudeDir = if ($env:CLAUDE_CONFIG_DIR) { $env:CLAUDE_CONFIG_DIR } else { Join-Path $env:USERPROFILE '.claude' }
$Check     = Join-Path $ClaudeDir 'skills\dream\dream-check.ps1'

$haveCmdlets = $null -ne (Get-Command Register-ScheduledTask -ErrorAction SilentlyContinue)

# --- uninstall ---------------------------------------------------------------
if ($Uninstall) {
    if ($haveCmdlets) {
        if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
            Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
            Write-Host 'scheduled task removed'
        } else {
            Write-Host 'no scheduled task to remove'
        }
    } else {
        & schtasks.exe /Delete /TN $TaskName /F 2>&1 | Out-Null
        Write-Host 'scheduled task removed (schtasks)'
    }
    exit 0
}

# --- validate ----------------------------------------------------------------
if ($At -notmatch '^([01][0-9]|2[0-3]):[0-5][0-9]$') {
    Write-Error "-At wants HH:MM (24h), got: $At"
    exit 2
}

if (-not (Test-Path -LiteralPath $Check)) {
    Write-Error "not found: $Check`nrun install.ps1 first."
    exit 1
}

$argument = '-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "{0}"' -f $Check

# --- register ----------------------------------------------------------------
if ($haveCmdlets) {
    $action  = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $argument
    $trigger = New-ScheduledTaskTrigger -Daily -At ([datetime]::ParseExact($At, 'HH:mm', $null))
    $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries `
                                             -DontStopIfGoingOnBatteries

    # -Force replaces an existing task, so re-running never stacks a second one.
    Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger `
                           -Settings $settings -Description 'Claude dream due-check' `
                           -Force | Out-Null
    Write-Host "scheduled via Task Scheduler, daily at $At"
    Write-Host "  task:  $TaskName"
    Write-Host "  check: Get-ScheduledTask -TaskName $TaskName"
} else {
    $command = 'powershell.exe {0}' -f $argument
    & schtasks.exe /Create /SC DAILY /ST $At /TN $TaskName /TR $command /F | Out-Null
    Write-Host "scheduled via schtasks, daily at $At"
    Write-Host "  check: schtasks /Query /TN $TaskName"
}

Write-Host ''
Write-Host 'the task only sets the flag. the next session runs the dream.'
