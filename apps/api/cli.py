import random
import string
from typing import Annotated
from pydantic import EmailStr
from sqlalchemy import create_engine
from sqlmodel import SQLModel, Session
import typer
from config.config import get_learnhouse_config
from src.db.organizations import OrganizationCreate
from src.db.users import UserCreate
from src.services.install.install import (
    install_create_organization,
    install_create_organization_user,
    install_default_elements,
)

cli = typer.Typer()

def generate_password(length):
    characters = string.ascii_uppercase + string.ascii_lowercase + string.digits
    password = ''.join(random.choice(characters) for _ in range(length))
    return password

@cli.command()
def install(
    short: Annotated[bool, typer.Option(help="Install with predefined values")] = False
):
    # Get the database session
    learnhouse_config = get_learnhouse_config()
    engine = create_engine(
        learnhouse_config.database_config.sql_connection_string, echo=False, pool_pre_ping=True  # type: ignore
    )
    SQLModel.metadata.create_all(engine)

    db_session = Session(engine)

    if short:
        # Install the default elements
        print("Installing default elements...")
        install_default_elements(db_session)
        print("Default elements installed ✅")

        # Create the Organization
        print("Creating default organization...")
        org = OrganizationCreate(
            name="Default Organization",
            description="Default Organization",
            slug="default",
            email="",
            logo_image="",
        )
        install_create_organization(org, db_session)
        print("Default organization created ✅")

        # Create Organization User
        print("Creating default organization user...")
        # Generate random 6 digit password
        email = "admin@school.dev"
        password = generate_password(8)
        user = UserCreate(
            username="admin", email=EmailStr(email), password=password
        )
        install_create_organization_user(user, "default", db_session)
        print("Default organization user created ✅")

        # Show the user how to login
        print("Installation completed ✅")
        print("")
        print("Login with the following credentials:")
        print("email: " + email)
        print("password: " + password)
        print("⚠️ Remember to change the password after logging in ⚠️")

    else:
        # Install the default elements
        print("Installing default elements...")
        install_default_elements(db_session)
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
        )
        install_create_organization(org, db_session)
        print(orgname + " Organization created ✅")

        # Create Organization User
        print("Creating your organization user...")
        username = typer.prompt("What's the username for the user?")
        email = typer.prompt("What's the email for the user?")
        password = typer.prompt("What's the password for the user?", hide_input=True)
        user = UserCreate(username=username, email=EmailStr(email), password=password)
        install_create_organization_user(user, slug, db_session)
        print(username + " user created ✅")

        # Show the user how to login
        print("Installation completed ✅")
        print("")
        print("Login with the following credentials:")
        print("email: " + email)
        print("password: The password you entered")




@cli.command()
def main():
    cli()


if __name__ == "__main__":
    cli()
