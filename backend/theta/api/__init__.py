"""The Flask application factory.

create_app() builds the app, stores the AppContext the blueprints read through
`ctx()`, and registers one blueprint per group of endpoints. Nothing here holds
state of its own, so a test can build as many independent apps as it likes.
"""
from flask import Flask, jsonify, request

from theta.api.security import is_local_request
from theta.context import AppContext


def create_app(context=None):
    """Build the app. Pass a context to control the database, broker and threads."""
    from theta.api import bot, engine, paper, settings, signal, surfaces, web

    app = Flask(__name__)
    app.extensions["theta"] = context if context is not None else AppContext()

    @app.before_request
    def only_from_this_machine():
        """Refuse anything that did not address the desk as localhost.

        Listening on 127.0.0.1 keeps other machines out; this keeps out the web
        page that rebinds its own domain to the loopback address and then speaks
        to the desk as though it were the desk's own UI. See api.security.
        """
        if not is_local_request(request.headers.get("Host", "")):
            return jsonify({"error": "This desk only answers to localhost."}), 403
        return None

    for module in (signal, paper, settings, surfaces, engine, bot, web):
        app.register_blueprint(module.bp)
    return app
