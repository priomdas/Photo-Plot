from __future__ import annotations

from typing import Any, Dict, List, Set


def select_best_n_diverse(
    groups: List[Dict[str, Any]],
    standalone_photos: List[Dict[str, Any]],
    target_count: int,
) -> List[str]:
    """
    Select the top N photos while preserving scene diversity.
    Phase 1: Ranks all unique scenes (recommended photo from each group + all standalones)
             by quality score and selects the highest quality distinct scenes.
    Phase 2: If target_count exceeds the total number of unique scenes, round-robin
             incorporates secondary shots from groups, ranked by quality.
    """
    if target_count <= 0:
        return []

    selected_ids: List[str] = []
    selected_set: Set[str] = set()

    # Collect all primary candidates (1 best photo per group + standalones)
    primary_candidates: List[Dict[str, Any]] = []

    for g in groups:
        rec_id = g.get("recommended_id")
        rec_photo = None
        for p in g.get("photos", []):
            if p["id"] == rec_id:
                rec_photo = p
                break
        if not rec_photo and g.get("photos"):
            rec_photo = g["photos"][0]

        if rec_photo:
            primary_candidates.append({
                "id": rec_photo["id"],
                "score": rec_photo.get("quality_score", 0.0),
                "group_id": g.get("group_id"),
            })

    for s in standalone_photos:
        primary_candidates.append({
            "id": s["id"],
            "score": s.get("quality_score", 0.0),
            "group_id": None,
        })

    # Sort primary candidates by quality score descending
    primary_candidates.sort(key=lambda x: x["score"], reverse=True)

    for item in primary_candidates:
        if len(selected_ids) >= target_count:
            break
        pid = item["id"]
        if pid not in selected_set:
            selected_ids.append(pid)
            selected_set.add(pid)

    # If target count still not reached, gather secondary candidates from groups
    if len(selected_ids) < target_count:
        secondary_candidates: List[Dict[str, Any]] = []
        for g in groups:
            for p in g.get("photos", []):
                if p["id"] not in selected_set:
                    secondary_candidates.append({
                        "id": p["id"],
                        "score": p.get("quality_score", 0.0),
                    })

        secondary_candidates.sort(key=lambda x: x["score"], reverse=True)
        for item in secondary_candidates:
            if len(selected_ids) >= target_count:
                break
            pid = item["id"]
            if pid not in selected_set:
                selected_ids.append(pid)
                selected_set.add(pid)

    return selected_ids


def apply_user_curation_decision(
    groups: List[Dict[str, Any]],
    standalone_photos: List[Dict[str, Any]],
    mode: str = "keep_recommended",  # "keep_recommended", "keep_all", "custom"
    custom_overrides: Dict[str, str] | None = None,  # { group_id: selected_photo_id }
) -> List[str]:
    """
    Apply user review decisions across groups.
    Returns list of chosen photo IDs ready for preset/export.
    """
    overrides = custom_overrides or {}
    selected_ids: List[str] = []

    # Standalone photos are kept by default
    for p in standalone_photos:
        selected_ids.append(p["id"])

    for g in groups:
        gid = g.get("group_id")
        if gid in overrides:
            chosen = overrides[gid]
            if chosen == "ALL":
                selected_ids.extend([p["id"] for p in g.get("photos", [])])
            elif chosen:
                selected_ids.append(chosen)
        elif mode == "keep_all":
            selected_ids.extend([p["id"] for p in g.get("photos", [])])
        else:
            rec_id = g.get("recommended_id")
            if rec_id:
                selected_ids.append(rec_id)
            elif g.get("photos"):
                selected_ids.append(g["photos"][0]["id"])

    return list(dict.fromkeys(selected_ids))
