import transitData from '@/data/ntu-transit.json';
import type { ActiveBus, BusLoad, BusStop, CampusRoute, ShuttleServiceStatus, TransitState } from '@/lib/types';

const LTA_API = process.env.LTA_DATAMALL_API ?? 'https://datamall2.mytransport.sg/ltaodataservice';
const POLL_STOPS = ['27011', '27031', '27051', '27061', '27211', '27241', '27261', '27281', '27311'];
const LIVE_SERVICES = new Set(['179', '179A', '179B', '199']);
const CACHE_TTL_MS = 20_000;
const GPS_ERROR_M = 30;

const routes = transitData.routes as CampusRoute[];
const stops = transitData.stops as BusStop[];
const stopNames = new Map(stops.map((s) => [s.code, s.name]));

// ---------- geometry helpers ----------
type LngLat = [number, number];
const toRad = (d: number) => (d * Math.PI) / 180;

function haversine(a: LngLat, b: LngLat) {
  const dLat = toRad(b[1] - a[1]);
  const dLng = toRad(b[0] - a[0]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(h));
}

function bearingOf(a: LngLat, b: LngLat) {
  const y = Math.sin(toRad(b[0] - a[0])) * Math.cos(toRad(b[1]));
  const x = Math.cos(toRad(a[1])) * Math.sin(toRad(b[1])) - Math.sin(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.cos(toRad(b[0] - a[0]));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/** Snap a point onto a route polyline: heading of the nearest segment + distance along the route. */
function snapToRoute(route: CampusRoute | undefined, p: LngLat) {
  if (!route || route.coordinates.length < 2) return { bearing: 0, arcM: 0, routeLengthM: 0 };
  const line = route.coordinates;
  let best = { d: Infinity, bearing: 0, arcM: 0 };
  let arc = 0;
  for (let i = 0; i < line.length - 1; i++) {
    const a = line[i];
    const b = line[i + 1];
    const seg = haversine(a, b);
    // Project p onto segment ab in a local equirectangular frame.
    const kx = Math.cos(toRad(a[1]));
    const abx = (b[0] - a[0]) * kx;
    const aby = b[1] - a[1];
    const apx = (p[0] - a[0]) * kx;
    const apy = p[1] - a[1];
    const len2 = abx * abx + aby * aby;
    const t = len2 > 0 ? Math.max(0, Math.min(1, (apx * abx + apy * aby) / len2)) : 0;
    const proj: LngLat = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    const d = haversine(proj, p);
    if (d < best.d) best = { d, bearing: bearingOf(a, b), arcM: arc + seg * t };
    arc += seg;
  }
  return { bearing: Math.round(best.bearing * 10) / 10, arcM: Math.round(best.arcM), routeLengthM: route.length_m };
}

// ---------- static stops & routes ----------
export function getStopsAndRoutes() {
  return {
    stops: {
      type: 'FeatureCollection' as const,
      features: stops.map((s) => ({
        type: 'Feature' as const,
        geometry: { type: 'Point' as const, coordinates: [s.lng, s.lat] },
        properties: { name: s.code, caption: s.name, LongName: s.name, ShortName: s.name, latitude: s.lat, longitude: s.lng, routes: s.routes },
      })),
    },
    routes: {
      type: 'FeatureCollection' as const,
      features: routes.map(({ coordinates, ...props }) => ({
        type: 'Feature' as const,
        geometry: { type: 'LineString' as const, coordinates },
        properties: props,
      })),
    },
  };
}

// ---------- NTU shuttle schedule (no public live feed) ----------
function sgtNow() {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Singapore', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return { weekend: ['Sat', 'Sun'].includes(get('weekday')), minutes: Number(get('hour')) * 60 + Number(get('minute')) };
}

export function getShuttleStatus(): ShuttleServiceStatus[] {
  const { weekend, minutes } = sgtNow();
  const within = (start: number, end: number) => minutes >= start && minutes < end;
  const meta = new Map(routes.map((r) => [r.route, r]));
  const schedule = [
    { route: 'CL-R', start: weekend ? 480 : 450, end: 1380, runs: true, hours: 'Mon–Fri 07:30–23:00 · Sat/Sun/PH 08:00–23:00' },
    { route: 'CL-B', start: weekend ? 480 : 450, end: 1380, runs: true, hours: 'Mon–Fri 07:30–23:00 · Sat/Sun/PH 08:00–23:00' },
    { route: 'CR', start: 450, end: 1380, runs: !weekend, hours: 'Mon–Fri 07:30–23:00' },
    { route: 'CWR', start: 450, end: 1380, runs: weekend, hours: 'Sat/Sun/PH 07:30–23:00' },
  ];
  return schedule.map((s) => ({
    route: s.route,
    name: meta.get(s.route)?.name ?? s.route,
    color: meta.get(s.route)?.color ?? '#94a3b8',
    inService: s.runs && within(s.start, s.end),
    hours: s.hours,
  }));
}

// ---------- LTA DataMall live buses ----------
interface LtaNextBus {
  EstimatedArrival: string;
  Monitored: number;
  Latitude: string;
  Longitude: string;
  Load: string;
  Type: string;
}
interface LtaArrival {
  BusStopCode: string;
  Services: { ServiceNo: string; NextBus: LtaNextBus; NextBus2: LtaNextBus; NextBus3: LtaNextBus }[];
}

let cache: { at: number; state: TransitState } | null = null;

async function fetchStop(code: string, key: string): Promise<LtaArrival | null> {
  try {
    const res = await fetch(`${LTA_API}/v3/BusArrival?BusStopCode=${code}`, {
      headers: { AccountKey: key, accept: 'application/json' },
      cache: 'no-store',
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    return (await res.json()) as LtaArrival;
  } catch {
    return null;
  }
}

export async function getLiveTransit(): Promise<TransitState> {
  const now = Date.now();
  if (cache && now - cache.at < CACHE_TTL_MS) return { ...cache.state, shuttles: getShuttleStatus() };

  const key = process.env.LTA_ACCOUNT_KEY;
  if (!key) {
    return { asOf: new Date(now).toISOString(), upstreamLastUpdated: null, stale: true, estimated: false, buses: [], shuttles: getShuttleStatus() };
  }

  const results = await Promise.all(POLL_STOPS.map((c) => fetchStop(c, key)));
  const ok = results.filter((r): r is LtaArrival => r !== null);
  if (ok.length === 0 && cache) return { ...cache.state, stale: true, shuttles: getShuttleStatus() };

  const routeByService = new Map(routes.map((r) => [r.route, r]));
  const byBus = new Map<string, ActiveBus>();
  for (const arrival of ok) {
    for (const svc of arrival.Services) {
      if (!LIVE_SERVICES.has(svc.ServiceNo)) continue;
      for (const nb of [svc.NextBus, svc.NextBus2, svc.NextBus3]) {
        if (!nb || nb.Monitored !== 1) continue;
        const lat = Number.parseFloat(nb.Latitude);
        const lng = Number.parseFloat(nb.Longitude);
        if (!lat || !lng) continue;
        const etaMin = Math.max(0, Math.round((Date.parse(nb.EstimatedArrival) - now) / 60000));
        const id = `${svc.ServiceNo}|${lat.toFixed(5)}|${lng.toFixed(5)}`;
        const existing = byBus.get(id);
        if (existing && existing.anchorEtaMin <= etaMin) continue;
        const baseRoute = routeByService.get(svc.ServiceNo.replace(/[A-Z]$/, ''));
        byBus.set(id, {
          id,
          route: svc.ServiceNo,
          plate: null,
          tripStart: null,
          status: 'IN_SERVICE',
          lat,
          lng,
          ...snapToRoute(baseRoute, [lng, lat]),
          speedKmh: null,
          prevStop: null,
          anchorStop: stopNames.get(arrival.BusStopCode) ?? arrival.BusStopCode,
          anchorEtaMin: etaMin,
          segmentFraction: null,
          errorBoundM: GPS_ERROR_M,
          load: (['SEA', 'SDA', 'LSD'].includes(nb.Load) ? nb.Load : null) as BusLoad | null,
          busType: nb.Type || null,
          occupancy: { ridership: null, capacity: null },
        });
      }
    }
  }

  const state: TransitState = {
    asOf: new Date(now).toISOString(),
    upstreamLastUpdated: new Date(now).toISOString(),
    stale: ok.length < POLL_STOPS.length / 2,
    estimated: false,
    buses: [...byBus.values()],
    shuttles: getShuttleStatus(),
  };
  cache = { at: now, state };
  return state;
}
