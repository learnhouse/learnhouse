"""get_learnhouse_config reuses the built config until its inputs change."""

import os
import types

import config.config as cfg_module


def _fresh(monkeypatch):
    monkeypatch.setattr(cfg_module, "_config_cache", None)


def test_same_inputs_return_the_same_object(monkeypatch):
    _fresh(monkeypatch)
    a = cfg_module.get_learnhouse_config()
    assert cfg_module.get_learnhouse_config() is a


def test_an_environment_change_rebuilds(monkeypatch):
    _fresh(monkeypatch)
    a = cfg_module.get_learnhouse_config()
    monkeypatch.setenv("LEARNHOUSE_SITE_NAME", "Cache Test Academy")
    b = cfg_module.get_learnhouse_config()
    assert b is not a and b.site_name == "Cache Test Academy"
    monkeypatch.delenv("LEARNHOUSE_SITE_NAME")
    c = cfg_module.get_learnhouse_config()
    assert c is not b and c.site_name == a.site_name


def test_a_new_yaml_parse_rebuilds(monkeypatch):
    _fresh(monkeypatch)
    a = cfg_module.get_learnhouse_config()
    real = cfg_module._load_yaml_config
    parsed = dict(real(os.path.join(os.path.dirname(cfg_module.__file__), "config.yaml")))
    monkeypatch.setattr(cfg_module, "_load_yaml_config", lambda _path: parsed)
    b = cfg_module.get_learnhouse_config()
    assert b is not a
    assert cfg_module.get_learnhouse_config() is b


def test_dotenv_is_loaded_once(monkeypatch):
    _fresh(monkeypatch)
    calls = []
    monkeypatch.setattr(cfg_module, "load_dotenv", lambda: calls.append(1))
    monkeypatch.setattr(cfg_module, "_dotenv_loaded", False)
    cfg_module.get_learnhouse_config()
    monkeypatch.setenv("LEARNHOUSE_SITE_NAME", "Another")
    cfg_module.get_learnhouse_config()
    assert calls == [1]


def test_snapshot_falls_back_to_the_public_mapping(monkeypatch):
    fake_os = types.SimpleNamespace(environ={"A": "1"}, path=os.path)
    monkeypatch.setattr(cfg_module, "os", fake_os)
    assert cfg_module._environ_snapshot() == {"A": "1"}
