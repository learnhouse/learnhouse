#!/bin/bash
set -e
INDUSTRY=$1
if [ -z "$INDUSTRY" ]; then
  echo "Usage: ./create-industry.sh <industry>"
  exit 1
fi

mkdir -p "learnhouse-${INDUSTRY}"
cd "learnhouse-${INDUSTRY}"
git init
git commit --allow-empty -m "init"

mkdir -p apps

# init learnhouse backend subtree from repo root (creates apps/api)
cd ..
git -C "learnhouse-${INDUSTRY}" subtree add --prefix=apps/api \
  https://github.com/learnhouse/learnhouse.git main \
  --squash
cd "learnhouse-${INDUSTRY}"

# overlay backend template (custom AI stubs, docker, etc.)
rsync -a ../learnhouse-industry-template/templates/backend/ ./apps/api/ --exclude .git

# copy frontend template
cp -r ../learnhouse-industry-template/templates/frontend ./apps/web

# replace placeholders
find apps -type f -name ".env.example" -print0 | xargs -0 sed -i '' "s/INDUSTRY_PLACEHOLDER/${INDUSTRY}/g"
cp ../learnhouse-industry-template/turbo.json.template ./turbo.json
pnpm install

echo "✅ Created learnhouse-${INDUSTRY}"
echo "Next steps:"
echo "1) Fill apps/api/.env with DB/Redis/AI keys"
echo "2) Fill apps/web/.env.local with API URL"
echo "3) Customize AI prompts in apps/api/src/custom/ai/prompts.py"
echo "4) Deploy backend: ./scripts/deploy-backend.sh"
echo "5) Deploy frontend: connect repo to Vercel"
