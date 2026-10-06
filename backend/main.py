from __future__ import annotations

import json
import logging
import os
import shutil
import time
from pathlib import Path
from typing import Any
from uuid import uuid4

from fastapi import BackgroundTasks, FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from .curation import (
    CurationConfig,
    CurationPipeline,
    apply_user_curation_decision,
    load_curation_config,
    save_curation_config,
    select_best_n_diverse,
)
from .curation.database import create_curation_job, get_curation_job, update_curation_job
from .dng_preset import DEFAULT_ADJUSTMENTS, load_preset_file
from .processor import process_image
from .social.routes import router as social_router
from .video.routes import router as video_router

ROOT = Path(__file__).resolve().parents[1]
PROCESSED = ROOT / "processed"
LOGS = ROOT / "logs"
PRESETS = ROOT / "presets"
JOBS_DIR = ROOT / "jobs"
PREVIEWS_DIR = JOBS_DIR / "previews"
CURATION_UPLOADS = JOBS_DIR / "curation_uploads"
CURATION_THUMBS = LOGS / "curation_thumbs"
JOBS_STATE = LOGS / "jobs.json"

for folder in (
    PROCESSED, LOGS, PRESETS, JOBS_DIR, PREVIEWS_DIR,
    CURATION_UPLOADS, CURATION_THUMBS,
    ROOT / "samples" / "input", ROOT / "samples" / "output",
):
    folder.mkdir(parents=True, exist_ok=True)

# Upload guard rails
MAX_FILE_BYTES = 60 * 1024 * 1024  # 60 MB per file
MAX_BATCH_FILES = 300
MAX_PREVIEW_FOLDERS = 20

logging.basicConfig(filename=LOGS / "photopilot.log", level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("photopilot")
app = FastAPI(title="PhotoPilot Local API", version="0.3.0")
app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"], allow_methods=["*"], allow_headers=["*"])
app.include_router(social_router)
app.include_router(video_router)


def _load_jobs() -> dict[str, dict[str, Any]]:
    try:
        return json.loads(JOBS_STATE.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def _save_jobs() -> None:
    try:
        JOBS_STATE.write_text(json.dumps(jobs, indent=2), encoding="utf-8")
    except OSError as exc:
        logger.warning("Could not persist job state: %s", exc)


jobs: dict[str, dict[str, Any]] = _load_jobs()


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
    auto_enhance: bool = False
    enhance_strength: int = 70
    adjustments: dict[str, float] = Field(default_factory=lambda: dict(DEFAULT_ADJUSTMENTS))


def _safe_name(name: str) -> str:
    return "".join(c if c.isalnum() or c in "-_" else "_" for c in name).strip("_") or "preset"


async def _write_upload(upload: UploadFile, destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    payload = await upload.read()
    if len(payload) > MAX_FILE_BYTES:
        raise HTTPException(status_code=413, detail=f"{upload.filename} exceeds the {MAX_FILE_BYTES // (1024 * 1024)} MB limit")
    destination.write_bytes(payload)


def _sweep_previews() -> None:
    try:
        folders = sorted((p for p in PREVIEWS_DIR.iterdir() if p.is_dir()), key=lambda p: p.stat().st_mtime, reverse=True)
    except FileNotFoundError:
        return
    for stale in folders[MAX_PREVIEW_FOLDERS:]:
        shutil.rmtree(stale, ignore_errors=True)


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/gpu")
def gpu_status() -> dict[str, Any]:
    gpu_info: dict[str, Any] = {
        "available": False,
        "device": None,
        "vendor": None,
        "backend": "CPU",
        "opencl": False,
        "cuda": False,
        "torch": None,
        "recommendation": "cpu",
        "details": "Running on CPU",
    }

    # 1. Check PyTorch CUDA if installed
    try:
        import torch  # type: ignore
        gpu_info["torch"] = torch.__version__
        if torch.cuda.is_available():
            dev_name = torch.cuda.get_device_name(0)
            gpu_info.update({
                "available": True,
                "cuda": True,
                "device": dev_name,
                "backend": "PyTorch CUDA",
                "recommendation": "gpu",
                "details": f"CUDA on {dev_name}",
            })
            return gpu_info
    except Exception:
        pass

    # 2. Check OpenCV OpenCL (Hardware GPU acceleration)
    try:
        import cv2
        if cv2.ocl.haveOpenCL():
            cv2.ocl.setUseOpenCL(True)
            dev = cv2.ocl.Device.getDefault()
            if dev and dev.available():
                gpu_info.update({
                    "available": True,
                    "opencl": True,
                    "device": dev.name(),
                    "vendor": dev.vendorName(),
                    "backend": "OpenCV OpenCL GPU",
                    "recommendation": "gpu",
                    "details": f"{dev.vendorName()} {dev.name()} (OpenCL {dev.version()})",
                })
                return gpu_info
    except Exception:
        pass

    # 3. Fallback check for NVIDIA hardware via nvidia-smi
    if shutil.which("nvidia-smi"):
        try:
            import subprocess
            out = subprocess.check_output(
                ["nvidia-smi", "--query-gpu=name", "--format=csv,noheader"],
                encoding="utf-8",
                timeout=2,
            ).strip()
            if out:
                first_name = out.splitlines()[0].strip()
                gpu_info.update({
                    "available": True,
                    "device": first_name,
                    "backend": "NVIDIA GPU",
                    "recommendation": "gpu",
                    "details": first_name,
                })
                return gpu_info
        except Exception:
            pass

    return gpu_info


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
    (PRESETS / f"{_safe_name(preset.name)}.json").write_text(preset.model_dump_json(indent=2), encoding="utf-8")
    return preset


@app.delete("/api/presets/{name}")
def delete_preset(name: str) -> dict[str, str]:
    target = PRESETS / f"{_safe_name(name)}.json"
    if not target.exists():
        raise HTTPException(status_code=404, detail="Preset not found")
    target.unlink()
    return {"deleted": name}


@app.post("/api/presets/import")
async def import_preset_file(file: UploadFile = File(...)) -> dict[str, Any]:
    """
    Imports a Lightroom Preset (.dng, .xmp, or .json).
    Extracts all camera raw settings or analyzes image tone, then saves as a preset.
    """
    if not file.filename:
        raise HTTPException(status_code=400, detail="No file provided")

    temp_path = JOBS_DIR / f"temp_{uuid4().hex}_{Path(file.filename).name}"
    await _write_upload(file, temp_path)
    try:
        preset_name, preset_data = load_preset_file(temp_path)
        # Create full preset
        safe_name = _safe_name(preset_name)
        new_preset = Preset(
            name=preset_name,
            adjustments=preset_data.get("adjustments", dict(DEFAULT_ADJUSTMENTS)),
        )
        (PRESETS / f"{safe_name}.json").write_text(new_preset.model_dump_json(indent=2), encoding="utf-8")
        return new_preset.model_dump()
    finally:
        if temp_path.exists():
            temp_path.unlink()


@app.post("/api/process")
async def start_process(
    background_tasks: BackgroundTasks,
    files: list[UploadFile] = File(...),
    preset_json: str = Form("{}"),
    logo: UploadFile | None = File(None),
    device: str = Form("auto"),
) -> dict[str, str]:
    try:
        preset_data = json.loads(preset_json)
        if isinstance(preset_data, list):
            presets = [Preset.model_validate(p) for p in preset_data]
        else:
            presets = [Preset.model_validate(preset_data)] * len(files)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Invalid preset: {exc}") from exc
    named = [f for f in files if f.filename]
    if not named:
        raise HTTPException(status_code=400, detail="No files were uploaded")
    if len(named) > MAX_BATCH_FILES:
        raise HTTPException(status_code=413, detail=f"Batch is limited to {MAX_BATCH_FILES} files")
    job_id = uuid4().hex
    job_dir = JOBS_DIR / job_id
    job_dir.mkdir(parents=True, exist_ok=True)
    logo_path = None
    if logo and logo.filename:
        logo_path = job_dir / "logo" / Path(logo.filename).name
        await _write_upload(logo, logo_path)

    inputs: list[Path] = []
    for item in named:
        destination = job_dir / "input" / Path(item.filename).name
        await _write_upload(item, destination)
        inputs.append(destination)
    jobs[job_id] = {
        "status": "queued",
        "total": len(inputs),
        "completed": 0,
        "errors": [],
        "files": [],
        "created": time.time(),
        "device_preference": device,
        "device_used": None,
    }
    _save_jobs()
    background_tasks.add_task(_run_job, job_id, inputs, [p.model_dump() for p in presets], logo_path, device)
    return {"job_id": job_id}


@app.post("/api/preview-upload")
async def preview_upload(
    file: UploadFile = File(...),
    preset_json: str = Form("{}"),
    logo: UploadFile | None = File(None),
    device: str = Form("auto"),
) -> FileResponse:
    try:
        preset_data = json.loads(preset_json)
        if isinstance(preset_data, list):
            preset = Preset.model_validate(preset_data[0] if preset_data else {})
        else:
            preset = Preset.model_validate(preset_data)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Invalid preset: {exc}") from exc
    _sweep_previews()
    preview_dir = PREVIEWS_DIR / uuid4().hex
    preview_dir.mkdir(parents=True, exist_ok=True)
    source = preview_dir / (Path(file.filename or "preview.jpg").stem + Path(file.filename or ".jpg").suffix)
    await _write_upload(file, source)
    logo_path = None
    if logo and logo.filename:
        logo_path = preview_dir / Path(logo.filename).name
        await _write_upload(logo, logo_path)
    try:
        output, device_used = process_image(source, preview_dir, preset.model_dump(), logo_path, device=device)
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"Preview failed: {exc}") from exc
    return FileResponse(output, headers={"X-Device-Used": device_used})


def _run_job(
    job_id: str,
    inputs: list[Path],
    presets: list[dict[str, Any]],
    logo_path: Path | None,
    device: str = "auto",
) -> None:
    jobs[job_id]["status"] = "running"
    _save_jobs()
    device_used_record = None
    for source, preset in zip(inputs, presets):
        try:
            output, dev_used = process_image(source, PROCESSED, preset, logo_path, device=device)
            device_used_record = dev_used
            jobs[job_id]["device_used"] = dev_used
            jobs[job_id]["files"].append({
                "name": source.name,
                "path": str(output.resolve()),
                "url": f"/api/preview/{output.name}",
            })
        except Exception as exc:
            logger.exception("Failed processing %s", source)
            jobs[job_id]["errors"].append({"name": source.name, "error": str(exc)})
        jobs[job_id]["completed"] += 1
        _save_jobs()
    jobs[job_id]["status"] = "complete"
    if device_used_record:
        jobs[job_id]["device_used"] = device_used_record
    _save_jobs()


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


# ==========================================
# AI Photo Curation & Duplicate Endpoints
# ==========================================

class CurationConfigRequest(BaseModel):
    phash_threshold: int = 8
    dhash_threshold: int = 10
    embedding_similarity_threshold: float = 0.88
    near_duplicate_embedding_threshold: float = 0.96
    embedding_batch_size: int = 16
    prefer_gpu: bool = True
    weights: dict[str, float] = Field(default_factory=dict)


class SelectBestNRequest(BaseModel):
    groups: list[dict[str, Any]]
    standalone: list[dict[str, Any]]
    target_count: int = 30


@app.get("/api/curation/config")
def get_curation_settings() -> dict[str, Any]:
    cfg = load_curation_config()
    return cfg.to_dict()


@app.post("/api/curation/config")
def save_curation_settings(req: CurationConfigRequest) -> dict[str, Any]:
    cfg = CurationConfig.from_dict(req.model_dump())
    save_curation_config(cfg)
    return cfg.to_dict()


@app.post("/api/curation/select-best-n")
def select_best_n(req: SelectBestNRequest) -> dict[str, Any]:
    selected_ids = select_best_n_diverse(req.groups, req.standalone, req.target_count)
    return {"selected_ids": selected_ids, "count": len(selected_ids)}


@app.get("/api/curation/thumbnail")
def get_thumbnail(path: str, max_size: int = 360) -> FileResponse:
    source = Path(path).resolve()
    if not source.exists():
        raise HTTPException(status_code=404, detail="Photo not found")

    mtime = int(source.stat().st_mtime)
    thumb_name = f"{source.stem}_{mtime}_{max_size}.jpg"
    thumb_path = CURATION_THUMBS / thumb_name
    if not thumb_path.exists():
        try:
            from PIL import Image, ImageOps
            with Image.open(source) as im:
                im = ImageOps.exif_transpose(im).convert("RGB")
                im.thumbnail((max_size, max_size), Image.Resampling.BILINEAR)
                im.save(thumb_path, "JPEG", quality=82)
        except Exception:
            return FileResponse(source)
    return FileResponse(thumb_path)


@app.post("/api/curation/start")
async def start_curation(
    background_tasks: BackgroundTasks,
    files: list[UploadFile] = File(default=[]),
    folder_path: str = Form(default=""),
) -> dict[str, str]:
    target_paths: list[Path] = []
    job_id = uuid4().hex
    job_upload_dir = CURATION_UPLOADS / job_id

    # Mode A: Folder Path on Windows PC
    if folder_path.strip():
        f_dir = Path(folder_path.strip()).resolve()
        if not f_dir.exists() or not f_dir.is_dir():
            raise HTTPException(status_code=400, detail=f"Folder not found: {folder_path}")
        from .curation.pipeline import SUPPORTED_EXTENSIONS
        target_paths = [
            p for p in f_dir.iterdir()
            if p.is_file() and p.suffix.lower() in SUPPORTED_EXTENSIONS
        ]
        if not target_paths:
            raise HTTPException(status_code=400, detail=f"No supported images found in: {folder_path}")

    # Mode B: Direct browser file upload
    elif files:
        job_upload_dir.mkdir(parents=True, exist_ok=True)
        for item in files:
            if item.filename:
                dest = job_upload_dir / Path(item.filename).name
                await _write_upload(item, dest)
                target_paths.append(dest)
        if not target_paths:
            raise HTTPException(status_code=400, detail="No files provided")
    else:
        raise HTTPException(status_code=400, detail="Please provide a folder path or upload files")

    create_curation_job(job_id, len(target_paths))
    background_tasks.add_task(_run_curation_job, job_id, target_paths)
    return {"job_id": job_id}


def _run_curation_job(job_id: str, paths: list[Path]) -> None:
    try:
        pipeline = CurationPipeline()
        pipeline.run(paths, job_id=job_id)
    except Exception as exc:
        logger.exception("Curation job %s failed", job_id)
        update_curation_job(
            job_id,
            status="failed",
            stage="Failed",
            error=str(exc),
        )


@app.get("/api/curation/progress/{job_id}")
def curation_progress(job_id: str) -> dict[str, Any]:
    job = get_curation_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Curation job not found")
    return job
