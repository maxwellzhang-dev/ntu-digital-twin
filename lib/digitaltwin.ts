import rawBuildings from '@/data/ntu-buildings.json';
import type { BuildingCategory, BuildingEnergy, CampusBuilding, MonthlyEnergy } from '@/lib/types';

interface RawBuilding {
  osmId: number;
  name: string | null;
  levels: number | null;
  heightTag: number | null;
  tags: { building: string; amenity: string | null };
  footprint: [number, number][];
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
// Singapore is hottest Apr–Jun; cooling load follows that curve.
const COOLING_SEASON = [0.92, 0.95, 1.02, 1.08, 1.1, 1.07, 1.03, 1.02, 1.0, 0.99, 0.94, 0.9];

/** Deterministic 0..1 pseudo-random from an integer seed (mulberry32). */
function seeded(seed: number) {
  let t = (seed + 0x6d2b79f5) | 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function categorize(b: RawBuilding): BuildingCategory {
  const text = `${b.name ?? ''} ${b.tags.building} ${b.tags.amenity ?? ''}`.toLowerCase();
  // Sports first: "Sport Hall" must not match the residential "Hall N" rule.
  if (/sport|pool|gym|stadium|recreation|swimming/.test(text)) return 'recreation';
  if (/hall|residen|crescent|graduate|dormitor|apartments|hostel/.test(text)) return 'residential';
  if (/administration|admin/.test(text)) return 'admin';
  return 'academic';
}

function heightOf(b: RawBuilding) {
  if (b.heightTag) return b.heightTag;
  if (b.levels) return b.levels * 4;
  return Math.round(10 + seeded(b.osmId) * 20);
}

function centroid(ring: [number, number][]): [number, number] {
  let x = 0;
  let y = 0;
  for (const [lng, lat] of ring) {
    x += lng;
    y += lat;
  }
  return [x / ring.length, y / ring.length];
}

/** Simulated EUI profile: cooling ~55%, equipment ~30%, lighting ~15%. */
function simulateEnergy(osmId: number, category: BuildingCategory): BuildingEnergy {
  const base = { academic: 175, residential: 140, recreation: 210, admin: 165 }[category];
  const annualTarget = base + (seeded(osmId * 7) - 0.5) * 90;
  const monthlyBreakdown: MonthlyEnergy[] = MONTHS.map((month, i) => {
    const m = annualTarget / 12;
    const jitter = 1 + (seeded(osmId * 31 + i) - 0.5) * 0.06;
    const cooling = +(m * 0.55 * COOLING_SEASON[i] * jitter).toFixed(2);
    const equipment = +(m * 0.3 * jitter).toFixed(2);
    const lighting = +(m * 0.15).toFixed(2);
    return { month, cooling, equipment, lighting, total: +(cooling + equipment + lighting).toFixed(2) };
  });
  const annualTotal = Math.round(monthlyBreakdown.reduce((s, m) => s + m.total, 0));
  return { annualTotal, monthlyBreakdown };
}

/** 14m × 14m square around a point, for the energy pillar cores. */
function squareAround([lng, lat]: [number, number], sizeM: number): [number, number][] {
  const half = sizeM / 2;
  const dLat = half / 111320;
  const dLng = half / (111320 * Math.cos((lat * Math.PI) / 180));
  return [
    [lng - dLng, lat - dLat],
    [lng + dLng, lat - dLat],
    [lng + dLng, lat + dLat],
    [lng - dLng, lat + dLat],
    [lng - dLng, lat - dLat],
  ];
}

export function getCampusData() {
  const raw = rawBuildings as RawBuilding[];
  const all = raw.map((b) => {
    const category = categorize(b);
    const height = heightOf(b);
    const [longitude, latitude] = centroid(b.footprint);
    return {
      raw: b,
      building: {
        id: String(b.osmId),
        name: b.name ?? `Building ${b.osmId}`,
        category,
        height,
        floorCount: b.levels ?? Math.max(1, Math.round(height / 4)),
        latitude,
        longitude,
        eui: simulateEnergy(b.osmId, category),
        footprint: b.footprint,
      } satisfies CampusBuilding,
    };
  });

  const named = all.filter((x) => x.raw.name);

  const buildingsGeoJson = {
    type: 'FeatureCollection' as const,
    features: all.map(({ building: b, raw: r }) => ({
      type: 'Feature' as const,
      id: r.osmId,
      geometry: { type: 'Polygon' as const, coordinates: [b.footprint] },
      properties: { id: b.id, name: b.name, named: !!r.name, category: b.category, height: b.height, eui: b.eui.annualTotal },
    })),
  };

  const pillarsGeoJson = {
    type: 'FeatureCollection' as const,
    features: named.map(({ building: b }) => ({
      type: 'Feature' as const,
      geometry: { type: 'Polygon' as const, coordinates: [squareAround([b.longitude, b.latitude], 14)] },
      properties: { id: b.id, name: b.name, height: b.height, eui: b.eui.annualTotal },
    })),
  };

  // Drop raw footprints from the list payload — they already live in buildingsGeoJson.
  const buildings: CampusBuilding[] = named.map(({ building: { footprint: _footprint, ...rest } }) => rest);

  return { buildings, buildingsGeoJson, pillarsGeoJson };
}
