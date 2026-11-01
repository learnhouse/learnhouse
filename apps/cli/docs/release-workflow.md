# CLI Release Workflow

How to release a new version of the LearnHouse CLI to npm.

## Prerequisites

- npm org `learnhouse` created on [npmjs.com](https://www.npmjs.com)
- `NPM_TOKEN` (Automation type) added to GitHub repo: **Settings > Secrets > Actions**
- `gh` CLI installed and authenticated (`gh auth status`)
- Push access to the repository

## Quick release (recommended)

From the repo root, run the release script with the new version:

```bash
./.github/utils/release-cli.sh 1.4.3
```

Pick the version based on the changes:

| Bump type | When to use | Example |
|-----------|-------------|---------|
| patch | Bug fixes, small tweaks | 1.4.2 → 1.4.3 |
| minor | New features, non-breaking | 1.4.2 → 1.5.0 |
| major | Breaking changes | 1.4.2 → 2.0.0 |

The script does everything end-to-end:

1. Fetches latest from `origin`
2. Bumps `apps/cli/package.json` and `apps/cli/src/constants.ts` (keeps them in sync)
3. Commits the bump on `dev` and pushes (skipped if already at that version)
4. Creates and pushes the tag `cli-<version>` (e.g. `cli-1.4.3`), with **no `v` prefix**
5. Generates a changelog from `feat/fix/refactor/chore` commits that touched `apps/cli/`
6. Creates a GitHub Release authored by you (not the bot)

The tag push triggers `.github/workflows/cli-publish.yaml`, which:

1. Checks out the code and sets up Node (24) + Bun (version from `.bun-version`)
2. Installs dependencies (`bun install --frozen-lockfile`)
3. Builds and runs the unit suite (`bun run test`); any failure stops the job before publishing
4. Verifies the tag version, `package.json` and the built binary (`node dist/bin/learnhouse.js --version`) all agree
5. Validates the package without uploading (`npm publish --dry-run`)
6. Publishes to npm with provenance (`npm publish --provenance --access public`)

All steps run in `apps/cli`.

## Verify

After the workflow completes (several minutes, since the unit suite runs before publishing):

- **npm:** https://www.npmjs.com/package/learnhouse should show the new version
- **GitHub:** Releases page shows the new release
- **Test:** `npx learnhouse@latest --version` prints the new version

## Manual release (fallback)

If the script can't run (no `gh`, not on macOS, etc.), do it by hand:

```bash
cd apps/cli
bun run version:patch   # or version:minor / version:major, or: node scripts/bump-version.js 1.4.3
git add package.json src/constants.ts
git commit -m "release(cli): bump version to 1.4.3"
git push origin dev

# Tag format is cli-<version>, with NO "v" prefix
git tag cli-1.4.3
git push origin cli-1.4.3
```

The tag push still triggers the publish workflow. You'll need to create the GitHub Release manually if you want one (`gh release create cli-1.4.3 --title "CLI 1.4.3" ...`).

## How it works

### Version lives in two places

| File | Field | Why |
|------|-------|-----|
| `apps/cli/package.json` | `"version"` | npm uses this for publishing |
| `apps/cli/src/constants.ts` | `VERSION` | CLI displays this at runtime (banner, `--version`) |

The release script (and `scripts/bump-version.js`) update both at once and fail if either file wasn't updated, so they never drift. Bumping a prerelease releases it: `patch` on `1.5.1-beta.1` gives `1.5.1`.

### Tag format

The workflow only triggers on tags matching `cli-[0-9]*`. This means:

- Tags **must** be `cli-1.4.3`, **not** `cli-v1.4.3` or `v1.4.3`
- Regular commits and PRs never trigger a publish
- Only an explicit `cli-<numeric-version>` tag push triggers it
- Other tags (e.g. `api-1.0.0`) are ignored

### Safety checks

- **Test gate:** `bun run test` builds the package and runs the unit suite; nothing is published if it fails.
- **Version mismatch guard:** the workflow extracts the version from the tag and compares it to `package.json` and to the version the built binary prints (which comes from `src/constants.ts`). If any differ, publish fails.
- **Dry run:** `npm publish --dry-run` validates the tarball before the real publish.
- **prepublishOnly:** npm runs `tsup` before every publish, so `dist/` is always fresh.
- **frozen lockfile:** `bun install --frozen-lockfile` prevents silent dependency updates in CI.

## Troubleshooting

### Workflow didn't trigger
- Tag format must be `cli-<version>` with no `v` (e.g. `cli-1.4.3`)
- Verify the tag was pushed: `git ls-remote --tags origin | grep cli-`
- If you tagged with a `v` by mistake, delete it and re-tag:
  ```bash
  git tag -d cli-v1.4.3
  git push origin :refs/tags/cli-v1.4.3
  ./.github/utils/release-cli.sh 1.4.3
  ```

### Version mismatch error in CI
- You tagged `cli-1.4.3` but `package.json` says something else
- Fix: run the correct bump, amend the commit, delete and recreate the tag

### npm 403 / auth error
- Check that `NPM_TOKEN` secret is set in GitHub repo settings
- Token must be an **Automation** type token from the npm org
- Token must have publish permissions for the `learnhouse` package

### Build or tests fail
- Run `bun run test` locally first (it builds, then runs the same unit suite as CI)
- If `bun install --frozen-lockfile` fails, update `bun.lock` and commit it
