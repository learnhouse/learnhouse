# -------------------------------------------------------------
# LearnHouse Install Script (Windows PowerShell)
# Installs Docker and Node.js if missing, then runs the CLI.
#
# Usage:
#   irm https://raw.githubusercontent.com/learnhouse/learnhouse/main/apps/cli/install.ps1 | iex
#
# Output is plain ASCII so it renders on consoles without UTF-8. Failures
# throw instead of calling `exit`, which would close the user's PowerShell
# window under `irm | iex` before the message could be read.
# -------------------------------------------------------------

function Install-LearnHouse {
    # Native commands (docker, winget, choco) are checked via $LASTEXITCODE.
    # "Stop" would turn harmless stderr output into terminating errors on
    # Windows PowerShell 5.1, so keep the default here (scoped to this function).
    $ErrorActionPreference = "Continue"

    $nodeMinMajor = 22

    function Write-Info($msg)  { Write-Host "> $msg" -ForegroundColor Cyan }
    function Write-Ok($msg)    { Write-Host "[ok] $msg" -ForegroundColor Green }
    function Write-Warn($msg)  { Write-Host "[!] $msg" -ForegroundColor Yellow }
    function Write-Fail($msg)  { throw $msg }

    # winget reports "already installed / no newer version" as non-zero codes
    # (0x8A15002B, 0x8A150061); choco uses 3010/1641 for "reboot required".
    function Test-InstallOk($code) {
        return @(0, -1978335189, -1978335135, 3010, 1641) -contains $code
    }

    function Update-SessionPath {
        $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")
    }

    function Get-NodeMajor {
        if (-not (Get-Command node -ErrorAction SilentlyContinue)) { return 0 }
        $version = "$(& node --version 2>$null)"
        if ($version -match '^v(\d+)\.') { return [int]$Matches[1] }
        return 0
    }

    Write-Host ""
    Write-Host "LearnHouse Installer" -ForegroundColor White
    Write-Host "Platform: Windows ($env:PROCESSOR_ARCHITECTURE)" -ForegroundColor DarkGray
    Write-Host ""

    # -- Check for winget / Chocolatey ----------------------------

    $hasWinget = Get-Command winget -ErrorAction SilentlyContinue
    $hasChoco = Get-Command choco -ErrorAction SilentlyContinue

    # -- Check / Install Docker -----------------------------------

    $dockerCmd = Get-Command docker -ErrorAction SilentlyContinue
    if ($dockerCmd) {
        $dockerVersion = & docker --version 2>&1
        Write-Ok "Docker already installed: $dockerVersion"
    } else {
        Write-Info "Docker not found. Installing..."

        if ($hasWinget) {
            Write-Info "Installing Docker Desktop via winget..."
            winget install -e --id Docker.DockerDesktop --accept-package-agreements --accept-source-agreements
            if (-not (Test-InstallOk $LASTEXITCODE)) {
                Write-Fail "winget could not install Docker Desktop (exit code $LASTEXITCODE). Install it manually: https://docs.docker.com/desktop/install/windows-install/"
            }
        } elseif ($hasChoco) {
            Write-Info "Installing Docker Desktop via Chocolatey..."
            choco install docker-desktop -y
            if (-not (Test-InstallOk $LASTEXITCODE)) {
                Write-Fail "Chocolatey could not install Docker Desktop (exit code $LASTEXITCODE). Install it manually: https://docs.docker.com/desktop/install/windows-install/"
            }
        } else {
            Write-Fail "winget or Chocolatey is required to install Docker. Install manually: https://docs.docker.com/desktop/install/windows-install/"
        }

        # Docker Desktop can't be used until it has been started (and often
        # after a restart), so stop here rather than continue half-ready.
        Write-Ok "Docker Desktop installed"
        Write-Host ""
        Write-Warn "Docker Desktop must be started before LearnHouse can use it."
        Write-Host "  1. Restart your computer if the installer asked you to" -ForegroundColor DarkGray
        Write-Host "  2. Open Docker Desktop from the Start Menu and wait for it to finish starting" -ForegroundColor DarkGray
        Write-Host "  3. Re-run this installer" -ForegroundColor DarkGray
        Write-Host ""
        return
    }

    # Check Docker daemon
    & docker info *> $null
    if ($LASTEXITCODE -eq 0) {
        Write-Ok "Docker daemon is running"
    } else {
        Write-Warn "Docker is installed but the daemon is not running."
        Write-Host "  Start Docker Desktop from the Start Menu" -ForegroundColor DarkGray
    }

    # -- Check / Install Node.js ----------------------------------

    $nodeMajor = Get-NodeMajor
    if ($nodeMajor -ge $nodeMinMajor) {
        Write-Ok "Node.js already installed: $(& node --version 2>$null)"
    } else {
        if ($nodeMajor -gt 0) {
            Write-Warn "Node.js $(& node --version 2>$null) is too old (need >=$nodeMinMajor). Installing Node.js 24 LTS..."
        } else {
            Write-Info "Node.js not found. Installing..."
        }

        if ($hasWinget) {
            Write-Info "Installing Node.js 24 LTS via winget..."
            winget install -e --id OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements
            if (-not (Test-InstallOk $LASTEXITCODE)) {
                Write-Fail "winget could not install Node.js (exit code $LASTEXITCODE). Install Node.js 24 LTS manually: https://nodejs.org"
            }
        } elseif ($hasChoco) {
            Write-Info "Installing Node.js 24 LTS via Chocolatey..."
            choco install nodejs-lts -y
            if (-not (Test-InstallOk $LASTEXITCODE)) {
                Write-Fail "Chocolatey could not install Node.js (exit code $LASTEXITCODE). Install Node.js 24 LTS manually: https://nodejs.org"
            }
        } else {
            Write-Fail "winget or Chocolatey is required to install Node.js. Install Node.js 24 LTS manually: https://nodejs.org"
        }

        # Refresh PATH
        Update-SessionPath

        $nodeMajor = Get-NodeMajor
        if ($nodeMajor -lt $nodeMinMajor) {
            Write-Fail "Node.js >=$nodeMinMajor is required but was not found on PATH after installing. Open a new terminal and re-run, or install Node.js 24 LTS manually: https://nodejs.org"
        }
        Write-Ok "Node.js installed: $(& node --version 2>$null)"
    }

    # -- Check npx ------------------------------------------------

    # Call npx.cmd, not npx: the npx.ps1 shim is blocked by the default
    # Restricted execution policy.
    $npxCmd = Get-Command npx.cmd -ErrorAction SilentlyContinue
    if ($npxCmd) {
        Write-Ok "npx available"
    } else {
        Write-Fail "npx not found. It should come with Node.js. Try restarting your terminal or reinstalling Node.js."
    }

    # -- Summary --------------------------------------------------

    Write-Host ""
    Write-Host "All dependencies installed!" -ForegroundColor Green
    Write-Host ""
    Write-Host "  Run LearnHouse setup with:" -ForegroundColor DarkGray
    Write-Host "  npx learnhouse@latest setup" -ForegroundColor Cyan
    Write-Host ""

    # -- Launch ---------------------------------------------------

    Write-Host "Launching LearnHouse setup..." -ForegroundColor Cyan
    Write-Host ""
    & npx.cmd learnhouse@latest setup
}

try {
    Install-LearnHouse
} catch {
    Write-Host "[x] $($_.Exception.Message)" -ForegroundColor Red
}
