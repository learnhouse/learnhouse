# ─────────────────────────────────────────────────────────────
# LearnHouse — Install Script (Windows PowerShell)
# Installs Docker and Node.js if missing, then runs the CLI.
#
# Usage:
#   irm https://raw.githubusercontent.com/learnhouse/learnhouse/main/apps/cli/install.ps1 | iex
# ─────────────────────────────────────────────────────────────

$ErrorActionPreference = "Stop"

function Write-Info($msg)  { Write-Host "▸ $msg" -ForegroundColor Cyan }
function Write-Ok($msg)    { Write-Host "✓ $msg" -ForegroundColor Green }
function Write-Warn($msg)  { Write-Host "! $msg" -ForegroundColor Yellow }
function Write-Fail($msg)  { Write-Host "✗ $msg" -ForegroundColor Red; exit 1 }

Write-Host ""
Write-Host "LearnHouse Installer" -ForegroundColor White -NoNewline
Write-Host ""
Write-Host "Platform: Windows ($env:PROCESSOR_ARCHITECTURE)" -ForegroundColor DarkGray
Write-Host ""

# ── Check for winget ─────────────────────────────────────────

$hasWinget = Get-Command winget -ErrorAction SilentlyContinue

# ── Check / Install Docker ───────────────────────────────────

$dockerCmd = Get-Command docker -ErrorAction SilentlyContinue
if ($dockerCmd) {
    $dockerVersion = & docker --version 2>&1
    Write-Ok "Docker already installed — $dockerVersion"
} else {
    Write-Info "Docker not found. Installing..."

    if ($hasWinget) {
        Write-Info "Installing Docker Desktop via winget..."
        winget install -e --id Docker.DockerDesktop --accept-package-agreements --accept-source-agreements
        Write-Ok "Docker Desktop installed"
    } else {
        # Try chocolatey
        $hasChoco = Get-Command choco -ErrorAction SilentlyContinue
        if ($hasChoco) {
            Write-Info "Installing Docker Desktop via Chocolatey..."
            choco install docker-desktop -y
            Write-Ok "Docker Desktop installed"
        } else {
            Write-Fail "winget or Chocolatey is required to install Docker. Install manually: https://docs.docker.com/desktop/install/windows-install/"
        }
    }

    Write-Host ""
    Write-Warn "Docker Desktop has been installed. You may need to restart your computer."
    Write-Warn "After restarting, open Docker Desktop and wait for it to start, then re-run this script."
    Write-Host ""
}

# Check Docker daemon
try {
    $null = & docker info 2>&1
    Write-Ok "Docker daemon is running"
} catch {
    Write-Warn "Docker is installed but the daemon is not running."
    Write-Host "  Start Docker Desktop from the Start Menu" -ForegroundColor DarkGray
}

# ── Check / Install Node.js ─────────────────────────────────

$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
$needNode = $false

if ($nodeCmd) {
    $nodeVersion = & node --version 2>&1
    $nodeMajor = [int]($nodeVersion -replace 'v(\d+)\..*', '$1')
    if ($nodeMajor -ge 18) {
        Write-Ok "Node.js already installed — $nodeVersion"
    } else {
        Write-Warn "Node.js $nodeVersion is too old (need ≥18). Installing newer version..."
        $needNode = $true
    }
} else {
    Write-Info "Node.js not found. Installing..."
    $needNode = $true
}

if ($needNode) {
    if ($hasWinget) {
        Write-Info "Installing Node.js 20 via winget..."
        winget install -e --id OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements
        Write-Ok "Node.js installed"
    } else {
        $hasChoco = Get-Command choco -ErrorAction SilentlyContinue
        if ($hasChoco) {
            Write-Info "Installing Node.js 20 via Chocolatey..."
            choco install nodejs-lts -y
            Write-Ok "Node.js installed"
        } else {
            Write-Fail "winget or Chocolatey is required to install Node.js. Install manually: https://nodejs.org"
        }
    }

    # Refresh PATH
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")
}

# ── Check npx ────────────────────────────────────────────────

$npxCmd = Get-Command npx -ErrorAction SilentlyContinue
if ($npxCmd) {
    Write-Ok "npx available"
} else {
    Write-Fail "npx not found. It should come with Node.js. Try restarting your terminal or reinstalling Node.js."
}

# ── Summary ──────────────────────────────────────────────────

Write-Host ""
Write-Host "All dependencies installed!" -ForegroundColor Green
Write-Host ""
Write-Host "  Run LearnHouse with:" -ForegroundColor DarkGray
Write-Host "  npx learnhouse@latest" -ForegroundColor Cyan
Write-Host ""

# ── Launch ───────────────────────────────────────────────────

Write-Host "Launching LearnHouse..." -ForegroundColor Cyan
Write-Host ""
& npx learnhouse@latest
