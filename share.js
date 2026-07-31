// Strava-style "share run" card generator. Wrapped in an IIFE so this file
// introduces zero top-level identifiers shared with the other classic
// <script> tags (see the uid()/Sessions collision fixed earlier).
(function () {
  const W = 1080;
  const H = 1350;

  function accentColor() {
    const v = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim();
    return v || "#4a6d5c";
  }

  function truncateText(ctx, text, maxWidth) {
    if (ctx.measureText(text).width <= maxWidth) return text;
    let t = text;
    while (t.length > 1 && ctx.measureText(t + "…").width > maxWidth) {
      t = t.slice(0, -1);
    }
    return t + "…";
  }

  // Draws the route as a plain white line, normalized to fit inside `box`
  // and centered — a silhouette, not a real map (no tiles needed).
  function drawRouteSilhouette(ctx, points, box) {
    const lats = points.map((p) => p[0]);
    const lngs = points.map((p) => p[1]);
    const minLat = Math.min(...lats), maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
    const latRange = maxLat - minLat || 0.001;
    const lngRange = maxLng - minLng || 0.001;
    const scale = Math.min(box.w / lngRange, box.h / latRange) * 0.85;
    const midLat = (minLat + maxLat) / 2;
    const midLng = (minLng + maxLng) / 2;

    ctx.beginPath();
    points.forEach(([lat, lng], i) => {
      const x = box.x + box.w / 2 + (lng - midLng) * scale;
      const y = box.y + box.h / 2 - (lat - midLat) * scale;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 7;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.stroke();
  }

  function buildShareCanvas(session) {
    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d");

    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, accentColor());
    grad.addColorStop(1, "#1a1a1a");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    const route = session.planned && session.planned.route;
    if (route && route.points && route.points.length > 1) {
      const backLeg = route.backRoute || (route.roundTrip ? route.points.slice().reverse() : []);
      drawRouteSilhouette(ctx, route.points.concat(backLeg), { x: 80, y: 100, w: W - 160, h: 480 });
    }

    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.font = "600 32px -apple-system, system-ui, sans-serif";
    ctx.fillText(session.type.toUpperCase(), 80, 700);

    ctx.fillStyle = "#fff";
    ctx.font = "700 60px -apple-system, system-ui, sans-serif";
    ctx.fillText(truncateText(ctx, session.title, W - 160), 80, 770);

    ctx.fillStyle = "rgba(255,255,255,0.7)";
    ctx.font = "400 32px -apple-system, system-ui, sans-serif";
    ctx.fillText(fmtDate(session.date), 80, 825);

    const a = session.actual || {};
    const stats = [];
    if (a.distance) stats.push(["Distance", `${a.distance} mi`]);
    if (a.duration) stats.push(["Time", formatDuration(a.duration)]);
    if (a.distance && a.duration) stats.push(["Pace", pace(a.distance, a.duration)]);
    if (a.effort) stats.push(["Effort", `${a.effort}/10`]);

    const statY = 950;
    const colW = (W - 160) / Math.max(stats.length, 1);
    stats.forEach(([label, value], i) => {
      const x = 80 + i * colW;
      ctx.fillStyle = "#fff";
      ctx.font = "700 54px -apple-system, system-ui, sans-serif";
      ctx.fillText(value, x, statY);
      ctx.fillStyle = "rgba(255,255,255,0.6)";
      ctx.font = "400 24px -apple-system, system-ui, sans-serif";
      ctx.fillText(label.toUpperCase(), x, statY + 38);
    });

    ctx.fillStyle = "rgba(255,255,255,0.5)";
    ctx.font = "400 24px -apple-system, system-ui, sans-serif";
    ctx.fillText("Run & Workout Planner", 80, H - 60);

    return canvas;
  }

  async function shareRun(session) {
    const canvas = buildShareCanvas(session);
    canvas.toBlob(async (blob) => {
      if (!blob) return;
      const file = new File([blob], `run-${session.date}.png`, { type: "image/png" });

      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({ files: [file], title: session.title });
          return;
        } catch (err) {
          if (err.name === "AbortError") return;
        }
      }

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `run-${session.date}.png`;
      a.click();
      URL.revokeObjectURL(url);
    }, "image/png");
  }

  window.shareRun = shareRun;
})();
