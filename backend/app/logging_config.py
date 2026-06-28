"""Logging setup for the backend.

Logs go to two places so you can watch the app while it runs:
  * the console (stdout) — visible in the terminal running the server
  * backend/logs/savesmart.log — a rotating file for after-the-fact review

Every /api request is logged with its method, path, status, and duration.
Individual routes add semantic lines (e.g. "user registered") on top of that.
"""
import logging
import time
from logging.handlers import RotatingFileHandler
from pathlib import Path

from flask import g, request

LOG_DIR = Path(__file__).resolve().parent.parent / "logs"

_CONSOLE_FMT = logging.Formatter(
    "%(asctime)s %(levelname)-7s %(name)s | %(message)s", datefmt="%H:%M:%S"
)
_FILE_FMT = logging.Formatter(
    "%(asctime)s %(levelname)-7s %(name)s | %(message)s", datefmt="%Y-%m-%d %H:%M:%S"
)


def configure_logging(app) -> None:
    LOG_DIR.mkdir(exist_ok=True)
    level = logging.DEBUG if app.debug else logging.INFO

    console = logging.StreamHandler()
    console.setFormatter(_CONSOLE_FMT)

    file_handler = RotatingFileHandler(
        LOG_DIR / "savesmart.log", maxBytes=1_000_000, backupCount=3, encoding="utf-8"
    )
    file_handler.setFormatter(_FILE_FMT)

    root = logging.getLogger()
    root.setLevel(level)
    # Clear first so the reloader spawning a fresh process can't stack handlers.
    root.handlers.clear()
    root.addHandler(console)
    root.addHandler(file_handler)

    # Werkzeug logs its own per-request line; silence it since we log our own
    # cleaner version below (keep warnings/errors though).
    logging.getLogger("werkzeug").setLevel(logging.WARNING)

    @app.before_request
    def _start_timer():
        g._start = time.perf_counter()

    @app.after_request
    def _log_request(response):
        if request.path.startswith("/api"):
            elapsed_ms = (time.perf_counter() - getattr(g, "_start", time.perf_counter())) * 1000
            app.logger.info(
                "%s %s -> %s (%.1f ms)",
                request.method,
                request.path,
                response.status_code,
                elapsed_ms,
            )
        return response

    app.logger.info("Logging ready at %s level", logging.getLevelName(level))
