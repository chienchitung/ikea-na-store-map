// 伺服器端代為呼叫 Google Routes API，API key 只存在 Netlify 環境變數 GOOGLE_MAPS_API_KEY，不會出現在網頁原始碼
//
// 1) 交通時間矩陣（清單用）
//    POST { type:"matrix", origin:{lat,lon}, destinations:[{id,lat,lon}], mode }
//    → { results:{ [id]: { seconds, meters } | { error:"NO_ROUTE" } } }
//
// 2) 單一路線（地圖畫線用）
//    POST { type:"route", origin:{lat,lon}, destination:{lat,lon}, mode }
//    → { route: { seconds, meters, polyline, steps:[...] } } 或 { route:null }（查無路線）
//
// mode: "DRIVE" | "TRANSIT" | "WALK"

const MODES = new Set(["DRIVE", "TRANSIT", "WALK"]);
const MAX_DESTINATIONS = 10;
const ALLOWED_HOSTS = ["ikea-na-store-map.netlify.app", "localhost", "127.0.0.1"];

const json = (status, body) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

const isLat = v => typeof v === "number" && v >= -90 && v <= 90;
const isLon = v => typeof v === "number" && v >= -180 && v <= 180;
const isPoint = p => p && isLat(p.lat) && isLon(p.lon);
const toWaypoint = p => ({ location: { latLng: { latitude: p.lat, longitude: p.lon } } });
const toSeconds = d => (d ? parseInt(d, 10) : null);

function isAllowedOrigin(req) {
  const source = req.headers.get("origin") || req.headers.get("referer");
  if (!source) return false;
  try {
    const host = new URL(source).hostname;
    // 也允許 Netlify 的預覽部署網址（deploy-preview-xx--ikea-na-store-map.netlify.app）
    return ALLOWED_HOSTS.includes(host) || host.endsWith("--ikea-na-store-map.netlify.app");
  } catch {
    return false;
  }
}

async function callGoogle(url, key, fieldMask, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": key,
      "X-Goog-FieldMask": fieldMask,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    console.error("Routes API error", res.status, text);
    // 只回傳 Google 的錯誤代碼與訊息（不含 key），方便從瀏覽器端排查
    // computeRoutes 的錯誤是 {error:{...}}，computeRouteMatrix 是 [{error:{...}}]
    let message = "";
    try {
      const parsed = JSON.parse(text);
      const err = Array.isArray(parsed) ? parsed[0]?.error : parsed.error;
      message = [err?.status, err?.message].filter(Boolean).join(": ");
    } catch {}
    if (!message) message = text;
    return { __error: { status: res.status, message: message.slice(0, 300) } };
  }
  return res.json();
}

const upstreamError = data => json(502, { error: "UPSTREAM_ERROR", detail: data.__error });

async function handleMatrix(key, { origin, destinations, mode }) {
  if (!Array.isArray(destinations) || destinations.length === 0 || destinations.length > MAX_DESTINATIONS) {
    return json(400, { error: "BAD_DESTINATIONS" });
  }
  if (!destinations.every(d => d && typeof d.id === "string" && isPoint(d))) {
    return json(400, { error: "BAD_DESTINATIONS" });
  }

  const request = {
    origins: [{ waypoint: toWaypoint(origin) }],
    destinations: destinations.map(d => ({ waypoint: toWaypoint(d) })),
    travelMode: mode,
  };
  // 開車不考慮即時路況，使用較基本（較便宜）的計費等級
  if (mode === "DRIVE") request.routingPreference = "TRAFFIC_UNAWARE";

  const elements = await callGoogle(
    "https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix",
    key,
    "originIndex,destinationIndex,duration,distanceMeters,condition",
    request
  );
  if (elements.__error) return upstreamError(elements);

  const results = {};
  for (const el of Array.isArray(elements) ? elements : []) {
    const dest = destinations[el.destinationIndex];
    if (!dest) continue;
    results[dest.id] = el.condition === "ROUTE_EXISTS" && el.duration
      ? { seconds: toSeconds(el.duration), meters: el.distanceMeters ?? null }
      : { error: "NO_ROUTE" };
  }
  return json(200, { results });
}

async function handleRoute(key, { origin, destination, mode, lang }) {
  if (!isPoint(destination)) return json(400, { error: "BAD_DESTINATION" });

  const request = {
    origin: toWaypoint(origin),
    destination: toWaypoint(destination),
    travelMode: mode,
    languageCode: lang === "en" ? "en" : "zh-TW",
    computeAlternativeRoutes: false,
  };
  if (mode === "DRIVE") request.routingPreference = "TRAFFIC_UNAWARE";

  const base = ["routes.duration", "routes.distanceMeters", "routes.polyline.encodedPolyline"];
  // 只有大眾運輸需要分段資料（步行段／搭乘段、路線名稱與顏色、上下車站）
  const transitFields = [
    "routes.legs.steps.travelMode",
    "routes.legs.steps.staticDuration",
    "routes.legs.steps.distanceMeters",
    "routes.legs.steps.polyline.encodedPolyline",
    "routes.legs.steps.transitDetails.transitLine.name",
    "routes.legs.steps.transitDetails.transitLine.nameShort",
    "routes.legs.steps.transitDetails.transitLine.color",
    "routes.legs.steps.transitDetails.transitLine.textColor",
    "routes.legs.steps.transitDetails.transitLine.vehicle.type",
    "routes.legs.steps.transitDetails.stopDetails.departureStop.name",
    "routes.legs.steps.transitDetails.stopDetails.arrivalStop.name",
    "routes.legs.steps.transitDetails.stopCount",
  ];
  const fieldMask = (mode === "TRANSIT" ? base.concat(transitFields) : base).join(",");

  const data = await callGoogle("https://routes.googleapis.com/directions/v2:computeRoutes", key, fieldMask, request);
  if (data.__error) return upstreamError(data);

  const r = data.routes && data.routes[0];
  if (!r || !r.polyline) return json(200, { route: null });

  // 把連續的步行小段合併成一段，畫面上較清楚
  const steps = [];
  if (mode === "TRANSIT") {
    for (const s of (r.legs || []).flatMap(l => l.steps || [])) {
      const td = s.transitDetails;
      const step = {
        mode: s.travelMode || "WALK",
        seconds: toSeconds(s.staticDuration),
        meters: s.distanceMeters ?? null,
        polyline: s.polyline?.encodedPolyline || null,
      };
      if (td) {
        const line = td.transitLine || {};
        step.line = {
          name: line.nameShort || line.name || "",
          full: line.name || "",
          color: line.color || null,
          textColor: line.textColor || null,
          vehicle: line.vehicle?.type || null,
        };
        step.from = td.stopDetails?.departureStop?.name || "";
        step.to = td.stopDetails?.arrivalStop?.name || "";
        step.stops = td.stopCount ?? null;
      }
      const prev = steps[steps.length - 1];
      if (!td && prev && !prev.line) {
        prev.seconds = (prev.seconds || 0) + (step.seconds || 0);
        prev.meters = (prev.meters || 0) + (step.meters || 0);
        prev.polylines.push(step.polyline);
      } else {
        step.polylines = [step.polyline];
        delete step.polyline;
        steps.push(step);
      }
    }
  }

  return json(200, {
    route: {
      seconds: toSeconds(r.duration),
      meters: r.distanceMeters ?? null,
      polyline: r.polyline.encodedPolyline,
      steps,
    },
  });
}

export default async (req) => {
  if (req.method !== "POST") return json(405, { error: "METHOD_NOT_ALLOWED" });
  if (!isAllowedOrigin(req)) return json(403, { error: "FORBIDDEN" });

  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) return json(500, { error: "MISSING_API_KEY" });

  let body;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "BAD_JSON" });
  }
  if (!body || !MODES.has(body.mode)) return json(400, { error: "BAD_MODE" });
  if (!isPoint(body.origin)) return json(400, { error: "BAD_ORIGIN" });

  try {
    if (body.type === "route") return await handleRoute(key, body);
    return await handleMatrix(key, body);
  } catch (e) {
    console.error(e);
    return json(502, { error: "UPSTREAM_UNREACHABLE" });
  }
};
