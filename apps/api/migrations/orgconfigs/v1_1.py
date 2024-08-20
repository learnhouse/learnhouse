def migrate_to_v1_1(v1_config):
    # Start by copying the existing configuration
    v1_1_config = v1_config.copy()
    
    # Update the config version
    v1_1_config["config_version"] = "1.1"
    
    # Add the new 'cloud' object at the end
    v1_1_config['cloud'] = {
        "plan": "free",
        "custom_domain": False
    }
    
    return v1_1_config
