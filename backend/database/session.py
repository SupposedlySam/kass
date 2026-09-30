"""Engine creation, initialization, and session management."""

import logging

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from .. import config
from .models import Base
from .migrations import run_migrations

logger = logging.getLogger(__name__)

# Initialized by init_db()
engine = None
SessionLocal = None
_db_path = None


def init_db() -> None:
    """Initialize the database engine, run migrations, and create tables."""
    global engine, SessionLocal, _db_path

    _db_path = config.get_db_path()
    _db_path.parent.mkdir(parents=True, exist_ok=True)
    _rename_old_db(_db_path)

    engine = create_engine(
        f"sqlite:///{_db_path}",
        connect_args={"check_same_thread": False},
    )

    SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

    run_migrations(engine)
    Base.metadata.create_all(bind=engine)

    # The preset writing styles, with the global settings moved into the default.
    from ..services.styles import ensure_styles
    from ..services.writing_style import recount_if_stale

    with SessionLocal() as db:
        ensure_styles(db)
        recount_if_stale(db)


def _rename_old_db(db_path) -> None:
    """Herga was Voicebox, whose database was voicebox.db; carry it over once."""
    old = db_path.with_name("voicebox.db")
    if db_path.exists() or not old.exists():
        return
    # SQLite's journal files travel with the database they belong to.
    for suffix in ("-wal", "-shm"):
        journal = old.with_name(old.name + suffix)
        if journal.exists():
            journal.rename(db_path.with_name(db_path.name + suffix))
    old.rename(db_path)
    logger.info("Renamed %s to %s", old, db_path)


def get_db():
    """Yield a database session (FastAPI dependency)."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
