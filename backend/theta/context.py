"""The mutable state one running server owns.

The database path, the broker client and the two background threads are the
only things a request handler needs that are not derived from the request
itself. They are gathered here and built once in create_app(), so a blueprint
asks the context for them and a test constructs a context instead of reaching
into a module and reassigning globals.
"""
import os
from dataclasses import dataclass, field
from typing import Any, Optional

from flask import current_app

from theta import credentials, paths
from theta.storage import db


@dataclass
class AppContext:
    """Everything a request handler needs that outlives the request."""

    db_path: str = field(default_factory=lambda: os.environ.get("CS_DB_PATH", db.DEFAULT_PATH))
    broker: Any = None
    runner: Optional[Any] = None
    monitor: Optional[Any] = None
    frontend_dist: str = paths.FRONTEND_DIST

    def connect(self):
        """A fresh connection for one request. The caller closes it."""
        conn = db.connect(self.db_path)
        db.init(conn)
        return conn

    def settings(self):
        conn = self.connect()
        try:
            return db.get_settings(conn)
        finally:
            conn.close()

    def credential_env(self):
        """os.environ with every credential saved in Settings laid over it.

        Read per call rather than cached, so a key set in the dashboard reaches
        the next alert or review without restarting the engine.
        """
        return credentials.env_with(os.environ, self.settings())


def ctx() -> AppContext:
    """The context of the app handling this request."""
    return current_app.extensions["theta"]
