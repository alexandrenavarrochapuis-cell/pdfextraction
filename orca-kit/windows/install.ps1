<#
.SYNOPSIS
  Install Orca on Windows and register its agent skills with Claude Code.

.DESCRIPTION
  Downloads the signed orca-windows-setup.exe from the latest GitHub release,
  runs it, verifies the app landed, then installs Orca's `orca-cli` and
  `orchestration` skills so Claude Code can drive Orca worktrees and terminals.

  The installer is a per-user NSIS one-click build: it installs under
  %LOCALAPPDATA%\Programs\orca, needs no elevation, and launches Orca when it
  finishes. Re-running upgrades in place.

.PARAMETER Silent
  Pass /S to the installer so it runs without showing its window.

.PARAMETER SkipSkills
  Install the app only; do not touch Claude Code's skills.

.PARAMETER SkipApp
  Only (re)install the agent skills. Use when Orca is already installed.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File install.ps1

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File install.ps1 -Silent
#>
[CmdletBinding()]
param(
  [switch]$Silent,
  [switch]$SkipSkills,
  [switch]$SkipApp
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$SetupUrl = 'https://github.com/stablyai/orca/releases/latest/download/orca-windows-setup.exe'
$SkillsRepo = 'https://github.com/stablyai/orca'

function Write-Step { param([string]$Message) Write-Host "==> $Message" -ForegroundColor Cyan }
function Write-Note { param([string]$Message) Write-Host "    $Message" }
function Write-Warn { param([string]$Message) Write-Host "    $Message" -ForegroundColor Yellow }

# Candidate install locations, most likely first. The build is per-user
# one-click, so LOCALAPPDATA is where it normally lands; the others cover a
# machine-wide install done by hand.
function Get-OrcaPaths {
  $candidates = @()
  if ($env:LOCALAPPDATA) {
    $candidates += (Join-Path $env:LOCALAPPDATA 'Programs\orca\Orca.exe')
    $candidates += (Join-Path $env:LOCALAPPDATA 'Programs\Orca\Orca.exe')
  }
  if ($env:ProgramFiles) {
    $candidates += (Join-Path $env:ProgramFiles 'Orca\Orca.exe')
  }
  if (${env:ProgramFiles(x86)}) {
    $candidates += (Join-Path ${env:ProgramFiles(x86)} 'Orca\Orca.exe')
  }
  return $candidates
}

function Find-Orca {
  foreach ($path in (Get-OrcaPaths)) {
    if (Test-Path -LiteralPath $path) { return $path }
  }
  return $null
}

# $IsWindows only exists on PowerShell 6+. Under Set-StrictMode, naming it on
# Windows PowerShell 5.1 would throw, so the 5.1 branch never evaluates it.
$onWindows = $true
if ($PSVersionTable.PSVersion.Major -ge 6) { $onWindows = $IsWindows }
if (-not $onWindows) {
  throw 'This installer is for Windows. On Linux use orca-kit/server/install.sh; on macOS use: brew install --cask stablyai/orca/orca'
}

# --- 1. the app --------------------------------------------------------------
if (-not $SkipApp) {
  Write-Step 'Downloading Orca'
  $setup = Join-Path ([System.IO.Path]::GetTempPath()) 'orca-windows-setup.exe'
  try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  } catch {
    # PowerShell 7 negotiates TLS itself; the property is absent there.
  }
  Invoke-WebRequest -Uri $SetupUrl -OutFile $setup -UseBasicParsing
  $sizeMb = [Math]::Round((Get-Item -LiteralPath $setup).Length / 1MB, 1)
  Write-Note "$setup ($sizeMb MB)"

  $signature = Get-AuthenticodeSignature -LiteralPath $setup
  if ($signature.Status -eq 'Valid') {
    Write-Note "signature: valid ($($signature.SignerCertificate.Subject.Split(',')[0]))"
  } else {
    Write-Warn "signature status is '$($signature.Status)'. Orca's Windows builds are signed via SignPath;"
    Write-Warn 'if this is not Valid, stop and download manually from https://onorca.dev/download'
    if ($Silent) {
      throw "Refusing to run an installer with signature status '$($signature.Status)' in -Silent mode."
    }
    $answer = Read-Host 'Continue anyway? (y/N)'
    if ($answer -ne 'y') { throw 'Aborted at signature check.' }
  }

  Write-Step 'Running the installer'
  if ($Silent) { Write-Note 'silent mode (/S)' } else { Write-Note 'the installer window will appear; it closes on its own' }
  $processArgs = @{ FilePath = $setup; Wait = $true; PassThru = $true }
  if ($Silent) { $processArgs['ArgumentList'] = '/S' }
  $process = Start-Process @processArgs
  if ($process.ExitCode -ne 0) {
    throw "Installer exited with code $($process.ExitCode)."
  }

  # The one-click installer returns before the shortcut and binary are always
  # visible, so give it a moment before declaring failure.
  $orca = $null
  foreach ($attempt in 1..10) {
    $orca = Find-Orca
    if ($orca) { break }
    Start-Sleep -Seconds 2
  }

  if ($orca) {
    Write-Note "installed -> $orca"
  } else {
    Write-Warn 'Could not find Orca.exe in any of the usual locations:'
    foreach ($path in (Get-OrcaPaths)) { Write-Warn "  $path" }
    Write-Warn 'If Orca opened anyway, this is only a path check and you can ignore it.'
  }

  Remove-Item -LiteralPath $setup -Force -ErrorAction SilentlyContinue
}

# --- 2. agent skills ---------------------------------------------------------
if (-not $SkipSkills) {
  Write-Step 'Installing Orca agent skills for Claude Code'
  $npx = Get-Command npx -ErrorAction SilentlyContinue
  if (-not $npx) {
    Write-Warn 'node/npx not found, so the skills were skipped.'
    Write-Warn 'Install Node.js (https://nodejs.org), then run this script again with -SkipApp.'
  } else {
    # This is exactly the command `orca skills install --skill orca-cli
    # --skill orchestration` resolves to. --yes and -y are load-bearing:
    # without them the skills CLI opens an interactive agent picker and blocks.
    $skillArgs = @(
      '--yes', 'skills', 'add', $SkillsRepo,
      '--skill', 'orca-cli',
      '--skill', 'orchestration',
      '--global',
      '--agent', 'claude-code',
      '--agent', 'universal',
      '-y'
    )
    Write-Note "npx $($skillArgs -join ' ')"
    & npx @skillArgs
    if ($LASTEXITCODE -ne 0) {
      Write-Warn "the skills CLI exited $LASTEXITCODE. Orca itself is fine; re-run with -SkipApp to retry."
    } else {
      Write-Note 'skills installed globally for Claude Code'
    }
  }
}

# --- done --------------------------------------------------------------------
Write-Host ''
Write-Host 'Orca is set up.' -ForegroundColor Green
Write-Host @'

Next, in this order:

  1. Open Orca. Add a repo, and sign in to the agents you use.
  2. Settings -> Mobile, to pair the phone app.
  3. Try it: create a worktree and fan a prompt across two agents.

Inside an Orca terminal the `orca` command always resolves to the Orca CLI,
so Claude Code can drive it directly:

  orca status --json
  orca worktree create --name my-task --agent claude --prompt "..." --json

'@
