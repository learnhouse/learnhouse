from typing import Optional
from pydantic import BaseModel
import os
import yaml


class HostingConfig(BaseModel):
    domain: str
    port: int
    ssl: bool
    use_default_org: bool
    allowed_origins: list
    allowed_regexp: str
    self_hosted: bool


class DatabaseConfig(BaseModel):
    host: str
    port: int
    user: str
    password: str
    database_name: str
    mongodb_connection_string: Optional[str]


class LearnHouseConfig(BaseModel):
    site_name: str
    site_description: str
    contact_email: str
    hosting_config: HostingConfig
    database_config: DatabaseConfig


def get_learnhouse_config() -> LearnHouseConfig:

    # Get the YAML file
    yaml_path = os.path.join(os.path.dirname(__file__), 'config.yaml')

    # Load the YAML file
    with open(yaml_path, 'r') as f:
        yaml_config = yaml.safe_load(f)

    # Check if environment variables are defined
    env_site_name = os.environ.get('LEARNHOUSE_SITE_NAME')
    env_site_description = os.environ.get('LEARNHOUSE_SITE_DESCRIPTION')
    env_contact_email = os.environ.get('LEARNHOUSE_CONTACT_EMAIL')
    env_domain = os.environ.get('LEARNHOUSE_DOMAIN')
    env_port = os.environ.get('LEARNHOUSE_PORT')
    env_ssl = os.environ.get('LEARNHOUSE_SSL')
    env_use_default_org = os.environ.get('LEARNHOUSE_USE_DEFAULT_ORG')
    env_allowed_origins = os.environ.get('LEARNHOUSE_ALLOWED_ORIGINS') 
    # Allowed origins should be a comma separated string
    if env_allowed_origins:
        env_allowed_origins = env_allowed_origins.split(',')
    env_allowed_regexp = os.environ.get('LEARNHOUSE_ALLOWED_REGEXP')
    env_self_hosted = os.environ.get('LEARNHOUSE_SELF_HOSTED')
    env_host = os.environ.get('LEARNHOUSE_DB_HOST')
    env_db_port = os.environ.get('LEARNHOUSE_DB_PORT')
    env_user = os.environ.get('LEARNHOUSE_DB_USER')
    env_password = os.environ.get('LEARNHOUSE_DB_PASSWORD')
    env_database_name = os.environ.get('LEARNHOUSE_DB_NAME')
    env_mongodb_connection_string = os.environ.get(
        'LEARNHOUSE_MONGODB_CONNECTION_STRING')

    # Fill in values with YAML file if they are not provided
    site_name = env_site_name or yaml_config.get('site_name')
    site_description = env_site_description or yaml_config.get(
        'site_description')
    contact_email = env_contact_email or yaml_config.get('contact_email')

    domain = env_domain or yaml_config.get('hosting_config', {}).get('domain')
    port = env_port or yaml_config.get('hosting_config', {}).get('port')
    ssl = env_ssl or yaml_config.get('hosting_config', {}).get('ssl')
    use_default_org = env_use_default_org or yaml_config.get(
        'hosting_config', {}).get('use_default_org')
    allowed_origins = env_allowed_origins or yaml_config.get(
        'hosting_config', {}).get('allowed_origins')
    allowed_regexp = env_allowed_regexp or yaml_config.get(
        'hosting_config', {}).get('allowed_regexp')
    self_hosted = env_self_hosted or yaml_config.get(
        'hosting_config', {}).get('self_hosted')

    host = env_host or yaml_config.get('database_config', {}).get('host')
    db_port = env_db_port or yaml_config.get('database_config', {}).get('port')
    user = env_user or yaml_config.get('database_config', {}).get('user')
    password = env_password or yaml_config.get(
        'database_config', {}).get('password')
    database_name = env_database_name or yaml_config.get(
        'database_config', {}).get('database_name')
    mongodb_connection_string = env_mongodb_connection_string or yaml_config.get(
        'database_config', {}).get('mongodb_connection_string')

    # Create HostingConfig and DatabaseConfig objects
    hosting_config = HostingConfig(
        domain=domain,
        port=int(port),
        ssl=bool(ssl),
        use_default_org=bool(use_default_org),
        allowed_origins=list(allowed_origins),
        allowed_regexp=allowed_regexp,
        self_hosted=bool(self_hosted)
    )
    database_config = DatabaseConfig(
        host=host,
        port=int(db_port),
        user=user,
        password=password,
        database_name=database_name,
        mongodb_connection_string=mongodb_connection_string
    )

    # Create LearnHouseConfig object
    config = LearnHouseConfig(
        site_name=site_name,
        site_description=site_description,
        contact_email=contact_email,
        hosting_config=hosting_config,
        database_config=database_config
    )

    return config
