// QuestAtlas: map-based board on a canvas.
// Regions = board columns, but world-themed (Village/Trail/Castle).
// Drag/zoom/pan, click to place, drag quests to move + change status.

const canvas = document.getElementById("map");
const ctx = canvas.getContext("2d");

const createForm = document.getElementById("createForm");
const titleInput = document.getElementById("titleInput");
const noteInput = document.getElementById("noteInput");
const randomPlaceBtn = document.getElementById("randomPlace");

const countBacklog = document.getElementById("countBacklog");
const countDoing = document.getElementById("countDoing");
const countDone = document.getElementById("countDone");

const recenterBtn = document.getElementById("recenter");
const exportJsonBtn = document.getElementById("exportJson");

const questPanel = document.getElementById("questPanel");
const qpClose = document.getElementById("qpClose");
const qpTitle = document.getElementById("qpTitle");
const qpNote = document.getElementById("qpNote");
const qpStatus = document.getElementById("qpStatus");
const qpSave = document.getElementById("qpSave");
const qpDelete = document.getElementById("qpDelete");
const qpMeta = document.getElementById("qpMeta");

const toastEl = document.getElementById("toast");

let quests = [];
let selectedQuestId = null;

// ---- Map world coordinates ----
// World is a fixed rectangle; we render with camera transform.
const WORLD = { w: 1800, h: 1000 };

// Regions are vertical slices (like a board, but styled as a map)
const REGIONS = [
  { key: "backlog", name: "Village", x0: 0,    x1: 600,  color: "rgba(123, 211, 255, 0.12)" },
  { key: "doing",   name: "Trail",   x0: 600,  x1: 1200, color: "rgba(255, 211, 123, 0.12)" },
  { key: "done",    name: "Castle",  x0: 1200, x1: 1800, color: "rgba(178, 141, 255, 0.12)" },
];

const STATUS_COLOR = {
  backlog: "#7bd3ff",
  doing:   "#ffd37b",
  done:    "#b28dff",
};

function regionForX(x) {
  for (const r of REGIONS) if (x >= r.x0 && x < r.x1) return r;
  return REGIONS[REGIONS.length - 1];
}

// ---- Camera (pan/zoom) ----
const cam = { x: 0, y: 0, z: 1.0 }; // x,y = world offset, z = zoom
function resetCamera() {
  cam.z = 0.9;
  cam.x = (WORLD.w - canvas.width / cam.z) / 2;
  cam.y = (WORLD.h - canvas.height / cam.z) / 2;
}
function worldToScreen(wx, wy) {
  return { x: (wx - cam.x) * cam.z, y: (wy - cam.y) * cam.z };
}
function screenToWorld(sx, sy) {
  return { x: sx / cam.z + cam.x, y: sy / cam.z + cam.y };
}
function clampCamera() {
  const viewW = canvas.width / cam.z;
  const viewH = canvas.height / cam.z;

  cam.x = Math.max(0, Math.min(cam.x, WORLD.w - viewW));
  cam.y = Math.max(0, Math.min(cam.y, WORLD.h - viewH));
}

// ---- API ----
async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) throw new Error((data && data.error) ? data.error : `HTTP ${res.status}`);
  return data;
}

// ---- Resize ----
function resize() {
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const rect = canvas.getBoundingClientRect();
  canvas.width = Math.floor(rect.width * dpr);
  canvas.height = Math.floor(rect.height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0); // draw in CSS pixels
  clampCamera();
  draw();
}
window.addEventListener("resize", resize);

// ---- Simple toast ----
let toastTimer = null;
function toast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.add("hidden"), 1600);
}

// ---- Rendering helpers ----
function roundRect(x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function drawBackground() {
  // ocean-ish base
  ctx.fillStyle = "#0b0f19";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // world frame
  const p0 = worldToScreen(0, 0);
  const p1 = worldToScreen(WORLD.w, WORLD.h);

  // parchment map vibe
  ctx.save();
  ctx.globalAlpha = 1;
  ctx.fillStyle = "rgba(18,26,44,0.55)";
  roundRect(p0.x - 8, p0.y - 8, (p1.x - p0.x) + 16, (p1.y - p0.y) + 16, 18);
  ctx.fill();

  ctx.strokeStyle = "rgba(255,255,255,0.12)";
  ctx.lineWidth = 1;
  roundRect(p0.x - 8, p0.y - 8, (p1.x - p0.x) + 16, (p1.y - p0.y) + 16, 18);
  ctx.stroke();
  ctx.restore();

  // region fills + labels
  for (const r of REGIONS) {
    const a = worldToScreen(r.x0, 0);
    const b = worldToScreen(r.x1, WORLD.h);
    ctx.fillStyle = r.color;
    ctx.fillRect(a.x, a.y, b.x - a.x, b.y - a.y);

    // title
    ctx.save();
    ctx.fillStyle = "rgba(231,234,242,0.75)";
    ctx.font = "700 18px ui-sans-serif, system-ui";
    ctx.fillText(r.name, a.x + 16, a.y + 30);
    ctx.restore();

    // divider line
    ctx.save();
    ctx.strokeStyle = "rgba(255,255,255,0.10)";
    ctx.beginPath();
    ctx.moveTo(b.x, a.y + 10);
    ctx.lineTo(b.x, b.y - 10);
    ctx.stroke();
    ctx.restore();
  }

  // add a few "roads" (just curves) for vibes
  ctx.save();
  ctx.globalAlpha = 0.18;
  ctx.strokeStyle = "rgba(255,255,255,0.6)";
  ctx.lineWidth = 3;
  ctx.beginPath();
  const r1 = worldToScreen(220, 820);
  const r2 = worldToScreen(700, 600);
  const r3 = worldToScreen(1100, 480);
  const r4 = worldToScreen(1550, 300);
  ctx.moveTo(r1.x, r1.y);
  ctx.bezierCurveTo(r2.x, r2.y, r3.x, r3.y, r4.x, r4.y);
  ctx.stroke();
  ctx.restore();
}

function drawQuest(q) {
  const p = worldToScreen(q.x, q.y);
  const radius = 12;

  // marker glow
  ctx.save();
  ctx.globalAlpha = 0.25;
  ctx.fillStyle = STATUS_COLOR[q.status] || "#ffffff";
  ctx.beginPath();
  ctx.arc(p.x, p.y, radius + 10, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // marker
  ctx.save();
  ctx.fillStyle = "rgba(0,0,0,0.35)";
  ctx.beginPath();
  ctx.arc(p.x + 2, p.y + 2, radius + 2, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = STATUS_COLOR[q.status] || "#fff";
  ctx.beginPath();
  ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
  ctx.fill();

  // selected ring
  if (q.id === selectedQuestId) {
    ctx.strokeStyle = "rgba(255,255,255,0.85)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(p.x, p.y, radius + 5, 0, Math.PI * 2);
    ctx.stroke();
  }

  // label bubble
  const label = q.title.length > 34 ? q.title.slice(0, 34) + "…" : q.title;
  ctx.font = "600 13px ui-sans-serif, system-ui";
  const tw = ctx.measureText(label).width;
  const bx = p.x + 18;
  const by = p.y - 18;
  const bw = tw + 18;
  const bh = 26;

  ctx.fillStyle = "rgba(16,22,39,0.86)";
  roundRect(bx, by, bw, bh, 10);
  ctx.fill();

  ctx.strokeStyle = "rgba(255,255,255,0.12)";
  ctx.stroke();

  ctx.fillStyle = "rgba(231,234,242,0.92)";
  ctx.fillText(label, bx + 9, by + 17);

  ctx.restore();
}

function draw() {
  // clear in CSS pixels space (transform already set in resize)
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  drawBackground();
  for (const q of quests) drawQuest(q);

  // crosshair hint if placing mode
  if (placing.active) {
    const p = worldToScreen(placing.wx, placing.wy);
    ctx.save();
    ctx.globalAlpha = 0.85;
    ctx.strokeStyle = "rgba(255,255,255,0.35)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 16, 0, Math.PI * 2);
    ctx.moveTo(p.x - 22, p.y); ctx.lineTo(p.x + 22, p.y);
    ctx.moveTo(p.x, p.y - 22); ctx.lineTo(p.x, p.y + 22);
    ctx.stroke();

    const r = regionForX(placing.wx);
    ctx.fillStyle = "rgba(231,234,242,0.75)";
    ctx.font = "600 12px ui-sans-serif, system-ui";
    ctx.fillText(`Place in ${r.name}`, p.x + 22, p.y + 4);
    ctx.restore();
  }
}

// ---- Hit testing ----
function questAtScreen(sx, sy) {
  // hit radius in screen pixels
  const hit = 18;
  for (const q of quests) {
    const p = worldToScreen(q.x, q.y);
    const dx = sx - p.x;
    const dy = sy - p.y;
    if (dx*dx + dy*dy <= hit*hit) return q;
  }
  return null;
}

// ---- Interaction ----
let isSpaceDown = false;

const dragging = {
  active: false,
  questId: null,
  offsetX: 0,
  offsetY: 0
};

const panning = {
  active: false,
  startSX: 0,
  startSY: 0,
  startCamX: 0,
  startCamY: 0
};

// placing mode = after user hits "Place Quest"
const placing = {
  active: false,
  pendingTitle: "",
  pendingNote: "",
  wx: 0,
  wy: 0,
};

function openQuestPanel(q) {
  selectedQuestId = q.id;
  qpTitle.value = q.title;
  qpNote.value = q.note || "";
  qpStatus.textContent = (q.status === "backlog" ? "Village (Backlog)" :
                          q.status === "doing"   ? "Trail (Doing)" :
                                                  "Castle (Done)");
  qpMeta.textContent = `Created: ${q.created_at.replace("T"," ").replace("Z"," UTC")}`;
  questPanel.classList.remove("hidden");
  draw();
}

function closeQuestPanel() {
  selectedQuestId = null;
  questPanel.classList.add("hidden");
  draw();
}

qpClose.addEventListener("click", closeQuestPanel);
window.addEventListener("keydown", (e) => {
  if (e.code === "Space") isSpaceDown = true;
  if (e.key === "Escape") closeQuestPanel();
});
window.addEventListener("keyup", (e) => {
  if (e.code === "Space") isSpaceDown = false;
});

canvas.addEventListener("mousemove", (e) => {
  const rect = canvas.getBoundingClientRect();
  const sx = e.clientX - rect.left;
  const sy = e.clientY - rect.top;

  if (placing.active) {
    const w = screenToWorld(sx, sy);
    placing.wx = Math.max(0, Math.min(WORLD.w, w.x));
    placing.wy = Math.max(0, Math.min(WORLD.h, w.y));
    draw();
    return;
  }

  if (dragging.active) {
    const w = screenToWorld(sx, sy);
    const q = quests.find(x => x.id === dragging.questId);
    if (!q) return;

    q.x = Math.max(0, Math.min(WORLD.w, w.x - dragging.offsetX));
    q.y = Math.max(0, Math.min(WORLD.h, w.y - dragging.offsetY));

    // status follows region
    q.status = regionForX(q.x).key;

    draw();
    updateCounts();
    return;
  }

  if (panning.active) {
    const dx = (sx - panning.startSX) / cam.z;
    const dy = (sy - panning.startSY) / cam.z;
    cam.x = panning.startCamX - dx;
    cam.y = panning.startCamY - dy;
    clampCamera();
    draw();
  }
});

canvas.addEventListener("mousedown", (e) => {
  const rect = canvas.getBoundingClientRect();
  const sx = e.clientX - rect.left;
  const sy = e.clientY - rect.top;

  if (placing.active) return;

  if (isSpaceDown || e.button === 1) {
    panning.active = true;
    panning.startSX = sx;
    panning.startSY = sy;
    panning.startCamX = cam.x;
    panning.startCamY = cam.y;
    return;
  }

  const hit = questAtScreen(sx, sy);
  if (hit) {
    selectedQuestId = hit.id;
    const w = screenToWorld(sx, sy);
    dragging.active = true;
    dragging.questId = hit.id;
    dragging.offsetX = w.x - hit.x;
    dragging.offsetY = w.y - hit.y;
    draw();
  }
});

canvas.addEventListener("mouseup", async (e) => {
  const rect = canvas.getBoundingClientRect();
  const sx = e.clientX - rect.left;
  const sy = e.clientY - rect.top;

  if (placing.active) {
    // place quest at current placing.wx/wy
    const r = regionForX(placing.wx);
    const payload = {
      title: placing.pendingTitle,
      note: placing.pendingNote,
      status: r.key,
      x: placing.wx,
      y: placing.wy,
    };
    placing.active = false;
    draw();
    try {
      const created = await api("/api/quests", { method: "POST", body: JSON.stringify(payload) });
      quests = [created, ...quests];
      updateCounts();
      toast(`Placed in ${r.name}`);
      draw();
    } catch (err) {
      toast(err.message);
    }
    return;
  }

  if (dragging.active) {
    const q = quests.find(x => x.id === dragging.questId);
    dragging.active = false;

    if (q) {
      // persist new position/status
      try {
        await api(`/api/quests/${q.id}`, {
          method: "PATCH",
          body: JSON.stringify({ x: q.x, y: q.y, status: q.status })
        });
      } catch (err) {
        toast(err.message);
      }
    }

    // click-release with minimal movement should open panel
    const hit = questAtScreen(sx, sy);
    if (hit && hit.id === selectedQuestId) openQuestPanel(hit);
    return;
  }

  if (panning.active) panning.active = false;
});

canvas.addEventListener("mouseleave", () => {
  dragging.active = false;
  panning.active = false;
});

canvas.addEventListener("wheel", (e) => {
  // zoom around cursor
  e.preventDefault();
  const rect = canvas.getBoundingClientRect();
  const sx = e.clientX - rect.left;
  const sy = e.clientY - rect.top;

  const before = screenToWorld(sx, sy);
  const delta = Math.sign(e.deltaY);
  const factor = (delta > 0) ? 0.92 : 1.08;

  cam.z = Math.max(0.55, Math.min(1.9, cam.z * factor));
  const after = screenToWorld(sx, sy);

  cam.x += (before.x - after.x);
  cam.y += (before.y - after.y);

  clampCamera();
  draw();
}, { passive: false });

// ---- Create quest flow ----
function startPlacing(title, note, mode = "click") {
  if (!title.trim()) { toast("Need a title"); return; }

  placing.active = true;
  placing.pendingTitle = title.trim();
  placing.pendingNote = (note || "").trim();

  // set initial placement point near center of current view
  const center = screenToWorld(canvas.getBoundingClientRect().width/2, canvas.getBoundingClientRect().height/2);
  placing.wx = Math.max(0, Math.min(WORLD.w, center.x));
  placing.wy = Math.max(0, Math.min(WORLD.h, center.y));

  toast(mode === "random" ? "Pick a spot (or click again)" : "Click a spot to place");
  draw();
}

createForm.addEventListener("submit", (e) => {
  e.preventDefault();
  startPlacing(titleInput.value, noteInput.value, "click");
});

randomPlaceBtn.addEventListener("click", () => {
  const t = titleInput.value.trim();
  if (!t) return toast("Need a title");

  // random point in a random region
  const r = REGIONS[Math.floor(Math.random() * REGIONS.length)];
  const x = r.x0 + 60 + Math.random() * (r.x1 - r.x0 - 120);
  const y = 90 + Math.random() * (WORLD.h - 180);

  placing.active = true;
  placing.pendingTitle = t;
  placing.pendingNote = (noteInput.value || "").trim();
  placing.wx = x;
  placing.wy = y;

  // auto-place immediately without extra click
  (async () => {
    placing.active = false;
    try {
      const created = await api("/api/quests", {
        method: "POST",
        body: JSON.stringify({ title: t, note: placing.pendingNote, status: r.key, x, y })
      });
      quests = [created, ...quests];
      updateCounts();
      toast(`Placed in ${r.name}`);
      draw();
    } catch (err) {
      toast(err.message);
    }
  })();
});

// ---- Panel actions ----
qpSave.addEventListener("click", async () => {
  const q = quests.find(x => x.id === selectedQuestId);
  if (!q) return;

  const newTitle = qpTitle.value.trim();
  const newNote = qpNote.value.trim();
  if (!newTitle) return toast("Title cannot be empty");

  try {
    const updated = await api(`/api/quests/${q.id}`, {
      method: "PATCH",
      body: JSON.stringify({ title: newTitle, note: newNote })
    });
    quests = quests.map(x => x.id === q.id ? updated : x);
    toast("Saved");
    openQuestPanel(updated);
    draw();
  } catch (err) {
    toast(err.message);
  }
});

qpDelete.addEventListener("click", async () => {
  const q = quests.find(x => x.id === selectedQuestId);
  if (!q) return;

  try {
    await api(`/api/quests/${q.id}`, { method: "DELETE" });
    quests = quests.filter(x => x.id !== q.id);
    toast("Deleted");
    updateCounts();
    closeQuestPanel();
    draw();
  } catch (err) {
    toast(err.message);
  }
});

// ---- Utility ----
function updateCounts() {
  const b = quests.filter(q => q.status === "backlog").length;
  const d = quests.filter(q => q.status === "doing").length;
  const n = quests.filter(q => q.status === "done").length;
  countBacklog.textContent = b;
  countDoing.textContent = d;
  countDone.textContent = n;
}

recenterBtn.addEventListener("click", () => {
  resetCamera();
  clampCamera();
  draw();
});

exportJsonBtn.addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(quests, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "questatlas-export.json";
  a.click();
  URL.revokeObjectURL(url);
  toast("Exported JSON");
});

// ---- Boot ----
async function load() {
  quests = await api("/api/quests");
  updateCounts();
  resetCamera();
  clampCamera();
  draw();
}

resize();
load().catch(err => toast(err.message));
