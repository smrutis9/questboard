import os
import sqlite3
from dataclasses import dataclass
from datetime import datetime, date
from flask import Flask, jsonify, render_template, request

APP_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(APP_DIR, "questboard.db")

app = Flask(__name__)

# ---------- DB ----------
def db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    with db() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS quests (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                notes TEXT DEFAULT '',
                created_at TEXT NOT NULL,
                due_date TEXT NOT NULL,
                done INTEGER NOT NULL DEFAULT 0,
                done_at TEXT
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS meta (
                k TEXT PRIMARY KEY,
                v TEXT NOT NULL
            )
        """)

init_db()

# ---------- Dungeon generation ----------
@dataclass
class Room:
    x: int
    y: int
    locked: bool
    label: str

def today_seed() -> int:
    # Stable seed per day; changes daily.
    s = date.today().isoformat()
    return int(s.replace("-", ""))

def lcg(seed: int):
    # Tiny deterministic RNG (no deps).
    a = 1664525
    c = 1013904223
    m = 2**32
    state = seed & 0xFFFFFFFF
    while True:
        state = (a * state + c) % m
        yield state

def generate_dungeon(rooms_total: int, unlocked: int, seed: int):
    """
    Returns an ASCII dungeon grid.
    - rooms_total: how many room slots exist today
    - unlocked: how many are unlocked based on completed quests due today
    """
    # Grid size based on rooms_total (cap for readability)
    rooms_total = max(3, min(60, rooms_total))
    unlocked = max(1, min(rooms_total, unlocked))

    w = 35
    h = 17
    grid = [[" " for _ in range(w)] for _ in range(h)]
    rng = lcg(seed)

    # Start room near center
    cx, cy = w // 2, h // 2
    rooms = [Room(cx, cy, locked=False, label="S")]

    # Random walk to place rooms
    dirs = [(1,0), (-1,0), (0,1), (0,-1)]
    seen = {(cx, cy)}
    x, y = cx, cy

    while len(rooms) < rooms_total:
        r = next(rng)
        dx, dy = dirs[r % 4]
        nx, ny = x + dx*2, y + dy*2  # spacing
        if 1 <= nx < w-1 and 1 <= ny < h-1:
            # Move
            if (nx, ny) not in seen:
                seen.add((nx, ny))
                rooms.append(Room(nx, ny, locked=True, label=str((len(rooms)) % 10)))
                # carve corridor between (x,y) and (nx,ny)
                mx, my = (x + nx)//2, (y + ny)//2
                grid[my][mx] = "·"
            x, y = nx, ny

    # Mark unlocked rooms
    for i, rm in enumerate(rooms):
        if i < unlocked:
            rm.locked = False

    # Draw rooms
    for i, rm in enumerate(rooms):
        ch = "■" if rm.locked else "□"
        grid[rm.y][rm.x] = ch

    # Put start label
    grid[rooms[0].y][rooms[0].x] = "⌂"

    # Place "boss" at last room if unlocked all
    if unlocked >= rooms_total:
        bx, by = rooms[-1].x, rooms[-1].y
        grid[by][bx] = "♛"

    # Frame
    for x in range(w):
        grid[0][x] = "─"
        grid[h-1][x] = "─"
    for y in range(h):
        grid[y][0] = "│"
        grid[y][w-1] = "│"
    grid[0][0] = "┌"
    grid[0][w-1] = "┐"
    grid[h-1][0] = "└"
    grid[h-1][w-1] = "┘"

    art = "\n".join("".join(row) for row in grid)
    return art, rooms_total, unlocked

# ---------- Helpers ----------
def iso_now():
    return datetime.utcnow().isoformat(timespec="seconds") + "Z"

def today_str():
    return date.today().isoformat()

def count_today_due(conn):
    t = today_str()
    total = conn.execute("SELECT COUNT(*) AS c FROM quests WHERE due_date = ?", (t,)).fetchone()["c"]
    done = conn.execute("SELECT COUNT(*) AS c FROM quests WHERE due_date = ? AND done = 1", (t,)).fetchone()["c"]
    return total, done

# ---------- Routes ----------
@app.get("/")
def index():
    return render_template("index.html")

@app.get("/api/state")
def api_state():
    with db() as conn:
        t = today_str()
        quests = conn.execute("""
            SELECT id, title, notes, created_at, due_date, done, done_at
            FROM quests
            WHERE due_date = ?
            ORDER BY done ASC, id DESC
        """, (t,)).fetchall()

        total, done = count_today_due(conn)
        # At least 5 rooms daily so dungeon isn't tiny
        rooms_total = max(5, total + 3)
        unlocked = max(1, done + 1)  # start room always accessible

        art, rt, un = generate_dungeon(rooms_total, unlocked, today_seed())
        return jsonify({
            "today": t,
            "quests": [dict(q) for q in quests],
            "stats": {"total": total, "done": done, "rooms_total": rt, "unlocked": un},
            "dungeon": art
        })

@app.post("/api/quests")
def api_add_quest():
    data = request.get_json(force=True)
    title = (data.get("title") or "").strip()
    notes = (data.get("notes") or "").strip()
    if not title:
        return jsonify({"error": "title required"}), 400

    due = data.get("due_date") or today_str()
    with db() as conn:
        conn.execute("""
            INSERT INTO quests (title, notes, created_at, due_date, done)
            VALUES (?, ?, ?, ?, 0)
        """, (title, notes, iso_now(), due))
    return jsonify({"ok": True})

@app.post("/api/quests/<int:qid>/toggle")
def api_toggle(qid: int):
    with db() as conn:
        row = conn.execute("SELECT done FROM quests WHERE id = ?", (qid,)).fetchone()
        if not row:
            return jsonify({"error": "not found"}), 404
        new_done = 0 if row["done"] == 1 else 1
        conn.execute("""
            UPDATE quests
            SET done = ?, done_at = ?
            WHERE id = ?
        """, (new_done, iso_now() if new_done else None, qid))
    return jsonify({"ok": True})

@app.delete("/api/quests/<int:qid>")
def api_delete(qid: int):
    with db() as conn:
        conn.execute("DELETE FROM quests WHERE id = ?", (qid,))
    return jsonify({"ok": True})

@app.post("/api/rollover")
def api_rollover():
    """
    Optional: copy unfinished quests from yesterday to today.
    """
    with db() as conn:
        t = today_str()
        # Find most recent day prior to today with quests
        last = conn.execute("""
            SELECT due_date
            FROM quests
            WHERE due_date < ?
            ORDER BY due_date DESC
            LIMIT 1
        """, (t,)).fetchone()
        if not last:
            return jsonify({"ok": True, "copied": 0})
        prev = last["due_date"]
        rows = conn.execute("""
            SELECT title, notes
            FROM quests
            WHERE due_date = ? AND done = 0
        """, (prev,)).fetchall()
        copied = 0
        for r in rows:
            conn.execute("""
                INSERT INTO quests (title, notes, created_at, due_date, done)
                VALUES (?, ?, ?, ?, 0)
            """, (r["title"], r["notes"], iso_now(), t))
            copied += 1
    return jsonify({"ok": True, "copied": copied})

if __name__ == "__main__":
    app.run(debug=True, port=5000)
