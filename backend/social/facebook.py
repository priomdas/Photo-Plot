"""
Facebook Graph API integration for Page publishing.

Supports:
  - Discovering pages the user manages
  - Publishing single-photo posts to a Page
  - Publishing multi-photo posts (carousel) to a Page
  - Scheduling posts

All operations require a valid Page Access Token.
"""
from __future__ import annotations

import logging
from pathlib import Path
from typing import Any, Callable

import httpx

logger = logging.getLogger("photopilot.social.facebook")

GRAPH_API_BASE = "https://graph.facebook.com/v19.0"


class FacebookPublishError(Exception):
    """Raised when a Facebook API call fails."""
    pass


def verify_token(access_token: str) -> dict[str, Any]:
    """Verify a Page Access Token and return basic page info."""
    try:
        resp = httpx.get(
            f"{GRAPH_API_BASE}/me",
            params={"access_token": access_token, "fields": "id,name,category,picture"},
            timeout=10,
        )
        data = resp.json()
        if "error" in data:
            raise FacebookPublishError(data["error"].get("message", "Invalid token"))
        return data
    except httpx.HTTPError as exc:
        raise FacebookPublishError(f"Network error: {exc}") from exc


def get_managed_pages(user_access_token: str) -> list[dict[str, Any]]:
    """
    Retrieve pages the user manages using a User Access Token.
    Returns list of {id, name, access_token, category, picture}.
    """
    try:
        resp = httpx.get(
            f"{GRAPH_API_BASE}/me/accounts",
            params={
                "access_token": user_access_token,
                "fields": "id,name,access_token,category,picture",
            },
            timeout=15,
        )
        data = resp.json()
        if "error" in data:
            raise FacebookPublishError(data["error"].get("message", "Could not fetch pages"))
        return data.get("data", [])
    except httpx.HTTPError as exc:
        raise FacebookPublishError(f"Network error: {exc}") from exc


def publish_single_photo(
    page_id: str,
    page_access_token: str,
    photo_path: str,
    caption: str = "",
) -> dict[str, Any]:
    """
    Publish a single photo to a Facebook Page.
    Returns {"id": "post_id", "post_id": "page_post_id"}.
    """
    photo = Path(photo_path)
    if not photo.exists():
        raise FacebookPublishError(f"Photo not found: {photo_path}")

    try:
        with open(photo, "rb") as f:
            resp = httpx.post(
                f"{GRAPH_API_BASE}/{page_id}/photos",
                data={
                    "access_token": page_access_token,
                    "message": caption,
                    "published": "true",
                },
                files={"source": (photo.name, f, "image/jpeg")},
                timeout=60,
            )
        data = resp.json()
        if "error" in data:
            raise FacebookPublishError(data["error"].get("message", "Publishing failed"))
        return data
    except httpx.HTTPError as exc:
        raise FacebookPublishError(f"Network error: {exc}") from exc


def publish_multi_photo(
    page_id: str,
    page_access_token: str,
    photo_paths: list[str],
    caption: str = "",
    progress_cb: Callable[[int, int], None] | None = None,
) -> dict[str, Any]:
    """
    Publish multiple photos as a carousel post to a Facebook Page.
    Step 1: Upload each photo as unpublished
    Step 2: Create a feed post that groups them
    """
    if not photo_paths:
        raise FacebookPublishError("No photos provided")

    if len(photo_paths) == 1:
        return publish_single_photo(page_id, page_access_token, photo_paths[0], caption)

    # Step 1: Upload each photo unpublished
    photo_ids = []
    total = len(photo_paths)
    for index, path_str in enumerate(photo_paths, start=1):
        photo = Path(path_str)
        if not photo.exists():
            logger.warning("Skipping missing photo: %s", path_str)
            if progress_cb:
                progress_cb(index, total)
            continue
        try:
            with open(photo, "rb") as f:
                resp = httpx.post(
                    f"{GRAPH_API_BASE}/{page_id}/photos",
                    data={
                        "access_token": page_access_token,
                        "published": "false",
                    },
                    files={"source": (photo.name, f, "image/jpeg")},
                    timeout=60,
                )
            data = resp.json()
            if "error" in data:
                logger.warning("Failed to upload %s: %s", photo.name, data["error"])
                continue
            photo_ids.append(data["id"])
        except httpx.HTTPError as exc:
            logger.warning("Network error uploading %s: %s", photo.name, exc)
        if progress_cb:
            progress_cb(index, total)

    if not photo_ids:
        raise FacebookPublishError("All photo uploads failed")

    # Step 2: Create the multi-photo post
    try:
        post_data: dict[str, Any] = {
            "access_token": page_access_token,
            "message": caption,
        }
        for i, pid in enumerate(photo_ids):
            post_data[f"attached_media[{i}]"] = f'{{"media_fbid":"{pid}"}}'

        resp = httpx.post(
            f"{GRAPH_API_BASE}/{page_id}/feed",
            data=post_data,
            timeout=30,
        )
        data = resp.json()
        if "error" in data:
            raise FacebookPublishError(data["error"].get("message", "Multi-photo post failed"))
        return data
    except httpx.HTTPError as exc:
        raise FacebookPublishError(f"Network error: {exc}") from exc


def schedule_post(
    page_id: str,
    page_access_token: str,
    photo_paths: list[str],
    caption: str = "",
    scheduled_publish_time: int = 0,
) -> dict[str, Any]:
    """
    Schedule a post for future publication.
    scheduled_publish_time is a Unix timestamp (must be 10min to 75 days in the future).
    """
    if not scheduled_publish_time:
        raise FacebookPublishError("scheduled_publish_time is required")

    if len(photo_paths) == 1:
        photo = Path(photo_paths[0])
        if not photo.exists():
            raise FacebookPublishError(f"Photo not found: {photo_paths[0]}")
        try:
            with open(photo, "rb") as f:
                resp = httpx.post(
                    f"{GRAPH_API_BASE}/{page_id}/photos",
                    data={
                        "access_token": page_access_token,
                        "message": caption,
                        "published": "false",
                        "scheduled_publish_time": str(scheduled_publish_time),
                    },
                    files={"source": (photo.name, f, "image/jpeg")},
                    timeout=60,
                )
            data = resp.json()
            if "error" in data:
                raise FacebookPublishError(data["error"].get("message", "Schedule failed"))
            return data
        except httpx.HTTPError as exc:
            raise FacebookPublishError(f"Network error: {exc}") from exc
    else:
        # Multi-photo scheduled: upload unpublished then schedule the feed post
        photo_ids = []
        for path_str in photo_paths:
            photo = Path(path_str)
            if not photo.exists():
                continue
            try:
                with open(photo, "rb") as f:
                    resp = httpx.post(
                        f"{GRAPH_API_BASE}/{page_id}/photos",
                        data={"access_token": page_access_token, "published": "false"},
                        files={"source": (photo.name, f, "image/jpeg")},
                        timeout=60,
                    )
                data = resp.json()
                if "id" in data:
                    photo_ids.append(data["id"])
            except httpx.HTTPError:
                continue

        if not photo_ids:
            raise FacebookPublishError("All photo uploads failed for schedule")

        post_data: dict[str, Any] = {
            "access_token": page_access_token,
            "message": caption,
            "published": "false",
            "scheduled_publish_time": str(scheduled_publish_time),
        }
        for i, pid in enumerate(photo_ids):
            post_data[f"attached_media[{i}]"] = f'{{"media_fbid":"{pid}"}}'

        try:
            resp = httpx.post(f"{GRAPH_API_BASE}/{page_id}/feed", data=post_data, timeout=30)
            data = resp.json()
            if "error" in data:
                raise FacebookPublishError(data["error"].get("message", "Schedule failed"))
            return data
        except httpx.HTTPError as exc:
            raise FacebookPublishError(f"Network error: {exc}") from exc


def publish_facebook_reel(
    page_id: str,
    page_access_token: str,
    video_path: str,
    caption: str = "",
    scheduled_publish_time: int = 0,
) -> dict[str, Any]:
    """Publish a short vertical video to Facebook Page Reels."""
    from ..video.reels import FacebookVideoError, publish_facebook_reel as _pub_reel
    try:
        return _pub_reel(
            page_id=page_id,
            page_access_token=page_access_token,
            video_path=video_path,
            caption=caption,
            scheduled_publish_time=scheduled_publish_time,
        )
    except FacebookVideoError as exc:
        raise FacebookPublishError(str(exc)) from exc


def publish_standard_video(
    page_id: str,
    page_access_token: str,
    video_path: str,
    title: str = "",
    description: str = "",
    scheduled_publish_time: int = 0,
) -> dict[str, Any]:
    """Publish a standard or long-form video to Facebook Page Feed."""
    from ..video.reels import FacebookVideoError, publish_standard_facebook_video as _pub_video
    try:
        return _pub_video(
            page_id=page_id,
            page_access_token=page_access_token,
            video_path=video_path,
            title=title,
            description=description,
            scheduled_publish_time=scheduled_publish_time,
        )
    except FacebookVideoError as exc:
        raise FacebookPublishError(str(exc)) from exc
