"""
Social / Post Composer API routes.

Mounted onto the main FastAPI app via include_router().
"""
from __future__ import annotations

import logging
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Any
from uuid import uuid4

from fastapi import APIRouter, BackgroundTasks, File, HTTPException, UploadFile
from pydantic import BaseModel, Field

from . import db
from .caption import (
    CaptionResult,
    OnlineCaptionProvider,
    RuleCaptionProvider,
    get_caption_config,
    get_caption_provider,
    list_providers,
    save_caption_config,
    test_caption_config,
)
from .facebook import (
    FacebookPublishError,
    get_managed_pages,
    publish_facebook_reel,
    publish_multi_photo,
    publish_single_photo,
    publish_standard_video,
    schedule_post,
    verify_token,
)

logger = logging.getLogger("photopilot.social.routes")
router = APIRouter(prefix="/api/social", tags=["social"])

ROOT = Path(__file__).resolve().parents[2]
SOCIAL_UPLOADS = ROOT / "jobs" / "social_uploads"
SOCIAL_UPLOADS.mkdir(parents=True, exist_ok=True)
MAX_FILE_BYTES = 60 * 1024 * 1024


# ──────── Request / Response Models ────────

class GenerateCaptionRequest(BaseModel):
    image_path: str = ""
    prompt: str = ""
    provider: str = "rule-based"


class CaptionConfigRequest(BaseModel):
    provider: str = "rule-based"
    api_key: str = ""
    model: str = ""
    base_url: str = ""


class GenerateHashtagsRequest(BaseModel):
    caption: str = ""
    image_path: str = ""
    category: str = "photography"
    count: int = 15


class SaveDraftRequest(BaseModel):
    title: str = ""
    caption: str = ""
    hashtags: list[str] = Field(default_factory=list)
    photo_paths: list[str] = Field(default_factory=list)
    page_id: str = ""


class UpdateDraftRequest(BaseModel):
    title: str | None = None
    caption: str | None = None
    hashtags: list[str] | None = None
    photo_paths: list[str] | None = None
    page_id: str | None = None
    status: str | None = None
    scheduled_at: float | None = None


class ConnectPageRequest(BaseModel):
    page_access_token: str


class ConnectPagesFromUserTokenRequest(BaseModel):
    user_access_token: str


class PublishRequest(BaseModel):
    draft_id: str = ""
    page_id: str = ""
    page_ids: list[str] = Field(default_factory=list)
    caption: str = ""
    hashtags: list[str] = Field(default_factory=list)
    photo_paths: list[str] = Field(default_factory=list)
    video_path: str = ""
    media_type: str = "photo"  # "photo" | "reel" | "video"
    video_title: str = ""
    scheduled_publish_time: int = 0


publish_jobs: dict[str, dict[str, Any]] = {}


class SaveHashtagSetRequest(BaseModel):
    name: str
    hashtags: list[str] = Field(default_factory=list)


# ──────── Photo Upload Route ────────

@router.post("/upload-photos")
async def upload_photos(files: list[UploadFile] = File(...)) -> dict[str, Any]:
    """
    Upload photos from the browser and save them on the server.
    Returns the server-side file paths for each uploaded photo.
    """
    from uuid import uuid4
    batch_dir = SOCIAL_UPLOADS / uuid4().hex[:12]
    batch_dir.mkdir(parents=True, exist_ok=True)

    saved: list[dict[str, str]] = []
    for f in files:
        if not f.filename:
            continue
        payload = await f.read()
        if len(payload) > MAX_FILE_BYTES:
            continue
        safe_name = Path(f.filename).name
        dest = batch_dir / safe_name
        dest.write_bytes(payload)
        saved.append({
            "name": safe_name,
            "path": str(dest.resolve()),
        })

    if not saved:
        raise HTTPException(status_code=400, detail="No valid files uploaded")

    return {"photos": saved, "count": len(saved)}


# ──────── Caption & Hashtag Routes ────────

@router.get("/providers")
def get_providers() -> list[dict[str, Any]]:
    """List available caption providers."""
    return list_providers()


@router.get("/caption/config")
def caption_config() -> dict[str, str]:
    return get_caption_config()


@router.put("/caption/config")
def update_caption_config(req: CaptionConfigRequest) -> dict[str, str]:
    return save_caption_config(req.model_dump())


@router.post("/caption/test")
def test_caption_connection(req: CaptionConfigRequest) -> dict[str, Any]:
    try:
        config = req.model_dump()
        if config["provider"] == "rule-based":
            config["provider"] = (
                "gemini"
                if "generativelanguage.googleapis.com" in config.get("base_url", "")
                else "openai-compatible"
            )
        return test_caption_config(config)
    except (RuntimeError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/caption/generate")
def generate_caption(req: GenerateCaptionRequest) -> dict[str, Any]:
    """Generate a caption for a photo."""
    if not req.prompt.strip():
        raise HTTPException(status_code=400, detail="Write a prompt before generating a caption")
    use_vlm = req.provider == "local-vlm"
    if req.provider == "online":
        provider = OnlineCaptionProvider()
    else:
        provider = RuleCaptionProvider() if req.provider == "rule-based" else get_caption_provider(prefer_local_vlm=use_vlm)

    if req.image_path and not Path(req.image_path).exists():
        raise HTTPException(status_code=404, detail=f"Image not found: {req.image_path}")

    try:
        result = provider.generate_caption(image_path=req.image_path, context=req.prompt.strip())
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    return result.to_dict()


@router.post("/hashtags/generate")
def generate_hashtags(req: GenerateHashtagsRequest) -> dict[str, Any]:
    """Generate hashtags based on caption/category."""
    provider = get_caption_provider()
    hashtags = provider.generate_hashtags(
        caption=req.caption,
        image_path=req.image_path,
        category=req.category,
        count=req.count,
    )
    return {"hashtags": hashtags, "count": len(hashtags)}


@router.get("/hashtags/categories")
def hashtag_categories() -> list[str]:
    """List available hashtag categories."""
    return [
        "photography", "nature", "portrait", "wedding",
        "food", "travel", "product", "event",
    ]


# ──────── Hashtag Sets ────────

@router.get("/hashtag-sets")
def get_hashtag_sets() -> list[dict[str, Any]]:
    return db.list_hashtag_sets()


@router.post("/hashtag-sets")
def save_hashtag_set(req: SaveHashtagSetRequest) -> dict[str, Any]:
    return db.save_hashtag_set(req.name, req.hashtags)


@router.delete("/hashtag-sets/{set_id}")
def delete_hashtag_set(set_id: str) -> dict[str, str]:
    db.delete_hashtag_set(set_id)
    return {"deleted": set_id}


# ──────── Draft Routes ────────

@router.get("/drafts")
def get_drafts(status: str = "") -> list[dict[str, Any]]:
    return db.list_drafts(status)


@router.post("/drafts")
def create_draft(req: SaveDraftRequest) -> dict[str, Any]:
    return db.create_draft(
        title=req.title,
        caption=req.caption,
        hashtags=req.hashtags,
        photo_paths=req.photo_paths,
        page_id=req.page_id,
    )


@router.get("/drafts/{draft_id}")
def get_draft(draft_id: str) -> dict[str, Any]:
    draft = db.get_draft(draft_id)
    if not draft:
        raise HTTPException(status_code=404, detail="Draft not found")
    return draft


@router.put("/drafts/{draft_id}")
def update_draft(draft_id: str, req: UpdateDraftRequest) -> dict[str, Any]:
    fields = {k: v for k, v in req.model_dump().items() if v is not None}
    result = db.update_draft(draft_id, **fields)
    if not result:
        raise HTTPException(status_code=404, detail="Draft not found")
    return result


@router.delete("/drafts/{draft_id}")
def delete_draft(draft_id: str) -> dict[str, str]:
    db.delete_draft(draft_id)
    return {"deleted": draft_id}


# ──────── Facebook Connection Routes ────────

@router.get("/facebook/pages")
def get_facebook_pages() -> list[dict[str, Any]]:
    """Get saved Facebook Page connections."""
    pages = db.list_facebook_pages()
    # Don't send raw access tokens to the frontend
    for p in pages:
        p["access_token"] = "••••" + p["access_token"][-6:] if len(p.get("access_token", "")) > 6 else "••••"
    return pages


@router.post("/facebook/connect")
def connect_page(req: ConnectPageRequest) -> dict[str, Any]:
    """Connect a Facebook Page using its Page Access Token."""
    try:
        page_info = verify_token(req.page_access_token)
    except FacebookPublishError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    picture_url = ""
    if "picture" in page_info and "data" in page_info["picture"]:
        picture_url = page_info["picture"]["data"].get("url", "")

    saved = db.save_facebook_page(
        page_id=page_info["id"],
        page_name=page_info.get("name", "Unknown Page"),
        access_token=req.page_access_token,
        category=page_info.get("category", ""),
        picture_url=picture_url,
    )
    # Mask token in response
    saved["access_token"] = "••••" + req.page_access_token[-6:]
    return saved


@router.post("/facebook/connect-user")
def connect_pages_from_user_token(req: ConnectPagesFromUserTokenRequest) -> dict[str, Any]:
    """Discover and connect all Pages managed by a User Access Token."""
    try:
        pages = get_managed_pages(req.user_access_token)
    except FacebookPublishError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    connected = []
    for pg in pages:
        picture_url = ""
        if "picture" in pg and "data" in pg["picture"]:
            picture_url = pg["picture"]["data"].get("url", "")

        db.save_facebook_page(
            page_id=pg["id"],
            page_name=pg.get("name", "Unknown"),
            access_token=pg.get("access_token", ""),
            category=pg.get("category", ""),
            picture_url=picture_url,
        )
        connected.append({"page_id": pg["id"], "name": pg.get("name")})

    return {"connected": connected, "count": len(connected)}


@router.delete("/facebook/pages/{page_id}")
def disconnect_page(page_id: str) -> dict[str, str]:
    db.remove_facebook_page(page_id)
    return {"disconnected": page_id}


# ──────── Publishing Routes ────────

def _run_publish_job(job_id: str, req: PublishRequest) -> None:
    job = publish_jobs[job_id]
    try:
        page_ids = list(dict.fromkeys(req.page_ids or ([req.page_id] if req.page_id else [])))
        pages = [(page_id, db.get_facebook_page(page_id)) for page_id in page_ids]
        missing = [page_id for page_id, page_data in pages if not page_data]
        if missing:
            raise FacebookPublishError(f"Facebook Page(s) not connected: {', '.join(missing)}")

        full_caption = req.caption
        if req.hashtags:
            full_caption += "\n\n" + " ".join(req.hashtags)

        is_video = bool(req.video_path or req.media_type in ("reel", "video"))
        work_units_per_page = 1 if is_video else max(1, len(req.photo_paths))
        total_work = work_units_per_page * len(pages)
        job["pages"] = {
            page_id: {
                "page_id": page_id,
                "page_name": page_data["page_name"],
                "completed": 0,
                "total": work_units_per_page,
                "percent": 0,
                "status": "uploading",
            }
            for page_id, page_data in pages
            if page_data
        }

        def publish_for_page(page_id: str, page_data: dict[str, Any]) -> tuple[str, dict[str, Any] | None, str, str]:
            def page_progress(completed: int, total: int) -> None:
                page_job = job["pages"][page_id]
                page_job["completed"] = completed
                page_job["percent"] = round(completed / total * 100) if total else 100
                completed_total = sum(item["completed"] for item in job["pages"].values())
                job["completed"] = completed_total
                job["total"] = total_work
                job["percent"] = round(completed_total / total_work * 100) if total_work else 100
                elapsed = time.time() - job["started_at"]
                job["elapsed_seconds"] = round(elapsed, 1)
                job["eta_seconds"] = round(
                    elapsed / completed_total * (total_work - completed_total), 1
                ) if completed_total else None

            try:
                if is_video:
                    # Video or Reel publish
                    if req.media_type == "video":
                        result = publish_standard_video(
                            page_id=page_id,
                            page_access_token=page_data["access_token"],
                            video_path=req.video_path,
                            title=req.video_title,
                            description=full_caption,
                            scheduled_publish_time=req.scheduled_publish_time,
                        )
                    else:
                        # Default is Reel
                        result = publish_facebook_reel(
                            page_id=page_id,
                            page_access_token=page_data["access_token"],
                            video_path=req.video_path,
                            caption=full_caption,
                            scheduled_publish_time=req.scheduled_publish_time,
                        )
                    status = "scheduled" if req.scheduled_publish_time > 0 else "published"
                    page_progress(1, 1)
                else:
                    # Photo publish
                    if req.scheduled_publish_time > 0:
                        result = schedule_post(
                            page_id=page_id,
                            page_access_token=page_data["access_token"],
                            photo_paths=req.photo_paths,
                            caption=full_caption,
                            scheduled_publish_time=req.scheduled_publish_time,
                        )
                        status = "scheduled"
                        page_progress(len(req.photo_paths), len(req.photo_paths))
                    else:
                        result = publish_multi_photo(
                            page_id=page_id,
                            page_access_token=page_data["access_token"],
                            photo_paths=req.photo_paths,
                            caption=full_caption,
                            progress_cb=page_progress,
                        )
                        status = "published"
                        if len(req.photo_paths) == 1:
                            page_progress(1, 1)

                job["pages"][page_id]["status"] = status
                return page_id, result, status, ""
            except FacebookPublishError as exc:
                job["pages"][page_id]["status"] = "failed"
                job["pages"][page_id]["error"] = str(exc)
                page_progress(work_units_per_page, work_units_per_page)
                return page_id, None, "failed", str(exc)

        media_paths = req.photo_paths if not is_video else ([req.video_path] if req.video_path else [])
        results = []
        errors = []
        with ThreadPoolExecutor(max_workers=len(pages)) as executor:
            futures = {
                executor.submit(publish_for_page, page_id, page_data): (page_id, page_data)
                for page_id, page_data in pages
                if page_data
            }
            for future in as_completed(futures):
                page_id, page_data = futures[future]
                result_page_id, result, status, error = future.result()
                if error:
                    errors.append({"page_id": page_id, "page_name": page_data["page_name"], "error": error})
                    db.record_published_post(
                        draft_id=req.draft_id,
                        page_id=page_id,
                        page_name=page_data["page_name"],
                        error=error,
                        caption=req.caption,
                        hashtags=req.hashtags,
                        photo_paths=media_paths,
                        status="failed",
                    )
                else:
                    record = db.record_published_post(
                        draft_id=req.draft_id,
                        fb_post_id=result.get("id", result.get("post_id", "")),
                        page_id=result_page_id,
                        page_name=page_data["page_name"],
                        caption=req.caption,
                        hashtags=req.hashtags,
                        photo_paths=media_paths,
                        status=status,
                    )
                    results.append({**record, "fb_result": result})

        if not results:
            raise FacebookPublishError("Publishing failed for all selected Pages")
        job.update(
            status="complete",
            result={"pages": results, "errors": errors, "partial": bool(errors)},
            percent=100,
            completed=total_work,
            total=total_work,
            eta_seconds=0,
        )
    except FacebookPublishError as exc:
        publish_jobs[job_id].update(status="failed", error=str(exc))
        media_paths = req.photo_paths if not is_video else ([req.video_path] if req.video_path else [])
        db.record_published_post(
            draft_id=req.draft_id,
            page_id=req.page_id,
            error=str(exc),
            caption=req.caption,
            hashtags=req.hashtags,
            photo_paths=media_paths,
            status="failed",
        )
    except Exception as exc:
        logger.exception("Publish job %s failed unexpectedly", job_id)
        publish_jobs[job_id].update(status="failed", error="Unexpected publishing error")


@router.post("/publish")
def publish_post(req: PublishRequest, background_tasks: BackgroundTasks) -> dict[str, str]:
    """Start a publish job and return immediately so the UI can show progress."""
    page_ids = list(dict.fromkeys(req.page_ids or ([req.page_id] if req.page_id else [])))
    if not page_ids:
        raise HTTPException(status_code=400, detail="At least one Facebook Page is required")

    is_video = bool(req.video_path or req.media_type in ("reel", "video"))
    if not is_video and not req.photo_paths:
        raise HTTPException(status_code=400, detail="At least one photo is required")
    if is_video and not req.video_path:
        raise HTTPException(status_code=400, detail="Video file path is required")

    req.page_ids = page_ids
    job_id = uuid4().hex
    work_units_per_page = 1 if is_video else max(1, len(req.photo_paths))
    publish_jobs[job_id] = {
        "status": "uploading",
        "completed": 0,
        "total": work_units_per_page * len(page_ids),
        "percent": 0,
        "started_at": time.time(),
        "elapsed_seconds": 0,
        "eta_seconds": None,
    }
    background_tasks.add_task(_run_publish_job, job_id, req)
    return {"job_id": job_id}


@router.get("/publish/progress/{job_id}")
def publish_progress(job_id: str) -> dict[str, Any]:
    job = publish_jobs.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Publish job not found")
    return job


@router.get("/history")
def publish_history(limit: int = 50) -> list[dict[str, Any]]:
    return db.list_published_posts(limit)
