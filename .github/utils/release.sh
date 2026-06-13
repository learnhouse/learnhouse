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

# Abort with a clear message. Every check in the preflight below runs BEFORE anything
# is mutated, so a failed precondition leaves the repository exactly as it was.
die() { printf '\n  ❌ %s\n\n' "$*" >&2; exit 1; }

# Files that carry the version number — also the only files expected to conflict on
# the dev → main release merge (main still holds the previous version).
VERSION_FILES=(
  "apps/web/package.json"
  "apps/collab/package.json"
  "apps/api/pyproject.toml"
  "apps/api/app.py"
)

echo ""
echo "  🚀 LearnHouse Release — ${TAG}"
echo "  ─────────────────────────────"
echo ""

# ─── Preflight: verify EVERYTHING before changing anything ──────────────────
echo "  🔎 Running preflight checks..."

# Version must look like semver (optionally a -preview / .N suffix)
[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+([.-][0-9A-Za-z.]+)?$ ]] \
  || die "Invalid version '$VERSION' — expected semver, e.g. 1.2.5"

# Tooling + auth
command -v gh >/dev/null 2>&1 || die "GitHub CLI 'gh' is not installed."
gh auth status >/dev/null 2>&1 || die "GitHub CLI is not authenticated — run: gh auth login"
[ -n "$REPO" ] || die "Could not determine the GitHub repo (gh repo view)."

# No half-finished git operation that we'd otherwise stomp on
GIT_DIR="$(git rev-parse --git-dir)"
[ -f "$GIT_DIR/MERGE_HEAD" ] && die "A merge is already in progress. Finish it or run 'git merge --abort' first."
{ [ -d "$GIT_DIR/rebase-merge" ] || [ -d "$GIT_DIR/rebase-apply" ]; } && die "A rebase is in progress. Finish or abort it first."

# Clean working tree — never release uncommitted local changes
git diff --quiet && git diff --cached --quiet \
  || die "Working tree has uncommitted changes. Commit or stash them before releasing."

# Sync refs + tags from origin
echo "  📡 Fetching latest from origin..."
git fetch --quiet origin --tags --prune

# Tag must not already exist (locally or on origin)
git rev-parse -q --verify "refs/tags/$TAG" >/dev/null 2>&1 \
  && die "Tag $TAG already exists locally. Pick a new version or delete the tag first."
git ls-remote --exit-code --tags origin "refs/tags/$TAG" >/dev/null 2>&1 \
  && die "Tag $TAG already exists on origin. Pick a new version."

# Required branches must exist on origin
git ls-remote --exit-code --heads origin dev  >/dev/null 2>&1 || die "origin/dev not found."
git ls-remote --exit-code --heads origin main >/dev/null 2>&1 || die "origin/main not found."

echo "  ✅ Preflight passed — releasing ${TAG} to ${REPO}"

# ─── Bump version numbers ───────────────────────────────────
echo "  📝 Bumping version to ${VERSION}..."

sed -i '' "s/\"version\": \"[^\"]*\"/\"version\": \"${VERSION}\"/" "$REPO_ROOT/apps/web/package.json"
sed -i '' "s/\"version\": \"[^\"]*\"/\"version\": \"${VERSION}\"/" "$REPO_ROOT/apps/collab/package.json"
sed -i '' "s/^version = \"[^\"]*\"/version = \"${VERSION}\"/" "$REPO_ROOT/apps/api/pyproject.toml"
sed -i '' "s/version=\"[^\"]*\"/version=\"${VERSION}\"/" "$REPO_ROOT/apps/api/app.py"
sed -i '' "s/\"version\": \"[^\"]*\"/\"version\": \"${VERSION}\"/" "$REPO_ROOT/apps/api/ee/routers/info.py"

echo "  ✅ Version bumped in web, collab, api, ee/info"

# Verify the bump actually landed in every tracked version file before we commit/push.
for vf in "${VERSION_FILES[@]}"; do
  grep -q "$VERSION" "$REPO_ROOT/$vf" \
    || die "Version bump did not apply to $vf (format may have changed) — aborting before any push."
done

# ─── Commit version bump on dev ─────────────────────────────
echo "  📦 Committing version bump on dev..."

# If apps/api/ee is a symlink, the EE codebase lives in a separate repo —
# the sed bump already updated it there, but we can't stage it here.
FILES_TO_ADD=(
  "$REPO_ROOT/apps/web/package.json"
  "$REPO_ROOT/apps/collab/package.json"
  "$REPO_ROOT/apps/api/pyproject.toml"
  "$REPO_ROOT/apps/api/app.py"
)
if [ -L "$REPO_ROOT/apps/api/ee" ]; then
  echo "  ℹ️  apps/api/ee is a symlink — EE info.py bumped in linked repo, skipping git add here"
else
  FILES_TO_ADD+=("$REPO_ROOT/apps/api/ee/routers/info.py")
fi
git add "${FILES_TO_ADD[@]}"

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
git pull --ff-only origin main \
  || die "Local 'main' has diverged from origin/main — reconcile it before releasing."

echo "  🔀 Merging dev into main..."
if ! git merge origin/dev -m "release: merge dev into main for ${TAG}"; then
  # The ONLY conflicts we expect are the version files (main is one release behind).
  # Auto-resolve those to the new version; abort on anything else so a human looks.
  UNMERGED="$(git diff --name-only --diff-filter=U | sort)"
  [ -z "$UNMERGED" ] && { git merge --abort; die "Merge failed without conflicts to resolve — aborted, repo restored."; }
  EXPECTED="$(printf '%s\n' "${VERSION_FILES[@]}" | sort)"
  UNEXPECTED="$(comm -23 <(printf '%s\n' "$UNMERGED") <(printf '%s\n' "$EXPECTED") || true)"
  if [ -n "$UNEXPECTED" ]; then
    git merge --abort
    die "Merge has conflicts beyond the version files — resolve manually, then re-run:"$'\n'"$UNEXPECTED"
  fi
  echo "  🧩 Auto-resolving version-only conflicts to ${VERSION}..."
  while IFS= read -r vf; do
    [ -z "$vf" ] && continue
    git checkout --theirs -- "$vf"   # take dev's side (the new version)
    git add -- "$vf"
  done <<< "$UNMERGED"
  git commit --no-edit
  echo "  ✅ Version conflicts resolved automatically"
fi

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
