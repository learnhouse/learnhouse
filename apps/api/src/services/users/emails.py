from pydantic import EmailStr
from src.db.organizations import OrganizationRead
from src.db.users import UserRead
from src.services.email.utils import send_email


def send_account_creation_email(
    user: UserRead,
    email: EmailStr,
):
    # send email
    return send_email(
        to=email,
        subject=f"Welcome to LearnHouse, {user.username}!",
        body=f"""
<html>
    <body>
        <p>Hello {user.username}</p>
        <p>Welcome to LearnHouse! , get started by creating your own organization or join a one.</p>
        <p>Need some help to get started ? <a href="https://learn.learnhouse.io">LearnHouse Academy</a></p>
    </body>
</html>
""",
    )


def send_password_reset_email(
    generated_reset_code: str,
    user: UserRead,
    organization: OrganizationRead,
    email: EmailStr,
):
    
    # send email
    return send_email(
        to=email,
        subject="Reset your password",
        body=f"""
<html>
    <body>
        <p>Hello {user.username}</p>
        <p>Click <a href="https://{organization.slug}.learnhouse.io/reset?email={email}&resetCode={generated_reset_code}">here</a> to reset your password.</p>
    </body>
</html>
""",
    )
