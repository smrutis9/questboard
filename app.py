import os
import sqlite3
import secrets
from datetime import datetime
from flask import Flask, jsonify, request, render_template, abort, g

APP_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(APP_DIR, "questboard.db")

app = Flask(__name__)


# -----------------------------
# DB helpers
# -----------------------------
def get_db():
    if "db" not in g:
        conn = sqlite3.connect(DB_PATH)
        conn.row_factory = sqlite3.Row
        g.db = conn
    return g.db


@app.teardown_appcontext
def close_db(_exc):
    db = g.pop("db", None)
    if db is not None:
        db.close()


def init_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row

    conn.execute("""
    CREATE TABLE IF NOT EXISTS boards (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT UNIQUE NOT NULL,
      title TEXT NOT NULL,
      owner_name TEXT NOT NULL,
      bio TEXT DEFAULT '',
      is_public INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    """)

    conn.execute("""
    CREATE TABLE IF NOT EXISTS quests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      board_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      note TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'todo',
      x REAL NOT NULL DEFAULT 0.5,
      y REAL NOT NULL DEFAULT 0.5,
      color TEXT DEFAULT '#7c3aed',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY(board_id) REFERENCES boards(id)
    );
    """)

    conn.execute("""
    CREATE TABLE IF NOT EXISTS reactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      quest_id INTEGER NOT NULL,
      emoji TEXT NOT NULL,
      count INTEGER NOT NULL DEFAULT 0,
      UNIQUE(quest_id, emoji),
      FOREIGN KEY(quest_id) REFERENCES quests(id)
    );
    """)

    conn.execute("CREATE INDEX IF NOT EXISTS idx_quests_board ON quests(board_id);")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_reactions_quest ON reactions(quest_id);")

    conn.commit()
    conn.close()


def slugify(s: str) -> str:
    s = (s or "").strip().lower()
    out = []
    for c in s:
        if c.isalnum():
            out.append(c)
        else:
            out.append("-")
    slug = "".join(out).strip("-")
    while "--" in slug:
        slug = slug.replace("--", "-")
    return slug[:32] or "questboard"


def make_slug(title: str, owner: str) -> str:
    base = f"{slugify(title)}-{slugify(owner)}"
    return f"{base[:32]}-{secrets.token_hex(2)}"


def ensure_default_board(conn):
    row = conn.execute("SELECT id, slug FROM boards ORDER BY id ASC LIMIT 1").fetchone()
    if row:
        return dict(row)

    slug = make_slug("My Questboard", "You")
    conn.execute(
        "INSERT INTO boards (slug, title, owner_name, bio, is_public) VALUES (?, ?, ?, ?, ?)",
        (slug, "My Questboard", "You", "Drag quests onto the map. Share your board.", 1),
    )
    conn.commit()
    row2 = conn.execute("SELECT id, slug FROM boards WHERE slug = ?", (slug,)).fetchone()
    return dict(row2)


# -----------------------------
# Pages
# -----------------------------
@app.get("/")
def home():
    return render_template("index.html")


@app.get("/b/<slug>")
def public_board(slug):
    # Same frontend, but read-only and scoped to this board slug
    return render_template("index.html", public_slug=slug)


# -----------------------------
# API: boards
# -----------------------------
@app.get("/api/me/board")
def get_my_board():
    conn = get_db()
    b = ensure_default_board(conn)
    board = conn.execute(
        "SELECT id, slug, title, owner_name, bio, is_public, created_at FROM boards WHERE id=?",
        (b["id"],),
    ).fetchone()
    return jsonify(dict(board))


@app.patch("/api/me/board")
def update_my_board():
    data = request.get_json(force=True)
    title = (data.get("title") or "").strip()
    owner = (data.get("owner_name") or "").strip()
    bio = (data.get("bio") or "").strip()
    is_public = 1 if data.get("is_public") else 0

    conn = get_db()
    b = ensure_default_board(conn)

    # keep old values if blank
    current = conn.execute(
        "SELECT title, owner_name, bio, is_public FROM boards WHERE id=?",
        (b["id"],),
    ).fetchone()

    new_title = title if title else current["title"]
    new_owner = owner if owner else current["owner_name"]
    new_bio = bio if bio else current["bio"]

    conn.execute(
        "UPDATE boards SET title=?, owner_name=?, bio=?, is_public=? WHERE id=?",
        (new_title, new_owner, new_bio, is_public, b["id"]),
    )
    conn.commit()

    updated = conn.execute(
        "SELECT id, slug, title, owner_name, bio, is_public, created_at FROM boards WHERE id=?",
        (b["id"],),
    ).fetchone()
    return jsonify(dict(updated))


@app.get("/api/boards/<slug>")
def get_board(slug):
    conn = get_db()
    row = conn.execute(
        "SELECT id, slug, title, owner_name, bio, is_public, created_at FROM boards WHERE slug=?",
        (slug,),
    ).fetchone()
    if not row:
        abort(404)
    return jsonify(dict(row))


# -----------------------------
# API: quests
# -----------------------------
@app.get("/api/me/quests")
def get_my_quests():
    conn = get_db()
    b = ensure_default_board(conn)

    rows = conn.execute(
        "SELECT id, title, note, status, x, y, color, created_at FROM quests WHERE board_id=? ORDER BY id DESC",
        (b["id"],),
    ).fetchall()

    quests = [dict(r) for r in rows]
    _attach_reactions(conn, quests)
    return jsonify(quests)


@app.post("/api/me/quests")
def create_my_quest():
    data = request.get_json(force=True)
    title = (data.get("title") or "").strip()
    if not title:
        return jsonify({"error": "title required"}), 400

    note = (data.get("note") or "").strip()
    status = (data.get("status") or "todo").strip()
    x = float(data.get("x", 0.5))
    y = float(data.get("y", 0.5))
    color = (data.get("color") or "#7c3aed").strip()

    if status not in ("todo", "doing", "done"):
        status = "todo"

    conn = get_db()
    b = ensure_default_board(conn)

    cur = conn.execute(
        "INSERT INTO quests (board_id, title, note, status, x, y, color, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        (b["id"], title, note, status, x, y, color, datetime.utcnow().isoformat()),
    )
    conn.commit()
    quest_id = cur.lastrowid

    row = conn.execute(
        "SELECT id, title, note, status, x, y, color, created_at FROM quests WHERE id=?",
        (quest_id,),
    ).fetchone()
    quest = dict(row)
    quest["reactions"] = {"🔥": 0, "⭐": 0, "💯": 0}
    return jsonify(quest), 201


@app.patch("/api/me/quests/<int:quest_id>")
def update_my_quest(quest_id):
    data = request.get_json(force=True)
    fields = []
    vals = []

    for k in ("title", "note", "status", "x", "y", "color"):
        if k in data:
            fields.append(f"{k}=?")
            vals.append(data[k])

    if not fields:
        return jsonify({"error": "no fields"}), 400

    # sanitize
    if "status" in data and data["status"] not in ("todo", "doing", "done"):
        idx = [i for i, f in enumerate(fields) if f.startswith("status=")]
        for i in idx:
            vals[i] = "todo"

    conn = get_db()
    b = ensure_default_board(conn)

    # ensure quest belongs to my board
    owner = conn.execute(
        "SELECT id FROM quests WHERE id=? AND board_id=?",
        (quest_id, b["id"]),
    ).fetchone()
    if not owner:
        abort(404)

    vals.append(quest_id)
    conn.execute(f"UPDATE quests SET {', '.join(fields)} WHERE id=?", vals)
    conn.commit()

    row = conn.execute(
        "SELECT id, title, note, status, x, y, color, created_at FROM quests WHERE id=?",
        (quest_id,),
    ).fetchone()
    quest = dict(row)
    _attach_reactions(conn, [quest])
    return jsonify(quest)


@app.delete("/api/me/quests/<int:quest_id>")
def delete_my_quest(quest_id):
    conn = get_db()
    b = ensure_default_board(conn)

    conn.execute("DELETE FROM reactions WHERE quest_id=?", (quest_id,))
    cur = conn.execute("DELETE FROM quests WHERE id=? AND board_id=?", (quest_id, b["id"]))
    conn.commit()
    if cur.rowcount == 0:
        abort(404)
    return jsonify({"ok": True})


# -----------------------------
# API: public board quests (read)
# -----------------------------
@app.get("/api/boards/<slug>/quests")
def get_public_quests(slug):
    conn = get_db()
    board = conn.execute(
        "SELECT id, is_public FROM boards WHERE slug=?",
        (slug,),
    ).fetchone()
    if not board:
        abort(404)
    if board["is_public"] != 1:
        abort(403)

    rows = conn.execute(
        "SELECT id, title, note, status, x, y, color, created_at FROM quests WHERE board_id=? ORDER BY id DESC",
        (board["id"],),
    ).fetchall()

    quests = [dict(r) for r in rows]
    _attach_reactions(conn, quests)
    return jsonify(quests)


# -----------------------------
# API: reactions
# -----------------------------
@app.post("/api/public/quests/<int:quest_id>/react")
def react_to_quest(quest_id):
    data = request.get_json(force=True)
    emoji = (data.get("emoji") or "").strip()
    if emoji not in ("🔥", "⭐", "💯"):
        return jsonify({"error": "invalid emoji"}), 400

    conn = get_db()

    # Only allow reactions if quest belongs to a public board
    row = conn.execute("""
        SELECT q.id
        FROM quests q
        JOIN boards b ON b.id = q.board_id
        WHERE q.id = ? AND b.is_public = 1
    """, (quest_id,)).fetchone()
    if not row:
        abort(403)

    conn.execute("""
        INSERT INTO reactions (quest_id, emoji, count)
        VALUES (?, ?, 1)
        ON CONFLICT(quest_id, emoji) DO UPDATE SET count = count + 1
    """, (quest_id, emoji))
    conn.commit()

    counts = _get_reaction_counts(conn, [quest_id])[quest_id]
    return jsonify({"quest_id": quest_id, "reactions": counts})


def _get_reaction_counts(conn, quest_ids):
    out = {qid: {"🔥": 0, "⭐": 0, "💯": 0} for qid in quest_ids}
    if not quest_ids:
        return out

    qmarks = ",".join(["?"] * len(quest_ids))
    rows = conn.execute(
        f"SELECT quest_id, emoji, count FROM reactions WHERE quest_id IN ({qmarks})",
        quest_ids,
    ).fetchall()
    for r in rows:
        out[r["quest_id"]][r["emoji"]] = r["count"]
    return out


def _attach_reactions(conn, quests):
    ids = [q["id"] for q in quests if "id" in q]
    counts = _get_reaction_counts(conn, ids)
    for q in quests:
        q["reactions"] = counts.get(q["id"], {"🔥": 0, "⭐": 0, "💯": 0})


# -----------------------------
# Entrypoint
# -----------------------------
if __name__ == "__main__":
    init_db()
    app.run(host="127.0.0.1", port=5000, debug=True)
