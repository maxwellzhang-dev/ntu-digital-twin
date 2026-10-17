import { MapboxOverlay } from '@deck.gl/mapbox';
import { Tile3DLayer } from '@deck.gl/geo-layers';
import { PathLayer, PolygonLayer, ScatterplotLayer, TextLayer } from '@deck.gl/layers';
import { _TerrainExtension as TerrainExtension } from '@deck.gl/extensions';
import type { Tileset3D } from '@loaders.gl/tiles';
import type { ActiveBus, EnvironmentState } from '@/lib/types';

/**
 * "Real-world" mode: Google Photorealistic 3D Tiles as the basemap, with our live data
 * draped onto the mesh via deck.gl's TerrainExtension.
 *
 * Google Map Tiles API policies (https://developers.google.com/maps/documentation/tile/policies):
 * - the Google logo and the per-viewport data attributions must stay visible and must not be
 *   mixed with third-party attributions → we render them in their own corner box;
 * - tiles must not be pre-fetched, stored or cached → we only stream them in the browser.
 */
export const GOOGLE_TILESET_URL = 'https://tile.googleapis.com/v1/3dtiles/root.json';

type FC = GeoJSON.FeatureCollection;
type RGBA = [number, number, number, number];

const terrain = new TerrainExtension();

function hexToRgb(hex: string, alpha = 255): RGBA {
  const n = Number.parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, alpha];
}

const STATUS_COLOR: Record<string, RGBA> = {
  closed: [239, 68, 68, 170],
  unknown: [100, 116, 139, 150],
  pool: [34, 211, 238, 160],
  open: [74, 222, 128, 140],
};

export interface PhotorealData {
  stopsAndRoutes: { stops: FC; routes: FC } | null;
  facilitiesGeoJson: FC | null;
  environment: EnvironmentState | null;
  buses: ActiveBus[];
  showTransit: boolean;
  showFacilities: boolean;
}

export function createPhotorealOverlay() {
  // Non-interleaved: deck draws on its own canvas above MapLibre, so the Google mesh is the basemap.
  return new MapboxOverlay({ interleaved: false, layers: [] });
}

export function buildPhotorealLayers(apiKey: string, data: PhotorealData, onCredits: (credits: string) => void) {
  const statusById = new Map(data.environment?.facilities.map((f) => [f.id, f.status]) ?? []);

  return [
    new Tile3DLayer({
      id: 'google-3d-tiles',
      data: GOOGLE_TILESET_URL,
      loadOptions: { fetch: { headers: { 'X-GOOG-API-KEY': apiKey } } },
      // Makes the mesh the "terrain" that TerrainExtension layers drape onto.
      operation: 'terrain+draw',
      onTilesetLoad: (tileset: Tileset3D) => {
        // Collect the attributions of the tiles currently on screen (required by Google).
        tileset.options.onTraversalComplete = (selected) => {
          const credits = new Set<string>();
          for (const tile of selected) {
            const copyright: string | undefined = (tile.content as { gltf?: { asset?: { copyright?: string } } })?.gltf?.asset?.copyright;
            copyright?.split(';').forEach((c) => c.trim() && credits.add(c.trim()));
          }
          onCredits([...credits].join('; '));
          return selected;
        };
      },
    }),

    new PolygonLayer({
      id: 'photoreal-facilities',
      data: data.facilitiesGeoJson?.features.filter((f) => f.properties?.kind !== 'indoor') ?? [],
      visible: data.showFacilities,
      getPolygon: (f: GeoJSON.Feature) => (f.geometry as GeoJSON.Polygon).coordinates,
      getFillColor: (f: GeoJSON.Feature) => {
        const status = statusById.get(f.properties?.id) ?? 'unknown';
        if (status !== 'open') return STATUS_COLOR[status];
        return f.properties?.kind === 'pool' ? STATUS_COLOR.pool : STATUS_COLOR.open;
      },
      stroked: false,
      extensions: [terrain],
      updateTriggers: { getFillColor: data.environment?.asOf },
    }),

    new PathLayer({
      id: 'photoreal-routes',
      data: data.stopsAndRoutes?.routes.features ?? [],
      visible: data.showTransit,
      getPath: (f: GeoJSON.Feature) => (f.geometry as GeoJSON.LineString).coordinates as [number, number][],
      getColor: (f: GeoJSON.Feature) => hexToRgb(f.properties?.color ?? '#94a3b8', f.properties?.kind === 'public' ? 150 : 230),
      getWidth: (f: GeoJSON.Feature) => (f.properties?.kind === 'public' ? 3 : 5),
      widthUnits: 'pixels',
      capRounded: true,
      jointRounded: true,
      extensions: [terrain],
    }),

    new ScatterplotLayer({
      id: 'photoreal-stops',
      data: data.stopsAndRoutes?.stops.features ?? [],
      visible: data.showTransit,
      getPosition: (f: GeoJSON.Feature) => (f.geometry as GeoJSON.Point).coordinates as [number, number],
      getRadius: 4,
      radiusUnits: 'pixels',
      getFillColor: [15, 23, 42, 255],
      getLineColor: [248, 250, 252, 255],
      lineWidthMinPixels: 1.5,
      stroked: true,
      extensions: [terrain],
    }),

    new ScatterplotLayer({
      id: 'photoreal-lightning',
      data: data.environment?.lightning ?? [],
      getPosition: (s: { lng: number; lat: number }) => [s.lng, s.lat],
      getRadius: (s: { type: string }) => (s.type === 'G' ? 9 : 5),
      radiusUnits: 'pixels',
      getFillColor: [253, 224, 71, 220],
      extensions: [terrain],
    }),

    new ScatterplotLayer({
      id: 'photoreal-buses',
      data: data.buses,
      visible: data.showTransit,
      getPosition: (b: ActiveBus) => [b.lng, b.lat],
      getRadius: 8,
      radiusUnits: 'pixels',
      getFillColor: [255, 114, 0, 255],
      getLineColor: [255, 255, 255, 255],
      lineWidthMinPixels: 2,
      stroked: true,
      extensions: [terrain],
    }),

    new TextLayer({
      id: 'photoreal-bus-labels',
      data: data.buses,
      visible: data.showTransit,
      getPosition: (b: ActiveBus) => [b.lng, b.lat],
      getText: (b: ActiveBus) => b.route,
      getSize: 14,
      getColor: [255, 114, 0, 255],
      getPixelOffset: [0, -18],
      fontWeight: 700,
      outlineWidth: 3,
      outlineColor: [11, 17, 32, 255],
      fontSettings: { sdf: true },
      extensions: [terrain],
    }),
  ];
}
