from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

import httpx

logger = logging.getLogger("photopilot.video.reels")
GRAPH_API_BASE = "https://graph.facebook.com/v19.0"


class FacebookVideoError(Exception):
    """Raised when Facebook video/reel publishing fails."""
    pass


def publish_facebook_reel(
    page_id: str,
    page_access_token: str,
    video_path: str | Path,
    caption: str = "",
    scheduled_publish_time: int = 0,
) -> dict[str, Any]:
    """
    Publish a vertical 9:16 short video as a Facebook Reel using the official 3-step Reels API.
    Step 1: Initialize upload session (upload_phase=start)
    Step 2: Transfer binary video bytes to upload_url
    Step 3: Finish and publish/schedule reel (upload_phase=finish)
    """
    v_path = Path(video_path)
    if not v_path.exists():
        raise FacebookVideoError(f"Video file not found: {video_path}")

    file_size = v_path.stat().st_size
    if file_size <= 0:
        raise FacebookVideoError("Video file is empty.")

    # Step 1: Start upload session
    try:
        init_res = httpx.post(
            f"{GRAPH_API_BASE}/{page_id}/video_reels",
            data={
                "access_token": page_access_token,
                "upload_phase": "start",
            },
            timeout=30,
        )
        init_data = init_res.json()
        if "error" in init_data:
            raise FacebookVideoError(init_data["error"].get("message", "Failed to start Reel session"))

        video_id = init_data.get("video_id")
        upload_url = init_data.get("upload_url")
        if not video_id or not upload_url:
            raise FacebookVideoError(f"Invalid Reels upload session response: {init_data}")

    except httpx.HTTPError as exc:
        raise FacebookVideoError(f"Network error initiating Reel: {exc}") from exc

    # Step 2: Binary transfer chunk
    try:
        with open(v_path, "rb") as f:
            headers = {
                "Authorization": f"OAuth {page_access_token}",
                "offset": "0",
                "file_size": str(file_size),
                "Content-Type": "application/octet-stream",
            }
            transfer_res = httpx.post(
                upload_url,
                content=f.read(),
                headers=headers,
                timeout=180,
            )
            transfer_data = transfer_res.json()
            if "error" in transfer_data:
                raise FacebookVideoError(transfer_data["error"].get("message", "Reel binary upload failed"))

    except httpx.HTTPError as exc:
        raise FacebookVideoError(f"Network error uploading Reel binary: {exc}") from exc

    # Step 3: Finish and publish/schedule
    try:
        finish_data: dict[str, Any] = {
            "access_token": page_access_token,
            "upload_phase": "finish",
            "video_id": video_id,
            "description": caption,
        }

        if scheduled_publish_time and scheduled_publish_time > 0:
            finish_data["video_state"] = "SCHEDULED"
            finish_data["scheduled_publish_time"] = str(scheduled_publish_time)
        else:
            finish_data["video_state"] = "PUBLISHED"

        publish_res = httpx.post(
            f"{GRAPH_API_BASE}/{page_id}/video_reels",
            data=finish_data,
            timeout=30,
        )
        publish_data = publish_res.json()
        if "error" in publish_data:
            raise FacebookVideoError(publish_data["error"].get("message", "Reel publish failed"))

        publish_data["video_id"] = video_id
        publish_data["reel"] = True
        return publish_data

    except httpx.HTTPError as exc:
        raise FacebookVideoError(f"Network error finalizing Reel: {exc}") from exc


def publish_standard_facebook_video(
    page_id: str,
    page_access_token: str,
    video_path: str | Path,
    title: str = "",
    description: str = "",
    scheduled_publish_time: int = 0,
) -> dict[str, Any]:
    """
    Publish a standard landscape / 16:9 or long-form video to Facebook Page Feed.
    Endpoint: POST /{page_id}/videos
    """
    v_path = Path(video_path)
    if not v_path.exists():
        raise FacebookVideoError(f"Video file not found: {video_path}")

    try:
        with open(v_path, "rb") as f:
            post_data = {
                "access_token": page_access_token,
                "description": description,
            }
            if title:
                post_data["title"] = title

            if scheduled_publish_time and scheduled_publish_time > 0:
                post_data["published"] = "false"
                post_data["scheduled_publish_time"] = str(scheduled_publish_time)
            else:
                post_data["published"] = "true"

            resp = httpx.post(
                f"{GRAPH_API_BASE}/{page_id}/videos",
                data=post_data,
                files={"source": (v_path.name, f, "video/mp4")},
                timeout=180,
            )
            data = resp.json()
            if "error" in data:
                raise FacebookVideoError(data["error"].get("message", "Standard video publish failed"))

            data["standard_video"] = True
            return data

    except httpx.HTTPError as exc:
        raise FacebookVideoError(f"Network error uploading video: {exc}") from exc
