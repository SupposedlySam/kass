import pytest

from backend.services import styles


@pytest.fixture(autouse=True)
def fresh_styles():
    """The styles snapshot is process-wide; each test reads its own database."""
    styles.invalidate()
    yield
    styles.invalidate()
