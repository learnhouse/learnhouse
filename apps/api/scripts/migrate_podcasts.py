#!/usr/bin/env python3
"""
Migration script to add podcasts support to existing installations.
This script adds:
1. Podcasts permissions to all existing roles
2. Podcasts feature to all organization configs

Run this script from the apps/api directory:
    python scripts/migrate_podcasts.py

Or with explicit database URL:
    DATABASE_URL=postgresql://user:pass@localhost/db python scripts/migrate_podcasts.py
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


def migrate_roles(session):
    """Add podcasts permissions to all existing roles."""
    print("\n" + "="*60)
    print("Step 1: Migrating Roles")
    print("="*60)

    # Fetch all roles
    result = session.execute(text("SELECT id, name, rights FROM role"))
    roles = result.fetchall()

    print(f"Found {len(roles)} roles to check")

    updated_count = 0

    for role_id, role_name, rights in roles:
        if rights is None:
            rights = {}
        elif isinstance(rights, str):
            rights = json.loads(rights)

        # Check if already migrated
        if 'podcasts' in rights:
            print(f"  - Role '{role_name}' (id={role_id}): Already has podcasts, skipping")
            continue

        # Determine permission level based on existing rights
        has_admin_like_perms = (
            rights.get('courses', {}).get('action_create', False) or
            rights.get('collections', {}).get('action_create', False) or
            rights.get('organizations', {}).get('action_update', False)
        )

        # Check if this role can only manage their own content (like Instructor)
        can_only_own = (
            rights.get('courses', {}).get('action_create', False) and
            not rights.get('courses', {}).get('action_update', False) and
            rights.get('courses', {}).get('action_update_own', False)
        )

        # Add podcasts permission
        if has_admin_like_perms and not can_only_own:
            # Admin/Maintainer: full permissions
            rights['podcasts'] = {
                'action_create': True,
                'action_read': True,
                'action_read_own': True,
                'action_update': True,
                'action_update_own': True,
                'action_delete': True,
                'action_delete_own': True,
            }
        elif can_only_own:
            # Instructor: can create and manage own
            rights['podcasts'] = {
                'action_create': True,
                'action_read': True,
                'action_read_own': True,
                'action_update': False,
                'action_update_own': True,
                'action_delete': False,
                'action_delete_own': True,
            }
        else:
            # User/Learner: read only
            rights['podcasts'] = {
                'action_create': False,
                'action_read': True,
                'action_read_own': True,
                'action_update': False,
                'action_update_own': False,
                'action_delete': False,
                'action_delete_own': False,
            }

        # Update the role
        session.execute(
            text("UPDATE role SET rights = :rights WHERE id = :id"),
            {'rights': json.dumps(rights), 'id': role_id}
        )

        print(f"  - Role '{role_name}' (id={role_id}): Added podcasts permissions")
        updated_count += 1

    print(f"\nRoles migration complete! Updated {updated_count} roles.")
    return updated_count


def migrate_org_configs(session):
    """Add podcasts feature to all existing organization configs."""
    print("\n" + "="*60)
    print("Step 2: Migrating Organization Configs")
    print("="*60)

    # Fetch all organization configs
    result = session.execute(text("SELECT id, org_id, config FROM organizationconfig"))
    configs = result.fetchall()

    print(f"Found {len(configs)} organization configs to check")

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
            print(f"  - Org config (id={config_id}, org_id={org_id}): Already has podcasts, skipping")
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

        print(f"  - Org config (id={config_id}, org_id={org_id}): Added podcasts feature")
        updated_count += 1

    print(f"\nOrg configs migration complete! Updated {updated_count} configs.")
    return updated_count


def run_migration():
    """Run the full podcasts migration."""
    database_url = get_database_url()
    print("Connecting to database...")

    engine = create_engine(database_url)
    Session = sessionmaker(bind=engine)
    session = Session()

    try:
        roles_updated = migrate_roles(session)
        configs_updated = migrate_org_configs(session)

        session.commit()

        print("\n" + "="*60)
        print("Migration Summary")
        print("="*60)
        print(f"  Roles updated: {roles_updated}")
        print(f"  Org configs updated: {configs_updated}")
        print("\nAll migrations completed successfully!")

    except Exception as e:
        session.rollback()
        print(f"\nError during migration: {e}")
        raise
    finally:
        session.close()


def show_current_state():
    """Display current roles and org configs."""
    database_url = get_database_url()
    engine = create_engine(database_url)
    Session = sessionmaker(bind=engine)
    session = Session()

    try:
        # Show roles
        print("\n" + "="*60)
        print("Current Roles - Podcasts Permissions")
        print("="*60)

        result = session.execute(text("SELECT id, name, rights FROM role ORDER BY id"))
        roles = result.fetchall()

        for role_id, role_name, rights in roles:
            if rights is None:
                rights = {}
            elif isinstance(rights, str):
                rights = json.loads(rights)

            podcasts = rights.get('podcasts', {})
            if podcasts:
                enabled = [k.replace('action_', '') for k, v in podcasts.items() if v]
                print(f"  {role_name}: {', '.join(enabled) if enabled else 'none'}")
            else:
                print(f"  {role_name}: NOT CONFIGURED")

        # Show org configs
        print("\n" + "="*60)
        print("Current Org Configs - Podcasts Feature")
        print("="*60)

        result = session.execute(text("SELECT id, org_id, config FROM organizationconfig ORDER BY id"))
        configs = result.fetchall()

        for config_id, org_id, config in configs:
            if config is None:
                config = {}
            elif isinstance(config, str):
                config = json.loads(config)

            podcasts = config.get('features', {}).get('podcasts', {})
            if podcasts:
                print(f"  Org {org_id}: enabled={podcasts.get('enabled', False)}, limit={podcasts.get('limit', 'N/A')}")
            else:
                print(f"  Org {org_id}: NOT CONFIGURED")

        print()

    finally:
        session.close()


if __name__ == '__main__':
    import argparse

    parser = argparse.ArgumentParser(description='Migrate database to add podcasts support')
    parser.add_argument('--show', action='store_true', help='Show current state without migrating')
    parser.add_argument('--dry-run', action='store_true', help='Show what would be changed without actually changing')
    args = parser.parse_args()

    print("="*60)
    print("Podcasts Migration Script")
    print("="*60)

    if args.show:
        show_current_state()
    elif args.dry_run:
        print("\nDRY RUN - No changes will be made\n")

        database_url = get_database_url()
        engine = create_engine(database_url)
        Session = sessionmaker(bind=engine)
        session = Session()

        try:
            # Check roles
            print("Roles that would be updated:")
            result = session.execute(text("SELECT id, name, rights FROM role"))
            for role_id, role_name, rights in result.fetchall():
                if rights is None:
                    rights = {}
                elif isinstance(rights, str):
                    rights = json.loads(rights)

                if 'podcasts' not in rights:
                    print(f"  - {role_name}")

            # Check org configs
            print("\nOrg configs that would be updated:")
            result = session.execute(text("SELECT id, org_id, config FROM organizationconfig"))
            for config_id, org_id, config in result.fetchall():
                if config is None:
                    config = {}
                elif isinstance(config, str):
                    config = json.loads(config)

                if 'podcasts' not in config.get('features', {}):
                    print(f"  - Org {org_id}")

        finally:
            session.close()
    else:
        run_migration()
        show_current_state()
