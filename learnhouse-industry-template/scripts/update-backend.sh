#!/bin/bash
set -e

# Update LearnHouse backend from upstream repository
# This pulls changes from https://github.com/learnhouse/learnhouse.git main branch
# into the apps/api directory using git subtree

echo "🔄 Pulling LearnHouse updates from upstream..."
echo ""

# Pull updates from LearnHouse main branch into apps/api subtree
# --prefix=apps/api tells git subtree where the subtree is located
# --squash combines all upstream commits into a single commit
# Run from repo root, not from apps/api directory
git subtree pull --prefix=apps/api \
  https://github.com/learnhouse/learnhouse.git main \
  --squash

echo ""
echo "✅ LearnHouse updates pulled successfully!"
echo ""
echo "📋 Recent changes:"
git log --oneline -10
echo ""
echo "⚠️  Next steps:"
echo "1. Review the changes: git log --oneline -10"
echo "2. Check for conflicts in apps/api/"
echo "3. Test locally: cd apps/api && uv run uvicorn app:app --reload"
echo "4. If customizations in apps/api/src/custom/ were affected, review and update"
echo "5. Commit any necessary fixes"
echo "6. Deploy: ./scripts/deploy-backend.sh"
