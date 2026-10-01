from __future__ import annotations

import json
import sqlite3
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
LOGS_DIR = ROOT / "logs"
DB_PATH = LOGS_DIR / "curation.db"


def get_db_connection() -> sqlite3.Connection:
    LOGS_DIR.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(DB_PATH), timeout=20.0)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.execute("PRAGMA synchronous=NORMAL;")
    return conn


def init_database() -> None:
    """Initialize SQLite tables for photo analysis caching and curation jobs."""
    conn = get_db_connection()
    try:
        with conn:
            conn.execute("""
            CREATE TABLE IF NOT EXISTS photo_cache (
                sha256 TEXT PRIMARY KEY,
                file_path TEXT NOT NULL,
                file_size INTEGER NOT NULL,
                modified_time REAL NOT NULL,
                phash TEXT,
                dhash TEXT,
                ahash TEXT,
                width INTEGER,
                height INTEGER,
                sharpness_raw REAL,
                sharpness_score REAL,
                blur_score REAL,
                is_blurry INTEGER,
                exposure_score REAL,
                exposure_label TEXT,
                resolution_score REAL,
                noise_score REAL,
                face_count INTEGER,
                face_score REAL,
                face_details_json TEXT,
                quality_score REAL,
                embedding_blob BLOB,
                analyzed_at REAL NOT NULL
            );
            """)

            conn.execute("""
            CREATE INDEX IF NOT EXISTS idx_photo_cache_path ON photo_cache(file_path, file_size, modified_time);
            """)

            conn.execute("""
            CREATE TABLE IF NOT EXISTS curation_jobs (
                job_id TEXT PRIMARY KEY,
                status TEXT NOT NULL,
                stage TEXT NOT NULL,
                progress_pct REAL NOT NULL,
                total INTEGER NOT NULL,
                analyzed INTEGER NOT NULL,
                exact_duplicates INTEGER NOT NULL DEFAULT 0,
                similar_groups INTEGER NOT NULL DEFAULT 0,
                recommended_count INTEGER NOT NULL DEFAULT 0,
                error TEXT,
                result_json TEXT,
                created_at REAL NOT NULL,
                updated_at REAL NOT NULL
            );
            """)
    finally:
        conn.close()


def get_cached_photo(file_path: str, file_size: int, modified_time: float) -> Optional[Dict[str, Any]]:
    """Retrieve cached analysis if file path, size and mtime match."""
    conn = get_db_connection()
    try:
        cur = conn.execute(
            """
            SELECT * FROM photo_cache
            WHERE file_path = ? AND file_size = ? AND abs(modified_time - ?) < 0.01
            LIMIT 1;
            """,
            (file_path, file_size, modified_time),
        )
        row = cur.fetchone()
        if row:
            return _row_to_dict(row)
        return None
    finally:
        conn.close()


def get_cached_by_sha256(sha256: str) -> Optional[Dict[str, Any]]:
    """Retrieve cached analysis by exact SHA-256."""
    conn = get_db_connection()
    try:
        cur = conn.execute("SELECT * FROM photo_cache WHERE sha256 = ? LIMIT 1;", (sha256,))
        row = cur.fetchone()
        if row:
            return _row_to_dict(row)
        return None
    finally:
        conn.close()


import struct


def _to_float(v: Any) -> Optional[float]:
    if v is None:
        return None
    if isinstance(v, (int, float)):
        return float(v)
    if isinstance(v, (bytes, bytearray)):
        if len(v) == 4:
            return float(struct.unpack("<f", v)[0])
        elif len(v) == 8:
            return float(struct.unpack("<d", v)[0])
    try:
        return float(v)
    except Exception:
        return None


def save_cached_photo(data: Dict[str, Any]) -> None:
    """Insert or update photo analysis cache."""
    conn = get_db_connection()
    try:
        emb_blob = None
        if "embedding" in data and data["embedding"] is not None:
            emb = np.asarray(data["embedding"], dtype=np.float32)
            emb_blob = emb.tobytes()

        with conn:
            conn.execute(
                """
                INSERT OR REPLACE INTO photo_cache (
                    sha256, file_path, file_size, modified_time,
                    phash, dhash, ahash, width, height,
                    sharpness_raw, sharpness_score, blur_score, is_blurry,
                    exposure_score, exposure_label, resolution_score, noise_score,
                    face_count, face_score, face_details_json, quality_score,
                    embedding_blob, analyzed_at
                ) VALUES (
                    ?, ?, ?, ?,
                    ?, ?, ?, ?, ?,
                    ?, ?, ?, ?,
                    ?, ?, ?, ?,
                    ?, ?, ?, ?,
                    ?, ?
                );
                """,
                (
                    data["sha256"],
                    data["file_path"],
                    int(data["file_size"]),
                    float(data["modified_time"]),
                    data.get("phash"),
                    data.get("dhash"),
                    data.get("ahash"),
                    int(data["width"]) if data.get("width") is not None else None,
                    int(data["height"]) if data.get("height") is not None else None,
                    _to_float(data.get("sharpness_raw")),
                    _to_float(data.get("sharpness_score")),
                    _to_float(data.get("blur_score")),
                    1 if data.get("is_blurry") else 0,
                    _to_float(data.get("exposure_score")),
                    data.get("exposure_label"),
                    _to_float(data.get("resolution_score")),
                    _to_float(data.get("noise_score")),
                    int(data["face_count"]) if data.get("face_count") is not None else 0,
                    _to_float(data.get("face_score")),
                    json.dumps(data.get("face_details")) if data.get("face_details") else None,
                    _to_float(data.get("quality_score")),
                    emb_blob,
                    time.time(),
                ),
            )
    finally:
        conn.close()


def _row_to_dict(row: sqlite3.Row) -> Dict[str, Any]:
    res = dict(row)
    if res.get("embedding_blob"):
        res["embedding"] = np.frombuffer(res["embedding_blob"], dtype=np.float32)
    else:
        res["embedding"] = None
    res["is_blurry"] = bool(res.get("is_blurry", 0))

    # Clean numeric fields that might have been stored as numpy bytes
    float_fields = [
        "sharpness_raw", "sharpness_score", "blur_score",
        "exposure_score", "resolution_score", "noise_score",
        "face_score", "quality_score",
    ]
    for ff in float_fields:
        if ff in res:
            res[ff] = _to_float(res[ff])

    if res.get("face_details_json"):
        try:
            res["face_details"] = json.loads(res["face_details_json"])
        except Exception:
            res["face_details"] = None
    return res



# Curation Job Management
def create_curation_job(job_id: str, total_files: int) -> None:
    conn = get_db_connection()
    try:
        now = time.time()
        with conn:
            conn.execute(
                """
                INSERT OR REPLACE INTO curation_jobs (
                    job_id, status, stage, progress_pct, total, analyzed,
                    exact_duplicates, similar_groups, recommended_count,
                    error, result_json, created_at, updated_at
                ) VALUES (?, 'running', 'Initializing', 0.0, ?, 0, 0, 0, 0, NULL, NULL, ?, ?);
                """,
                (job_id, total_files, now, now),
            )
    finally:
        conn.close()


def update_curation_job(job_id: str, **kwargs) -> None:
    conn = get_db_connection()
    try:
        kwargs["updated_at"] = time.time()
        set_clauses = [f"{k} = ?" for k in kwargs.keys()]
        values = list(kwargs.values()) + [job_id]
        with conn:
            conn.execute(f"UPDATE curation_jobs SET {', '.join(set_clauses)} WHERE job_id = ?;", values)
    finally:
        conn.close()


def get_curation_job(job_id: str) -> Optional[Dict[str, Any]]:
    conn = get_db_connection()
    try:
        cur = conn.execute("SELECT * FROM curation_jobs WHERE job_id = ? LIMIT 1;", (job_id,))
        row = cur.fetchone()
        if not row:
            return None
        res = dict(row)
        if res.get("result_json"):
            try:
                res["result"] = json.loads(res["result_json"])
            except Exception:
                res["result"] = None
        return res
    finally:
        conn.close()
