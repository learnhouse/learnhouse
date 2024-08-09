def migrate_v0_to_v1(v0_config):
    v1_config = {
        "config_version": "1.0",
        "general": {
            "enabled": v0_config["GeneralConfig"]["active"],
            "color": v0_config["GeneralConfig"]["color"],
            "watermark": True,  # Default value as it's not present in v0
        },
        "features": {
            "courses": {
                "enabled": True,
                "limit": (
                    v0_config["GeneralConfig"]["limits"]["max_users"]
                    if v0_config["GeneralConfig"]["limits"]["limits_enabled"]
                    else 5
                ),
            },
            "members": {
                "enabled": True,
                "signup_mode": (
                    "open"
                    if v0_config["GeneralConfig"]["users"]["signup_mechanism"] == "open"
                    else "inviteOnly"
                ),
                "admin_limit": 5,
                "limit": (
                    v0_config["GeneralConfig"]["limits"]["max_users"]
                    if v0_config["GeneralConfig"]["limits"]["limits_enabled"]
                    else 10
                ),
            },
            "usergroups": {
                "enabled": True,
                "limit": (
                    v0_config["GeneralConfig"]["limits"]["max_staff"]
                    if v0_config["GeneralConfig"]["limits"]["limits_enabled"]
                    else 10
                ),
            },
            "storage": {
                "enabled": True,
                "limit": (
                    v0_config["GeneralConfig"]["limits"]["max_storage"]
                    if v0_config["GeneralConfig"]["limits"]["limits_enabled"]
                    else 10
                ),
            },
            "ai": {
                "enabled": v0_config["AIConfig"]["enabled"],
                "limit": (
                    v0_config["AIConfig"]["limits"]["max_asks"]
                    if v0_config["AIConfig"]["limits"]["limits_enabled"]
                    else 10
                ),
                "model": v0_config["AIConfig"]["ai_model"],
            },
            "assignments": {"enabled": True, "limit": 10},
            "payments": {"enabled": False, "stripe_key": ""},
            "discussions": {"enabled": False, "limit": 10},
            "analytics": {"enabled": False, "limit": 10},
            "collaboration": {
                "enabled": v0_config["GeneralConfig"]["collaboration"],
                "limit": 10,
            },
            "api": {"enabled": False, "limit": 10},
        },
    }

    return v1_config
