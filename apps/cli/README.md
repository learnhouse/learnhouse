# LearnHouse CLI

The official [LearnHouse](https://learnhouse.app) CLI for deploying, managing, and operating your LearnHouse instance.

[Website](https://learnhouse.app) | [Documentation](https://docs.learnhouse.app) | [GitHub](https://github.com/learnhouse/learnhouse)

<img width="915" height="871" alt="image" src="https://github.com/user-attachments/assets/957c6cea-3efb-4cab-a643-55df3ac4c6aa" />

## Quick Start

### One-line install

**macOS / Linux:**

```bash
curl -fsSL https://raw.githubusercontent.com/learnhouse/learnhouse/main/apps/cli/install.sh | bash
```

**Windows (PowerShell):**

```powershell
irm https://raw.githubusercontent.com/learnhouse/learnhouse/main/apps/cli/install.ps1 | iex
```

### Using npx

```bash
npx learnhouse@latest setup
```

### Install a specific version

```bash
npx learnhouse@1.0.0 setup
```

## Requirements

- **Node.js** >= 22
- **Docker** with the Compose v2 plugin (`docker compose`)

## Commands

| Command | Description |
|---------|-------------|
| `learnhouse setup` | Interactive setup wizard |
| `learnhouse start` | Start all services |
| `learnhouse stop` | Stop all services (containers are kept) |
| `learnhouse update` | Update to the latest version |
| `learnhouse update --to <x.y.z>` | Update to a specific version |
| `learnhouse logs` | Stream service logs |
| `learnhouse config` | Show current configuration |
| `learnhouse status` | Show service status |
| `learnhouse health` | Run health checks |
| `learnhouse backup` | Back up the database, `.env` and uploaded content |
| `learnhouse restore <archive>` | Restore a backup (or a `.sql.gz` dump written by `update`) |
| `learnhouse deployments` | View deployments and set resource limits |
| `learnhouse scale` | Set memory limits per service |
| `learnhouse doctor` | Diagnose common issues |
| `learnhouse shell` | Open a shell in a running container |
| `learnhouse env` | Edit environment variables |
| `learnhouse dev` | Start local development environment |

## Setup

The setup wizard walks through:

1. **Install directory**: where files are generated
2. **Domain**: hostname, port, HTTPS/SSL
3. **Database & Redis**: local (Docker) or external
4. **Organization**: name for your instance
5. **Admin account**: email and password
6. **Features**: AI, email, S3, OAuth

You can go back to any step, and edit from the summary before confirming.

## Updating

```bash
# Back up first
npx learnhouse backup

# Update to latest
npx learnhouse update

# Or a specific version
npx learnhouse update --to 1.2.0
```

The update command backs up the database to `backups/db-pre-upgrade-*.sql.gz`, pulls the new image, runs the database migrations with it before it starts, then restarts services. If a step fails, the previous version keeps running. To roll back the database, run `npx learnhouse restore backups/db-pre-upgrade-<timestamp>.sql.gz`.

## Choosing an installation

Commands act on the installation in the current directory, otherwise on the only one under `~/.learnhouse`. With several, pass `--dir`:

```bash
npx learnhouse --dir ~/.learnhouse/production status
```

## Generated Files

```
learnhouse/
  docker-compose.yml       # Service definitions
  .env                     # Configuration
  learnhouse.config.json   # CLI metadata
  extra/
    nginx.prod.conf        # Reverse proxy (or Caddyfile for auto-SSL)
```

## CI / Non-interactive Mode

`setup --ci`, `start`, `stop`, `update`, `status`, `health`, `doctor`, `config`, `logs`, `backup` and `restore --yes` run without prompts. `env`, `scale`, `deployments` and `shell` are interactive and exit with code 2 when there is no terminal. `health` and `doctor` exit with code 1 when a check fails. The update check is skipped in CI; set `LEARNHOUSE_NO_UPDATE_CHECK=1` to turn it off elsewhere.

Secrets can be passed as environment variables instead of flags, which keeps them out of the process list and shell history: `LEARNHOUSE_ADMIN_PASSWORD`, `LEARNHOUSE_LICENSE_KEY`, `LEARNHOUSE_CF_API_TOKEN`, `LEARNHOUSE_EXTERNAL_DB`, `LEARNHOUSE_EXTERNAL_REDIS`.

```bash
# Setup without prompts
LEARNHOUSE_ADMIN_PASSWORD=secretpass123 npx learnhouse setup --ci \
  --name production \
  --domain example.com \
  --port 80 \
  --admin-email admin@example.com

# Re-running setup --ci on the same --name reconfigures it in place
# (same deployment, database password and secrets).

# Update to a specific version (migrations run by default)
npx learnhouse update --to 1.2.0

# Restore without a prompt
npx learnhouse restore backups/learnhouse-backup-<timestamp>.tar.gz --yes

# Update without migrations
npx learnhouse update --no-migrate

# Setup without starting services
npx learnhouse setup --ci --admin-password pass123 --no-start
```

## Testing

```bash
# Unit tests (no Docker required)
bun run test

# Integration tests (requires Docker)
bun run test:integration

# All tests
bun run test:all
```

**Unit tests** cover template generation (docker-compose, .env, nginx, caddyfile) and config store operations.

**Integration tests** run the full lifecycle with real Docker containers: setup → start → status → health → doctor → stop → restart. They use `--ci` mode to run without prompts.

**Not yet tested:**
- Interactive commands against a real terminal (env editor, shell, deployments scaling)
- `update` with actual version swap between two published images
- `update --migrate` with pending Alembic migrations
- `logs` (streams indefinitely)
- `dev` mode (requires full monorepo source)
- Error recovery (Docker daemon down, port conflicts, corrupted config)

## License

GPL-3.0
