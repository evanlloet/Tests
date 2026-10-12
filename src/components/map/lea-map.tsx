"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import type { GeoJSONSource, Map as MlMap, Marker } from "maplibre-gl";
import { Maximize2 } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Buddy } from "@/components/buddy";
import { PHARMACY_MOODS, type BuddyColor } from "@/domain/mood";
import type { DueState } from "@/domain/frequency";
import { cn } from "@/lib/cn";
import { CATEGORY_COLORS, UNKNOWN_CATEGORY_COLOR } from "@/lib/palette";

export type MapPharmacy = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  category: string | null;
  sectorColor: string | null;
  due: string;
  /** Position approximative (centre de la commune) */
  approx?: boolean;
};

export type MapStop = { id: string; label: string; lat: number; lng: number; order: number; time: string; pharmacyId: string | null };
export type MapPlace = { id: string; name: string; kind: string; lat: number; lng: number };
/** Secteur suivi (département), teinté sur la carte */
export type MapSector = { code: string; name: string; color: string };
export type MapColorMode = "mood" | "category";

/** Couleur du bonhomme d'une pharmacie selon son échéance (le visage porte aussi l'information). */
export const DUE_BUDDY_COLOR: Record<string, BuddyColor> = {
  overdue: "red",
  due_soon: "orange",
  never_visited: "purple",
  planned: "blue",
  ok: "green",
  unknown: "gray",
};

export const DUE_LABEL: Record<string, string> = {
  overdue: "En retard",
  due_soon: "À prévoir",
  never_visited: "Jamais visitée",
  planned: "Planifiée",
  ok: "À jour",
  unknown: "Catégorie inconnue",
};

const PLACE_ICON: Record<string, string> = { hotel: "H", restaurant: "R", pool: "P", other: "•" };
const HOUSE_SVG =
  '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V20h14V9.5"/><path d="M10 20v-5h4v5"/></svg>';

const TILES = process.env.NEXT_PUBLIC_MAP_RASTER_TILES;
const ATTRIBUTION = process.env.NEXT_PUBLIC_MAP_ATTRIBUTION ?? "";
/** Au-delà de ce zoom, les pharmacies ne sont plus regroupées (seules les positions identiques restent empilées). */
const CLUSTER_MAX_ZOOM = 11;
const SECTOR_LABEL_MAX_ZOOM = 9;

type Bubble =
  | { key: string; kind: "cluster"; el: HTMLElement; clusterId: number; count: number; overdue: number; lng: number; lat: number }
  | { key: string; kind: "stack"; el: HTMLElement; ids: string[]; overdue: number }
  | { key: string; kind: "point"; el: HTMLElement; id: string };

/**
 * Carte MapLibre de Léa : fond IGN adouci (ou contours des départements hors
 * connexion), secteurs suivis teintés, pharmacies en bonshommes regroupées par
 * bulles, tournée numérotée, domicile et lieux favoris. La sélection est
 * synchronisée avec la liste ; `children` s'affiche en surimpression (carte de la
 * pharmacie choisie).
 */
export function LeaMap({
  pharmacies,
  stops = [],
  line = null,
  lineIsEstimate = true,
  places = [],
  home = null,
  sectors = [],
  colorMode = "mood",
  selectedId,
  onSelect,
  onGroupSelect,
  children,
  className,
}: {
  pharmacies: MapPharmacy[];
  stops?: MapStop[];
  line?: [number, number][] | null;
  lineIsEstimate?: boolean;
  places?: MapPlace[];
  home?: { lat: number; lng: number } | null;
  sectors?: MapSector[];
  colorMode?: MapColorMode;
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  /** Bulle ou pile de pharmacies au même endroit : liste des identifiants */
  onGroupSelect?: (ids: string[]) => void;
  children?: ReactNode;
  className?: string;
}) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const libRef = useRef<typeof import("maplibre-gl") | null>(null);
  const markersRef = useRef<Marker[]>([]);
  const poolRef = useRef(new Map<string, { marker: Marker; el: HTMLElement }>());
  const onSelectRef = useRef(onSelect);
  const onGroupRef = useRef(onGroupSelect);
  const selectedRef = useRef<string | null>(selectedId ?? null);
  const [ready, setReady] = useState(false);
  const [tileError, setTileError] = useState(false);
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const [zoom, setZoom] = useState(7);
  const byId = new Map(pharmacies.map((p) => [p.id, p]));

  useEffect(() => {
    onSelectRef.current = onSelect;
    onGroupRef.current = onGroupSelect;
  }, [onSelect, onGroupSelect]);

  // Création de la carte
  useEffect(() => {
    let cancelled = false;
    let map: MlMap | null = null;
    const pool = poolRef.current;
    (async () => {
      const maplibre = await import("maplibre-gl");
      if (cancelled || !container.current) return;
      libRef.current = maplibre;
      // Worker servi depuis public/vendor (copié à l'installation, voir scripts/copy-maplibre-worker.mjs)
      maplibre.setWorkerUrl(`/vendor/maplibre-gl-worker-${maplibre.getVersion()}.mjs`);
      const created = new maplibre.Map({
        container: container.current,
        style: {
          version: 8,
          sources: TILES ? { base: { type: "raster", tiles: [TILES], tileSize: 256, attribution: ATTRIBUTION, maxzoom: 19 } } : {},
          layers: [{ id: "sea", type: "background", paint: { "background-color": "#cfe3ef" } }],
        },
        center: [-1.0, 48.8],
        zoom: 7,
        attributionControl: { compact: true },
      });
      map = created;
      created.addControl(new maplibre.NavigationControl({ showCompass: false }), "top-right");
      created.addControl(new maplibre.FullscreenControl(), "top-right");
      created.addControl(new maplibre.GeolocateControl({ positionOptions: { enableHighAccuracy: true } }), "top-right");
      created.addControl(new maplibre.ScaleControl({ unit: "metric" }), "bottom-left");
      created.on("error", (e) => {
        if ((e as { sourceId?: string }).sourceId === "base") setTileError(true);
      });
      created.on("zoomend", () => setZoom(created.getZoom()));
      created.on("load", () => {
        const map = created;
        const empty = { type: "FeatureCollection" as const, features: [] };
        // Fond de secours : départements (dessinés sous les tuiles IGN, visibles si elles manquent)
        map.addSource("departements", { type: "geojson", data: "/geo/departements-ouest.geojson" });
        map.addLayer({ id: "land", type: "fill", source: "departements", paint: { "fill-color": "#f7f3ec" } });
        if (TILES) {
          map.addLayer({
            id: "base",
            type: "raster",
            source: "base",
            // Plan IGN adouci pour s'accorder aux couleurs pastel de Léa
            paint: { "raster-saturation": -0.35, "raster-contrast": -0.08, "raster-brightness-min": 0.06 },
          });
        }
        map.addLayer({ id: "sector-fill", type: "fill", source: "departements", paint: { "fill-color": "rgba(0,0,0,0)", "fill-opacity": 0.16 } });
        map.addLayer({
          id: "departement-line",
          type: "line",
          source: "departements",
          paint: { "line-color": "#8d86a3", "line-width": 1, "line-opacity": 0.6, "line-dasharray": [3, 2] },
        });
        map.addLayer({ id: "sector-line", type: "line", source: "departements", paint: { "line-color": "rgba(0,0,0,0)", "line-width": 2.5, "line-opacity": 0.85 } });
        map.addSource("route", { type: "geojson", data: empty });
        map.addLayer({
          id: "route-casing",
          type: "line",
          source: "route",
          paint: { "line-color": "#ffffff", "line-width": 8, "line-opacity": 0.9 },
          layout: { "line-cap": "round", "line-join": "round" },
        });
        map.addLayer({
          id: "route-line",
          type: "line",
          source: "route",
          paint: { "line-color": "#2d5bff", "line-width": 4, "line-dasharray": [2, 1.5] },
          layout: { "line-cap": "round", "line-join": "round" },
        });
        map.addSource("pharmacies", {
          type: "geojson",
          data: empty,
          cluster: true,
          clusterRadius: 46,
          clusterMaxZoom: CLUSTER_MAX_ZOOM,
          clusterProperties: { overdue: ["+", ["case", ["==", ["get", "due"], "overdue"], 1, 0]] },
        });
        // Couche invisible : garantit le chargement des données regroupées, affichées en marqueurs HTML
        map.addLayer({ id: "pharmacies-data", type: "circle", source: "pharmacies", paint: { "circle-radius": 1, "circle-opacity": 0 } });

        let scheduled = false;
        let lastSignature = "";
        const refresh = () => {
          if (scheduled) return;
          scheduled = true;
          requestAnimationFrame(() => {
            scheduled = false;
            if (!map.getSource("pharmacies") || !map.isSourceLoaded("pharmacies")) return;
            const next = collectBubbles(map, maplibre, pool, selectedRef.current);
            // Pas de nouveau rendu React tant que l'ensemble des marqueurs ne change pas
            const signature = next.map((b) => (b.kind === "cluster" ? `${b.key}:${b.count}:${b.overdue}` : b.key)).join("|");
            if (signature !== lastSignature) {
              lastSignature = signature;
              setBubbles(next);
            }
          });
        };
        map.on("render", refresh);
        mapRef.current = created;
        setReady(true);
      });
    })();
    return () => {
      cancelled = true;
      pool.forEach((e) => e.marker.remove());
      pool.clear();
      map?.remove();
      mapRef.current = null;
    };
  }, []);

  // Secteurs suivis : teinte et contour aux couleurs des territoires
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const color = sectors.length ? (["match", ["get", "code"], ...sectors.flatMap((s) => [s.code, s.color]), "rgba(0,0,0,0)"] as unknown as string) : "rgba(0,0,0,0)";
    map.setPaintProperty("sector-fill", "fill-color", color);
    map.setPaintProperty("sector-line", "line-color", color);
  }, [ready, sectors]);

  // Données : pharmacies et tracé
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    (map.getSource("pharmacies") as GeoJSONSource).setData({
      type: "FeatureCollection",
      features: pharmacies.map((p) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: [p.lng, p.lat] },
        properties: { id: p.id, due: p.due },
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
  }, [ready, pharmacies, stops, line, home, lineIsEstimate]);

  // Marqueurs fixes : arrêts numérotés avec l'heure, lieux favoris, domicile, noms des secteurs
  useEffect(() => {
    const map = mapRef.current;
    const maplibre = libRef.current;
    if (!ready || !map || !maplibre) return;
    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];
    // Au-dessus des pharmacies et des bulles : tournée et domicile restent toujours visibles
    const add = (el: HTMLElement, lng: number, lat: number, zIndex = 8) => {
      const marker = new maplibre.Marker({ element: el }).setLngLat([lng, lat]).addTo(map);
      marker.getElement().style.zIndex = String(zIndex);
      markersRef.current.push(marker);
    };
    const button = (className: string, title: string, html: string, onClick?: () => void) => {
      const el = document.createElement("button");
      el.type = "button";
      el.className = className;
      el.title = title;
      el.setAttribute("aria-label", title);
      el.innerHTML = html;
      if (onClick) el.addEventListener("click", onClick);
      return el;
    };
    for (const s of sectors) {
      const label = DEPARTMENT_LABELS[s.code];
      if (!label) continue;
      const el = document.createElement("span");
      el.className = "lea-sector-label pointer-events-none rounded-full bg-white/85 px-2.5 py-1 text-xs font-bold text-[#17132b] shadow-sm";
      el.style.borderLeft = `6px solid ${s.color}`;
      el.textContent = s.name;
      add(el, label[0], label[1], 0);
    }
    for (const p of places) {
      add(button("flex size-7 items-center justify-center rounded-lg border-2 border-white bg-[#1f6f68] text-xs font-bold text-white shadow-md", p.name, PLACE_ICON[p.kind] ?? "•"), p.lng, p.lat);
    }
    for (const s of stops) {
      const active = s.pharmacyId === selectedId || s.id === selectedId;
      const html = `<span class="flex size-8 items-center justify-center rounded-full border-[3px] border-white text-sm font-extrabold text-white shadow-lg ${active ? "bg-[#2d5bff]" : "bg-[#17132b]"}">${s.order}</span><span class="rounded-full bg-white px-1.5 py-0.5 text-[11px] font-bold text-[#17132b] shadow">${escapeHtml(s.time)}</span>`;
      add(
        button(`flex items-center gap-1 transition ${active ? "scale-125" : ""}`, `${s.order}. ${s.label} (${s.time})`, html, () => onSelectRef.current?.(s.pharmacyId ?? s.id)),
        s.lng,
        s.lat,
      );
    }
    if (home) add(button("flex size-9 items-center justify-center rounded-2xl border-[3px] border-white bg-[#ffd43b] text-[#17132b] shadow-lg", "Domicile", HOUSE_SVG), home.lng, home.lat);
  }, [ready, stops, places, home, sectors, selectedId]);

  const fitAll = (animate = true) => {
    const map = mapRef.current;
    const pts = [...pharmacies, ...stops, ...(home ? [home] : [])];
    if (!map || pts.length === 0) return;
    if (pts.length === 1) {
      map.easeTo({ center: [pts[0]!.lng, pts[0]!.lat], zoom: 12, duration: animate ? 500 : 0 });
      return;
    }
    const lngs = pts.map((p) => p.lng);
    const lats = pts.map((p) => p.lat);
    map.fitBounds(
      [
        [Math.min(...lngs), Math.min(...lats)],
        [Math.max(...lngs), Math.max(...lats)],
      ],
      { padding: 56, duration: animate ? 600 : 0, maxZoom: 13 },
    );
  };

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
      { padding: 56, duration: 0, maxZoom: 13 },
    );
  }, [ready, stops, pharmacies, home]);

  // La pharmacie sélectionnée passe au premier plan (appliqué au prochain rendu de la carte)
  useEffect(() => {
    selectedRef.current = selectedId ?? null;
    mapRef.current?.triggerRepaint();
  }, [selectedId]);

  // Centre la carte sur l'élément sélectionné depuis la liste
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || !selectedId) return;
    const target = stops.find((s) => s.pharmacyId === selectedId || s.id === selectedId) ?? pharmacies.find((p) => p.id === selectedId);
    if (target) map.easeTo({ center: [target.lng, target.lat], zoom: Math.max(map.getZoom(), CLUSTER_MAX_ZOOM + 1), duration: 500 });
  }, [ready, selectedId, stops, pharmacies]);

  const openCluster = async (b: Extract<Bubble, { kind: "cluster" }>) => {
    const map = mapRef.current;
    if (!map) return;
    const source = map.getSource("pharmacies") as GeoJSONSource;
    const expansion = await source.getClusterExpansionZoom(b.clusterId);
    if (expansion > CLUSTER_MAX_ZOOM + 1) {
      // Toutes au même endroit (centre de commune) : on les liste plutôt que de zoomer
      const leaves = await source.getClusterLeaves(b.clusterId, 500, 0);
      onGroupRef.current?.(leaves.map((l) => String(l.properties?.id)));
    } else {
      map.easeTo({ center: [b.lng, b.lat], zoom: expansion, duration: 500 });
    }
  };

  return (
    <div
      className={cn("relative overflow-hidden rounded-[28px] border border-border/70 bg-[#cfe3ef] shadow-card", className ?? "h-[60vh]")}
      data-zoomed={zoom > SECTOR_LABEL_MAX_ZOOM ? "true" : "false"}
    >
      {/* MapLibre impose position: relative au conteneur : on le dimensionne en hauteur pleine */}
      <div ref={container} className="lea-map h-full w-full" role="region" aria-label="Carte" />

      {bubbles.map((b) =>
        createPortal(
          b.kind === "point" ? (
            <PointMarker pharmacy={byId.get(b.id)} colorMode={colorMode} selected={b.id === selectedId} onClick={() => onSelectRef.current?.(b.id)} />
          ) : b.kind === "cluster" ? (
            <GroupMarker count={b.count} overdue={b.overdue} onClick={() => void openCluster(b)} />
          ) : (
            <GroupMarker count={b.ids.length} overdue={b.overdue} stacked selected={b.ids.includes(selectedId ?? "")} onClick={() => onGroupRef.current?.(b.ids)} />
          ),
          b.el,
          b.key,
        ),
      )}

      <div className="pointer-events-none absolute top-3 right-14 left-3 z-10 flex flex-wrap items-start gap-1.5 sm:gap-2">
        {pharmacies.length + stops.length > 1 ? (
          <button
            type="button"
            onClick={() => fitAll()}
            className="pointer-events-auto inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1.5 text-xs font-bold text-[#17132b] shadow-md hover:bg-[#f1eef8]"
          >
            <Maximize2 className="size-3.5" aria-hidden /> Tout voir
          </button>
        ) : null}
        {stops.length > 1 ? (
          <span className="rounded-full bg-white/90 px-2.5 py-1 text-[10px] font-semibold text-[#6e6787] shadow sm:px-3 sm:py-1.5 sm:text-xs">
            {lineIsEstimate ? "Tracé indicatif (lignes droites), pas un itinéraire routier" : "Itinéraire routier"}
          </span>
        ) : null}
        {!TILES || tileError ? (
          <span className="rounded-full bg-white/90 px-2.5 py-1 text-[10px] font-semibold text-[#6e6787] shadow sm:px-3 sm:py-1.5 sm:text-xs">
            {TILES ? "Plan IGN injoignable : fond simplifié" : "Fond simplifié : aucun service de tuiles configuré"}
          </span>
        ) : null}
      </div>

      {children ? <div className="absolute right-3 bottom-8 left-3 z-10 sm:right-auto sm:w-[360px]">{children}</div> : null}

      {pharmacies.length ? <Legend colorMode={colorMode} /> : null}
    </div>
  );
}

/** Marqueurs à afficher pour la vue courante : bulles, piles (même position) et pharmacies seules. */
function collectBubbles(
  map: MlMap,
  maplibre: typeof import("maplibre-gl"),
  pool: Map<string, { marker: Marker; el: HTMLElement }>,
  selectedId: string | null,
): Bubble[] {
  const next = new Map<string, Bubble>();
  const points = new Map<string, { ids: string[]; overdue: number; coords: [number, number] }>();
  const ensure = (key: string, coords: [number, number]) => {
    let entry = pool.get(key);
    if (!entry) {
      const el = document.createElement("div");
      el.className = "lea-marker";
      entry = { el, marker: new maplibre.Marker({ element: el }).setLngLat(coords).addTo(map) };
      pool.set(key, entry);
    }
    return entry.el;
  };
  for (const f of map.querySourceFeatures("pharmacies")) {
    const coords = (f.geometry as GeoJSON.Point).coordinates as [number, number];
    const p = f.properties ?? {};
    if (p.cluster) {
      const key = `c${p.cluster_id}`;
      if (!next.has(key))
        next.set(key, {
          key,
          kind: "cluster",
          el: ensure(key, coords),
          clusterId: Number(p.cluster_id),
          count: Number(p.point_count),
          overdue: Number(p.overdue ?? 0),
          lng: coords[0],
          lat: coords[1],
        });
      continue;
    }
    // Plusieurs pharmacies exactement au même endroit (centre de commune) : une pile
    const at = `${coords[0].toFixed(5)},${coords[1].toFixed(5)}`;
    const group = points.get(at) ?? { ids: [], overdue: 0, coords };
    if (!group.ids.includes(String(p.id))) {
      group.ids.push(String(p.id));
      if (p.due === "overdue") group.overdue++;
    }
    points.set(at, group);
  }
  for (const [at, g] of points) {
    if (g.ids.length === 1) {
      const key = `p${g.ids[0]}`;
      next.set(key, { key, kind: "point", el: ensure(key, g.coords), id: g.ids[0]! });
    } else {
      const key = `s${at}`;
      next.set(key, { key, kind: "stack", el: ensure(key, g.coords), ids: g.ids, overdue: g.overdue });
    }
  }
  for (const [key, entry] of pool) {
    if (!next.has(key)) {
      entry.marker.remove();
      pool.delete(key);
    } else entry.el.style.zIndex = key === `p${selectedId}` ? "5" : "2"; // au-dessus des noms de secteurs
  }
  return [...next.values()];
}

function PointMarker({ pharmacy: p, colorMode, selected, onClick }: { pharmacy?: MapPharmacy; colorMode: MapColorMode; selected: boolean; onClick: () => void }) {
  if (!p) return null;
  const title = `${p.name} — ${DUE_LABEL[p.due] ?? p.due}${p.approx ? " (position approximative)" : ""}`;
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      aria-pressed={selected}
      className={cn(
        "block rounded-full transition-transform hover:z-10 hover:scale-125",
        selected && "scale-150",
        p.approx && !selected && "opacity-80",
      )}
    >
      {colorMode === "category" ? (
        <span
          className={cn("flex size-6 items-center justify-center rounded-full border-2 text-[11px] font-extrabold text-white shadow-md", selected ? "border-[#17132b]" : "border-white")}
          style={{ backgroundColor: CATEGORY_COLORS[p.category ?? ""] ?? UNKNOWN_CATEGORY_COLOR }}
        >
          {p.category ?? "?"}
        </span>
      ) : (
        <span className={cn("block rounded-full", selected ? "bg-[#17132b] p-0.5" : "bg-white p-px shadow-md")}>
          <Buddy mood={PHARMACY_MOODS[p.due as DueState]?.mood ?? "calm"} shape="circle" color={DUE_BUDDY_COLOR[p.due] ?? "gray"} size={26} />
        </span>
      )}
    </button>
  );
}

function GroupMarker({ count, overdue, stacked = false, selected = false, onClick }: { count: number; overdue: number; stacked?: boolean; selected?: boolean; onClick: () => void }) {
  const size = Math.round(32 + Math.min(26, Math.sqrt(count) * 3.2));
  const label = `${count} pharmacies${stacked ? " au même endroit" : ""}${overdue ? `, dont ${overdue} en retard` : ""}`;
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className={cn(
        "relative flex items-center justify-center rounded-full border-[3px] font-display font-extrabold text-white shadow-lg transition-transform hover:scale-110",
        selected ? "border-[#2d5bff] bg-[#2d5bff]" : "border-white bg-[#17132b]",
        stacked && "rounded-[14px]",
      )}
      style={{ width: size, height: size, fontSize: size > 46 ? 16 : 13 }}
    >
      {count}
      {overdue ? (
        <span className="absolute -top-1.5 -right-1.5 flex h-5 min-w-5 items-center justify-center rounded-full border-2 border-white bg-[#e5484d] px-1 text-[10px] font-bold">
          {overdue}
        </span>
      ) : null}
    </button>
  );
}

function Legend({ colorMode }: { colorMode: MapColorMode }) {
  return (
    <details className="absolute right-3 bottom-8 z-10 hidden rounded-2xl bg-white/95 text-xs text-[#17132b] shadow-lg sm:block [&_summary::-webkit-details-marker]:hidden">
      <summary className="cursor-pointer list-none px-3 py-2 font-bold">Légende</summary>
      <ul className="space-y-1.5 px-3 pb-3">
        {colorMode === "mood"
          ? (["overdue", "due_soon", "never_visited", "planned", "ok", "unknown"] as const).map((d) => (
              <li key={d} className="flex items-center gap-2">
                <Buddy mood={PHARMACY_MOODS[d].mood} shape="circle" color={DUE_BUDDY_COLOR[d]} size={18} /> {DUE_LABEL[d]}
              </li>
            ))
          : (["A", "B", "C", "D"] as const).map((c) => (
              <li key={c} className="flex items-center gap-2">
                <span className="size-3.5 rounded-full" style={{ backgroundColor: CATEGORY_COLORS[c] }} /> Catégorie {c}
              </li>
            ))}
        <li className="flex items-center gap-2">
          <span className="flex size-5 items-center justify-center rounded-full bg-[#17132b] text-[9px] font-bold text-white">12</span> Plusieurs pharmacies
          <span className="rounded-full bg-[#e5484d] px-1 text-[9px] font-bold text-white">3</span> en retard
        </li>
        <li className="text-[#6e6787]">Point pâle : position approximative (centre de la commune)</li>
      </ul>
    </details>
  );
}

/** Points d'étiquette des départements (identiques à public/geo/departements-ouest.geojson). */
const DEPARTMENT_LABELS: Record<string, [number, number]> = {
  "14": [-0.362, 49.1],
  "22": [-2.865, 48.44],
  "27": [0.996, 49.114],
  "28": [1.37, 48.388],
  "35": [-1.634, 48.151],
  "44": [-1.679, 47.363],
  "49": [-0.559, 47.39],
  "50": [-1.329, 49.081],
  "53": [-0.657, 48.147],
  "56": [-2.804, 47.855],
  "61": [0.128, 48.623],
  "72": [0.223, 47.995],
};

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
