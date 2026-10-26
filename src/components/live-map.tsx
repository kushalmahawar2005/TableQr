"use client";
import "maplibre-gl/dist/maplibre-gl.css";
import type { Map as MlMap, Marker } from "maplibre-gl";
import { useEffect, useRef, useState, type ReactNode } from "react";

// A small street map for deliveries: the rider, the customer's door and the restaurant.
// OpenFreeMap tiles need no key and cost nothing. MapLibre loads only when a map is shown.

export type MapPoint = { id: string; lat: number; lng: number; kind: "rider" | "home" | "shop"; label?: string; photoUrl?: string | null };

const STYLE = "https://tiles.openfreemap.org/styles/bright";
const INDIA = { lng: 78.9629, lat: 22.5937 };

function markerEl(p: MapPoint) {
  const el = document.createElement("div");
  el.setAttribute("aria-label", p.label ?? p.kind);
  if (p.kind === "rider") {
    // A pulsing ring under the rider, like a live dot
    el.className = "relative grid size-12 place-items-center";
    const ring = document.createElement("span");
    ring.className = "absolute inset-0 animate-ping rounded-full bg-[#c9482b]/35";
    const face = document.createElement("span");
    face.className = "relative grid size-11 place-items-center overflow-hidden rounded-full border-[3px] border-white bg-[#c9482b] text-xl shadow-[0_6px_16px_rgb(0_0_0/0.35)]";
    if (p.photoUrl) {
      const img = document.createElement("img");
      img.src = p.photoUrl;
      img.alt = "";
      img.className = "size-full object-cover";
      face.appendChild(img);
    } else face.textContent = "🛵";
    el.append(ring, face);
  } else {
    // A map pin: a rounded drop with the icon inside, pointing at the spot
    el.className = "relative size-10";
    const pin = document.createElement("span");
    pin.className = `absolute left-1/2 top-0 grid size-9 -translate-x-1/2 -rotate-45 place-items-center rounded-[50%_50%_50%_0] border-[3px] border-white shadow-[0_6px_14px_rgb(0_0_0/0.3)] ${p.kind === "home" ? "bg-[#1f7a4d]" : "bg-[#1f2937]"}`;
    const icon = document.createElement("span");
    icon.className = "rotate-45 text-base";
    icon.textContent = p.kind === "home" ? "🏠" : "🍽️";
    pin.appendChild(icon);
    el.appendChild(pin);
  }
  return el;
}

/** Slides a marker to its new spot instead of jumping */
function glide(mk: Marker, to: [number, number]) {
  const from = mk.getLngLat();
  if (Math.abs(from.lng - to[0]) < 1e-7 && Math.abs(from.lat - to[1]) < 1e-7) return;
  const start = performance.now();
  const step = (now: number) => {
    const k = Math.min(1, (now - start) / 900);
    const e = 1 - (1 - k) * (1 - k);
    mk.setLngLat([from.lng + (to[0] - from.lng) * e, from.lat + (to[1] - from.lat) * e]);
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

export function LiveMap({ points, className = "h-56", onHomeMove, route = false, overlay }: {
  points: MapPoint[];
  className?: string;
  /** Draw the way from the rider to the home pin */
  route?: boolean;
  /** Shown over the map's top left corner, e.g. the minutes left */
  overlay?: ReactNode;
  /** When given, the home pin can be dragged and a tap on the map moves it */
  onHomeMove?: (p: { lat: number; lng: number }) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<MlMap | null>(null);
  const markers = useRef(new Map<string, Marker>());
  const fittedFor = useRef("");
  const moveRef = useRef(onHomeMove);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => { moveRef.current = onHomeMove; }, [onHomeMove]);

  useEffect(() => {
    let cancelled = false;
    void import("maplibre-gl").then((ml) => {
      if (cancelled || !box.current) return;
      const m = new ml.Map({ container: box.current, style: STYLE, center: INDIA, zoom: 4, attributionControl: { compact: true } });
      m.addControl(new ml.NavigationControl({ showCompass: false }), "top-right");
      m.on("click", (e) => moveRef.current?.({ lat: e.lngLat.lat, lng: e.lngLat.lng }));
      m.on("load", () => {
        if (cancelled) return;
        // Credits stay one tap away (the "i"), not open over a small map
        box.current?.querySelector(".maplibregl-ctrl-attrib")?.classList.remove("maplibregl-compact-show");
        setReady(true);
      });
      m.on("error", (e) => { console.error("[map]", e.error?.message ?? e); if (!m.loaded()) setFailed(true); });
      map.current = m;
    }, () => setFailed(true));
    const all = markers.current;
    return () => { cancelled = true; all.clear(); map.current?.remove(); map.current = null; };
  }, []);

  useEffect(() => {
    const m = map.current;
    if (!ready || !m) return;
    void import("maplibre-gl").then((ml) => {
      const seen = new Set<string>();
      for (const p of points) {
        seen.add(p.id);
        let mk = markers.current.get(p.id);
        if (!mk) {
          mk = new ml.Marker({ element: markerEl(p), draggable: p.kind === "home" && !!moveRef.current }).setLngLat([p.lng, p.lat]).addTo(m);
          if (p.kind === "home") mk.on("dragend", () => { const at = mk!.getLngLat(); moveRef.current?.({ lat: at.lat, lng: at.lng }); });
          markers.current.set(p.id, mk);
        } else glide(mk, [p.lng, p.lat]);
      }
      for (const [id, mk] of markers.current) if (!seen.has(id)) { mk.remove(); markers.current.delete(id); }
      // The way from the rider to the door, as a dashed line under the pins
      const rider = points.find((p) => p.kind === "rider"), home = points.find((p) => p.kind === "home");
      const line = { type: "Feature" as const, properties: {}, geometry: { type: "LineString" as const, coordinates: route && rider && home ? [[rider.lng, rider.lat], [home.lng, home.lat]] : [] } };
      const src = m.getSource("route") as { setData?: (d: unknown) => void } | undefined;
      if (src?.setData) src.setData(line);
      else if (route) {
        m.addSource("route", { type: "geojson", data: line });
        m.addLayer({ id: "route-casing", type: "line", source: "route", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#ffffff", "line-width": 7 } });
        m.addLayer({ id: "route", type: "line", source: "route", layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#c9482b", "line-width": 4, "line-dasharray": [1.2, 1.4] } });
      }
      // Frame everything once per set of points, so a moving rider does not keep resetting the view
      const key = points.map((p) => p.id).sort().join(",");
      if (key && key !== fittedFor.current) {
        fittedFor.current = key;
        if (points.length === 1) m.jumpTo({ center: [points[0].lng, points[0].lat], zoom: 15 });
        else {
          const b = new ml.LngLatBounds();
          points.forEach((p) => b.extend([p.lng, p.lat]));
          m.fitBounds(b, { padding: 64, maxZoom: 15, duration: 0 });
        }
      }
    });
  }, [points, ready, route]);

  return (
    <div className={`relative overflow-hidden rounded-2xl border border-line bg-paper ${className}`}>
      <div ref={box} className="h-full w-full" />
      {overlay && !failed && <div className="pointer-events-none absolute top-3 left-3 rounded-2xl bg-surface/95 px-3 py-2 shadow-[0_6px_18px_rgb(0_0_0/0.18)] backdrop-blur">{overlay}</div>}
      {failed && <p className="absolute inset-0 grid place-items-center p-4 text-center text-caption text-muted">The map could not load. Check your connection.</p>}
    </div>
  );
}
