"""
Social feature persistence — SQLite database for posts, captions, hashtags, and Facebook connections.
"""
from __future__ import annotations

import json
import sqlite3
import time
from pathlib import Path
from typing import Any
from uuid import uuid4

ROOT = Path(__file__).resolve().parents[2]
DB_PATH = ROOT / "logs" / "social.db"


def _connect() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(DB_PATH), check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def _init_tables(conn: sqlite3.Connection) -> None:
    conn.executescript("""
        CREATE TABLE IF NOT EXISTS facebook_connections (
            id           TEXT PRIMARY KEY,
            page_id      TEXT NOT NULL,
            page_name    TEXT NOT NULL,
            access_token TEXT NOT NULL,
            category     TEXT DEFAULT '',
            picture_url  TEXT DEFAULT '',
            connected_at REAL NOT NULL,
            is_active    INTEGER DEFAULT 1
        );

        CREATE TABLE IF NOT EXISTS post_drafts (
            id            TEXT PRIMARY KEY,
            title         TEXT DEFAULT '',
            caption       TEXT DEFAULT '',
            hashtags      TEXT DEFAULT '[]',
            photo_paths   TEXT DEFAULT '[]',
            page_id       TEXT DEFAULT '',
            status        TEXT DEFAULT 'draft',
            scheduled_at  REAL DEFAULT 0,
            created_at    REAL NOT NULL,
            updated_at    REAL NOT NULL
        );

        CREATE TABLE IF NOT EXISTS published_posts (
            id             TEXT PRIMARY KEY,
            draft_id       TEXT,
            fb_post_id     TEXT DEFAULT '',
            page_id        TEXT DEFAULT '',
            page_name      TEXT DEFAULT '',
            caption        TEXT DEFAULT '',
            hashtags       TEXT DEFAULT '[]',
            photo_paths    TEXT DEFAULT '[]',
            published_at   REAL NOT NULL,
            status         TEXT DEFAULT 'published',
            error          TEXT DEFAULT ''
        );

        CREATE TABLE IF NOT EXISTS hashtag_sets (
            id         TEXT PRIMARY KEY,
            name       TEXT NOT NULL,
            hashtags   TEXT DEFAULT '[]',
            created_at REAL NOT NULL
        );
    """)


_conn: sqlite3.Connection | None = None


def _db() -> sqlite3.Connection:
    global _conn
    if _conn is None:
        _conn = _connect()
        _init_tables(_conn)
    return _conn


# ──────────────────────────────────────
# Facebook Page Connections
# ──────────────────────────────────────

def save_facebook_page(page_id: str, page_name: str, access_token: str,
                       category: str = "", picture_url: str = "") -> dict[str, Any]:
    conn = _db()
    row_id = uuid4().hex
    now = time.time()
    # Upsert: if page_id already exists, update instead
    existing = conn.execute("SELECT id FROM facebook_connections WHERE page_id=?", (page_id,)).fetchone()
    if existing:
        conn.execute("""
            UPDATE facebook_connections
            SET page_name=?, access_token=?, category=?, picture_url=?, connected_at=?, is_active=1
            WHERE page_id=?
        """, (page_name, access_token, category, picture_url, now, page_id))
        row_id = existing["id"]
    else:
        conn.execute("""
            INSERT INTO facebook_connections (id, page_id, page_name, access_token, category, picture_url, connected_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        """, (row_id, page_id, page_name, access_token, category, picture_url, now))
    conn.commit()
    return get_facebook_page(page_id) or {}


def list_facebook_pages() -> list[dict[str, Any]]:
    conn = _db()
    rows = conn.execute("SELECT * FROM facebook_connections WHERE is_active=1 ORDER BY connected_at DESC").fetchall()
    return [dict(r) for r in rows]


def get_facebook_page(page_id: str) -> dict[str, Any] | None:
    conn = _db()
    row = conn.execute("SELECT * FROM facebook_connections WHERE page_id=?", (page_id,)).fetchone()
    return dict(row) if row else None


def remove_facebook_page(page_id: str) -> bool:
    conn = _db()
    conn.execute("UPDATE facebook_connections SET is_active=0 WHERE page_id=?", (page_id,))
    conn.commit()
    return True


# ──────────────────────────────────────
# Post Drafts
# ──────────────────────────────────────

def create_draft(
    caption: str = "",
    hashtags: list[str] | None = None,
    photo_paths: list[str] | None = None,
    page_id: str = "",
    title: str = "",
) -> dict[str, Any]:
    conn = _db()
    draft_id = uuid4().hex
    now = time.time()
    conn.execute("""
        INSERT INTO post_drafts (id, title, caption, hashtags, photo_paths, page_id, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, 'draft', ?, ?)
    """, (draft_id, title, caption, json.dumps(hashtags or []), json.dumps(photo_paths or []), page_id, now, now))
    conn.commit()
    return get_draft(draft_id) or {}


def get_draft(draft_id: str) -> dict[str, Any] | None:
    conn = _db()
    row = conn.execute("SELECT * FROM post_drafts WHERE id=?", (draft_id,)).fetchone()
    if not row:
        return None
    d = dict(row)
    d["hashtags"] = json.loads(d["hashtags"])
    d["photo_paths"] = json.loads(d["photo_paths"])
    return d


def list_drafts(status: str = "") -> list[dict[str, Any]]:
    conn = _db()
    if status:
        rows = conn.execute("SELECT * FROM post_drafts WHERE status=? ORDER BY updated_at DESC", (status,)).fetchall()
    else:
        rows = conn.execute("SELECT * FROM post_drafts ORDER BY updated_at DESC").fetchall()
    results = []
    for r in rows:
        d = dict(r)
        d["hashtags"] = json.loads(d["hashtags"])
        d["photo_paths"] = json.loads(d["photo_paths"])
        results.append(d)
    return results


def update_draft(draft_id: str, **fields: Any) -> dict[str, Any] | None:
    conn = _db()
    allowed = {"title", "caption", "hashtags", "photo_paths", "page_id", "status", "scheduled_at"}
    sets = []
    vals = []
    for k, v in fields.items():
        if k not in allowed:
            continue
        if k in ("hashtags", "photo_paths"):
            v = json.dumps(v)
        sets.append(f"{k}=?")
        vals.append(v)
    if not sets:
        return get_draft(draft_id)
    sets.append("updated_at=?")
    vals.append(time.time())
    vals.append(draft_id)
    conn.execute(f"UPDATE post_drafts SET {', '.join(sets)} WHERE id=?", vals)
    conn.commit()
    return get_draft(draft_id)


def delete_draft(draft_id: str) -> bool:
    conn = _db()
    conn.execute("DELETE FROM post_drafts WHERE id=?", (draft_id,))
    conn.commit()
    return True


# ──────────────────────────────────────
# Published Posts
# ──────────────────────────────────────

def record_published_post(
    draft_id: str = "",
    fb_post_id: str = "",
    page_id: str = "",
    page_name: str = "",
    caption: str = "",
    hashtags: list[str] | None = None,
    photo_paths: list[str] | None = None,
    status: str = "published",
    error: str = "",
) -> dict[str, Any]:
    conn = _db()
    post_id = uuid4().hex
    now = time.time()
    conn.execute("""
        INSERT INTO published_posts
        (id, draft_id, fb_post_id, page_id, page_name, caption, hashtags, photo_paths, published_at, status, error)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (post_id, draft_id, fb_post_id, page_id, page_name, caption,
          json.dumps(hashtags or []), json.dumps(photo_paths or []), now, status, error))
    # Mark draft as published
    if draft_id:
        conn.execute("UPDATE post_drafts SET status='published', updated_at=? WHERE id=?", (now, draft_id))
    conn.commit()
    return {"id": post_id, "fb_post_id": fb_post_id, "status": status}


def list_published_posts(limit: int = 50) -> list[dict[str, Any]]:
    conn = _db()
    rows = conn.execute("SELECT * FROM published_posts ORDER BY published_at DESC LIMIT ?", (limit,)).fetchall()
    results = []
    for r in rows:
        d = dict(r)
        d["hashtags"] = json.loads(d["hashtags"])
        d["photo_paths"] = json.loads(d["photo_paths"])
        results.append(d)
    return results


# ──────────────────────────────────────
# Hashtag Sets (Saved collections)
# ──────────────────────────────────────

def save_hashtag_set(name: str, hashtags: list[str]) -> dict[str, Any]:
    conn = _db()
    set_id = uuid4().hex
    now = time.time()
    conn.execute("""
        INSERT INTO hashtag_sets (id, name, hashtags, created_at)
        VALUES (?, ?, ?, ?)
    """, (set_id, name, json.dumps(hashtags), now))
    conn.commit()
    return {"id": set_id, "name": name, "hashtags": hashtags}


def list_hashtag_sets() -> list[dict[str, Any]]:
    conn = _db()
    rows = conn.execute("SELECT * FROM hashtag_sets ORDER BY created_at DESC").fetchall()
    results = []
    for r in rows:
        d = dict(r)
        d["hashtags"] = json.loads(d["hashtags"])
        results.append(d)
    return results


def delete_hashtag_set(set_id: str) -> bool:
    conn = _db()
    conn.execute("DELETE FROM hashtag_sets WHERE id=?", (set_id,))
    conn.commit()
    return True
