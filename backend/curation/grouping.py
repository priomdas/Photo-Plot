from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from typing import Any, Dict, List, Set, Tuple

from .similarity import SimilarityPair


@dataclass
class SimilarityGroup:
    group_id: str
    group_type: str  # "Exact Duplicate", "Near Duplicate", "Burst Sequence", "Similar Scene"
    photo_ids: List[str]
    representative_id: str | None = None
    recommended_id: str | None = None
    similarity_score: float = 1.0


def cluster_into_groups(
    all_photo_ids: List[str],
    pairs: List[SimilarityPair],
    max_group_size: int = 15,
) -> List[SimilarityGroup]:
    """
    Cluster pairwise similarities into cohesive groups using constrained
    agglomerative complete/average-linkage clustering.
    
    Prevents the single-linkage 'chaining effect' where loose pairwise links
    incorrectly collapse hundreds of distinct photos into a single giant blob.
    """
    if not all_photo_ids:
        return []

    # Fast lookup for pair relations and similarity
    pair_map: Dict[Tuple[str, str], SimilarityPair] = {}
    valid_pairs: List[SimilarityPair] = []

    for p in pairs:
        key = tuple(sorted([p.id1, p.id2]))
        pair_map[key] = p
        if p.relation != "Distinct":
            valid_pairs.append(p)

    # Sort valid pairs with highest confidence / similarity first
    valid_pairs.sort(
        key=lambda x: (
            1.0 if x.relation == "Exact Duplicate" else 0.0,
            x.confidence,
            x.embedding_similarity,
            -x.phash_distance,
        ),
        reverse=True,
    )

    # Cohesive agglomerative clustering
    # Initially each photo is in its own cluster
    cluster_of: Dict[str, str] = {pid: pid for pid in all_photo_ids}
    members: Dict[str, List[str]] = {pid: [pid] for pid in all_photo_ids}

    for p in valid_pairs:
        c1 = cluster_of[p.id1]
        c2 = cluster_of[p.id2]
        if c1 == c2:
            continue

        m1 = members[c1]
        m2 = members[c2]

        # Prevent runaway clusters that are too large for a burst group
        if len(m1) + len(m2) > max_group_size:
            continue

        # Cohesion check: ensure members of c1 and c2 are mutually similar
        can_merge = True

        # Special case: Exact Duplicates can always merge if all pairs match
        if p.relation == "Exact Duplicate":
            for u in m1:
                for v in m2:
                    k = tuple(sorted([u, v]))
                    if k in pair_map and pair_map[k].relation not in ("Exact Duplicate", "Near Duplicate"):
                        can_merge = False
                        break
                if not can_merge:
                    break
        else:
            # For Near Duplicates and Bursts, require high mutual cross-similarity
            cross_sims = []
            distinct_count = 0
            for u in m1:
                for v in m2:
                    k = tuple(sorted([u, v]))
                    if k in pair_map:
                        rel = pair_map[k].relation
                        sim = pair_map[k].embedding_similarity
                        if rel == "Distinct" or sim < 0.940:
                            distinct_count += 1
                        cross_sims.append(sim)
                    else:
                        # Unpaired / distant
                        distinct_count += 1
                        cross_sims.append(0.0)

            total_cross = len(m1) * len(m2)
            # We require that at least 70% of cross pairs are strongly similar
            # and average similarity is at least 0.955 (or pHash distance is small)
            if distinct_count > (total_cross * 0.35):
                can_merge = False
            elif cross_sims:
                avg_sim = sum(cross_sims) / len(cross_sims)
                if avg_sim < 0.950 and p.phash_distance > 6:
                    can_merge = False

        if can_merge:
            # Merge c2 into c1
            for u in m2:
                cluster_of[u] = c1
            members[c1].extend(m2)
            del members[c2]

    # Collect multi-photo clusters (size >= 2)
    clusters: List[SimilarityGroup] = []
    group_counter = 1

    # Sort groups so exact duplicates and larger burst groups appear first
    sorted_clusters = sorted(
        [m for m in members.values() if len(m) >= 2],
        key=lambda x: len(x),
        reverse=True,
    )

    for pids in sorted_clusters:
        # Determine dominant group type and average confidence
        relations: Set[str] = set()
        confidences: List[float] = []

        for i in range(len(pids)):
            for j in range(i + 1, len(pids)):
                k = tuple(sorted([pids[i], pids[j]]))
                if k in pair_map:
                    relations.add(pair_map[k].relation)
                    confidences.append(pair_map[k].confidence)

        if "Exact Duplicate" in relations and len(relations) == 1:
            g_type = "Exact Duplicate"
        elif "Near Duplicate" in relations:
            g_type = "Near Duplicate"
        elif "Very Similar" in relations:
            g_type = "Burst Sequence"
        else:
            g_type = "Similar Scene"

        avg_conf = float(sum(confidences) / max(1, len(confidences))) if confidences else 0.90

        clusters.append(
            SimilarityGroup(
                group_id=f"GRP_{group_counter:03d}",
                group_type=g_type,
                photo_ids=sorted(pids),
                representative_id=pids[0],
                recommended_id=None,
                similarity_score=round(avg_conf, 2),
            )
        )
        group_counter += 1

    return clusters
