from sqlmodel import Session
from src.core.events.database import get_db_session
from src.db.users import AnonymousUser, PublicUser, User, UserRead
from src.services.users.users import security_get_user
from config.config import get_learnhouse_config
from pydantic import BaseModel
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from datetime import datetime, timedelta
from src.services.dev.dev import isDevModeEnabled
from src.services.users.users import security_verify_password
from src.security.security import ALGORITHM, SECRET_KEY
from fastapi_jwt_auth import AuthJWT

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login")


#### JWT Auth ####################################################
class Settings(BaseModel):
    authjwt_secret_key: str = "secret" if isDevModeEnabled() else SECRET_KEY
    authjwt_token_location = {"cookies", "headers"}
    authjwt_cookie_csrf_protect = False
    authjwt_access_token_expires = (
        False if isDevModeEnabled() else timedelta(hours=8).total_seconds()
    )
    authjwt_cookie_samesite = "lax"
    authjwt_cookie_secure = True
    authjwt_cookie_domain = get_learnhouse_config().hosting_config.cookie_config.domain


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
    ##comment added by ARUN
    print("authenticate_user function implementation")
    user = await security_get_user(request, db_session, email)
    ##comment added by ARUN
    print("authenticate_user 2222")
    if not user:
        ##comment added by ARUN
        print("authenticate_user function false")
        return False
    if not security_verify_password(password, user.password):
        ##comment added by ARUN
        print("authenticate_user function 3333")
        return False
    return user


def create_access_token(data: dict, expires_delta: timedelta | None = None):
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(minutes=15)
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt


async def get_current_user(
    request: Request,
    Authorize: AuthJWT = Depends(),
    db_session: Session = Depends(get_db_session),
):
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )

    try:
        Authorize.jwt_optional()
        username = Authorize.get_jwt_subject() or None
        token_data = TokenData(username=username)  # type: ignore
    except JWTError:
        raise credentials_exception
    if username:
        user = await security_get_user(request, db_session, email=token_data.username)  # type: ignore # treated as an email
        if user is None:
            raise credentials_exception
        return PublicUser(**user.model_dump())
    else:
        return AnonymousUser()


async def non_public_endpoint(current_user: UserRead | AnonymousUser):
    if isinstance(current_user, AnonymousUser):
        raise HTTPException(status_code=401, detail="Not authenticated")
