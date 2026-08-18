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

  Whatever happens, the script writes a compact report designed to be pasted
  into a chat: usernames, hostname and profile paths are redacted out of it.
  A full unredacted PowerShell transcript is kept beside it for local digging.

.PARAMETER Silent
  Pass /S to the installer so it runs without showing its window.

.PARAMETER SkipSkills
  Install the app only; do not touch Claude Code's skills.

.PARAMETER SkipApp
  Only (re)install the agent skills. Use when Orca is already installed.

.PARAMETER Diagnose
  Collect and print the environment report only. Installs nothing.

.PARAMETER ReportPath
  Where to write the paste-ready report. Defaults to your temp directory.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File install.ps1

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File install.ps1 -Diagnose
#>
[CmdletBinding()]
param(
  [switch]$Silent,
  [switch]$SkipSkills,
  [switch]$SkipApp,
  [switch]$Diagnose,
  [string]$ReportPath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$KitVersion  = '2'
$SetupUrl    = 'https://github.com/stablyai/orca/releases/latest/download/orca-windows-setup.exe'
$SkillsRepo  = 'https://github.com/stablyai/orca'

# ---------------------------------------------------------------------------
# report plumbing
# ---------------------------------------------------------------------------

$script:Report = New-Object 'System.Collections.Generic.List[string]'
$script:Failed = $false

# Strip anything that identifies the machine or the person using it, so the
# report can be pasted into a chat without leaking who or where you are.
function Protect-Text {
  param([string]$Text)
  if (-not $Text) { return $Text }
  $out = $Text
  # longest first: USERPROFILE contains USERNAME
  foreach ($pair in @(
      @{ Value = $env:USERPROFILE;   Token = '<profile>' },
      @{ Value = $env:LOCALAPPDATA;  Token = '<localappdata>' },
      @{ Value = $env:COMPUTERNAME;  Token = '<host>' },
      @{ Value = $env:USERDOMAIN;    Token = '<domain>' },
      @{ Value = $env:USERNAME;      Token = '<user>' }
    )) {
    $value = $pair['Value']
    if ($value -and $value.Length -ge 2) {
      $out = $out -replace [regex]::Escape($value), $pair['Token']
    }
  }
  return $out
}

function Add-Report {
  param([string]$Line = '')
  # Collapse embedded newlines so one report entry stays one line: a .NET
  # exception message can be several lines and would otherwise wreck the
  # layout of the block the user pastes.
  $flat = $Line -replace '\s*\r?\n\s*', ' '
  $script:Report.Add((Protect-Text $flat))
}

function Write-Step {
  param([string]$Message)
  Write-Host "==> $Message" -ForegroundColor Cyan
  Add-Report ''
  Add-Report "==> $Message"
}

function Write-Note {
  param([string]$Message)
  Write-Host "    $Message"
  Add-Report "    $Message"
}

function Write-Warn {
  param([string]$Message)
  Write-Host "    $Message" -ForegroundColor Yellow
  Add-Report "    ! $Message"
}

# ---------------------------------------------------------------------------
# environment probing
# ---------------------------------------------------------------------------

function Get-ToolLine {
  param([string]$Name, [string[]]$Arguments = @('--version'))
  $cmd = Get-Command $Name -ErrorAction SilentlyContinue
  if (-not $cmd) { return 'not found' }
  try {
    $raw = & $Name @Arguments 2>&1 | Select-Object -First 1
    return "$raw"
  } catch {
    return "found but failed to run: $($_.Exception.Message)"
  }
}

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

function Add-EnvironmentReport {
  Add-Report "orca-kit install report (v$KitVersion)"
  Add-Report "utc            : $((Get-Date).ToUniversalTime().ToString('yyyy-MM-dd HH:mm:ss'))"
  Add-Report "invoked        : Silent=$Silent SkipApp=$SkipApp SkipSkills=$SkipSkills Diagnose=$Diagnose"
  Add-Report ''
  Add-Report '-- environment --'
  Add-Report "powershell     : $($PSVersionTable.PSVersion) ($($PSVersionTable.PSEdition))"

  try {
    $os = Get-CimInstance Win32_OperatingSystem -ErrorAction Stop
    Add-Report "os             : $($os.Caption) build $($os.BuildNumber) $($os.OSArchitecture)"
  } catch {
    Add-Report "os             : could not query ($($_.Exception.Message))"
  }

  Add-Report "process arch   : $env:PROCESSOR_ARCHITECTURE"

  try {
    $identity  = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    $elevated  = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    Add-Report "elevated       : $elevated  (not required)"
  } catch {
    Add-Report "elevated       : unknown ($($_.Exception.Message))"
  }

  try {
    Add-Report "exec policy    : $(Get-ExecutionPolicy)"
  } catch {
    Add-Report "exec policy    : unknown"
  }

  Add-Report ''
  Add-Report '-- tools --'
  Add-Report "node           : $(Get-ToolLine -Name 'node')"
  Add-Report "npm            : $(Get-ToolLine -Name 'npm')"
  Add-Report "npx            : $(Get-ToolLine -Name 'npx')"
  Add-Report "git            : $(Get-ToolLine -Name 'git')"

  Add-Report ''
  Add-Report '-- orca state --'
  $found = $false
  foreach ($path in (Get-OrcaPaths)) {
    if (Test-Path -LiteralPath $path) {
      $found = $true
      $version = 'unknown'
      try {
        $info = (Get-Item -LiteralPath $path).VersionInfo
        if ($info -and $info.ProductVersion) { $version = $info.ProductVersion }
      } catch { }
      Add-Report "present        : $path (v$version)"
    } else {
      Add-Report "absent         : $path"
    }
  }
  if (-not $found) { Add-Report "               : Orca not installed yet" }

  try {
    $running = @(Get-Process -Name 'Orca' -ErrorAction SilentlyContinue)
    Add-Report "running procs  : $($running.Count)"
  } catch {
    Add-Report "running procs  : could not query"
  }
}

# ---------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------

# $IsWindows only exists on PowerShell 6+. Under Set-StrictMode, naming it on
# Windows PowerShell 5.1 would throw, so the 5.1 branch never evaluates it.
$onWindows = $true
if ($PSVersionTable.PSVersion.Major -ge 6) { $onWindows = $IsWindows }
if (-not $onWindows) {
  throw 'This installer is for Windows. On Linux use orca-kit/server/install.sh; on macOS use: brew install --cask stablyai/orca/orca'
}

$stamp = (Get-Date).ToUniversalTime().ToString('yyyyMMdd-HHmmss')
if (-not $ReportPath) {
  $ReportPath = Join-Path ([System.IO.Path]::GetTempPath()) "orca-kit-report-$stamp.txt"
}
$transcriptPath = Join-Path ([System.IO.Path]::GetTempPath()) "orca-kit-transcript-$stamp.log"

$transcribing = $false
try {
  Start-Transcript -Path $transcriptPath -ErrorAction Stop | Out-Null
  $transcribing = $true
} catch {
  Write-Host "    (transcript unavailable: $($_.Exception.Message))" -ForegroundColor DarkGray
}

try {
  Add-EnvironmentReport

  if ($Diagnose) {
    Write-Step 'Diagnose only — nothing will be installed'
  }

  # --- 1. the app ------------------------------------------------------------
  if (-not $SkipApp -and -not $Diagnose) {
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
    Add-Report "    signature status: $($signature.Status)"
    if ($signature.Status -eq 'Valid') {
      $subject = 'unknown'
      try {
        if ($signature.SignerCertificate) {
          $subject = $signature.SignerCertificate.Subject.Split(',')[0]
        }
      } catch { }
      Write-Note "signature: valid ($subject)"
    } else {
      Write-Warn "signature status is '$($signature.Status)'. Orca's Windows builds are signed via SignPath;"
      Write-Warn 'if this is not Valid, stop and download manually from https://onorca.dev/download'
      if ($Silent) {
        throw "Refusing to run an installer with signature status '$($signature.Status)' in -Silent mode."
      }
      $answer = Read-Host 'Continue anyway? (y/N)'
      Add-Report "    operator answered: $answer"
      if ($answer -ne 'y') { throw 'Aborted at signature check.' }
    }

    Write-Step 'Running the installer'
    if ($Silent) {
      Write-Note 'silent mode (/S)'
    } else {
      Write-Note 'the installer window will appear; it closes on its own'
    }
    $processArgs = @{ FilePath = $setup; Wait = $true; PassThru = $true }
    if ($Silent) { $processArgs['ArgumentList'] = '/S' }
    $process = Start-Process @processArgs
    Add-Report "    installer exit code: $($process.ExitCode)"
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

  # --- 2. agent skills -------------------------------------------------------
  if (-not $SkipSkills -and -not $Diagnose) {
    Write-Step 'Installing Orca agent skills for Claude Code'
    $npx = Get-Command npx -ErrorAction SilentlyContinue
    if (-not $npx) {
      Write-Warn 'node/npx not found, so the skills were skipped.'
      Write-Warn 'Install Node.js (https://nodejs.org), then run this script again with -SkipApp.'
    } else {
      # This is exactly the command `orca skills install --skill orca-cli
      # --skill orchestration` resolves to. --yes and -y are load-bearing:
      # without them the skills CLI opens an interactive agent picker and blocks.
      # These are the skills CLI's own agent ids, not Orca's. Gemini is
      # 'gemini-cli' (not 'gemini'), and Grok keeps its own ~/.grok/skills, so
      # 'universal' alone does not reach either of them.
      $agentTargets = @('claude-code', 'gemini-cli', 'grok', 'universal')
      $skillArgs = @(
        '--yes', 'skills', 'add', $SkillsRepo,
        '--skill', 'orca-cli',
        '--skill', 'orchestration',
        '--global'
      )
      foreach ($agent in $agentTargets) { $skillArgs += @('--agent', $agent) }
      $skillArgs += '-y'

      Write-Note "npx $($skillArgs -join ' ')"
      $skillOutput = & npx @skillArgs 2>&1
      foreach ($line in $skillOutput) {
        Write-Host "    $line"
        Add-Report "    | $line"
      }
      Add-Report "    skills exit code: $LASTEXITCODE"

      # The real files land in ~/.agents/skills and Claude Code and Grok get
      # symlinks into it. Creating a directory symlink on Windows needs
      # Developer Mode or an elevated shell, so retry as plain copies rather
      # than leave the skills half-installed.
      if ($LASTEXITCODE -ne 0) {
        Write-Warn "the skills CLI exited $LASTEXITCODE - retrying with --copy (no symlinks)"
        $copyArgs = $skillArgs + '--copy'
        $copyOutput = & npx @copyArgs 2>&1
        foreach ($line in $copyOutput) {
          Write-Host "    $line"
          Add-Report "    | $line"
        }
        Add-Report "    skills --copy exit code: $LASTEXITCODE"
        if ($LASTEXITCODE -ne 0) {
          Write-Warn "still failing. Orca itself is fine; re-run with -SkipApp to retry."
        } else {
          Write-Note 'skills installed globally (copied) for Claude Code, Gemini CLI and Grok'
        }
      } else {
        Write-Note 'skills installed globally for Claude Code, Gemini CLI and Grok'
      }
    }
  }

  if (-not $Diagnose) {
    Add-Report ''
    Add-Report 'RESULT: completed'
  }
} catch {
  $script:Failed = $true
  Add-Report ''
  Add-Report 'RESULT: FAILED'
  Add-Report "  message  : $($_.Exception.Message)"
  Add-Report "  type     : $($_.Exception.GetType().FullName)"
  try {
    Add-Report "  where    : $($_.InvocationInfo.ScriptLineNumber): $($_.InvocationInfo.Line.Trim())"
  } catch { }
  Write-Host ''
  Write-Host "Install failed: $($_.Exception.Message)" -ForegroundColor Red
} finally {
  if ($transcribing) {
    try { Stop-Transcript | Out-Null } catch { }
  }

  $reportText = ($script:Report -join [Environment]::NewLine)
  try {
    Set-Content -LiteralPath $ReportPath -Value $reportText -Encoding UTF8
  } catch {
    Write-Host "    (could not write report: $($_.Exception.Message))" -ForegroundColor DarkGray
  }

  Write-Host ''
  Write-Host '----------------- copy from here -----------------' -ForegroundColor DarkGray
  Write-Host $reportText
  Write-Host '------------------ to here -----------------------' -ForegroundColor DarkGray
  Write-Host ''
  Write-Host "report saved     : $ReportPath"
  if ($transcribing) {
    Write-Host "full transcript  : $transcriptPath  (NOT redacted - local only)"
  }
  Write-Host 'The block above is redacted (no username, hostname or profile paths).'
}

if ($script:Failed) { exit 1 }

if (-not $Diagnose) {
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
}
