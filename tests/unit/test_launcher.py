from unittest.mock import Mock, patch

import pytest

import start as launcher


@pytest.fixture(autouse=True)
def use_launcher_default_ports(monkeypatch):
    monkeypatch.setenv("RUNNER_CONTROL_PORT", "5005")
    monkeypatch.setenv("RUNNER_DEMO_PORT", "5006")


def test_occupied_port_is_detected():
    import socket

    with socket.socket() as server:
        server.bind(("127.0.0.1", 0))
        server.listen()
        assert not launcher.port_available(server.getsockname()[1])


def test_readiness_requires_worker_evidence():
    response = Mock(status=200)
    response.__enter__ = Mock(return_value=response)
    response.__exit__ = Mock(return_value=False)
    predicate = Mock(side_effect=[False, True])
    with (
        patch.object(launcher.urllib.request, "urlopen", return_value=response),
        patch.object(launcher.time, "sleep"),
    ):
        launcher.wait_ready(
            "monitor",
            "http://localhost/health",
            Mock(poll=lambda: None),
            check=predicate,
        )
    assert predicate.call_count == 2


def test_early_exit_does_not_report_ready():
    with pytest.raises(RuntimeError, match="exited early"):
        launcher.wait_ready("API", "http://localhost/health", Mock(poll=lambda: 1))


@pytest.mark.parametrize("occupied", [False, True])
def test_check_only_never_starts_services(monkeypatch, occupied):
    monkeypatch.setattr(launcher.sys, "argv", ["start.py", "--check"])
    monkeypatch.setattr(launcher.shutil, "which", lambda name: name)
    monkeypatch.setattr(launcher.Path, "exists", lambda path: True)
    monkeypatch.setattr(launcher, "port_available", lambda port: not occupied)
    monkeypatch.setattr(
        launcher.subprocess,
        "check_output",
        lambda command, **kw: "24" if command[0] == "node" else "{}",
    )
    monkeypatch.setattr(
        launcher.subprocess, "run", Mock(return_value=Mock(returncode=0))
    )
    popen = Mock()
    monkeypatch.setattr(launcher.subprocess, "Popen", popen)
    if occupied:
        with pytest.raises(RuntimeError, match="Ports already in use"):
            launcher.main()
    else:
        launcher.main()
    popen.assert_not_called()


def test_failed_start_stops_only_launched_process(monkeypatch, tmp_path):
    monkeypatch.setattr(launcher.sys, "argv", ["start.py", "--no-browser"])
    monkeypatch.setattr(launcher.shutil, "which", lambda name: name)
    monkeypatch.setattr(launcher.Path, "exists", lambda path: True)
    monkeypatch.setattr(launcher, "port_available", lambda port: True)
    monkeypatch.setattr(launcher, "LOGS", tmp_path / "logs")
    monkeypatch.setattr(
        launcher.subprocess,
        "check_output",
        lambda command, **kw: "24" if command[0] == "node" else "{}",
    )
    run = Mock(return_value=Mock(returncode=0))
    monkeypatch.setattr(launcher.subprocess, "run", run)
    process = Mock(pid=12345)
    monkeypatch.setattr(launcher.subprocess, "Popen", Mock(return_value=process))
    monkeypatch.setattr(
        launcher, "wait_ready", Mock(side_effect=RuntimeError("not ready"))
    )
    with pytest.raises(RuntimeError, match="not ready"):
        launcher.main()
    process.wait.assert_called_once()
    if launcher.os.name == "nt":
        assert any(
            call.args[0] == ["taskkill", "/PID", "12345", "/T", "/F"]
            for call in run.call_args_list
        )
