"""Fixtures for the HTTP layer.

Each test gets its own app built around its own AppContext, so a test says what
the database path, broker and threads are instead of reassigning globals on a
shared module.
"""
import pytest

from theta.api import create_app
from theta.context import AppContext


@pytest.fixture
def db_path(tmp_path):
    return str(tmp_path / "app.db")


@pytest.fixture
def context(db_path):
    """The context the default client is built from; tests may read it back."""
    return AppContext(db_path=db_path)


@pytest.fixture
def client(context):
    return create_app(context).test_client()


@pytest.fixture
def make_client(db_path):
    """Build a client with a context of your own. Keyword arguments go to AppContext."""
    def build(**kwargs):
        kwargs.setdefault("db_path", db_path)
        return create_app(AppContext(**kwargs)).test_client()
    return build
