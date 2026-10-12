"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import type { GeoJSONSource, Map as MlMap, Marker } from "maplibre-gl";
import { useEffect, useRef, useState } from "react";
import { CATEGORY_COLORS, UNKNOWN_CATEGORY_COLOR } from "@/lib/palette";

export type MapPharmacy = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  category: string | null;
  sectorColor: string | null;
  due: string;
};

export type MapStop = { id: string; label: string; lat: number; lng: number; order: number; time: string; pharmacyId: string | null };
export type MapPlace = { id: string; name: string; kind: string; lat: number; lng: number };

const PLACE_ICON: Record<string, string> = { hotel: "H", restaurant: "R", pool: "P", other: "•" };

const TILES = process.env.NEXT_PUBLIC_MAP_RASTER_TILES;
const ATTRIBUTION = process.env.NEXT_PUBLIC_MAP_ATTRIBUTION ?? "";

/**
 * Carte MapLibre : pharmacies (cercles colorés par catégorie), arrêts numérotés de
 * la tournée, tracé (routier si fourni, sinon segments droits signalés comme
 * indicatifs) et lieux favoris. La sélection est synchronisée avec la liste.
 */
export function LeaMap({
  pharmacies,
  stops = [],
  line = null,
  lineIsEstimate = true,
  places = [],
  home = null,
  selectedId,
  onSelect,
  className,
}: {
  pharmacies: MapPharmacy[];
  stops?: MapStop[];
  line?: [number, number][] | null;
  lineIsEstimate?: boolean;
  places?: MapPlace[];
  home?: { lat: number; lng: number } | null;
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  className?: string;
}) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const markersRef = useRef<Marker[]>([]);
  const onSelectRef = useRef(onSelect);
  const [ready, setReady] = useState(false);
  const [tileError, setTileError] = useState(false);

  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  // Création de la carte
  useEffect(() => {
    let cancelled = false;
    let map: MlMap | null = null;
    (async () => {
      const maplibre = await import("maplibre-gl");
      if (cancelled || !container.current) return;
      // Worker servi depuis public/vendor (copié à l'installation, voir scripts/copy-maplibre-worker.mjs)
      maplibre.setWorkerUrl(`/vendor/maplibre-gl-worker-${maplibre.getVersion()}.mjs`);
      const created = new maplibre.Map({
        container: container.current,
        style: {
          version: 8,
          sources: TILES
            ? { base: { type: "raster", tiles: [TILES], tileSize: 256, attribution: ATTRIBUTION, maxzoom: 19 } }
            : {},
          layers: [
            { id: "background", type: "background", paint: { "background-color": "#e9e4dc" } },
            ...(TILES ? [{ id: "base", type: "raster" as const, source: "base" }] : []),
          ],
        },
        center: [-1.0, 48.8],
        zoom: 7,
        attributionControl: { compact: true },
      });
      map = created;
      created.addControl(new maplibre.NavigationControl({ showCompass: false }), "top-right");
      created.on("error", (e) => {
        if ((e as { sourceId?: string }).sourceId === "base") setTileError(true);
      });
      created.on("load", () => {
        const map = created;
        map.addSource("pharmacies", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
        map.addSource("route", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
        map.addLayer({
          id: "route-line",
          type: "line",
          source: "route",
          paint: { "line-color": "#c4502f", "line-width": 4, "line-opacity": 0.85, "line-dasharray": [2, 1.5] },
          layout: { "line-cap": "round", "line-join": "round" },
        });
        map.addLayer({
          id: "pharmacies-circles",
          type: "circle",
          source: "pharmacies",
          paint: {
            "circle-radius": ["case", ["boolean", ["get", "selected"], false], 9, 5.5],
            "circle-color": ["get", "color"],
            "circle-stroke-color": ["case", ["boolean", ["get", "selected"], false], "#c4502f", "#ffffff"],
            "circle-stroke-width": ["case", ["boolean", ["get", "selected"], false], 3, 1.5],
          },
        });
        map.on("click", "pharmacies-circles", (e) => {
          const id = e.features?.[0]?.properties?.id;
          if (id) onSelectRef.current?.(String(id));
        });
        map.on("mouseenter", "pharmacies-circles", () => (map.getCanvas().style.cursor = "pointer"));
        map.on("mouseleave", "pharmacies-circles", () => (map.getCanvas().style.cursor = ""));
        mapRef.current = created;
        setReady(true);
      });
    })();
    return () => {
      cancelled = true;
      map?.remove();
      mapRef.current = null;
    };
  }, []);

  // Données : pharmacies et tracé
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    (map.getSource("pharmacies") as GeoJSONSource).setData({
      type: "FeatureCollection",
      features: pharmacies.map((p) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: [p.lng, p.lat] },
        properties: { id: p.id, color: CATEGORY_COLORS[p.category ?? ""] ?? UNKNOWN_CATEGORY_COLOR, selected: p.id === selectedId },
      })),
    });
    const coords: [number, number][] = line ?? [
      ...(home ? [[home.lng, home.lat] as [number, number]] : []),
      ...stops.map((s) => [s.lng, s.lat] as [number, number]),
      ...(home ? [[home.lng, home.lat] as [number, number]] : []),
    ];
    (map.getSource("route") as GeoJSONSource).setData({
      type: "FeatureCollection",
      features: coords.length > 1 ? [{ type: "Feature", geometry: { type: "LineString", coordinates: coords }, properties: {} }] : [],
    });
    map.setPaintProperty("route-line", "line-dasharray", lineIsEstimate ? [2, 1.5] : [1, 0]);
  }, [ready, pharmacies, stops, line, home, lineIsEstimate, selectedId]);

  // Marqueurs HTML : arrêts numérotés, lieux favoris, domicile
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    let cancelled = false;
    (async () => {
      const maplibre = await import("maplibre-gl");
      if (cancelled) return;
      markersRef.current.forEach((m) => m.remove());
      markersRef.current = [];
      const make = (html: string, cls: string, lng: number, lat: number, title: string, onClick?: () => void) => {
        const el = document.createElement("button");
        el.type = "button";
        el.className = cls;
        el.textContent = html;
        el.title = title;
        el.setAttribute("aria-label", title);
        if (onClick) el.addEventListener("click", onClick);
        markersRef.current.push(new maplibre.Marker({ element: el }).setLngLat([lng, lat]).addTo(map));
      };
      for (const s of stops) {
        make(
          String(s.order),
          `flex size-8 items-center justify-center rounded-full border-2 border-white text-sm font-bold text-white shadow-lg ${s.pharmacyId === selectedId || s.id === selectedId ? "bg-text scale-125" : "bg-[#c4502f]"}`,
          s.lng,
          s.lat,
          `${s.order}. ${s.label} (${s.time})`,
          () => onSelectRef.current?.(s.pharmacyId ?? s.id),
        );
      }
      for (const p of places) {
        make(PLACE_ICON[p.kind] ?? "•", "flex size-6 items-center justify-center rounded-md border border-white bg-[#1f6f68] text-xs font-bold text-white shadow", p.lng, p.lat, p.name);
      }
      if (home) make("⌂", "flex size-7 items-center justify-center rounded-full border-2 border-white bg-[#2a2420] text-sm text-white shadow", home.lng, home.lat, "Domicile");
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, stops, places, home, selectedId]);

  // Cadrage initial : arrêts du jour en priorité, sinon toutes les pharmacies
  const framed = useRef(false);
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || framed.current) return;
    const pts = stops.length ? [...stops, ...(home ? [home] : [])] : pharmacies;
    if (pts.length === 0) return;
    framed.current = true;
    if (pts.length === 1) {
      map.jumpTo({ center: [pts[0]!.lng, pts[0]!.lat], zoom: 12 });
      return;
    }
    const lngs = pts.map((p) => p.lng);
    const lats = pts.map((p) => p.lat);
    map.fitBounds(
      [
        [Math.min(...lngs), Math.min(...lats)],
        [Math.max(...lngs), Math.max(...lats)],
      ],
      { padding: 48, duration: 0, maxZoom: 13 },
    );
  }, [ready, stops, pharmacies, home]);

  // Centre la carte sur l'élément sélectionné depuis la liste
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || !selectedId) return;
    const target = stops.find((s) => s.pharmacyId === selectedId || s.id === selectedId) ?? pharmacies.find((p) => p.id === selectedId);
    if (target) map.easeTo({ center: [target.lng, target.lat], zoom: Math.max(map.getZoom(), 11), duration: 400 });
  }, [ready, selectedId, stops, pharmacies]);

  return (
    <div className={`relative overflow-hidden rounded-2xl border border-border ${className ?? "h-[60vh]"}`}>
      {/* MapLibre impose position: relative au conteneur : on le dimensionne en hauteur pleine */}
      <div ref={container} className="h-full w-full" role="region" aria-label="Carte" />
      {!TILES || tileError ? (
        <p className="absolute bottom-2 left-2 rounded-full bg-surface/90 px-2 py-1 text-xs text-muted shadow">
          Fond de carte indisponible ({TILES ? "service de tuiles injoignable" : "aucun service configuré"}) : les points restent affichés.
        </p>
      ) : null}
      {stops.length > 1 ? (
        <p className="absolute top-2 left-2 rounded-full bg-surface/90 px-2 py-1 text-xs text-muted shadow">
          {lineIsEstimate ? "Tracé indicatif (lignes droites) — pas un itinéraire routier" : "Itinéraire routier"}
        </p>
      ) : null}
    </div>
  );
}
