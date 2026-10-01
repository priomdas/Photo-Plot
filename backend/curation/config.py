from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
CONFIG_FILE = ROOT / "config" / "curation_config.json"


@dataclass
class QualityWeights:
    sharpness: float = 0.35
    face_quality: float = 0.25
    exposure: float = 0.20
    resolution: float = 0.10
    noise: float = 0.10


@dataclass
class CurationConfig:
    # Exact duplicate: SHA-256 identical
    # Perceptual hash Hamming distance thresholds (out of 64 bits)
    phash_threshold: int = 8          # <= 8 indicates near-duplicate or closely related
    dhash_threshold: int = 10         # <= 10 difference hash

    # AI embedding cosine similarity threshold (0.0 to 1.0)
    embedding_similarity_threshold: float = 0.88   # >= 0.88 indicates visual scene similarity
    near_duplicate_embedding_threshold: float = 0.96 # >= 0.96 indicates near-identical shot

    # Batch GPU / CPU inference
    embedding_batch_size: int = 16
    prefer_gpu: bool = True

    # Quality scoring weights
    weights: QualityWeights = field(default_factory=QualityWeights)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> CurationConfig:
        weights_data = data.get("weights", {})
        weights = QualityWeights(
            sharpness=float(weights_data.get("sharpness", 0.35)),
            face_quality=float(weights_data.get("face_quality", 0.25)),
            exposure=float(weights_data.get("exposure", 0.20)),
            resolution=float(weights_data.get("resolution", 0.10)),
            noise=float(weights_data.get("noise", 0.10)),
        )
        return cls(
            phash_threshold=int(data.get("phash_threshold", 8)),
            dhash_threshold=int(data.get("dhash_threshold", 10)),
            embedding_similarity_threshold=float(data.get("embedding_similarity_threshold", 0.88)),
            near_duplicate_embedding_threshold=float(data.get("near_duplicate_embedding_threshold", 0.96)),
            embedding_batch_size=int(data.get("embedding_batch_size", 16)),
            prefer_gpu=bool(data.get("prefer_gpu", True)),
            weights=weights,
        )


def load_curation_config() -> CurationConfig:
    if CONFIG_FILE.exists():
        try:
            raw = json.loads(CONFIG_FILE.read_text(encoding="utf-8"))
            return CurationConfig.from_dict(raw)
        except Exception:
            pass
    cfg = CurationConfig()
    save_curation_config(cfg)
    return cfg


def save_curation_config(config: CurationConfig) -> None:
    CONFIG_FILE.parent.mkdir(parents=True, exist_ok=True)
    CONFIG_FILE.write_text(json.dumps(config.to_dict(), indent=2), encoding="utf-8")
