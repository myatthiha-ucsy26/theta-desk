"""Serving the built frontend."""
import os

from flask import Blueprint, send_from_directory

from theta.context import ctx

bp = Blueprint("web", __name__)


@bp.route("/")
def index():
    dist = ctx().frontend_dist
    index_html = os.path.join(dist, "index.html")
    if not os.path.exists(index_html):
        return ("The UI has not been built. Run ./run.sh, or "
                "`npm ci && npm run build` in frontend/.", 503)
    return send_from_directory(dist, "index.html")


@bp.route("/assets/<path:filename>")
def frontend_assets(filename):
    return send_from_directory(os.path.join(ctx().frontend_dist, "assets"), filename)
