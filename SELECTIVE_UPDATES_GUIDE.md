# Selective Updates Guide: Updating LearnHouse Without Breaking Frontend

## 🏗️ Architecture Protection

Your frontend is **protected** because:

1. **Complete Separation**: Frontend (`apps/web`) and backend (`apps/api`) are separate
2. **API-Based Communication**: Frontend only calls REST APIs (`/api/v1/*`)
3. **No Direct Code Dependencies**: Frontend doesn't import backend code directly
4. **Custom Code Isolation**: Your customizations in `apps/api/src/custom/` are separate

**Key Point**: Backend updates only break the frontend if they:
- Change API endpoints (URLs, methods)
- Change API request/response formats
- Remove endpoints the frontend uses

## 📋 Strategy: Selective Commit Updates

Instead of pulling all commits at once, you can selectively choose which updates to apply.

### Method 1: Cherry-Pick Specific Commits (Recommended)

This lets you review and apply individual commits from upstream.

#### Step 1: Add Upstream as a Remote (if not already added)

```bash
# Check if upstream exists
git remote -v

# If not, add it
git remote add upstream https://github.com/learnhouse/learnhouse.git

# Fetch latest from upstream
git fetch upstream main
```

#### Step 2: Review Available Commits

```bash
# See what commits are in upstream that you don't have
git log dev..upstream/main --oneline --prefix=apps/api

# Or see commits with more detail
git log dev..upstream/main --prefix=apps/api --graph --pretty=format:'%h - %s (%cr) <%an>'
```

#### Step 3: Inspect Specific Commits

```bash
# See what files changed in a specific commit
git show <commit-hash> --name-status

# See the actual changes
git show <commit-hash>

# See only changes in apps/api directory
git show <commit-hash> -- apps/api/
```

#### Step 4: Cherry-Pick Individual Commits

```bash
# Cherry-pick a specific commit (only affects apps/api subtree)
git cherry-pick <commit-hash>

# If the commit affects multiple directories, filter to only apps/api
git cherry-pick <commit-hash> --strategy-option=subtree=apps/api

# Or manually apply only apps/api changes
git cherry-pick <commit-hash>
# Then reset other directories if needed
git checkout HEAD -- apps/web dev learnhouse-industry-template
```

#### Step 5: Handle Conflicts

If conflicts occur:

```bash
# See conflicted files
git status

# Resolve conflicts manually, then:
git add apps/api/
git cherry-pick --continue

# Or abort if you change your mind
git cherry-pick --abort
```

### Method 2: Review Before Pulling (Safer)

Pull updates into a separate branch first, review, then merge selectively.

#### Step 1: Create Review Branch

```bash
# Create a branch for reviewing updates
git checkout -b review-upstream-updates

# Pull all updates (using subtree)
git subtree pull --prefix=apps/api \
  https://github.com/learnhouse/learnhouse.git main \
  --squash
```

#### Step 2: Review Changes

```bash
# See what changed
git log --oneline -10

# See detailed diff
git diff dev..review-upstream-updates -- apps/api/

# Check for API endpoint changes
git diff dev..review-upstream-updates -- apps/api/ | grep -E "(def |@router|@app\.|/api/)"
```

#### Step 3: Test Backend Locally

```bash
# Start backend
cd apps/api
uv run uvicorn app:app --reload

# Test API endpoints your frontend uses
curl http://localhost:8000/api/v1/health
curl http://localhost:8000/api/v1/orgs/slug/default
# ... test other endpoints your frontend calls
```

#### Step 4: Merge Selectively

```bash
# If everything looks good, merge back to dev
git checkout dev
git merge review-upstream-updates

# Or cherry-pick only specific commits from review branch
git cherry-pick <commit-hash-from-review-branch>
```

### Method 3: Manual File-Level Updates

For maximum control, manually copy specific files.

#### Step 1: Checkout Specific Files from Upstream

```bash
# Fetch upstream
git fetch upstream main

# Checkout a specific file from upstream
git checkout upstream/main -- apps/api/src/specific/file.py

# Or checkout a directory
git checkout upstream/main -- apps/api/src/specific/directory/
```

#### Step 2: Review and Test

```bash
# Review the changes
git diff HEAD -- apps/api/src/specific/file.py

# Test locally
cd apps/api && uv run uvicorn app:app --reload
```

## 🔍 Identifying Safe vs. Risky Updates

### ✅ Safe Updates (Low Risk to Frontend)

- Bug fixes in backend logic
- Performance improvements
- New API endpoints (additive)
- Database migrations (if compatible)
- Security patches
- Internal refactoring (no API changes)

### ⚠️ Risky Updates (Review Carefully)

- API endpoint changes (URLs, methods)
- Request/response format changes
- Authentication/authorization changes
- Database schema changes (might need migrations)
- Breaking changes in API contracts

### 🔍 How to Identify API Changes

```bash
# Search for router changes
git diff dev..upstream/main -- apps/api/ | grep -E "@router\.(get|post|put|delete|patch)"

# Search for endpoint path changes
git diff dev..upstream/main -- apps/api/ | grep -E "prefix=|path="

# Search for response model changes
git diff dev..upstream/main -- apps/api/ | grep -E "class.*\(.*\):|response_model="
```

## 📝 Recommended Workflow

### 1. Regular Review Process

```bash
# Weekly/Monthly: Check what's new upstream
git fetch upstream main
git log dev..upstream/main --oneline --prefix=apps/api

# Review commit messages for important updates
git log dev..upstream/main --prefix=apps/api --pretty=format:'%h - %s' | head -20
```

### 2. Categorize Updates

Create a list of commits to review:

```bash
# Security updates (high priority)
git log dev..upstream/main --prefix=apps/api --grep="security\|fix\|vulnerability" --oneline

# Bug fixes (medium priority)
git log dev..upstream/main --prefix=apps/api --grep="fix\|bug" --oneline

# Features (low priority, review carefully)
git log dev..upstream/main --prefix=apps/api --grep="feat\|add\|new" --oneline
```

### 3. Test Before Merging

Always test locally before merging to dev:

```bash
# 1. Create test branch
git checkout -b test-update-<date>

# 2. Apply updates
git cherry-pick <commit-hash>

# 3. Test backend
cd apps/api && uv run uvicorn app:app --reload

# 4. Test frontend (in another terminal)
cd apps/web && pnpm dev

# 5. Test critical flows:
#    - Login/Signup
#    - Course creation
#    - API calls your frontend makes

# 6. If all good, merge to dev
git checkout dev
git merge test-update-<date>
```

## 🛡️ Protecting Your Customizations

Your custom code in `apps/api/src/custom/` is safe because:

1. **Separate Directory**: Git subtree won't touch files outside `apps/api/src/`
2. **No Conflicts**: Upstream doesn't modify your custom directory
3. **Isolated**: Your custom routes/features are separate from core

### If Upstream Changes Core Files You Modified

```bash
# Check if upstream changed files you customized
git diff dev..upstream/main -- apps/api/src/core/

# If conflicts occur:
# 1. Keep your version if it's better
# 2. Or merge manually, taking best of both
# 3. Or create a patch file to reapply your changes
```

## 🚨 Handling Breaking API Changes

If upstream changes an API your frontend uses:

### Option 1: Update Frontend (Recommended)

```bash
# 1. Update frontend API calls to match new backend
# 2. Test thoroughly
# 3. Deploy frontend and backend together
```

### Option 2: Maintain Compatibility Layer

Create an adapter in your backend:

```python
# apps/api/src/custom/compat/old_api.py
from fastapi import APIRouter

router = APIRouter(prefix="/api/v1/compat")

@router.get("/old-endpoint")
async def old_endpoint_compat():
    # Call new endpoint internally
    # Transform response to old format
    pass
```

## 📊 Example: Selective Update Session

```bash
# 1. Check what's new
git fetch upstream main
git log dev..upstream/main --oneline --prefix=apps/api

# Output:
# abc1234 fix: security vulnerability in auth
# def5678 feat: new course analytics endpoint  
# ghi9012 fix: database query performance
# jkl3456 refactor: API response format

# 2. Review security fix (high priority)
git show abc1234 --name-status
git show abc1234 -- apps/api/

# 3. Apply security fix
git cherry-pick abc1234

# 4. Review performance fix
git show ghi9012 -- apps/api/
git cherry-pick ghi9012

# 5. Skip feature (review later)
# Skip def5678 for now

# 6. Review refactor carefully (might break frontend)
git show jkl3456 -- apps/api/ | grep -E "response_model|return"
# If it changes response format, update frontend first

# 7. Test
cd apps/api && uv run uvicorn app:app --reload
# Test your frontend against updated backend

# 8. Commit
git commit -m "Selective update: security and performance fixes"
```

## 🎯 Best Practices

1. **Review Before Applying**: Always review commits before cherry-picking
2. **Test Locally First**: Never merge to dev without local testing
3. **Keep a Changelog**: Document what you updated and why
4. **Monitor API Compatibility**: Watch for API changes that affect frontend
5. **Update Regularly**: Don't let updates accumulate (harder to review)
6. **Use Branches**: Always test in a branch before merging to dev
7. **Backup Before Major Updates**: Tag your current state before big updates

## 🔗 Quick Reference Commands

```bash
# Add upstream remote
git remote add upstream https://github.com/learnhouse/learnhouse.git

# Fetch latest
git fetch upstream main

# See what's new
git log dev..upstream/main --oneline --prefix=apps/api

# Review a commit
git show <commit-hash> -- apps/api/

# Cherry-pick a commit
git cherry-pick <commit-hash>

# Create review branch
git checkout -b review-updates
git subtree pull --prefix=apps/api upstream main --squash

# Test backend
cd apps/api && uv run uvicorn app:app --reload
```

## 📚 Additional Resources

- [Git Cherry-Pick Guide](https://git-scm.com/docs/git-cherry-pick)
- [Git Subtree Documentation](https://github.com/git/git/blob/master/contrib/subtree/git-subtree.txt)
- [LearnHouse API Documentation](https://docs.learnhouse.app)

