#!/usr/bin/env python3
"""
Unified migration script for LearnHouse database updates.

This script handles all migrations:
1. Communities and discussions permissions for roles
2. Podcasts permissions for roles
3. Podcasts feature for organization configs

Run this script from the apps/api directory:
    python scripts/migrate.py

Or with explicit database URL:
    DATABASE_URL=postgresql://user:pass@localhost/db python scripts/migrate.py

Available commands:
    python scripts/migrate.py              # Run all migrations
    python scripts/migrate.py --show       # Show current state without migrating
    python scripts/migrate.py --dry-run    # Show what would be changed
    python scripts/migrate.py communities  # Run only communities migration
    python scripts/migrate.py podcasts     # Run only podcasts migration
"""

import os
import sys
import json
import argparse

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


def get_session():
    """Create and return a database session."""
    database_url = get_database_url()
    engine = create_engine(database_url)
    Session = sessionmaker(bind=engine)
    return Session()


def has_admin_like_perms(rights):
    """Check if role has admin-like permissions."""
    return (
        rights.get('courses', {}).get('action_create', False) or
        rights.get('collections', {}).get('action_create', False) or
        rights.get('organizations', {}).get('action_update', False)
    )


def can_only_manage_own(rights):
    """Check if role can only manage their own content (like Instructor)."""
    return (
        rights.get('courses', {}).get('action_create', False) and
        not rights.get('courses', {}).get('action_update', False) and
        rights.get('courses', {}).get('action_update_own', False)
    )


# =============================================================================
# Communities & Discussions Migration
# =============================================================================

def migrate_roles_communities(session):
    """Add communities and discussions permissions to all existing roles."""
    print("\n" + "=" * 60)
    print("Migrating Roles: Communities & Discussions Permissions")
    print("=" * 60)

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
        if 'communities' in rights and 'discussions' in rights:
            print(f"  - Role '{role_name}' (id={role_id}): Already has communities/discussions, skipping")
            continue

        is_admin = has_admin_like_perms(rights)

        # Add communities permission
        if 'communities' not in rights:
            rights['communities'] = {
                'action_create': is_admin,
                'action_read': True,
                'action_update': is_admin,
                'action_delete': is_admin,
            }

        # Add discussions permission
        if 'discussions' not in rights:
            rights['discussions'] = {
                'action_create': True,
                'action_read': True,
                'action_read_own': True,
                'action_update': is_admin,
                'action_update_own': True,
                'action_delete': is_admin,
                'action_delete_own': True,
            }

        session.execute(
            text("UPDATE role SET rights = :rights WHERE id = :id"),
            {'rights': json.dumps(rights), 'id': role_id}
        )

        print(f"  - Role '{role_name}' (id={role_id}): Added communities/discussions permissions")
        updated_count += 1

    print(f"\nCommunities migration complete! Updated {updated_count} roles.")
    return updated_count


# =============================================================================
# Podcasts Migration
# =============================================================================

def migrate_roles_podcasts(session):
    """Add podcasts permissions to all existing roles."""
    print("\n" + "=" * 60)
    print("Migrating Roles: Podcasts Permissions")
    print("=" * 60)

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

        is_admin = has_admin_like_perms(rights)
        is_instructor = can_only_manage_own(rights)

        # Add podcasts permission based on role type
        if is_admin and not is_instructor:
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
        elif is_instructor:
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

        session.execute(
            text("UPDATE role SET rights = :rights WHERE id = :id"),
            {'rights': json.dumps(rights), 'id': role_id}
        )

        print(f"  - Role '{role_name}' (id={role_id}): Added podcasts permissions")
        updated_count += 1

    print(f"\nPodcasts roles migration complete! Updated {updated_count} roles.")
    return updated_count


def migrate_org_configs_podcasts(session):
    """Add podcasts feature to all existing organization configs."""
    print("\n" + "=" * 60)
    print("Migrating Organization Configs: Podcasts Feature")
    print("=" * 60)

    result = session.execute(text("SELECT id, org_id, config FROM organizationconfig"))
    configs = result.fetchall()

    print(f"Found {len(configs)} organization configs to check")
    updated_count = 0

    for config_id, org_id, config in configs:
        if config is None:
            config = {}
        elif isinstance(config, str):
            config = json.loads(config)

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

        session.execute(
            text("UPDATE organizationconfig SET config = :config WHERE id = :id"),
            {'config': json.dumps(config), 'id': config_id}
        )

        print(f"  - Org config (id={config_id}, org_id={org_id}): Added podcasts feature")
        updated_count += 1

    print(f"\nOrg configs migration complete! Updated {updated_count} configs.")
    return updated_count


# =============================================================================
# Display Functions
# =============================================================================

def show_current_state():
    """Display current roles and org configs."""
    session = get_session()

    try:
        # Show roles
        print("\n" + "=" * 60)
        print("Current Roles and Permissions")
        print("=" * 60)

        result = session.execute(text("SELECT id, name, rights FROM role ORDER BY id"))
        roles = result.fetchall()

        for role_id, role_name, rights in roles:
            print(f"\nRole: {role_name} (id={role_id})")

            if rights is None:
                print("  No rights defined")
                continue

            if isinstance(rights, str):
                rights = json.loads(rights)

            for resource, perms in sorted(rights.items()):
                if isinstance(perms, dict):
                    enabled = [k.replace('action_', '') for k, v in perms.items() if v]
                    if enabled:
                        print(f"  {resource}: {', '.join(enabled)}")

        # Show org configs
        print("\n" + "=" * 60)
        print("Current Organization Configs - Features")
        print("=" * 60)

        result = session.execute(text("SELECT id, org_id, config FROM organizationconfig ORDER BY id"))
        configs = result.fetchall()

        for config_id, org_id, config in configs:
            print(f"\nOrg Config ID: {config_id} (org_id={org_id})")

            if config is None:
                print("  No config defined")
                continue

            if isinstance(config, str):
                config = json.loads(config)

            features = config.get('features', {})
            if features:
                print("  Features:")
                for feature, settings in sorted(features.items()):
                    if isinstance(settings, dict):
                        enabled = settings.get('enabled', False)
                        limit = settings.get('limit', 'N/A')
                        print(f"    - {feature}: enabled={enabled}, limit={limit}")
            else:
                print("  No features configured")

        print("\n" + "=" * 60)

    finally:
        session.close()


def show_dry_run():
    """Show what would be changed without actually changing."""
    session = get_session()

    try:
        print("\n" + "=" * 60)
        print("DRY RUN - No changes will be made")
        print("=" * 60)

        # Check roles for communities
        print("\nRoles needing communities/discussions permissions:")
        result = session.execute(text("SELECT id, name, rights FROM role"))
        roles = result.fetchall()

        communities_count = 0
        for role_id, role_name, rights in roles:
            if rights is None:
                rights = {}
            elif isinstance(rights, str):
                rights = json.loads(rights)

            if 'communities' not in rights or 'discussions' not in rights:
                is_admin = has_admin_like_perms(rights)
                print(f"  - {role_name}: Would add communities/discussions (admin={is_admin})")
                communities_count += 1

        if communities_count == 0:
            print("  (none)")

        # Check roles for podcasts
        print("\nRoles needing podcasts permissions:")
        podcasts_count = 0
        for role_id, role_name, rights in roles:
            if rights is None:
                rights = {}
            elif isinstance(rights, str):
                rights = json.loads(rights)

            if 'podcasts' not in rights:
                is_admin = has_admin_like_perms(rights)
                is_instructor = can_only_manage_own(rights)
                if is_admin and not is_instructor:
                    perm_type = "full"
                elif is_instructor:
                    perm_type = "own-only"
                else:
                    perm_type = "read-only"
                print(f"  - {role_name}: Would add {perm_type} podcasts permissions")
                podcasts_count += 1

        if podcasts_count == 0:
            print("  (none)")

        # Check org configs for podcasts
        print("\nOrg configs needing podcasts feature:")
        result = session.execute(text("SELECT id, org_id, config FROM organizationconfig"))
        configs = result.fetchall()

        config_count = 0
        for config_id, org_id, config in configs:
            if config is None:
                config = {}
            elif isinstance(config, str):
                config = json.loads(config)

            if 'podcasts' not in config.get('features', {}):
                print(f"  - Org {org_id}: Would add podcasts feature")
                config_count += 1

        if config_count == 0:
            print("  (none)")

        print("\n" + "=" * 60)
        print(f"Summary: {communities_count} roles for communities, "
              f"{podcasts_count} roles for podcasts, {config_count} org configs")
        print("=" * 60)

    finally:
        session.close()


# =============================================================================
# Main Entry Point
# =============================================================================

def run_all_migrations():
    """Run all migrations."""
    print("Connecting to database...")
    session = get_session()

    try:
        results = {
            'communities_roles': migrate_roles_communities(session),
            'podcasts_roles': migrate_roles_podcasts(session),
            'podcasts_configs': migrate_org_configs_podcasts(session),
        }

        session.commit()

        print("\n" + "=" * 60)
        print("Migration Summary")
        print("=" * 60)
        print(f"  Roles updated with communities/discussions: {results['communities_roles']}")
        print(f"  Roles updated with podcasts: {results['podcasts_roles']}")
        print(f"  Org configs updated with podcasts: {results['podcasts_configs']}")
        print("\nAll migrations completed successfully!")

    except Exception as e:
        session.rollback()
        print(f"\nError during migration: {e}")
        raise
    finally:
        session.close()


def run_communities_migration():
    """Run only communities migration."""
    print("Connecting to database...")
    session = get_session()

    try:
        updated = migrate_roles_communities(session)
        session.commit()
        print(f"\nCommunities migration completed! Updated {updated} roles.")
    except Exception as e:
        session.rollback()
        print(f"\nError during migration: {e}")
        raise
    finally:
        session.close()


def run_podcasts_migration():
    """Run only podcasts migration."""
    print("Connecting to database...")
    session = get_session()

    try:
        roles_updated = migrate_roles_podcasts(session)
        configs_updated = migrate_org_configs_podcasts(session)
        session.commit()
        print(f"\nPodcasts migration completed! Updated {roles_updated} roles and {configs_updated} configs.")
    except Exception as e:
        session.rollback()
        print(f"\nError during migration: {e}")
        raise
    finally:
        session.close()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(
        description='LearnHouse Database Migration Script',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python scripts/migrate.py              Run all migrations
  python scripts/migrate.py --show       Show current database state
  python scripts/migrate.py --dry-run    Preview changes without applying
  python scripts/migrate.py communities  Run only communities migration
  python scripts/migrate.py podcasts     Run only podcasts migration
        """
    )
    parser.add_argument('migration', nargs='?', choices=['communities', 'podcasts'],
                        help='Specific migration to run (default: all)')
    parser.add_argument('--show', action='store_true',
                        help='Show current state without migrating')
    parser.add_argument('--dry-run', action='store_true',
                        help='Show what would be changed without actually changing')

    args = parser.parse_args()

    print("=" * 60)
    print("LearnHouse Database Migration Script")
    print("=" * 60)

    if args.show:
        show_current_state()
    elif args.dry_run:
        show_dry_run()
    elif args.migration == 'communities':
        run_communities_migration()
        show_current_state()
    elif args.migration == 'podcasts':
        run_podcasts_migration()
        show_current_state()
    else:
        run_all_migrations()
        show_current_state()
