let sessions = [];
let templates = [];

async function loadSessions() {
  sessions = await Sessions.all();
  templates = await Templates.all();
  renderPlanTab();
  renderHistoryTab();
  renderCalendarTab();
  renderFavoritesTab();
}

function isSessionSaved(s) {
  return templates.some(t => t.sourceSessionId === s.id);
}

// ---------- helpers ----------

function fmtDate(iso) {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

function pace(distance, duration) {
  if (!distance || !duration) return null;
  const mph = distance / (duration / 60);
  return `${mph.toFixed(2)} mph`;
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

// Duration is entered as separate hours/minutes/seconds inputs but stored as
// plain decimal minutes (same as always), so pace() and existing data need no changes.
function hmsToMinutes(h, m, s) {
  if (!h && !m && !s) return null;
  const hh = parseInt(h, 10) || 0;
  const mm = parseInt(m, 10) || 0;
  const ss = parseInt(s, 10) || 0;
  return hh * 60 + mm + ss / 60;
}

function minutesToHms(mins) {
  if (mins == null) return { h: "", m: "", s: "" };
  const totalSec = Math.round(mins * 60);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return { h: h ? String(h) : "", m: String(m), s: String(s) };
}

function hmsInputsHtml(mins) {
  const hms = minutesToHms(mins);
  return `
    <div class="hms-inputs">
      <div class="hms-field">
        <input name="duration_h" type="number" inputmode="numeric" min="0" placeholder="0" value="${hms.h}">
        <span class="hms-unit">hr</span>
      </div>
      <div class="hms-field">
        <input name="duration_m" type="number" inputmode="numeric" min="0" max="59" placeholder="0" value="${hms.m}">
        <span class="hms-unit">min</span>
      </div>
      <div class="hms-field">
        <input name="duration_s" type="number" inputmode="numeric" min="0" max="59" placeholder="0" value="${hms.s}">
        <span class="hms-unit">sec</span>
      </div>
    </div>
  `;
}

function formatDuration(mins) {
  if (mins == null) return null;
  const totalSec = Math.round(mins * 60);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) {
    const mm = String(m).padStart(2, "0");
    return s === 0 ? `${h}:${mm} min` : `${h}:${mm}.${String(s).padStart(2, "0")} min`;
  }
  return s === 0 ? `${m} min` : `${m}.${String(s).padStart(2, "0")} min`;
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
        ${s.planned.duration ? `<span>${formatDuration(s.planned.duration)}</span>` : ""}
        ${s.planned.distance && s.planned.duration ? `<span>${pace(s.planned.distance, s.planned.duration)}</span>` : ""}
      </div>
      ${s.planned.notes ? `<p class="notes">${escapeHtml(s.planned.notes)}</p>` : ""}
      <div class="card-actions">
        <button class="btn primary" data-action="log" data-id="${s.id}">Log It</button>
        <button class="btn" data-action="edit" data-id="${s.id}">Edit</button>
        ${s.planned.route ? `<button class="btn" data-action="view-route" data-id="${s.id}">Map</button>` : ""}
        <button class="btn danger" data-action="delete" data-id="${s.id}">Delete</button>
        <button class="icon-btn ${isSessionSaved(s) ? "saved" : ""}" data-action="save-template" data-id="${s.id}" title="Save Session" aria-label="Save Session">⭐</button>
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
            <span>${s.planned.duration ? formatDuration(s.planned.duration) : "—"}</span>
          </div>
        ` : ""}
        <div class="compare-col">
          <span class="compare-label">Actual</span>
          <span>${s.actual.distance ? s.actual.distance + " mi" : "—"}</span>
          <span>${s.actual.duration ? formatDuration(s.actual.duration) : "—"}</span>
          <span>${s.actual.distance && s.actual.duration ? pace(s.actual.distance, s.actual.duration) : ""}</span>
        </div>
        <div class="compare-col">
          <span class="compare-label">Effort</span>
          <span>${s.actual.effort ? s.actual.effort + "/10" : "—"}</span>
        </div>
      </div>
      ${s.actual.notes ? `<p class="notes">${escapeHtml(s.actual.notes)}</p>` : ""}
      <div class="card-actions">
        <button class="btn" data-action="log" data-id="${s.id}">Edit</button>
        ${hadPlan && s.planned.route ? `<button class="btn" data-action="view-route" data-id="${s.id}">Map</button>` : ""}
        <button class="btn" data-action="share" data-id="${s.id}">📤 Share</button>
        <button class="btn danger" data-action="delete" data-id="${s.id}">Delete</button>
        <button class="icon-btn ${isSessionSaved(s) ? "saved" : ""}" data-action="save-template" data-id="${s.id}" title="Save Session" aria-label="Save Session">⭐</button>
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

// Plain-line silhouette normalized to the route's own bounding box, same approach
// share.js uses for the share card — no map tiles, so it works fully offline.
function routeThumbSvg(route) {
  if (!route || !route.points || route.points.length < 2) return "";
  const backLeg = route.backRoute || (route.roundTrip ? route.points.slice().reverse() : []);
  const allPoints = route.points.concat(backLeg);
  const lats = allPoints.map(p => p[0]);
  const lngs = allPoints.map(p => p[1]);
  const minLat = Math.min(...lats), maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
  const latRange = maxLat - minLat || 0.001;
  const lngRange = maxLng - minLng || 0.001;
  const size = 100;
  const pad = 12;
  const scale = Math.min((size - pad * 2) / lngRange, (size - pad * 2) / latRange);
  const midLat = (minLat + maxLat) / 2;
  const midLng = (minLng + maxLng) / 2;
  const pts = allPoints
    .map(([lat, lng]) => `${(size / 2 + (lng - midLng) * scale).toFixed(1)},${(size / 2 - (lat - midLat) * scale).toFixed(1)}`)
    .join(" ");
  return `<svg viewBox="0 0 ${size} ${size}" preserveAspectRatio="xMidYMid meet"><polyline points="${pts}" /></svg>`;
}

function templateCardHtml(t) {
  return `
    <div class="card template-card">
      <div class="template-card-main">
        <div class="card-header">
          <span class="badge ${t.type}">${t.type}</span>
        </div>
        <h3>${escapeHtml(t.title)}</h3>
        <div class="meta">
          ${t.distance ? `<span>${t.distance} mi</span>` : ""}
          ${t.duration ? `<span>${formatDuration(t.duration)}</span>` : ""}
          ${t.distance && t.duration ? `<span>${pace(t.distance, t.duration)}</span>` : ""}
        </div>
        ${t.notes ? `<p class="notes">${escapeHtml(t.notes)}</p>` : ""}
        <div class="card-actions">
          <button class="btn primary" data-tpl-action="plan" data-tpl-id="${t.id}">+ Plan This</button>
          <button class="btn danger" data-tpl-action="delete" data-tpl-id="${t.id}">Delete</button>
        </div>
      </div>
      <div class="route-thumb">${routeThumbSvg(t.route)}</div>
    </div>
  `;
}

function renderFavoritesTab() {
  const list = document.getElementById("favorites-list");
  if (templates.length === 0) {
    list.innerHTML = `<p class="empty">No saved sessions yet. Tap ⭐ on a session's card to save one here.</p>`;
    return;
  }
  list.innerHTML = templates.map(templateCardHtml).join("");
  list.querySelectorAll("[data-tpl-action]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const tpl = templates.find(t => t.id === btn.dataset.tplId);
      if (btn.dataset.tplAction === "delete") {
        if (confirm("Delete this saved session?")) {
          await Templates.remove(tpl.id);
          await loadSessions();
        }
      } else if (btn.dataset.tplAction === "plan") {
        openPlanForm({
          id: uid(),
          type: tpl.type,
          title: tpl.title,
          date: todayISO(),
          status: "planned",
          planned: { distance: tpl.distance, duration: tpl.duration, notes: tpl.notes, route: tpl.route || null },
          actual: null,
        });
      }
    });
  });
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str || "";
  return div.innerHTML;
}

// ---------- actions ----------

function sessionToTemplate(s) {
  const source = s.status === "completed" ? (s.actual || {}) : (s.planned || {});
  return {
    id: uid(),
    sourceSessionId: s.id,
    type: s.type,
    title: s.title,
    distance: source.distance ?? null,
    duration: source.duration ?? null,
    notes: source.notes || "",
    route: s.planned?.route || null,
  };
}

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
  } else if (action === "share") {
    shareRun(session);
  } else if (action === "save-template") {
    const existingTpl = templates.find(t => t.sourceSessionId === session.id);
    if (existingTpl) {
      await Templates.remove(existingTpl.id);
    } else {
      await Templates.upsert(sessionToTemplate(session));
    }
    await loadSessions();
  }
}

// ---------- saved sessions (templates) ----------

async function openTemplatePicker(onPick) {
  const tplList = await Templates.all();
  openModal(`
    <h2>Saved Sessions</h2>
    ${tplList.length === 0
      ? `<p class="empty">No saved sessions yet. Use "Save Session" on a session's card first.</p>`
      : `<div class="template-list">
          ${tplList.map(t => `
            <div class="template-item">
              <div class="template-item-main">
                <div class="template-item-title">
                  <span class="badge ${t.type}">${t.type}</span>
                  <strong>${escapeHtml(t.title)}</strong>
                </div>
                <span class="meta">
                  ${t.distance ? `<span>${t.distance} mi</span>` : ""}
                  ${t.duration ? `<span>${formatDuration(t.duration)}</span>` : ""}
                  ${t.route ? `<span>has route</span>` : ""}
                </span>
              </div>
              <div class="template-item-actions">
                <button type="button" class="btn primary" data-tpl-use="${t.id}">Use</button>
                <button type="button" class="btn danger" data-tpl-delete="${t.id}">Delete</button>
              </div>
            </div>
          `).join("")}
        </div>`}
    <div class="form-actions">
      <button type="button" class="btn" id="template-back-btn">← Back</button>
    </div>
  `);

  document.getElementById("template-back-btn").addEventListener("click", () => onPick(null));

  document.querySelectorAll("[data-tpl-use]").forEach(btn => {
    btn.addEventListener("click", () => {
      const tpl = tplList.find(t => t.id === btn.dataset.tplUse);
      onPick(tpl);
    });
  });

  document.querySelectorAll("[data-tpl-delete]").forEach(btn => {
    btn.addEventListener("click", async () => {
      if (confirm("Delete this saved session?")) {
        await Templates.remove(btn.dataset.tplDelete);
        await loadSessions();
        openTemplatePicker(onPick);
      }
    });
  });
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
    duration: hmsToMinutes(fd.get("duration_h"), fd.get("duration_m"), fd.get("duration_s")),
    notes: fd.get("notes").trim(),
  };
}

function openPlanForm(existing, defaultDate) {
  const s = existing || { id: uid(), type: "Run", title: "", date: defaultDate || todayISO(), status: "planned", planned: {}, actual: null };
  // Not `!existing` — a new session stays "new" across recursive re-renders (e.g. after
  // drawing a route) even though `existing` becomes truthy once s itself is passed back in.
  const isNew = !sessions.some(sess => sess.id === s.id);
  openModal(`
    <div class="modal-header-row">
      <h2>${isNew ? "Plan" : "Edit"} a Session</h2>
      ${isNew ? `<button type="button" class="btn" id="use-template-btn">📋 Load Saved Session</button>` : ""}
    </div>
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
        <label>Target Time
          ${hmsInputsHtml(s.planned?.duration)}
        </label>
      </div>
      <div class="route-section">
        ${s.planned?.route
          ? `<div class="route-summary">
               <span>${s.planned.route.points.length} pts · ${s.planned.route.distance} mi · ${s.planned.route.mode}${s.planned.route.roundTrip ? " · round trip" : ""}${s.planned.route.backRoute ? " · random route back" : ""}</span>
               <button type="button" class="btn" id="edit-route-btn">Edit Route</button>
               <button type="button" class="btn danger" id="clear-route-btn">Clear</button>
             </div>`
          : `<div class="route-buttons">
               <button type="button" class="btn" id="set-route-btn">Draw Route On Map</button>
               <button type="button" class="btn" id="random-route-btn">🎲 Random Route</button>
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

  const useTemplateBtn = document.getElementById("use-template-btn");
  if (useTemplateBtn) {
    useTemplateBtn.addEventListener("click", () => {
      syncDraftFromForm(s);
      openTemplatePicker((tpl) => {
        if (tpl) {
          s.type = tpl.type;
          s.title = tpl.title;
          s.planned = {
            ...s.planned,
            distance: tpl.distance,
            duration: tpl.duration,
            notes: tpl.notes,
            route: tpl.route || null,
          };
        }
        openPlanForm(s);
      });
    });
  }

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
      duration: hmsToMinutes(fd.get("duration_h"), fd.get("duration_m"), fd.get("duration_s")),
      notes: fd.get("notes").trim(),
    };
    await Sessions.upsert(s);
    closeModal();
    await loadSessions();
  });
}

function openLogForm(session) {
  const isUnplanned = !session;
  const isEditingCompleted = !!session && session.status === "completed";
  const s = session || { id: uid(), type: "Run", title: "", date: todayISO(), status: "planned", planned: null, actual: null };
  const source = isEditingCompleted ? s.actual : s.planned;
  openModal(`
    <h2>${isUnplanned ? "Log An Unplanned Session" : isEditingCompleted ? "Edit Session" : "Log Session"}</h2>
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
          <input name="distance" type="number" step="any" min="0" value="${source?.distance ?? ""}">
        </label>
        <label>Duration
          ${hmsInputsHtml(source?.duration)}
        </label>
      </div>
      <label>Effort (1-10)
        <input name="effort" type="number" min="1" max="10" step="1" value="${source?.effort ?? ""}">
      </label>
      <label>Notes
        <textarea name="notes" rows="3" placeholder="how it felt, splits, anything else">${escapeHtml(source?.notes || "")}</textarea>
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
      duration: hmsToMinutes(fd.get("duration_h"), fd.get("duration_m"), fd.get("duration_s")),
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

// ---------- profile ----------

const AVATAR_COLORS = ["#4a6d5c", "#5c7ab8", "#b8735c", "#8a5cb8", "#b85c8a", "#5cb894"];

function getProfile() {
  const raw = localStorage.getItem("rwp_profile");
  return raw ? JSON.parse(raw) : null;
}

function saveProfile(profile) {
  localStorage.setItem("rwp_profile", JSON.stringify(profile));
}

function initials(name) {
  return (name || "").trim().split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join("");
}

function renderProfileButton() {
  const btn = document.getElementById("settings-btn");
  const p = getProfile();
  if (p && p.name && p.name.trim()) {
    btn.textContent = initials(p.name);
    btn.style.background = p.color;
    btn.style.borderColor = p.color;
    btn.style.color = "white";
    btn.style.fontSize = "13px";
    btn.style.fontWeight = "700";
  } else {
    btn.textContent = "⚙️";
    btn.style.background = "";
    btn.style.borderColor = "";
    btn.style.color = "";
    btn.style.fontSize = "";
    btn.style.fontWeight = "";
  }
}

// ---------- settings ----------

function currentTheme() {
  const explicit = document.documentElement.getAttribute("data-theme");
  if (explicit) return explicit;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function currentAccent() {
  return localStorage.getItem("accentColor")
    || getComputedStyle(document.documentElement).getPropertyValue("--accent").trim();
}

function openSettingsModal() {
  const p = getProfile();
  openModal(`
    <h2>Settings</h2>
    <div class="settings-profile">
      <div class="settings-avatar" id="profile-avatar-preview" style="background:${p?.color || AVATAR_COLORS[0]}">${p?.name ? initials(p.name) : "?"}</div>
      <input type="text" id="profile-name-input" placeholder="Your name" maxlength="24" value="${p?.name ? escapeHtml(p.name) : ""}">
    </div>
    <div class="settings-color-row" id="profile-color-row">
      ${AVATAR_COLORS.map(c => `<div class="color-swatch ${(p?.color || AVATAR_COLORS[0]) === c ? "active" : ""}" style="background:${c}" data-color="${c}"></div>`).join("")}
    </div>
    <div class="settings-row">
      <span class="settings-row-label">Dark Mode</span>
      <label class="switch">
        <input type="checkbox" id="dark-mode-toggle" ${currentTheme() === "dark" ? "checked" : ""}>
        <span class="switch-slider"></span>
      </label>
    </div>
    <div class="settings-row">
      <span class="settings-row-label">Accent Color</span>
      <div class="settings-color-controls">
        <input type="color" id="accent-color-picker" value="${currentAccent()}">
        <button type="button" class="btn" id="reset-accent-btn">Reset</button>
      </div>
    </div>
    <div class="settings-section-label">Backup</div>
    <p class="settings-hint">Your data lives only on this device. Export a backup file (sessions, theme, and profile) before switching phones or clearing browser data — Import restores from one.</p>
    <div class="settings-backup-actions">
      <button type="button" class="btn" id="export-data-btn">⬇ Export Data</button>
      <button type="button" class="btn" id="import-data-btn">⬆ Import Data</button>
    </div>
    <input type="file" id="import-file-input" accept="application/json" hidden>
    <div class="form-actions">
      <button type="button" class="btn primary" id="settings-done-btn">Done</button>
    </div>
  `);

  document.getElementById("profile-name-input").addEventListener("input", (e) => {
    const prof = getProfile() || { color: AVATAR_COLORS[0] };
    prof.name = e.target.value;
    saveProfile(prof);
    document.getElementById("profile-avatar-preview").textContent = initials(prof.name) || "?";
    renderProfileButton();
  });

  document.querySelectorAll("#profile-color-row .color-swatch").forEach(sw => {
    sw.addEventListener("click", () => {
      const prof = getProfile() || { name: "" };
      prof.color = sw.dataset.color;
      saveProfile(prof);
      document.querySelectorAll("#profile-color-row .color-swatch").forEach(s => s.classList.toggle("active", s === sw));
      document.getElementById("profile-avatar-preview").style.background = prof.color;
      renderProfileButton();
    });
  });

  document.getElementById("dark-mode-toggle").addEventListener("change", (e) => {
    const next = e.target.checked ? "dark" : "light";
    document.documentElement.setAttribute("data-theme", next);
    localStorage.setItem("theme", next);
  });

  document.getElementById("accent-color-picker").addEventListener("input", (e) => {
    document.documentElement.style.setProperty("--accent", e.target.value);
    localStorage.setItem("accentColor", e.target.value);
  });

  document.getElementById("reset-accent-btn").addEventListener("click", () => {
    document.documentElement.style.removeProperty("--accent");
    localStorage.removeItem("accentColor");
    closeModal();
    openSettingsModal();
  });

  document.getElementById("export-data-btn").addEventListener("click", exportData);
  document.getElementById("import-data-btn").addEventListener("click", () => {
    document.getElementById("import-file-input").click();
  });
  document.getElementById("import-file-input").addEventListener("change", (e) => {
    const file = e.target.files[0];
    e.target.value = "";
    if (file) importData(file);
  });

  document.getElementById("settings-done-btn").addEventListener("click", closeModal);
}

async function exportData() {
  const allSessions = await Sessions.all();
  const allTemplates = await Templates.all();
  const payload = {
    app: "run-workout-planner",
    version: 3,
    exportedAt: new Date().toISOString(),
    sessions: allSessions,
    templates: allTemplates,
    settings: {
      theme: localStorage.getItem("theme"),
      accentColor: localStorage.getItem("accentColor"),
      profile: getProfile(),
    },
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `run-planner-backup-${todayISO()}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function importData(file) {
  const reader = new FileReader();
  reader.onload = async () => {
    let payload;
    try {
      payload = JSON.parse(reader.result);
    } catch (e) {
      alert("That file isn't valid backup data.");
      return;
    }
    if (!payload || !Array.isArray(payload.sessions)) {
      alert("That file isn't a recognized backup.");
      return;
    }
    const templates = Array.isArray(payload.templates) ? payload.templates : [];
    const ok = confirm(`Import ${payload.sessions.length} session(s) and ${templates.length} saved session(s)? This replaces everything currently in the app.`);
    if (!ok) return;
    await Sessions.clear();
    for (const s of payload.sessions) {
      await Sessions.upsert(s);
    }
    await Templates.clear();
    for (const t of templates) {
      await Templates.upsert(t);
    }

    const settings = payload.settings || {};
    if (settings.theme === "light" || settings.theme === "dark") {
      document.documentElement.setAttribute("data-theme", settings.theme);
      localStorage.setItem("theme", settings.theme);
    }
    if (settings.accentColor) {
      document.documentElement.style.setProperty("--accent", settings.accentColor);
      localStorage.setItem("accentColor", settings.accentColor);
    }
    if (settings.profile && settings.profile.name) {
      saveProfile(settings.profile);
      renderProfileButton();
    }

    closeModal();
    await loadSessions();
    alert("Import complete.");
  };
  reader.readAsText(file);
}

document.getElementById("settings-btn").addEventListener("click", openSettingsModal);

renderProfileButton();
loadSessions();
