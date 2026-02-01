#!/usr/bin/env python3
"""
Migration script to add podcasts permissions to existing roles.

Run this script from the apps/api directory:
    python scripts/migrate_roles_podcasts.py

Or with explicit database URL:
    DATABASE_URL=postgresql://user:pass@localhost/db python scripts/migrate_roles_podcasts.py
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


def migrate_roles():
    """Add podcasts permissions to all existing roles."""

    database_url = get_database_url()
    print("Connecting to database...")

    engine = create_engine(database_url)
    Session = sessionmaker(bind=engine)
    session = Session()

    try:
        # Fetch all roles
        result = session.execute(text("SELECT id, name, rights FROM role"))
        roles = result.fetchall()

        print(f"Found {len(roles)} roles to migrate")

        updated_count = 0

        for role_id, role_name, rights in roles:
            if rights is None:
                rights = {}
            elif isinstance(rights, str):
                rights = json.loads(rights)

            # Check if already migrated
            if 'podcasts' in rights:
                print(f"  - Role '{role_name}' (id={role_id}): Already migrated, skipping")
                continue

            # Determine permission level based on existing rights
            # If role has courses.action_create, they likely should have podcasts permissions too
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

            # Add podcasts permission (with own permissions like courses)
            if 'podcasts' not in rights:
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

            print(f"  - Role '{role_name}' (id={role_id}): Updated with podcasts permissions")
            updated_count += 1

        session.commit()
        print(f"\nMigration complete! Updated {updated_count} roles.")

    except Exception as e:
        session.rollback()
        print(f"Error during migration: {e}")
        raise
    finally:
        session.close()


def show_current_roles():
    """Display current roles and their permissions."""

    database_url = get_database_url()
    engine = create_engine(database_url)
    Session = sessionmaker(bind=engine)
    session = Session()

    try:
        result = session.execute(text("SELECT id, name, rights FROM role ORDER BY id"))
        roles = result.fetchall()

        print("\n" + "="*60)
        print("Current Roles and Permissions")
        print("="*60)

        for role_id, role_name, rights in roles:
            print(f"\nRole: {role_name} (id={role_id})")

            if rights is None:
                print("  No rights defined")
                continue

            if isinstance(rights, str):
                rights = json.loads(rights)

            for resource, perms in rights.items():
                if isinstance(perms, dict):
                    enabled = [k.replace('action_', '') for k, v in perms.items() if v]
                    if enabled:
                        print(f"  {resource}: {', '.join(enabled)}")

        print("\n" + "="*60)

    finally:
        session.close()


if __name__ == '__main__':
    import argparse

    parser = argparse.ArgumentParser(description='Migrate roles to add podcasts permissions')
    parser.add_argument('--show', action='store_true', help='Show current roles without migrating')
    parser.add_argument('--dry-run', action='store_true', help='Show what would be changed without actually changing')
    args = parser.parse_args()

    if args.show:
        show_current_roles()
    elif args.dry_run:
        print("DRY RUN - No changes will be made\n")
        database_url = get_database_url()
        engine = create_engine(database_url)
        Session = sessionmaker(bind=engine)
        session = Session()

        try:
            result = session.execute(text("SELECT id, name, rights FROM role"))
            roles = result.fetchall()

            for role_id, role_name, rights in roles:
                if rights is None:
                    rights = {}
                elif isinstance(rights, str):
                    rights = json.loads(rights)

                if 'podcasts' in rights:
                    print(f"Role '{role_name}': Already has podcasts permissions")
                else:
                    has_admin = (
                        rights.get('courses', {}).get('action_create', False) or
                        rights.get('collections', {}).get('action_create', False)
                    )
                    can_only_own = (
                        rights.get('courses', {}).get('action_create', False) and
                        not rights.get('courses', {}).get('action_update', False) and
                        rights.get('courses', {}).get('action_update_own', False)
                    )
                    if has_admin and not can_only_own:
                        print(f"Role '{role_name}': Would add full podcasts permissions")
                    elif can_only_own:
                        print(f"Role '{role_name}': Would add own-only podcasts permissions")
                    else:
                        print(f"Role '{role_name}': Would add read-only podcasts permissions")
        finally:
            session.close()
    else:
        print("="*60)
        print("Podcasts Role Migration Script")
        print("="*60)
        print()
        migrate_roles()
        print()
        show_current_roles()
