"""Load KEY=VALUE settings from a .env file into the environment. stdlib only.

Keeps credentials in one git-ignored file at the repo root instead of shell
profiles. Values already set in the environment always win, so any single run
can still be overridden from the shell.

Format: one KEY=VALUE per line; blank lines and lines starting with # are skipped;
an optional leading `export ` is allowed; matching single or double quotes around a
value are removed. Everything after the first `=` is the value, taken literally.
"""
import os


def parse_env(text):
    out = {}
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[len("export "):].lstrip()
        if "=" not in line:
            continue
        key, value = line.split("=", 1)
        key, value = key.strip(), value.strip()
        if not key:
            continue
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "'\"":
            value = value[1:-1]
        out[key] = value
    return out


def load_env_file(path, environ=None):
    """Set variables from `path` that are not already set. Returns the names it set."""
    environ = os.environ if environ is None else environ
    if not os.path.exists(path):
        return []
    with open(path) as f:
        pairs = parse_env(f.read())
    loaded = []
    for key, value in pairs.items():
        if key not in environ:
            environ[key] = value
            loaded.append(key)
    return loaded
