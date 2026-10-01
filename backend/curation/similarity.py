from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

import numpy as np

from .config import CurationConfig
from .hasher import hamming_distance

RelationType = Literal[
    "Exact Duplicate",
    "Near Duplicate",
    "Very Similar",
    "Similar Scene",
    "Distinct",
]


@dataclass
class SimilarityPair:
    id1: str
    id2: str
    relation: RelationType
    sha_match: bool
    phash_distance: int
    dhash_distance: int
    embedding_similarity: float
    confidence: float


def cosine_similarity(vec1: np.ndarray, vec2: np.ndarray) -> float:
    """Compute cosine similarity between two 1D vectors."""
    n1 = np.linalg.norm(vec1)
    n2 = np.linalg.norm(vec2)
    if n1 < 1e-8 or n2 < 1e-8:
        return 0.0
    return float(np.dot(vec1, vec2) / (n1 * n2))


def compare_images(
    id1: str,
    id2: str,
    sha1: str,
    sha2: str,
    phash1: str,
    phash2: str,
    dhash1: str,
    dhash2: str,
    emb1: np.ndarray | None,
    emb2: np.ndarray | None,
    config: CurationConfig,
) -> SimilarityPair:
    """
    Combined multi-signal comparison logic:
    Exact Hash + pHash + dHash + AI Embedding Similarity.
    """
    # 1. Exact Duplicate (byte-for-byte SHA-256 match)
    sha_match = (sha1 == sha2)
    if sha_match:
        return SimilarityPair(
            id1=id1,
            id2=id2,
            relation="Exact Duplicate",
            sha_match=True,
            phash_distance=0,
            dhash_distance=0,
            embedding_similarity=1.0,
            confidence=1.0,
        )

    # 2. Perceptual hashes
    p_dist = hamming_distance(phash1, phash2)
    d_dist = hamming_distance(dhash1, dhash2)

    # 3. AI Embedding similarity
    emb_sim = 0.0
    if emb1 is not None and emb2 is not None:
        emb_sim = cosine_similarity(emb1, emb2)

    # 4. Multi-Signal Decision Rules
    # Exact duplicate (almost identical pHash & dHash or byte match)
    if (p_dist <= 2 and d_dist <= 2) and (emb_sim >= 0.985 or emb_sim == 0.0):
        relation: RelationType = "Exact Duplicate"
        confidence = 0.99
    # Near Duplicate: nearly identical composition/angle
    elif p_dist <= 4 or (p_dist <= 6 and d_dist <= 6 and emb_sim >= 0.95):
        relation = "Near Duplicate"
        confidence = 0.95
    # Burst Shot / Rapid Sequence: high visual embedding match
    elif emb_sim >= 0.975 or (emb_sim >= 0.962 and p_dist <= 12):
        relation = "Very Similar"
        confidence = 0.90
    # Similar Scene: tight framing of the same scene
    elif emb_sim >= 0.955 and p_dist <= 16:
        relation = "Similar Scene"
        confidence = 0.80
    else:
        relation = "Distinct"
        confidence = 0.0

    return SimilarityPair(
        id1=id1,
        id2=id2,
        relation=relation,
        sha_match=False,
        phash_distance=p_dist,
        dhash_distance=d_dist,
        embedding_similarity=round(emb_sim, 4),
        confidence=confidence,
    )

