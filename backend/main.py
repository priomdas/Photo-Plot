from __future__ import annotations

import json
import logging
import os
import subprocess
from pathlib import Path
from typing import Any
from uuid import uuid4

from fastapi import BackgroundTasks, FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel

from .processor import process_image

ROOT = Path(__file__).resolve().parents[1]
PROCESSED = ROOT / "processed"
LOGS = ROOT / "logs"
PRESETS = ROOT / "presets"
for folder in (PROCESSED, LOGS, PRESETS, ROOT / "samples" / "input", ROOT / "samples" / "output"):
    folder.mkdir(parents=True, exist_ok=True)

logging.basicConfig(filename=LOGS / "photopilot.log", level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("photopilot")
app = FastAPI(title="PhotoPilot Local API", version="0.1.0")
app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"], allow_methods=["*"], allow_headers=["*"])
jobs: dict[str, dict[str, Any]] = {}


class Preset(BaseModel):
    name: str = "default"
    max_width: int | None = None
    max_height: int | None = None
    quality: int = 90
    format: str = "JPEG"
    anchor: str = "bottom-right"
    offset_x: float = 0.03
    offset_y: float = 0.03
    logo_opacity: int = 100
    logo_width_ratio: float = 0.20
    logo_position_x: float | None = None
    logo_position_y: float | None = None
    adjustments: dict[str, float] = {
        "brightness": 1.0,
        "contrast": 1.0,
        "saturation": 1.0,
        "sharpness": 1.0,
    }


class ProcessRequest(BaseModel):
    preset: Preset = Preset()
    logo_path: str | None = None


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/gpu")
def gpu_status() -> dict[str, Any]:
    try:
        import torch  # type: ignore
        return {"available": bool(torch.cuda.is_available()), "device": torch.cuda.get_device_name(0) if torch.cuda.is_available() else None, "torch": torch.__version__}
    except ImportError:
        return {"available": False, "device": None, "torch": None, "message": "torch is not installed (optional)"}
    except Exception as exc:
        return {"available": False, "device": None, "torch": None, "message": str(exc)}


@app.get("/api/presets")
def list_presets() -> list[dict[str, Any]]:
    result = []
    for path in sorted(PRESETS.glob("*.json")):
        try:
            result.append(json.loads(path.read_text(encoding="utf-8")))
        except json.JSONDecodeError:
            logger.warning("Invalid preset skipped: %s", path)
    return result


@app.post("/api/presets")
def save_preset(preset: Preset) -> Preset:
    safe_name = "".join(c if c.isalnum() or c in "-_" else "_" for c in preset.name).strip("_") or "preset"
    (PRESETS / f"{safe_name}.json").write_text(preset.model_dump_json(indent=2), encoding="utf-8")
    return preset


@app.post("/api/process")
async def start_process(
    background_tasks: BackgroundTasks,
    files: list[UploadFile] = File(...),
    preset_json: str = Form("{}"),
    logo: UploadFile | None = File(None),
    reference: UploadFile | None = File(None),
) -> dict[str, str]:
    try:
        preset = Preset.model_validate_json(preset_json)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Invalid preset: {exc}") from exc
    job_id = uuid4().hex
    job_dir = ROOT / "jobs" / job_id
    job_dir.mkdir(parents=True, exist_ok=True)
    logo_path = None
    if logo and logo.filename:
        logo_path = job_dir / "logo" / Path(logo.filename).name
        logo_path.parent.mkdir(exist_ok=True)
        logo_path.write_bytes(await logo.read())
    reference_path = None
    if reference and reference.filename:
        reference_path = job_dir / "reference" / Path(reference.filename).name
        reference_path.parent.mkdir(exist_ok=True)
        reference_path.write_bytes(await reference.read())
    inputs: list[Path] = []
    for item in files:
        if not item.filename:
            continue
        destination = job_dir / "input" / Path(item.filename).name
        destination.parent.mkdir(exist_ok=True)
        destination.write_bytes(await item.read())
        inputs.append(destination)
    jobs[job_id] = {"status": "queued", "total": len(inputs), "completed": 0, "errors": [], "files": []}
    background_tasks.add_task(_run_job, job_id, inputs, preset.model_dump(), logo_path, reference_path)
    return {"job_id": job_id}


@app.post("/api/preview-upload")
async def preview_upload(
    file: UploadFile = File(...),
    preset_json: str = Form("{}"),
    logo: UploadFile | None = File(None),
    reference: UploadFile | None = File(None),
) -> FileResponse:
    try:
        preset = Preset.model_validate_json(preset_json)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Invalid preset: {exc}") from exc
    preview_dir = ROOT / "jobs" / "previews" / uuid4().hex
    preview_dir.mkdir(parents=True, exist_ok=True)
    source = preview_dir / (Path(file.filename or "preview.jpg").stem + Path(file.filename or ".jpg").suffix)
    source.write_bytes(await file.read())
    logo_path = None
    if logo and logo.filename:
        logo_path = preview_dir / Path(logo.filename).name
        logo_path.write_bytes(await logo.read())
    reference_path = None
    if reference and reference.filename:
        reference_path = preview_dir / ("reference_" + Path(reference.filename).name)
        reference_path.write_bytes(await reference.read())
    try:
        output = process_image(source, preview_dir, preset.model_dump(), logo_path, reference_path)
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"Preview failed: {exc}") from exc
    return FileResponse(output)


def _run_job(job_id: str, inputs: list[Path], preset: dict[str, Any], logo_path: Path | None, reference_path: Path | None) -> None:
    jobs[job_id]["status"] = "running"
    for source in inputs:
        try:
            output = process_image(source, PROCESSED, preset, logo_path, reference_path)
            jobs[job_id]["files"].append({"name": source.name, "url": f"/api/preview/{output.name}"})
        except Exception as exc:
            logger.exception("Failed processing %s", source)
            jobs[job_id]["errors"].append({"name": source.name, "error": str(exc)})
        jobs[job_id]["completed"] += 1
    jobs[job_id]["status"] = "complete"


@app.get("/api/progress/{job_id}")
def progress(job_id: str) -> dict[str, Any]:
    if job_id not in jobs:
        raise HTTPException(status_code=404, detail="Job not found")
    return jobs[job_id]


@app.get("/api/preview/{filename}")
def preview(filename: str) -> FileResponse:
    path = (PROCESSED / Path(filename).name).resolve()
    if path.parent != PROCESSED.resolve() or not path.exists():
        raise HTTPException(status_code=404, detail="Image not found")
    return FileResponse(path)


@app.post("/api/open-folder")
def open_folder() -> dict[str, str]:
    if os.name != "nt":
        raise HTTPException(status_code=400, detail="Open-folder is only supported on Windows")
    os.startfile(str(PROCESSED))  # type: ignore[attr-defined]
    return {"path": str(PROCESSED)}
