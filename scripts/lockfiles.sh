#!/usr/bin/env bash
#
# Regenerate — or verify — every lockfile in the repo.
#
#   scripts/lockfiles.sh            rewrite the lockfiles to match the manifests
#   scripts/lockfiles.sh --check    fail if any lockfile is out of date
#
# The manifests are the source of truth; the lockfiles are derived. Anything
# that edits a manifest (Renovate, a release version bump, a hand-edited
# dependency) has to run this, or `bun install --frozen-lockfile` /
# `uv sync --frozen` breaks in the Docker build and in CI.
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

CHECK=0
if [[ "${1:-}" == "--check" ]]; then
  CHECK=1
elif [[ -n "${1:-}" ]]; then
  echo "usage: scripts/lockfiles.sh [--check]" >&2
  exit 2
fi

# Every directory holding a package.json + bun.lock pair.
BUN_WORKSPACES=(apps/web apps/collab apps/cli apps/e2e docs)

FAILED=()

note() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
have() { command -v "$1" >/dev/null 2>&1; }

if ! have bun; then
  echo "bun is not installed — see https://bun.sh" >&2
  exit 127
fi

# ── bun version ────────────────────────────────────────────────────────────
# .bun-version is what CI installs; apps/web declares the same version in
# `packageManager` so a stray `npm`/`pnpm`/`yarn` install refuses to run there.
note "bun version"
WANT_BUN="$(tr -d '[:space:]' < .bun-version)"
DECLARED_BUN="$(bun -e 'console.log((JSON.parse(await Bun.file("apps/web/package.json").text()).packageManager ?? "").replace(/^bun@/, ""))')"
if [[ "$WANT_BUN" != "$DECLARED_BUN" ]]; then
  echo "  .bun-version ($WANT_BUN) and apps/web packageManager ($DECLARED_BUN) disagree" >&2
  FAILED+=(".bun-version / apps/web packageManager")
else
  echo "  $WANT_BUN"
fi
if [[ "$(bun --version)" != "$WANT_BUN" ]]; then
  echo "  note: local bun is $(bun --version); CI resolves with $WANT_BUN." >&2
fi

# The Dockerfiles pin bun as an image tag, which nothing else validates. A tag
# left behind on an older bun is how the frontend image ended up building on a
# different runtime than CI: the build crashed on a bug CI never saw. Every
# `oven/bun:` base must name the version in .bun-version.
note "bun image tags"
DOCKERFILE_BUN_MISMATCH=0
while IFS= read -r line; do
  file="${line%%:*}"
  tag="$(printf '%s' "${line#*oven/bun:}" | sed 's/[[:space:]].*//; s/-alpine$//; s/-slim$//; s/-distroless$//')"
  if [[ "$tag" != "$WANT_BUN" ]]; then
    echo "  $file pins oven/bun:$tag, .bun-version says $WANT_BUN" >&2
    DOCKERFILE_BUN_MISMATCH=1
  fi
done < <(git grep -n 'FROM oven/bun:' -- '*Dockerfile' | sed 's/:[0-9]*:/:/')
if (( DOCKERFILE_BUN_MISMATCH )); then
  FAILED+=("Dockerfile bun tags")
else
  echo "  all FROM oven/bun: tags are $WANT_BUN"
fi

# ── bun lockfiles ──────────────────────────────────────────────────────────
for ws in "${BUN_WORKSPACES[@]}"; do
  [[ -f "$ws/package.json" ]] || continue
  note "bun install ($ws)"
  if (( CHECK )); then
    # This is the exact command the Dockerfiles and CI run, so a pass here
    # means a pass there.
    (cd "$ws" && bun install --frozen-lockfile) || FAILED+=("$ws/bun.lock")
  else
    (cd "$ws" && bun install)
  fi
done

# ── uv (apps/api) ──────────────────────────────────────────────────────────
if [[ -f apps/api/pyproject.toml ]]; then
  if have uv; then
    note "uv lock (apps/api)"
    if (( CHECK )); then
      (cd apps/api && uv lock --check) || FAILED+=("apps/api/uv.lock")
    else
      (cd apps/api && uv lock)
    fi
  else
    echo "uv not installed — skipping apps/api/uv.lock" >&2
  fi
fi

# ── result ─────────────────────────────────────────────────────────────────
if (( CHECK )) && (( ${#FAILED[@]} )); then
  cat >&2 <<EOF

Out-of-date lockfiles:
$(printf '  - %s\n' "${FAILED[@]}")

Fix with:

  scripts/lockfiles.sh

then commit the result.
EOF
  exit 1
fi

if (( CHECK )); then
  echo
  echo "All lockfiles are up to date."
fi
