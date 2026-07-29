// Map-based route drawing. Wrapped in an IIFE so this file introduces zero
// top-level identifiers shared with db.js/app.js (classic <script> tags share
// one global scope — see the uid()/Sessions collision fixed earlier).
(function () {
  function haversineMiles(lat1, lng1, lat2, lng2) {
    const R = 3958.8;
    const toRad = (d) => (d * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  function totalDistance(points) {
    let sum = 0;
    for (let i = 1; i < points.length; i++) {
      sum += haversineMiles(points[i - 1][0], points[i - 1][1], points[i][0], points[i][1]);
    }
    return sum;
  }

  function getLastMapView() {
    try {
      const raw = localStorage.getItem("rwp_last_map_view");
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function saveLastMapView(center, zoom) {
    localStorage.setItem("rwp_last_map_view", JSON.stringify({ center, zoom }));
  }

  // Real GPS via the browser. Only works over a secure context (HTTPS or
  // localhost) — on plain HTTP via a LAN IP, navigator.geolocation is either
  // absent or getCurrentPosition rejects, so callers must fall back.
  function tryGeolocation() {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error("Geolocation not available"));
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve([pos.coords.latitude, pos.coords.longitude]),
        (err) => reject(err),
        { timeout: 6000, maximumAge: 60000 }
      );
    });
  }

  // Free, no-signup IP-based approximate location (city-level, not precise).
  // Fallback for when real GPS isn't available (e.g. still on plain HTTP).
  async function locateApprox() {
    const res = await fetch("https://ipapi.co/json/");
    if (!res.ok) throw new Error("IP lookup failed");
    const data = await res.json();
    if (data.latitude == null || data.longitude == null) throw new Error("No location in response");
    return [data.latitude, data.longitude];
  }

  // Free, no-signup place/address search (OpenStreetMap Nominatim).
  async function searchPlace(query) {
    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(query)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error("Search failed");
    const data = await res.json();
    if (!data.length) throw new Error("No results found.");
    return [parseFloat(data[0].lat), parseFloat(data[0].lon)];
  }

  function tileLayer() {
    return L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 19,
    });
  }

  function openRouteBuilder(session, onConfirm) {
    const existingRoute = session.planned && session.planned.route;

    openModal(
      `
      <div class="route-toolbar">
        <span class="route-status" id="route-status">Finding your location…</span>
        <button type="button" class="btn" id="route-cancel-btn">Cancel</button>
      </div>
      <div class="route-search">
        <input type="text" id="route-search-input" placeholder="Search address or place">
        <button type="button" class="btn" id="route-search-btn">Go</button>
      </div>
      <div id="route-map"></div>
      <div class="route-footer" id="route-footer"></div>
    `,
      { fullscreen: true }
    );

    const lastView = getLastMapView();
    const map = L.map("route-map").setView(
      lastView ? lastView.center : [39.8283, -98.5795],
      lastView ? lastView.zoom : 4
    );
    tileLayer().addTo(map);
    requestAnimationFrame(() => map.invalidateSize());

    map.on("moveend", () => {
      const c = map.getCenter();
      saveLastMapView([c.lat, c.lng], map.getZoom());
    });

    function setStatus(text) {
      const el = document.getElementById("route-status");
      if (el) el.textContent = text;
    }

    let points = existingRoute ? existingRoute.points.slice() : [];
    const polyline = L.polyline(points, { color: "#4a6d5c" }).addTo(map);
    const markers = L.layerGroup().addTo(map);

    // Guards against the background auto-locate chain (GPS → IP, both real
    // network calls of unpredictable latency) clobbering the map after the
    // user has already searched or started drawing their own route.
    let userOverride = false;

    function redraw() {
      polyline.setLatLngs(points);
      markers.clearLayers();
      points.forEach((p) => L.circleMarker(p, { radius: 5, color: "#4a6d5c", fillOpacity: 1 }).addTo(markers));
    }
    redraw();

    if (existingRoute && points.length) {
      userOverride = true;
      map.fitBounds(polyline.getBounds(), { padding: [20, 20] });
      setStatus("");
    } else {
      tryGeolocation()
        .then(([lat, lng]) => {
          if (userOverride) return;
          map.setView([lat, lng], 16);
          setStatus("");
        })
        .catch(() =>
          locateApprox().then(([lat, lng]) => {
            if (userOverride) return;
            map.setView([lat, lng], 14);
            setStatus("");
          })
        )
        .catch(() => {
          if (userOverride) return;
          setStatus("Couldn't find your location — search an address or pan/zoom.");
        });
    }

    document.getElementById("route-search-btn").addEventListener("click", doSearch);
    document.getElementById("route-search-input").addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        doSearch();
      }
    });

    async function doSearch() {
      const input = document.getElementById("route-search-input");
      const q = input.value.trim();
      if (!q) return;
      setStatus("Searching…");
      try {
        const [lat, lng] = await searchPlace(q);
        userOverride = true;
        map.setView([lat, lng], 15);
        setStatus("");
      } catch (err) {
        setStatus(err.message);
      }
    }

    function renderFooter() {
      const footer = document.getElementById("route-footer");
      const dist = totalDistance(points);
      footer.innerHTML = `
        <div class="route-distance">${points.length ? dist.toFixed(2) + " mi" : "Tap the map to add points"}</div>
        <div class="route-actions">
          <button type="button" class="btn" id="undo-btn" ${points.length === 0 ? "disabled" : ""}>Undo</button>
          <button type="button" class="btn danger" id="clear-btn" ${points.length === 0 ? "disabled" : ""}>Clear</button>
          <button type="button" class="btn primary" id="confirm-btn" ${points.length < 2 ? "disabled" : ""}>Use this route</button>
        </div>
      `;
      document.getElementById("undo-btn").addEventListener("click", () => {
        points.pop();
        redraw();
        renderFooter();
      });
      document.getElementById("clear-btn").addEventListener("click", () => {
        points = [];
        redraw();
        renderFooter();
      });
      document.getElementById("confirm-btn").addEventListener("click", () => {
        const routeData = {
          mode: "draw",
          points: points.slice(),
          distance: Math.round(totalDistance(points) * 100) / 100,
        };
        map.remove();
        onConfirm(routeData);
      });
    }
    renderFooter();

    map.on("click", (e) => {
      userOverride = true;
      points.push([e.latlng.lat, e.latlng.lng]);
      redraw();
      renderFooter();
    });

    document.getElementById("route-cancel-btn").addEventListener("click", () => {
      map.remove();
      openPlanForm(session);
    });
  }

  function viewRouteModal(route) {
    openModal(
      `
      <div class="route-toolbar">
        <span class="route-distance">${route.distance} mi</span>
        <button type="button" class="btn" id="route-close-btn">Close</button>
      </div>
      <div id="route-map"></div>
    `,
      { fullscreen: true }
    );

    const map = L.map("route-map");
    tileLayer().addTo(map);
    const polyline = L.polyline(route.points, { color: "#4a6d5c" }).addTo(map);
    map.fitBounds(polyline.getBounds(), { padding: [20, 20] });
    requestAnimationFrame(() => map.invalidateSize());

    document.getElementById("route-close-btn").addEventListener("click", () => {
      map.remove();
      closeModal();
    });
  }

  window.openRouteBuilder = openRouteBuilder;
  window.viewRouteModal = viewRouteModal;
})();
