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

need_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    fail "$1 is required but not installed."
  fi
}

# Helper: run a command with sudo only when not already root
maybe_sudo() {
  if [ "$(id -u)" -eq 0 ]; then
    "$@"
  else
    sudo "$@"
  fi
}

DOCKER_GROUP_CHANGED=false

# ── Detect OS ────────────────────────────────────────────────

OS="$(uname -s)"
ARCH="$(uname -m)"

case "$OS" in
  Darwin) PLATFORM="macos" ;;
  Linux)  PLATFORM="linux" ;;
  *)      fail "Unsupported OS: $OS. Use install.ps1 for Windows." ;;
esac

# Detect Linux package manager
PKG=""
if [ "$PLATFORM" = "linux" ]; then
  if command -v apt-get >/dev/null 2>&1; then
    PKG="apt"
  elif command -v dnf >/dev/null 2>&1; then
    PKG="dnf"
  elif command -v yum >/dev/null 2>&1; then
    PKG="yum"
  elif command -v pacman >/dev/null 2>&1; then
    PKG="pacman"
  elif command -v zypper >/dev/null 2>&1; then
    PKG="zypper"
  fi
fi

echo ""
echo -e "${BOLD}LearnHouse Installer${RESET}"
echo -e "${DIM}Platform: $PLATFORM ($ARCH)${RESET}"
echo ""

# ── Ensure curl is available (Linux) ─────────────────────────

if [ "$PLATFORM" = "linux" ] && ! command -v curl >/dev/null 2>&1; then
  info "Installing curl..."
  case "$PKG" in
    apt)    maybe_sudo apt-get update -qq && maybe_sudo apt-get install -y -qq curl ;;
    dnf)    maybe_sudo dnf install -y -q curl ;;
    yum)    maybe_sudo yum install -y -q curl ;;
    pacman) maybe_sudo pacman -Sy --noconfirm curl ;;
    zypper) maybe_sudo zypper install -y curl ;;
    *)      fail "curl is required. Install it manually and re-run." ;;
  esac
fi

# ── Check / Install Docker ──────────────────────────────────

if command -v docker >/dev/null 2>&1; then
  DOCKER_VERSION=$(docker --version 2>/dev/null | head -1)
  ok "Docker already installed — $DOCKER_VERSION"
else
  info "Docker not found. Installing..."

  if [ "$PLATFORM" = "macos" ]; then
    if ! command -v brew >/dev/null 2>&1; then
      fail "Homebrew is required to install Docker on macOS. Install it first: https://brew.sh"
    fi
    info "Installing Docker via Homebrew..."
    brew install --cask docker
    echo ""
    warn "Docker Desktop has been installed but needs to be started manually."
    warn "Open Docker Desktop from Applications, then re-run this script."
    echo ""

    if ! docker info >/dev/null 2>&1; then
      warn "Docker daemon is not running. Start Docker Desktop first."
      echo -e "${DIM}  Open Docker from Applications or run: open -a Docker${RESET}"
      echo ""
      echo -e "${DIM}  After Docker is running, re-run:${RESET}"
      echo -e "${DIM}  npx learnhouse${RESET}"
      exit 0
    fi

  elif [ "$PLATFORM" = "linux" ]; then
    need_cmd curl
    info "Installing Docker via official install script..."
    curl -fsSL https://get.docker.com | maybe_sudo sh

    # Enable and start the Docker daemon
    if command -v systemctl >/dev/null 2>&1; then
      maybe_sudo systemctl enable docker
      maybe_sudo systemctl start docker
      ok "Docker daemon enabled and started"
    fi

    # Add current user to docker group so sudo isn't needed
    if [ "$(id -u)" -ne 0 ]; then
      maybe_sudo usermod -aG docker "$USER"
      DOCKER_GROUP_CHANGED=true
      ok "Added $USER to the docker group"
    fi

    ok "Docker installed"
  fi
fi

# Verify Docker daemon is running (try without sudo first, then with)
if docker info >/dev/null 2>&1; then
  ok "Docker daemon is running"
elif maybe_sudo docker info >/dev/null 2>&1; then
  ok "Docker daemon is running (requires sudo until next login)"
else
  warn "Docker is installed but the daemon is not running."
  if [ "$PLATFORM" = "macos" ]; then
    echo -e "${DIM}  Start Docker Desktop from Applications${RESET}"
  else
    echo -e "${DIM}  Start with: sudo systemctl start docker${RESET}"
  fi
fi

# ── Check / Install Docker Compose v2 ───────────────────────

if docker compose version >/dev/null 2>&1 || maybe_sudo docker compose version >/dev/null 2>&1; then
  ok "Docker Compose v2 available"
else
  if [ "$PLATFORM" = "linux" ]; then
    info "Installing docker-compose-plugin..."
    case "$PKG" in
      apt)    maybe_sudo apt-get update -qq && maybe_sudo apt-get install -y -qq docker-compose-plugin ;;
      dnf)    maybe_sudo dnf install -y docker-compose-plugin ;;
      yum)    maybe_sudo yum install -y docker-compose-plugin ;;
      pacman) maybe_sudo pacman -Sy --noconfirm docker-compose ;;
      zypper) maybe_sudo zypper install -y docker-compose ;;
      *)      warn "Could not auto-install Docker Compose. See: https://docs.docker.com/compose/install/linux/" ;;
    esac

    if docker compose version >/dev/null 2>&1 || maybe_sudo docker compose version >/dev/null 2>&1; then
      ok "Docker Compose v2 installed"
    else
      warn "Docker Compose v2 could not be installed. See: https://docs.docker.com/compose/install/linux/"
    fi
  else
    warn "Docker Compose v2 not found. It's included with Docker Desktop."
  fi
fi

# ── Check / Install Node.js ─────────────────────────────────

NEED_NODE=false

if command -v node >/dev/null 2>&1; then
  NODE_VERSION=$(node --version 2>/dev/null)
  NODE_MAJOR=$(echo "$NODE_VERSION" | sed 's/v//' | cut -d. -f1)
  if [ "$NODE_MAJOR" -ge 18 ]; then
    ok "Node.js already installed — $NODE_VERSION"
  else
    warn "Node.js $NODE_VERSION is too old (need >=18). Installing newer version..."
    NEED_NODE=true
  fi
else
  info "Node.js not found. Installing..."
  NEED_NODE=true
fi

if [ "$NEED_NODE" = "true" ]; then
  if [ "$PLATFORM" = "macos" ]; then
    if command -v brew >/dev/null 2>&1; then
      info "Installing Node.js 20 via Homebrew..."
      brew install node@20
      brew link --overwrite node@20 2>/dev/null || true
      ok "Node.js installed"
    else
      fail "Homebrew is required to install Node.js on macOS. Install it first: https://brew.sh"
    fi

  elif [ "$PLATFORM" = "linux" ]; then
    need_cmd curl

    # Map arch for Node.js binary download
    case "$ARCH" in
      x86_64)  NODE_ARCH="x64" ;;
      aarch64) NODE_ARCH="arm64" ;;
      armv7l)  NODE_ARCH="armv7l" ;;
      *)       NODE_ARCH="$ARCH" ;;
    esac

    NODE_INSTALL_VERSION="20"

    # Try distro package manager first (Ubuntu/Debian ship recent enough Node)
    INSTALLED_VIA_PKG=false

    if [ "$PKG" = "apt" ]; then
      # Check if the distro's nodejs package is recent enough
      APT_NODE_VER=$(apt-cache show nodejs 2>/dev/null | grep -m1 '^Version:' | sed 's/[^0-9]*//' | cut -d. -f1 || echo "0")
      if [ "$APT_NODE_VER" -ge 18 ] 2>/dev/null; then
        info "Installing Node.js via apt (v${APT_NODE_VER})..."
        maybe_sudo apt-get update -qq
        maybe_sudo apt-get install -y -qq nodejs npm
        INSTALLED_VIA_PKG=true
      fi
    elif [ "$PKG" = "dnf" ]; then
      DNF_NODE_VER=$(dnf info nodejs 2>/dev/null | grep -m1 'Version' | awk '{print $3}' | cut -d. -f1 || echo "0")
      if [ "$DNF_NODE_VER" -ge 18 ] 2>/dev/null; then
        info "Installing Node.js via dnf (v${DNF_NODE_VER})..."
        maybe_sudo dnf install -y nodejs npm
        INSTALLED_VIA_PKG=true
      fi
    elif [ "$PKG" = "pacman" ]; then
      info "Installing Node.js via pacman..."
      maybe_sudo pacman -Sy --noconfirm nodejs npm
      INSTALLED_VIA_PKG=true
    elif [ "$PKG" = "zypper" ]; then
      info "Installing Node.js via zypper..."
      maybe_sudo zypper install -y nodejs npm
      INSTALLED_VIA_PKG=true
    fi

    # If package manager didn't work or version is too old, download binary
    if [ "$INSTALLED_VIA_PKG" = "false" ]; then
      info "Installing Node.js ${NODE_INSTALL_VERSION} via official binary..."
      # Fetch the latest v20 version
      NODE_FULL_VER=$(curl -fsSL "https://nodejs.org/dist/latest-v${NODE_INSTALL_VERSION}.x/" | grep -oP 'node-v\K[0-9]+\.[0-9]+\.[0-9]+' | head -1)
      if [ -z "$NODE_FULL_VER" ]; then
        fail "Could not determine latest Node.js ${NODE_INSTALL_VERSION} version. Install manually: https://nodejs.org"
      fi
      NODE_TARBALL="node-v${NODE_FULL_VER}-linux-${NODE_ARCH}.tar.xz"
      NODE_URL="https://nodejs.org/dist/v${NODE_FULL_VER}/${NODE_TARBALL}"

      info "Downloading ${NODE_TARBALL}..."
      TMPDIR=$(mktemp -d)
      curl -fsSL "$NODE_URL" -o "$TMPDIR/$NODE_TARBALL"
      maybe_sudo tar -xJf "$TMPDIR/$NODE_TARBALL" -C /usr/local --strip-components=1
      rm -rf "$TMPDIR"
    fi

    # Verify it worked
    if command -v node >/dev/null 2>&1; then
      ok "Node.js installed — $(node --version)"
    else
      fail "Node.js installation failed. Install manually: https://nodejs.org"
    fi
  fi
fi

# ── Check npm / npx ─────────────────────────────────────────

if command -v npx >/dev/null 2>&1; then
  ok "npx available"
else
  # npm might have been installed but not in PATH yet (binary install)
  if [ -x /usr/local/bin/npx ]; then
    export PATH="/usr/local/bin:$PATH"
    ok "npx available"
  else
    fail "npx not found. It should come with Node.js. Try reinstalling Node.js."
  fi
fi

# ── Launch ───────────────────────────────────────────────────

echo ""
echo -e "${GREEN}${BOLD}All dependencies are ready!${RESET}"
echo ""
echo -e "${CYAN}Launching LearnHouse setup...${RESET}"
echo ""

# Build the launch command — reattach stdin from /dev/tty when piped from curl
if [ ! -t 0 ]; then
  LAUNCH_CMD="npx learnhouse@latest setup </dev/tty"
else
  LAUNCH_CMD="npx learnhouse@latest setup"
fi

# If we just added the user to the docker group, use sg to pick up the new
# group membership in the current session (avoids "permission denied" on the
# Docker socket without requiring a re-login).
if [ "${DOCKER_GROUP_CHANGED:-false}" = "true" ]; then
  exec sg docker -c "$LAUNCH_CMD"
else
  eval "exec $LAUNCH_CMD"
fi
