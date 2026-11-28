"""Test / demo / random-letter org names and slugs are refused on
self-service creation and renames; real names that only contain the letters
pass."""

from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException

from src.db.organizations import OrganizationCreate, OrganizationUpdate
from src.services.orgs import name_check as nc


@pytest.mark.parametrize("name,slug", [
    ("test", "acme"), ("Test", "test-5"), ("TestOrg240909", "acme"), ("Leo's Testing Org", "leo"),
    ("Acme", "testing123"), ("Acme", "mytest"), ("UIP-test", "uip"), ("Demo", "acme"), ("Acme", "demo-academy"),
    ("Morrolinux-demo-org", "morrolinux"), ("sample", "sample"), ("tets", "acme"), ("Acme", "test-org"),
    ("prueba", "acme"), ("Miao Prueba", "miao"), ("тест", "ne"), ("Тестовая школа", "school"), ("テスト", "jp"),
    ("Acme", "asdf"), ("qwerty", "acme"), ("Lorem Ipsum", "li"),
    ("zkzmlz", "acme"), ("akakakdaksdj", "acme"), ("adfheheudk", "acme"), ("adu3ikdakd", "acme"),
    ("ghjghjghj", "acme"), ("aaaaaaaaaaaaa", "acme"), ("ewfeewf", "acme"), ("hamooooooo", "acme"),
    ("Acme", "4234234234fsdf"), ("Acme", "akakakak"),
])
def test_throwaways(name, slug):
    assert nc.reasons(name, slug)


@pytest.mark.parametrize("name,slug", [
    ("Contest Prep Academy", "contest-prep"), ("Latest Skills", "latest"), ("Demolition Training", "demolition"),
    ("Attestation Hub", "attest"), ("Protestant Bible School", "psb"), ("Szkoła", "szkola"),
    ("szkolawdomu", "szkolawdomu"), ("Krzysztof Academy", "krzysztof"), ("SocWorx", "socworx"),
    ("RGPD Legal", "rgpdlegal"), ("JD Harmon LLC", "jdharmon"), ("LLLcollege", "lllcollege"),
    ("ABC Builders Club", "abcbuildersclub"), ("ABClosing", "abc"), ("ACE2026", "ace2026"), ("J2", "j2"),
    ("EU", "minhs"), ("小笑", "haiw"), ("想不同國際股份有限公司", "thinkdifferent"), ("Y Combinator", "yc"),
    ("WHO Academy", "who-academy"), ("Webkraft", "webkraft"), ("Zim Passion Profits", "zimpassionprofits"),
    ("St. Marianna University School of Medicine", "ghcprogram"), ("Mpakugig", "mpakugig"),
    ("Коломийський педагогічний фаховий коледж", "kolpedcol"), ("Testament Ministries", "testament"),
    ("", None), (None, None),
])
def test_real_names_pass(name, slug):
    assert nc.reasons(name, slug) == []


def test_gibberish_edges():
    assert not nc.gibberish("abc12")  # too short
    assert not nc.gibberish("12345678ab")  # mostly digits
    assert not nc.gibberish("школа")  # non-Latin is never gibberish
    assert nc.gibberish("bcdfgh")  # no vowel
    assert nc.gibberish("asdfghjk")  # keyboard row
    assert nc.gibberish("kjsdhakl")  # home-row smash, no run of four
    assert nc.gibberish("qwertyab")  # keyboard row


@pytest.mark.parametrize("value,mode,on", [
    ("1", "oss", True), ("yes", "oss", True), ("0", "saas", False), ("off", "saas", False),
    ("", "saas", True), ("", "oss", False),
])
def test_check_enabled(monkeypatch, value, mode, on):
    monkeypatch.setenv("LEARNHOUSE_ORG_NAME_CHECK", value)
    with patch("src.core.deployment_mode.get_deployment_mode", return_value=mode):
        assert nc.check_enabled() is on


def test_reject(monkeypatch):
    monkeypatch.setenv("LEARNHOUSE_ORG_NAME_CHECK", "1")
    with pytest.raises(HTTPException) as e:
        nc.reject_throwaway_org_name("test", "acme")
    assert e.value.status_code == 400 and e.value.detail == nc.REJECT_MESSAGE
    nc.reject_throwaway_org_name("Acme Academy", "acme-academy")
    monkeypatch.setenv("LEARNHOUSE_ORG_NAME_CHECK", "0")
    nc.reject_throwaway_org_name("test", "test")


async def test_create_paths_refuse(monkeypatch, db, org, admin_user, mock_request):
    from src.services.orgs.orgs import create_org, create_org_with_config

    monkeypatch.setenv("LEARNHOUSE_ORG_NAME_CHECK", "1")
    with patch("src.services.orgs.orgs.is_multi_org_allowed", return_value=True):
        for name, slug in (("Test", "brand-new-org"), ("Acme School", "demo-org")):
            with pytest.raises(HTTPException) as e:
                await create_org(mock_request, OrganizationCreate(name=name, slug=slug, email="a@b.com"), admin_user, db)
            assert e.value.detail == nc.REJECT_MESSAGE
        with pytest.raises(HTTPException) as e:
            await create_org_with_config(mock_request, OrganizationCreate(name="zkzmlz", slug="zkzmlz", email="a@b.com"),
                                         admin_user, db, {})
        assert e.value.detail == nc.REJECT_MESSAGE


async def test_rename_is_checked_only_when_it_changes(monkeypatch, db, org, admin_user, mock_request):
    from src.services.orgs.orgs import update_org

    monkeypatch.setenv("LEARNHOUSE_ORG_NAME_CHECK", "1")
    with patch("src.services.orgs.orgs.rbac_check", new_callable=AsyncMock):
        with pytest.raises(HTTPException) as e:
            await update_org(mock_request, OrganizationUpdate(name="test"), org.id, admin_user, db)
        assert e.value.detail == nc.REJECT_MESSAGE
        with pytest.raises(HTTPException) as e:
            await update_org(mock_request, OrganizationUpdate(slug="demo-org"), org.id, admin_user, db)
        assert e.value.detail == nc.REJECT_MESSAGE

        # Resubmitting the current (test-like) name is not a change.
        org.name = "Test Org"
        db.add(org)
        await db.commit()
        with patch("src.services.orgs.orgs.reject_throwaway_org_name") as spy:
            try:
                await update_org(mock_request, OrganizationUpdate(name="Test Org", slug=org.slug), org.id, admin_user, db)
            except HTTPException:
                pass  # later gates are not what this test is about
        spy.assert_not_called()

        # The shared demo org is never checked.
        org.is_demo = True
        db.add(org)
        await db.commit()
        with patch("src.services.orgs.orgs.reject_throwaway_org_name") as spy:
            try:
                await update_org(mock_request, OrganizationUpdate(name="Demo"), org.id, admin_user, db)
            except HTTPException:
                pass
        spy.assert_not_called()
