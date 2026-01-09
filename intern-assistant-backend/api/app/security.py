from datetime import datetime, timedelta
from jose import jwt
from passlib.context import CryptContext
from .config import JWT_SECRET, JWT_ALG, JWT_EXP_MINUTES

# -------------------------------------------------------------------
# Password hashing (bcrypt)
# -------------------------------------------------------------------
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def hash_password(password: str) -> str:
    """Parolayı bcrypt ile hashle."""
    return pwd_context.hash(password)


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Parola doğru mu kontrol et."""
    return pwd_context.verify(plain_password, hashed_password)


# -------------------------------------------------------------------
# JWT token
# -------------------------------------------------------------------
def create_access_token(data: dict) -> str:
    """Kullanıcı bilgileri ile JWT üret."""
    to_encode = data.copy()
    expire = datetime.utcnow() + timedelta(minutes=JWT_EXP_MINUTES)
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, JWT_SECRET, algorithm=JWT_ALG)
    return encoded_jwt
