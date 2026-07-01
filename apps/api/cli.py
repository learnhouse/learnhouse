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
def transcode_worker():
    """Run the HLS transcoding worker: drains the Redis queue and transcodes
    videos into adaptive-bitrate HLS. Meant to run as a dedicated process so
    heavy ffmpeg work never touches the API pods. Runs until interrupted.

    Handles SIGTERM (Kubernetes pod stop) and SIGINT for a clean shutdown."""
    import signal
    from src.services.utils.hls_jobs import run_worker

    async def _main():
        loop = asyncio.get_running_loop()
        task = asyncio.ensure_future(run_worker())
        for sig in (signal.SIGINT, signal.SIGTERM):
            try:
                loop.add_signal_handler(sig, task.cancel)
            except (NotImplementedError, ValueError):
                # add_signal_handler is unavailable on some platforms (e.g. Windows).
                pass
        try:
            await task
        except asyncio.CancelledError:
            pass

    try:
        asyncio.run(_main())
    except KeyboardInterrupt:
        pass
    print("HLS worker stopped.")


@cli.command()
def transcode_backfill(
    limit: Annotated[int, typer.Option(help="Max activities to process (0 = all)")] = 0,
):
    """Transcode existing hosted-video activities into HLS (skips ones already
    ready). Processes inline — run it where ffmpeg + storage creds are available."""
    from src.services.utils.hls_jobs import backfill
    result = asyncio.run(backfill(limit=limit))
    print(
        f"HLS backfill done. total={result['total']} "
        f"done={result['done']} failed={result['failed']}"
    )


@cli.command()
def main():
    cli()


if __name__ == "__main__":
    cli()
