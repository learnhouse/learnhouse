#!/bin/zsh
set -e

BASE="$HOME/acyberschool-lms-development"
SRC="$BASE/source"
NODE_DIR="$BASE/node"
BUN_HOME="$BASE/bun"
UV_HOME="$BASE/uv"
REPO_ZIP="https://github.com/acyberschool/acyberschool-lms/archive/refs/heads/acyberschool-dev.zip"

clear
echo "============================================================"
echo "      ACYBERSCHOOL - SYNC CURRENT BUILD AND START"
echo "============================================================"
echo
echo "You do not need to type anything."
echo "This stops a stale development copy, downloads the current"
echo "Acyberschool branch, verifies it, then starts that exact code."
echo

if ! docker info >/dev/null 2>&1; then
  osascript -e 'display alert "Docker Desktop is not running" message "Open Docker Desktop and wait until it says Engine running. Then run this file again." as critical'
  exit 1
fi
echo "✓ Docker is running"

if [ ! -d "$BASE" ]; then
  echo "✗ I could not find the Acyberschool development folder."
  echo "Please send ChatGPT a screenshot of this window."
  read -n 1 -s -r -p "Press any key to close..."
  exit 1
fi

export PATH="$NODE_DIR/bin:$BUN_HOME/bin:$UV_HOME:/usr/local/bin:/opt/homebrew/bin:$PATH"

stop_port() {
  local port="$1"
  local pids
  pids=$(lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)
  if [ -n "$pids" ]; then
    echo "$pids" | while read -r pid; do
      [ -z "$pid" ] && continue
      cwd=$(lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -n 1)
      cmd=$(ps -p "$pid" -o command= 2>/dev/null || true)
      if [[ "$cwd" == "$BASE"* || "$cmd" == *"learnhouse"* || "$cmd" == *"next dev"* || "$cmd" == *"python app.py"* || "$cmd" == *"tsx watch"* ]]; then
        kill "$pid" 2>/dev/null || true
        sleep 1
        kill -9 "$pid" 2>/dev/null || true
      fi
    done
  fi
}

echo "Stopping any stale Acyberschool development services..."
stop_port 3000
stop_port 1338
stop_port 4000
echo "✓ Stale development services stopped"

PRESERVE="$BASE/.acyber-preserve"
rm -rf "$PRESERVE"
mkdir -p "$PRESERVE/apps/api" "$PRESERVE/apps/web" "$PRESERVE/apps/collab"
[ -f "$SRC/apps/api/.env" ] && cp "$SRC/apps/api/.env" "$PRESERVE/apps/api/.env"
[ -f "$SRC/apps/web/.env.local" ] && cp "$SRC/apps/web/.env.local" "$PRESERVE/apps/web/.env.local"
[ -f "$SRC/apps/collab/.env" ] && cp "$SRC/apps/collab/.env" "$PRESERVE/apps/collab/.env"

TMPZIP="$BASE/acyberschool-dev-current.zip"
TMPUNZIP="$BASE/acyberschool-current-unpack"
rm -rf "$TMPUNZIP" "$TMPZIP"
mkdir -p "$TMPUNZIP"

echo "Downloading the current Acyberschool build from GitHub..."
curl -fL "$REPO_ZIP" -o "$TMPZIP"
unzip -q "$TMPZIP" -d "$TMPUNZIP"
FOUND=$(find "$TMPUNZIP" -maxdepth 1 -type d -name 'acyberschool-lms-*' | head -n 1)

if [ -z "$FOUND" ]; then
  echo "✗ The Acyberschool build could not be unpacked."
  echo "Please send ChatGPT a screenshot of this window."
  read -n 1 -s -r -p "Press any key to close..."
  exit 1
fi

rm -rf "$SRC"
mkdir -p "$SRC"
cp -R "$FOUND"/. "$SRC"/

[ -f "$PRESERVE/apps/api/.env" ] && cp "$PRESERVE/apps/api/.env" "$SRC/apps/api/.env"
[ -f "$PRESERVE/apps/web/.env.local" ] && cp "$PRESERVE/apps/web/.env.local" "$SRC/apps/web/.env.local"
[ -f "$PRESERVE/apps/collab/.env" ] && cp "$PRESERVE/apps/collab/.env" "$SRC/apps/collab/.env"
rm -rf "$TMPUNZIP" "$TMPZIP" "$PRESERVE"

echo "✓ Current GitHub branch downloaded"

HOME_FILE="$SRC/apps/web/components/Acyberschool/AcyberLearningHome.tsx"
GATE_FILE="$SRC/apps/web/components/Acyberschool/AppliedLearningGate.tsx"

if [ ! -f "$HOME_FILE" ] || ! grep -q "Learning should change what you are capable of applying at work" "$HOME_FILE"; then
  echo "✗ Verification failed: the Acyberschool homepage is not in this copy."
  echo "The platform will NOT be started with stale code."
  echo "Please send ChatGPT a screenshot of this window."
  read -n 1 -s -r -p "Press any key to close..."
  exit 1
fi

if [ ! -f "$GATE_FILE" ] || grep -q "pendingHref" "$GATE_FILE"; then
  echo "✗ Verification failed: the old forced application popup code is still present."
  echo "The platform will NOT be started with stale code."
  echo "Please send ChatGPT a screenshot of this window."
  read -n 1 -s -r -p "Press any key to close..."
  exit 1
fi

echo "✓ Verified: Acyberschool homepage is present"
echo "✓ Verified: forced Apply popup code is removed"
echo
echo "Starting the verified Acyberschool build..."
echo "Keep this Terminal window open while you use the platform."
echo

( sleep 18; open "http://localhost:3000" ) >/dev/null 2>&1 &

cd "$SRC"
exec npx --yes learnhouse@latest dev
