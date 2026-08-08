# Contributing to LearnHouse

## Getting Started

To set up your development environment, use the LearnHouse CLI:

```bash
git clone https://github.com/learnhouse/learnhouse.git
cd learnhouse
npx learnhouse dev
```

This will spin up PostgreSQL and Redis containers, install dependencies, and start the API, Web, and Collab servers. See the [CLI documentation](apps/cli/README.md) for more details.

## Dependencies and lockfiles

Every install in CI and in the Docker images is frozen, so a manifest change
that skips the lockfile fails the build with `lockfile had changes, but
lockfile is frozen`. After touching a `package.json`, `apps/api/pyproject.toml`
or a version number, run:

```bash
scripts/lockfiles.sh          # regenerate every lockfile
scripts/lockfiles.sh --check  # what CI runs
```

The `Lockfiles` workflow checks this on every PR, and pushes the regenerated
files back to dependency-bot branches on its own.

## Submitting Contributions

This project follows [GitHub's standard forking model](https://guides.github.com/activities/forking/). Please fork the project to submit pull requests.

### Submitting a bug/fix

- Start an issue [here](https://github.com/learnhouse/learnhouse/issues) to report the bug.
- Please include a detailed description of the bug and how it can be reproduced.
- Someone from the team will review the issue and will give you a go ahead.

### Submitting a feature / idea

- Start a Discussion [here](https://github.com/learnhouse/learnhouse/discussions/categories/ideas) to propose your idea and how it should be implemented.
- Someone from the team will review your idea and will give you a go ahead.
- Start an issue & link the discussion to it.
- Clone your fork locally
- Create a new branch and make your commits
- Push your commits to your forked repo
- Make a Pull request
- Code will be added after review
