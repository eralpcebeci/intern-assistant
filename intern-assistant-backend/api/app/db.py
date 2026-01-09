import os
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base

# -------------------------------------------------------------------
# Ayarlar
# -------------------------------------------------------------------
# ENV üzerinden DATABASE_URL gelirse onu kullan; yoksa local SQLite.
# Örn: postgresql://user:pass@localhost:5432/intern_assistant
DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./app.db")

# SQLite için thread ayarı
connect_args = {"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}

# Engine & Session
engine = create_engine(DATABASE_URL, echo=False, future=True, connect_args=connect_args)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine, future=True)

# Base sınıfı (modeller bunu extend eder)
Base = declarative_base()


# -------------------------------------------------------------------
# DB dependency (FastAPI)
# -------------------------------------------------------------------
def get_db():
    """
    Her istek için bağımsız bir Session üret ve işi bitince kapat.
    FastAPI Depends(get_db) ile kullanılır.
    """
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
