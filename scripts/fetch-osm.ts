/**
 * One-off snapshot of NTU campus geodata from OpenStreetMap (Overpass API).
 * Overpass is rate-limited and flaky (502/504), so the app never calls it at
 * request time — it reads the JSON files this script writes into `data/`.
 *
 *   npx tsx scripts/fetch-osm.ts
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const OVERPASS = 'https://overpass-api.de/api/interpreter';
const NTU_CAMPUS_WAY = 115105262; // OSM amenity=university boundary of NTU
const ROUTES: Record<string, { relationId: number; name: string; kind: 'ntu-shuttle' | 'public'; color: string }> = {
  'CL-R': { relationId: 2571769, name: 'Campus Loop - Red', kind: 'ntu-shuttle', color: '#EF4444' },
  'CL-B': { relationId: 2571810, name: 'Campus Loop - Blue', kind: 'ntu-shuttle', color: '#3B82F6' },
  CR: { relationId: 2571820, name: 'Campus Rider (Green)', kind: 'ntu-shuttle', color: '#22C55E' },
  CWR: { relationId: 19791593, name: 'Campus Weekend Rider (Brown)', kind: 'ntu-shuttle', color: '#B45309' },
  '179': { relationId: 1155343, name: 'Svc 179 (Boon Lay Int ↺ Nanyang Dr)', kind: 'public', color: '#F59E0B' },
  '199': { relationId: 1157111, name: 'Svc 199 (Boon Lay Int ↺ Nanyang Cres)', kind: 'public', color: '#A855F7' },
};

type LngLat = [number, number];
const round = (n: number) => Math.round(n * 1e6) / 1e6;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function overpass(query: string): Promise<any> {
  const url = `${OVERPASS}?data=${encodeURIComponent(query)}`;
  for (let attempt = 1; attempt <= 8; attempt++) {
    const res = await fetch(url, { headers: { 'User-Agent': 'ntu-digital-twin/0.1 (student project)' } });
    if (res.ok) return res.json();
    console.warn(`  Overpass HTTP ${res.status}, retry ${attempt}/8`);
    await sleep(5000 * attempt);
  }
  throw new Error('Overpass failed after 8 attempts');
}

function haversine(a: LngLat, b: LngLat) {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b[1] - a[1]);
  const dLng = toRad(b[0] - a[0]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Join relation member ways into one ordered polyline, flipping ways as needed. */
function stitch(ways: LngLat[][]): LngLat[] {
  const same = (a: LngLat, b: LngLat) => a[0] === b[0] && a[1] === b[1];
  const line: LngLat[] = [];
  for (let i = 0; i < ways.length; i++) {
    let w = ways[i];
    if (line.length === 0) {
      // Orient the first way so its end touches the second way.
      const next = ways[1];
      if (next && !same(w[w.length - 1], next[0]) && !same(w[w.length - 1], next[next.length - 1])) w = [...w].reverse();
      line.push(...w);
      continue;
    }
    const end = line[line.length - 1];
    if (same(w[w.length - 1], end) || haversine(w[w.length - 1], end) < haversine(w[0], end)) w = [...w].reverse();
    line.push(...(same(w[0], end) ? w.slice(1) : w));
  }
  return line;
}

function nearestArc(line: LngLat[], p: LngLat) {
  let best = { d: Infinity, arc: 0 };
  let arc = 0;
  for (let i = 0; i < line.length; i++) {
    const d = haversine(line[i], p);
    if (d < best.d) best = { d, arc };
    if (i < line.length - 1) arc += haversine(line[i], line[i + 1]);
  }
  return Math.round(best.arc);
}

async function main() {
  mkdirSync(join(process.cwd(), 'data'), { recursive: true });

  // `--only=buildings,facilities,transit` refetches a subset (Overpass is flaky; no need to redo everything).
  const onlyArg = process.argv.find((a) => a.startsWith('--only='));
  const only = new Set(onlyArg ? onlyArg.slice(7).split(',') : ['buildings', 'facilities', 'transit']);

  if (only.has('buildings')) await fetchBuildings();
  if (only.has('facilities')) await fetchFacilities();
  if (only.has('transit')) await fetchTransit();
}

async function fetchBuildings() {
  console.log('Fetching buildings…');
  // Only buildings inside NTU's campus boundary (excludes the neighbouring Jurong West HDB estate).
  const b = await overpass(`[out:json][timeout:90];way(${NTU_CAMPUS_WAY});map_to_area->.ntu;way["building"](area.ntu);out geom tags;`);
  const buildings = b.elements
    .filter((e: any) => e.geometry?.length >= 3)
    .map((e: any) => ({
      osmId: e.id,
      name: e.tags.name ?? null,
      levels: e.tags['building:levels'] ? Number.parseFloat(e.tags['building:levels']) || null : null,
      heightTag: e.tags.height ? Number.parseFloat(e.tags.height) || null : null,
      tags: { building: e.tags.building ?? 'yes', amenity: e.tags.amenity ?? null },
      footprint: e.geometry.map((g: any) => [round(g.lon), round(g.lat)]),
    }));
  writeFileSync('data/ntu-buildings.json', JSON.stringify(buildings));
  console.log(`  ${buildings.length} buildings (${buildings.filter((x: any) => x.name).length} named)`);
}

const SPORT_LABEL: Record<string, string> = {
  swimming: 'Swimming pool',
  tennis: 'Tennis courts',
  basketball: 'Basketball court',
  soccer: 'Football pitch',
  running: 'Running track',
};

/** Pools, pitches, tracks and sports halls — used for haze / lightning closure advisories. */
async function fetchFacilities() {
  console.log('Fetching sports facilities…');
  const f = await overpass(
    `[out:json][timeout:90];way(${NTU_CAMPUS_WAY});map_to_area->.ntu;nwr["leisure"~"^(swimming_pool|sports_centre|pitch|track|stadium)$"](area.ntu);out geom tags;`,
  );
  const facilities = f.elements
    .map((e: any) => {
      // Relations (e.g. the SRC stadium field) — use their first outer ring.
      const geom = e.type === 'relation' ? e.members?.find((m: any) => m.role === 'outer' && m.geometry)?.geometry : e.geometry;
      if (!geom || geom.length < 4) return null;
      // Running tracks are often mapped as open lines, not areas — skip anything that isn't a closed ring.
      const first = geom[0];
      const last = geom[geom.length - 1];
      if (first.lat !== last.lat || first.lon !== last.lon) return null;
      const t = e.tags ?? {};
      const isPool = t.leisure === 'swimming_pool' || t.sport === 'swimming';
      const indoor = t.indoor === 'yes' || t.covered === 'yes' || (t.leisure === 'sports_centre' && !isPool);
      const kind = isPool ? 'pool' : indoor ? 'indoor' : 'outdoor';
      const name =
        t.name ?? (t.leisure === 'sports_centre' && isPool ? 'NTU Swimming Complex' : SPORT_LABEL[t.sport] ?? (t.leisure === 'track' ? 'Running track' : 'Sports pitch'));
      return { osmId: `${e.type}/${e.id}`, name, kind, sport: t.sport ?? null, footprint: geom.map((g: any) => [round(g.lon), round(g.lat)]) };
    })
    .filter(Boolean);
  writeFileSync('data/ntu-facilities.json', JSON.stringify(facilities));
  const count = (k: string) => facilities.filter((x: any) => x.kind === k).length;
  console.log(`  ${facilities.length} facilities (${count('pool')} pool, ${count('outdoor')} outdoor, ${count('indoor')} indoor)`);
}

async function fetchTransit() {
  const routes: any[] = [];
  const stopMap = new Map<string, any>();
  for (const [ref, meta] of Object.entries(ROUTES)) {
    console.log(`Fetching route ${ref}…`);
    await sleep(1500);
    const r = await overpass(`[out:json][timeout:90];rel(${meta.relationId});out geom;node(r);out tags;`);
    const rel = r.elements.find((e: any) => e.type === 'relation');
    const nodeTags = new Map<number, any>(r.elements.filter((e: any) => e.type === 'node').map((e: any) => [e.id, e.tags ?? {}]));
    const ways = rel.members
      .filter((m: any) => m.type === 'way' && m.role === '' && m.geometry)
      .map((m: any) => m.geometry.map((g: any) => [round(g.lon), round(g.lat)] as LngLat));
    const coords = stitch(ways);
    let length = 0;
    for (let i = 0; i < coords.length - 1; i++) length += haversine(coords[i], coords[i + 1]);

    const routeStops = rel.members
      .filter((m: any) => m.type === 'node' && /^(stop|platform)/.test(m.role))
      .map((m: any, seq: number) => {
        const tags = nodeTags.get(m.ref) ?? {};
        const code = tags.ref ? String(tags.ref) : `osm-${m.ref}`;
        const pos: LngLat = [round(m.lon), round(m.lat)];
        const existing = stopMap.get(code);
        if (existing) {
          if (!existing.routes.includes(ref)) existing.routes.push(ref);
        } else {
          stopMap.set(code, { code, name: tags.name ?? code, lng: pos[0], lat: pos[1], routes: [ref] });
        }
        return { code, arc_m: nearestArc(coords, pos), seq };
      });

    const first = coords[0];
    const last = coords[coords.length - 1];
    routes.push({
      route: ref,
      name: meta.name,
      kind: meta.kind,
      color: meta.color,
      length_m: Math.round(length),
      closed: haversine(first, last) < 150,
      stops: routeStops,
      coordinates: coords,
    });
    console.log(`  ${ref}: ${ways.length} ways → ${coords.length} pts, ${Math.round(length)} m, ${routeStops.length} stops`);
  }

  writeFileSync('data/ntu-transit.json', JSON.stringify({ fetchedAt: new Date().toISOString(), routes, stops: [...stopMap.values()] }));
  console.log(`Wrote data/ntu-transit.json (${routes.length} routes, ${stopMap.size} stops)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
