# Neon PostgreSQL Setup Guide

This guide explains how to set up and configure Neon PostgreSQL for LearnHouse production deployments.

## What is Neon?

Neon is a serverless PostgreSQL platform that provides:
- Auto-scaling database instances
- Pay-per-use pricing
- Built-in connection pooling
- Branching (database branching for testing)
- Automatic backups

## Prerequisites

- A Neon account (free tier available)
- Access to your production environment variables
- Basic understanding of PostgreSQL connection strings

## Step 1: Create a Neon Account and Database

1. **Sign up for Neon**
   - Go to [neon.tech](https://neon.tech)
   - Sign up with GitHub, Google, or email
   - Free tier includes 3GB storage and 512MB RAM

2. **Create a New Project**
   - Click "Create Project"
   - Choose a project name (e.g., "learnhouse-production")
   - Select a region closest to your application servers
   - Choose PostgreSQL version (recommended: 16)

3. **Get Your Connection String**
   - After project creation, Neon provides a connection string
   - Format: `postgresql://user:password@ep-xxx-xxx.region.aws.neon.tech/dbname?sslmode=require`
   - **Important**: Copy the connection string immediately - the password is only shown once
   - You can reset the password later in project settings if needed

## Step 2: Configure Environment Variables

### Production Environment

Set the `LEARNHOUSE_SQL_CONNECTION_STRING` environment variable:

```bash
export LEARNHOUSE_SQL_CONNECTION_STRING="postgresql://user:password@ep-xxx-xxx.region.aws.neon.tech/dbname?sslmode=require"
```

### For Google Cloud Run

Add to your Cloud Run service environment variables:

```yaml
env:
  - name: LEARNHOUSE_SQL_CONNECTION_STRING
    value: "postgresql://user:password@ep-xxx-xxx.region.aws.neon.tech/dbname?sslmode=require"
```

### For Docker/Kubernetes

Add to your deployment configuration:

```yaml
env:
  - name: LEARNHOUSE_SQL_CONNECTION_STRING
    valueFrom:
      secretKeyRef:
        name: learnhouse-secrets
        key: neon-connection-string
```

**Security Best Practice**: Store connection strings in secrets management (Google Secret Manager, AWS Secrets Manager, etc.) rather than plain environment variables.

## Step 3: Run Database Migrations

After configuring the connection string, run migrations to set up the database schema:

```bash
cd apps/api
uv run alembic upgrade head
```

This will create all necessary tables and indexes in your Neon database.

## Step 4: Migrate Data from Docker PostgreSQL (Optional)

If you're migrating from a local Docker PostgreSQL instance:

### Export Data from Docker

```bash
# Export schema and data
docker exec learnhouse-db-dev pg_dump -U learnhouse learnhouse > backup.sql

# Or export only data (if schema already migrated)
docker exec learnhouse-db-dev pg_dump -U learnhouse -a learnhouse > data_only.sql
```

### Import to Neon

```bash
# Using psql (install if needed: brew install postgresql)
psql "postgresql://user:password@ep-xxx-xxx.region.aws.neon.tech/dbname?sslmode=require" < backup.sql

# Or using Neon's SQL Editor
# Copy and paste the SQL from backup.sql into Neon's SQL Editor
```

## Step 5: Verify Connection

Test the connection:

```bash
# Test connection from command line
psql "postgresql://user:password@ep-xxx-xxx.region.aws.neon.tech/dbname?sslmode=require" -c "SELECT version();"

# Or test from your application
cd apps/api
uv run python -c "from src.core.events.database import engine; print('Connected:', engine.connect())"
```

## Connection Pooling Configuration

LearnHouse automatically detects Neon databases and applies optimized connection pool settings:

### Neon Configuration (Auto-applied)
- **Pool Size**: 5 connections (Neon handles serverless scaling)
- **Max Overflow**: 5 additional connections
- **Pool Recycle**: 180 seconds (3 minutes)
- **Pool Pre-ping**: Enabled (critical for serverless)
- **SSL Mode**: Required (automatically added if missing)

### Why These Settings?

- **Smaller Pool**: Neon's serverless architecture handles connection scaling automatically
- **Shorter Recycle**: Neon connections timeout faster than traditional PostgreSQL
- **Pre-ping**: Ensures connections are alive before use (important for serverless)
- **SSL Required**: Neon requires SSL connections for security

## Monitoring and Maintenance

### Monitor Connection Usage

Check your Neon dashboard for:
- Active connections
- Query performance
- Storage usage
- Connection pool metrics

### Connection Limits

Neon free tier limits:
- **Concurrent Connections**: 100
- **Storage**: 3GB
- **Compute**: 0.5 vCPU, 512MB RAM

Paid tiers offer higher limits. Monitor your usage in the Neon dashboard.

### Backup Strategy

Neon provides automatic backups:
- **Point-in-time recovery**: Available for all plans
- **Backup retention**: Varies by plan
- **Manual backups**: Export via `pg_dump` or Neon dashboard

## Troubleshooting

### Connection Timeout Errors

If you see connection timeout errors:

1. **Check SSL Mode**: Ensure `sslmode=require` is in connection string
2. **Verify Network**: Ensure your application can reach Neon endpoints
3. **Check Connection Pool**: Monitor pool usage in logs
4. **Review Neon Dashboard**: Check for connection limits or issues

### SSL Connection Errors

```
Error: SSL connection required
```

**Solution**: Add `?sslmode=require` to your connection string. LearnHouse automatically adds this for Neon databases.

### Connection Pool Exhausted

If you see "too many connections" errors:

1. **Reduce Pool Size**: Lower `pool_size` in database.py (if needed)
2. **Check for Leaks**: Ensure connections are properly closed
3. **Upgrade Plan**: Consider Neon paid tier for more connections

### Migration Issues

If migrations fail:

1. **Check Permissions**: Ensure database user has CREATE/ALTER permissions
2. **Review Logs**: Check Neon dashboard logs for specific errors
3. **Run Manually**: Try running migrations manually via `alembic upgrade head`

## Best Practices

1. **Use Connection Pooling**: Let LearnHouse handle pooling (already configured)
2. **Monitor Usage**: Regularly check Neon dashboard for usage patterns
3. **Set Up Alerts**: Configure alerts in Neon for connection limits or errors
4. **Regular Backups**: Use Neon's automatic backups, but also export periodically
5. **Test Migrations**: Always test migrations on a Neon branch before production
6. **Connection String Security**: Never commit connection strings to version control

## Neon Branching (Advanced)

Neon supports database branching for testing:

1. **Create Branch**: In Neon dashboard, create a branch from your production database
2. **Get Branch Connection String**: Each branch has its own connection string
3. **Test Migrations**: Run migrations on branch first
4. **Merge or Promote**: Promote branch to production when ready

This is useful for testing schema changes before applying to production.

## Cost Optimization

### Free Tier Limits
- 3GB storage
- 512MB RAM
- 100 concurrent connections
- Suitable for small to medium applications

### When to Upgrade
- Storage exceeds 3GB
- Need more compute resources
- Require more concurrent connections
- Need longer backup retention

### Cost Monitoring
Monitor your usage in the Neon dashboard to avoid unexpected charges.

## Support

- **Neon Documentation**: [neon.tech/docs](https://neon.tech/docs)
- **Neon Discord**: [discord.gg/neondatabase](https://discord.gg/neondatabase)
- **LearnHouse Issues**: [GitHub Issues](https://github.com/learnhouse/learnhouse/issues)

## Next Steps

After setting up Neon:

1. ✅ Configure connection string in production environment
2. ✅ Run database migrations
3. ✅ Test application connectivity
4. ✅ Monitor connection pool usage
5. ✅ Set up alerts and monitoring
6. ✅ Document your production database setup

Your LearnHouse application is now ready to use Neon PostgreSQL in production!

