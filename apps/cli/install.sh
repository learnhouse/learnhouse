#!/usr/bin/env bash
set -euo pipefail

# ─────────────────────────────────────────────────────────────
# LearnHouse Install Script (macOS & Linux)
# Installs Docker and Node.js if missing, then runs the CLI.
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/learnhouse/learnhouse/main/apps/cli/install.sh | bash
#
# Everything runs from main(), which is only called on the last line, so a
# download cut short by `curl | bash` never executes a partial script.
# ─────────────────────────────────────────────────────────────

BOLD="\033[1m"
DIM="\033[2m"
CYAN="\033[36m"
GREEN="\033[32m"
YELLOW="\033[33m"
RED="\033[31m"
RESET="\033[0m"

# Minimum Node.js major the CLI supports, and the LTS line we install
NODE_MIN_MAJOR=22
NODE_INSTALL_MAJOR=24

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

# Print the major version of the node on PATH, or 0 if missing/unparseable
node_major() {
  local major
  major=$(node --version 2>/dev/null | sed -E 's/^v([0-9]+).*/\1/' || true)
  case "$major" in
    ''|*[!0-9]*) echo 0 ;;
    *)           echo "$major" ;;
  esac
}

# Turn a distro package version (e.g. "1:22.11.0-1nodesource1") into its major
pkg_major() {
  local major
  major=$(echo "$1" | sed -E 's/^[0-9]+://; s/^([0-9]+).*/\1/')
  case "$major" in
    ''|*[!0-9]*) echo 0 ;;
    *)           echo "$major" ;;
  esac
}

sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{print $1}'
  else
    fail "sha256sum or shasum is required to verify the Node.js download."
  fi
}

# ── Detect OS ────────────────────────────────────────────────

detect_platform() {
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
    elif command -v apk >/dev/null 2>&1; then
      # Alpine (musl): the glibc Node tarball and get.docker.com don't apply
      PKG="apk"
    fi
  fi
}

# ── Ensure curl is available (Linux) ─────────────────────────

ensure_curl() {
  if [ "$PLATFORM" = "linux" ] && ! command -v curl >/dev/null 2>&1; then
    info "Installing curl..."
    case "$PKG" in
      apt)    maybe_sudo apt-get update -qq && maybe_sudo apt-get install -y -qq curl ;;
      dnf)    maybe_sudo dnf install -y -q curl ;;
      yum)    maybe_sudo yum install -y -q curl ;;
      pacman) maybe_sudo pacman -Sy --noconfirm curl ;;
      zypper) maybe_sudo zypper install -y curl ;;
      apk)    maybe_sudo apk add --no-cache curl ;;
      *)      fail "curl is required. Install it manually and re-run." ;;
    esac
  fi
}

# ── Check / Install Docker ──────────────────────────────────

start_docker_service() {
  if command -v systemctl >/dev/null 2>&1; then
    # Fails on hosts without systemd as PID 1 (WSL2 without systemd, containers)
    if maybe_sudo systemctl enable docker && maybe_sudo systemctl start docker; then
      ok "Docker daemon enabled and started"
    else
      warn "Could not start Docker with systemctl (is systemd running?). Start the Docker daemon manually."
    fi
  elif command -v rc-service >/dev/null 2>&1; then
    maybe_sudo rc-update add docker default >/dev/null 2>&1 || true
    if maybe_sudo rc-service docker start; then
      ok "Docker daemon enabled and started"
    else
      warn "Could not start Docker with rc-service. Start the Docker daemon manually."
    fi
  fi
}

ensure_docker() {
  if command -v docker >/dev/null 2>&1; then
    DOCKER_VERSION=$(docker --version 2>/dev/null | head -1)
    ok "Docker already installed: $DOCKER_VERSION"
  else
    info "Docker not found. Installing..."

    if [ "$PLATFORM" = "macos" ]; then
      if ! command -v brew >/dev/null 2>&1; then
        fail "Homebrew is required to install Docker on macOS. Install it first: https://brew.sh"
      fi
      info "Installing Docker via Homebrew..."
      brew install --cask docker
      echo ""
      ok "Docker Desktop installed"
      warn "Docker Desktop must be started once before LearnHouse can use it."
      echo -e "${DIM}  1. Open Docker Desktop from Applications or run: open -a Docker${RESET}"
      echo -e "${DIM}  2. Wait until it reports that Docker is running${RESET}"
      echo -e "${DIM}  3. Re-run this installer${RESET}"
      echo ""
      exit 0

    elif [ "$PLATFORM" = "linux" ]; then
      if [ "$PKG" = "apk" ]; then
        info "Installing Docker via apk..."
        maybe_sudo apk add --no-cache docker docker-cli-compose \
          || fail "Could not install Docker via apk. Enable the community repository in /etc/apk/repositories, or see: https://wiki.alpinelinux.org/wiki/Docker"
      else
        need_cmd curl
        info "Installing Docker via official install script..."
        curl -fsSL https://get.docker.com | maybe_sudo sh
      fi

      # Enable and start the Docker daemon
      start_docker_service

      # Add current user to docker group so sudo isn't needed
      if [ "$(id -u)" -ne 0 ]; then
        CURRENT_USER="$(id -un)"
        warn "Adding $CURRENT_USER to the docker group. Members of this group can control Docker, which is equivalent to root access on this machine."
        if command -v usermod >/dev/null 2>&1; then
          maybe_sudo usermod -aG docker "$CURRENT_USER"
        else
          maybe_sudo addgroup "$CURRENT_USER" docker
        fi
        DOCKER_GROUP_CHANGED=true
        ok "Added $CURRENT_USER to the docker group"
      fi

      ok "Docker installed"
    fi
  fi

  # Verify Docker daemon is running (on Linux, retry with sudo since the group
  # change only applies to new sessions; macOS never needs sudo for Docker)
  if docker info >/dev/null 2>&1; then
    ok "Docker daemon is running"
  elif [ "$PLATFORM" = "linux" ] && maybe_sudo docker info >/dev/null 2>&1; then
    ok "Docker daemon is running (requires sudo until next login)"
  else
    warn "Docker is installed but the daemon is not running."
    if [ "$PLATFORM" = "macos" ]; then
      echo -e "${DIM}  Start Docker Desktop from Applications${RESET}"
    elif command -v systemctl >/dev/null 2>&1; then
      echo -e "${DIM}  Start with: sudo systemctl start docker${RESET}"
    elif command -v rc-service >/dev/null 2>&1; then
      echo -e "${DIM}  Start with: sudo rc-service docker start${RESET}"
    else
      echo -e "${DIM}  Start the Docker daemon (e.g. sudo dockerd)${RESET}"
    fi
  fi
}

# ── Check / Install Docker Compose v2 ───────────────────────

compose_available() {
  docker compose version >/dev/null 2>&1 \
    || { [ "$PLATFORM" = "linux" ] && maybe_sudo docker compose version >/dev/null 2>&1; }
}

ensure_compose() {
  if compose_available; then
    ok "Docker Compose v2 available"
    return
  fi

  if [ "$PLATFORM" = "linux" ]; then
    # Package names differ per distro/repo (Ubuntu's docker.io has no
    # docker-compose-plugin), so a failed install falls through to the warning.
    info "Installing docker-compose-plugin..."
    case "$PKG" in
      apt)
        { maybe_sudo apt-get update -qq && maybe_sudo apt-get install -y -qq docker-compose-plugin; } \
          || maybe_sudo apt-get install -y -qq docker-compose-v2 \
          || true
        ;;
      dnf)    maybe_sudo dnf install -y docker-compose-plugin || true ;;
      yum)    maybe_sudo yum install -y docker-compose-plugin || true ;;
      pacman) maybe_sudo pacman -Sy --noconfirm docker-compose || true ;;
      zypper) maybe_sudo zypper install -y docker-compose || true ;;
      apk)    maybe_sudo apk add --no-cache docker-cli-compose || true ;;
      *)      ;;
    esac

    if compose_available; then
      ok "Docker Compose v2 installed"
    else
      warn "Docker Compose v2 could not be installed. See: https://docs.docker.com/compose/install/linux/"
    fi
  else
    warn "Docker Compose v2 not found. It's included with Docker Desktop."
  fi
}

# ── Check / Install Node.js ─────────────────────────────────

# Download the official Linux binary, verify it against SHASUMS256.txt from the
# same dist directory, and unpack it into /usr/local.
install_node_binary() {
  need_cmd curl

  local node_arch dist ext tar_flag tarball expected actual
  case "$ARCH" in
    x86_64)        node_arch="x64" ;;
    aarch64|arm64) node_arch="arm64" ;;
    *)             node_arch="$ARCH" ;;
  esac

  # Prefer .tar.xz but fall back to .tar.gz on minimal images without xz
  if command -v xz >/dev/null 2>&1; then
    ext="tar.xz"; tar_flag="J"
  else
    ext="tar.gz"; tar_flag="z"
  fi

  dist="https://nodejs.org/dist/latest-v${NODE_INSTALL_MAJOR}.x"

  info "Installing Node.js ${NODE_INSTALL_MAJOR} via official binary..."
  NODE_WORK_DIR=$(mktemp -d)
  trap 'rm -rf "${NODE_WORK_DIR:-}"' EXIT

  curl -fsSL "$dist/SHASUMS256.txt" -o "$NODE_WORK_DIR/SHASUMS256.txt" \
    || fail "Could not download the Node.js ${NODE_INSTALL_MAJOR} checksums. Install manually: https://nodejs.org"

  tarball=$(awk -v suffix="-linux-${node_arch}.${ext}" \
    '$2 ~ /^node-v[0-9]+\.[0-9]+\.[0-9]+-/ && substr($2, length($2) - length(suffix) + 1) == suffix { print $2; exit }' \
    "$NODE_WORK_DIR/SHASUMS256.txt")
  if [ -z "$tarball" ]; then
    fail "No Node.js ${NODE_INSTALL_MAJOR} binary for linux-${node_arch}. Install manually: https://nodejs.org"
  fi
  expected=$(awk -v f="$tarball" '$2 == f { print $1; exit }' "$NODE_WORK_DIR/SHASUMS256.txt")

  info "Downloading ${tarball}..."
  curl -fsSL "$dist/$tarball" -o "$NODE_WORK_DIR/$tarball"

  actual=$(sha256_of "$NODE_WORK_DIR/$tarball")
  if [ -z "$expected" ] || [ "$actual" != "$expected" ]; then
    fail "Checksum mismatch for ${tarball} (expected ${expected:-none}, got ${actual}). Aborting."
  fi
  ok "Checksum verified"

  maybe_sudo tar -x${tar_flag}f "$NODE_WORK_DIR/$tarball" -C /usr/local --strip-components=1
  rm -rf "$NODE_WORK_DIR"
  trap - EXIT

  # Make sure the new binary wins over any older node earlier on PATH
  export PATH="/usr/local/bin:$PATH"
}

install_node_linux() {
  local installed_via_pkg=false candidate

  case "$PKG" in
    apk)
      # musl: the official glibc tarball won't run, so apk is the only path
      info "Installing Node.js via apk..."
      maybe_sudo apk add --no-cache nodejs npm || fail "Could not install Node.js via apk."
      hash -r
      if [ "$(node_major)" -lt "$NODE_MIN_MAJOR" ]; then
        fail "Alpine's nodejs package is $(node --version 2>/dev/null || echo 'unknown'); LearnHouse needs Node.js >= ${NODE_MIN_MAJOR}. Upgrade to Alpine 3.21 or newer."
      fi
      return
      ;;
    apt)
      # Only use the distro package when it is new enough
      candidate=$(apt-cache policy nodejs 2>/dev/null | sed -n -E 's/^ *Candidate: *//p' | head -1 || true)
      if [ "$(pkg_major "$candidate")" -ge "$NODE_MIN_MAJOR" ]; then
        info "Installing Node.js via apt (${candidate})..."
        if maybe_sudo apt-get update -qq && maybe_sudo apt-get install -y -qq nodejs; then
          # NodeSource's nodejs bundles npm; distro builds ship it separately
          command -v npx >/dev/null 2>&1 || maybe_sudo apt-get install -y -qq npm || true
          installed_via_pkg=true
        fi
      fi
      ;;
    dnf)
      candidate=$(dnf info nodejs 2>/dev/null | sed -n -E 's/^Version *: *//p' | sort -t. -k1,1n | tail -1 || true)
      if [ "$(pkg_major "$candidate")" -ge "$NODE_MIN_MAJOR" ]; then
        info "Installing Node.js via dnf (${candidate})..."
        if maybe_sudo dnf install -y nodejs npm; then installed_via_pkg=true; fi
      fi
      ;;
    pacman)
      info "Installing Node.js via pacman..."
      if maybe_sudo pacman -Sy --noconfirm nodejs npm; then installed_via_pkg=true; fi
      ;;
    zypper)
      info "Installing Node.js via zypper..."
      if maybe_sudo zypper install -y nodejs npm; then installed_via_pkg=true; fi
      ;;
  esac

  hash -r
  if [ "$installed_via_pkg" = "true" ] && [ "$(node_major)" -lt "$NODE_MIN_MAJOR" ]; then
    warn "Package manager installed Node.js $(node --version 2>/dev/null || echo 'unknown'), need >= ${NODE_MIN_MAJOR}. Falling back to the official binary."
    installed_via_pkg=false
  fi

  # If package manager didn't work or version is too old, download binary
  if [ "$installed_via_pkg" = "false" ]; then
    install_node_binary
    hash -r
  fi
}

ensure_node() {
  local need_node=false node_version

  if command -v node >/dev/null 2>&1; then
    node_version=$(node --version 2>/dev/null || echo "unknown")
    if [ "$(node_major)" -ge "$NODE_MIN_MAJOR" ]; then
      ok "Node.js already installed: $node_version"
    else
      warn "Node.js $node_version is too old (need >=${NODE_MIN_MAJOR}). Installing Node.js ${NODE_INSTALL_MAJOR}..."
      need_node=true
    fi
  else
    info "Node.js not found. Installing..."
    need_node=true
  fi

  [ "$need_node" = "true" ] || return 0

  if [ "$PLATFORM" = "macos" ]; then
    if ! command -v brew >/dev/null 2>&1; then
      fail "Homebrew is required to install Node.js on macOS. Install it first: https://brew.sh"
    fi
    info "Installing Node.js ${NODE_INSTALL_MAJOR} via Homebrew..."
    brew install "node@${NODE_INSTALL_MAJOR}"
    # Versioned formulae are keg-only, so linking needs --force
    brew link --overwrite --force "node@${NODE_INSTALL_MAJOR}" 2>/dev/null || true
    local brew_node_bin
    brew_node_bin="$(brew --prefix "node@${NODE_INSTALL_MAJOR}")/bin"
    export PATH="$brew_node_bin:$PATH"
    hash -r
  elif [ "$PLATFORM" = "linux" ]; then
    install_node_linux
  fi

  # Verify it worked
  if ! command -v node >/dev/null 2>&1; then
    fail "Node.js installation failed. Install manually: https://nodejs.org"
  fi
  if [ "$(node_major)" -lt "$NODE_MIN_MAJOR" ]; then
    fail "Found Node.js $(node --version) on PATH after installing; need >=${NODE_MIN_MAJOR}. Remove the older version or fix your PATH, then re-run."
  fi
  ok "Node.js installed: $(node --version)"
}

# ── Check npm / npx ─────────────────────────────────────────

ensure_npx() {
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
}

# ── Launch ───────────────────────────────────────────────────

launch() {
  local launch_cmd

  echo ""
  echo -e "${GREEN}${BOLD}All dependencies are ready!${RESET}"
  echo ""

  # Setup is interactive. When piped from curl, reattach stdin from the
  # terminal; without one (cloud-init, CI, ssh without -t) print next steps.
  if [ -t 0 ]; then
    launch_cmd="npx learnhouse@latest setup"
  elif (exec </dev/tty) 2>/dev/null; then
    launch_cmd="npx learnhouse@latest setup </dev/tty"
  else
    warn "No interactive terminal detected, so setup was not launched."
    echo ""
    echo -e "${DIM}  Run the interactive setup from a terminal:${RESET}"
    echo -e "  npx learnhouse@latest setup"
    echo ""
    echo -e "${DIM}  Or run a non-interactive setup:${RESET}"
    echo -e "  npx learnhouse@latest setup --ci --domain <domain> --admin-email <email> --admin-password <password>"
    echo -e "${DIM}  (see npx learnhouse@latest setup --help for all options)${RESET}"
    if [ "$DOCKER_GROUP_CHANGED" = "true" ]; then
      echo ""
      warn "Log out and back in (or run: newgrp docker) so your docker group membership applies."
    fi
    echo ""
    exit 0
  fi

  echo -e "${CYAN}Launching LearnHouse setup...${RESET}"
  echo ""

  # If we just added the user to the docker group, use sg to pick up the new
  # group membership in the current session (avoids "permission denied" on the
  # Docker socket without requiring a re-login).
  if [ "$DOCKER_GROUP_CHANGED" = "true" ] && command -v sg >/dev/null 2>&1; then
    exec sg docker -c "$launch_cmd"
  else
    eval "exec $launch_cmd"
  fi
}

main() {
  DOCKER_GROUP_CHANGED=false

  detect_platform

  echo ""
  echo -e "${BOLD}LearnHouse Installer${RESET}"
  echo -e "${DIM}Platform: $PLATFORM ($ARCH)${RESET}"
  echo ""

  ensure_curl
  ensure_docker
  ensure_compose
  ensure_node
  ensure_npx
  launch
}

# Tests source this file with LEARNHOUSE_INSTALL_SOURCE_ONLY=1 to call the
# functions above against stub commands.
if [ "${LEARNHOUSE_INSTALL_SOURCE_ONLY:-}" != "1" ]; then
  main "$@"
fi
