import facilitiesData from '@/data/ntu-facilities.json';
import type { EnvironmentState, FacilityStatus, LightningStrike, PsiBand } from '@/lib/types';

const DATA_GOV = 'https://api-open.data.gov.sg/v2/real-time/api';
const CACHE_TTL_MS = 60_000;
const NTU: [number, number] = [103.6835, 1.3455];
const MAP_RADIUS_KM = 30;
const MAX_STRIKES = 500;

/**
 * Closure rules.
 * - Haze (NTU OFFICIAL): "Outdoor and non-air-conditioned sports facilities close when the
 *   24-hour PSI is above 200" — https://www.ntu.edu.sg/life-at-ntu/health-and-safety/ntu-haze-response-guidelines
 * - Rain (NTU OFFICIAL wording, no threshold): SRC asks users to stop outdoor play "when it is raining"
 *   and to evacuate the pool during "inclement weather". We treat any rainfall at NEA station S44
 *   (Nanyang Avenue, on campus) in the latest 5-min reading as raining.
 *   https://www.ntu.edu.sg/life-at-ntu/recreational-spaces-facilities/sports-recreation-centre/eligibility-usage
 * - Lightning (REFERENCE): NTU relies on its own lightning siren and gives no distance/time. We
 *   approximate it with the common 30-minute / 8 km practice using NEA lightning detections.
 */
export const RULES = {
  hazeOutdoorPsi: 200,
  rainStationId: 'S44',
  lightningRadiusKm: 8,
  lightningWindowMin: 30,
};

interface RawFacility {
  osmId: string;
  name: string;
  kind: 'pool' | 'outdoor' | 'indoor';
  sport: string | null;
  footprint: [number, number][];
}
const facilities = facilitiesData as RawFacility[];

function centroid(ring: [number, number][]): [number, number] {
  const n = ring.length;
  return [ring.reduce((s, p) => s + p[0], 0) / n, ring.reduce((s, p) => s + p[1], 0) / n];
}

function distanceKm(a: [number, number], b: [number, number]) {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b[1] - a[1]);
  const dLng = toRad(b[0] - a[0]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

/** NEA PSI descriptor bands. */
export function psiBand(psi: number | null): PsiBand {
  if (psi === null) return { label: 'Unknown', color: '#64748b', advice: 'PSI data unavailable.' };
  if (psi <= 50) return { label: 'Good', color: '#22c55e', advice: 'Normal activities.' };
  if (psi <= 100) return { label: 'Moderate', color: '#3b82f6', advice: 'Normal activities.' };
  if (psi <= 200) return { label: 'Unhealthy', color: '#eab308', advice: 'Reduce prolonged or strenuous outdoor exertion.' };
  if (psi <= 300) return { label: 'Very Unhealthy', color: '#f97316', advice: 'Avoid prolonged or strenuous outdoor exertion.' };
  return { label: 'Hazardous', color: '#ef4444', advice: 'Minimise outdoor activity.' };
}

async function getJson(url: string) {
  // data.gov.sg rate-limits anonymous bursts (HTTP 429); an optional free API key raises the limit.
  const key = process.env.DATA_GOV_API_KEY;
  const res = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(8000), headers: key ? { 'x-api-key': key } : undefined });
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  return res.json();
}

async function fetchAirQuality() {
  const [psi, pm25] = await Promise.all([getJson(`${DATA_GOV}/psi`), getJson(`${DATA_GOV}/pm25`)]);
  const psiItem = psi.data.items[0];
  const pmItem = pm25.data.items[0];
  return {
    // NTU is in NEA's "west" region.
    psi24h: (psiItem?.readings?.psi_twenty_four_hourly?.west as number | undefined) ?? null,
    pm25OneHour: (pmItem?.readings?.pm25_one_hourly?.west as number | undefined) ?? null,
    updatedAt: (psiItem?.updatedTimestamp as string | undefined) ?? null,
  };
}

/** Latest 5-minute rainfall at the on-campus NEA gauge. */
async function fetchCampusRain(): Promise<number | null> {
  const json = await getJson(`${DATA_GOV}/rainfall`);
  const reading = json.data.readings?.[0]?.data?.find((r: { stationId: string }) => r.stationId === RULES.rainStationId);
  return typeof reading?.value === 'number' ? reading.value : null;
}

async function fetchLightning(now: number): Promise<LightningStrike[]> {
  // With `date`, the API returns ~25 two-minute records ending at that time (~48 min).
  const sgt = new Date(now + 8 * 3600_000).toISOString().slice(0, 19);
  const json = await getJson(`${DATA_GOV}/weather?api=lightning&date=${sgt}`);
  const since = now - RULES.lightningWindowMin * 60_000;
  const strikes: LightningStrike[] = [];
  for (const record of json.data.records ?? []) {
    for (const r of record.item?.readings ?? []) {
      const t = Date.parse(r.datetime);
      if (t < since) continue;
      if (distanceKm(NTU, [Number(r.location.longitude), Number(r.location.latitude)]) > MAP_RADIUS_KM) continue;
      strikes.push({ lat: Number(r.location.latitude), lng: Number(r.location.longitude), type: r.type === 'G' ? 'G' : 'C', datetime: r.datetime });
    }
  }
  return strikes;
}

function facilityStatuses(psi24h: number | null, rainMm: number | null, strikes: LightningStrike[]): FacilityStatus[] {
  return facilities.map((f) => {
    const center = centroid(f.footprint);
    const nearest = strikes.reduce((min, s) => Math.min(min, distanceKm(center, [s.lng, s.lat])), Infinity);
    const reasons: string[] = [];
    if (f.kind !== 'indoor') {
      if (psi24h !== null && psi24h > RULES.hazeOutdoorPsi) reasons.push(`Haze: 24-hr PSI ${psi24h} > ${RULES.hazeOutdoorPsi} (NTU rule)`);
      if (rainMm !== null && rainMm > 0) reasons.push(`Raining on campus: ${rainMm} mm in last 5 min (NTU rule)`);
      if (nearest <= RULES.lightningRadiusKm) reasons.push(`Lightning ${nearest.toFixed(1)} km away in last ${RULES.lightningWindowMin} min (reference)`);
    }
    return {
      id: f.osmId,
      name: f.name,
      kind: f.kind,
      longitude: center[0],
      latitude: center[1],
      // Without air-quality data we cannot say the facility is open.
      status: reasons.length > 0 ? 'closed' : psi24h === null ? 'unknown' : 'open',
      reasons,
    };
  });
}

export function getFacilitiesGeoJson() {
  return {
    type: 'FeatureCollection' as const,
    features: facilities.map((f) => ({
      type: 'Feature' as const,
      geometry: { type: 'Polygon' as const, coordinates: [f.footprint] },
      properties: { id: f.osmId, name: f.name, kind: f.kind },
    })),
  };
}

let cache: { at: number; state: EnvironmentState } | null = null;

// Last successful reading per source, reused (flagged stale) when a request fails.
const STALE_LIMIT_MS = 30 * 60_000;
const lastGood = new Map<string, { at: number; value: unknown }>();

function settle<T>(key: string, result: PromiseSettledResult<T>, now: number): { value: T | null; ok: boolean; stale: boolean } {
  if (result.status === 'fulfilled') {
    lastGood.set(key, { at: now, value: result.value });
    return { value: result.value, ok: true, stale: false };
  }
  const prev = lastGood.get(key);
  if (prev && now - prev.at < STALE_LIMIT_MS) return { value: prev.value as T, ok: true, stale: true };
  return { value: null, ok: false, stale: false };
}

export async function getEnvironment(): Promise<EnvironmentState> {
  const now = Date.now();
  if (cache && now - cache.at < CACHE_TTL_MS) return cache.state;

  const [air, lightning, rain] = await Promise.allSettled([fetchAirQuality(), fetchLightning(now), fetchCampusRain()]);
  const airR = settle('air', air, now);
  const lightningR = settle('lightning', lightning, now);
  const rainR = settle('rain', rain, now);
  const airValue = airR.value ?? { psi24h: null, pm25OneHour: null, updatedAt: null };
  const strikes = lightningR.value ?? [];
  const rainMm = rainR.value ?? null;

  const state: EnvironmentState = {
    asOf: new Date(now).toISOString(),
    region: 'west',
    psi24h: airValue.psi24h,
    pm25OneHour: airValue.pm25OneHour,
    airUpdatedAt: airValue.updatedAt,
    band: psiBand(airValue.psi24h),
    // A big storm can produce >10k strikes in 30 min; closures use all of them, the map only the latest few hundred.
    lightning: [...strikes].sort((a, b) => b.datetime.localeCompare(a.datetime)).slice(0, MAX_STRIKES),
    lightningTotal: strikes.length,
    lightningOk: lightningR.ok,
    airOk: airR.ok,
    stale: airR.stale || lightningR.stale || rainR.stale,
    rules: RULES,
    rainMm,
    facilities: facilityStatuses(airValue.psi24h, rainMm, strikes),
  };
  cache = { at: now, state };
  return state;
}
