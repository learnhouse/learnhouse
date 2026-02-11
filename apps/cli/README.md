# LearnHouse CLI

Deploy and manage a self-hosted LearnHouse instance with a single command. Handles configuration, Docker, SSL, and database setup.

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

This installs Docker and Node.js if needed, then launches the CLI.

### If you already have Docker and Node.js

```bash
npx learnhouse@latest
```

## Requirements

- **Node.js** >= 18
- **Docker** with Docker Compose v2

## Commands

| Command | Description |
|---------|-------------|
| `learnhouse setup` | Interactive setup wizard — domain, database, admin account, optional features |
| `learnhouse start` | Start all services |
| `learnhouse stop` | Stop all services |
| `learnhouse logs` | Stream logs from all containers (full history + follow) |
| `learnhouse config` | Show current configuration |
| `learnhouse backup` | Backup or restore the database |
| `learnhouse deployments` | View deployments and set resource limits |
| `learnhouse doctor` | Run diagnostics — checks Docker, containers, ports, DNS, disk, logs, env |
| `learnhouse shell` | Open an interactive shell in a running container |

## Setup Wizard

The setup wizard walks through:

1. **Install directory** — where files are generated
2. **Domain** — hostname, port, HTTPS/SSL configuration
3. **Database & Redis** — local (Docker) or external connection strings
4. **Organization** — name for your LearnHouse instance
5. **Admin account** — email and password
6. **Optional features** — AI (Gemini), email (Resend), S3 storage, Google OAuth, Unsplash

You can go back to any previous step during setup, and edit any step from the summary before confirming.

At the end, the wizard generates `docker-compose.yml`, `.env`, and proxy configs, then optionally starts everything.

## Managing Your Instance

```bash
# Start / stop
npx learnhouse start
npx learnhouse stop

# View logs
npx learnhouse logs

# Backup database
npx learnhouse backup

# Diagnose issues
npx learnhouse doctor

# Open a shell in a container
npx learnhouse shell

# Set memory limits
npx learnhouse deployments
```

## What Gets Generated

After setup, your install directory contains:

```
learnhouse/
  docker-compose.yml    # Service definitions
  .env                  # All configuration
  learnhouse.config.json # CLI metadata
  extra/
    nginx.prod.conf     # Nginx config (or Caddyfile for auto-SSL)
```

## License

GPL-3.0
