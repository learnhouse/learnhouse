-- Migration script to add communities and discussions permissions to existing roles
-- Run this against your PostgreSQL database
--
-- Usage:
--   psql -h localhost -U learnhouse -d learnhouse -f migrate_roles_communities.sql
--
-- Or via Docker:
--   docker exec -i learnhouse-db psql -U learnhouse -d learnhouse < migrate_roles_communities.sql

-- Create a function to add communities permissions to roles
DO $$
DECLARE
    role_record RECORD;
    current_rights JSONB;
    has_admin_perms BOOLEAN;
    new_rights JSONB;
BEGIN
    RAISE NOTICE 'Starting communities permissions migration...';

    FOR role_record IN SELECT id, name, rights FROM role LOOP
        -- Parse current rights
        IF role_record.rights IS NULL THEN
            current_rights := '{}'::JSONB;
        ELSE
            current_rights := role_record.rights::JSONB;
        END IF;

        -- Check if already migrated
        IF current_rights ? 'communities' AND current_rights ? 'discussions' THEN
            RAISE NOTICE 'Role "%" (id=%): Already migrated, skipping', role_record.name, role_record.id;
            CONTINUE;
        END IF;

        -- Determine if this is an admin-like role
        has_admin_perms := (
            COALESCE((current_rights->'courses'->>'action_create')::BOOLEAN, FALSE) OR
            COALESCE((current_rights->'collections'->>'action_create')::BOOLEAN, FALSE) OR
            COALESCE((current_rights->'organizations'->>'action_update')::BOOLEAN, FALSE)
        );

        -- Build new rights with communities and discussions
        new_rights := current_rights;

        -- Add communities permission if not present
        IF NOT (current_rights ? 'communities') THEN
            new_rights := jsonb_set(
                new_rights,
                '{communities}',
                jsonb_build_object(
                    'action_create', has_admin_perms,
                    'action_read', TRUE,
                    'action_update', has_admin_perms,
                    'action_delete', has_admin_perms
                )
            );
        END IF;

        -- Add discussions permission if not present
        IF NOT (current_rights ? 'discussions') THEN
            new_rights := jsonb_set(
                new_rights,
                '{discussions}',
                jsonb_build_object(
                    'action_create', TRUE,
                    'action_read', TRUE,
                    'action_read_own', TRUE,
                    'action_update', has_admin_perms,
                    'action_update_own', TRUE,
                    'action_delete', has_admin_perms,
                    'action_delete_own', TRUE
                )
            );
        END IF;

        -- Update the role
        UPDATE role SET rights = new_rights WHERE id = role_record.id;

        RAISE NOTICE 'Role "%" (id=%): Updated with communities permissions (admin=%)',
            role_record.name, role_record.id, has_admin_perms;
    END LOOP;

    RAISE NOTICE 'Migration complete!';
END $$;

-- Show the updated roles
SELECT
    id,
    name,
    rights->'communities' as communities_perms,
    rights->'discussions' as discussions_perms
FROM role
ORDER BY id;
