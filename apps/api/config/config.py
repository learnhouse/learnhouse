from typing import Literal, Optional
from pydantic import BaseModel
import os
from dotenv import load_dotenv
import yaml


class SentryConfig(BaseModel):
    dsn: str
    environment: str
    release: str


class CookieConfig(BaseModel):
    domain: str


class GeneralConfig(BaseModel):
    development_mode: bool
    install_mode: bool


class SecurityConfig(BaseModel):
    auth_jwt_secret_key: str


class AIConfig(BaseModel):
    openai_api_key: str | None
    is_ai_enabled: bool | None


class S3ApiConfig(BaseModel):
    bucket_name: str | None
    endpoint_url: str | None


class ContentDeliveryConfig(BaseModel):
    type: Literal["filesystem", "s3api"]
    s3api: S3ApiConfig


class HostingConfig(BaseModel):
    domain: str
    ssl: bool
    use_default_org: bool
    allowed_origins: list
    allowed_regexp: str
    self_hosted: bool
    sentry_config: Optional[SentryConfig]
    cookie_config: CookieConfig
    content_delivery: ContentDeliveryConfig


class DatabaseConfig(BaseModel):
    sql_connection_string: Optional[str]

class RedisConfig(BaseModel):
    redis_connection_string: Optional[str]

class LearnHouseConfig(BaseModel):
    site_name: str
    site_description: str
    contact_email: str
    general_config: GeneralConfig
    hosting_config: HostingConfig
    database_config: DatabaseConfig
    redis_config: RedisConfig
    security_config: SecurityConfig
    ai_config: AIConfig


def get_learnhouse_config() -> LearnHouseConfig:

    load_dotenv()

    # Get the YAML file
    yaml_path = os.path.join(os.path.dirname(__file__), "config.yaml")

    # Load the YAML file
    with open(yaml_path, "r") as f:
        yaml_config = yaml.safe_load(f)

    # General Config

    # Development Mode & Install Mode
    env_development_mode = eval(os.environ.get("LEARNHOUSE_DEVELOPMENT_MODE", "None"))
    development_mode = (
        env_development_mode
        if env_development_mode is not None
        else yaml_config.get("general", {}).get("development_mode")
    )

    env_install_mode = os.environ.get("LEARNHOUSE_INSTALL_MODE", "None")
    install_mode = (
        env_install_mode
        if env_install_mode is not None
        else yaml_config.get("general", {}).get("install_mode")
    )

    # Security Config
    env_auth_jwt_secret_key = os.environ.get("LEARNHOUSE_AUTH_JWT_SECRET_KEY")
    auth_jwt_secret_key = env_auth_jwt_secret_key or yaml_config.get(
        "security", {}
    ).get("auth_jwt_secret_key")

    # Check if environment variables are defined
    env_site_name = os.environ.get("LEARNHOUSE_SITE_NAME")
    env_site_description = os.environ.get("LEARNHOUSE_SITE_DESCRIPTION")
    env_contact_email = os.environ.get("LEARNHOUSE_CONTACT_EMAIL")
    env_domain = os.environ.get("LEARNHOUSE_DOMAIN")
    os.environ.get("LEARNHOUSE_PORT")
    env_ssl = os.environ.get("LEARNHOUSE_SSL")
    env_use_default_org = os.environ.get("LEARNHOUSE_USE_DEFAULT_ORG")
    env_allowed_origins = os.environ.get("LEARNHOUSE_ALLOWED_ORIGINS")
    env_cookie_domain = os.environ.get("LEARNHOUSE_COOKIE_DOMAIN")
    # Allowed origins should be a comma separated string
    if env_allowed_origins:
        env_allowed_origins = env_allowed_origins.split(",")
    env_allowed_regexp = os.environ.get("LEARNHOUSE_ALLOWED_REGEXP")
    env_self_hosted = os.environ.get("LEARNHOUSE_SELF_HOSTED")
    env_sql_connection_string = os.environ.get("LEARNHOUSE_SQL_CONNECTION_STRING")

    # Sentry Config
    env_sentry_dsn = os.environ.get("LEARNHOUSE_SENTRY_DSN")
    env_sentry_environment = os.environ.get("LEARNHOUSE_SENTRY_ENVIRONMENT")
    env_sentry_release = os.environ.get("LEARNHOUSE_SENTRY_RELEASE")

    # Fill in values with YAML file if they are not provided
    site_name = env_site_name or yaml_config.get("site_name")
    site_description = env_site_description or yaml_config.get("site_description")
    contact_email = env_contact_email or yaml_config.get("contact_email")

    domain = env_domain or yaml_config.get("hosting_config", {}).get("domain")
    ssl = env_ssl or yaml_config.get("hosting_config", {}).get("ssl")
    use_default_org = env_use_default_org or yaml_config.get("hosting_config", {}).get(
        "use_default_org"
    )
    allowed_origins = env_allowed_origins or yaml_config.get("hosting_config", {}).get(
        "allowed_origins"
    )
    allowed_regexp = env_allowed_regexp or yaml_config.get("hosting_config", {}).get(
        "allowed_regexp"
    )
    self_hosted = env_self_hosted or yaml_config.get("hosting_config", {}).get(
        "self_hosted"
    )

    cookies_domain = env_cookie_domain or yaml_config.get("hosting_config", {}).get(
        "cookies_config", {}
    ).get("domain")
    cookie_config = CookieConfig(domain=cookies_domain)

    env_content_delivery_type = os.environ.get("LEARNHOUSE_CONTENT_DELIVERY_TYPE")
    content_delivery_type: str = env_content_delivery_type or (
        (yaml_config.get("hosting_config", {}).get("content_delivery", {}).get("type"))
        or "filesystem"
    )  # default to filesystem

    env_bucket_name = os.environ.get("LEARNHOUSE_S3_API_BUCKET_NAME")
    env_endpoint_url = os.environ.get("LEARNHOUSE_S3_API_ENDPOINT_URL")
    bucket_name = (
        yaml_config.get("hosting_config", {})
        .get("content_delivery", {})
        .get("s3api", {})
        .get("bucket_name")
    ) or env_bucket_name
    endpoint_url = (
        yaml_config.get("hosting_config", {})
        .get("content_delivery", {})
        .get("s3api", {})
        .get("endpoint_url")
    ) or env_endpoint_url

    content_delivery = ContentDeliveryConfig(
        type=content_delivery_type,  # type: ignore
        s3api=S3ApiConfig(bucket_name=bucket_name, endpoint_url=endpoint_url),  # type: ignore
    )

    # Database config
    sql_connection_string = env_sql_connection_string or yaml_config.get(
        "database_config", {}
    ).get("sql_connection_string")

    

    # Redis config 
    env_redis_connection_string = os.environ.get("LEARNHOUSE_REDIS_CONNECTION_STRING")
    redis_connection_string = env_redis_connection_string or yaml_config.get(
        "redis_config", {}
    ).get("redis_connection_string")


    # AI Config
    env_openai_api_key = os.environ.get("LEARNHOUSE_OPENAI_API_KEY")
    env_is_ai_enabled = os.environ.get("LEARNHOUSE_IS_AI_ENABLED")
    openai_api_key = env_openai_api_key or yaml_config.get("ai_config", {}).get(
        "openai_api_key"
    )
    is_ai_enabled = env_is_ai_enabled or yaml_config.get("ai_config", {}).get(
        "is_ai_enabled"
    )

    # Sentry config
    # check if the sentry config is provided in the YAML file
    sentry_config_verif = (
        yaml_config.get("hosting_config", {}).get("sentry_config")
        or env_sentry_dsn
        or env_sentry_environment
        or env_sentry_release
        or None
    )

    sentry_dsn = env_sentry_dsn or yaml_config.get("hosting_config", {}).get(
        "sentry_config", {}
    ).get("dsn")
    sentry_environment = env_sentry_environment or yaml_config.get(
        "hosting_config", {}
    ).get("sentry_config", {}).get("environment")
    sentry_release = env_sentry_release or yaml_config.get("hosting_config", {}).get(
        "sentry_config", {}
    ).get("release")

    if sentry_config_verif:
        sentry_config = SentryConfig(
            dsn=sentry_dsn, environment=sentry_environment, release=sentry_release
        )
    else:
        sentry_config = None

    # Create HostingConfig and DatabaseConfig objects
    hosting_config = HostingConfig(
        domain=domain,
        ssl=bool(ssl),
        use_default_org=bool(use_default_org),
        allowed_origins=list(allowed_origins),
        allowed_regexp=allowed_regexp,
        self_hosted=bool(self_hosted),
        sentry_config=sentry_config,
        cookie_config=cookie_config,
        content_delivery=content_delivery,
    )
    database_config = DatabaseConfig(
        sql_connection_string=sql_connection_string,
    )

    # AI Config
    ai_config = AIConfig(
        openai_api_key=openai_api_key,
        is_ai_enabled=bool(is_ai_enabled),
    )

    # Create LearnHouseConfig object
    config = LearnHouseConfig(
        site_name=site_name,
        site_description=site_description,
        contact_email=contact_email,
        general_config=GeneralConfig(
            development_mode=bool(development_mode), install_mode=bool(install_mode)
        ),
        hosting_config=hosting_config,
        database_config=database_config,
        security_config=SecurityConfig(auth_jwt_secret_key=auth_jwt_secret_key),
        ai_config=ai_config,
        redis_config=RedisConfig(redis_connection_string=redis_connection_string),
    )

    return config
