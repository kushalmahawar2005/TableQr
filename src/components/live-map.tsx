"use client";
import "maplibre-gl/dist/maplibre-gl.css";
import type { Map as MlMap, Marker } from "maplibre-gl";
import { useEffect, useRef, useState } from "react";

// A small street map for deliveries: the rider, the customer's door and the restaurant.
// OpenFreeMap tiles need no key and cost nothing. MapLibre loads only when a map is shown.

export type MapPoint = { id: string; lat: number; lng: number; kind: "rider" | "home" | "shop"; label?: string; photoUrl?: string | null };

const STYLE = "https://tiles.openfreemap.org/styles/liberty";
const INDIA = { lng: 78.9629, lat: 22.5937 };

function markerEl(p: MapPoint) {
  const el = document.createElement("div");
  el.setAttribute("aria-label", p.label ?? p.kind);
  if (p.kind === "rider") {
    el.className = "grid size-11 place-items-center overflow-hidden rounded-full border-[3px] border-white bg-[#c9482b] text-xl shadow-lg";
    if (p.photoUrl) {
      const img = document.createElement("img");
      img.src = p.photoUrl;
      img.alt = "";
      img.className = "size-full object-cover";
      el.appendChild(img);
    } else el.textContent = "🛵";
  } else {
    el.className = `grid size-9 place-items-center rounded-full border-[3px] border-white text-base shadow-lg ${p.kind === "home" ? "bg-[#1f7a4d]" : "bg-[#1f2937]"}`;
    el.textContent = p.kind === "home" ? "🏠" : "🍽️";
  }
  return el;
}

export function LiveMap({ points, className = "h-56", onHomeMove }: {
  points: MapPoint[];
  className?: string;
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
        } else mk.setLngLat([p.lng, p.lat]);
      }
      for (const [id, mk] of markers.current) if (!seen.has(id)) { mk.remove(); markers.current.delete(id); }
      // Frame everything once per set of points, so a moving rider does not keep resetting the view
      const key = points.map((p) => p.id).sort().join(",");
      if (key && key !== fittedFor.current) {
        fittedFor.current = key;
        if (points.length === 1) m.jumpTo({ center: [points[0].lng, points[0].lat], zoom: 15 });
        else {
          const b = new ml.LngLatBounds();
          points.forEach((p) => b.extend([p.lng, p.lat]));
          m.fitBounds(b, { padding: 48, maxZoom: 16, duration: 0 });
        }
      }
    });
  }, [points, ready]);

  return (
    <div className={`relative overflow-hidden rounded-2xl border border-line bg-paper ${className}`}>
      <div ref={box} className="h-full w-full" />
      {failed && <p className="absolute inset-0 grid place-items-center p-4 text-center text-caption text-muted">The map could not load. Check your connection.</p>}
    </div>
  );
}
