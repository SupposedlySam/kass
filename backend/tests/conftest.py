import pytest

from backend.services import dictionary, styles


@pytest.fixture(autouse=True)
def fresh_styles():
    """The styles and dictionary snapshots are process-wide; each test reads its own database."""
    styles.invalidate()
    dictionary.invalidate()
    yield
    styles.invalidate()
    dictionary.invalidate()
