#Requires -Version 5.1
<#
  Trex one-step setup and launcher for Windows.

    Inside a clone:   .\setup.ps1      (or double-click setup.cmd)
    From anywhere:    irm https://raw.githubusercontent.com/mhbdev/trex/main/setup.ps1 | iex

  What it does: installs Bun if missing, downloads Trex if this is not a clone, installs
  dependencies, builds the dashboard on first run, creates the encryption key automatically,
  starts the local service, and opens the dashboard in your browser. If Trex is already
  running, it just opens the browser. Set TREX_HOME to change the install folder and
  TREX_PORT to change the port.
#>

function Invoke-TrexSetup {
  param([switch] $Update)
  $ErrorActionPreference = "Stop"
  $repoUrl = "https://github.com/mhbdev/trex.git"
  $archiveUrl = "https://github.com/mhbdev/trex/archive/refs/heads/main.zip"
  $installDir = if ($env:TREX_HOME) { $env:TREX_HOME } else { Join-Path $HOME "trex" }
  $port = if ($env:TREX_PORT) { $env:TREX_PORT } else { "4173" }

  function Say([string] $message) { Write-Host ""; Write-Host "==> $message" -ForegroundColor Cyan }
  function Have([string] $name) { return [bool](Get-Command $name -ErrorAction SilentlyContinue) }
  function Test-TrexProject([string] $dir) {
    $manifest = Join-Path $dir "package.json"
    return (Test-Path $manifest) -and ((Get-Content $manifest -Raw) -match '"name":\s*"trex"')
  }

  function Install-TrexArchive([string] $destination) {
    $temp = [IO.Path]::GetTempPath()
    $zip = Join-Path $temp "trex-main.zip"
    $extract = Join-Path $temp ("trex-extract-" + [guid]::NewGuid().ToString("N"))
    Invoke-WebRequest -Uri $archiveUrl -OutFile $zip -UseBasicParsing
    Expand-Archive -Path $zip -DestinationPath $extract -Force
    New-Item -ItemType Directory -Force -Path $destination | Out-Null
    Get-ChildItem -Force (Join-Path $extract "trex-main") | Copy-Item -Destination $destination -Recurse -Force
    Remove-Item $zip, $extract -Recurse -Force -ErrorAction SilentlyContinue
  }

  # 1. Find the project: the folder this script lives in, an existing install, or a fresh download.
  $scriptDir = $PSScriptRoot  # empty when the script is piped through Invoke-Expression
  $downloaded = $false
  if ($scriptDir -and (Test-TrexProject $scriptDir)) {
    $projectDir = $scriptDir
  } elseif (Test-TrexProject $installDir) {
    $projectDir = $installDir
  } else {
    Say "Downloading Trex into $installDir"
    if ((Test-Path $installDir) -and (Get-ChildItem -Force $installDir | Select-Object -First 1)) {
      throw "$installDir exists but is not a Trex folder. Set TREX_HOME to another folder."
    }
    if (Have "git") {
      git clone --depth 1 $repoUrl $installDir
      if ($LASTEXITCODE -ne 0) { throw "git clone failed." }
    } else {
      Install-TrexArchive $installDir
    }
    $projectDir = $installDir
    $downloaded = $true
  }

  # 1b. Update an existing install when asked (.\setup.ps1 update, or TREX_UPDATE=1). Data lives outside the project folder and is untouched.
  if ($Update -and -not $downloaded) {
    Say "Updating Trex in $projectDir"
    if ((Test-Path (Join-Path $projectDir ".git")) -and (Have "git")) {
      git -C $projectDir pull --ff-only
      if ($LASTEXITCODE -ne 0) { throw "Could not update with git pull. Commit or discard local changes in $projectDir and rerun." }
    } else {
      Install-TrexArchive $projectDir
    }
  }

  # 2. Bun runtime (https://bun.sh), installed per-user when missing.
  $bunBin = Join-Path $HOME ".bun\bin"
  if (-not (($env:PATH -split ";") -contains $bunBin)) { $env:PATH = "$bunBin;$env:PATH" }
  if (-not (Have "bun")) {
    Say "Installing Bun, the JavaScript runtime Trex uses"
    powershell -NoProfile -ExecutionPolicy Bypass -Command "irm bun.sh/install.ps1 | iex"
    if (-not (Have "bun")) { throw "Bun was installed but is not on PATH yet. Open a new terminal and rerun this script." }
  }
  $version = (& bun --version).Trim()
  $parts = $version.Split(".")
  if ([int]$parts[0] -lt 1 -or ([int]$parts[0] -eq 1 -and [int]$parts[1] -lt 2)) {
    throw "Bun $version is too old. Run 'bun upgrade' (Trex needs 1.2 or newer) and rerun this script."
  }

  # 3. Dependencies, then launch. The launcher builds the UI on first run and opens the browser.
  Set-Location $projectDir
  Say "Installing dependencies"
  & bun install
  if ($LASTEXITCODE -ne 0) { throw "bun install failed." }

  # 4. Desktop shortcut that runs this same launcher next time (skip with TREX_NO_SHORTCUT=1).
  if (-not $env:TREX_NO_SHORTCUT) {
    try {
      $desktop = [Environment]::GetFolderPath("Desktop")
      $shortcutPath = if ($desktop) { Join-Path $desktop "Trex.lnk" } else { "" }
      if ($shortcutPath -and (Test-Path $desktop) -and -not (Test-Path $shortcutPath)) {
        $shell = New-Object -ComObject WScript.Shell
        $shortcut = $shell.CreateShortcut($shortcutPath)
        $shortcut.TargetPath = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"
        $shortcut.Arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$(Join-Path $projectDir 'setup.ps1')`""
        $shortcut.WorkingDirectory = $projectDir
        $shortcut.Description = "Start or open the Trex dashboard"
        $shortcut.Save()
        Say "Added a Trex shortcut to your desktop"
      }
    } catch { Write-Host "Could not create a desktop shortcut: $($_.Exception.Message)" -ForegroundColor Yellow }
  }

  Say "Starting Trex (press Ctrl+C to stop it)"
  $startArgs = @("run", "--no-env-file", "apps/cli/src/main.ts", "start", "--port", $port)
  if ($Update) { $startArgs += "--rebuild" }
  & bun @startArgs
  exit $LASTEXITCODE
}

# "update" as an argument, or TREX_UPDATE=1 in the environment (the only option when piped through iex), refreshes an existing install first.
$requestedUpdate = [bool]$env:TREX_UPDATE -or (@($args) -contains "update") -or (@($args) -contains "-Update")
if ($env:TREX_UPDATE) { Remove-Item Env:TREX_UPDATE -ErrorAction SilentlyContinue }
Invoke-TrexSetup -Update:$requestedUpdate
