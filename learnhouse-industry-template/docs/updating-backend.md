# Updating Backend from LearnHouse Upstream

This guide explains how to pull updates from the upstream LearnHouse repository into your industry-specific backend.

## How It Works

Your backend (`apps/api/`) is added as a **git subtree** from the LearnHouse repository. This means:
- The LearnHouse code lives inside your repository at `apps/api/`
- Your customizations live in `apps/api/src/custom/` (untouched by updates)
- You can pull upstream changes without breaking your customizations

## Pulling Updates

### Method 1: Using the Update Script (Recommended)

```bash
cd learnhouse-petcare  # or your industry repo
./scripts/update-backend.sh
```

### Method 2: Manual Command

```bash
cd learnhouse-petcare  # or your industry repo

# Pull updates from LearnHouse main branch
git subtree pull --prefix=apps/api \
  https://github.com/learnhouse/learnhouse.git main \
  --squash
```

**Important:** Run this from the **repo root**, not from `apps/api/` directory.

## What Happens During Update

1. **Git subtree pull** fetches the latest changes from LearnHouse main branch
2. **--squash** combines all upstream commits into a single commit (keeps history clean)
3. **--prefix=apps/api** tells git where the subtree is located
4. Git merges the changes into your `apps/api/` directory

## Handling Conflicts

If there are conflicts:

1. **Review conflicts:**
   ```bash
   git status
   git diff
   ```

2. **Resolve conflicts** in the affected files:
   - Upstream changes in `apps/api/src/` (LearnHouse core)
   - Your customizations in `apps/api/src/custom/` (shouldn't conflict)

3. **Complete the merge:**
   ```bash
   git add apps/api/
   git commit -m "Merge LearnHouse updates, resolve conflicts"
   ```

## After Updating

1. **Review changes:**
   ```bash
   git log --oneline -10
   git diff HEAD~1 apps/api/
   ```

2. **Test locally:**
   ```bash
   cd apps/api
   uv run uvicorn app:app --reload
   ```

3. **Check your customizations:**
   - Verify `apps/api/src/custom/` is intact
   - Check if any LearnHouse changes affect your custom code
   - Update custom code if needed

4. **Deploy:**
   ```bash
   ./scripts/deploy-backend.sh
   ```

## Why This Works Safely

- **Your custom code** (`apps/api/src/custom/`) is separate from LearnHouse code
- **Git subtree** only updates files that exist in upstream
- **Your custom files** won't be touched unless LearnHouse adds files with the same paths
- **Frontend is unaffected** - it only calls APIs, doesn't depend on backend code

## Troubleshooting

**Error: "prefix 'apps/api' already exists"**
- This means the subtree is already added (normal)
- Just run the pull command

**Conflicts in custom files:**
- This shouldn't happen if LearnHouse doesn't add files to `src/custom/`
- If it does, resolve manually and keep your customizations

**Update breaks something:**
- Check `git log` to see what changed
- Test locally before deploying
- Rollback if needed: `git revert HEAD`
