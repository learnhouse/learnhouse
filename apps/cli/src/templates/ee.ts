import crypto from 'node:crypto'
import type { SetupConfig } from '../types.js'
import { quoteEnvValue } from '../utils/env-quote.js'
import {
  EE_BACKEND_IMAGE,
  EE_COLLAB_IMAGE,
  EE_FRONTEND_IMAGE,
  EE_LICENSE_SERVER,
} from '../constants.js'

// Enterprise Edition deploy templates. These mirror the production-grade
// partner templates (single / agency) that ship at
// partners.learnhouse.app/templates, ported to the CLI so the one tool can
// deploy both Community and Enterprise editions.
//
// The EE stack is six services — db (pgvector), redis, caddy (auto-TLS),
// api, web, collab — pulling enterprise images from images.learnhouse.app
// (authenticated with the license key). Single vs. agency (multi-tenant)
// differ only in the domain variable + tenancy env.

export interface EeSecrets {
  dbPassword: string
  jwtSecret: string
  collabKey: string
}

/** 32 random bytes, URL-safe (no +/= so it is safe inside URLs and .env). */
export function generateEeSecret(): string {
  return crypto.randomBytes(32).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function generateEeSecrets(): EeSecrets {
  return {
    dbPassword: generateEeSecret(),
    jwtSecret: generateEeSecret(),
    collabKey: generateEeSecret(),
  }
}

/** Escape a value for a docker-compose .env file (compose interpolates `$`). */
export function escapeEnvValue(value: string): string {
  return value.replace(/\$/g, '$$$$')
}

export function isAgency(config: SetupConfig): boolean {
  return config.eeTenancy === 'agency'
}

/** The .env variable that holds the public domain for this tenancy mode. */
export function eeDomainVar(config: SetupConfig): 'DOMAIN' | 'AGENCY_DOMAIN' {
  return isAgency(config) ? 'AGENCY_DOMAIN' : 'DOMAIN'
}

/** pgvector init — enables the `vector` extension the API needs for RAG. */
export function generatePgvectorInit(): string {
  return 'CREATE EXTENSION IF NOT EXISTS vector;\n'
}

/**
 * The six-service EE compose. Project name is namespaced by deploymentId so
 * multiple installs can coexist on one host. Service env reads from .env.
 */
export function isExternalDb(config: SetupConfig): boolean {
  return !!config.externalDbUrl
}
export function isCloudflareDns(config: SetupConfig): boolean {
  return config.dnsProvider === 'cloudflare'
}

export function generateEeDockerCompose(config: SetupConfig): string {
  const id = config.deploymentId
  const tag = config.eeImageTag || 'prod'
  const agency = isAgency(config)
  const domainVar = eeDomainVar(config)
  const external = isExternalDb(config)
  const cfDns = isCloudflareDns(config)
  const ipv6 = !!config.dockerIpv6

  // SQL connection string: external DB reads from .env; in-container builds from db.
  const sqlConn = external
    ? '${LEARNHOUSE_SQL_CONNECTION_STRING:?LEARNHOUSE_SQL_CONNECTION_STRING is required}'
    : 'postgresql://${DB_USER:-learnhouse}:${DB_PASSWORD}@db:5432/${DB_NAME:-learnhouse}'

  // db service (omitted when using an external database)
  const dbService = external
    ? ''
    : `  db:
    image: pgvector/pgvector:pg16
    environment:
      POSTGRES_USER: \${DB_USER:-learnhouse}
      POSTGRES_PASSWORD: \${DB_PASSWORD:?DB_PASSWORD is required}
      POSTGRES_DB: \${DB_NAME:-learnhouse}
    volumes:
      - db_data:/var/lib/postgresql/data
      - ./pgvector-init.sql:/docker-entrypoint-initdb.d/01-init.sql:ro
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "pg_isready", "-U", "\${DB_USER:-learnhouse}"]
      interval: 5s
      timeout: 3s
      retries: 20

`

  const apiDepends = external
    ? `    depends_on:
      redis: { condition: service_healthy }`
    : `    depends_on:
      db: { condition: service_healthy }
      redis: { condition: service_healthy }`

  const collabDepends = external ? '' : `    depends_on:
      db: { condition: service_healthy }
`

  // caddy: a Cloudflare-DNS-01 deploy needs a Caddy built with the cloudflare
  // DNS plugin (the stock image cannot issue a wildcard cert).
  const caddyImage = cfDns
    ? `    build:
      context: .
      dockerfile: caddy.Dockerfile`
    : `    image: caddy:2`
  const caddyCfEnv = cfDns ? `
      CLOUDFLARE_API_TOKEN: \${CLOUDFLARE_API_TOKEN:?CLOUDFLARE_API_TOKEN is required for DNS-01}` : ''

  const dbVolume = external ? '' : '  db_data:\n'
  const networksBlock = ipv6 ? `

networks:
  default:
    enable_ipv6: true` : ''

  const tenancyEnv = agency
    ? `      LEARNHOUSE_TENANCY: multi
      LEARNHOUSE_DOMAIN: \${AGENCY_DOMAIN}
      LEARNHOUSE_FRONTEND_DOMAIN: \${AGENCY_DOMAIN}
      LEARNHOUSE_COOKIE_DOMAIN: .\${AGENCY_DOMAIN}
      LEARNHOUSE_COOKIE_DOMAIN_ALLOW_BROAD: \${LEARNHOUSE_COOKIE_DOMAIN_ALLOW_BROAD:-false}`
    : `      LEARNHOUSE_TENANCY: single
      LEARNHOUSE_DOMAIN: \${DOMAIN}
      LEARNHOUSE_FRONTEND_DOMAIN: \${DOMAIN}`

  const webEnv = agency
    ? `      NEXT_PUBLIC_LEARNHOUSE_BACKEND_URL: https://\${AGENCY_DOMAIN}/
      NEXT_PUBLIC_LEARNHOUSE_API_URL: https://\${AGENCY_DOMAIN}/api/v1/
      NEXT_PUBLIC_LEARNHOUSE_HTTPS: "true"
      NEXT_PUBLIC_LEARNHOUSE_DOMAIN: \${AGENCY_DOMAIN}
      NEXT_PUBLIC_LEARNHOUSE_TOP_DOMAIN: \${AGENCY_DOMAIN}
      NEXT_PUBLIC_LEARNHOUSE_MULTI_ORG: "true"`
    : `      NEXT_PUBLIC_LEARNHOUSE_BACKEND_URL: https://\${DOMAIN}/
      NEXT_PUBLIC_LEARNHOUSE_API_URL: https://\${DOMAIN}/api/v1/
      NEXT_PUBLIC_LEARNHOUSE_HTTPS: "true"
      NEXT_PUBLIC_LEARNHOUSE_DOMAIN: \${DOMAIN}
      NEXT_PUBLIC_LEARNHOUSE_TOP_DOMAIN: \${DOMAIN}
      NEXT_PUBLIC_LEARNHOUSE_MULTI_ORG: "false"
      NEXT_PUBLIC_LEARNHOUSE_DEFAULT_ORG: default`

  const adminEmailEnv = agency
    ? `      LEARNHOUSE_INITIAL_ADMIN_EMAIL: \${LEARNHOUSE_INITIAL_ADMIN_EMAIL:-admin@\${AGENCY_DOMAIN}}`
    : `      LEARNHOUSE_INITIAL_ADMIN_EMAIL: \${LEARNHOUSE_INITIAL_ADMIN_EMAIL:?LEARNHOUSE_INITIAL_ADMIN_EMAIL is required}`

  return `name: learnhouse-${id}

# LearnHouse Enterprise Edition (${agency ? 'agency / multi-tenant' : 'single-tenant'}).
# Generated by the LearnHouse CLI. Replace values in .env before booting.
# Caddy terminates TLS and routes /api/v1/* + /content/* + /collab/* to the
# backend; everything else to the Next.js frontend.

services:
${dbService}  redis:
    image: redis:7
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 3s
      retries: 10

  caddy:
${caddyImage}
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
      - "443:443/udp"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy_data:/data
      - caddy_config:/config
    environment:
      ${domainVar}: \${${domainVar}:?${domainVar} is required}
      ACME_EMAIL: \${ACME_EMAIL:?ACME_EMAIL is required}${caddyCfEnv}
    depends_on: [api, web]

  api:
    image: ${EE_BACKEND_IMAGE}:\${EE_IMAGE_TAG:-${tag}}
    restart: unless-stopped
${apiDepends}
    healthcheck:
      test: ["CMD-SHELL", "curl -f http://$(hostname):9000/api/v1/instance/info"]
      interval: 10s
      timeout: 5s
      retries: 12
    environment:
      # Force 0.0.0.0 so the in-container loopback healthcheck works.
      HOSTNAME: 0.0.0.0

      # --- License (required for EE features) ---
      LEARNHOUSE_LICENSE_KEY: \${LEARNHOUSE_LICENSE_KEY:?LEARNHOUSE_LICENSE_KEY is required}
      LEARNHOUSE_LICENSE_SERVER_URL: \${LEARNHOUSE_LICENSE_SERVER_URL:-${EE_LICENSE_SERVER}}
      LEARNHOUSE_DATA_DIR: /app/data

      # --- Tenancy ---
${tenancyEnv}

      # --- Auth + secrets ---
      LEARNHOUSE_AUTH_JWT_SECRET_KEY: \${LEARNHOUSE_AUTH_JWT_SECRET_KEY:?LEARNHOUSE_AUTH_JWT_SECRET_KEY is required (min 32 chars)}
      COLLAB_INTERNAL_KEY: \${COLLAB_INTERNAL_KEY:?COLLAB_INTERNAL_KEY is required}
      LEARNHOUSE_INITIAL_ADMIN_PASSWORD: \${LEARNHOUSE_INITIAL_ADMIN_PASSWORD:?LEARNHOUSE_INITIAL_ADMIN_PASSWORD is required}
${adminEmailEnv}

      # --- Storage ---
      LEARNHOUSE_SQL_CONNECTION_STRING: ${sqlConn}
      LEARNHOUSE_REDIS_CONNECTION_STRING: redis://redis:6379/0
    volumes:
      - api_data:/app/data
      - api_content:/app/content

  web:
    image: ${EE_FRONTEND_IMAGE}:\${EE_IMAGE_TAG:-${tag}}
    restart: unless-stopped
    depends_on: [api]
    environment:
${webEnv}
    extra_hosts:
      - "\${${domainVar}}:host-gateway"

  collab:
    image: ${EE_COLLAB_IMAGE}:\${EE_IMAGE_TAG:-${tag}}
    restart: unless-stopped
${collabDepends}    environment:
      COLLAB_INTERNAL_KEY: \${COLLAB_INTERNAL_KEY}
      LEARNHOUSE_AUTH_JWT_SECRET_KEY: \${LEARNHOUSE_AUTH_JWT_SECRET_KEY}
      LEARNHOUSE_SQL_CONNECTION_STRING: ${sqlConn}

volumes:
${dbVolume}  api_data:
  api_content:
  caddy_data:
  caddy_config:${networksBlock}
`
}

/** Dockerfile that builds Caddy with the Cloudflare DNS plugin (for DNS-01
 *  wildcard certs). Used when --dns-provider cloudflare. */
export function generateCaddyDockerfile(): string {
  return `# Caddy with the Cloudflare DNS plugin (for DNS-01 wildcard certs).
# Generated by the LearnHouse CLI.
FROM caddy:2-builder AS builder
RUN xcaddy build --with github.com/caddy-dns/cloudflare

FROM caddy:2
COPY --from=builder /usr/bin/caddy /usr/bin/caddy
`
}

const ROUTES_SINGLE = `	handle /api/v1/* {
		reverse_proxy api:9000 {
			header_up Host {host}
			header_up X-Real-IP {remote_host}
			header_up X-Forwarded-For {remote_host}
			header_up X-Forwarded-Proto {scheme}
		}
	}

	handle /content/* {
		reverse_proxy api:9000 {
			header_up Host {host}
			header_up X-Real-IP {remote_host}
			header_up X-Forwarded-For {remote_host}
			header_up X-Forwarded-Proto {scheme}
		}
	}

	handle /collab/* {
		reverse_proxy collab:4000 {
			header_up Host {host}
			header_up X-Real-IP {remote_host}
			header_up X-Forwarded-For {remote_host}
			header_up X-Forwarded-Proto {scheme}
		}
	}

	handle {
		reverse_proxy web:3000 {
			header_up Host {host}
			header_up X-Real-IP {remote_host}
			header_up X-Forwarded-For {remote_host}
			header_up X-Forwarded-Proto {scheme}
		}
	}`

/**
 * Caddyfile for the EE stack. `--local-tls` injects `local_certs` so Caddy
 * issues self-signed certs from its internal CA — lets multi-tenant subdomains
 * and custom domains work via local /etc/hosts with no public DNS / DNS-01.
 */
export function generateEeCaddyfile(config: SetupConfig): string {
  const agency = isAgency(config)
  const localCerts = config.eeLocalTls ? '\tlocal_certs\n' : ''
  // Cloudflare DNS-01: required to issue a *wildcard* cert for *.domain.
  // (HTTP-01 can't do wildcards; the on-demand block only covers custom domains.)
  // `resolvers` makes the DNS-01 plugin query public resolvers directly for zone
  // detection — avoids failures when the host's local resolver has a stale/bogus
  // cache (e.g. right after a DNSSEC fix).
  const cfTls = isCloudflareDns(config)
    ? '\n\ttls {\n\t\tdns cloudflare {env.CLOUDFLARE_API_TOKEN}\n\t\tresolvers 1.1.1.1 8.8.8.8\n\t}'
    : ''

  if (!agency) {
    return `# Caddyfile — single-tenant LearnHouse EE. Generated by the LearnHouse CLI.

{
${localCerts}	email {$ACME_EMAIL}
}

{$DOMAIN} {${cfTls}
${ROUTES_SINGLE}
}
`
  }

  return `# Caddyfile — agency LearnHouse EE with on-demand TLS for custom domains.
# Generated by the LearnHouse CLI.

{
${localCerts}	email {$ACME_EMAIL}

	# Gate on-demand TLS: Caddy asks the API whether a custom domain is
	# verified before issuing a certificate for it.
	on_demand_tls {
		ask http://api:9000/api/v1/orgs/domains/check
	}
}

(learnhouse_routes) {
${ROUTES_SINGLE}
}

# Agency apex + every subdomain (wildcard cert via DNS-01 when configured).
{$AGENCY_DOMAIN}, *.{$AGENCY_DOMAIN} {${cfTls}
	import learnhouse_routes
}

# Customer custom domains — on-demand TLS gated by the ask endpoint above.
:443 {
	tls {
		on_demand
	}
	import learnhouse_routes
}
`
}

/** The .env for the EE stack. Secrets are supplied by the caller so re-runs
 *  can preserve them (rotating them would break an initialized DB / sessions). */
export function generateEeEnv(config: SetupConfig, secrets: EeSecrets): string {
  const agency = isAgency(config)
  const domainVar = eeDomainVar(config)
  const tag = config.eeImageTag || 'prod'

  const external = isExternalDb(config)
  const lines = [
    '# LearnHouse Enterprise Edition — generated by the LearnHouse CLI.',
    '# Contains secrets — do not commit.',
    '',
    `LEARNHOUSE_LICENSE_KEY=${quoteEnvValue(config.licenseKey || '')}`,
    `${domainVar}=${config.domain}`,
    `ACME_EMAIL=${quoteEnvValue(config.acmeEmail || config.sslEmail || '')}`,
    `EE_IMAGE_TAG=${tag}`,
  ]
  if (external) {
    lines.push('', '# External database (e.g. Supabase) — the in-container db is not used.',
      `LEARNHOUSE_SQL_CONNECTION_STRING=${quoteEnvValue(config.externalDbUrl || '')}`)
  } else {
    lines.push('', 'DB_USER=learnhouse', `DB_PASSWORD=${secrets.dbPassword}`, 'DB_NAME=learnhouse')
  }
  lines.push(
    '',
    `LEARNHOUSE_AUTH_JWT_SECRET_KEY=${secrets.jwtSecret}`,
    `COLLAB_INTERNAL_KEY=${secrets.collabKey}`,
    '',
    `LEARNHOUSE_INITIAL_ADMIN_EMAIL=${quoteEnvValue(config.adminEmail)}`,
    `LEARNHOUSE_INITIAL_ADMIN_PASSWORD=${quoteEnvValue(config.adminPassword)}`,
  )
  if (isCloudflareDns(config)) {
    lines.push('', `CLOUDFLARE_API_TOKEN=${quoteEnvValue(config.cfApiToken || '')}`)
  }
  if (agency) {
    lines.push('', 'LEARNHOUSE_COOKIE_DOMAIN_ALLOW_BROAD=false')
  }
  return lines.join('\n') + '\n'
}

/** docker-compose.override.yml for --local-tls: trust Caddy's internal CA for
 *  the web/collab server-side fetches to the API (else tenancy falls back to
 *  single/default). Testing only — never production. */
export function generateEeLocalTlsOverride(): string {
  return `# Written by the LearnHouse CLI --local-tls.
# Trusts Caddy's internal (self-signed) CA for web/collab -> API fetches.
# TESTING ONLY — never use in production.
services:
  web:
    environment:
      NODE_TLS_REJECT_UNAUTHORIZED: "0"
  collab:
    environment:
      NODE_TLS_REJECT_UNAUTHORIZED: "0"
`
}
