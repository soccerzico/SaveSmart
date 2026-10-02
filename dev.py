#!/usr/bin/env python3
"""Unified launcher for SaveSmart.

  python dev.py              # backend API + Vite dev server
  python dev.py backend      # backend API only (http://127.0.0.1:5000)
  python dev.py frontend     # Vite dev server only (http://localhost:5173)

Also available as `savesmart launch [backend|frontend]` via savesmart.cmd.

Output from each process is streamed live with a [backend] / [frontend] prefix.
Press Ctrl+C once to shut everything down cleanly.
"""
import argparse
import os
import subprocess
import sys
import threading
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent
BACKEND = ROOT / "backend"
FRONTEND = ROOT / "frontend"
IS_WINDOWS = os.name == "nt"

CYAN = "\033[36m"
MAGENTA = "\033[35m"
RESET = "\033[0m"

# Running processes as (name, Popen) so we can tear them all down together.
_procs = []


VENV = BACKEND / "venv"
VENV_BIN = VENV / ("Scripts" if IS_WINDOWS else "bin")


def backend_python() -> str:
    """Prefer the backend's virtualenv interpreter; fall back to this one."""
    venv = VENV_BIN / ("python.exe" if IS_WINDOWS else "python")
    if venv.exists():
        return str(venv)
    print(
        f"{MAGENTA}[dev]{RESET} backend/venv not found — using {sys.executable}.\n"
        f"      Set it up first: cd backend && python -m venv venv && "
        f"venv\\Scripts\\pip install -r requirements.txt"
    )
    return sys.executable


def _stream(proc, name, color):
    """Pump a child's combined stdout/stderr to our console, line-prefixed."""
    for line in iter(proc.stdout.readline, ""):
        sys.stdout.write(f"{color}[{name}]{RESET} {line}")
        sys.stdout.flush()


def start(name, args, cwd, color, env=None):
    flags = subprocess.CREATE_NEW_PROCESS_GROUP if IS_WINDOWS else 0
    proc = subprocess.Popen(
        args,
        cwd=str(cwd),
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
        env=env,
        creationflags=flags,
    )
    _procs.append((name, proc))
    threading.Thread(target=_stream, args=(proc, name, color), daemon=True).start()
    return proc


def terminate_all():
    for name, proc in _procs:
        if proc.poll() is not None:
            continue
        if IS_WINDOWS:
            # Kill the whole tree so vite's node child (and Flask's reloader
            # child) don't survive the parent.
            subprocess.run(
                ["taskkill", "/F", "/T", "/PID", str(proc.pid)],
                capture_output=True,
            )
        else:
            proc.terminate()


def main():
    parser = argparse.ArgumentParser(description="Boot the SaveSmart app.")
    parser.add_argument(
        "target",
        nargs="?",
        choices=["backend", "frontend"],
        help="Start only this half. Omit to start both.",
    )
    # Old flags from when backend-only was the default; both now mean "everything".
    parser.add_argument("--frontend", "--full", action="store_true", help=argparse.SUPPRESS)
    args = parser.parse_args()
    run_backend = args.target in (None, "backend")
    run_frontend = args.target in (None, "frontend")

    if IS_WINDOWS:
        # Enable ANSI escape handling in the Windows console.
        os.system("")

    env = os.environ.copy()
    env["PYTHONPATH"] = str(BACKEND)
    env["PYTHONUNBUFFERED"] = "1"  # so backend log lines flush immediately
    if VENV.exists():
        # Equivalent of activating the venv for the child processes.
        env["VIRTUAL_ENV"] = str(VENV)
        env["PATH"] = str(VENV_BIN) + os.pathsep + env.get("PATH", "")

    if run_backend:
        print(f"{CYAN}[dev]{RESET} Starting backend (http://127.0.0.1:5000)…")
        start("backend", [backend_python(), "run.py"], BACKEND, CYAN, env)

    if run_frontend:
        print(f"{MAGENTA}[dev]{RESET} Starting frontend (http://localhost:5173)…")
        # .cmd shims (npm) can't be launched directly by CreateProcess on
        # Windows, so go through cmd.exe there.
        npm = ["cmd", "/c", "npm", "run", "dev"] if IS_WINDOWS else ["npm", "run", "dev"]
        start("frontend", npm, FRONTEND, MAGENTA, env)

    try:
        # If any child dies, bring the rest down too.
        while True:
            for name, proc in _procs:
                code = proc.poll()
                if code is not None:
                    print(f"\n[dev] '{name}' exited (code {code}); shutting down.")
                    return
            time.sleep(0.3)
    except KeyboardInterrupt:
        print("\n[dev] Shutting down…")
    finally:
        terminate_all()


if __name__ == "__main__":
    main()
