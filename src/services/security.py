from passlib.context import CryptContext
from jose import JWTError, jwt
from passlib.hash import pbkdf2_sha256

### 🔒 JWT ##############################################################

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

ACCESS_TOKEN_EXPIRE_MINUTES = 30
SECRET_KEY = "09d25e094faa6ca2556c818166b7a9563b93f7099f6f0f4caa6cf63b88e8d3e7"
ALGORITHM = "HS256"

### 🔒 JWT ##############################################################


### 🔒 Passwords Hashing ##############################################################

async def security_hash_password(password: str):
    return pbkdf2_sha256.hash(password)


async def security_verify_password(plain_password: str, hashed_password: str):
    return pbkdf2_sha256.verify(plain_password, hashed_password)

### 🔒 Passwords Hashing ##############################################################
