"""Keeping the desk reachable only from this machine.

Binding to 127.0.0.1 stops other machines connecting, but it does not stop a web
page you happen to be visiting. A site can point its own domain at 127.0.0.1
(DNS rebinding); the browser then treats it as same-origin with the desk and can
both read the book and post to every endpoint -- switch the account to live,
raise the risk cap, close positions. There is no login to get past, because a
single-user local tool has none.

What distinguishes that request from a real one is the Host header: the browser
sends the attacker's domain, never `localhost`. So the Host is checked, and
anything else is refused before it reaches a handler.
"""
import os

# The names a browser or client can legitimately use to reach a desk bound to
# the loopback interface.
LOCAL_HOSTS = frozenset({"localhost", "127.0.0.1", "::1", "[::1]"})


def hostname_of(host_header):
    """The host without its port. `[::1]:5057` keeps its brackets; `` is ``."""
    if not host_header:
        return ""
    host = host_header.strip()
    if host.startswith("["):                      # bracketed IPv6, optionally with a port
        end = host.find("]")
        return host[: end + 1] if end != -1 else host
    if host.count(":") == 1:                      # host:port
        return host.rsplit(":", 1)[0]
    return host                                   # bare host, or unbracketed IPv6


def allowed_hosts(environ=None):
    """The hosts this desk answers to.

    THETA_ALLOWED_HOSTS adds names for anyone fronting the desk with a hostname
    of their own; it is additive, so loopback never stops working.
    """
    environ = os.environ if environ is None else environ
    extra = (environ.get("THETA_ALLOWED_HOSTS") or "").split(",")
    return LOCAL_HOSTS | {name.strip().lower() for name in extra if name.strip()}


def is_local_request(host_header, environ=None):
    return hostname_of(host_header).lower() in allowed_hosts(environ)
