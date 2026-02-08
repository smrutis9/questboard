from __future__ import annotations
import os
import sqlite3
from datetime import datetime
from flask import Flask, jsonify, render_template, request

app = Flask(__name__)
DB_PATH = os.path.join(os.path.dirname(__file__), "questboard.db")


def db() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db() -> None:
    conn = db()
    cur = conn.cursor()

    # Create table if it doesn't exist
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS quests (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            note TEXT NOT NULL DEFAULT '',
            status TEXT NOT NULL DEFAULT 'backlog',
            x REAL NOT NULL DEFAULT 0.0,
            y REAL NOT NULL DEFAULT 0.0,
            created_at TEXT NOT NULL
        )
        """
    )

    # --- lightweight migration: add missing columns if DB is old ---
    cur.execute("PRAGMA table_info(quests)")
    existing_cols = {row[1] for row in cur.fetchall()}  # row[1] = column name

    if "note" not in existing_cols:
        cur.execute("ALTER TABLE quests ADD COLUMN note TEXT NOT NULL DEFAULT ''")

    if "status" not in existing_cols:
        cur.execute("ALTER TABLE quests ADD COLUMN status TEXT NOT NULL DEFAULT 'backlog'")

    if "x" not in existing_cols:
        cur.execute("ALTER TABLE quests ADD COLUMN x REAL NOT NULL DEFAULT 0.0")

    if "y" not in existing_cols:
        cur.execute("ALTER TABLE quests ADD COLUMN y REAL NOT NULL DEFAULT 0.0")

    if "created_at" not in existing_cols:
        cur.execute("ALTER TABLE quests ADD COLUMN created_at TEXT NOT NULL DEFAULT ''")

    conn.commit()
    conn.close()


@app.get("/")
def index():
    return render_template("index.html")


@app.get("/api/quests")
def list_quests():
    conn = db()
    rows = conn.execute(
        "SELECT id, title, note, status, x, y, created_at FROM quests ORDER BY id DESC"
    ).fetchall()
    conn.close()
    return jsonify([dict(r) for r in rows])


@app.post("/api/quests")
def create_quest():
    data = request.get_json(silent=True) or {}
    title = (data.get("title") or "").strip()
    note = (data.get("note") or "").strip()
    status = (data.get("status") or "backlog").strip()
    x = float(data.get("x", 0.0))
    y = float(data.get("y", 0.0))

    if not title:
        return jsonify({"error": "title is required"}), 400
    if status not in ("backlog", "doing", "done"):
        return jsonify({"error": "invalid status"}), 400

    conn = db()
    cur = conn.cursor()
    cur.execute(
        "INSERT INTO quests (title, note, status, x, y, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        (
            title,
            note,
            status,
            x,
            y,
            datetime.utcnow().isoformat(timespec="seconds") + "Z",
        ),
    )
    qid = cur.lastrowid
    conn.commit()
    row = conn.execute(
        "SELECT id, title, note, status, x, y, created_at FROM quests WHERE id = ?",
        (qid,),
    ).fetchone()
    conn.close()
    return jsonify(dict(row)), 201


@app.patch("/api/quests/<int:qid>")
def update_quest(qid: int):
    data = request.get_json(silent=True) or {}

    fields = []
    vals = []

    if "title" in data:
        title = (data.get("title") or "").strip()
        if not title:
            return jsonify({"error": "title cannot be empty"}), 400
        fields.append("title = ?")
        vals.append(title)

    if "note" in data:
        note = (data.get("note") or "").strip()
        fields.append("note = ?")
        vals.append(note)

    if "status" in data:
        status = (data.get("status") or "").strip()
        if status not in ("backlog", "doing", "done"):
            return jsonify({"error": "invalid status"}), 400
        fields.append("status = ?")
        vals.append(status)

    if "x" in data:
        fields.append("x = ?")
        vals.append(float(data["x"]))

    if "y" in data:
        fields.append("y = ?")
        vals.append(float(data["y"]))

    if not fields:
        return jsonify({"error": "no valid fields"}), 400

    vals.append(qid)

    conn = db()
    cur = conn.cursor()
    cur.execute(f"UPDATE quests SET {', '.join(fields)} WHERE id = ?", vals)
    if cur.rowcount == 0:
        conn.close()
        return jsonify({"error": "quest not found"}), 404

    conn.commit()
    row = conn.execute(
        "SELECT id, title, note, status, x, y, created_at FROM quests WHERE id = ?",
        (qid,),
    ).fetchone()
    conn.close()
    return jsonify(dict(row))


@app.delete("/api/quests/<int:qid>")
def delete_quest(qid: int):
    conn = db()
    cur = conn.cursor()
    cur.execute("DELETE FROM quests WHERE id = ?", (qid,))
    deleted = cur.rowcount
    conn.commit()
    conn.close()
    if deleted == 0:
        return jsonify({"error": "quest not found"}), 404
    return jsonify({"ok": True})


if __name__ == "__main__":
    init_db()
    app.run(host="127.0.0.1", port=5000, debug=True)
