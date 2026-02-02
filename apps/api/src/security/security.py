from passlib.context import CryptContext
from passlib.hash import pbkdf2_sha256
from config.config import get_learnhouse_config


### 🔒 JWT ##############################################################

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

ACCESS_TOKEN_EXPIRE_MINUTES = 30
SECRET_KEY = get_learnhouse_config().security_config.auth_jwt_secret_key
ALGORITHM = "HS256"

### 🔒 JWT ##############################################################


### 🔒 Passwords Hashing ##############################################################


def security_hash_password(password: str):
    return pbkdf2_sha256.hash(password)


def security_verify_password(plain_password: str, hashed_password: str):
    return pbkdf2_sha256.verify(plain_password, hashed_password)


### 🔒 Passwords Hashing ##############################################################


