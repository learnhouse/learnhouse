#!/usr/bin/env bash
set -euo pipefail

# LearnHouse CLI release script. Bumps the CLI version on dev, tags `cli-<version>`
# (which triggers .github/workflows/cli-publish.yaml → npm publish), and drafts a
# GitHub Release. Pushing a tag is effectively irreversible, so EVERY precondition
# is checked BEFORE anything is mutated: a failed check leaves the repo untouched.

REPO_ROOT="$(git rev-parse --show-toplevel)"
REPO="$(gh repo view --json nameWithOwner -q .nameWithOwner 2>/dev/null || true)"
VERSION="${1:-}"

die() { printf '\n  ❌ %s\n\n' "$*" >&2; exit 1; }

# Portable in-place sed (GNU sed forbids the arg to -i; BSD/macOS requires it).
sed_inplace() {
  if sed --version >/dev/null 2>&1; then sed -i "$@"; else sed -i '' "$@"; fi
}

if [ -z "$VERSION" ]; then
  echo ""
  echo "  📦 LearnHouse CLI Release Script"
  echo ""
  echo "  Usage: .github/utils/release-cli.sh <version>"
  echo "  Example: .github/utils/release-cli.sh 1.4.9"
  echo ""
  exit 1
fi

VERSION="${VERSION#v}"           # strip a leading 'v' if provided
TAG="cli-${VERSION}"
PKG="$REPO_ROOT/apps/cli/package.json"
CONST="$REPO_ROOT/apps/cli/src/constants.ts"

echo ""
echo "  🚀 LearnHouse CLI Release: ${VERSION}"
echo "  ─────────────────────────────────────"
echo ""

# ─── Preflight: verify EVERYTHING before changing anything ──────────────────
echo "  🔎 Running preflight checks..."

# 1) Version must look like semver (optionally a -preview / .N suffix).
[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+([.-][0-9A-Za-z.]+)?$ ]] \
  || die "Invalid version '$VERSION': expected semver, e.g. 1.4.9"

# 2) Tooling + auth (the script creates a GitHub Release).
command -v gh   >/dev/null 2>&1 || die "GitHub CLI 'gh' is not installed."
command -v node >/dev/null 2>&1 || die "Node.js is not installed."
gh auth status  >/dev/null 2>&1 || die "GitHub CLI is not authenticated. Run: gh auth login"
[ -n "$REPO" ] || die "Could not determine the GitHub repo (gh repo view)."

# 3) The version files must exist.
[ -f "$PKG" ]   || die "Not found: $PKG"
[ -f "$CONST" ] || die "Not found: $CONST"

# 4) No half-finished git operation we'd otherwise stomp on.
GIT_DIR="$(git rev-parse --git-dir)"
[ -f "$GIT_DIR/MERGE_HEAD" ] && die "A merge is in progress. Finish it or run 'git merge --abort' first."
{ [ -d "$GIT_DIR/rebase-merge" ] || [ -d "$GIT_DIR/rebase-apply" ]; } && die "A rebase is in progress. Finish or abort it first."

# 5) Must be ON dev — the bump + tag have to land on dev, not on whatever branch
#    you happen to be sitting on. (This was the biggest footgun of the old script.)
CURRENT_BRANCH="$(git rev-parse --abbrev-ref HEAD)"
[ "$CURRENT_BRANCH" = "dev" ] \
  || die "You are on '$CURRENT_BRANCH', not 'dev'. Releases must be cut from dev. Run: git checkout dev"

# 6) Clean working tree — never release uncommitted local changes.
git diff --quiet && git diff --cached --quiet \
  || die "Working tree has uncommitted changes. Commit or stash them before releasing."

# 7) Sync refs + tags from origin.
echo "  📡 Fetching latest from origin..."
git fetch --quiet origin --tags --prune

# 8) origin/dev must exist, and local dev must not have diverged from it.
git ls-remote --exit-code --heads origin dev >/dev/null 2>&1 || die "origin/dev not found."
git pull --ff-only origin dev \
  || die "Local 'dev' has diverged from origin/dev; reconcile it before releasing."

# 9) Tag must not already exist locally OR on origin.
git rev-parse -q --verify "refs/tags/$TAG" >/dev/null 2>&1 \
  && die "Tag $TAG already exists locally. Pick a new version or delete the tag first."
git ls-remote --exit-code --tags origin "refs/tags/$TAG" >/dev/null 2>&1 \
  && die "Tag $TAG already exists on origin. Pick a new version."

# 10) The new version must not already be published on npm (npm rejects re-publishing).
PUBLISHED="$(npm view learnhouse@"$VERSION" version 2>/dev/null || true)"
[ -n "$PUBLISHED" ] && die "learnhouse@$VERSION is already published on npm. Pick a new version."

echo "  ✅ Preflight passed, releasing ${TAG} to ${REPO}"

# ─── Bump CLI version (portable; verified before commit) ────────────────────
echo "  📝 Bumping CLI version to ${VERSION}..."
sed_inplace "s/\"version\": \"[^\"]*\"/\"version\": \"${VERSION}\"/" "$PKG"
sed_inplace "s/export const VERSION = '[^']*'/export const VERSION = '${VERSION}'/" "$CONST"

# Confirm the bump actually landed in BOTH files (formats may have changed).
grep -q "\"version\": \"${VERSION}\""        "$PKG"   || die "Bump did not apply to package.json; aborting before any push."
grep -q "export const VERSION = '${VERSION}'" "$CONST" || die "Bump did not apply to constants.ts; aborting before any push."
echo "  ✅ Version bumped in package.json + constants.ts"

# ─── Commit version bump on dev ─────────────────────────────────────────────
echo "  📦 Committing version bump on dev..."
git add "$PKG" "$CONST"
if git diff --cached --quiet; then
  echo "  ℹ️  package.json/constants.ts already at ${VERSION}; tagging the current dev commit"
else
  git commit -m "release(cli): bump version to ${VERSION}"
  git push origin dev
fi

# ─── Tag from dev (this triggers the npm publish workflow) ──────────────────
echo "  🏷️  Creating tag $TAG..."
git tag -a "$TAG" -m "$TAG"

echo "  ⬆️  Pushing tag $TAG..."
git push origin "$TAG"

# ─── Generate changelog (CLI-scoped) ────────────────────────────────────────
echo "  📋 Generating changelog..."
PREV_TAG=$(git tag --list 'cli-[0-9]*' --sort=-v:refname | grep -v "^${TAG}$" | head -n1 || true)
if [ -z "$PREV_TAG" ]; then RANGE="HEAD"; else RANGE="${PREV_TAG}..HEAD"; fi

FEATURES=$(git log "$RANGE" --pretty=format:"- %s (\`%h\`)" --grep="^feat" -- apps/cli/ || true)
FIXES=$(git log "$RANGE" --pretty=format:"- %s (\`%h\`)" --grep="^fix" -- apps/cli/ || true)
CHORE=$(git log "$RANGE" --pretty=format:"- %s (\`%h\`)" --grep="^chore" -- apps/cli/ || true)
REFACTOR=$(git log "$RANGE" --pretty=format:"- %s (\`%h\`)" --grep="^refactor" -- apps/cli/ || true)

CHANGELOG_FILE=$(mktemp)
{
  if [ -n "$FEATURES" ]; then echo "## ✨ Features";    echo ""; echo "$FEATURES"; echo ""; fi
  if [ -n "$FIXES" ];    then echo "## 🐛 Bug Fixes";   echo ""; echo "$FIXES";    echo ""; fi
  if [ -n "$REFACTOR" ]; then echo "## ♻️ Refactoring"; echo ""; echo "$REFACTOR"; echo ""; fi
  if [ -n "$CHORE" ];    then echo "## 🔧 Maintenance"; echo ""; echo "$CHORE";    echo ""; fi
  echo "---"
  echo ""
  echo "## 📦 Install"
  echo ""
  echo "\`\`\`bash"
  echo "npx learnhouse@${VERSION}"
  echo "\`\`\`"
  echo ""
  echo "**Full Changelog:** https://github.com/${REPO}/compare/${PREV_TAG:-}...${TAG}"
} > "$CHANGELOG_FILE"

# ─── Create GitHub Release (authored by you) ────────────────────────────────
echo "  🎉 Creating GitHub Release..."
gh release create "$TAG" \
  --title "CLI ${VERSION}" \
  --notes-file "$CHANGELOG_FILE" \
  --latest=false

rm -f "$CHANGELOG_FILE"

echo ""
echo "  ─────────────────────────────────────"
echo "  ✅ CLI ${VERSION} released!"
echo ""
echo "  📋 npm publish (gated on tests): https://github.com/${REPO}/actions/workflows/cli-publish.yaml"
echo "  📋 Release page:                 https://github.com/${REPO}/releases/tag/${TAG}"
echo ""
echo "  ⏳ npm publish runs in CI and will ABORT if the build or tests fail;"
echo "     watch the workflow above before announcing the release."
echo ""
