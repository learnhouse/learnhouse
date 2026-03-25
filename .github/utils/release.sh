#!/usr/bin/env bash
set -euo pipefail

VERSION="${1:-}"

if [ -z "$VERSION" ]; then
  echo "Usage: .github/utils/release.sh <version>"
  echo "Example: .github/utils/release.sh 1.0.0"
  exit 1
fi

# Strip leading 'v' if provided
VERSION="${VERSION#v}"
TAG="v${VERSION}"

# Ensure we're up to date
echo "Fetching latest from origin..."
git fetch origin

# Check if tag already exists
if git rev-parse "$TAG" >/dev/null 2>&1; then
  echo "Error: Tag $TAG already exists."
  exit 1
fi

# Check if main branch exists locally, create if not
if ! git show-ref --verify --quiet refs/heads/main; then
  echo "Creating local main branch from origin/main..."
  git branch main origin/main
fi

# Switch to main and merge dev
echo "Switching to main..."
git checkout main

echo "Pulling latest main..."
git pull origin main

echo "Merging dev into main..."
git merge origin/dev -m "release: merge dev into main for $TAG"

echo "Pushing main..."
git push origin main

# Tag and push
echo "Creating tag $TAG..."
git tag -a "$TAG" -m "$TAG"

echo "Pushing tag $TAG..."
git push origin "$TAG"

# Switch back to dev
echo "Switching back to dev..."
git checkout dev

echo ""
echo "Done! Release $TAG has been triggered."
echo "Watch the workflow: https://github.com/learnhouse/learnhouse/actions/workflows/release.yaml"
