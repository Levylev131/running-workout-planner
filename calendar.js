// Calendar tab: month grid + week agenda, toggled by the user.
// Relies on globals from app.js (sessions, fmtDate, sessionCardHtml, bindCardActions, openModal, todayISO).

const calState = {
  view: "month", // "month" | "week"
  anchor: new Date(),
};

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function calToLocalISO(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function calStartOfWeek(date) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  d.setDate(d.getDate() - d.getDay());
  return d;
}

function calSessionsOn(dateISO) {
  return sessions
    .filter(s => s.date === dateISO)
    .sort((a, b) => (a.status === b.status ? 0 : a.status === "planned" ? -1 : 1));
}

function renderCalendarTab() {
  const root = document.getElementById("calendar-root");
  if (!root) return;

  root.innerHTML = `
    <div class="cal-header">
      <div class="cal-toggle" id="cal-view-toggle">
        <button class="cal-toggle-btn ${calState.view === "month" ? "active" : ""}" data-view="month">Month</button>
        <button class="cal-toggle-btn ${calState.view === "week" ? "active" : ""}" data-view="week">Week</button>
      </div>
      <div class="cal-nav">
        <button class="btn" id="cal-prev">‹</button>
        <button class="btn" id="cal-today">Today</button>
        <button class="btn" id="cal-next">›</button>
      </div>
    </div>
    <h2 class="cal-label">${calState.view === "month" ? calMonthLabel() : calWeekLabel()}</h2>
    <div id="cal-body"></div>
  `;

  document.getElementById("cal-view-toggle").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-view]");
    if (!btn) return;
    calState.view = btn.dataset.view;
    renderCalendarTab();
  });
  document.getElementById("cal-prev").addEventListener("click", () => calShift(-1));
  document.getElementById("cal-next").addEventListener("click", () => calShift(1));
  document.getElementById("cal-today").addEventListener("click", () => {
    calState.anchor = new Date();
    renderCalendarTab();
  });

  const body = document.getElementById("cal-body");
  if (calState.view === "month") {
    renderMonthGrid(body);
  } else {
    renderWeekAgenda(body);
  }
}

function calShift(dir) {
  const a = calState.anchor;
  if (calState.view === "month") {
    calState.anchor = new Date(a.getFullYear(), a.getMonth() + dir, 1);
  } else {
    const d = new Date(a);
    d.setDate(d.getDate() + dir * 7);
    calState.anchor = d;
  }
  renderCalendarTab();
}

function calMonthLabel() {
  return calState.anchor.toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

function calWeekLabel() {
  const start = calStartOfWeek(calState.anchor);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  const sameMonth = start.getMonth() === end.getMonth();
  const startStr = start.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const endStr = end.toLocaleDateString(undefined, sameMonth ? { day: "numeric", year: "numeric" } : { month: "short", day: "numeric", year: "numeric" });
  return `${startStr} – ${endStr}`;
}

function renderMonthGrid(container) {
  const year = calState.anchor.getFullYear();
  const month = calState.anchor.getMonth();
  const firstOfMonth = new Date(year, month, 1);
  const gridStart = new Date(year, month, 1 - firstOfMonth.getDay());
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const totalCells = Math.ceil((firstOfMonth.getDay() + daysInMonth) / 7) * 7;
  const todayStr = todayISO();

  let cellsHtml = "";
  for (let i = 0; i < totalCells; i++) {
    const cellDate = new Date(gridStart);
    cellDate.setDate(gridStart.getDate() + i);
    const iso = calToLocalISO(cellDate);
    const inMonth = cellDate.getMonth() === month;
    const items = calSessionsOn(iso);
    const dots = items.slice(0, 4).map(s => `<span class="cal-dot ${s.status}"></span>`).join("");
    cellsHtml += `
      <button type="button" class="cal-cell ${inMonth ? "" : "outside"} ${iso === todayStr ? "today" : ""}" data-date="${iso}">
        <span class="cal-cell-num">${cellDate.getDate()}</span>
        <span class="cal-cell-dots">${dots}</span>
      </button>
    `;
  }

  container.innerHTML = `
    <div class="cal-grid">
      ${WEEKDAY_LABELS.map(l => `<div class="cal-weekday">${l}</div>`).join("")}
      ${cellsHtml}
    </div>
  `;

  container.querySelectorAll(".cal-cell").forEach(cell => {
    cell.addEventListener("click", () => openDayModal(cell.dataset.date));
  });
}

function renderWeekAgenda(container) {
  const start = calStartOfWeek(calState.anchor);
  const todayStr = todayISO();

  let html = "";
  for (let i = 0; i < 7; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    const iso = calToLocalISO(d);
    const items = calSessionsOn(iso);
    html += `
      <div class="cal-day-section ${iso === todayStr ? "today" : ""}">
        <div class="cal-day-heading">
          <span>${d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}</span>
          <button type="button" class="cal-day-add" data-date="${iso}">+ Add</button>
        </div>
        ${items.length === 0
          ? `<p class="cal-day-empty">Nothing</p>`
          : items.map(s => `
              <button type="button" class="cal-agenda-item" data-id="${s.id}">
                <span class="cal-dot ${s.status}"></span>
                <span class="badge ${s.type}">${s.type}</span>
                <span class="cal-agenda-title">${escapeHtml(s.title)}</span>
              </button>
            `).join("")
        }
      </div>
    `;
  }
  container.innerHTML = `<div class="cal-week">${html}</div>`;

  container.querySelectorAll(".cal-agenda-item").forEach(btn => {
    btn.addEventListener("click", () => openDayModal(sessions.find(s => s.id === btn.dataset.id).date));
  });
  container.querySelectorAll(".cal-day-add").forEach(btn => {
    btn.addEventListener("click", () => openPlanForm(null, btn.dataset.date));
  });
}

function openDayModal(dateISO) {
  const items = calSessionsOn(dateISO);
  const label = new Date(dateISO + "T00:00:00").toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
  openModal(`
    <div class="cal-day-header">
      <h2>${label}</h2>
      <button type="button" class="btn" id="cal-day-back-btn">← Back To Calendar</button>
    </div>
    <button type="button" class="btn primary add-btn" id="cal-day-add-btn">+ Add Session</button>
    ${items.length === 0
      ? `<p class="empty">Nothing planned.</p>`
      : `<div class="session-list">${items.map(sessionCardHtml).join("")}</div>`}
  `);
  bindCardActions(document.getElementById("modal-content"));
  document.getElementById("cal-day-add-btn").addEventListener("click", () => openPlanForm(null, dateISO));
  document.getElementById("cal-day-back-btn").addEventListener("click", closeModal);
}
