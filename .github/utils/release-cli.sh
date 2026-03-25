#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
REPO="$(gh repo view --json nameWithOwner -q .nameWithOwner)"
VERSION="${1:-}"

if [ -z "$VERSION" ]; then
  echo ""
  echo "  📦 LearnHouse CLI Release Script"
  echo ""
  echo "  Usage: .github/utils/release-cli.sh <version>"
  echo "  Example: .github/utils/release-cli.sh 1.3.0"
  echo ""
  exit 1
fi

# Strip leading 'v' if provided
VERSION="${VERSION#v}"
TAG="cli-${VERSION}"

echo ""
echo "  🚀 LearnHouse CLI Release — ${VERSION}"
echo "  ─────────────────────────────────────"
echo ""

# Ensure we're up to date
echo "  📡 Fetching latest from origin..."
git fetch origin

# Check if tag already exists
if git rev-parse "$TAG" >/dev/null 2>&1; then
  echo "  ❌ Error: Tag $TAG already exists."
  exit 1
fi

# ─── Bump CLI version ───────────────────────────────────────
echo "  📝 Bumping CLI version to ${VERSION}..."

# apps/cli/package.json
sed -i '' "s/\"version\": \"[^\"]*\"/\"version\": \"${VERSION}\"/" "$REPO_ROOT/apps/cli/package.json"

# apps/cli/src/constants.ts
sed -i '' "s/export const VERSION = '[^']*'/export const VERSION = '${VERSION}'/" "$REPO_ROOT/apps/cli/src/constants.ts"

echo "  ✅ Version bumped in package.json + constants.ts"

# ─── Commit version bump on dev ─────────────────────────────
echo "  📦 Committing version bump on dev..."
git add \
  "$REPO_ROOT/apps/cli/package.json" \
  "$REPO_ROOT/apps/cli/src/constants.ts"

if git diff --cached --quiet; then
  echo "  ℹ️  Version already at ${VERSION}, skipping commit"
else
  git commit -m "release(cli): bump version to ${VERSION}"
  git push origin dev
fi

# ─── Tag from dev ────────────────────────────────────────────
echo "  🏷️  Creating tag $TAG..."
git tag -a "$TAG" -m "$TAG"

echo "  ⬆️  Pushing tag $TAG..."
git push origin "$TAG"

# ─── Generate changelog ─────────────────────────────────────
echo "  📋 Generating changelog..."

PREV_TAG=$(git tag --list 'cli-[0-9]*' --sort=-v:refname | grep -v "^${TAG}$" | head -n1 || true)
if [ -z "$PREV_TAG" ]; then
  RANGE="HEAD"
else
  RANGE="${PREV_TAG}..HEAD"
fi

# Only include commits that touched apps/cli/
FEATURES=$(git log "$RANGE" --pretty=format:"- %s (\`%h\`)" --grep="^feat" -- apps/cli/ || true)
FIXES=$(git log "$RANGE" --pretty=format:"- %s (\`%h\`)" --grep="^fix" -- apps/cli/ || true)
CHORE=$(git log "$RANGE" --pretty=format:"- %s (\`%h\`)" --grep="^chore" -- apps/cli/ || true)
REFACTOR=$(git log "$RANGE" --pretty=format:"- %s (\`%h\`)" --grep="^refactor" -- apps/cli/ || true)

CHANGELOG_FILE=$(mktemp)
{
  if [ -n "$FEATURES" ]; then
    echo "## ✨ Features"
    echo ""
    echo "$FEATURES"
    echo ""
  fi
  if [ -n "$FIXES" ]; then
    echo "## 🐛 Bug Fixes"
    echo ""
    echo "$FIXES"
    echo ""
  fi
  if [ -n "$REFACTOR" ]; then
    echo "## ♻️ Refactoring"
    echo ""
    echo "$REFACTOR"
    echo ""
  fi
  if [ -n "$CHORE" ]; then
    echo "## 🔧 Maintenance"
    echo ""
    echo "$CHORE"
    echo ""
  fi
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

# ─── Create GitHub Release (authored by you) ────────────────
echo "  🎉 Creating GitHub Release..."
gh release create "$TAG" \
  --title "CLI ${VERSION}" \
  --notes-file "$CHANGELOG_FILE" \
  --latest=false

rm -f "$CHANGELOG_FILE"

echo ""
echo "  ─────────────────────────────────────"
echo "  ✅ CLI ${VERSION} published!"
echo ""
echo "  📋 npm publish: https://github.com/${REPO}/actions/workflows/cli-publish.yaml"
echo "  📋 Release page: https://github.com/${REPO}/releases/tag/${TAG}"
echo ""
