export const VERSION = '1.5.0'
export const APP_IMAGE = 'ghcr.io/learnhouse/app:latest'
export const DEV_IMAGE = 'ghcr.io/learnhouse/app:dev'
export const NGINX_IMAGE = 'nginx:alpine'
export const POSTGRES_IMAGE = 'pgvector/pgvector:pg16'
export const POSTGRES_AI_IMAGE = 'pgvector/pgvector:pg16'
export const REDIS_IMAGE = 'redis:7.2.3-alpine'
export const HEALTH_CHECK_URL_PATH = '/api/v1/health'
export const HEALTH_CHECK_TIMEOUT_MS = 180_000 // 3 minutes
export const HEALTH_CHECK_INTERVAL_MS = 3_000
export const CONFIG_FILENAME = 'learnhouse.config.json'

// ── Enterprise Edition ───────────────────────────────────────────────────────
// EE images are pulled from the license-gated registry; the license key is the
// docker-login password.
export const EE_REGISTRY = 'images.learnhouse.app'
export const EE_REGISTRY_USERNAME = 'license'
export const EE_BACKEND_IMAGE = 'images.learnhouse.app/enterprise-backend'
export const EE_FRONTEND_IMAGE = 'images.learnhouse.app/enterprise-frontend'
export const EE_COLLAB_IMAGE = 'images.learnhouse.app/enterprise-collab'
export const EE_LICENSE_SERVER = 'https://partners.learnhouse.app'
export const EE_DEFAULT_IMAGE_TAG = 'prod'
export const INSTANCE_INFO_PATH = '/api/v1/instance/info'
export const EE_READY_TIMEOUT_MS = 360_000 // 6 minutes (image pull + license activation)
