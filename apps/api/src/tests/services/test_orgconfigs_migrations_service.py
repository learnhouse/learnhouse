from datetime import datetime

from src.db.organization_config import OrganizationConfig
from src.services.orgs import orgconfigs_migrations as migrations


def test_v2_migrate_config_transforms_v1_payload():
    migrated = migrations._v2_migrate_config(
        {
            "cloud": {"plan": "oss"},
            "features": {
                "ai": {"enabled": True, "copilot_enabled": False},
                "boards": {"enabled": False},
                "members": {"signup_mode": "invite"},
            },
            "general": {
                "enabled": False,
                "color": "not-a-hex",
                "footer_text": "Footer",
                "favicon_image": "favicon.png",
                "watermark": False,
            },
            "seo": {"default_meta_description": "desc"},
            "landing": {"headline": "Hello"},
        }
    )

    assert migrated["config_version"] == "2.0"
    assert migrated["active"] is False
    assert migrated["plan"] == "free"
    assert migrated["admin_toggles"]["ai"] == {
        "disabled": False,
        "copilot_enabled": False,
    }
    assert migrated["admin_toggles"]["boards"]["disabled"] is False
    assert migrated["admin_toggles"]["members"]["signup_mode"] == "invite"
    assert migrated["customization"]["general"] == {
        "color": "",
        "footer_text": "Footer",
        "favicon_image": "favicon.png",
        "watermark": False,
    }
    assert migrated["customization"]["seo"] == {"default_meta_description": "desc"}
    assert migrated["customization"]["landing"] == {"headline": "Hello"}


def test_v2_migrate_config_returns_v2_payload_unchanged():
    payload = {"config_version": "2.1", "plan": "pro", "active": True}

    assert migrations._v2_migrate_config(payload) is payload


def test_v2_migrate_all_configs_migrates_and_patches_existing_v2(db):
    v1_config = OrganizationConfig(
        org_id=1,
        config={
            "cloud": {"plan": "pro"},
            "features": {"boards": {"enabled": False}},
            "general": {"enabled": True, "color": "#112233"},
        },
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    v2_config = OrganizationConfig(
        org_id=2,
        config={
            "config_version": "2.0",
            "customization": {"general": {"color": "blue"}},
            "admin_toggles": {"discussions": {"disabled": True}},
        },
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(v1_config)
    db.add(v2_config)
    db.commit()

    migrated = migrations._v2_migrate_all_configs(db, batch_size=1)

    db.refresh(v1_config)
    assert migrated == 2
    assert v1_config.config["config_version"] == "2.0"
    assert v1_config.config["admin_toggles"]["boards"]["disabled"] is True
    assert v2_config.config["active"] is True
    assert v2_config.config["customization"]["general"]["watermark"] is True
    assert v2_config.config["customization"]["general"]["color"] == ""
    assert "discussions" not in v2_config.config["admin_toggles"]
    assert v2_config.config["admin_toggles"]["collections"] == {"disabled": False}


def test_v2_migrate_all_configs_continues_after_failure(db, monkeypatch):
    broken = OrganizationConfig(
        org_id=3,
        config={"cloud": {"plan": "free"}},
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    healthy = OrganizationConfig(
        org_id=4,
        config={"general": {"enabled": True}},
        creation_date=str(datetime.now()),
        update_date=str(datetime.now()),
    )
    db.add(broken)
    db.add(healthy)
    db.commit()

    original = migrations._v2_migrate_config

    def flaky(config):
        if config.get("cloud", {}).get("plan") == "free":
            raise RuntimeError("boom")
        return original(config)

    monkeypatch.setattr(migrations, "_v2_migrate_config", flaky)

    migrated = migrations._v2_migrate_all_configs(db, batch_size=10)

    db.refresh(broken)
    db.refresh(healthy)

    assert migrated == 1
    assert broken.config == {"cloud": {"plan": "free"}}
    assert healthy.config["config_version"] == "2.0"
