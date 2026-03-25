# LearnHouse CLI

The official LearnHouse CLI — deploy, manage, and operate your LearnHouse instance.

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

- **Node.js** >= 18
- **Docker**

## Commands

| Command | Description |
|---------|-------------|
| `learnhouse setup` | Interactive setup wizard |
| `learnhouse start` | Start all services |
| `learnhouse stop` | Stop all services |
| `learnhouse update` | Update to the latest version |
| `learnhouse update --version <x.y.z>` | Update to a specific version |
| `learnhouse logs` | Stream service logs |
| `learnhouse config` | Show current configuration |
| `learnhouse status` | Show service status |
| `learnhouse health` | Run health checks |
| `learnhouse backup` | Backup database |
| `learnhouse restore <archive>` | Restore database from a backup |
| `learnhouse deployments` | View deployments and set resource limits |
| `learnhouse doctor` | Diagnose common issues |
| `learnhouse shell` | Open a shell in a running container |
| `learnhouse env` | Edit environment variables |
| `learnhouse dev` | Start local development environment |

## Setup

The setup wizard walks through:

1. **Install directory** — where files are generated
2. **Domain** — hostname, port, HTTPS/SSL
3. **Database & Redis** — local (Docker) or external
4. **Organization** — name for your instance
5. **Admin account** — email and password
6. **Features** — AI, email, S3, OAuth, Unsplash

You can go back to any step, and edit from the summary before confirming.

## Updating

```bash
# Back up first
npx learnhouse backup

# Update to latest
npx learnhouse update

# Or a specific version
npx learnhouse update --version 1.2.0
```

The update command pulls the new image, restarts services, and asks if you want to run database migrations. Check [docs.learnhouse.app](https://docs.learnhouse.app) for migration guides before proceeding.

## Generated Files

```
learnhouse/
  docker-compose.yml       # Service definitions
  .env                     # Configuration
  learnhouse.config.json   # CLI metadata
  extra/
    nginx.prod.conf        # Reverse proxy (or Caddyfile for auto-SSL)
```

## License

GPL-3.0
