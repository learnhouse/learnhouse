# LearnHouse Self-Hosting Guide

This guide will help you self-host LearnHouse using Docker with Nginx as a reverse proxy.

## Prerequisites

- Docker Engine 20.10+ and Docker Compose 2.0+
- At least 2GB RAM
- 10GB+ disk space
- A domain name (optional, for production; use `localhost` for local development)

## Quick Start

1. **Clone or download LearnHouse**

```bash
git clone https://github.com/learnhouse/learnhouse.git
cd learnhouse
```

2. **Configure environment variables**

```bash
cp env.example .env
# Edit .env with your configuration
nano .env
```

**Important**: Set the initial admin credentials before first start:
- `LEARNHOUSE_INITIAL_ADMIN_EMAIL`: Email for the first admin user (defaults to `admin@school.dev`)
- `LEARNHOUSE_INITIAL_ADMIN_PASSWORD`: Password for the first admin user (randomly generated if not set)

3. **Start LearnHouse**

```bash
docker-compose -f docker-compose.prod.yml up -d
```

4. **Access LearnHouse**

- Frontend: http://localhost
- API Docs: http://localhost/api/v1/docs (if development mode is enabled)

5. **Login with Initial Admin Credentials**

On first start, use the credentials you configured:
- **Email**: The value you set for `LEARNHOUSE_INITIAL_ADMIN_EMAIL` (or `admin@school.dev` if not set)
- **Password**: The value you set for `LEARNHOUSE_INITIAL_ADMIN_PASSWORD` (check container logs if you didn't set one - it will be randomly generated)

**Important**: Change the admin password after first login!

## Architecture Overview

LearnHouse uses a multi-container architecture:

- **learnhouse-app**: Combined Next.js frontend and FastAPI backend application (includes internal nginx on port 80)
- **nginx**: Reverse proxy (port 80 externally)
- **db**: PostgreSQL database
- **redis**: Redis cache

All containers communicate via a Docker network. The `learnhouse-app` container runs both the frontend and backend services internally, with nginx routing requests between them.

## Environment Variables

All environment variables are loaded from the `.env` file automatically. The docker-compose configuration uses `env_file` to load all variables, so you don't need to specify them inline.

### Required Variables

#### Initial Admin Credentials (First-Time Setup)
```bash
# Email for the first admin user created during installation
# For local development:
LEARNHOUSE_INITIAL_ADMIN_EMAIL=admin@school.dev
# For production:
# LEARNHOUSE_INITIAL_ADMIN_EMAIL=admin@yourdomain.com

# Password for the first admin user (set this before first installation)
LEARNHOUSE_INITIAL_ADMIN_PASSWORD=your-secure-password-here
```

**Note**: These are only used during the initial installation when creating the first admin user. If not set:
- Email defaults to `admin@school.dev`
- Password will be randomly generated (check logs for the generated password)

#### Domain Configuration
```bash
# For local development:
LEARNHOUSE_DOMAIN=localhost
NEXT_PUBLIC_LEARNHOUSE_DOMAIN=localhost
NEXT_PUBLIC_LEARNHOUSE_TOP_DOMAIN=localhost

# For production:
# LEARNHOUSE_DOMAIN=yourdomain.com
# NEXT_PUBLIC_LEARNHOUSE_DOMAIN=yourdomain.com
# NEXT_PUBLIC_LEARNHOUSE_TOP_DOMAIN=yourdomain.com
```

#### API URLs
```bash
# For local development:
NEXT_PUBLIC_LEARNHOUSE_API_URL=http://localhost/api/v1/
NEXT_PUBLIC_LEARNHOUSE_BACKEND_URL=http://localhost/
NEXTAUTH_URL=http://localhost

# For production:
# NEXT_PUBLIC_LEARNHOUSE_API_URL=http://yourdomain.com/api/v1/
# NEXT_PUBLIC_LEARNHOUSE_BACKEND_URL=http://yourdomain.com/
# NEXTAUTH_URL=http://yourdomain.com
```

#### Security Secrets
```bash
# Generate with: openssl rand -base64 32
NEXTAUTH_SECRET=your-random-secret-here
LEARNHOUSE_AUTH_JWT_SECRET_KEY=your-random-secret-here
```

#### Database
```bash
LEARNHOUSE_SQL_CONNECTION_STRING=postgresql://learnhouse:your-password@db:5432/learnhouse
POSTGRES_PASSWORD=your-secure-password
```

#### Redis
```bash
LEARNHOUSE_REDIS_CONNECTION_STRING=redis://redis:6379/learnhouse
```

### Optional Variables

See `env.example` for a complete list of optional configuration options including:
- AI features (OpenAI)
- Email configuration (Resend)
- Payment processing (Stripe)
- S3 storage
- And more...

### Environment File Loading

The docker-compose configuration automatically loads all variables from the `.env` file using `env_file`. This means:
- All variables defined in `.env` are available to containers
- No need to specify variables inline in docker-compose.yml
- Easy to manage all configuration in one place
- Follows Docker Compose best practices

## Production Checklist

Before deploying to production:

- [ ] Set `LEARNHOUSE_INITIAL_ADMIN_EMAIL` to your admin email address
- [ ] Set `LEARNHOUSE_INITIAL_ADMIN_PASSWORD` to a strong password (before first start)
- [ ] Change all default passwords and secrets
- [ ] Set `LEARNHOUSE_DEVELOPMENT_MODE=false`
- [ ] Set `NEXT_PUBLIC_LEARNHOUSE_HTTPS=true`
- [ ] Configure proper domain names
- [ ] Set up email service (Resend)
- [ ] Configure backups for PostgreSQL data
- [ ] Set up monitoring and logging
- [ ] Review and configure security settings
- [ ] Test the installation

## Data Persistence

LearnHouse uses Docker volumes for data persistence:

- `learnhouse_db_data`: PostgreSQL database data
- `learnhouse_redis_data`: Redis data

These volumes persist even if containers are recreated. To backup:

```bash
# Backup database
docker run --rm -v learnhouse_db_data:/data -v $(pwd):/backup alpine tar czf /backup/db-backup.tar.gz /data

# Backup Redis
docker run --rm -v learnhouse_redis_data:/data -v $(pwd):/backup alpine tar czf /backup/redis-backup.tar.gz /data
```

To restore:

```bash
# Restore database
docker run --rm -v learnhouse_db_data:/data -v $(pwd):/backup alpine tar xzf /backup/db-backup.tar.gz -C /

# Restore Redis
docker run --rm -v learnhouse_redis_data:/data -v $(pwd):/backup alpine tar xzf /backup/redis-backup.tar.gz -C /
```

## Updating LearnHouse

1. **Pull latest changes**

```bash
git pull origin main
```

2. **Rebuild and restart**

```bash
docker-compose -f docker-compose.prod.yml build
docker-compose -f docker-compose.prod.yml up -d
```

## Monitoring

### View Logs

```bash
# All services
docker-compose -f docker-compose.prod.yml logs -f

# Specific service
docker-compose -f docker-compose.prod.yml logs -f learnhouse-app
docker-compose -f docker-compose.prod.yml logs -f db
docker-compose -f docker-compose.prod.yml logs -f redis
```

### Check Service Status

```bash
docker-compose -f docker-compose.prod.yml ps
```

### Health Checks

All services have health checks configured:
- LearnHouse App: `http://localhost/api/v1/health` (checks backend health through internal nginx)
- Database: PostgreSQL readiness check
- Redis: Redis ping check

## Troubleshooting

### Services won't start

1. Check logs: `docker-compose -f docker-compose.prod.yml logs`
2. Verify environment variables in `.env`
3. Ensure ports 80/443 are not in use
4. Check Docker resources (RAM, disk space)

### Database connection errors

1. Verify `LEARNHOUSE_SQL_CONNECTION_STRING` matches database credentials
2. Check database health: `docker-compose -f docker-compose.prod.yml ps db`
3. Ensure database is healthy before backend starts (depends_on is configured)

### Application errors

1. Check the learnhouse-app logs: `docker-compose -f docker-compose.prod.yml logs learnhouse-app`
2. Verify all environment variables are set correctly in `.env`
3. Ensure database and redis are healthy
4. Check internal nginx routing: `docker-compose -f docker-compose.prod.yml exec learnhouse-app curl http://localhost/api/v1/health`

### Port conflicts

If port 80 is already in use:

```bash
# Edit docker-compose.prod.yml and change:
ports:
  - "8080:80"  # Use different external port
```

Then update your environment variables accordingly.

## Security Considerations

1. **Never commit `.env` file** - It contains sensitive information
2. **Use strong passwords** - Especially for database and secrets
3. **Keep Docker updated** - Regularly update Docker and images
4. **Firewall configuration** - Only expose necessary ports
5. **Regular backups** - Backup database and volumes regularly
6. **Monitor logs** - Check logs regularly for suspicious activity

## Support

- GitHub Issues: https://github.com/learnhouse/learnhouse/issues
- Documentation: https://docs.learnhouse.app
- Discord: https://discord.gg/CMyZjjYZ6x

## Advanced Configuration

### Custom Nginx Configuration

For Nginx setup, you can customize `extra/nginx.prod.conf` before starting:

```bash
# Edit nginx configuration
nano extra/nginx.prod.conf

# Restart nginx
docker-compose -f docker-compose.prod.yml restart nginx
```

### Scaling Services

You can scale the learnhouse-app service:

```bash
docker-compose -f docker-compose.prod.yml up -d --scale learnhouse-app=3
```

Note: You may need to configure a load balancer or update Nginx configuration for proper load distribution.

### External Database

To use an external database, update `LEARNHOUSE_SQL_CONNECTION_STRING`:

```bash
LEARNHOUSE_SQL_CONNECTION_STRING=postgresql://user:pass@external-db-host:5432/learnhouse
```

And remove the `db` service from docker-compose file.

### External Redis

To use external Redis, update `LEARNHOUSE_REDIS_CONNECTION_STRING`:

```bash
LEARNHOUSE_REDIS_CONNECTION_STRING=redis://external-redis-host:6379/learnhouse
```

And remove the `redis` service from docker-compose file.

## License

LearnHouse is open source. See LICENSE file for details.

