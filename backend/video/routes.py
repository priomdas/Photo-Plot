from __future__ import annotations

import logging
import os
import re
import shutil
import time
from pathlib import Path
from typing import Any
from urllib.parse import quote, unquote
from uuid import uuid4

from fastapi import APIRouter, BackgroundTasks, File, Form, Header, HTTPException, Query, Request, Response, UploadFile
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel, Field

from .ffmpeg_utils import extract_audio, probe_media, render_project

logger = logging.getLogger("photopilot.video.routes")
router = APIRouter(prefix="/api/video", tags=["video"])

ROOT = Path(__file__).resolve().parents[2]
VIDEO_UPLOADS = ROOT / "jobs" / "video_uploads"
AUDIO_UPLOADS = ROOT / "jobs" / "audio_uploads"
RENDERED_VIDEOS = ROOT / "jobs" / "rendered_videos"

for d in (VIDEO_UPLOADS, AUDIO_UPLOADS, RENDERED_VIDEOS):
    d.mkdir(parents=True, exist_ok=True)

render_jobs: dict[str, dict[str, Any]] = {}


# ──────── Request Models ────────

class ClipItem(BaseModel):
    path: str
    start_time: float = 0.0
    end_time: float = 0.0
    speed: float = 1.0
    transition: str = "none"
    transition_duration: float = 0.5


class RenderProjectRequest(BaseModel):
    clips: list[ClipItem]
    transitions: list[dict[str, Any]] = Field(default_factory=list)
    aspect_ratio: str = "9:16"  # "9:16", "16:9", "1:1", "original"
    target_resolution: str = "1080p"  # "1080p", "720p"
    mute_original_audio: bool = False
    bgm_audio_path: str = ""
    bgm_volume: float = 1.0
    original_audio_volume: float = 1.0
    adjustments: dict[str, float] = Field(default_factory=dict)
    lut_preset: str = "none"
    logo_path: str = ""
    logo_settings: dict[str, Any] = Field(default_factory=dict)


class ExtractAudioRequest(BaseModel):
    video_path: str


# ──────── Background Worker ────────

def _execute_render(job_id: str, req: RenderProjectRequest) -> None:
    job = render_jobs[job_id]
    job["status"] = "rendering"
    job["started_at"] = time.time()

    def on_progress(percent: float, message: str) -> None:
        job["percent"] = percent
        job["message"] = message

    try:
        out_filename = f"render_{job_id}_{req.aspect_ratio.replace(':', 'x')}.mp4"
        out_path = RENDERED_VIDEOS / out_filename

        # If explicit transitions list isn't provided, build from clip items
        transitions_payload = req.transitions
        if not transitions_payload and len(req.clips) > 1:
            transitions_payload = [
                {
                    "name": getattr(c, "transition", "none") or "none",
                    "duration": getattr(c, "transition_duration", 0.5) or 0.5,
                }
                for c in req.clips[:-1]
            ]

        rendered_file = render_project(
            clips=[c.model_dump() for c in req.clips],
            output_path=out_path,
            aspect_ratio=req.aspect_ratio,
            target_resolution=req.target_resolution,
            transitions=transitions_payload,
            mute_original_audio=req.mute_original_audio,
            bgm_audio_path=req.bgm_audio_path or None,
            bgm_volume=req.bgm_volume,
            original_audio_volume=req.original_audio_volume,
            adjustments=req.adjustments,
            lut_preset=req.lut_preset,
            logo_path=req.logo_path or None,
            logo_settings=req.logo_settings,
            progress_callback=on_progress,
        )

        probe = probe_media(rendered_file)
        job["status"] = "complete"
        job["percent"] = 100.0
        job["message"] = "Render completed successfully!"
        job["output_path"] = str(rendered_file)
        job["filename"] = rendered_file.name
        job["stream_url"] = f"/api/video/stream?path={str(rendered_file)}"
        job["download_url"] = f"/api/video/download?path={str(rendered_file)}"
        job["duration"] = probe.get("duration", 0.0)
        job["width"] = probe.get("width", 0)
        job["height"] = probe.get("height", 0)
        job["aspect_ratio"] = probe.get("aspect_ratio", req.aspect_ratio)

    except Exception as exc:
        logger.exception("Render job %s failed: %s", job_id, exc)
        job["status"] = "failed"
        job["error"] = str(exc)
        job["message"] = f"Error: {exc}"


# ──────── Endpoints ────────

@router.post("/upload-clip")
def upload_video_clip(file: UploadFile = File(...)) -> dict[str, Any]:
    """Upload a video clip and immediately return duration, dimensions, and audio info."""
    raw_name = Path(file.filename or "video.mp4").name
    safe_name = re.sub(r"[^\w\.-]", "_", raw_name)
    clean_name = f"{int(time.time())}_{safe_name}"
    target = VIDEO_UPLOADS / clean_name

    try:
        with open(target, "wb") as f:
            shutil.copyfileobj(file.file, f)
    except Exception as exc:
        logger.exception("Failed to save uploaded video file: %s", exc)
        raise HTTPException(status_code=500, detail=f"Failed to save video: {exc}") from exc

    try:
        meta = probe_media(target)
    except Exception as exc:
        target.unlink(missing_ok=True)
        logger.exception("Failed to probe uploaded video file: %s", exc)
        raise HTTPException(status_code=400, detail=f"Invalid video file: {exc}") from exc

    meta["original_name"] = file.filename
    meta["stream_url"] = f"/api/video/stream?path={quote(target.as_posix())}"
    return meta


@router.post("/upload-audio")
def upload_audio_track(file: UploadFile = File(...)) -> dict[str, Any]:
    """Upload an audio track for background music or replacement."""
    raw_name = Path(file.filename or "audio.mp3").name
    safe_name = re.sub(r"[^\w\.-]", "_", raw_name)
    clean_name = f"{int(time.time())}_{safe_name}"
    target = AUDIO_UPLOADS / clean_name

    try:
        with open(target, "wb") as f:
            shutil.copyfileobj(file.file, f)
    except Exception as exc:
        logger.exception("Failed to save uploaded audio file: %s", exc)
        raise HTTPException(status_code=500, detail=f"Failed to save audio: {exc}") from exc

    try:
        meta = probe_media(target)
    except Exception as exc:
        target.unlink(missing_ok=True)
        logger.exception("Failed to probe uploaded audio file: %s", exc)
        raise HTTPException(status_code=400, detail=f"Invalid audio file: {exc}") from exc

    meta["original_name"] = file.filename
    meta["stream_url"] = f"/api/video/stream?path={quote(target.as_posix())}"
    return meta


@router.post("/extract-audio")
def extract_audio_from_clip(req: ExtractAudioRequest) -> dict[str, Any]:
    """Extract audio from video file to MP3 so user can manipulate or detach it."""
    v_path = Path(req.video_path)
    if not v_path.exists():
        raise HTTPException(status_code=404, detail="Video file not found")

    out_mp3 = AUDIO_UPLOADS / f"extracted_{v_path.stem}_{int(time.time())}.mp3"
    try:
        extracted = extract_audio(v_path, out_mp3)
        meta = probe_media(extracted)
        meta["stream_url"] = f"/api/video/stream?path={str(extracted)}"
        return meta
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to extract audio: {exc}") from exc


@router.post("/probe")
def probe_media_file(path: str = Query(...)) -> dict[str, Any]:
    """Get metadata for any media file on the server."""
    f = Path(path)
    if not f.exists():
        raise HTTPException(status_code=404, detail="File not found")
    try:
        info = probe_media(f)
        info["stream_url"] = f"/api/video/stream?path={str(f)}"
        return info
    except Exception as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/render")
def start_render_project(req: RenderProjectRequest, bg_tasks: BackgroundTasks) -> dict[str, Any]:
    """Start an async timeline render job."""
    if not req.clips:
        raise HTTPException(status_code=400, detail="At least one clip is required")

    job_id = str(uuid4())[:8]
    render_jobs[job_id] = {
        "job_id": job_id,
        "status": "queued",
        "percent": 0.0,
        "message": "Queued for rendering...",
        "created_at": time.time(),
        "clips_count": len(req.clips),
    }

    bg_tasks.add_task(_execute_render, job_id, req)
    return {"job_id": job_id, "status": "queued"}


@router.get("/render/progress/{job_id}")
def get_render_progress(job_id: str) -> dict[str, Any]:
    """Check status of a render job."""
    if job_id not in render_jobs:
        raise HTTPException(status_code=404, detail="Job not found")
    return render_jobs[job_id]


@router.get("/stream")
def stream_media(request: Request, path: str = Query(...)) -> Response:
    """
    Stream video/audio with full HTTP 206 Partial Content (Range header) support.
    This enables instant browser scrubbing on the timeline without downloading the whole file!
    """
    decoded = unquote(path)
    media_path = Path(decoded)
    if not media_path.exists():
        media_path = Path(path)
    if not media_path.exists():
        raise HTTPException(status_code=404, detail=f"Media not found: {path}")

    file_size = media_path.stat().st_size
    range_header = request.headers.get("range")

    content_type = "video/mp4"
    if media_path.suffix.lower() in (".mp3", ".wav", ".m4a", ".aac"):
        content_type = "audio/mpeg"

    if range_header:
        # e.g. "bytes=0-1024"
        try:
            byte_range = range_header.replace("bytes=", "").split("-")
            start = int(byte_range[0])
            end = int(byte_range[1]) if byte_range[1] else file_size - 1
        except Exception:
            start = 0
            end = file_size - 1

        start = max(0, min(start, file_size - 1))
        end = max(start, min(end, file_size - 1))
        chunk_size = (end - start) + 1

        def iterfile():
            with open(media_path, "rb") as f:
                f.seek(start)
                bytes_left = chunk_size
                while bytes_left > 0:
                    read_len = min(64 * 1024, bytes_left)
                    data = f.read(read_len)
                    if not data:
                        break
                    bytes_left -= len(data)
                    yield data

        headers = {
            "Content-Range": f"bytes {start}-{end}/{file_size}",
            "Accept-Ranges": "bytes",
            "Content-Length": str(chunk_size),
            "Content-Type": content_type,
        }
        return StreamingResponse(iterfile(), status_code=206, headers=headers)

    return FileResponse(media_path, media_type=content_type, headers={"Accept-Ranges": "bytes"})


@router.get("/download")
def download_rendered_video(path: str = Query(...)) -> FileResponse:
    p = Path(path)
    if not p.exists():
        raise HTTPException(status_code=404, detail="File not found")
    return FileResponse(p, filename=p.name, media_type="video/mp4")
