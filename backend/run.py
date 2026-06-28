"""Development entrypoint. Run with: python run.py"""
import logging

from app import create_app

app = create_app()

if __name__ == "__main__":
    log = logging.getLogger("savesmart")
    log.info("Starting SaveSmart API on http://127.0.0.1:5000")
    log.info("Watching for requests — logs stream below and to backend/logs/savesmart.log")
    # use_reloader stays on for dev; logging is reconfigured cleanly per reload.
    app.run(host="127.0.0.1", port=5000, debug=True)
