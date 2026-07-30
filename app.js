let sessions = [];

async function loadSessions() {
  sessions = await Sessions.all();
  renderPlanTab();
  renderHistoryTab();
  renderCalendarTab();
}

// ---------- helpers ----------

function fmtDate(iso) {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

function pace(distance, duration) {
  if (!distance || !duration) return null;
  const perMile = duration / distance;
  const min = Math.floor(perMile);
  const sec = Math.round((perMile - min) * 60);
  return `${min}:${String(sec).padStart(2, "0")}/mi`;
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function upcomingSessions() {
  return sessions
    .filter(s => s.status === "planned")
    .sort((a, b) => a.date.localeCompare(b.date));
}

function historySessions() {
  return sessions
    .filter(s => s.status === "completed")
    .sort((a, b) => b.date.localeCompare(a.date));
}

// ---------- rendering ----------

function planCardHtml(s) {
  return `
    <div class="card">
      <div class="card-header">
        <span class="badge ${s.type}">${s.type}</span>
        <span class="date">${fmtDate(s.date)}</span>
      </div>
      <h3>${escapeHtml(s.title)}</h3>
      <div class="meta">
        ${s.planned.distance ? `<span>${s.planned.distance} mi</span>` : ""}
        ${s.planned.duration ? `<span>${s.planned.duration} min</span>` : ""}
        ${s.planned.distance && s.planned.duration ? `<span>${pace(s.planned.distance, s.planned.duration)}</span>` : ""}
      </div>
      ${s.planned.notes ? `<p class="notes">${escapeHtml(s.planned.notes)}</p>` : ""}
      <div class="card-actions">
        <button class="btn primary" data-action="log" data-id="${s.id}">Log it</button>
        <button class="btn" data-action="edit" data-id="${s.id}">Edit</button>
        ${s.planned.route ? `<button class="btn" data-action="view-route" data-id="${s.id}">Map</button>` : ""}
        <button class="btn danger" data-action="delete" data-id="${s.id}">Delete</button>
      </div>
    </div>
  `;
}

function historyCardHtml(s) {
  const hadPlan = !!s.planned;
  return `
    <div class="card">
      <div class="card-header">
        <span class="badge ${s.type}">${s.type}</span>
        <span class="date">${fmtDate(s.date)}</span>
      </div>
      <h3>${escapeHtml(s.title)}</h3>
      <div class="compare">
        ${hadPlan ? `
          <div class="compare-col">
            <span class="compare-label">Planned</span>
            <span>${s.planned.distance ? s.planned.distance + " mi" : "—"}</span>
            <span>${s.planned.duration ? s.planned.duration + " min" : "—"}</span>
          </div>
        ` : ""}
        <div class="compare-col">
          <span class="compare-label">Actual</span>
          <span>${s.actual.distance ? s.actual.distance + " mi" : "—"}</span>
          <span>${s.actual.duration ? s.actual.duration + " min" : "—"}</span>
          <span>${s.actual.distance && s.actual.duration ? pace(s.actual.distance, s.actual.duration) : ""}</span>
        </div>
        <div class="compare-col">
          <span class="compare-label">Effort</span>
          <span>${s.actual.effort ? s.actual.effort + "/10" : "—"}</span>
        </div>
      </div>
      ${s.actual.notes ? `<p class="notes">${escapeHtml(s.actual.notes)}</p>` : ""}
      <div class="card-actions">
        ${hadPlan && s.planned.route ? `<button class="btn" data-action="view-route" data-id="${s.id}">Map</button>` : ""}
        <button class="btn danger" data-action="delete" data-id="${s.id}">Delete</button>
      </div>
    </div>
  `;
}

function sessionCardHtml(s) {
  return s.status === "planned" ? planCardHtml(s) : historyCardHtml(s);
}

function bindCardActions(container) {
  container.querySelectorAll("[data-action]").forEach(btn => {
    btn.addEventListener("click", () => handleAction(btn.dataset.action, btn.dataset.id));
  });
}

function renderPlanTab() {
  const list = document.getElementById("plan-list");
  const items = upcomingSessions();
  if (items.length === 0) {
    list.innerHTML = `<p class="empty">Nothing planned yet.</p>`;
    return;
  }
  list.innerHTML = items.map(planCardHtml).join("");
  bindCardActions(list);
}

function renderHistoryTab() {
  const list = document.getElementById("history-list");
  const items = historySessions();
  if (items.length === 0) {
    list.innerHTML = `<p class="empty">No completed sessions yet.</p>`;
    return;
  }
  list.innerHTML = items.map(historyCardHtml).join("");
  bindCardActions(list);
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str || "";
  return div.innerHTML;
}

// ---------- actions ----------

async function handleAction(action, id) {
  const session = sessions.find(s => s.id === id);
  if (action === "delete") {
    if (confirm("Delete this session?")) {
      await Sessions.remove(id);
      closeModal();
      await loadSessions();
    }
  } else if (action === "edit") {
    openPlanForm(session);
  } else if (action === "log") {
    openLogForm(session);
  } else if (action === "view-route") {
    viewRouteModal(session.planned.route);
  }
}

// ---------- forms / modal ----------

function openModal(html, { fullscreen = false } = {}) {
  document.getElementById("modal-content").innerHTML = html;
  document.getElementById("modal-content").classList.toggle("map-modal", fullscreen);
  document.getElementById("modal-overlay").classList.remove("hidden");
}

function closeModal() {
  document.getElementById("modal-overlay").classList.add("hidden");
}

document.getElementById("modal-overlay").addEventListener("click", (e) => {
  if (e.target.id === "modal-overlay") closeModal();
});

function syncDraftFromForm(s) {
  const form = document.getElementById("plan-form");
  if (!form) return;
  const fd = new FormData(form);
  s.type = fd.get("type");
  s.title = fd.get("title").trim();
  s.date = fd.get("date");
  s.planned = {
    ...s.planned,
    distance: fd.get("distance") ? parseFloat(fd.get("distance")) : null,
    duration: fd.get("duration") ? parseInt(fd.get("duration"), 10) : null,
    notes: fd.get("notes").trim(),
  };
}

function openPlanForm(existing, defaultDate) {
  const s = existing || { id: uid(), type: "Run", title: "", date: defaultDate || todayISO(), status: "planned", planned: {}, actual: null };
  openModal(`
    <h2>${existing ? "Edit" : "Plan"} a session</h2>
    <form id="plan-form">
      <label>Type
        <select name="type">
          <option value="Run" ${s.type === "Run" ? "selected" : ""}>Run</option>
          <option value="Workout" ${s.type === "Workout" ? "selected" : ""}>Workout</option>
        </select>
      </label>
      <label>Title
        <input name="title" type="text" required value="${escapeHtml(s.title)}" placeholder="e.g. Easy 5k, Leg day">
      </label>
      <label>Date
        <input name="date" type="date" required value="${s.date}">
      </label>
      <div class="row">
        <label>Distance (mi)
          <input name="distance" type="number" step="any" min="0" value="${s.planned?.distance ?? ""}">
        </label>
        <label>Duration (min)
          <input name="duration" type="number" step="1" min="0" value="${s.planned?.duration ?? ""}">
        </label>
      </div>
      <div class="route-section">
        ${s.planned?.route
          ? `<div class="route-summary">
               <span>${s.planned.route.points.length} pts · ${s.planned.route.distance} mi · ${s.planned.route.mode}</span>
               <button type="button" class="btn" id="edit-route-btn">Edit route</button>
               <button type="button" class="btn danger" id="clear-route-btn">Clear</button>
             </div>`
          : `<div class="route-buttons">
               <button type="button" class="btn" id="set-route-btn">Draw route on map</button>
               <button type="button" class="btn" id="random-route-btn">🎲 Random route</button>
             </div>`}
      </div>
      <label>Notes
        <textarea name="notes" rows="3" placeholder="target pace, exercises, anything else">${escapeHtml(s.planned?.notes)}</textarea>
      </label>
      <div class="form-actions">
        <button type="button" class="btn" id="cancel-btn">Cancel</button>
        <button type="submit" class="btn primary">Save</button>
      </div>
    </form>
  `);

  document.getElementById("cancel-btn").addEventListener("click", closeModal);

  const routeBtn = document.getElementById("set-route-btn") || document.getElementById("edit-route-btn");
  if (routeBtn) {
    routeBtn.addEventListener("click", () => {
      syncDraftFromForm(s);
      openRouteBuilder(s, (routeData) => {
        s.planned.route = routeData;
        s.planned.distance = routeData.distance;
        openPlanForm(s);
      });
    });
  }
  const clearRouteBtn = document.getElementById("clear-route-btn");
  if (clearRouteBtn) {
    clearRouteBtn.addEventListener("click", () => {
      syncDraftFromForm(s);
      s.planned.route = null;
      openPlanForm(s);
    });
  }
  const randomRouteBtn = document.getElementById("random-route-btn");
  if (randomRouteBtn) {
    randomRouteBtn.addEventListener("click", () => {
      syncDraftFromForm(s);
      openRandomRouteBuilder(s, (routeData) => {
        s.planned.route = routeData;
        s.planned.distance = routeData.distance;
        openPlanForm(s);
      });
    });
  }

  document.getElementById("plan-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    s.type = fd.get("type");
    s.title = fd.get("title").trim();
    s.date = fd.get("date");
    s.planned = {
      ...s.planned,
      distance: fd.get("distance") ? parseFloat(fd.get("distance")) : null,
      duration: fd.get("duration") ? parseInt(fd.get("duration"), 10) : null,
      notes: fd.get("notes").trim(),
    };
    await Sessions.upsert(s);
    closeModal();
    await loadSessions();
  });
}

function openLogForm(session) {
  const isUnplanned = !session;
  const s = session || { id: uid(), type: "Run", title: "", date: todayISO(), status: "planned", planned: null, actual: null };
  openModal(`
    <h2>Log ${isUnplanned ? "an unplanned" : ""} session</h2>
    <form id="log-form">
      ${isUnplanned ? `
        <label>Type
          <select name="type">
            <option value="Run">Run</option>
            <option value="Workout">Workout</option>
          </select>
        </label>
        <label>Title
          <input name="title" type="text" required placeholder="e.g. Easy 5k, Leg day">
        </label>
        <label>Date
          <input name="date" type="date" required value="${todayISO()}">
        </label>
      ` : `<p class="log-target">${escapeHtml(s.title)} — ${fmtDate(s.date)}</p>`}
      <div class="row">
        <label>Distance (mi)
          <input name="distance" type="number" step="any" min="0" value="${s.planned?.distance ?? ""}">
        </label>
        <label>Duration (min)
          <input name="duration" type="number" step="1" min="0" value="${s.planned?.duration ?? ""}">
        </label>
      </div>
      <label>Effort (1-10)
        <input name="effort" type="number" min="1" max="10" step="1">
      </label>
      <label>Notes
        <textarea name="notes" rows="3" placeholder="how it felt, splits, anything else"></textarea>
      </label>
      <div class="form-actions">
        <button type="button" class="btn" id="cancel-btn">Cancel</button>
        <button type="submit" class="btn primary">Save</button>
      </div>
    </form>
  `);

  document.getElementById("cancel-btn").addEventListener("click", closeModal);
  document.getElementById("log-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    if (isUnplanned) {
      s.type = fd.get("type");
      s.title = fd.get("title").trim();
      s.date = fd.get("date");
    }
    s.status = "completed";
    s.actual = {
      distance: fd.get("distance") ? parseFloat(fd.get("distance")) : null,
      duration: fd.get("duration") ? parseInt(fd.get("duration"), 10) : null,
      effort: fd.get("effort") ? parseInt(fd.get("effort"), 10) : null,
      notes: fd.get("notes").trim(),
    };
    await Sessions.upsert(s);
    closeModal();
    await loadSessions();
  });
}

// ---------- tabs ----------

document.getElementById("tabs").addEventListener("click", (e) => {
  const btn = e.target.closest(".tab");
  if (!btn) return;
  document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
  document.querySelectorAll(".view").forEach(v => v.classList.remove("active"));
  btn.classList.add("active");
  document.getElementById(`${btn.dataset.tab}-tab`).classList.add("active");
});

document.getElementById("new-plan-btn").addEventListener("click", () => openPlanForm(null));
document.getElementById("log-unplanned-btn").addEventListener("click", () => openLogForm(null));

loadSessions();
