import html
from urllib.parse import quote

from pydantic import EmailStr
from src.db.organizations import OrganizationRead
from src.db.users import UserRead
from src.services.email.utils import send_email


def send_account_creation_email(
    user: UserRead,
    email: EmailStr,
):
    safe_username = html.escape(user.username)
    return send_email(
        to=email,
        subject=f"Welcome to LearnHouse, {safe_username}!",
        body=f"""
<html>
    <body>
        <p>Hello {safe_username}</p>
        <p>Welcome to LearnHouse! , get started by creating your own organization or join a one.</p>
        <p>Need some help to get started ? <a href="https://university.learnhouse.io">LearnHouse Academy</a></p>
    </body>
</html>
""",
    )


def send_password_reset_email(
    generated_reset_code: str,
    user: UserRead,
    organization: OrganizationRead,
    email: EmailStr,
    base_url: str,
):
    safe_username = html.escape(user.username)
    safe_code = html.escape(generated_reset_code)
    safe_email = quote(str(email), safe='')
    safe_code_param = quote(generated_reset_code, safe='')

    return send_email(
        to=email,
        subject="Reset your password",
        body=f"""
<html>
    <body>
        <p>Hello {safe_username}</p>
        <p>You have requested to reset your password.</p>
        <p>Here is your reset code: {safe_code}</p>
        <p>Click <a href="{base_url}/reset?email={safe_email}&amp;resetCode={safe_code_param}">here</a> to reset your password.</p>
    </body>
</html>
""",
    )


def send_email_verification_email(
    token: str,
    user: UserRead,
    organization: OrganizationRead,
    email: EmailStr,
    base_url: str,
):
    """
    Send email verification email with verification link.

    Args:
        token: Verification token
        user: User receiving the email
        organization: Organization context
        email: Email address to send to
        base_url: Base URL for constructing the verification link

    Returns:
        Boolean indicating if email was sent successfully
    """
    safe_username = html.escape(user.username)
    safe_token = quote(token, safe='')
    safe_user_uuid = quote(user.user_uuid, safe='')
    safe_org_uuid = quote(organization.org_uuid, safe='')
    verification_url = f"{base_url}/verify-email?token={safe_token}&amp;user={safe_user_uuid}&amp;org={safe_org_uuid}"

    return send_email(
        to=email,
        subject="Verify your email address",
        body=f"""
<html>
    <body>
        <p>Hello {safe_username},</p>
        <p>Welcome to LearnHouse! Please verify your email address to complete your registration.</p>
        <p>Click <a href="{verification_url}">here</a> to verify your email address.</p>
        <p>Or copy and paste this link into your browser:</p>
        <p>{verification_url}</p>
        <p>This link will expire in 24 hours.</p>
        <p>If you didn't create an account with LearnHouse, you can safely ignore this email.</p>
    </body>
</html>
""",
    )
