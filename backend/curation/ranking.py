from __future__ import annotations

from typing import Any, Dict, List, Tuple

from .config import QualityWeights


def compute_composite_quality_score(
    metrics: Dict[str, Any],
    weights: QualityWeights,
) -> Tuple[float, float]:
    """
    Compute normalized composite quality score (0.0 to 100.0).
    Returns (display_score_rounded, precise_score_unrounded).
    Dynamically normalizes weights when any metric (like face quality) is absent.
    """
    active_weights: Dict[str, float] = {}
    values: Dict[str, float] = {}

    # Sharpness
    if "sharpness_score" in metrics and metrics["sharpness_score"] is not None:
        active_weights["sharpness"] = weights.sharpness
        values["sharpness"] = float(metrics["sharpness_score"])

    # Exposure
    if "exposure_score" in metrics and metrics["exposure_score"] is not None:
        active_weights["exposure"] = weights.exposure
        values["exposure"] = float(metrics["exposure_score"])

    # Resolution
    if "resolution_score" in metrics and metrics["resolution_score"] is not None:
        active_weights["resolution"] = weights.resolution
        values["resolution"] = float(metrics["resolution_score"])

    # Noise
    if "noise_score" in metrics and metrics["noise_score"] is not None:
        active_weights["noise"] = weights.noise
        values["noise"] = float(metrics["noise_score"])

    # Face Quality (only if faces were detected)
    face_score = metrics.get("face_score")
    if face_score is not None:
        active_weights["face_quality"] = weights.face_quality
        values["face_quality"] = float(face_score)

    total_weight = sum(active_weights.values())
    if total_weight <= 0:
        return 50.0, 50.0

    # Normalized weighted average
    final_score = sum(values[k] * (active_weights[k] / total_weight) for k in active_weights)

    # Blur penalty
    if metrics.get("is_blurry", False):
        final_score -= 15.0

    # Exposure clipping penalty
    exp_label = metrics.get("exposure_label")
    if exp_label in ("Underexposed", "Overexposed"):
        final_score -= 8.0

    # Face blink penalty
    face_details = metrics.get("face_details") or {}
    for f in face_details.get("faces", []):
        if not f.get("left_eye_open", True) or not f.get("right_eye_open", True):
            final_score -= 10.0
            break

    precise = max(0.0, min(100.0, final_score))
    display = round(precise, 1)
    return display, precise


def rank_photos_in_group(
    photos_data: List[Dict[str, Any]],
    weights: QualityWeights,
) -> tuple[str, List[Dict[str, Any]]]:
    """
    Rank all photos in a similarity group by quality score.
    Returns (recommended_best_photo_id, sorted_ranked_photos_list).
    """
    ranked = []
    for item in photos_data:
        disp_score, precise_score = compute_composite_quality_score(item, weights)
        copied = dict(item)
        copied["quality_score"] = disp_score
        copied["_precise_score"] = precise_score
        ranked.append(copied)

    # Sort descending: precise composite score -> raw laplacian variance -> sharpness score -> resolution
    ranked.sort(
        key=lambda x: (
            x.get("_precise_score", 0.0),
            x.get("sharpness_raw", 0.0),
            x.get("sharpness_score", 0.0),
            x.get("resolution_score", 0.0),
        ),
        reverse=True,
    )

    best_id = ranked[0]["id"]
    for idx, item in enumerate(ranked):
        item["rank"] = idx + 1
        item["is_recommended"] = (idx == 0)
        item.pop("_precise_score", None)  # Clean up internal sort field

    return best_id, ranked
