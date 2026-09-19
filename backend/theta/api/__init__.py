"""The Flask application factory.

create_app() builds the app, stores the AppContext the blueprints read through
`ctx()`, and registers one blueprint per group of endpoints. Nothing here holds
state of its own, so a test can build as many independent apps as it likes.
"""
from flask import Flask

from theta.context import AppContext


def create_app(context=None):
    """Build the app. Pass a context to control the database, broker and threads."""
    from theta.api import bot, engine, paper, settings, signal, surfaces, web

    app = Flask(__name__)
    app.extensions["theta"] = context if context is not None else AppContext()

    for module in (signal, paper, settings, surfaces, engine, bot, web):
        app.register_blueprint(module.bp)
    return app
