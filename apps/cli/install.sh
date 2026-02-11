#!/usr/bin/env bash
set -euo pipefail

# ─────────────────────────────────────────────────────────────
# LearnHouse — Install Script (macOS & Linux)
# Installs Docker and Node.js if missing, then runs the CLI.
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/learnhouse/learnhouse/main/apps/cli/install.sh | bash
# ─────────────────────────────────────────────────────────────

BOLD="\033[1m"
DIM="\033[2m"
CYAN="\033[36m"
GREEN="\033[32m"
YELLOW="\033[33m"
RED="\033[31m"
RESET="\033[0m"

info()  { echo -e "${CYAN}▸${RESET} $1"; }
ok()    { echo -e "${GREEN}✓${RESET} $1"; }
warn()  { echo -e "${YELLOW}!${RESET} $1"; }
fail()  { echo -e "${RED}✗${RESET} $1"; exit 1; }

# ── Detect OS ────────────────────────────────────────────────

OS="$(uname -s)"
ARCH="$(uname -m)"

case "$OS" in
  Darwin) PLATFORM="macos" ;;
  Linux)  PLATFORM="linux" ;;
  *)      fail "Unsupported OS: $OS. Use install.ps1 for Windows." ;;
esac

echo ""
echo -e "${BOLD}LearnHouse Installer${RESET}"
echo -e "${DIM}Platform: $PLATFORM ($ARCH)${RESET}"
echo ""

# ── Check / Install Docker ──────────────────────────────────

if command -v docker &>/dev/null; then
  DOCKER_VERSION=$(docker --version 2>/dev/null | head -1)
  ok "Docker already installed — $DOCKER_VERSION"
else
  info "Docker not found. Installing..."

  if [ "$PLATFORM" = "macos" ]; then
    # macOS — use Homebrew
    if ! command -v brew &>/dev/null; then
      fail "Homebrew is required to install Docker on macOS. Install it first: https://brew.sh"
    fi
    info "Installing Docker via Homebrew..."
    brew install --cask docker
    echo ""
    warn "Docker Desktop has been installed but needs to be started manually."
    warn "Open Docker Desktop from Applications, then re-run this script."
    echo ""

    # Check if Docker daemon is running
    if ! docker info &>/dev/null 2>&1; then
      warn "Docker daemon is not running. Start Docker Desktop first."
      echo -e "${DIM}  Open Docker from Applications or run: open -a Docker${RESET}"
      echo ""
      echo -e "${DIM}  After Docker is running, re-run:${RESET}"
      echo -e "${DIM}  npx learnhouse${RESET}"
      exit 0
    fi

  elif [ "$PLATFORM" = "linux" ]; then
    # Linux — use Docker's official convenience script
    if command -v curl &>/dev/null; then
      info "Installing Docker via official install script..."
      curl -fsSL https://get.docker.com | sh
    elif command -v wget &>/dev/null; then
      info "Installing Docker via official install script..."
      wget -qO- https://get.docker.com | sh
    else
      fail "curl or wget is required to install Docker."
    fi

    # Add current user to docker group
    if [ "$(id -u)" -ne 0 ]; then
      if command -v sudo &>/dev/null; then
        sudo usermod -aG docker "$USER"
        warn "Added $USER to the docker group. Log out and back in for it to take effect."
      fi
    fi

    ok "Docker installed"
  fi
fi

# Verify Docker daemon is running
if docker info &>/dev/null 2>&1; then
  ok "Docker daemon is running"
else
  warn "Docker is installed but the daemon is not running."
  if [ "$PLATFORM" = "macos" ]; then
    echo -e "${DIM}  Start Docker Desktop from Applications${RESET}"
  else
    echo -e "${DIM}  Start with: sudo systemctl start docker${RESET}"
  fi
fi

# ── Check / Install Docker Compose v2 ───────────────────────

if docker compose version &>/dev/null 2>&1; then
  ok "Docker Compose v2 available"
else
  warn "Docker Compose v2 not found. It's included with Docker Desktop."
  if [ "$PLATFORM" = "linux" ]; then
    info "Installing docker-compose-plugin..."
    if command -v apt-get &>/dev/null; then
      sudo apt-get update -qq && sudo apt-get install -y -qq docker-compose-plugin
    elif command -v dnf &>/dev/null; then
      sudo dnf install -y docker-compose-plugin
    elif command -v yum &>/dev/null; then
      sudo yum install -y docker-compose-plugin
    else
      warn "Could not auto-install. See: https://docs.docker.com/compose/install/linux/"
    fi
  fi
fi

# ── Check / Install Node.js ─────────────────────────────────

if command -v node &>/dev/null; then
  NODE_VERSION=$(node --version 2>/dev/null)
  NODE_MAJOR=$(echo "$NODE_VERSION" | sed 's/v//' | cut -d. -f1)
  if [ "$NODE_MAJOR" -ge 18 ]; then
    ok "Node.js already installed — $NODE_VERSION"
  else
    warn "Node.js $NODE_VERSION is too old (need ≥18). Installing newer version..."
    NEED_NODE=true
  fi
else
  info "Node.js not found. Installing..."
  NEED_NODE=true
fi

if [ "${NEED_NODE:-false}" = "true" ]; then
  if [ "$PLATFORM" = "macos" ]; then
    if command -v brew &>/dev/null; then
      info "Installing Node.js 20 via Homebrew..."
      brew install node@20
      brew link --overwrite node@20 2>/dev/null || true
      ok "Node.js installed"
    else
      fail "Homebrew is required to install Node.js on macOS. Install it first: https://brew.sh"
    fi

  elif [ "$PLATFORM" = "linux" ]; then
    # Use NodeSource for reliable Node.js install
    if command -v curl &>/dev/null; then
      info "Installing Node.js 20 via NodeSource..."
      curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
      sudo apt-get install -y -qq nodejs 2>/dev/null || {
        # Fallback for non-Debian systems
        if command -v dnf &>/dev/null; then
          curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash -
          sudo dnf install -y nodejs
        else
          fail "Could not auto-install Node.js. Install manually: https://nodejs.org"
        fi
      }
      ok "Node.js installed"
    else
      fail "curl is required to install Node.js."
    fi
  fi
fi

# ── Check npm / npx ─────────────────────────────────────────

if command -v npx &>/dev/null; then
  ok "npx available"
else
  fail "npx not found. It should come with Node.js. Try reinstalling Node.js."
fi

# ── Summary ──────────────────────────────────────────────────

echo ""
echo -e "${GREEN}${BOLD}All dependencies installed!${RESET}"
echo ""
echo -e "${DIM}  Run LearnHouse with:${RESET}"
echo -e "  ${CYAN}npx learnhouse@latest${RESET}"
echo ""

# ── Launch ───────────────────────────────────────────────────

echo -e "${CYAN}Launching LearnHouse...${RESET}"
echo ""
npx learnhouse@latest
