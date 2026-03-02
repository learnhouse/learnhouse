# CLI Release Workflow

How to release a new version of the LearnHouse CLI to npm.

## Prerequisites

- npm org `learnhouse` created on [npmjs.com](https://www.npmjs.com)
- `NPM_TOKEN` (Automation type) added to GitHub repo: **Settings > Secrets > Actions**
- Push access to the repository

## Steps

### 1. Bump the version

From the CLI directory:

```bash
cd apps/cli
```

Pick the bump type based on the changes:

| Command | When to use | Example |
|---------|-------------|---------|
| `bun run version:patch` | Bug fixes, small tweaks | 0.1.0 → 0.1.1 |
| `bun run version:minor` | New features, non-breaking | 0.1.0 → 0.2.0 |
| `bun run version:major` | Breaking changes | 0.1.0 → 1.0.0 |

This updates **both** `package.json` and `src/constants.ts` to keep them in sync.

### 2. Commit the version bump

```bash
git add apps/cli/package.json apps/cli/src/constants.ts
git commit -m "chore: bump cli to 0.2.0"
```

### 3. Create a git tag

The tag **must** follow the format `cli-v<version>`:

```bash
git tag cli-v0.2.0
```

### 4. Push the commit and tag

```bash
git push origin your-branch
git push origin cli-v0.2.0
```

### 5. Automatic — GitHub Actions takes over

The tag push triggers `.github/workflows/cli-publish.yaml` which:

1. Checks out the code
2. Sets up Bun
3. Installs dependencies (`bun install --frozen-lockfile`)
4. Builds the CLI (`bun run build`)
5. Verifies the tag version matches `package.json` (fails if mismatched)
6. Publishes to npm (`npm publish`) — `prepublishOnly` runs a fresh build as a safety net
7. Creates a GitHub Release with auto-generated release notes

### 6. Verify

After the workflow completes (~1-2 minutes):

- **npm:** https://www.npmjs.com/package/learnhouse — should show the new version
- **GitHub:** Check the Releases page for the auto-generated release
- **Test:** `npx learnhouse@latest --version` should print the new version

## How it works

### Version lives in two places

| File | Field | Why |
|------|-------|-----|
| `package.json` | `"version"` | npm uses this for publishing |
| `src/constants.ts` | `VERSION` | CLI displays this at runtime (banner, `--version`) |

The `scripts/bump-version.js` script updates both at once so they never drift.

### Tag format

The workflow only triggers on tags matching `cli-v*`. This means:

- Regular commits and PRs **never** trigger a publish
- Only explicit `git tag cli-v*` + push triggers it
- Other tags (e.g. `api-v1.0.0`) are ignored

### Safety checks

- **Version mismatch guard:** The workflow extracts the version from the tag and compares it to `package.json`. If they don't match, the publish fails.
- **prepublishOnly:** npm automatically runs `tsup` before every publish, ensuring the `dist/` bundle is always fresh.
- **frozen lockfile:** Dependencies are installed with `--frozen-lockfile` so CI never silently updates packages.

## Quick reference

```bash
# Full release flow (example: releasing 0.2.0)
cd apps/cli
bun run version:minor                                    # 0.1.0 → 0.2.0
git add apps/cli/package.json apps/cli/src/constants.ts
git commit -m "chore: bump cli to 0.2.0"
git tag cli-v0.2.0
git push origin your-branch && git push origin cli-v0.2.0
# Done — GitHub Actions handles the rest
```

## Troubleshooting

### Workflow didn't trigger
- Check the tag format: must be `cli-v*` (e.g. `cli-v0.2.0`, not `v0.2.0`)
- Verify the tag was pushed: `git ls-remote --tags origin | grep cli-v`

### Version mismatch error
- You tagged `cli-v0.2.0` but `package.json` says `0.1.0`
- Fix: run `bun run version:minor` (or the correct bump), amend the commit, re-tag

### npm 403 / auth error
- Check that `NPM_TOKEN` secret is set in GitHub repo settings
- Token must be an **Automation** type token from the npm org
- Token must have publish permissions for the `learnhouse` package

### Build fails
- Run `bun run build` locally first to catch TypeScript errors
- Check that `bun install --frozen-lockfile` works (if not, update `bun.lockb`)
