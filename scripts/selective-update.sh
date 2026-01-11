#!/bin/bash
set -e

# Selective Update Script for LearnHouse Backend
# This script helps you review and selectively apply updates from upstream

UPSTREAM_REPO="https://github.com/learnhouse/learnhouse.git"
UPSTREAM_BRANCH="main"
CURRENT_BRANCH=$(git branch --show-current)

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}🔄 LearnHouse Selective Update Tool${NC}"
echo ""

# Check if upstream remote exists
if ! git remote | grep -q "^upstream$"; then
    echo -e "${YELLOW}⚠️  Upstream remote not found. Adding it...${NC}"
    git remote add upstream "$UPSTREAM_REPO"
    echo -e "${GREEN}✅ Upstream remote added${NC}"
fi

# Fetch latest from upstream
echo -e "${BLUE}📥 Fetching latest from upstream...${NC}"
git fetch upstream "$UPSTREAM_BRANCH"
echo ""

# Check what commits are available
echo -e "${BLUE}📋 Commits available in upstream (not in your branch):${NC}"
echo ""
git log "$CURRENT_BRANCH"..upstream/"$UPSTREAM_BRANCH" --oneline --prefix=apps/api | head -20

TOTAL_COMMITS=$(git rev-list --count "$CURRENT_BRANCH"..upstream/"$UPSTREAM_BRANCH" --prefix=apps/api 2>/dev/null || echo "0")

if [ "$TOTAL_COMMITS" -eq "0" ]; then
    echo -e "${GREEN}✅ You're up to date! No new commits in upstream.${NC}"
    exit 0
fi

echo ""
echo -e "${YELLOW}Found $TOTAL_COMMITS commit(s) in upstream${NC}"
echo ""

# Menu
echo "What would you like to do?"
echo "1) Review a specific commit"
echo "2) Cherry-pick a specific commit"
echo "3) See commits by category (security, bug fixes, features)"
echo "4) Pull all updates (standard subtree pull)"
echo "5) Create review branch and pull all updates"
echo "6) Exit"
echo ""
read -p "Enter choice [1-6]: " choice

case $choice in
    1)
        echo ""
        read -p "Enter commit hash: " commit_hash
        echo ""
        echo -e "${BLUE}📄 Showing commit details:${NC}"
        git show "$commit_hash" --stat --prefix=apps/api/
        echo ""
        echo -e "${BLUE}📝 Full diff:${NC}"
        git show "$commit_hash" --prefix=apps/api/
        ;;
    2)
        echo ""
        read -p "Enter commit hash to cherry-pick: " commit_hash
        echo ""
        echo -e "${YELLOW}⚠️  This will apply the commit to your current branch${NC}"
        read -p "Continue? [y/N]: " confirm
        if [[ $confirm == [yY] ]]; then
            git cherry-pick "$commit_hash"
            echo -e "${GREEN}✅ Commit cherry-picked successfully${NC}"
            echo ""
            echo "Next steps:"
            echo "1. Review changes: git status"
            echo "2. Test backend: cd apps/api && uv run uvicorn app:app --reload"
            echo "3. Commit if satisfied: git commit -m 'Your message'"
        else
            echo "Cancelled"
        fi
        ;;
    3)
        echo ""
        echo -e "${RED}🔒 Security/Bug Fixes:${NC}"
        git log "$CURRENT_BRANCH"..upstream/"$UPSTREAM_BRANCH" --prefix=apps/api --grep="security\|fix\|bug\|vulnerability" --oneline | head -10
        echo ""
        echo -e "${GREEN}✨ Features:${NC}"
        git log "$CURRENT_BRANCH"..upstream/"$UPSTREAM_BRANCH" --prefix=apps/api --grep="feat\|add\|new" --oneline | head -10
        echo ""
        echo -e "${BLUE}🔧 Refactoring:${NC}"
        git log "$CURRENT_BRANCH"..upstream/"$UPSTREAM_BRANCH" --prefix=apps/api --grep="refactor\|chore" --oneline | head -10
        ;;
    4)
        echo ""
        echo -e "${YELLOW}⚠️  This will pull ALL updates from upstream${NC}"
        read -p "Continue? [y/N]: " confirm
        if [[ $confirm == [yY] ]]; then
            git subtree pull --prefix=apps/api "$UPSTREAM_REPO" "$UPSTREAM_BRANCH" --squash
            echo -e "${GREEN}✅ Updates pulled successfully${NC}"
        else
            echo "Cancelled"
        fi
        ;;
    5)
        echo ""
        BRANCH_NAME="review-updates-$(date +%Y%m%d)"
        echo -e "${BLUE}🌿 Creating review branch: $BRANCH_NAME${NC}"
        git checkout -b "$BRANCH_NAME"
        git subtree pull --prefix=apps/api "$UPSTREAM_REPO" "$UPSTREAM_BRANCH" --squash
        echo ""
        echo -e "${GREEN}✅ Review branch created with all updates${NC}"
        echo ""
        echo "Next steps:"
        echo "1. Review changes: git log --oneline -10"
        echo "2. Check diff: git diff $CURRENT_BRANCH..$BRANCH_NAME -- apps/api/"
        echo "3. Test: cd apps/api && uv run uvicorn app:app --reload"
        echo "4. If satisfied, merge: git checkout $CURRENT_BRANCH && git merge $BRANCH_NAME"
        ;;
    6)
        echo "Exiting..."
        exit 0
        ;;
    *)
        echo "Invalid choice"
        exit 1
        ;;
esac

