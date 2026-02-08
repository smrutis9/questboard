async function jget(url) {
  const r = await fetch(url);
  return await r.json();
}
async function jpost(url, body) {
  const r = await fetch(url, {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify(body || {})
  });
  return await r.json();
}
async function jdel(url) {
  const r = await fetch(url, { method: "DELETE" });
  return await r.json();
}

function esc(s) {
  return (s || "").replace(/[&<>"']/g, (c) => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  }[c]));
}

function render(state) {
  document.getElementById("todayPill").textContent = `Today: ${state.today}`;
  document.getElementById("dungeon").textContent = state.dungeon;

  const st = state.stats;
  document.getElementById("stats").textContent =
    `${st.done}/${st.total} quests done • ${st.unlocked}/${st.rooms_total} rooms unlocked`;

  const list = document.getElementById("list");
  list.innerHTML = "";

  if (state.quests.length === 0) {
    const empty = document.createElement("div");
    empty.className = "item";
    empty.innerHTML = `<div></div><div class="titleLine">
      <strong>No quests yet.</strong>
      <small>Add one above to start your run.</small>
    </div><div></div>`;
    list.appendChild(empty);
    return;
  }

  for (const q of state.quests) {
    const row = document.createElement("div");
    row.className = "item" + (q.done ? " done" : "");

    const chk = document.createElement("div");
    chk.className = "chk";
    chk.innerHTML = q.done ? "✓" : "";
    chk.onclick = async () => {
      await jpost(`/api/quests/${q.id}/toggle`);
      await refresh();
    };

    const mid = document.createElement("div");
    mid.className = "titleLine";
    const notes = q.notes ? `<small>${esc(q.notes)}</small>` : `<small class="muted"> </small>`;
    const meta = q.done ? `Completed: ${q.done_at || ""}` : `Created: ${q.created_at}`;
    mid.innerHTML = `<strong>${esc(q.title)}</strong>${notes}<small>${esc(meta)}</small>`;

    const kill = document.createElement("button");
    kill.className = "kill";
    kill.textContent = "Delete";
    kill.onclick = async () => {
      await jdel(`/api/quests/${q.id}`);
      await refresh();
    };

    row.appendChild(chk);
    row.appendChild(mid);
    row.appendChild(kill);
    list.appendChild(row);
  }
}

async function refresh() {
  const state = await jget("/api/state");
  render(state);
}

document.getElementById("addForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const title = document.getElementById("title").value.trim();
  const notes = document.getElementById("notes").value.trim();
  if (!title) return;
  await jpost("/api/quests", { title, notes });
  document.getElementById("title").value = "";
  document.getElementById("notes").value = "";
  await refresh();
});

document.getElementById("rolloverBtn").addEventListener("click", async () => {
  const res = await jpost("/api/rollover", {});
  // tiny feedback by temporarily changing text
  const btn = document.getElementById("rolloverBtn");
  const old = btn.textContent;
  btn.textContent = `Rollover (+${res.copied || 0})`;
  setTimeout(() => btn.textContent = old, 1000);
  await refresh();
});

refresh();
