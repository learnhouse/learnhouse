#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
REPO="$(gh repo view --json nameWithOwner -q .nameWithOwner)"
VERSION="${1:-}"

if [ -z "$VERSION" ]; then
  echo ""
  echo "  📦 LearnHouse Release Script"
  echo ""
  echo "  Usage: .github/utils/release.sh <version>"
  echo "  Example: .github/utils/release.sh 1.0.0"
  echo ""
  exit 1
fi

# Strip leading 'v' if provided
VERSION="${VERSION#v}"
TAG="${VERSION}"

echo ""
echo "  🚀 LearnHouse Release — ${TAG}"
echo "  ─────────────────────────────"
echo ""

# Ensure we're up to date
echo "  📡 Fetching latest from origin..."
git fetch origin

# Check if tag already exists
if git rev-parse "$TAG" >/dev/null 2>&1; then
  echo "  ❌ Error: Tag $TAG already exists."
  exit 1
fi

# ─── Bump version numbers ───────────────────────────────────
echo "  📝 Bumping version to ${VERSION}..."

sed -i '' "s/\"version\": \"[^\"]*\"/\"version\": \"${VERSION}\"/" "$REPO_ROOT/apps/web/package.json"
sed -i '' "s/\"version\": \"[^\"]*\"/\"version\": \"${VERSION}\"/" "$REPO_ROOT/apps/collab/package.json"
sed -i '' "s/^version = \"[^\"]*\"/version = \"${VERSION}\"/" "$REPO_ROOT/apps/api/pyproject.toml"
sed -i '' "s/version=\"[^\"]*\"/version=\"${VERSION}\"/" "$REPO_ROOT/apps/api/app.py"
sed -i '' "s/\"version\": \"[^\"]*\"/\"version\": \"${VERSION}\"/" "$REPO_ROOT/apps/api/ee/routers/info.py"

echo "  ✅ Version bumped in web, collab, api, ee/info"

# ─── Commit version bump on dev ─────────────────────────────
echo "  📦 Committing version bump on dev..."
git add \
  "$REPO_ROOT/apps/web/package.json" \
  "$REPO_ROOT/apps/collab/package.json" \
  "$REPO_ROOT/apps/api/pyproject.toml" \
  "$REPO_ROOT/apps/api/app.py" \
  "$REPO_ROOT/apps/api/ee/routers/info.py"

if git diff --cached --quiet; then
  echo "  ℹ️  Version already at ${VERSION}, skipping commit"
else
  git commit -m "release: bump version to ${VERSION}"
  git push origin dev
fi

# ─── Merge dev → main ───────────────────────────────────────
if ! git show-ref --verify --quiet refs/heads/main; then
  echo "  🌱 Creating local main branch from origin/main..."
  git branch main origin/main
fi

echo "  🔀 Switching to main..."
git checkout main

echo "  ⬇️  Pulling latest main..."
git pull origin main

echo "  🔀 Merging dev into main..."
git merge origin/dev -m "release: merge dev into main for ${TAG}"

echo "  ⬆️  Pushing main..."
git push origin main

# ─── Tag ─────────────────────────────────────────────────────
echo "  🏷️  Creating tag $TAG..."
git tag -a "$TAG" -m "$TAG"

echo "  ⬆️  Pushing tag $TAG..."
git push origin "$TAG"

# ─── Generate changelog ─────────────────────────────────────
echo "  📋 Generating changelog..."

PREV_TAG=$(git tag --list '[0-9]*' --sort=-v:refname | grep -v "^${TAG}$" | head -n1 || true)
if [ -z "$PREV_TAG" ]; then
  RANGE="HEAD"
else
  RANGE="${PREV_TAG}..HEAD"
fi

# Detect database migrations
if [ -n "$PREV_TAG" ]; then
  NEW_MIGRATIONS=$(git diff --name-only "$PREV_TAG"..HEAD -- 'apps/api/migrations/versions/*.py' | grep -v '__pycache__' || true)
else
  NEW_MIGRATIONS=$(git ls-tree -r --name-only HEAD -- 'apps/api/migrations/versions/' | grep '\.py$' || true)
fi
MIGRATION_COUNT=$(echo "$NEW_MIGRATIONS" | sed '/^$/d' | wc -l | tr -d ' ')

# Group commits by type
FEATURES=$(git log "$RANGE" --pretty=format:"- %s (\`%h\`)" --grep="^feat" || true)
FIXES=$(git log "$RANGE" --pretty=format:"- %s (\`%h\`)" --grep="^fix" || true)
PERF=$(git log "$RANGE" --pretty=format:"- %s (\`%h\`)" --grep="^perf" || true)
REFACTOR=$(git log "$RANGE" --pretty=format:"- %s (\`%h\`)" --grep="^refactor" || true)
DOCS=$(git log "$RANGE" --pretty=format:"- %s (\`%h\`)" --grep="^docs" || true)
CHORE=$(git log "$RANGE" --pretty=format:"- %s (\`%h\`)" --grep="^chore" || true)

# Resolve GitHub usernames — one API call per unique author email
resolve_usernames() {
  local range="$1"
  local emails
  emails=$(git log "$range" --pretty=format:"%aE" | sort -u || true)
  local usernames=""
  while IFS= read -r email; do
    [ -z "$email" ] && continue
    local sha
    sha=$(git log "$range" --pretty=format:"%H" --author="$email" -1)
    [ -z "$sha" ] && continue
    local username
    username=$(gh api "repos/${REPO}/commits/${sha}" --jq '.author.login // empty' 2>/dev/null || true)
    [ -z "$username" ] && continue
    usernames="${usernames}${username}"$'\n'
  done <<< "$emails"
  echo "$usernames" | sed '/^$/d' | sort -f
}

ALL_USERNAMES=$(resolve_usernames "$RANGE")

if [ -n "$PREV_TAG" ]; then
  PREV_USERNAMES=$(resolve_usernames "$PREV_TAG")
  NEW_USERNAMES=$(comm -23 <(echo "$ALL_USERNAMES") <(echo "$PREV_USERNAMES") || true)
else
  NEW_USERNAMES="$ALL_USERNAMES"
fi

# Build the changelog file
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
  if [ -n "$PERF" ]; then
    echo "## ⚡ Performance"
    echo ""
    echo "$PERF"
    echo ""
  fi
  if [ -n "$REFACTOR" ]; then
    echo "## ♻️ Refactoring"
    echo ""
    echo "$REFACTOR"
    echo ""
  fi
  if [ -n "$DOCS" ]; then
    echo "## 📚 Documentation"
    echo ""
    echo "$DOCS"
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
  if [ -n "$NEW_USERNAMES" ]; then
    echo "## 🎉 New Contributors"
    echo ""
    while IFS= read -r user; do
      [ -z "$user" ] && continue
      echo "- @${user} made their first contribution!"
    done <<< "$NEW_USERNAMES"
    echo ""
  fi
  if [ -n "$ALL_USERNAMES" ]; then
    echo "## 👥 Contributors"
    echo ""
    CONTRIBUTOR_LIST=""
    while IFS= read -r user; do
      [ -z "$user" ] && continue
      if [ -n "$CONTRIBUTOR_LIST" ]; then
        CONTRIBUTOR_LIST="${CONTRIBUTOR_LIST}, @${user}"
      else
        CONTRIBUTOR_LIST="@${user}"
      fi
    done <<< "$ALL_USERNAMES"
    echo "$CONTRIBUTOR_LIST"
    echo ""
  fi
  echo "---"
  echo ""
  echo "## 📦 Getting Started"
  echo ""
  echo "**New installation:**"
  echo ""
  echo "\`\`\`bash"
  echo "npx learnhouse setup"
  echo "\`\`\`"
  echo ""
  echo "**Upgrade to this version:**"
  echo ""
  echo "\`\`\`bash"
  echo "# Back up your database first"
  echo "npx learnhouse backup"
  echo ""
  echo "# Update to this specific version"
  echo "npx learnhouse update --version ${VERSION}"
  echo "\`\`\`"
  echo ""
  echo "**Docker image:**"
  echo ""
  echo "\`\`\`bash"
  echo "docker pull ghcr.io/learnhouse/app:${VERSION}"
  echo "\`\`\`"
  echo ""
  if [ "$MIGRATION_COUNT" -gt 0 ]; then
    echo "> [!WARNING]"
    echo "> **This release includes ${MIGRATION_COUNT} database migration(s).** Back up your database before upgrading."
    echo ">"
    while IFS= read -r migration; do
      [ -z "$migration" ] && continue
      FILENAME=$(basename "$migration")
      echo "> - \`${FILENAME}\`"
    done <<< "$NEW_MIGRATIONS"
    echo ""
  fi
  echo "**Full Changelog:** https://github.com/${REPO}/compare/${PREV_TAG:-}...${VERSION}"
} > "$CHANGELOG_FILE"

# ─── Create GitHub Release (authored by you) ────────────────
echo "  🎉 Creating GitHub Release..."
gh release create "$TAG" \
  --title "${VERSION}" \
  --notes-file "$CHANGELOG_FILE" \
  --latest

rm -f "$CHANGELOG_FILE"

# ─── Switch back to dev ─────────────────────────────────────
echo "  🔀 Switching back to dev..."
git checkout dev

echo ""
echo "  ─────────────────────────────"
echo "  ✅ Release $TAG published!"
echo ""
echo "  📋 Docker build: https://github.com/${REPO}/actions/workflows/release.yaml"
echo "  📋 Release page: https://github.com/${REPO}/releases/tag/${TAG}"
echo ""
