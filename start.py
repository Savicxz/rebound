"""Start the local demo: python start.py [--check] [--no-browser]."""

import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
import webbrowser

ROOT = Path(__file__).resolve().parent
PYTHON = ROOT / ".venv" / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
WEB = ROOT / "apps/web"
LOGS = ROOT / ".logs"
IMPORT_CHECK = "import fastapi, uvicorn, pydantic_settings, sqlalchemy, aiosqlite, httpx, jwt, bcrypt, greenlet; from google import genai"


def run(command, cwd=ROOT):
    subprocess.run(command, cwd=cwd, check=True)


def port_available(port):
    try:
        with socket.create_connection(("127.0.0.1", port), timeout=0.5):
            return False
    except OSError:
        return True


def wait_ready(name, url, process, timeout=60, check=None):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise RuntimeError(f"{name} exited early. See {LOGS}.")
        try:
            with urllib.request.urlopen(url, timeout=2) as response:
                if response.status == 200 and (check is None or check(response)):
                    print(f"  Ready: {name}", flush=True)
                    return
        except (OSError, urllib.error.URLError):
            pass
        time.sleep(0.5)
    raise RuntimeError(f"{name} did not become ready at {url}. See {LOGS}.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--check",
        action="store_true",
        help="Check prerequisites without installing or starting services",
    )
    parser.add_argument(
        "--no-browser",
        action="store_true",
        help="Do not open the dashboard automatically",
    )
    args = parser.parse_args()
    print("Checking local demo prerequisites...", flush=True)
    npm = shutil.which("npm.cmd" if os.name == "nt" else "npm")
    if not npm or not shutil.which("node"):
        raise RuntimeError(
            "Node.js and npm are required. Install Node.js, then reopen your terminal."
        )
    node_major = int(
        subprocess.check_output(
            ["node", "-p", 'process.versions.node.split(".")[0]'], text=True
        ).strip()
    )
    if node_major < 18:
        raise RuntimeError("Node.js 18 or newer is required.")
    if not PYTHON.exists():
        if args.check:
            raise RuntimeError(
                "Missing .venv. Run python start.py to set up dependencies."
            )
        print("Creating Python virtual environment...", flush=True)
        run([sys.executable, "-m", "venv", str(ROOT / ".venv")])
    imports = subprocess.run(
        [str(PYTHON), "-c", IMPORT_CHECK], cwd=ROOT, capture_output=True
    )
    if imports.returncode:
        if args.check:
            raise RuntimeError(
                "Python dependencies are missing. Run python start.py to install them."
            )
        print("Installing Python dependencies...", flush=True)
        run([str(PYTHON), "-m", "pip", "install", "-r", "requirements.txt"])
        run([str(PYTHON), "-c", IMPORT_CHECK])
    if not (ROOT / ".env").exists():
        if args.check:
            raise RuntimeError(
                "Missing .env. Run python start.py to create it from .env.example."
            )
        shutil.copyfile(ROOT / ".env.example", ROOT / ".env")
        print("Created .env from the demo template.", flush=True)
    if not (WEB / "node_modules/next/package.json").exists():
        if args.check:
            raise RuntimeError(
                "Frontend dependencies are missing. Run python start.py to install them."
            )
        print("Installing frontend dependencies...", flush=True)
        run([npm, "ci"], cwd=WEB)

    # Read configuration with the same .env parser used by the application.
    environment = os.environ.copy()
    values = json.loads(
        subprocess.check_output(
            [
                str(PYTHON),
                "-c",
                'import json; from dotenv import dotenv_values; print(json.dumps(dotenv_values(".env")))',
            ],
            cwd=ROOT,
            text=True,
        )
    )
    for key, value in values.items():
        if value is not None:
            environment.setdefault(key, value)
    # Frontend's API rewrite and development command currently use fixed ports.
    expected = {
        "APP_PORT": "8000",
        "WEB_PORT": "3000",
        "RUNNER_CONTROL_PORT": "5005",
        "RUNNER_DEMO_PORT": "5006",
    }
    for key, value in expected.items():
        if environment.get(key, value) != value:
            raise RuntimeError(
                f"This local launcher requires {key}={value}. Update your local configuration."
            )
    busy = [port for port in (3000, 8000, 5005, 5006) if not port_available(port)]
    if busy:
        raise RuntimeError(
            f"Ports already in use: {', '.join(map(str, busy))}. Stop the existing demo terminals first; no existing processes were stopped."
        )
    print(
        "Checks passed: Python dependencies, Node.js, frontend dependencies, .env and ports.",
        flush=True,
    )
    if args.check:
        return

    environment["PYTHONUNBUFFERED"] = "1"
    environment["PYTHONPATH"] = (
        str(ROOT) + os.pathsep + environment.get("PYTHONPATH", "")
    )
    LOGS.mkdir(exist_ok=True)
    processes = []
    handles = []

    def start(name, command, cwd=ROOT):
        log = (LOGS / f"{name}.log").open("w", encoding="utf-8")
        handles.append(log)
        process = subprocess.Popen(
            command,
            cwd=cwd,
            env=environment,
            stdout=log,
            stderr=subprocess.STDOUT,
            creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
            start_new_session=os.name != "nt",
        )
        processes.append((name, process))
        print(f"Starting {name} (log: .logs/{name}.log)...", flush=True)
        return process

    try:
        runner = start(
            "sandbox", [str(PYTHON), "-m", "services.sandbox_runner.supervisor"]
        )
        wait_ready("sandbox", "http://127.0.0.1:5006/health", runner)
        api = start(
            "api",
            [
                str(PYTHON),
                "-m",
                "uvicorn",
                "services.api.main:app",
                "--host",
                "127.0.0.1",
                "--port",
                "8000",
            ],
        )
        wait_ready("API", "http://127.0.0.1:8000/api/v1/health", api)
        monitor_started = datetime.now(timezone.utc)
        monitor = start(
            "monitor", [str(PYTHON), "-m", "services.monitor_worker.worker"]
        )

        def monitor_has_probed(response):
            return any(
                service.get("last_checked_at")
                and datetime.fromisoformat(
                    service["last_checked_at"].replace("Z", "+00:00")
                ).replace(tzinfo=timezone.utc)
                >= monitor_started
                for service in json.load(response)
            )

        wait_ready(
            "monitor health checks",
            "http://127.0.0.1:8000/api/v1/services",
            monitor,
            check=monitor_has_probed,
        )
        web = start("web", [npm, "run", "dev"], cwd=WEB)
        wait_ready("dashboard", "http://127.0.0.1:3000", web, timeout=120)
        print(
            "\nRebound is ready: http://localhost:3000\nKeep this terminal open. Press Ctrl+C to stop all services.",
            flush=True,
        )
        if not args.no_browser:
            webbrowser.open("http://localhost:3000")
        while True:
            for name, process in processes:
                if process.poll() is not None:
                    raise RuntimeError(
                        f"{name} stopped unexpectedly. See .logs/{name}.log."
                    )
            time.sleep(1)
    except KeyboardInterrupt:
        print("\nStopping demo services...", flush=True)
    finally:
        for name, process in reversed(processes):
            if os.name == "nt":
                subprocess.run(
                    ["taskkill", "/PID", str(process.pid), "/T", "/F"],
                    capture_output=True,
                )
            elif process.poll() is None:
                import signal

                os.killpg(process.pid, signal.SIGTERM)
            try:
                process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                process.kill()
        for log in handles:
            log.close()


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, subprocess.CalledProcessError, OSError, ValueError) as error:
        print(f"\nStartup failed: {error}", file=sys.stderr)
        sys.exit(1)
