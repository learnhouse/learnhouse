#!/bin/bash
set -e
cd apps/api
echo "Pulling LearnHouse updates..."
git subtree pull --prefix=. \
  https://github.com/learnhouse/learnhouse.git main \
  --squash
echo "Review changes:"
git log --oneline -10
echo "Test locally: pnpm --filter api dev"
