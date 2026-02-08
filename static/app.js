const qs = (s) => document.querySelector(s);
const qsa = (s) => Array.from(document.querySelectorAll(s));

const state = {
  board: null,
  quests: [],
  filter: "all",
  draggingQuestId: null,
  editingQuest: null,
};

const READ_ONLY = !!window.READ_ONLY;
const PUBLIC_SLUG = window.PUBLIC_BOARD_SLUG;

function apiBase() {
  // "me" endpoints for your own board; public endpoints for shared boards
  if (READ_ONLY) return `/api/boards/${encodeURIComponent(PUBLIC_SLUG)}`;
  return "/api/me";
}

async function jfetch(url, opts = {}) {
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`;
    try {
      const data = await res.json();
      if (data && data.error) msg = data.error;
    } catch {}
    throw new Error(msg);
  }
  return res.json();
}

function clamp01(x) {
  return Math.max(0, Math.min(1, x));
}

function statusLabel(s) {
  if (s === "todo") return "Todo";
  if (s === "doing") return "Doing";
  if (s === "done") return "Done";
  return s;
}

function computeStats() {
  const todo = state.quests.filter(q => q.status === "todo").length;
  const doing = state.quests.filter(q => q.status === "doing").length;
  const done = state.quests.filter(q => q.status === "done").length;
  const xp = done * 50 + doing * 10;
  const level = Math.max(1, Math.floor(xp / 200) + 1);
  const next = level * 200;
  return { todo, doing, done, xp, level, next };
}

function renderBoard() {
  const b = state.board;
  if (!b) return;

  qs("#boardTitle").textContent = b.title;
  qs("#boardOwner").textContent = `@${b.owner_name}`;
  qs("#boardBio").textContent = b.bio || "";

  const stats = computeStats();
  qs("#boardStats").textContent =
    `Level ${stats.level} Adventurer · XP ${stats.xp}/${stats.next} · ✅ ${stats.done} · 🧩 ${stats.doing} · 📌 ${stats.todo}`;

  // UI toggles
  qs("#btnNewQuest").classList.toggle("hidden", READ_ONLY);
  qs("#btnEditBoard").classList.toggle("hidden", READ_ONLY);

  qs("#mapHint").textContent = READ_ONLY
    ? "Read-only public board. React to quests & get inspired."
    : "Drag quests from the list onto the map to place them. Click pins to edit.";
}

function questMatchesFilter(q) {
  if (state.filter === "all") return true;
  return q.status === state.filter;
}

function renderQuestList() {
  const list = qs("#questList");
  list.innerHTML = "";

  const visible = state.quests.filter(questMatchesFilter);

  visible.forEach((q) => {
    const el = document.createElement("div");
    el.className = "quest";
    el.draggable = !READ_ONLY;
    el.dataset.id = q.id;

    el.addEventListener("dragstart", () => {
      state.draggingQuestId = q.id;
    });
    el.addEventListener("dragend", () => {
      state.draggingQuestId = null;
    });

    el.addEventListener("click", () => {
      if (!READ_ONLY) openQuestModal(q);
    });

    el.innerHTML = `
      <div class="quest-head">
        <div>
          <div class="quest-title">${escapeHtml(q.title)}</div>
          ${q.note ? `<div class="quest-note">${escapeHtml(q.note)}</div>` : ""}
        </div>
      </div>
      <div class="tagrow">
        <span class="tag ${q.status}">${statusLabel(q.status)}</span>
        <span class="tag" style="border-color:${q.color}; color:${q.color};">● ${q.color}</span>
        <div class="reactions">
          ${renderReactions(q)}
        </div>
      </div>
    `;

    // reaction handlers (only on public, but you can also allow on your own board)
    el.querySelectorAll(".react").forEach((btn) => {
      btn.addEventListener("click", async (e) => {
        e.stopPropagation();
        const emoji = btn.dataset.emoji;
        try {
          const data = await jfetch(`/api/public/quests/${q.id}/react`, {
            method: "POST",
            body: JSON.stringify({ emoji }),
          });
          q.reactions = data.reactions;
          renderAll();
        } catch (err) {
          // if not public, ignore quietly
          console.log(err.message);
        }
      });
    });

    list.appendChild(el);
  });
}

function renderReactions(q) {
  const r = q.reactions || { "🔥": 0, "⭐": 0, "💯": 0 };
  // Always show buttons, but they only work for public boards.
  return `
    <button class="react" data-emoji="🔥">🔥 ${r["🔥"] || 0}</button>
    <button class="react" data-emoji="⭐">⭐ ${r["⭐"] || 0}</button>
    <button class="react" data-emoji="💯">💯 ${r["💯"] || 0}</button>
  `;
}

function renderMapPins() {
  const map = qs("#mapCanvas");
  // remove old pins
  map.querySelectorAll(".pin").forEach((p) => p.remove());

  state.quests.forEach((q) => {
    if (!questMatchesFilter(q)) return;

    const pin = document.createElement("div");
    pin.className = "pin";
    pin.textContent = q.title.length > 18 ? q.title.slice(0, 18) + "…" : q.title;

    pin.style.left = `${clamp01(q.x) * 100}%`;
    pin.style.top = `${clamp01(q.y) * 100}%`;
    pin.style.background = q.color || "#7c3aed";

    // status glow (subtle)
    if (q.status === "todo") pin.style.boxShadow = "0 0 18px rgba(124,58,237,0.55)";
    if (q.status === "doing") pin.style.boxShadow = "0 0 18px rgba(6,182,212,0.55)";
    if (q.status === "done") pin.style.boxShadow = "0 0 18px rgba(34,197,94,0.55)";

    pin.addEventListener("click", () => {
      if (!READ_ONLY) openQuestModal(q);
    });

    map.appendChild(pin);
  });
}

function renderAll() {
  renderBoard();
  renderQuestList();
  renderMapPins();
}

function bindFilters() {
  qsa(".chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      qsa(".chip").forEach((c) => c.classList.remove("active"));
      chip.classList.add("active");
      state.filter = chip.dataset.filter;
      renderAll();
    });
  });
}

function bindMapDrop() {
  const map = qs("#mapCanvas");
  map.addEventListener("dragover", (e) => {
    if (READ_ONLY) return;
    e.preventDefault();
  });

  map.addEventListener("drop", async (e) => {
    if (READ_ONLY) return;
    e.preventDefault();
    const id = state.draggingQuestId;
    if (!id) return;

    const rect = map.getBoundingClientRect();
    const x = clamp01((e.clientX - rect.left) / rect.width);
    const y = clamp01((e.clientY - rect.top) / rect.height);

    await updateQuest(id, { x, y });
  });
}

function bindTopButtons() {
  qs("#btnNewQuest").addEventListener("click", () => {
    if (READ_ONLY) return;
    openQuestModal(null);
  });

  qs("#btnEditBoard").addEventListener("click", () => {
    if (READ_ONLY) return;
    openBoardModal();
  });

  qs("#btnShare").addEventListener("click", async () => {
    try {
      let b = state.board;
      if (!b) return;

      if (!b.is_public && !READ_ONLY) {
        alert("Make your board public first (Edit → Public) to share it.");
        return;
      }

      const link = `${location.origin}/b/${b.slug}`;
      await navigator.clipboard.writeText(link);
      alert(`Share link copied:\n${link}`);
    } catch {
      alert("Could not copy link. (Browser blocked clipboard)");
    }
  });
}

function openQuestModal(q) {
  state.editingQuest = q ? { ...q } : null;

  const modal = qs("#modalQuest");
  modal.classList.remove("hidden");

  qs("#questModalTitle").textContent = q ? "Edit Quest" : "New Quest";
  qs("#qTitle").value = q?.title || "";
  qs("#qNote").value = q?.note || "";
  qs("#qStatus").value = q?.status || "todo";
  qs("#qColor").value = q?.color || "#7c3aed";

  qs("#btnDeleteQuest").classList.toggle("hidden", !q);

  qs("#btnSaveQuest").onclick = async () => {
    const title = qs("#qTitle").value.trim();
    const note = qs("#qNote").value.trim();
    const status = qs("#qStatus").value;
    const color = qs("#qColor").value;

    if (!title) {
      alert("Title required.");
      return;
    }

    if (q) {
      await updateQuest(q.id, { title, note, status, color });
    } else {
      await createQuest({ title, note, status, color, x: 0.5, y: 0.5 });
    }

    closeQuestModal();
  };

  qs("#btnDeleteQuest").onclick = async () => {
    if (!q) return;
    if (!confirm("Delete this quest?")) return;
    await deleteQuest(q.id);
    closeQuestModal();
  };

  qs("#btnCancelQuest").onclick = closeQuestModal;
  qs("#btnCloseQuest").onclick = closeQuestModal;
}

function closeQuestModal() {
  qs("#modalQuest").classList.add("hidden");
  state.editingQuest = null;
}

function openBoardModal() {
  const b = state.board;
  const modal = qs("#modalBoard");
  modal.classList.remove("hidden");

  qs("#bTitle").value = b.title || "";
  qs("#bOwner").value = b.owner_name || "";
  qs("#bBio").value = b.bio || "";
  qs("#bPublic").checked = !!b.is_public;

  qs("#btnSaveBoard").onclick = async () => {
    const title = qs("#bTitle").value.trim();
    const owner_name = qs("#bOwner").value.trim();
    const bio = qs("#bBio").value.trim();
    const is_public = qs("#bPublic").checked;

    const updated = await jfetch("/api/me/board", {
      method: "PATCH",
      body: JSON.stringify({ title, owner_name, bio, is_public }),
    });

    state.board = updated;
    closeBoardModal();
    renderAll();
  };

  qs("#btnCancelBoard").onclick = closeBoardModal;
  qs("#btnCloseBoard").onclick = closeBoardModal;
}

function closeBoardModal() {
  qs("#modalBoard").classList.add("hidden");
}

async function loadData() {
  if (READ_ONLY) {
    // public board mode
    state.board = await jfetch(`/api/boards/${encodeURIComponent(PUBLIC_SLUG)}`);
    state.quests = await jfetch(`/api/boards/${encodeURIComponent(PUBLIC_SLUG)}/quests`);
  } else {
    state.board = await jfetch("/api/me/board");
    state.quests = await jfetch("/api/me/quests");
  }
}

async function createQuest(payload) {
  const q = await jfetch("/api/me/quests", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  state.quests.unshift(q);
  renderAll();
}

async function updateQuest(id, patch) {
  const updated = await jfetch(`/api/me/quests/${id}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
  state.quests = state.quests.map((q) => (q.id === id ? updated : q));
  renderAll();
}

async function deleteQuest(id) {
  await jfetch(`/api/me/quests/${id}`, { method: "DELETE" });
  state.quests = state.quests.filter((q) => q.id !== id);
  renderAll();
}

function escapeHtml(str) {
  return (str || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function main() {
  bindFilters();
  bindMapDrop();
  bindTopButtons();

  if (READ_ONLY) {
    qs("#btnNewQuest").classList.add("hidden");
    qs("#btnEditBoard").classList.add("hidden");
  }

  try {
    await loadData();
    renderAll();
  } catch (err) {
    console.error(err);
    alert(`Failed to load: ${err.message}`);
  }
}

main();
