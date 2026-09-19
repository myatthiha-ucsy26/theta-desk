"""Start the desk: load .env, start the background threads, serve the app.

    python -m theta

Importing theta.api never starts a thread, so the tests get an app without one.
The threads belong to running the server, so they are started here.
"""
import os

from theta import config, paths


def main():
    loaded = config.load_env_file(os.path.join(paths.ROOT, ".env"))
    if loaded:
        print(f"Loaded from .env: {', '.join(loaded)}")

    # Imported after .env so modules reading the environment at import time
    # (OpenD host and port, the database path) see the file's values.
    from theta import services
    from theta.api import create_app
    from theta.broker.client import Broker
    from theta.context import AppContext
    from theta.engine import monitor as monitor_mod
    from theta.engine import runner as runner_mod

    context = AppContext(broker=Broker())

    # Create the database and put it in WAL mode before anything else opens it.
    # Two threads reaching a missing file at once both try to set the journal
    # mode, and the second one loses with "database is locked".
    context.connect().close()

    context.runner = runner_mod.Runner(
        context.db_path,
        services.engine_services(context, services.history),
        load_history=services.history,
    )
    context.runner.start()
    print("Engine started; it scans only while engine_enabled is true.")

    context.monitor = monitor_mod.Monitor(context.db_path, services.bot_services(context))
    context.monitor.start()
    print("Bot monitor started; it trades only while mode is 'auto'.")

    port = int(os.environ.get("PORT", "5057"))
    print(f"Desk on http://127.0.0.1:{port}")
    create_app(context).run(host="127.0.0.1", port=port, debug=False)


if __name__ == "__main__":
    main()
