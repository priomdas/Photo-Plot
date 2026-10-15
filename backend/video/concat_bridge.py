from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[2]
CONCAT_ROOT = ROOT / "Video edit" / "Video Edit"
PROJECTS_ROOT = ROOT / "jobs" / "concat_projects"
PROJECTS_ROOT.mkdir(parents=True, exist_ok=True)

ALLOWED_METHODS = {
    "version",
    "project.create",
    "project.open",
    "project.get",
    "project.document",
    "project.save",
    "project.close",
    "media.probe",
    "media.import",
    "catalogue.list",
    "template.list",
    "edit.apply",
    "edit.undo",
    "edit.redo",
    "export.run",
    "preview.frame",
}


def _candidate_paths() -> list[Path]:
    configured = os.environ.get("PHOTOPILOT_CONCAT_CLI", "").strip()
    candidates = [Path(configured)] if configured else []
    candidates.extend(
        [
            CONCAT_ROOT / "target" / "release" / "concat-cli.exe",
            CONCAT_ROOT / "target" / "debug" / "concat-cli.exe",
            CONCAT_ROOT / "target" / "release" / "concat-cli",
            CONCAT_ROOT / "target" / "debug" / "concat-cli",
        ]
    )
    return candidates


def find_concat_cli() -> Path | None:
    return next((path for path in _candidate_paths() if path.is_file()), None)


def engine_status() -> dict[str, Any]:
    binary = find_concat_cli()
    return {
        "available": binary is not None,
        "binary": str(binary) if binary else "",
        "source_root": str(CONCAT_ROOT),
        "projects_root": str(PROJECTS_ROOT),
        "message": (
            "Concat engine is ready."
            if binary
            else "Build Concat first with cargo build --release -p concat-cli."
        ),
    }


def call_concat(method: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
    if method not in ALLOWED_METHODS:
        raise ValueError(f"Unsupported Concat API method: {method}")

    binary = find_concat_cli()
    if binary is None:
        raise RuntimeError(engine_status()["message"])

    request = {"jsonrpc": "2.0", "id": 1, "method": method, "params": params or {}}
    completed = subprocess.run(
        [str(binary), "api", json.dumps(request)],
        cwd=str(CONCAT_ROOT),
        capture_output=True,
        text=True,
        timeout=300,
        check=False,
    )
    if completed.returncode != 0:
        detail = completed.stderr.strip() or "Concat engine exited with an error"
        raise RuntimeError(detail)

    messages = [json.loads(line) for line in completed.stdout.splitlines() if line.strip()]
    replies = [message for message in messages if "id" in message]
    if not replies:
        raise RuntimeError("Concat engine returned no response")
    reply = replies[-1]
    if "error" in reply:
        raise RuntimeError(reply["error"].get("message", "Concat API request failed"))
    return reply.get("result", reply)
