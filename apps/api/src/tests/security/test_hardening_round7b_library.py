"""Library, membership, custom-domain, contributor and certificate hardening.

* Folder rules reach every item below a folder, at any depth: a private
  ancestor makes the item private, and a private ancestor restricted to
  UserGroups restricts the item to them (media list, file reads, sub-folders).
* The media list honours an API token's own ``media`` rights.
* Media uploads take their size without re-reading the file into memory.
* Boards in folders/search go through the boards service's read rule.
* Authors may pin their own items to the library root.
* Non-Admins can't remove members holding a role more powerful than theirs.
* Domain verification tokens are for domain managers only; DNS proof takes
  over another org's unverified claim of any age.
* Course maintainers can't demote/deactivate each other.
* Learners keep reading their own certificates once a course is unpublished.

These run against the real RBAC checker unless a test says otherwise.
"""

import io
from datetime import datetime
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException, Request, UploadFile
from sqlmodel import select

from src.db.boards import Board, BoardMember
from src.db.courses.certifications import CertificateUser, Certifications
from src.db.custom_domains import CustomDomain, CustomDomainCreate
from src.db.folders.folder_content import FolderContent
from src.db.folders.folders import Folder
from src.db.media.media import Media, MediaCreate, MediaTypeEnum
from src.db.resource_authors import (
    ResourceAuthor,
    ResourceAuthorshipEnum,
    ResourceAuthorshipStatusEnum,
)
from src.db.roles import Role, RoleTypeEnum
from src.db.user_organizations import UserOrganization
from src.db.usergroup_resources import UserGroupResource
from src.db.usergroup_user import UserGroupUser
from src.db.usergroups import UserGroup
from src.db.users import APITokenUser, InternalUser, PublicUser, User
from src.security.rbac import AccessAction, ResourceAccessChecker
from src.services.media.media_access import (
    FolderTree,
    media_in_any_private_folder,
    viewer_folder_grants,
)


def _now():
    return str(datetime.now())


def _req():
    """A fresh request per call, so the per-request RBAC memo never carries
    stale answers across the DB changes a test makes."""
    return Request({"type": "http", "method": "GET", "path": "/", "headers": [], "query_string": b""})


async def _user(db, org, user_id, role_id, **extra):
    u = User(
        id=user_id, username=f"u{user_id}", first_name="U", last_name=str(user_id),
        email=f"u{user_id}@test.com", password="x", user_uuid=f"user_{user_id}",
        creation_date=_now(), update_date=_now(), **extra,
    )
    db.add(u)
    if org is not None:
        db.add(UserOrganization(
            user_id=user_id, org_id=org.id, role_id=role_id,
            creation_date=_now(), update_date=_now(),
        ))
    await db.commit()
    return PublicUser(
        id=user_id, username=u.username, first_name="U", last_name=str(user_id),
        email=u.email, user_uuid=u.user_uuid, is_superadmin=extra.get("is_superadmin", False),
    )


async def _role(db, org, role_id, rights, name=None):
    r = Role(
        id=role_id, name=name or f"Role {role_id}", org_id=org.id,
        role_type=RoleTypeEnum.TYPE_ORGANIZATION, role_uuid=f"role_{role_id}",
        rights=rights, creation_date=_now(), update_date=_now(),
    )
    db.add(r)
    await db.commit()
    return r


def _author(db, resource_uuid, user_id, authorship=ResourceAuthorshipEnum.CREATOR):
    db.add(ResourceAuthor(
        resource_uuid=resource_uuid, user_id=user_id, authorship=authorship,
        authorship_status=ResourceAuthorshipStatusEnum.ACTIVE,
        creation_date=_now(), update_date=_now(),
    ))


# ---------------------------------------------------------------------------
# Library tree fixture
# ---------------------------------------------------------------------------
#
#   R  (private, restricted to group G)
#   └── A  (public)            m_blocked (public)
#   P  (private, no group)
#   └── Q  (public)            m_nested_private (public)
#                              m_pub_linked (public, own link to G) in P
#   O  (public)                m_open (public)
#   root                       m_root (public), m_linked (private, linked to G),
#                              m_own (private, linked to G, authored by regular),
#                              m_plain (private, no group)

ALL_MEDIA = {
    "media_blocked", "media_nested_private", "media_pub_linked", "media_open",
    "media_root", "media_linked", "media_own", "media_plain",
}


@pytest.fixture
async def library(db, org, regular_user):
    db.add(UserGroup(id=1, name="G", description="", org_id=org.id, usergroup_uuid="usergroup_g"))
    folders = [
        (100, "folder_r", False, None),
        (101, "folder_a", True, 100),
        (102, "folder_p", False, None),
        (103, "folder_q", True, 102),
        (104, "folder_o", True, None),
    ]
    for fid, uuid, public, parent in folders:
        db.add(Folder(
            id=fid, name=uuid, public=public, org_id=org.id, folder_uuid=uuid,
            parent_folder_id=parent, creation_date=_now(), update_date=_now(),
        ))
    media = [
        ("media_blocked", True, 101),
        ("media_nested_private", True, 103),
        ("media_pub_linked", True, 102),
        ("media_open", True, 104),
        ("media_root", True, None),
        ("media_linked", False, None),
        ("media_own", False, None),
        ("media_plain", False, None),
    ]
    for uuid, public, folder_id in media:
        db.add(Media(
            name=uuid, media_type=MediaTypeEnum.UPLOAD, public=public, org_id=org.id,
            media_uuid=uuid, file_id="x.pdf", storage_key="k/x.pdf", file_format="pdf",
            creation_date=_now(), update_date=_now(),
        ))
        db.add(FolderContent(
            folder_id=folder_id, resource_uuid=uuid, org_id=org.id, position=0,
            creation_date=_now(), update_date=_now(),
        ))
    for uuid in ("folder_r", "media_linked", "media_own", "media_pub_linked"):
        db.add(UserGroupResource(usergroup_id=1, resource_uuid=uuid, org_id=org.id))
    _author(db, "media_own", regular_user.id)
    await db.commit()


async def _join_group(db, org, user_id):
    db.add(UserGroupUser(usergroup_id=1, user_id=user_id, org_id=org.id))
    await db.commit()


async def _list(db, org, user):
    from src.services.media.media import get_media_list

    return {m.media_uuid for m in await get_media_list(_req(), str(org.id), user, db)}


async def _readable(db, user, media_uuid) -> bool:
    from src.services.media.media import authorize_media_file

    try:
        await authorize_media_file(_req(), media_uuid, user, db)
    except HTTPException:
        return False
    return True


MEMBER_OUTSIDE_GROUP = {"media_nested_private", "media_open", "media_root", "media_own", "media_plain"}


class TestMediaListAndReads:
    @pytest.mark.asyncio
    async def test_anonymous_sees_only_effectively_public(self, db, org, library, anonymous_user):
        # media_nested_private sits below a private folder two levels up.
        assert await _list(db, org, anonymous_user) == {"media_open", "media_root"}
        assert not await _readable(db, anonymous_user, "media_nested_private")
        assert await _readable(db, anonymous_user, "media_open")

    @pytest.mark.asyncio
    async def test_member_outside_group_list_matches_reads(self, db, org, library, regular_user):
        assert await _list(db, org, regular_user) == MEMBER_OUTSIDE_GROUP
        for uuid in ALL_MEDIA:
            assert await _readable(db, regular_user, uuid) == (uuid in MEMBER_OUTSIDE_GROUP), uuid

    @pytest.mark.asyncio
    async def test_group_member_sees_everything(self, db, org, library, regular_user):
        await _join_group(db, org, regular_user.id)
        assert await _list(db, org, regular_user) == ALL_MEDIA
        for uuid in ALL_MEDIA:
            assert await _readable(db, regular_user, uuid), uuid

    @pytest.mark.asyncio
    async def test_folder_author_reaches_its_content(self, db, org, library, regular_user):
        _author(db, "folder_r", regular_user.id)
        await db.commit()
        assert "media_blocked" in await _list(db, org, regular_user)
        assert await _readable(db, regular_user, "media_blocked")

    @pytest.mark.asyncio
    async def test_admin_sees_everything(self, db, org, library, admin_user):
        assert await _list(db, org, admin_user) == ALL_MEDIA

    @pytest.mark.asyncio
    async def test_member_without_any_folders(self, db, org, regular_user):
        db.add(Media(
            name="solo", media_type=MediaTypeEnum.UPLOAD, public=False, org_id=org.id,
            media_uuid="media_solo", creation_date=_now(), update_date=_now(),
        ))
        await db.commit()
        assert await _list(db, org, regular_user) == {"media_solo"}

    @pytest.mark.asyncio
    async def test_api_token_uses_its_media_rights(self, db, org, other_org, library, admin_user):
        reader = APITokenUser(
            id=7, org_id=org.id, created_by_user_id=admin_user.id,
            rights={"media": {"action_read": True}},
        )
        assert await _list(db, org, reader) == ALL_MEDIA

        no_media = APITokenUser(
            id=8, org_id=org.id, created_by_user_id=admin_user.id,
            rights={"courses": {"action_read": True}},
        )
        with pytest.raises(HTTPException) as exc:
            await _list(db, org, no_media)
        assert exc.value.status_code == 403

        elsewhere = APITokenUser(
            id=9, org_id=other_org.id, created_by_user_id=admin_user.id,
            rights={"media": {"action_read": True}},
        )
        with pytest.raises(HTTPException) as exc:
            await _list(db, org, elsewhere)
        assert exc.value.status_code == 403


class TestFolderTreeHelpers:
    def test_chain_survives_a_cycle(self):
        tree = FolderTree(parents={1: 2, 2: 1}, public={1: True, 2: False}, uuids={1: "a", 2: "b"})
        assert tree.chain([1]) == {1, 2}
        assert tree.any_private([1])

    @pytest.mark.asyncio
    async def test_viewer_grants_for_anonymous(self, db):
        assert await viewer_folder_grants(db, 0) == (set(), set())

    @pytest.mark.asyncio
    async def test_media_in_any_private_folder_is_ancestor_aware(self, db, org, library):
        assert await media_in_any_private_folder(db, "media_nested_private")
        assert not await media_in_any_private_folder(db, "media_open")
        assert not await media_in_any_private_folder(db, "media_root")

    @pytest.mark.asyncio
    async def test_checker_edges(self, db, org, library, regular_user):
        from src.security.rbac.config import get_resource_config

        checker = ResourceAccessChecker(_req(), db, regular_user)
        # A missing media has no enclosing folders to restrict it.
        assert not await checker._blocked_by_enclosing_folder(
            "media_missing", get_resource_config("media_x")
        )
        # Non-library types are never folder-restricted.
        assert not await checker._blocked_by_enclosing_folder("course_x", get_resource_config("course_x"))
        # The org tree is loaded once per checker.
        assert (await checker.check_access("media_nested_private", AccessAction.READ)).allowed
        assert not (await checker.check_access("media_blocked", AccessAction.READ)).allowed
        assert len(checker._folder_trees) == 1


class TestFolderListings:
    @pytest.mark.asyncio
    async def test_sub_folder_listing_takes_read_on_the_parent(
        self, db, org, library, regular_user, anonymous_user, admin_user
    ):
        from src.services.folders.folders import get_folder, get_folders

        for user in (regular_user, anonymous_user):
            for parent in ("folder_r", "folder_a"):
                with pytest.raises(HTTPException) as exc:
                    await get_folders(_req(), str(org.id), user, db, parent_folder_uuid=parent)
                assert exc.value.status_code == 403
        # A public folder below a private one is private.
        with pytest.raises(HTTPException):
            await get_folder(_req(), "folder_q", anonymous_user, db)

        admin_view = await get_folders(_req(), str(org.id), admin_user, db, parent_folder_uuid="folder_r")
        assert [f.folder_uuid for f in admin_view] == ["folder_a"]

        await _join_group(db, org, regular_user.id)
        member_view = await get_folders(_req(), str(org.id), regular_user, db, parent_folder_uuid="folder_r")
        assert [f.folder_uuid for f in member_view] == ["folder_a"]

    @pytest.mark.asyncio
    async def test_search_hides_public_folders_below_private_ones(self, db, org, library, anonymous_user):
        from src.services.folders.folders import search_library

        result = await search_library(_req(), str(org.id), "folder_", anonymous_user, db)
        assert {f["folder_uuid"] for f in result["folders"]} == {"folder_o"}


@pytest.fixture
async def boards(db, org, admin_user, regular_user):
    for id_, uuid in ((1, "board_private"), (2, "board_members")):
        db.add(Board(
            id=id_, name=uuid, public=False, org_id=org.id, board_uuid=uuid,
            created_by=admin_user.id, creation_date=_now(), update_date=_now(),
        ))
        db.add(FolderContent(folder_id=None, resource_uuid=uuid, org_id=org.id, position=id_))
    db.add(BoardMember(board_id=2, user_id=regular_user.id, creation_date=_now()))
    await db.commit()


class TestBoardsInLibrary:
    @pytest.mark.asyncio
    async def test_private_board_without_group_is_for_its_members(self, db, org, boards, regular_user):
        from src.services.folders.folders import get_org_root_items, search_library

        items = await get_org_root_items(_req(), str(org.id), regular_user, db)
        assert [i.resource_uuid for i in items] == ["board_members"]
        found = await search_library(_req(), str(org.id), "board_", regular_user, db)
        assert [i["resource_uuid"] for i in found["items"]] == ["board_members"]

    @pytest.mark.asyncio
    async def test_board_check_errors_hide_the_item(self, db, org, boards, regular_user):
        from src.services.folders.folders import get_org_root_items

        with patch(
            "src.services.boards.boards._check_board_read",
            new=AsyncMock(side_effect=HTTPException(status_code=403, detail="2FA required")),
        ):
            assert await get_org_root_items(_req(), str(org.id), regular_user, db) == []


INSTRUCTOR_RIGHTS = {
    "folders": {"action_create": True, "action_read": True, "action_update": False, "action_delete": False},
    "media": {"action_create": True, "action_read": True, "action_update": False, "action_delete": False},
}


class TestPinToRoot:
    @pytest.fixture
    async def instructor(self, db, org):
        await _role(db, org, 3, INSTRUCTOR_RIGHTS, name="Instructor")
        return await _user(db, org, 30, 3)

    async def _media(self, db, org, uuid, author_id):
        db.add(Media(
            name=uuid, media_type=MediaTypeEnum.EMBED, public=True, org_id=org.id,
            media_uuid=uuid, url="https://example.com", creation_date=_now(), update_date=_now(),
        ))
        _author(db, uuid, author_id)
        await db.commit()

    @pytest.mark.asyncio
    async def test_author_pins_own_item_but_not_others(self, db, org, admin_user, instructor):
        from src.services.folders.folders import add_org_root_content

        await self._media(db, org, "media_mine", instructor.id)
        await self._media(db, org, "media_theirs", admin_user.id)

        item = await add_org_root_content(_req(), org.id, "media_mine", instructor, db)
        assert item.resource_uuid == "media_mine"

        with pytest.raises(HTTPException) as exc:
            await add_org_root_content(_req(), org.id, "media_theirs", instructor, db)
        assert exc.value.status_code == 403

    @pytest.mark.asyncio
    async def test_api_token_still_takes_folder_update(self, db, org, admin_user):
        from src.services.folders.folders import add_org_root_content

        await self._media(db, org, "media_tok", admin_user.id)
        rights = {"folders": {"action_create": True}, "media": {"action_read": True}}
        token = APITokenUser(id=5, org_id=org.id, created_by_user_id=admin_user.id, rights=rights)
        with pytest.raises(HTTPException) as exc:
            await add_org_root_content(_req(), org.id, "media_tok", token, db)
        assert exc.value.status_code == 403

        rights["folders"]["action_update"] = True
        token = APITokenUser(id=5, org_id=org.id, created_by_user_id=admin_user.id, rights=rights)
        item = await add_org_root_content(_req(), org.id, "media_tok", token, db)
        assert item.resource_uuid == "media_tok"

    @pytest.mark.asyncio
    async def test_authorship_probe_error_is_not_authorship(self, db, regular_user):
        from src.services.folders.folders import _authors_item

        with patch(
            "src.services.folders.folders.check_resource_access",
            new=AsyncMock(side_effect=HTTPException(status_code=403, detail="2FA required")),
        ):
            assert not await _authors_item(_req(), regular_user, db, "media_any")


class TestMediaUploadSize:
    async def _create(self, db, org, admin_user, upload):
        from src.services.media.media import create_media

        with patch(
            "src.services.media.media.upload_file", new=AsyncMock(return_value="media_abc.pdf")
        ):
            return await create_media(
                _req(), MediaCreate(org_id=org.id, name="doc", media_type=MediaTypeEnum.UPLOAD),
                admin_user, db, upload,
            )

    async def _size(self, db, media_uuid):
        return (await db.execute(select(Media.file_size).where(Media.media_uuid == media_uuid))).scalar()

    @pytest.mark.asyncio
    async def test_size_from_multipart_without_reading(self, db, org, admin_user):
        upload = UploadFile(file=io.BytesIO(b"hello"), filename="a.pdf", size=5)
        with patch.object(UploadFile, "read", new=AsyncMock(side_effect=AssertionError("re-read"))):
            media = await self._create(db, org, admin_user, upload)
        assert await self._size(db, media.media_uuid) == 5

    @pytest.mark.asyncio
    async def test_size_from_file_end_when_unknown(self, db, org, admin_user):
        upload = UploadFile(file=io.BytesIO(b"hello!"), filename="a.pdf", size=None)
        media = await self._create(db, org, admin_user, upload)
        assert await self._size(db, media.media_uuid) == 6

    @pytest.mark.asyncio
    async def test_unseekable_file_has_no_size(self, db, org, admin_user):
        class Unseekable(io.BytesIO):
            def seek(self, *args):
                raise OSError("not seekable")

        upload = UploadFile(file=Unseekable(b"x"), filename="a.pdf", size=None)
        media = await self._create(db, org, admin_user, upload)
        assert await self._size(db, media.media_uuid) is None


# ---------------------------------------------------------------------------
# Membership management by rights
# ---------------------------------------------------------------------------

MAINTAINER_RIGHTS = {"users": {"action_read": True, "action_update": True, "action_delete": True}}
POWER_RIGHTS = {"users": {"action_read": True}, "roles": {"action_update": True}}
WEAK_RIGHTS = {"users": {"action_read": True}}


@pytest.fixture
def quiet_removal():
    with patch("src.services.orgs.users.rbac_check", new_callable=AsyncMock), patch(
        "src.routers.users._invalidate_session_cache"
    ), patch("src.services.orgs.users.decrease_feature_usage"), patch(
        "src.services.orgs.users.dispatch_webhooks", new_callable=AsyncMock
    ):
        yield


@pytest.fixture
async def members(db, org, admin_user, quiet_removal):
    await _role(db, org, 2, MAINTAINER_RIGHTS, name="Maintainer")
    await _role(db, org, 10, POWER_RIGHTS, name="Power")
    await _role(db, org, 11, WEAK_RIGHTS, name="Weak")
    return {
        "maintainer": await _user(db, org, 20, 2),
        "power": await _user(db, org, 21, 10),
        "weak": await _user(db, org, 22, 11),
        "weak2": await _user(db, org, 23, 11),
    }


class TestMembershipByRights:
    @pytest.mark.asyncio
    async def test_maintainer_cannot_remove_a_stronger_custom_role(self, db, org, members):
        from src.services.orgs.users import remove_batch_users_from_org, remove_user_from_org

        maintainer = members["maintainer"]
        with pytest.raises(HTTPException) as exc:
            await remove_user_from_org(_req(), org.id, members["power"].id, db, maintainer)
        assert exc.value.status_code == 403
        with pytest.raises(HTTPException) as exc:
            await remove_batch_users_from_org(
                _req(), org.id, [members["weak"].id, members["power"].id], db, maintainer
            )
        assert exc.value.status_code == 403

        assert await remove_user_from_org(_req(), org.id, members["weak"].id, db, maintainer) == {
            "detail": "User removed from org"
        }
        await remove_batch_users_from_org(_req(), org.id, [members["weak2"].id], db, maintainer)

    @pytest.mark.asyncio
    async def test_maintainer_cannot_demote_a_stronger_custom_role(self, db, org, members):
        from src.services.orgs.users import update_user_role

        maintainer = members["maintainer"]
        with pytest.raises(HTTPException) as exc:
            await update_user_role(_req(), org.id, members["power"].id, "role_11", db, maintainer)
        assert exc.value.status_code == 403
        assert "manage a member" in exc.value.detail

    @pytest.mark.asyncio
    async def test_admin_superadmin_and_internal_callers_pass(self, db, org, admin_user, members):
        from src.services.orgs.users import _require_rights_over_members

        target = [members["power"].id]
        superadmin = await _user(db, None, 40, None, is_superadmin=True)
        for caller in (admin_user, superadmin, InternalUser()):
            await _require_rights_over_members(org, caller, target, db)
        await _require_rights_over_members(org, members["maintainer"], [], db)

    @pytest.mark.asyncio
    async def test_caller_without_membership_is_refused(self, db, org, other_org, members):
        from src.services.orgs.users import _require_rights_over_members

        outsider = await _user(db, other_org, 41, 2)
        with pytest.raises(HTTPException) as exc:
            await _require_rights_over_members(org, outsider, [members["weak"].id], db)
        assert exc.value.status_code == 403


# ---------------------------------------------------------------------------
# Custom domains
# ---------------------------------------------------------------------------

def _domain_row(org_id, domain, *, status="pending", verified_at=None, created=None):
    return CustomDomain(
        domain_uuid=f"domain_{domain}", domain=domain, org_id=org_id, status=status,
        verification_token="secret-token", verified_at=verified_at,
        creation_date=created or _now(), update_date=_now(),
    )


class _Txt:
    def __init__(self, value):
        self.value = value

    def __str__(self):
        return f'"{self.value}"'


class TestCustomDomainTokens:
    @pytest.mark.asyncio
    async def test_tokens_only_for_domain_managers(self, db, org, admin_user, regular_user):
        from src.services.orgs.custom_domains import (
            get_custom_domain,
            get_domain_verification_info,
            list_custom_domains,
        )

        db.add(_domain_row(org.id, "learn.example.com"))
        await db.commit()

        listed = await list_custom_domains(_req(), db, org.id, regular_user)
        assert [d.verification_token for d in listed] == [""]
        single = await get_custom_domain(_req(), db, org.id, "domain_learn.example.com", regular_user)
        assert single.verification_token == ""
        with pytest.raises(HTTPException) as exc:
            await get_domain_verification_info(_req(), db, org.id, "domain_learn.example.com", regular_user)
        assert exc.value.status_code == 403

        listed = await list_custom_domains(_req(), db, org.id, admin_user)
        assert [d.verification_token for d in listed] == ["secret-token"]
        single = await get_custom_domain(_req(), db, org.id, "domain_learn.example.com", admin_user)
        assert single.verification_token == "secret-token"
        info = await get_domain_verification_info(_req(), db, org.id, "domain_learn.example.com", admin_user)
        assert info.txt_record_value == "learnhouse-verify=secret-token"


class TestCustomDomainTakeover:
    @pytest.fixture
    async def other_admin(self, db, org, other_org, admin_role):
        return await _user(db, other_org, 50, admin_role.id)

    async def _add(self, db, other_org, user, domain):
        from src.services.orgs.custom_domains import add_custom_domain

        with patch(
            "src.services.security.account_age.enforce_free_tier_age_gate", new_callable=AsyncMock
        ):
            return await add_custom_domain(_req(), db, CustomDomainCreate(domain=domain), other_org.id, user)

    @pytest.mark.asyncio
    async def test_fresh_unverified_claim_needs_dns_proof(self, db, org, other_org, other_admin):
        from src.services.orgs import custom_domains as cd

        db.add(_domain_row(org.id, "squat.example.com"))
        await db.commit()
        token = cd.takeover_verification_token("squat.example.com", other_org.id)

        with patch("dns.resolver.resolve", return_value=[_Txt("learnhouse-verify=someone-else")]):
            with pytest.raises(HTTPException) as exc:
                await self._add(db, other_org, other_admin, "squat.example.com")
        assert exc.value.status_code == 409
        assert f"learnhouse-verify={token}" in exc.value.detail
        assert "_learnhouse-verification.squat.example.com" in exc.value.detail

        with patch("dns.resolver.resolve", return_value=[_Txt(f"learnhouse-verify={token}")]) as resolve:
            result = await self._add(db, other_org, other_admin, "squat.example.com")
        resolve.assert_called_once_with("_learnhouse-verification.squat.example.com", "TXT")
        assert result.org_id == other_org.id
        assert result.status == "verified" and result.verified_at
        rows = (await db.execute(select(CustomDomain).where(CustomDomain.domain == "squat.example.com"))).scalars().all()
        assert [r.org_id for r in rows] == [other_org.id]

    @pytest.mark.asyncio
    async def test_verified_claims_stay_protected(self, db, org, other_org, other_admin):
        db.add(_domain_row(org.id, "owned.example.com", status="verified", verified_at=_now()))
        await db.commit()
        with patch("dns.resolver.resolve") as resolve:
            with pytest.raises(HTTPException) as exc:
                await self._add(db, other_org, other_admin, "owned.example.com")
        assert exc.value.status_code == 409
        assert exc.value.detail == "This domain is already registered"
        resolve.assert_not_called()

    @pytest.mark.asyncio
    async def test_stale_claim_still_released_without_dns(self, db, org, other_org, other_admin):
        db.add(_domain_row(org.id, "old.example.com", created="2000-01-01T00:00:00"))
        await db.commit()
        result = await self._add(db, other_org, other_admin, "old.example.com")
        assert result.status == "pending"

    def test_txt_lookup_failure_is_not_proof(self):
        from src.services.orgs.custom_domains import _txt_record_present

        with patch("dns.resolver.resolve", side_effect=RuntimeError("timeout")):
            assert not _txt_record_present("x.example.com", "t")

    def test_takeover_token_is_bound_to_the_org(self):
        from src.services.orgs.custom_domains import takeover_verification_token

        assert takeover_verification_token("x.example.com", 1) != takeover_verification_token("x.example.com", 2)


# ---------------------------------------------------------------------------
# Course contributors
# ---------------------------------------------------------------------------

class TestMaintainersCannotDemoteEachOther:
    @pytest.fixture
    async def team(self, db, org, course, admin_user):
        creator = await _user(db, org, 60, 4)
        m1 = await _user(db, org, 61, 4)
        m2 = await _user(db, org, 62, 4)
        contrib = await _user(db, org, 63, 4)
        _author(db, course.course_uuid, creator.id, ResourceAuthorshipEnum.CREATOR)
        _author(db, course.course_uuid, m1.id, ResourceAuthorshipEnum.MAINTAINER)
        _author(db, course.course_uuid, m2.id, ResourceAuthorshipEnum.MAINTAINER)
        _author(db, course.course_uuid, contrib.id, ResourceAuthorshipEnum.CONTRIBUTOR)
        await db.commit()
        return {"creator": creator, "m1": m1, "m2": m2, "contrib": contrib}

    async def _update(self, db, course, caller, target, authorship, status):
        from src.services.courses.contributors import update_course_contributor

        with patch(
            "src.services.courses.contributors.check_resource_access", new_callable=AsyncMock
        ):
            return await update_course_contributor(
                _req(), course.course_uuid, target.id, authorship, status, caller, db
            )

    @pytest.mark.asyncio
    async def test_maintainer_vs_maintainer(self, db, org, course, admin_user, team, user_role):
        inactive = ResourceAuthorshipStatusEnum.INACTIVE
        active = ResourceAuthorshipStatusEnum.ACTIVE
        with pytest.raises(HTTPException) as exc:
            await self._update(db, course, team["m1"], team["m2"], ResourceAuthorshipEnum.MAINTAINER, inactive)
        assert exc.value.status_code == 403

        # Contributors are still theirs to manage.
        await self._update(db, course, team["m1"], team["contrib"], ResourceAuthorshipEnum.CONTRIBUTOR, inactive)
        # The creator and org admins may change a maintainer.
        await self._update(db, course, team["creator"], team["m2"], ResourceAuthorshipEnum.CONTRIBUTOR, active)
        await self._update(db, course, admin_user, team["m1"], ResourceAuthorshipEnum.CONTRIBUTOR, active)


# ---------------------------------------------------------------------------
# Certificates
# ---------------------------------------------------------------------------

class TestOwnCertificatesAfterUnpublish:
    @pytest.fixture
    async def earned(self, db, course, regular_user):
        course.published = False
        course.public = False
        db.add(course)
        db.add(Certifications(
            id=1, course_id=course.id, config={}, certification_uuid="certification_x",
            creation_date=_now(), update_date=_now(),
        ))
        db.add(CertificateUser(
            id=1, user_id=regular_user.id, certification_id=1,
            user_certification_uuid="CERT-1", created_at=_now(), updated_at=_now(),
        ))
        await db.commit()

    @pytest.mark.asyncio
    async def test_learner_keeps_own_certificate(self, db, org, course, earned, regular_user, user_role):
        from src.services.courses.certifications import get_user_certificates_for_course

        result = await get_user_certificates_for_course(_req(), course.course_uuid, regular_user, db)
        assert [r["certificate_user"].user_certification_uuid for r in result] == ["CERT-1"]

        stranger = await _user(db, org, 70, user_role.id)
        assert await get_user_certificates_for_course(_req(), course.course_uuid, stranger, db) == []

    @pytest.mark.asyncio
    async def test_anonymous_still_needs_course_access(self, db, course, earned, anonymous_user):
        from src.services.courses.certifications import get_user_certificates_for_course

        with pytest.raises(HTTPException) as exc:
            await get_user_certificates_for_course(_req(), course.course_uuid, anonymous_user, db)
        assert exc.value.status_code == 403
