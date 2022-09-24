from pydantic import BaseModel
from fastapi import Depends, FastAPI, APIRouter, HTTPException, status
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from passlib.context import CryptContext
from jose import JWTError, jwt
from datetime import datetime, timedelta
from src.services.users import *
from fastapi import Cookie, FastAPI
from src.services.security import *
from fastapi_jwt_auth import AuthJWT
from fastapi_jwt_auth.exceptions import AuthJWTException

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login")

#### JWT Auth ####################################################
class Settings(BaseModel):
    authjwt_secret_key: str = "secret"
    authjwt_token_location = {"cookies", "headers"}
    authjwt_cookie_csrf_protect = False
    
@AuthJWT.load_config
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


async def authenticate_user(email: str, password: str):
    user = await security_get_user(email)
    if not user:
        return False
    if not await security_verify_password(password, user.password):
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

# DEPRECATED
async def get_current_user_old(token: str = Depends(oauth2_scheme)):
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        username: str = payload.get("sub")
        if username is None:
            raise credentials_exception
        token_data = TokenData(username=username)
    except JWTError:
        raise credentials_exception
    user = await security_get_user(email=token_data.username)
    if user is None:
        raise credentials_exception
    return PublicUser(**user.dict())


async def get_current_user(Authorize: AuthJWT = Depends()):
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    
    try:
        Authorize.jwt_required()
        username = Authorize.get_jwt_subject()
        token_data = TokenData(username=username)
    except JWTError:
        raise credentials_exception
    user = await security_get_user(email=token_data.username) # treated as an email
    if user is None:
        raise credentials_exception
    return PublicUser(**user.dict())
    
    