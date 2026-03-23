"""
Migration script: v1 org config → v2 org config.

Usage from apps/api:
    uv run python -m src.services.orgs.orgconfigs_migrations
"""

import logging
import os
import sys

# Ensure apps/api is on sys.path so `src.*` imports work when run standalone
_api_root = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
if _api_root not in sys.path:
    sys.path.insert(0, _api_root)

from datetime import datetime  # noqa: E402
from sqlmodel import Session, select  # noqa: E402
from src.db.organization_config import OrganizationConfig  # noqa: E402
from src.security.features_utils.plans import PLAN_FEATURE_CONFIGS  # noqa: E402

logger = logging.getLogger(__name__)

# Features that have admin toggle entries in v2
# (storage, usergroups, assignments, courses are always-on — no toggle)
ALL_FEATURES = [
    "ai", "analytics", "api", "boards", "collaboration",
    "collections", "communities", "members", "payments", "playgrounds", "podcasts",
]


def _v2_migrate_config(config: dict) -> dict:
    """Convert a single v1 config dict to v2 format."""
    version = config.get("config_version", "1.0")
    if version.startswith("2"):
        return config  # Already v2

    # Extract plan
    plan = config.get("cloud", {}).get("plan", "free")
    if plan == "oss":
        plan = "free"  # "oss" was a mode, not a plan

    # Get plan defaults for comparison
    plan_defaults = PLAN_FEATURE_CONFIGS.get(plan, PLAN_FEATURE_CONFIGS["free"])
    plan_features = plan_defaults.get("features", {})

    # Build admin_toggles
    v1_features = config.get("features", {})
    admin_toggles = {}

    for feature in ALL_FEATURES:
        v1_feat = v1_features.get(feature, {})
        plan_feat = plan_features.get(feature, {})
        toggle: dict = {}

        # Determine disabled state: if v1 stored enabled=False but plan says enabled=True,
        # the admin explicitly disabled it
        v1_enabled = v1_feat.get("enabled", True)
        plan_enabled = plan_feat.get("enabled", True)

        if not v1_enabled and plan_enabled:
            toggle["disabled"] = True
        else:
            toggle["disabled"] = False

        # Feature-specific admin settings
        if feature == "ai":
            toggle["copilot_enabled"] = v1_feat.get("copilot_enabled", True)
        elif feature == "members":
            toggle["signup_mode"] = v1_feat.get("signup_mode", "open")

        admin_toggles[feature] = toggle

    # Build customization
    v1_general = config.get("general", {})
    v1_seo = config.get("seo", {})
    v1_landing = config.get("landing", {})

    customization = {
        "general": {
            "color": v1_general.get("color", "") if v1_general.get("color", "").startswith("#") else "",
            "footer_text": v1_general.get("footer_text", ""),
            "favicon_image": v1_general.get("favicon_image", ""),
            "watermark": v1_general.get("watermark", True),
        },
        "auth_branding": v1_general.get("auth_branding", {
            "welcome_message": "",
            "background_type": "gradient",
            "background_image": "",
            "text_color": "light",
        }),
        "seo": v1_seo if v1_seo else {
            "default_meta_title_suffix": "",
            "default_meta_description": "",
            "default_og_image": "",
            "google_site_verification": "",
            "twitter_handle": "",
            "noindex_communities": False,
        },
        "landing": v1_landing,
    }

    # Org active state (general.enabled in v1)
    active = v1_general.get("enabled", True)

    return {
        "config_version": "2.0",
        "active": active,
        "plan": plan,
        "admin_toggles": admin_toggles,
        "overrides": {},
        "customization": customization,
    }


def _v2_migrate_all_configs(db_session: Session, batch_size: int = 50) -> int:
    """
    Migrate all org configs from v1 to v2 in batches.

    Returns:
        Number of configs migrated.
    """
    statement = select(OrganizationConfig)
    all_configs = db_session.exec(statement).all()

    migrated = 0
    for org_config in all_configs:
        config = org_config.config or {}
        version = config.get("config_version", "1.0")

        # Patch v2 configs missing fields added after initial migration
        if version.startswith("2"):
            patched = False
            if "active" not in config:
                config["active"] = True
                patched = True
            general = config.get("customization", {}).get("general", {})
            if "watermark" not in general:
                config.setdefault("customization", {}).setdefault("general", {})
                config["customization"]["general"]["watermark"] = True
                patched = True
            color = general.get("color", "")
            if color and not color.startswith("#"):
                config.setdefault("customization", {}).setdefault("general", {})
                config["customization"]["general"]["color"] = ""
                patched = True
            # Remove deprecated standalone feature toggles
            toggles = config.get("admin_toggles", {})
            for deprecated in ("discussions",):
                if deprecated in toggles:
                    del toggles[deprecated]
                    patched = True
            # Ensure collections toggle exists (was briefly removed, now restored)
            if "collections" not in toggles:
                toggles["collections"] = {"disabled": False}
                patched = True
            if patched:
                org_config.config = config
                org_config.update_date = str(datetime.now())
                db_session.add(org_config)
                migrated += 1
            continue

        try:
            new_config = _v2_migrate_config(org_config.config or {})
            org_config.config = new_config
            org_config.update_date = str(datetime.now())
            db_session.add(org_config)
            migrated += 1

            if migrated % batch_size == 0:
                db_session.commit()
                logger.info(f"Migrated {migrated} configs so far...")

        except Exception:
            logger.exception(f"Failed to migrate org config id={org_config.id}")

    if migrated % batch_size != 0:
        db_session.commit()

    logger.info(f"Migration complete: {migrated} configs migrated to v2")
    return migrated


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    from src.core.events.database import engine
    with Session(engine) as session:
        count = _v2_migrate_all_configs(session)
        logger.info("Done — %s config(s) migrated to v2.", count)
