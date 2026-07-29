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

  // Great-circle "destination point" formula: given a start point, a compass
  // bearing, and a distance, returns the [lat,lng] that far away in that
  // direction. Used to pick a random target for the one-way route generator.
  function destinationPoint(lat, lng, bearingDeg, distanceMiles) {
    const R = 3958.8;
    const delta = distanceMiles / R;
    const theta = (bearingDeg * Math.PI) / 180;
    const phi1 = (lat * Math.PI) / 180;
    const lambda1 = (lng * Math.PI) / 180;
    const phi2 = Math.asin(Math.sin(phi1) * Math.cos(delta) + Math.cos(phi1) * Math.sin(delta) * Math.cos(theta));
    const lambda2 =
      lambda1 + Math.atan2(Math.sin(theta) * Math.sin(delta) * Math.cos(phi1), Math.cos(delta) - Math.sin(phi1) * Math.sin(phi2));
    return [(phi2 * 180) / Math.PI, (((lambda2 * 180) / Math.PI + 540) % 360) - 180];
  }

  // Free, no-signup routing along real streets/paths (OSRM's public demo
  // server). Used to turn a random compass direction into an actual walkable
  // one-way route rather than a straight line through buildings/water.
  async function fetchOneWayRoute(startLatLng, endLatLng) {
    const url = `https://router.project-osrm.org/route/v1/foot/${startLatLng[1]},${startLatLng[0]};${endLatLng[1]},${endLatLng[0]}?overview=full&geometries=geojson`;
    const res = await fetch(url);
    const data = await res.json();
    if (!res.ok || data.code !== "Ok" || !data.routes || !data.routes.length) {
      throw new Error("No route found that way — try again.");
    }
    const route = data.routes[0];
    const points = route.geometry.coordinates.map(([lng, lat]) => [lat, lng]);
    const distance = route.distance / 1609.34;
    return { points, distance };
  }

  async function generateRandomOneWayRoute(startLatLng, targetMiles, attempt = 0) {
    const bearing = Math.random() * 360;
    const dest = destinationPoint(startLatLng[0], startLatLng[1], bearing, targetMiles);
    try {
      return await fetchOneWayRoute(startLatLng, dest);
    } catch (err) {
      if (attempt < 3) return generateRandomOneWayRoute(startLatLng, targetMiles, attempt + 1);
      throw err;
    }
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

  function openRandomRouteBuilder(session, onConfirm) {
    const defaultMiles = (session.planned && session.planned.distance) || 3;
    openModal(`
      <h2>Random route</h2>
      <form id="random-route-form">
        <label>How many miles?
          <input name="miles" type="number" step="0.1" min="0.1" value="${defaultMiles}" required>
        </label>
        <div class="form-actions">
          <button type="button" class="btn" id="cancel-btn">Cancel</button>
          <button type="submit" class="btn primary">Generate</button>
        </div>
      </form>
    `);
    document.getElementById("cancel-btn").addEventListener("click", () => openPlanForm(session));
    document.getElementById("random-route-form").addEventListener("submit", (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const miles = parseFloat(fd.get("miles")) || 3;
      runRandomRouteMap(session, miles, onConfirm);
    });
  }

  function runRandomRouteMap(session, targetMiles, onConfirm) {
    openModal(
      `
      <div class="route-toolbar">
        <span class="route-status" id="route-status">Finding your location…</span>
        <button type="button" class="btn" id="route-cancel-btn">Cancel</button>
      </div>
      <div id="route-map"></div>
      <div class="route-footer" id="route-footer">
        <div class="route-distance" id="route-distance"></div>
        <div class="route-actions">
          <button type="button" class="btn" id="reroll-btn" disabled>Reroll</button>
          <button type="button" class="btn primary" id="confirm-random-btn" disabled>Use this route</button>
        </div>
      </div>
    `,
      { fullscreen: true }
    );

    const map = L.map("route-map").setView([39.8283, -98.5795], 4);
    tileLayer().addTo(map);
    requestAnimationFrame(() => map.invalidateSize());

    function setStatus(text) {
      const el = document.getElementById("route-status");
      if (el) el.textContent = text;
    }

    let startLatLng = null;
    let currentRoute = null;
    const polyline = L.polyline([], { color: "#4a6d5c" }).addTo(map);

    async function generate() {
      document.getElementById("reroll-btn").disabled = true;
      document.getElementById("confirm-random-btn").disabled = true;
      document.getElementById("route-distance").textContent = "";
      setStatus(`Generating a ${targetMiles} mi route…`);
      try {
        const route = await generateRandomOneWayRoute(startLatLng, targetMiles);
        currentRoute = route;
        polyline.setLatLngs(route.points);
        map.fitBounds(polyline.getBounds(), { padding: [20, 20] });
        setStatus("");
        document.getElementById("route-distance").textContent = `Target ${targetMiles} mi → ${route.distance.toFixed(2)} mi`;
      } catch (err) {
        currentRoute = null;
        setStatus(err.message || "Couldn't generate a route — try again.");
      }
      document.getElementById("reroll-btn").disabled = false;
      document.getElementById("confirm-random-btn").disabled = !currentRoute;
    }

    document.getElementById("reroll-btn").addEventListener("click", generate);
    document.getElementById("confirm-random-btn").addEventListener("click", () => {
      if (!currentRoute) return;
      const routeData = {
        mode: "random",
        points: currentRoute.points,
        distance: Math.round(currentRoute.distance * 100) / 100,
      };
      map.remove();
      onConfirm(routeData);
    });

    document.getElementById("route-cancel-btn").addEventListener("click", () => {
      map.remove();
      openPlanForm(session);
    });

    tryGeolocation()
      .catch(() => locateApprox())
      .then(([lat, lng]) => {
        startLatLng = [lat, lng];
        L.marker(startLatLng).addTo(map);
        map.setView(startLatLng, 14);
        return generate();
      })
      .catch(() => {
        setStatus("Couldn't find your location — can't generate a route.");
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
  window.openRandomRouteBuilder = openRandomRouteBuilder;
  window.viewRouteModal = viewRouteModal;
})();
