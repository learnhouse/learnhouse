# ruff: noqa: E402
# stdout/stderr reconfig must run before any other import that might print.
import asyncio
import os
import sys
from typing import Annotated

# Force UTF-8 so install messages with emoji don't crash cp1252 consoles (Windows).
for _stream in (sys.stdout, sys.stderr):
    if hasattr(_stream, "reconfigure"):
        try:
            _stream.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass

from sqlalchemy import create_engine
from sqlalchemy.ext.asyncio import create_async_engine
from sqlmodel import SQLModel
from sqlmodel.ext.asyncio.session import AsyncSession
import typer
from config.config import get_learnhouse_config
from src.db.organizations import OrganizationCreate
from src.db.users import UserCreate
from src.services.setup.setup import (
    install_create_organization,
    install_create_organization_user,
    install_default_elements,
)

cli = typer.Typer()


def _to_async_url(url: str) -> str:
    if "+asyncpg" in url:
        return url
    if url.startswith("postgresql://"):
        return url.replace("postgresql://", "postgresql+asyncpg://", 1)
    return url


def _to_sync_url(url: str) -> str:
    return url.replace("+asyncpg", "")


@cli.command()
def install(
    short: Annotated[bool, typer.Option(help="Install with predefined values")] = False
):
    """Install LearnHouse: schema, default elements, organization, and admin user.

    Typer entry point — uses asyncio.run because no loop is running yet.
    Programmatic async callers (FastAPI lifespan, etc.) should await
    `_install_async` directly to keep the SQLAlchemy greenlet context.
    """
    asyncio.run(_install_async(short))


async def _install_async(short: bool) -> None:
    learnhouse_config = get_learnhouse_config()
    sql_url = learnhouse_config.database_config.sql_connection_string  # type: ignore

    # Schema DDL runs on a sync engine (SQLModel.metadata.create_all is sync).
    sync_engine = create_engine(_to_sync_url(sql_url), echo=False, pool_pre_ping=True)
    SQLModel.metadata.create_all(sync_engine)
    sync_engine.dispose()

    # The install_* coroutines use sqlmodel.ext.asyncio.session.AsyncSession.
    # expire_on_commit=False keeps already-loaded attributes accessible after
    # each commit — without it, `UserRead.model_validate(user)` inside
    # `install_create_organization_user` triggers async refresh outside the
    # session's greenlet context and raises MissingGreenlet.
    async_engine = create_async_engine(
        _to_async_url(sql_url), echo=False, pool_pre_ping=True
    )

    try:
        async with AsyncSession(
            async_engine, expire_on_commit=False
        ) as db_session:
            if short:
                # Install the default elements
                print("Installing default elements...")
                await install_default_elements(db_session)
                print("Default elements installed ✅")

                # Honor LEARNHOUSE_INITIAL_ORG_NAME / LEARNHOUSE_INITIAL_ORG_SLUG when
                # the CLI passes them — falls back to "Default Organization" / "default"
                # so existing standalone deployments still work unchanged.
                org_name = os.environ.get("LEARNHOUSE_INITIAL_ORG_NAME", "Default Organization")
                org_slug = os.environ.get("LEARNHOUSE_INITIAL_ORG_SLUG", "default").lower()

                # Create the Organization
                print(f"Creating organization '{org_name}' (slug: {org_slug})...")
                org = OrganizationCreate(
                    name=org_name,
                    description=org_name,
                    slug=org_slug,
                    email="",
                    logo_image="",
                    thumbnail_image="",
                    about="",
                    label="",
                )
                await install_create_organization(org, db_session)
                print(f"Organization '{org_name}' created ✅")

                # Create Organization User
                print("Creating default organization user...")
                # Use email from environment variable if provided, otherwise default to "admin@school.dev"
                email = os.environ.get("LEARNHOUSE_INITIAL_ADMIN_EMAIL", "admin@school.dev")
                # Require password from environment variable
                password = os.environ.get("LEARNHOUSE_INITIAL_ADMIN_PASSWORD")
                if not password:
                    print("❌ Error: LEARNHOUSE_INITIAL_ADMIN_PASSWORD environment variable is required")
                    print("Please set LEARNHOUSE_INITIAL_ADMIN_PASSWORD environment variable before running installation.")
                    raise typer.Exit(code=1)
                print("Using password from LEARNHOUSE_INITIAL_ADMIN_PASSWORD environment variable")
                if email != "admin@school.dev":
                    print(f"Using email from LEARNHOUSE_INITIAL_ADMIN_EMAIL environment variable: {email}")
                user = UserCreate(
                    username="admin", email=email, password=password
                )
                await install_create_organization_user(
                    user, org_slug, db_session, is_superadmin=True
                )
                print("Default organization user created ✅")

                # Show the user how to login
                print("Installation completed ✅")
                print("")
                print("Login with the following credentials:")
                print("email: " + email)
                print("password: (the password you set in LEARNHOUSE_INITIAL_ADMIN_PASSWORD)")
                print("⚠️ Remember to change the password after logging in ⚠️")

            else:
                # Install the default elements
                print("Installing default elements...")
                await install_default_elements(db_session)
                print("Default elements installed ✅")

                # Create the Organization
                print("Creating your organization...")
                orgname = typer.prompt("What's shall we call your organization?")
                slug = typer.prompt(
                    "What's the slug for your organization? (e.g. school, acme)"
                )
                org = OrganizationCreate(
                    name=orgname,
                    description="Default Organization",
                    slug=slug.lower(),
                    email="",
                    logo_image="",
                    thumbnail_image="",
                    about="",
                    label="",
                )
                await install_create_organization(org, db_session)
                print(orgname + " Organization created ✅")

                # Create Organization User
                print("Creating your organization user...")
                username = typer.prompt("What's the username for the user?")
                email = typer.prompt("What's the email for the user?")
                password = typer.prompt("What's the password for the user?", hide_input=True)
                user = UserCreate(username=username, email=email, password=password)
                await install_create_organization_user(
                    user, slug, db_session, is_superadmin=True
                )
                print(username + " user created ✅")

                # Show the user how to login
                print("Installation completed ✅")
                print("")
                print("Login with the following credentials:")
                print("email: " + email)
                print("password: The password you entered")
    finally:
        await async_engine.dispose()




@cli.command()
def backfill_faststart(
    prefix: Annotated[str, typer.Option(help="S3 key prefix to scan")] = "content/",
    dry_run: Annotated[bool, typer.Option(help="Only report what would change")] = False,
    limit: Annotated[int, typer.Option(help="Max files to process (0 = no limit)")] = 0,
):
    """Rewrite already-uploaded MP4 videos so their moov atom is at the front.

    Streams the first 2MB of each MP4 to detect whether it is already faststart;
    only non-faststart files are downloaded in full, remuxed with ffmpeg
    (-c copy, lossless), and re-uploaded. Safe to re-run — faststart files are
    skipped.
    """
    import tempfile
    from src.services.courses.transfer.storage_utils import (
        is_s3_enabled,
        get_storage_client,
        get_s3_bucket_name,
    )
    from src.services.utils.video_processing import (
        ensure_faststart,
        is_faststart,
        _FASTSTART_EXTENSIONS,
    )

    if not is_s3_enabled():
        print("❌ S3/R2 is not enabled; nothing to backfill.")
        raise typer.Exit(code=1)

    s3 = get_storage_client()
    bucket = get_s3_bucket_name()
    if not s3:
        print("❌ Could not build storage client.")
        raise typer.Exit(code=1)

    bounded = limit if limit and limit > 0 else 0  # negative/0 → no limit
    scanned = processed = skipped = failed = attempted = 0
    stop = False
    try:
        paginator = s3.get_paginator("list_objects_v2")
        for page in paginator.paginate(Bucket=bucket, Prefix=prefix):
            for obj in page.get("Contents", []):
                key = obj["Key"]
                if os.path.splitext(key)[1].lower() not in _FASTSTART_EXTENSIONS:
                    continue
                scanned += 1

                # Cheap check: fetch just the head and look for moov before mdat.
                try:
                    head = s3.get_object(Bucket=bucket, Key=key, Range="bytes=0-2097151")
                    body = head["Body"]
                    try:
                        head_bytes = body.read()
                    finally:
                        body.close()  # always release the connection back to the pool
                except Exception as e:
                    print(f"  ⚠️  {key}: could not read head ({e})")
                    failed += 1
                    continue
                moov, mdat = head_bytes.find(b"moov"), head_bytes.find(b"mdat")
                if moov != -1 and (mdat == -1 or moov < mdat):
                    skipped += 1
                    continue

                # This file needs work — counts toward the --limit budget whether
                # or not the remux ultimately succeeds (bounds real download/CPU).
                attempted += 1
                print(f"  → needs faststart: {key} ({obj['Size'] / 1e6:.0f} MB)")
                if dry_run:
                    processed += 1
                else:
                    with tempfile.TemporaryDirectory() as td:
                        local = os.path.join(td, os.path.basename(key))
                        try:
                            s3.download_file(bucket, key, local)
                            if ensure_faststart(local) and is_faststart(local):
                                s3.upload_file(local, bucket, key)
                                print(f"    ✅ remuxed & re-uploaded {key}")
                                processed += 1
                            else:
                                print(f"    ⚠️  remux skipped/failed for {key}")
                                failed += 1
                        except Exception as e:
                            print(f"    ❌ error on {key}: {e}")
                            failed += 1

                if bounded and attempted >= bounded:
                    print("Reached --limit; stopping.")
                    stop = True
                    break
            if stop:
                break
    except Exception as e:
        # A pagination/list error must not lose the summary of work already done.
        print(f"⚠️  scan aborted early: {e}")

    verb = "would remux" if dry_run else "remuxed"
    print(
        f"\nDone. scanned={scanned} attempted={attempted} {verb}={processed} "
        f"already-faststart={skipped} failed={failed}"
    )


@cli.command()
def transcode_backfill(
    limit: Annotated[int, typer.Option(help="Max activities to process (0 = all)")] = 0,
    inline: Annotated[bool, typer.Option(help="Transcode inline now instead of enqueuing")] = False,
):
    """Queue existing not-yet-ready hosted videos for HLS transcoding.

    Default: enqueue them to Redis — the running API's in-app background consumer
    transcodes them (no worker process needed); returns immediately. Use --inline
    to transcode synchronously here (e.g. a one-off box with ffmpeg + creds)."""
    from src.services.utils.hls_jobs import backfill, enqueue_pending
    if inline:
        result = asyncio.run(backfill(limit=limit))
        print(
            f"HLS backfill (inline) done. total={result['total']} "
            f"done={result['done']} failed={result['failed']}"
        )
    else:
        result = asyncio.run(enqueue_pending(limit=limit))
        print(
            f"HLS enqueue done. pending={result['pending']} "
            f"enqueued={result.get('enqueued', 0)} "
            f"(the API's in-app consumer will transcode them)"
        )


@cli.command()
def compute_active_user_overage(
    year: Annotated[int, typer.Option(help="Calendar year (UTC), e.g. 2026")] = 0,
    month: Annotated[int, typer.Option(help="Calendar month 1-12 (UTC)")] = 0,
):
    """
    Month-end: compute per-org active-user overage for a calendar month.

    Cron-invoked. COMPUTES and reports only — the platform service performs
    the Stripe charge. Defaults to the current UTC month when year/month
    are omitted.
    """
    asyncio.run(_compute_active_user_overage(year, month))


async def _compute_active_user_overage(year: int, month: int) -> None:
    from datetime import datetime, timezone
    from src.security.features_utils.active_users import (
        get_all_orgs_with_active_user_overage,
    )

    if not year or not month:
        now = datetime.now(timezone.utc)
        year, month = now.year, now.month

    learnhouse_config = get_learnhouse_config()
    sql_url = learnhouse_config.database_config.sql_connection_string  # type: ignore
    async_engine = create_async_engine(_to_async_url(sql_url), echo=False, pool_pre_ping=True)

    try:
        async with AsyncSession(async_engine, expire_on_commit=False) as db_session:
            rows = await get_all_orgs_with_active_user_overage(year, month, db_session)
    finally:
        await async_engine.dispose()

    print(f"Active-user overage for {year}-{month:02d} (UTC): {len(rows)} org(s) over limit")
    total = 0
    for r in rows:
        total += r["overage_usd"]
        print(
            f"  org {r['org_id']} [{r['plan']}]: "
            f"active={r['active_users']} limit={r['plan_limit']} "
            f"overage={r['overage_units']} (${r['overage_usd']})"
        )
    print(f"Total billable overage: ${total}")


@cli.command()
def nudges_run(
    dry_run: Annotated[bool, typer.Option(help="Render and log, but send nothing")] = False,
    seed: Annotated[
        bool,
        typer.Option(
            help="Write suppressed ledger rows instead of sending. Run once "
            "before enabling, so switching on doesn't fire a backlog."
        ),
    ] = False,
    max_sends: Annotated[int, typer.Option(help="Hard ceiling for this run")] = 0,
    only: Annotated[str, typer.Option(help="Restrict to a single nudge id")] = "",
    org_id: Annotated[int, typer.Option(help="Restrict to a single org id")] = 0,
    force: Annotated[
        bool, typer.Option(help="Bypass the SaaS and kill-switch gates (staging)")
    ] = False,
):
    """
    Daily: send lifecycle nudges to organization admins.

    Cron-invoked. Sends nothing unless LEARNHOUSE_NUDGES_ENABLED is set and the
    deployment is SaaS — so deploying this command is not the same as arming
    it. Start with --dry-run, then --seed, then a small --max-sends.
    """
    asyncio.run(
        _run_nudges(
            dry_run=dry_run,
            seed=seed,
            max_sends=max_sends or None,
            only=only or None,
            org_id=org_id or None,
            force=force,
        )
    )


async def _run_nudges(
    *,
    dry_run: bool,
    seed: bool,
    max_sends,
    only,
    org_id,
    force: bool,
) -> None:
    from src.services.nudges.runner import run_nudges

    learnhouse_config = get_learnhouse_config()
    sql_url = learnhouse_config.database_config.sql_connection_string  # type: ignore
    async_engine = create_async_engine(_to_async_url(sql_url), echo=False, pool_pre_ping=True)

    try:
        async with AsyncSession(async_engine, expire_on_commit=False) as db_session:
            stats = await run_nudges(
                db_session,
                dry_run=dry_run,
                seed=seed,
                max_sends=max_sends,
                only=only,
                org_id=org_id,
                force=force,
            )
    finally:
        await async_engine.dispose()

    mode = "seed" if seed else ("dry-run" if dry_run else "live")
    result = stats.as_dict()
    print(f"Nudge run ({mode}): sent={result['sent']} failed={result['failed']}")
    print(
        "  skipped: "
        f"dedupe={result['skipped_dedupe']} "
        f"cap={result['skipped_cap']} "
        f"optout={result['skipped_optout']} "
        f"backfill={result['skipped_backfill']} "
        f"inactive_org={result['skipped_inactive_org']}"
    )
    if result["budget_exhausted"]:
        print("  budget exhausted — remaining candidates deferred to the next run")
    for nudge_id, count in result["by_nudge"].items():
        print(f"    {nudge_id}: {count}")


@cli.command()
def nudges_stats(
    days: Annotated[int, typer.Option(help="Window to report on")] = 30,
):
    """Report what the nudge ledger has recorded. Sends nothing."""
    asyncio.run(_nudges_stats(days))


async def _nudges_stats(days: int) -> None:
    from datetime import datetime, timedelta, timezone

    from sqlalchemy import func
    from sqlmodel import select

    from src.db.nudges import NudgeSend

    learnhouse_config = get_learnhouse_config()
    sql_url = learnhouse_config.database_config.sql_connection_string  # type: ignore
    async_engine = create_async_engine(_to_async_url(sql_url), echo=False, pool_pre_ping=True)
    since = datetime.now(timezone.utc) - timedelta(days=days)

    try:
        async with AsyncSession(async_engine, expire_on_commit=False) as db_session:
            rows = (
                await db_session.execute(
                    select(NudgeSend.nudge_id, NudgeSend.status, func.count())
                    .where(NudgeSend.claimed_at >= since)
                    .group_by(NudgeSend.nudge_id, NudgeSend.status)
                    .order_by(NudgeSend.nudge_id)
                )
            ).all()
    finally:
        await async_engine.dispose()

    if not rows:
        print(f"No nudge activity in the last {days} days.")
        return

    print(f"Nudge activity, last {days} days:")
    for nudge_id, status, count in rows:
        print(f"  {nudge_id:45} {status:10} {count}")
    # A row still in "claimed" means a process died between the ledger write
    # and the provider call — worth knowing about, never auto-retried.
    stuck = sum(count for _n, status, count in rows if status == "claimed")
    if stuck:
        print(f"\n  {stuck} row(s) stuck in 'claimed' — a run died mid-send.")


@cli.command(name="demo-sync")
def demo_sync():
    """
    Create or refresh the shared demo organization.

    Safe to run repeatedly — that is the point. The first run builds the demo
    from the bundle; every run after it puts back whatever a visitor changed
    and writes nothing if nothing changed.

    The in-app scheduler calls the same code on an interval. This command is
    for operators who would rather drive it from their own cron (set
    LEARNHOUSE_DEMO_NO_SCHEDULER) or want to force a refresh now.
    """
    asyncio.run(_demo_sync())


async def _demo_sync() -> None:
    from src.services.demo.sync import sync_demo

    learnhouse_config = get_learnhouse_config()
    sql_url = learnhouse_config.database_config.sql_connection_string  # type: ignore
    async_engine = create_async_engine(_to_async_url(sql_url), echo=False, pool_pre_ping=True)

    try:
        async with AsyncSession(async_engine, expire_on_commit=False) as db_session:
            stats = await sync_demo(db_session)
    finally:
        await async_engine.dispose()

    action = "provisioned" if stats.provisioned else "refreshed"
    print(f"Demo {action} (epoch {stats.epoch})")
    print(f"  created:       {stats.created}")
    print(f"  updated:       {stats.updated}")
    print(f"  drift removed: {stats.drift_deleted}")
    if not stats.created and not stats.updated and not stats.drift_deleted:
        print("  nothing to do — the demo already matches the bundle")


@cli.command(name="demo-status")
def demo_status():
    """Show the demo organization's state and what it currently contains."""
    asyncio.run(_demo_status())


async def _demo_status() -> None:
    from sqlalchemy import func, select

    from src.db.demo_entities import DemoEntity
    from src.db.demo_state import DEMO_STATE_ID, DemoState
    from src.db.organizations import Organization

    learnhouse_config = get_learnhouse_config()
    sql_url = learnhouse_config.database_config.sql_connection_string  # type: ignore
    async_engine = create_async_engine(_to_async_url(sql_url), echo=False, pool_pre_ping=True)

    try:
        async with AsyncSession(async_engine, expire_on_commit=False) as db_session:
            state = (
                await db_session.execute(
                    select(DemoState).where(DemoState.id == DEMO_STATE_ID)
                )
            ).scalars().first()
            if state is None:
                print("No demo organization has been created yet.")
                print("Run: uv run python cli.py demo-sync")
                return

            org = None
            if state.org_id:
                org = (
                    await db_session.execute(
                        select(Organization).where(Organization.id == state.org_id)
                    )
                ).scalars().first()

            print(f"State:          {state.state}")
            print(f"Bundle version: {state.bundle_version}")
            print(f"Content epoch:  {state.content_epoch}")
            print(f"Last refresh:   {state.last_refresh_at}")
            if state.last_error:
                print(f"Last error:     {state.last_error}")
            if org is not None:
                print(f"Organization:   {org.name} (/{org.slug}, id={org.id})")

            rows = (
                await db_session.execute(
                    select(DemoEntity.kind, func.count())
                    .group_by(DemoEntity.kind)
                    .order_by(DemoEntity.kind)
                )
            ).all()
            if rows:
                print("\nRegistered rows:")
                for kind, count in rows:
                    print(f"  {kind:18} {count}")
    finally:
        await async_engine.dispose()


@cli.command(name="demo-teardown")
def demo_teardown(
    yes: Annotated[bool, typer.Option("--yes", help="Skip the confirmation")] = False,
):
    """
    Delete the demo organization, its students, its files and its state.

    Everything it owns goes with the organization via cascade; the fake student
    accounts, their uploaded files and the authorship rows that reference
    content by a bare uuid are removed explicitly, because none of those are
    org-owned rows the cascade can reach.
    """
    if not yes:
        typer.confirm(
            "Delete the demo organization and all forty demo student accounts?",
            abort=True,
        )
    asyncio.run(_demo_teardown())


async def _demo_teardown() -> None:
    from src.services.demo.teardown import teardown_demo

    learnhouse_config = get_learnhouse_config()
    sql_url = learnhouse_config.database_config.sql_connection_string  # type: ignore
    async_engine = create_async_engine(_to_async_url(sql_url), echo=False, pool_pre_ping=True)

    try:
        async with AsyncSession(async_engine, expire_on_commit=False) as db_session:
            removed = await teardown_demo(db_session)
            await db_session.commit()

            for line in removed:
                print(line)
            if not removed:
                print("No demo organization found.")
    finally:
        await async_engine.dispose()


@cli.command()
def main():
    cli()


if __name__ == "__main__":
    cli()
