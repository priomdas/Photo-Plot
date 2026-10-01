from __future__ import annotations

import gc
import json
import logging
import time
from pathlib import Path
from typing import Any, Callable, Dict, List

import cv2
import numpy as np
from PIL import Image

from .analyzer import analyze_photo_properties
from .config import CurationConfig, load_curation_config
from .database import (
    get_cached_by_sha256,
    get_cached_photo,
    init_database,
    save_cached_photo,
    update_curation_job,
)
from .embeddings import VisionEmbeddingExtractor
from .face import FaceQualityAnalyzer
from .grouping import cluster_into_groups
from .hasher import compute_ahash, compute_dhash, compute_phash, compute_sha256
from .ranking import rank_photos_in_group
from .selection import select_best_n_diverse
from .similarity import compare_images

logger = logging.getLogger("photopilot.curation")

SUPPORTED_EXTENSIONS = {
    ".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tiff", ".tif",
    ".dng", ".cr2", ".cr3", ".nef", ".arw", ".heic", ".heif",
}


def _load_image_bgr(path: Path) -> np.ndarray | None:
    """Safely load image as BGR numpy array supporting RAW and standard formats."""
    try:
        # Standard formats
        img = cv2.imread(str(path))
        if img is not None:
            return img
    except Exception:
        pass

    # PIL fallback (handles HEIF and other formats registered via pillow_heif)
    try:
        from PIL import Image, ImageOps
        with Image.open(path) as opened:
            transposed = ImageOps.exif_transpose(opened).convert("RGB")
            return cv2.cvtColor(np.asarray(transposed), cv2.COLOR_RGB2BGR)
    except Exception:
        pass

    # Rawpy fallback for camera RAW
    try:
        import rawpy
        with rawpy.imread(str(path)) as raw:
            rgb = raw.postprocess(use_camera_wb=True, half_size=True)
            return cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR)
    except Exception:
        pass

    return None


class CurationPipeline:
    def __init__(self, config: CurationConfig | None = None):
        self.config = config or load_curation_config()
        init_database()
        self.embedding_extractor = VisionEmbeddingExtractor(
            prefer_gpu=self.config.prefer_gpu,
            batch_size=self.config.embedding_batch_size,
        )
        self.face_analyzer = FaceQualityAnalyzer(use_gpu=self.config.prefer_gpu)

    def run(
        self,
        file_paths: List[Path],
        job_id: str | None = None,
        progress_cb: Callable[[str, float, int, int], None] | None = None,
    ) -> Dict[str, Any]:
        """
        Run the complete 8-stage curation pipeline over a list of photo paths.
        """
        total = len(file_paths)
        if total == 0:
            return {"groups": [], "standalone": [], "summary": {"total": 0}}

        def report(stage: str, pct: float, analyzed: int):
            if progress_cb:
                progress_cb(stage, pct, analyzed, total)
            if job_id:
                update_curation_job(
                    job_id,
                    stage=stage,
                    progress_pct=round(pct, 1),
                    analyzed=analyzed,
                    total=total,
                )

        report("Scanning files & cache", 5.0, 0)

        # Stage 1 & 2: Hash, metadata, quality & cache check
        analyzed_items: List[Dict[str, Any]] = []
        failed_files: List[Dict[str, str]] = []
        missing_embeddings: List[Dict[str, Any]] = []

        for idx, path in enumerate(file_paths):
            try:
                stat = path.stat()
                file_size = stat.st_size
                mtime = stat.st_mtime

                # Check cache first
                cached = get_cached_photo(str(path), file_size, mtime)
                if cached and cached.get("embedding") is not None:
                    cached["id"] = path.stem + "_" + cached["sha256"][:8]
                    cached["path"] = str(path)
                    cached["name"] = path.name
                    analyzed_items.append(cached)
                    report("Analyzing image properties", 5.0 + (idx / total) * 35.0, idx + 1)
                    continue

                # Compute exact SHA-256
                sha = compute_sha256(path)
                cached_sha = get_cached_by_sha256(sha)
                if cached_sha and cached_sha.get("embedding") is not None:
                    cached_sha["id"] = path.stem + "_" + sha[:8]
                    cached_sha["path"] = str(path)
                    cached_sha["name"] = path.name
                    cached_sha["file_path"] = str(path)
                    cached_sha["file_size"] = file_size
                    cached_sha["modified_time"] = mtime
                    save_cached_photo(cached_sha)
                    analyzed_items.append(cached_sha)
                    report("Analyzing image properties", 5.0 + (idx / total) * 35.0, idx + 1)
                    continue

                # Read image
                bgr = _load_image_bgr(path)
                if bgr is None:
                    failed_files.append({"file": path.name, "error": "Cannot decode image format"})
                    continue

                # Compute perceptual hashes
                phash_val = compute_phash(bgr)
                dhash_val = compute_dhash(bgr)
                ahash_val = compute_ahash(bgr)

                # Quality Analysis
                props = analyze_photo_properties(bgr)

                # Face Analysis
                face_data = self.face_analyzer.analyze(bgr)
                face_count = face_data["face_count"] if face_data else 0
                face_score = face_data["face_score"] if face_data else None

                item_record: Dict[str, Any] = {
                    "id": path.stem + "_" + sha[:8],
                    "sha256": sha,
                    "file_path": str(path),
                    "path": str(path),
                    "name": path.name,
                    "file_size": file_size,
                    "modified_time": mtime,
                    "phash": phash_val,
                    "dhash": dhash_val,
                    "ahash": ahash_val,
                    "width": props["width"],
                    "height": props["height"],
                    "sharpness_raw": props["sharpness_raw"],
                    "sharpness_score": props["sharpness_score"],
                    "blur_score": props["blur_score"],
                    "is_blurry": props["is_blurry"],
                    "exposure_score": props["exposure_score"],
                    "exposure_label": props["exposure_label"],
                    "resolution_score": props["resolution_score"],
                    "noise_score": props["noise_score"],
                    "face_count": face_count,
                    "face_score": face_score,
                    "face_details": face_data,
                    "embedding": None,
                }

                missing_embeddings.append({"record": item_record, "bgr": bgr})
                analyzed_items.append(item_record)

            except Exception as exc:
                logger.warning("Error analyzing %s: %s", path.name, exc)
                failed_files.append({"file": path.name, "error": str(exc)})

            report("Analyzing image properties", 5.0 + (idx / total) * 35.0, idx + 1)

            if idx % 20 == 0:
                gc.collect()

        # Stage 4: AI Visual Embeddings
        if missing_embeddings:
            report(f"Generating AI embeddings ({self.embedding_extractor.device_name})", 45.0, len(analyzed_items))
            bgr_images = [item["bgr"] for item in missing_embeddings]
            vectors = self.embedding_extractor.extract_batch(bgr_images)
            for item_wrap, vec in zip(missing_embeddings, vectors):
                item_wrap["record"]["embedding"] = vec
                save_cached_photo(item_wrap["record"])
                del item_wrap["bgr"]  # Release image memory immediately
            missing_embeddings.clear()
            gc.collect()

        report("Comparing similarity pairs", 65.0, len(analyzed_items))

        # Stage 5: Pairwise Similarity & Clustering
        pairs = []
        n_items = len(analyzed_items)
        for i in range(n_items):
            item1 = analyzed_items[i]
            for j in range(i + 1, n_items):
                item2 = analyzed_items[j]

                # Fast heuristic: if SHA match, exact
                if item1["sha256"] == item2["sha256"]:
                    pair = compare_images(
                        item1["id"], item2["id"],
                        item1["sha256"], item2["sha256"],
                        item1["phash"], item2["phash"],
                        item1["dhash"], item2["dhash"],
                        item1["embedding"], item2["embedding"],
                        self.config,
                    )
                    pairs.append(pair)
                    continue

                # Check pHash first (cheap bitwise popcount)
                pair = compare_images(
                    item1["id"], item2["id"],
                    item1["sha256"], item2["sha256"],
                    item1["phash"], item2["phash"],
                    item1["dhash"], item2["dhash"],
                    item1["embedding"], item2["embedding"],
                    self.config,
                )
                if pair.relation != "Distinct":
                    pairs.append(pair)

        report("Grouping and ranking photo quality", 80.0, len(analyzed_items))

        # Grouping
        all_ids = [item["id"] for item in analyzed_items]
        id_to_item = {item["id"]: item for item in analyzed_items}
        clusters = cluster_into_groups(all_ids, pairs)

        # Stage 7: Quality Ranking inside each group
        grouped_ids = set()
        final_groups = []
        for cluster in clusters:
            grouped_ids.update(cluster.photo_ids)
            members = [id_to_item[pid] for pid in cluster.photo_ids if pid in id_to_item]
            rec_id, ranked_members = rank_photos_in_group(members, self.config.weights)
            cluster.recommended_id = rec_id
            final_groups.append({
                "group_id": cluster.group_id,
                "group_type": cluster.group_type,
                "similarity_score": cluster.similarity_score,
                "recommended_id": rec_id,
                "photos": [
                    {
                        "id": m["id"],
                        "name": m["name"],
                        "path": m["path"],
                        "file_size": m["file_size"],
                        "width": m["width"],
                        "height": m["height"],
                        "quality_score": m.get("quality_score", 0.0),
                        "sharpness_score": m.get("sharpness_score", 0.0),
                        "exposure_label": m.get("exposure_label", "Balanced"),
                        "face_count": m.get("face_count", 0),
                        "is_blurry": m.get("is_blurry", False),
                        "is_recommended": (m["id"] == rec_id),
                        "rank": m.get("rank", 1),
                    }
                    for m in ranked_members
                ],
            })

        # Standalone (unique) photos
        standalone = []
        for item in analyzed_items:
            if item["id"] not in grouped_ids:
                from .ranking import compute_composite_quality_score
                q_score, _ = compute_composite_quality_score(item, self.config.weights)
                standalone.append({
                    "id": item["id"],
                    "name": item["name"],
                    "path": item["path"],
                    "file_size": item["file_size"],
                    "width": item["width"],
                    "height": item["height"],
                    "quality_score": q_score,
                    "sharpness_score": item.get("sharpness_score", 0.0),
                    "exposure_label": item.get("exposure_label", "Balanced"),
                    "face_count": item.get("face_count", 0),
                    "is_blurry": item.get("is_blurry", False),
                    "is_recommended": True,
                    "rank": 1,
                })

        report("Finalizing curation recommendations", 95.0, len(analyzed_items))

        # Count statistics
        exact_dup_groups = [g for g in final_groups if g["group_type"] == "Exact Duplicate"]
        similar_scene_groups = [g for g in final_groups if g["group_type"] != "Exact Duplicate"]
        total_recommended = len(final_groups) + len(standalone)

        result_payload = {
            "summary": {
                "total": total,
                "analyzed": len(analyzed_items),
                "failed": len(failed_files),
                "exact_duplicate_groups": len(exact_dup_groups),
                "similar_groups": len(similar_scene_groups),
                "standalone_count": len(standalone),
                "recommended_count": total_recommended,
                "ai_device": self.embedding_extractor.device_name,
            },
            "groups": final_groups,
            "standalone": standalone,
            "failed_files": failed_files,
        }

        report("Complete", 100.0, len(analyzed_items))

        if job_id:
            update_curation_job(
                job_id,
                status="complete",
                stage="Complete",
                progress_pct=100.0,
                exact_duplicates=len(exact_dup_groups),
                similar_groups=len(similar_scene_groups),
                recommended_count=total_recommended,
                result_json=json.dumps(result_payload),
            )

        return result_payload
