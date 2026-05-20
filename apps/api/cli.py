import asyncio
import os
from typing import Annotated
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
def main():
    cli()


if __name__ == "__main__":
    cli()
