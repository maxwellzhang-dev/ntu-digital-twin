'use client';

import { useEffect, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import type { GeoJSONSource, Map as MapLibreMap } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { NTU_CENTER, ThreeBusLayer } from '@/lib/threeBusLayer';
import { buildPhotorealLayers, createPhotorealOverlay } from '@/lib/photorealistic';
import type { ActiveBus, EnvironmentState } from '@/lib/types';

type FC = GeoJSON.FeatureCollection;

export interface FlyTarget {
  center: [number, number];
  zoom?: number;
  pitch?: number;
  bearing?: number;
  key: number;
}

export interface LayerVisibility {
  photoreal: boolean;
  satellite: boolean;
  energy: boolean;
  transit: boolean;
  facilities: boolean;
  haze: boolean;
}

interface Props {
  buildingsGeoJson: FC | null;
  pillarsGeoJson: FC | null;
  stopsAndRoutes: { stops: FC; routes: FC } | null;
  facilitiesGeoJson: FC | null;
  environment: EnvironmentState | null;
  buses: ActiveBus[];
  layers: LayerVisibility;
  flyTarget: FlyTarget | null;
  onBuildingClick: (id: string) => void;
}

// Turbopack bundles maplibre-gl, which breaks its relative worker URL; serve the worker from /public (copied on postinstall).
maplibregl.setWorkerUrl('/maplibre-gl-worker.mjs');

const EMPTY: FC = { type: 'FeatureCollection', features: [] };
const LOAD_LABEL: Record<string, string> = { SEA: 'Seats available', SDA: 'Standing available', LSD: 'Limited standing' };

const GOOGLE_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? '';
export const PHOTOREAL_AVAILABLE = GOOGLE_KEY.length > 0;

/** MapLibre layers hidden in photoreal mode (Google's mesh replaces the basemap and our extrusions). */
const MAPLIBRE_DATA_LAYERS = ['campus-3d-buildings', 'campus-building-labels', 'lightning'];

const LAYER_GROUPS: Record<keyof LayerVisibility, string[]> = {
  photoreal: [],
  satellite: ['satellite'],
  energy: ['campus-energy-pillars'],
  transit: ['campus-routes', 'campus-stops', 'ntu-bus-3d', 'live-buses-hit', 'live-buses-label'],
  facilities: ['campus-facilities', 'campus-facilities-label'],
  haze: [],
};

function busesToGeoJson(buses: ActiveBus[]): FC {
  return {
    type: 'FeatureCollection',
    features: buses.map((b) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [b.lng, b.lat] },
      properties: { id: b.id, route: b.route, anchorStop: b.anchorStop, eta: b.anchorEtaMin, load: b.load ?? '', busType: b.busType ?? '', err: b.errorBoundM },
    })),
  };
}

/** Merge live open/closed status into the static facility polygons. */
function facilitiesWithStatus(fc: FC | null, env: EnvironmentState | null): FC {
  if (!fc) return EMPTY;
  const status = new Map(env?.facilities.map((f) => [f.id, f]) ?? []);
  return {
    type: 'FeatureCollection',
    features: fc.features.map((f) => {
      const s = status.get(f.properties?.id);
      return { ...f, properties: { ...f.properties, status: s?.status ?? 'unknown', reasons: s?.reasons.join(' · ') ?? '' } };
    }),
  };
}

function lightningToGeoJson(env: EnvironmentState | null): FC {
  return {
    type: 'FeatureCollection',
    features: (env?.lightning ?? []).map((s) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [s.lng, s.lat] },
      properties: { type: s.type, datetime: s.datetime },
    })),
  };
}

/** 0 (clear) … 1 (hazardous) haze strength from the 24-hr PSI. */
export function hazeStrength(psi: number | null) {
  if (psi === null || psi <= 50) return 0;
  return Math.min(1, (psi - 50) / 250);
}

export default function MapCanvas(props: Props) {
  const { buildingsGeoJson, pillarsGeoJson, stopsAndRoutes, facilitiesGeoJson, environment, buses, layers, flyTarget } = props;
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const busLayerRef = useRef<ThreeBusLayer | null>(null);
  const readyRef = useRef(false);
  const photorealRef = useRef<ReturnType<typeof createPhotorealOverlay> | null>(null);
  const [credits, setCredits] = useState('');

  // Latest props live in a ref so they can be (re)applied whenever the style becomes ready.
  const propsRef = useRef(props);
  propsRef.current = props;

  const syncSources = () => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    const p = propsRef.current;
    (map.getSource('campus-buildings') as GeoJSONSource | undefined)?.setData(p.buildingsGeoJson ?? EMPTY);
    (map.getSource('campus-energy-pillars') as GeoJSONSource | undefined)?.setData(p.pillarsGeoJson ?? EMPTY);
    (map.getSource('campus-routes') as GeoJSONSource | undefined)?.setData(p.stopsAndRoutes?.routes ?? EMPTY);
    (map.getSource('campus-stops') as GeoJSONSource | undefined)?.setData(p.stopsAndRoutes?.stops ?? EMPTY);
    (map.getSource('campus-facilities') as GeoJSONSource | undefined)?.setData(facilitiesWithStatus(p.facilitiesGeoJson, p.environment));
    (map.getSource('lightning') as GeoJSONSource | undefined)?.setData(lightningToGeoJson(p.environment));
    (map.getSource('live-buses') as GeoJSONSource | undefined)?.setData(busesToGeoJson(p.buses));
    const photoreal = p.layers.photoreal && PHOTOREAL_AVAILABLE;
    busLayerRef.current?.setBuses(p.layers.transit && !photoreal ? p.buses : []);

    // Photoreal mode: Google 3D tiles + draped data on a deck.gl canvas above MapLibre.
    if (photoreal) {
      if (!photorealRef.current) {
        photorealRef.current = createPhotorealOverlay();
        map.addControl(photorealRef.current);
      }
      photorealRef.current.setProps({
        layers: buildPhotorealLayers(
          GOOGLE_KEY,
          { stopsAndRoutes: p.stopsAndRoutes, facilitiesGeoJson: p.facilitiesGeoJson, environment: p.environment, buses: p.buses, showTransit: p.layers.transit, showFacilities: p.layers.facilities },
          setCredits,
        ),
      });
    } else if (photorealRef.current) {
      map.removeControl(photorealRef.current);
      photorealRef.current = null;
      setCredits('');
    }
    for (const id of MAPLIBRE_DATA_LAYERS) if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', photoreal ? 'none' : 'visible');

    for (const [group, ids] of Object.entries(LAYER_GROUPS)) {
      const visible = p.layers[group as keyof LayerVisibility] && !photoreal;
      for (const id of ids) if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none');
    }

    // Haze: grey-brown horizon whose density follows the live PSI.
    const h = p.layers.haze ? hazeStrength(p.environment?.psi24h ?? null) : 0;
    map.setSky({
      'sky-color': h > 0 ? '#3a3226' : '#0b1120',
      'horizon-color': h > 0 ? '#8a7a5c' : '#1e293b',
      'fog-color': '#8a7a5c',
      'sky-horizon-blend': 0.4 + h * 0.5,
      'horizon-fog-blend': 0.3 + h * 0.6,
      'fog-ground-blend': 0.6,
      'atmosphere-blend': 0,
    });
  };

  useEffect(() => {
    if (!containerRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: 'https://tiles.openfreemap.org/styles/dark',
      center: NTU_CENTER,
      zoom: 16.2,
      pitch: 62,
      bearing: -20,
      maxPitch: 80,
      canvasContextAttributes: { antialias: true },
      attributionControl: { customAttribution: 'Bus data © LTA DataMall · Air quality & lightning © NEA (data.gov.sg) · Energy figures simulated' },
    });
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'bottom-right');

    map.on('load', () => {
      // Hide the basemap's own buildings so they don't z-fight with ours.
      for (const layer of map.getStyle().layers ?? []) {
        if (layer.id.includes('building')) map.setLayoutProperty(layer.id, 'visibility', 'none');
      }
      // Satellite imagery sits under the basemap's labels (so road names stay readable) but above its fills.
      map.addSource('satellite', {
        type: 'raster',
        tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
        tileSize: 256,
        maxzoom: 19,
        attribution: 'Imagery © Esri, Maxar, Earthstar Geographics',
      });
      const firstLabel = map.getStyle().layers?.find((l) => l.type === 'symbol')?.id;
      map.addLayer({ id: 'satellite', type: 'raster', source: 'satellite', layout: { visibility: 'none' }, paint: { 'raster-saturation': -0.15, 'raster-brightness-max': 0.85 } }, firstLabel);

      // Low warm sun from the south-west gives the extrusions readable light and shadow sides.
      map.setLight({ anchor: 'map', position: [1.4, 210, 35], color: '#fff4e0', intensity: 0.45 });

      map.addSource('campus-buildings', { type: 'geojson', data: EMPTY });
      map.addSource('campus-energy-pillars', { type: 'geojson', data: EMPTY });
      map.addSource('campus-routes', { type: 'geojson', data: EMPTY });
      map.addSource('campus-stops', { type: 'geojson', data: EMPTY });
      map.addSource('campus-facilities', { type: 'geojson', data: EMPTY });
      map.addSource('lightning', { type: 'geojson', data: EMPTY });
      map.addSource('live-buses', { type: 'geojson', data: EMPTY });

      map.addLayer({
        id: 'campus-facilities',
        type: 'fill-extrusion',
        source: 'campus-facilities',
        // Indoor halls only matter for the panel status; their outlines would cover the pools.
        filter: ['!=', ['get', 'kind'], 'indoor'],
        paint: {
          'fill-extrusion-color': [
            'case',
            ['==', ['get', 'status'], 'closed'], '#ef4444',
            ['==', ['get', 'status'], 'unknown'], '#64748b',
            ['==', ['get', 'kind'], 'pool'], '#22d3ee',
            '#4ade80',
          ],
          'fill-extrusion-height': 0.6,
          'fill-extrusion-opacity': 0.75,
        },
      });

      map.addLayer({
        id: 'campus-3d-buildings',
        type: 'fill-extrusion',
        source: 'campus-buildings',
        paint: {
          'fill-extrusion-color': [
            'match',
            ['get', 'category'],
            'academic', '#5b8db8',
            'residential', '#8f7cc0',
            'recreation', '#4fa58a',
            'admin', '#c49a4a',
            '#64748b',
          ],
          'fill-extrusion-height': ['get', 'height'],
          'fill-extrusion-base': 0,
          'fill-extrusion-opacity': 0.92,
          'fill-extrusion-vertical-gradient': true,
        },
      });

      map.addLayer({
        id: 'campus-energy-pillars',
        type: 'fill-extrusion',
        source: 'campus-energy-pillars',
        layout: { visibility: 'none' },
        paint: {
          'fill-extrusion-color': ['step', ['get', 'eui'], '#10B981', 160, '#F59E0B', 200, '#EF4444'],
          'fill-extrusion-base': ['get', 'height'],
          'fill-extrusion-height': ['+', ['get', 'height'], ['*', ['get', 'eui'], 0.75]],
          'fill-extrusion-opacity': 0.9,
        },
      });

      map.addLayer({
        id: 'campus-routes',
        type: 'line',
        source: 'campus-routes',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: {
          'line-color': ['get', 'color'],
          'line-width': ['interpolate', ['linear'], ['zoom'], 14, 1.5, 17, ['case', ['==', ['get', 'kind'], 'public'], 3, 5]],
          'line-opacity': ['case', ['==', ['get', 'kind'], 'public'], 0.55, 0.9],
          'line-dasharray': ['case', ['==', ['get', 'kind'], 'public'], ['literal', [2, 1.5]], ['literal', [1, 0]]],
          'line-blur': 0.5,
        },
      });

      map.addLayer({
        id: 'campus-stops',
        type: 'circle',
        source: 'campus-stops',
        minzoom: 14.5,
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 14.5, 2, 17, 5],
          'circle-color': '#0f172a',
          'circle-stroke-color': '#f8fafc',
          'circle-stroke-width': 1.5,
        },
      });

      // Three.js buses go strictly after routes: roads -> routes -> 3D buses.
      const busLayer = new ThreeBusLayer();
      busLayerRef.current = busLayer;
      map.addLayer(busLayer);

      map.addLayer({
        id: 'lightning',
        type: 'circle',
        source: 'lightning',
        paint: {
          'circle-radius': ['case', ['==', ['get', 'type'], 'G'], 7, 4],
          'circle-color': '#fde047',
          'circle-blur': 0.6,
          'circle-stroke-color': '#fef9c3',
          'circle-stroke-width': 1,
        },
      });

      // Invisible hit targets + labels for the 3D buses.
      map.addLayer({ id: 'live-buses-hit', type: 'circle', source: 'live-buses', paint: { 'circle-radius': 18, 'circle-opacity': 0 } });
      map.addLayer({
        id: 'live-buses-label',
        type: 'symbol',
        source: 'live-buses',
        layout: { 'text-field': ['get', 'route'], 'text-size': 13, 'text-offset': [0, -2.6], 'text-font': ['Noto Sans Bold'], 'text-allow-overlap': true },
        paint: { 'text-color': '#FF7200', 'text-halo-color': '#0b1120', 'text-halo-width': 2 },
      });

      map.addLayer({
        id: 'campus-building-labels',
        type: 'symbol',
        source: 'campus-energy-pillars',
        minzoom: 16.4,
        layout: {
          'text-field': ['get', 'name'],
          'text-font': ['Noto Sans Regular'],
          'text-size': 11,
          'text-max-width': 9,
          'symbol-sort-key': ['-', 0, ['get', 'height']],
        },
        paint: { 'text-color': '#e2e8f0', 'text-halo-color': '#0b1120', 'text-halo-width': 1.5 },
      });

      map.addLayer({
        id: 'campus-facilities-label',
        type: 'symbol',
        source: 'campus-facilities',
        minzoom: 16,
        filter: ['==', ['get', 'kind'], 'pool'],
        layout: { 'text-field': ['concat', ['get', 'name'], ['case', ['==', ['get', 'status'], 'closed'], '\n(closed)', '']], 'text-font': ['Noto Sans Bold'], 'text-size': 11 },
        paint: { 'text-color': ['case', ['==', ['get', 'status'], 'closed'], '#fca5a5', '#67e8f9'], 'text-halo-color': '#0b1120', 'text-halo-width': 1.5 },
      });

      const popup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 14 });
      const hover = (id: string, html: (p: Record<string, any>) => string) => {
        map.on('mouseenter', id, (e) => {
          const p = e.features?.[0]?.properties;
          if (!p) return;
          map.getCanvas().style.cursor = 'pointer';
          popup.setLngLat(e.lngLat).setHTML(html(p)).addTo(map);
        });
        map.on('mouseleave', id, () => {
          map.getCanvas().style.cursor = '';
          popup.remove();
        });
      };
      hover('campus-stops', (p) => {
        const routes = JSON.parse(p.routes ?? '[]').join(' · ');
        return `<b>${p.caption}</b><br/><span style="opacity:.7">${p.name.startsWith('osm-') ? '' : `Stop ${p.name} · `}${routes}</span>`;
      });
      hover(
        'live-buses-hit',
        (p) =>
          `<b>Bus ${p.route}</b> · Live GPS (LTA)<br/>Next stop: ${p.anchorStop} in ${p.eta} min<br/>${LOAD_LABEL[p.load] ?? ''}${p.busType === 'DD' ? ' · Double deck' : ''}<br/><span style="opacity:.7">± ${p.err} m GPS accuracy</span>`,
      );
      hover(
        'campus-facilities',
        (p) =>
          `<b>${p.name}</b><br/>${
            p.status === 'open'
              ? '<span style="color:#4ade80">Open (no weather restriction)</span>'
              : p.status === 'unknown'
                ? '<span style="color:#94a3b8">Unknown (weather data unavailable)</span>'
                : `<span style="color:#f87171">Likely closed</span><br/><span style="opacity:.75">${p.reasons}</span>`
          }<br/><span style="opacity:.55;font-size:10px">Weather status · SRC notices have the final say</span>`,
      );
      hover('lightning', (p) => `<b>Lightning</b> · ${p.type === 'G' ? 'cloud-to-ground' : 'cloud-to-cloud'}<br/>${new Date(p.datetime).toLocaleTimeString('en-SG')}`);

      for (const id of ['campus-3d-buildings', 'campus-energy-pillars']) {
        map.on('click', id, (e) => {
          const p = e.features?.[0]?.properties;
          if (p?.id && (id === 'campus-energy-pillars' || p.named)) propsRef.current.onBuildingClick(String(p.id));
        });
      }

      readyRef.current = true;
      syncSources();
    });

    return () => {
      readyRef.current = false;
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    syncSources();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buildingsGeoJson, pillarsGeoJson, stopsAndRoutes, facilitiesGeoJson, environment, buses, layers]);

  useEffect(() => {
    if (!flyTarget || !mapRef.current) return;
    mapRef.current.flyTo({ center: flyTarget.center, zoom: flyTarget.zoom ?? 17.2, pitch: flyTarget.pitch ?? 60, bearing: flyTarget.bearing ?? -20, duration: 2200, essential: true });
  }, [flyTarget]);

  const haze = layers.haze ? hazeStrength(environment?.psi24h ?? null) : 0;

  // MapLibre sets `position: relative` on its container, so the absolute sizing lives on a wrapper.
  return (
    <div className="absolute inset-0">
      <div ref={containerRef} className="h-full w-full" />
      {layers.photoreal && PHOTOREAL_AVAILABLE && (
        // Google attribution: logo text + per-viewport data credits, kept apart from other attributions.
        <div className="pointer-events-none absolute bottom-2 left-1/2 z-[5] -translate-x-1/2 rounded bg-black/55 px-2 py-0.5 text-[11px] text-white">
          <span className="font-semibold">Google</span>
          {credits && <span className="ml-1.5 opacity-80">{credits}</span>}
        </div>
      )}
      {/* z-index: MapLibre's control container (z 2) hosts deck.gl's canvas in Real 3D mode; overlays must sit above it. */}
      {/* Smog overlay: thick toward the horizon (top of a pitched view), thin near the camera. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 z-[3] transition-opacity duration-1000"
        style={{
          opacity: haze,
          background: 'linear-gradient(to bottom, rgba(150,130,95,0.85) 0%, rgba(140,120,88,0.55) 35%, rgba(120,104,78,0.18) 75%, rgba(110,96,72,0.05) 100%)',
          mixBlendMode: 'screen',
        }}
      />
    </div>
  );
}
