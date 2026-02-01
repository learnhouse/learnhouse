#!/usr/bin/env python3
"""
Migration script to add podcasts feature to existing organization configs.

Run this script from the apps/api directory:
    python scripts/migrate_org_config_podcasts.py

Or with explicit database URL:
    DATABASE_URL=postgresql://user:pass@localhost/db python scripts/migrate_org_config_podcasts.py
"""

import os
import sys
import json

# Add the src directory to path for imports
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker


def get_database_url():
    """Get database URL from environment or use default."""
    return os.environ.get(
        'DATABASE_URL',
        os.environ.get(
            'LEARNHOUSE_DB_URL',
            'postgresql://learnhouse:learnhouse@localhost:5432/learnhouse'
        )
    )


def migrate_org_configs():
    """Add podcasts feature to all existing organization configs."""

    database_url = get_database_url()
    print("Connecting to database...")

    engine = create_engine(database_url)
    Session = sessionmaker(bind=engine)
    session = Session()

    try:
        # Fetch all organization configs
        result = session.execute(text("SELECT id, org_id, config FROM organizationconfig"))
        configs = result.fetchall()

        print(f"Found {len(configs)} organization configs to migrate")

        updated_count = 0

        for config_id, org_id, config in configs:
            if config is None:
                config = {}
            elif isinstance(config, str):
                config = json.loads(config)

            # Check if features exists
            if 'features' not in config:
                config['features'] = {}

            # Check if already migrated
            if 'podcasts' in config.get('features', {}):
                print(f"  - Org config (id={config_id}, org_id={org_id}): Already migrated, skipping")
                continue

            # Add podcasts feature
            config['features']['podcasts'] = {
                'enabled': True,
                'limit': 0  # 0 means unlimited
            }

            # Update the config
            session.execute(
                text("UPDATE organizationconfig SET config = :config WHERE id = :id"),
                {'config': json.dumps(config), 'id': config_id}
            )

            print(f"  - Org config (id={config_id}, org_id={org_id}): Updated with podcasts feature")
            updated_count += 1

        session.commit()
        print(f"\nMigration complete! Updated {updated_count} organization configs.")

    except Exception as e:
        session.rollback()
        print(f"Error during migration: {e}")
        raise
    finally:
        session.close()


def show_current_configs():
    """Display current organization configs and their features."""

    database_url = get_database_url()
    engine = create_engine(database_url)
    Session = sessionmaker(bind=engine)
    session = Session()

    try:
        result = session.execute(text("SELECT id, org_id, config FROM organizationconfig ORDER BY id"))
        configs = result.fetchall()

        print("\n" + "="*60)
        print("Current Organization Configs")
        print("="*60)

        for config_id, org_id, config in configs:
            print(f"\nOrg Config ID: {config_id} (org_id={org_id})")

            if config is None:
                print("  No config defined")
                continue

            if isinstance(config, str):
                config = json.loads(config)

            features = config.get('features', {})
            print("  Features:")
            for feature, settings in features.items():
                if isinstance(settings, dict):
                    enabled = settings.get('enabled', False)
                    limit = settings.get('limit', 'N/A')
                    print(f"    - {feature}: enabled={enabled}, limit={limit}")

        print("\n" + "="*60)

    finally:
        session.close()


if __name__ == '__main__':
    import argparse

    parser = argparse.ArgumentParser(description='Migrate organization configs to add podcasts feature')
    parser.add_argument('--show', action='store_true', help='Show current configs without migrating')
    parser.add_argument('--dry-run', action='store_true', help='Show what would be changed without actually changing')
    args = parser.parse_args()

    if args.show:
        show_current_configs()
    elif args.dry_run:
        print("DRY RUN - No changes will be made\n")
        database_url = get_database_url()
        engine = create_engine(database_url)
        Session = sessionmaker(bind=engine)
        session = Session()

        try:
            result = session.execute(text("SELECT id, org_id, config FROM organizationconfig"))
            configs = result.fetchall()

            for config_id, org_id, config in configs:
                if config is None:
                    config = {}
                elif isinstance(config, str):
                    config = json.loads(config)

                if 'podcasts' in config.get('features', {}):
                    print(f"Org config (id={config_id}, org_id={org_id}): Already has podcasts feature")
                else:
                    print(f"Org config (id={config_id}, org_id={org_id}): Would add podcasts feature")
        finally:
            session.close()
    else:
        print("="*60)
        print("Organization Config Podcasts Migration Script")
        print("="*60)
        print()
        migrate_org_configs()
        print()
        show_current_configs()
