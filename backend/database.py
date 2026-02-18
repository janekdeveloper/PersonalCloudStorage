from __future__ import annotations

import os
from typing import Generator

from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base, sessionmaker, Session


DATABASE_URL = "sqlite:///./app.db"

engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False},
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()


def get_db() -> Generator[Session, None, None]:
    """
    FastAPI dependency that provides a SQLAlchemy session and
    guarantees that it will be closed after the request.
    """
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db() -> None:
    """
    Initialize the database schema and ensure that the first admin user exists.
    The initial credentials are taken from environment variables:

    - CLOUD_ADMIN_USERNAME (default: "admin")
    - CLOUD_ADMIN_PASSWORD (default: "admin")
    """
    # Import models here to avoid circular imports
    from . import models  # noqa: F401
    from .auth import get_password_hash

    Base.metadata.create_all(bind=engine)

    db = SessionLocal()
    try:
        from .models import User

        admin_username = os.getenv("CLOUD_ADMIN_USERNAME", "admin")
        admin_password = os.getenv("CLOUD_ADMIN_PASSWORD", "admin")

        existing = db.query(User).filter(User.username == admin_username).first()
        if existing is None:
            user = User(
                username=admin_username,
                password_hash=get_password_hash(admin_password),
            )
            db.add(user)
            db.commit()
    finally:
        db.close()

