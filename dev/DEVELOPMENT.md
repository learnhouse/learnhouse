# Development Guide

This guide will help you set up and run LearnHouse in your local development environment. LearnHouse uses a modern stack with a Python (FastAPI) backend and a Next.js frontend.

## Prerequisites

Before you begin, ensure you have the following installed:

- **Docker & Docker Compose**: For running the database and Redis.
- **Node.js**: (v18 or later recommended) and **pnpm** for the frontend.
- **Python**: (v3.12 recommended) and **uv** for backend package management.

---

## Environment Variables

Before starting the application, you need to configure the environment variables for both the backend and frontend.

### Backend (`apps/api/.env`)

| Variable | Description | Default (Dev) |
| :--- | :--- | :--- |
| `LEARNHOUSE_SQL_CONNECTION_STRING` | PostgreSQL connection string | `postgresql://learnhouse:learnhouse@localhost:5432/learnhouse` |
| `LEARNHOUSE_REDIS_CONNECTION_STRING` | Redis connection string | `redis://localhost:6379/0` |
| `LEARNHOUSE_AUTH_JWT_SECRET_KEY` | Secret key for JWT authentication | (Required) |
| `LEARNHOUSE_DEVELOPMENT_MODE` | Enables debug mode and Swagger UI | `true` |
| `LEARNHOUSE_SITE_NAME` | Name of your LearnHouse instance | `LearnHouse` |
| `LEARNHOUSE_DOMAIN` | Domain for cookie and CORS configuration | `localhost` |
| `LEARNHOUSE_ALLOWED_REGEXP` | Regex for CORS allowed origins | `.*localhost.*` |
| `LEARNHOUSE_PORT` | Port for the API server | `8000` |
| `LEARNHOUSE_INITIAL_ADMIN_EMAIL` | Default admin email for installation | `admin@school.dev` |
| `LEARNHOUSE_INITIAL_ADMIN_PASSWORD` | Default admin password (Required for install) | - |
| `LEARNHOUSE_IS_AI_ENABLED` | Enable AI features | `false` |
| `LEARNHOUSE_OPENAI_API_KEY` | OpenAI API key (if AI enabled) | - |

#### Example `apps/api/.env`
```env
LEARNHOUSE_SQL_CONNECTION_STRING=postgresql://learnhouse:learnhouse@localhost:5432/learnhouse
LEARNHOUSE_REDIS_CONNECTION_STRING=redis://localhost:6379/0
LEARNHOUSE_AUTH_JWT_SECRET_KEY=generate_a_random_string_here
LEARNHOUSE_DEVELOPMENT_MODE=true
LEARNHOUSE_SITE_NAME=LearnHouse
LEARNHOUSE_DOMAIN=localhost
LEARNHOUSE_ALLOWED_REGEXP=.*localhost.*
LEARNHOUSE_PORT=8000
LEARNHOUSE_INITIAL_ADMIN_EMAIL=admin@school.dev
LEARNHOUSE_INITIAL_ADMIN_PASSWORD=change_this_password
LEARNHOUSE_IS_AI_ENABLED=false
```

### Frontend (`apps/web/.env.local`)

| Variable | Description | Default (Dev) |
| :--- | :--- | :--- |
| `NEXT_PUBLIC_LEARNHOUSE_API_URL` | URL of the LearnHouse API | `http://localhost:8000/api/v1/` |
| `NEXT_PUBLIC_LEARNHOUSE_BACKEND_URL` | Base URL for the backend | `http://localhost:8000/` |
| `NEXT_PUBLIC_LEARNHOUSE_DOMAIN` | Base domain for the frontend | `localhost` |
| `NEXT_PUBLIC_LEARNHOUSE_HTTPS` | Use HTTPS for links | `false` |
| `NEXT_PUBLIC_LEARNHOUSE_MULTI_ORG` | Enable multi-organization mode | `false` |
| `NEXT_PUBLIC_LEARNHOUSE_DEFAULT_ORG` | Default organization slug | `default` |

#### Example `apps/web/.env.local`
```env
NEXT_PUBLIC_LEARNHOUSE_API_URL=http://localhost:8000/api/v1/
NEXT_PUBLIC_LEARNHOUSE_BACKEND_URL=http://localhost:8000/
NEXT_PUBLIC_LEARNHOUSE_DOMAIN=localhost
NEXT_PUBLIC_LEARNHOUSE_HTTPS=false
NEXT_PUBLIC_LEARNHOUSE_MULTI_ORG=false
NEXT_PUBLIC_LEARNHOUSE_DEFAULT_ORG=default
```

---

## Quick Start (Recommended)

The easiest way to get started is using the provided development script. **Ensure your `.env` files are configured as described above before running.**

1.  **Clone the repository:**
    ```bash
    git clone https://github.com/learnhouse/learnhouse.git
    cd learnhouse
    ```

2.  **Run the start script:**
    ```bash
    ./dev/start.sh
    ```

This script will:
- Spin up PostgreSQL and Redis containers using Docker.
- Wait for the database to be ready.
- Offer to start both the API and Web servers in parallel.

---

## Common Development Tasks

### Creating Database Migrations

If you modify the database models in `apps/api/src/db/`, you should generate a new migration:

1.  **Generate migration script:**
    ```bash
    cd apps/api
    uv run alembic revision --autogenerate -m "description of changes"
    ```

2.  **Apply migration:**
    ```bash
    uv run alembic upgrade head
    ```

### Running Tests

#### Backend
```bash
cd apps/api
uv run pytest
```

#### Frontend
```bash
cd apps/web
pnpm lint
```

## Infrastructure Management

You can manually manage the development infrastructure (Postgres & Redis) using Docker:

```bash
# Start infrastructure
docker compose -f dev/docker-compose.yml up -d

# Stop infrastructure
docker compose -f dev/docker-compose.yml down

# View logs
docker compose -f dev/docker-compose.yml logs -f
```
