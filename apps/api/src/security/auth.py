from typing import Optional, Union
from sqlmodel import Session
from src.core.events.database import get_db_session
from src.db.users import AnonymousUser, APITokenUser, PublicUser, User, UserRead
from src.services.users.users import security_get_user
from config.config import get_learnhouse_config
from pydantic import BaseModel
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from datetime import datetime, timedelta, timezone
from src.services.dev.dev import isDevModeEnabled
from src.services.users.users import security_verify_password
from src.security.security import ALGORITHM, SECRET_KEY
from fastapi_jwt_auth2 import AuthJWT

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login")


#### JWT Auth ####################################################
class Settings(BaseModel):
    authjwt_secret_key: str = "secret" if isDevModeEnabled() else SECRET_KEY
    authjwt_token_location: set[str] = {"cookies", "headers"}
    authjwt_cookie_csrf_protect: bool = False
    authjwt_access_token_expires: bool | float = (
        False if isDevModeEnabled() else timedelta(hours=8).total_seconds()
    )
    authjwt_cookie_samesite: str = "lax"
    authjwt_cookie_secure: bool = True
    authjwt_cookie_domain: str = get_learnhouse_config().hosting_config.cookie_config.domain


@AuthJWT.load_config  # type: ignore
def get_config():
    return Settings()


#### JWT Auth ####################################################


#### Classes ####################################################


class Token(BaseModel):
    access_token: str
    token_type: str


class TokenData(BaseModel):
    username: str | None = None


#### Classes ####################################################
async def authenticate_user(
    request: Request,
    email: str,
    password: str,
    db_session: Session,
) -> User | bool:
    user = await security_get_user(request, db_session, email)
    if not user:
        return False
    if not security_verify_password(password, user.password):
        return False
    return user


def create_access_token(data: dict, expires_delta: timedelta | None = None):
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.now(timezone.utc) + expires_delta
    else:
        expire = datetime.now(timezone.utc) + timedelta(minutes=15)
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt


async def get_current_user(
    request: Request,
    db_session: Session = Depends(get_db_session),
) -> Union[PublicUser, APITokenUser, AnonymousUser]:
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )

    # Step 1: Check for API token (Bearer lh_...)
    auth_header = request.headers.get("Authorization", "").strip()

    # Case-insensitive check for "Bearer " prefix with lh_ token
    if auth_header.lower().startswith("bearer lh_"):
        token = auth_header[7:].strip()  # Remove "Bearer " prefix and trim
        api_token_user = await validate_api_token(token, db_session)
        if api_token_user:
            request.state.user = api_token_user
            request.state.is_api_token = True
            return api_token_user
        raise credentials_exception

    # Step 2: Fall back to existing JWT logic
    # Create AuthJWT instance manually to avoid auto-validation issues with API tokens
    Authorize = AuthJWT(request)
    try:
        Authorize.jwt_optional()
        username = Authorize.get_jwt_subject() or None
        token_data = TokenData(username=username)  # type: ignore
    except JWTError:
        raise credentials_exception
    except Exception as e:
        # Handle cases where the Authorization header format is unexpected
        print(f"[DEBUG AUTH] JWT parsing error: {e}")
        raise credentials_exception

    if username:
        user = await security_get_user(request, db_session, email=token_data.username)  # type: ignore # treated as an email
        if user is None:
            raise credentials_exception
        public_user = PublicUser(**user.model_dump())
        request.state.user = public_user
        request.state.is_api_token = False
        return public_user
    else:
        return AnonymousUser()


async def non_public_endpoint(current_user: UserRead | AnonymousUser):
    if isinstance(current_user, AnonymousUser):
        raise HTTPException(status_code=401, detail="Not authenticated")


async def validate_api_token(
    token: str,
    db_session: Session,
) -> Optional[APITokenUser]:
    """
    Validate an API token and return an APITokenUser if valid.

    Args:
        token: The full token string (lh_...)
        db_session: Database session

    Returns:
        APITokenUser if valid, None otherwise
    """
    from src.services.api_tokens.api_tokens import validate_api_token_for_auth

    # Validate the token using the service
    api_token = await validate_api_token_for_auth(token, db_session)

    if not api_token:
        return None

    # Create and return an APITokenUser
    return APITokenUser(
        id=api_token.id,
        user_uuid=api_token.token_uuid,
        username=f"api_token_{api_token.name}",
        org_id=api_token.org_id,
        rights=api_token.rights,
        token_name=api_token.name,
        created_by_user_id=api_token.created_by_user_id,
    )
