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

  // Detects an out-and-back spur: two points far apart in the path sequence
  // but very close in space, meaning the route walked out to a dead end
  // (often where a synthetic waypoint snapped to an unconnected side street)
  // and doubled back the same way to continue.
  function hasSpur(points) {
    const THRESH_MILES = 0.02;
    for (let i = 0; i < points.length; i++) {
      for (let j = i + 6; j < points.length; j++) {
        if (haversineMiles(points[i][0], points[i][1], points[j][0], points[j][1]) < THRESH_MILES) {
          return true;
        }
      }
    }
    return false;
  }

  // Fraction of a candidate return route that runs right on top of the
  // outbound path (within ~50m — "the same street"), sampling every 3rd
  // point on each side to keep this cheap.
  function outboundOverlapFraction(candidatePoints, outboundPoints) {
    const THRESH_MILES = 0.03;
    const sample = (arr) => arr.filter((_, i) => i % 3 === 0);
    const candidateSample = sample(candidatePoints);
    const outboundSample = sample(outboundPoints);
    if (!candidateSample.length) return 0;
    let matches = 0;
    candidateSample.forEach((p) => {
      if (outboundSample.some((o) => haversineMiles(p[0], p[1], o[0], o[1]) < THRESH_MILES)) matches++;
    });
    return matches / candidateSample.length;
  }

  function bearingBetween(lat1, lng1, lat2, lng2) {
    const toRad = (d) => (d * Math.PI) / 180;
    const toDeg = (r) => (r * 180) / Math.PI;
    const y = Math.sin(toRad(lng2 - lng1)) * Math.cos(toRad(lat2));
    const x =
      Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
      Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(toRad(lng2 - lng1));
    return (toDeg(Math.atan2(y, x)) + 360) % 360;
  }

  // Like fetchOneWayRoute, but forces the path onto different streets by
  // routing through a waypoint offset to one side of the direct line back —
  // asking OSRM for "alternatives" instead was unreliable (its public foot
  // profile rarely offers a genuinely different one). Tries several
  // randomized waypoints (side, position along the line, and swing distance
  // all vary) and keeps whichever resulting route overlaps the outbound path
  // least, as long as it's under maxMiles and spur-free — this deliberately
  // never falls back to the plain direct route, since that's exactly the
  // "same street straight back" result we're trying to avoid.
  async function fetchDistinctReturnRoute(outboundPoints, maxMiles, maxAttempts = 5) {
    const startLatLng = outboundPoints[outboundPoints.length - 1];
    const endLatLng = outboundPoints[0];
    const directDistance = haversineMiles(startLatLng[0], startLatLng[1], endLatLng[0], endLatLng[1]);
    const bearing = bearingBetween(startLatLng[0], startLatLng[1], endLatLng[0], endLatLng[1]);

    let best = null;
    let bestOverlap = Infinity;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const side = Math.random() < 0.5 ? 90 : -90;
      const t = 0.3 + Math.random() * 0.4;
      const baseLat = startLatLng[0] + (endLatLng[0] - startLatLng[0]) * t;
      const baseLng = startLatLng[1] + (endLatLng[1] - startLatLng[1]) * t;
      const offsetMiles = Math.max(0.1, directDistance * 0.25) * (0.5 + Math.random());
      const via = destinationPoint(baseLat, baseLng, bearing + side, offsetMiles);

      const coords = `${startLatLng[1]},${startLatLng[0]};${via[1]},${via[0]};${endLatLng[1]},${endLatLng[0]}`;
      const url = `https://router.project-osrm.org/route/v1/foot/${coords}?overview=full&geometries=geojson`;
      let points, distance;
      try {
        const res = await fetch(url);
        const data = await res.json();
        if (!res.ok || data.code !== "Ok" || !data.routes || !data.routes.length) continue;
        const route = data.routes[0];
        points = route.geometry.coordinates.map(([lng, lat]) => [lat, lng]);
        distance = route.distance / 1609.34;
      } catch {
        continue;
      }

      if (distance > maxMiles || hasSpur(points)) continue;

      const overlap = outboundOverlapFraction(points, outboundPoints);
      if (overlap < bestOverlap) {
        best = { points, distance };
        bestOverlap = overlap;
      }
      if (overlap < 0.15) break; // good enough — stop early
    }

    if (!best) throw new Error("Couldn't find a different route back — try again.");
    return best;
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

  function locationDotIcon(size = 16) {
    return L.divIcon({
      className: "user-location-marker",
      html: '<span class="pulse"></span><span class="dot"></span>',
      iconSize: [size, size],
      iconAnchor: [size / 2, size / 2],
    });
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
        <button type="button" class="btn" id="route-locate-btn" title="Center on my current location">📍</button>
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

    // Leaflet renders markers (markerPane, z-index 600) above vector layers
    // (overlayPane, z-index 400) regardless of add order — so without this,
    // the location dot always covers the drawn route wherever they overlap.
    map.createPane("routePane");
    map.getPane("routePane").style.zIndex = 650;

    map.on("moveend", () => {
      const c = map.getCenter();
      saveLastMapView([c.lat, c.lng], map.getZoom());
    });

    function setStatus(text) {
      const el = document.getElementById("route-status");
      if (el) el.textContent = text;
    }

    let points = existingRoute ? existingRoute.points.slice() : [];
    let roundTrip = existingRoute ? !!existingRoute.roundTrip : false;
    let randomBack = existingRoute && existingRoute.backRoute && existingRoute.backRoute.length
      ? { points: existingRoute.backRoute.slice(), distance: totalDistance(existingRoute.backRoute) }
      : null;
    const polyline = L.polyline(points, { color: "#4a6d5c", pane: "routePane" }).addTo(map);
    const returnPolyline = L.polyline([], { color: "#e0862f", weight: 5, dashArray: "10 10", lineCap: "butt", pane: "routePane" }).addTo(map);
    const markers = L.layerGroup().addTo(map);

    // Guards against the background auto-locate chain (GPS → IP, both real
    // network calls of unpredictable latency) clobbering the map after the
    // user has already searched or started drawing their own route.
    let userOverride = false;

    let locationMarker = null;
    function setLocationDot(latlng) {
      if (locationMarker) locationMarker.setLatLng(latlng);
      else locationMarker = L.marker(latlng, { icon: locationDotIcon(), interactive: false, zIndexOffset: 1000 }).addTo(map);
      syncLocationDotSize();
      return latlng;
    }

    // Grows the dot when the route's first point sits on top of it (snapped
    // in the map click handler below) so it still peeks out from behind the
    // route point drawn over it on the higher routePane.
    function syncLocationDotSize() {
      if (!locationMarker) return;
      const loc = locationMarker.getLatLng();
      const snapped = points.length > 0 && haversineMiles(points[0][0], points[0][1], loc.lat, loc.lng) < 0.005;
      locationMarker.setIcon(locationDotIcon(snapped ? 24 : 16));
    }

    // Tries real GPS first, falls back to IP-based approximate location.
    // Always drops/updates the location dot; resolves with the found
    // [lat,lng] and a zoom level appropriate to how precise it is.
    function locateAndMark() {
      return tryGeolocation()
        .then((latlng) => ({ latlng: setLocationDot(latlng), zoom: 16 }))
        .catch(() => locateApprox().then((latlng) => ({ latlng: setLocationDot(latlng), zoom: 14 })));
    }

    function redraw() {
      polyline.setLatLngs(points);
      if (randomBack) returnPolyline.setLatLngs(randomBack.points);
      else returnPolyline.setLatLngs(roundTrip ? points.slice().reverse() : []);
      markers.clearLayers();
      points.forEach((p) => L.circleMarker(p, { radius: 5, color: "#4a6d5c", fillOpacity: 1, pane: "routePane" }).addTo(markers));
      syncLocationDotSize();
    }
    redraw();

    if (existingRoute && points.length) {
      userOverride = true;
      map.fitBounds(polyline.getBounds(), { padding: [20, 20] });
      setStatus("");
      locateAndMark().catch(() => {});
    } else {
      locateAndMark()
        .then(({ latlng, zoom }) => {
          if (userOverride) return;
          map.setView(latlng, zoom);
          setStatus("");
        })
        .catch(() => {
          if (userOverride) return;
          setStatus("Couldn't find your location — search an address or pan/zoom.");
        });
    }

    document.getElementById("route-locate-btn").addEventListener("click", () => {
      setStatus("Finding your location…");
      locateAndMark()
        .then(({ latlng, zoom }) => {
          userOverride = true;
          map.setView(latlng, zoom);
          setStatus("");
        })
        .catch(() => setStatus("Couldn't find your location — search an address or pan/zoom."));
    });

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
      const oneWay = totalDistance(points);
      const backDist = randomBack ? randomBack.distance : roundTrip ? oneWay : 0;
      const dist = oneWay + backDist;
      let distLabel = `${dist.toFixed(2)} mi`;
      if (randomBack) distLabel = `${dist.toFixed(2)} mi (${oneWay.toFixed(2)} out + ${randomBack.distance.toFixed(2)} back)`;
      else if (roundTrip) distLabel = `${dist.toFixed(2)} mi round trip (${oneWay.toFixed(2)} mi out)`;
      footer.innerHTML = `
        <div class="route-distance">${points.length ? distLabel : "Tap the map to add points"}</div>
        <div class="route-actions">
          <button type="button" class="btn ${roundTrip ? "primary" : ""}" id="round-trip-btn" ${points.length < 2 ? "disabled" : ""}>🔁 Round Trip</button>
          <button type="button" class="btn ${randomBack ? "primary" : ""}" id="random-back-btn" ${points.length < 2 ? "disabled" : ""}>🎲 ${randomBack ? "Reroll Route Back" : "Random Route Back"}</button>
          <button type="button" class="btn" id="undo-btn" ${points.length === 0 ? "disabled" : ""}>Undo</button>
          <button type="button" class="btn danger" id="clear-btn" ${points.length === 0 ? "disabled" : ""}>Clear</button>
          <button type="button" class="btn primary" id="confirm-btn" ${points.length < 2 ? "disabled" : ""}>Use This Route</button>
        </div>
      `;
      document.getElementById("round-trip-btn").addEventListener("click", () => {
        roundTrip = !roundTrip;
        randomBack = null;
        redraw();
        renderFooter();
      });
      document.getElementById("random-back-btn").addEventListener("click", async () => {
        setStatus(randomBack ? "Finding another route back…" : "Finding a different route back…");
        try {
          const route = await fetchDistinctReturnRoute(points, oneWay + 4);
          roundTrip = false;
          randomBack = route;
          setStatus("");
        } catch (err) {
          setStatus(err.message || "Couldn't find a route back — try again.");
        }
        redraw();
        renderFooter();
      });
      document.getElementById("undo-btn").addEventListener("click", () => {
        points.pop();
        randomBack = null;
        redraw();
        renderFooter();
      });
      document.getElementById("clear-btn").addEventListener("click", () => {
        points = [];
        randomBack = null;
        redraw();
        renderFooter();
      });
      document.getElementById("confirm-btn").addEventListener("click", () => {
        const routeData = {
          mode: "draw",
          points: points.slice(),
          roundTrip,
          backRoute: randomBack ? randomBack.points.slice() : null,
          distance: Math.round(dist * 100) / 100,
        };
        map.remove();
        onConfirm(routeData);
      });
    }
    renderFooter();

    map.on("click", (e) => {
      userOverride = true;
      let latlng = [e.latlng.lat, e.latlng.lng];
      if (points.length === 0 && locationMarker) {
        const loc = locationMarker.getLatLng();
        const clickPx = map.latLngToContainerPoint(e.latlng);
        const locPx = map.latLngToContainerPoint(loc);
        if (clickPx.distanceTo(locPx) < 20) latlng = [loc.lat, loc.lng];
      }
      points.push(latlng);
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
      <h2>Random Route</h2>
      <form id="random-route-form">
        <label>How Many Miles?
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
          <button type="button" class="btn primary" id="confirm-random-btn" disabled>Use This Route</button>
        </div>
      </div>
    `,
      { fullscreen: true }
    );

    const map = L.map("route-map").setView([39.8283, -98.5795], 4);
    tileLayer().addTo(map);
    requestAnimationFrame(() => map.invalidateSize());
    map.createPane("routePane");
    map.getPane("routePane").style.zIndex = 650;

    function setStatus(text) {
      const el = document.getElementById("route-status");
      if (el) el.textContent = text;
    }

    let startLatLng = null;
    let currentRoute = null;
    const polyline = L.polyline([], { color: "#4a6d5c", pane: "routePane" }).addTo(map);

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
        L.marker(startLatLng, { icon: locationDotIcon(), interactive: false, zIndexOffset: 1000 }).addTo(map);
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
    const bounds = polyline.getBounds();
    if (route.backRoute && route.backRoute.length) {
      const backPolyline = L.polyline(route.backRoute, { color: "#e0862f", weight: 5, dashArray: "10 10", lineCap: "butt" }).addTo(map);
      bounds.extend(backPolyline.getBounds());
    } else if (route.roundTrip) {
      L.polyline(route.points.slice().reverse(), { color: "#e0862f", weight: 5, dashArray: "10 10", lineCap: "butt" }).addTo(map);
    }
    map.fitBounds(bounds, { padding: [20, 20] });
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
