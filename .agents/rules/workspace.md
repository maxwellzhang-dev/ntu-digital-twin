# NTU 3D Digital Twin & Transit Tracker Rules

## Technology Stack & Architectural Conventions
- Framework: Next.js 16 App Router with TypeScript and Tailwind CSS (scaffolded with `cacheComponents: true`).
- Map Engine: MapLibre GL JS v6 (`maplibre-gl`). Always import `maplibre-gl/dist/maplibre-gl.css`. v6 pitfalls:
  - No default export: use `import * as maplibregl from 'maplibre-gl'`.
  - Turbopack bundling breaks the worker's relative URL ("Worker failed to load"). The `postinstall` script copies `node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs` to `public/`; call `maplibregl.setWorkerUrl('/maplibre-gl-worker.mjs')` before creating a map.
  - MapLibre sets `position: relative` on its container, overriding Tailwind `absolute inset-0` (map height 0). Put the absolute sizing on a wrapper div and give the container `h-full w-full`.
- Basemap: OpenFreeMap Dark Mode vector style (`https://tiles.openfreemap.org/styles/dark`). 100% free, open CORS, zero API keys, zero rate limits, and zero watermarks. Do NOT use Carto or Mapbox tile URLs.
- 3D Rendering: Three.js (`three`) for custom 3D vehicle models, lighting, and spatial calculations.

## Next.js 16 Cache Components Rules
- `cacheComponents` is enabled. Route segment configs `export const revalidate`, `export const dynamic` and `fetchCache` are FORBIDDEN (they error at build). Before writing Next.js code, read the relevant guide in `node_modules/next/dist/docs/`.
- To cache data in a route handler, extract a helper function containing `'use cache'` + `cacheLife('hours')` (from `next/cache`). `'use cache'` cannot be placed directly inside a route handler body.
- Live data (LTA bus arrivals) must NOT be wrapped in `'use cache'`; it runs at request time. Throttle upstream calls with a module-level in-memory cache (20 s TTL).

## Client-Side Isolation & WebGL Zero-SSR Rule
- Mandatory Client-Only Map Import: MapLibre GL and Three.js access browser-only globals (`window`, `document`, `WebGLRenderingContext`). In `app/page.tsx`, you MUST import `MapCanvas` exclusively via Next.js dynamic client import with `{ ssr: false }`:
  `const MapCanvas = dynamic(() => import('@/components/MapCanvas'), { ssr: false });`
  NEVER import `maplibre-gl` or Three.js in any server component or code evaluated during server-side rendering.

## Payload Size & Data Ingestion Hygiene (< 128 kB)
- Client-Side Data Fetching: `app/page.tsx` must be a client component (`'use client'`). Do NOT fetch buildings on the server during page SSR. Fetch buildings (`/api/buildings`), stops/routes (`/api/transit/stops`) and live transit (`/api/transit/buses`) inside `useEffect()` on the client side.
- Route Handler Payload Pruning: In `/api/buildings`, omit raw polygon `footprint` coordinate arrays from the `buildings` array (since footprints are already in `buildingsGeoJson`), but preserve the full nested `eui: { annualTotal, monthlyBreakdown }` object on every building record so client components (`app/page.tsx`, `CampusEnergyChart`, `BuildingEnergyModal`) never fail when reading `.annualTotal` or `.monthlyBreakdown`.

## Geospatial Anchors & NTU Campus Coordinates
- NTU Yunnan Garden Campus Center: `[103.6835, 1.3455]` (Longitude, Latitude).
- Campus Bounding Box: `[103.6750, 1.3380, 103.6930, 1.3600]`.
- Default Camera: Pitch `60`, Bearing `-20`, Zoom `16.0`.
- Key Landmark Coordinates:
  - The Hive: `[103.6827, 1.3432]`, Pitch: 65, Bearing: 30
  - North Spine: `[103.6809, 1.3464]`, Pitch: 60, Bearing: -30
  - NTU Administration Building: `[103.6810, 1.3445]`, Pitch: 55, Bearing: 10
  - The Arc (Learning Hub North): `[103.6816, 1.3476]`, Pitch: 60, Bearing: 45
  - Pioneer MRT Station: `[103.6974, 1.3376]`, Pitch: 60, Bearing: -60

## API Contracts & Data Integration
1. NTU Campus Geodata (OpenStreetMap snapshot) — replaces the NUS Digital Twin API.
   - Source: OSM Overpass API (`https://overpass-api.de/api/interpreter`). Overpass is rate-limited and often returns 502/504, so the app NEVER calls it at request time. `scripts/fetch-osm.ts` (run with `npx tsx scripts/fetch-osm.ts`) downloads a snapshot once into `data/`, with retries (GET requests, a `User-Agent` header, 3 attempts with back-off). The snapshot files are committed.
   - `data/ntu-buildings.json`: array of `{ osmId, name | null, levels | null, heightTag | null, tags: { building, amenity }, footprint: [lng, lat][] }` for every `way["building"]` inside the campus bounding box (coordinates rounded to 6 decimals).
   - `data/ntu-transit.json`: `{ routes: [...], stops: [...] }` built from OSM route relations: NTU shuttles `CL-R` (2571769), `CL-B` (2571810), `CR` (2571820), `CWR` (19791593) and LTA public services `179` (1155343), `199` (1157111). Member ways are stitched into a single ordered `LineString` per route (flip a way when its last node does not touch the previous way's end). Stop members (`stop` / `platform*` roles) are resolved to `{ code, name, lat, lng }`, where `code` = the node's LTA `ref` tag if present, else `osm-<nodeId>`.
   - Procedural Enrichment in `lib/digitaltwin.ts`: height = `heightTag` if present, else `levels * 4 m`, else a deterministic 10–30 m value hashed from `osmId`. `floorCount` = `levels` or `round(height / 4)`. `category` (`academic` | `residential` | `recreation` | `admin`) from name/tags (Hall/Residence/Crescent/Graduate → residential; Sports/Pool/Gym/Stadium → recreation; Administration/Admin → admin; else academic). EUI is SIMULATED (no public NTU energy data exists): deterministic per `osmId`, a nested `eui: { annualTotal, monthlyBreakdown }` object (`cooling` ~55%, `equipment` ~30%, `lighting` ~15% in kWh/m²). The UI must label energy figures as "simulated".
   - Only named buildings appear in `buildings` (energy chart + pillars); all footprints are extruded in `buildingsGeoJson`.
2. LTA DataMall Bus Arrival API v3 — replaces the NUS Live Transit Proxy for live vehicles.
   - Endpoint: `${LTA_DATAMALL_API}/v3/BusArrival?BusStopCode=<code>`, header `AccountKey: ${LTA_ACCOUNT_KEY}` (server-side only; never expose the key to the client).
   - Response: `{ BusStopCode, Services: [{ ServiceNo, Operator, NextBus, NextBus2, NextBus3 }] }`. Each `NextBus*` has `{ EstimatedArrival (ISO +08:00), Monitored (1 = live GPS), Latitude, Longitude (strings, "0.0" when unmonitored), Load: 'SEA' | 'SDA' | 'LSD', Feature, Type: 'SD' | 'DD' | 'BD' }`.
   - Poll stops (inside campus): `27011, 27031, 27051, 27061, 27211, 27241, 27261, 27281, 27311`. Keep services `179`, `179A`, `179B`, `199`. Use only entries with `Monitored === 1` and non-zero coordinates. The same physical bus appears at several stops with identical coordinates: dedupe by `ServiceNo + lat.toFixed(5) + lng.toFixed(5)`, keeping the smallest ETA as the anchor stop.
   - `/api/transit/buses` returns the SAME shape as the original NUS workshop: `{ asOf, upstreamLastUpdated, stale, estimated: false, buses: [...] }` where each bus has `{ id, route, plate: null, tripStart: null, status: 'IN_SERVICE', lat, lng, bearing, speedKmh: null, arcM, routeLengthM, prevStop: null, anchorStop, anchorEtaMin, segmentFraction: null, errorBoundM: 30, load, busType, occupancy: { ridership: null, capacity: null } }`. `bearing` = direction of the nearest segment of that service's route polyline; `arcM` = distance along it. Positions are real LTA GPS fixes (label them "Live GPS (LTA)"), not estimates; `errorBoundM` is the nominal GPS accuracy.
   - `/api/transit/stops` returns `{ stops: FeatureCollection<Point>, routes: FeatureCollection<LineString> }` from `data/ntu-transit.json`. Stop properties: `{ name: code, caption, LongName, ShortName, latitude, longitude, routes: string[] }`. Route properties: `{ route, name, kind: 'ntu-shuttle' | 'public', length_m, closed, color, stops: Array<{ code, arc_m, seq }> }`.
   - Route colors: CL-R `#EF4444`, CL-B `#3B82F6`, CR `#22C55E`, CWR `#B45309`, 179 `#F59E0B`, 199 `#A855F7`.
3. NTU Internal Campus Shuttles (CL-R, CL-B, CR, CWR) have NO public live feed (the NTU Omnibus app uses an internal fleet system). Show their routes and stops, plus a schedule-based "in service now?" badge from the official timetable (https://www.ntu.edu.sg/about-us/visiting-ntu/internal-campus-shuttle):
   - CL-R / CL-B: Mon–Fri 07:30–23:00, Sat/Sun/PH 08:00–23:00.
   - CR: Mon–Fri 07:30–23:00. CWR: Sat/Sun/PH 07:30–23:00.
   - Do not draw fake shuttle vehicles.
   - Off-Service Handling: When the `buses` array is empty (LTA services run roughly 05:30–00:30), display a scheduled-resumption notice. Do not run synthetic fake wandering simulations.
4. NEA Air Quality & Lightning (data.gov.sg real-time APIs, no key) — haze & storm awareness.
   - PSI: `https://api-open.data.gov.sg/v2/real-time/api/psi` → `data.items[0].readings.psi_twenty_four_hourly.west` (NTU is in the **west** region).
   - PM2.5: `https://api-open.data.gov.sg/v2/real-time/api/pm25` → `data.items[0].readings.pm25_one_hourly.west`.
   - Lightning: `https://api-open.data.gov.sg/v2/real-time/api/weather?api=lightning&date=<SGT YYYY-MM-DDTHH:mm:ss>` → ~25 two-minute `data.records[]`, each `item.readings[]` = `{ location: { latitude, longitude } (strings), type: 'C' | 'G', text, datetime }`.
   - `lib/environment.ts` caches for 60 s in memory. Closures are computed from ALL strikes in the window; only the latest 500 within 30 km are sent to the client (a single storm can exceed 10 000 strikes).
   - PSI bands (NEA): ≤50 Good, ≤100 Moderate, ≤200 Unhealthy, ≤300 Very Unhealthy, >300 Hazardous.
5. NTU Sports Facilities (OSM snapshot `data/ntu-facilities.json`, fetched by `scripts/fetch-osm.ts --only=facilities`): `leisure=swimming_pool|sports_centre|pitch|track|stadium` inside the campus boundary, closed rings only (open-line running tracks are skipped). `kind` = `pool` | `outdoor` | `indoor`.
   - Facility status (`'open' | 'closed' | 'unknown'`) is an advisory computed in `RULES` in `lib/environment.ts`. Rain uses NEA station S44 (Nanyang Avenue, on campus) via `https://api-open.data.gov.sg/v2/real-time/api/rainfall`.
     - Haze — **NTU official** (NTU Haze Response Guidelines): outdoor & non-air-conditioned sports facilities close when 24-hr PSI > 200. Indoor air-conditioned halls stay open.
     - Rain — **NTU official wording** (SRC Eligibility & Usage: stop outdoor play "when it is raining", evacuate the pool in "inclement weather"): any rain > 0 mm at S44 in the latest 5-min reading → pools & outdoor closed.
     - Lightning — **reference only** (NTU uses its own siren, no distance/time published): any strike within 8 km in the last 30 min → pools & outdoor closed.
     - If air-quality data has never loaded, status is `unknown` (never claim "open" without data). On HTTP 429, reuse the last good reading (< 30 min) and flag `stale`.
   - Every UI surface showing a status must label which rules are NTU official vs reference, and say lifeguards / SRC notices have the final say.

## 3D Rendering & WebGL Conventions
- 3D Building Extrusions (`campus-3d-buildings`): Extruded physical footprints based on building height, colored by muted category tones (#5b8db8 academic, #8f7cc0 residential, #4fa58a recreation, #c49a4a admin), opacity 0.92, `fill-extrusion-vertical-gradient: true`, lit by `map.setLight({ anchor: 'map', position: [1.4, 210, 35], color: '#fff4e0', intensity: 0.45 })`. Named buildings get a `campus-building-labels` symbol layer from zoom 16.4.
- Layer toggles (`components/LayerToggles.tsx`): Real 3D, Satellite, Buildings, Transit, Facilities, Haze, Energy. Turning Satellite on switches Buildings (`campus-3d-buildings` + `campus-building-labels`) off by default, and turning it off switches them back on; the Buildings button overrides either way. Buildings is disabled in Real 3D, where Google's mesh replaces our models. Energy pillars are hidden by default (they clutter the campus view) and switch on when a building is picked from the energy chart.
- Satellite (`satellite`): Esri World Imagery raster (`https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}`, attribution "Imagery © Esri, Maxar, Earthstar Geographics") inserted before the basemap's first `symbol` layer so road/place labels stay on top.
- Real 3D (`lib/photorealistic.ts`): Google Photorealistic 3D Tiles (`https://tile.googleapis.com/v1/3dtiles/root.json`, header `X-GOOG-API-KEY: NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`) in a deck.gl `Tile3DLayer` with `operation: 'terrain+draw'`, mounted through a non-interleaved `MapboxOverlay`. Routes, stops, facilities and lightning are deck.gl layers with `_TerrainExtension` so they drape onto the mesh. Buses stay 3D: the same white-body / orange-roof box bus (12 m × 2.5 scale) built from `SimpleMeshLayer` + `CubeGeometry` parts, `getOrientation: [0, -bearing, 0]`, lifted onto the mesh with `terrainDrawMode: 'offset'`; service-number labels use `parameters: { depthCompare: 'always' }` so the mesh never hides them; the MapLibre extrusions/labels/Three.js buses are hidden in this mode. Google policy: show "Google" plus the per-viewport `gltf.asset.copyright` credits in their own box, never mixed with other attributions; never cache or store tiles. The toggle is disabled when the key is missing. deck.gl's canvas is mounted inside MapLibre's control container (`z-index: 2`), so every HUD element, the haze overlay and the Google attribution need an explicit higher z-index.
- Haze rendering: there is no terrain, so MapLibre fog alone is not visible. Combine `map.setSky()` (brown-grey horizon) with a CSS gradient overlay above the canvas — dense at the top (far distance in a pitched view), thin at the bottom — whose opacity = `clamp((psi24h - 50) / 250, 0, 1)`.
- Facilities (`campus-facilities`): 0.6 m extrusions, cyan pools / green outdoor when open, red when the advisory says closed; indoor halls are not drawn (their outlines cover the pools). Lightning strikes (`lightning`): yellow blurred circles, larger for cloud-to-ground.
- 3D Energy Pillars (`campus-energy-pillars`): Concentrated 14m x 14m core polygons centered on each named building's footprint centroid, rising vertically from building rooftops (`fill-extrusion-base = height`, `fill-extrusion-height = height + (eui * 0.75)`, where the GeoJSON feature property `eui` is set to the numeric `building.eui.annualTotal`). Color dynamically using MapLibre `step` expression:
  - Efficient (< 160 kWh/m²): Green `#10B981`
  - Moderate (160–200 kWh/m²): Yellow `#F59E0B`
  - Energy Intensive (> 200 kWh/m²): Red `#EF4444`
- Revised 3D Bus Renderer (`ntu-bus-3d`): Three.js custom layer registered strictly *after* route polylines (layer ordering: roads -> routes -> 3D buses). Self-illuminating materials (vibrant orange roof `#FF7200`, crisp white chassis, warm white glowing headlights, taillights, rubber wheels) with 2.5x scale factor. Bus markers show service number, load and "Live GPS (LTA)" on tooltip/inspector.
- Three.js Local Campus Matrix Anchor: In `lib/threeBusLayer.ts`, extract the camera projection matrix from `options?.defaultProjectionData?.mainMatrix` (or `options` if passed as a `Float64Array`) to obtain MapLibre's Mercator matrix. Anchor it to NTU Center `[103.6835, 1.3455]` using double-precision matrix multiplication (`camera.projectionMatrix = m.multiply(l)`, where `l` translates to the campus origin and scales with `meterInMercatorCoordinateUnits()`). Position each active bus in local meters `(dx, dy, dz)` relative to NTU Center so WebGL 32-bit float shaders render crisp, full-sized 3D vehicles without precision loss or depth clipping.
- Render-loop hygiene: never call `map.triggerRepaint()` from a custom layer's `render()` (it redraws the map at 60 fps forever). Repaint only when data changes. In `syncSources`, only `setData` / `setProps` / `setSky` when the input references changed, and pass a stable empty array (not a fresh `[]`) for missing bus data. Idle GPU draw calls should be ~0 between 5 s polls.
- Start-up: `lib/photorealistic.ts` (deck.gl + loaders.gl, ~1 MB) must be loaded with a dynamic `import()` the first time Real 3D is switched on — never statically from `MapCanvas`. MapLibre itself costs ~400 ms of start-up stalls (WebGL init, shaders, workers) regardless of our data, so `MapCanvas` shows a splash until the map's first `idle` (8 s fallback) and fades it out.
- MapLibre Async Data Synchronization: `components/MapCanvas.tsx` must store incoming `activeBuses`, `buildingsGeoJson`, and `stopsAndRoutesGeoJson` in `useRef`s or sync them both on `map.on('load')` and inside update effects. If `map.isStyleLoaded()` is false when new data arrives, defer source updates until the `load` or `styledata` event so asynchronously fetched transit data is never dropped.
- Dark Basemap Specification: Set `style: 'https://tiles.openfreemap.org/styles/dark'` in `components/MapCanvas.tsx`. OpenFreeMap provides high-contrast dark vector tiles (PBF) with sharp typography, open CORS, zero API keys, and zero watermarks. Hide the basemap's own `building` / `building-3d` layers so they don't z-fight with `campus-3d-buildings`.
- Campus Energy Efficiency Bar Chart: Sorts and displays buildings ranked by efficiency (lowest EUI = rank #1) with click-to-fly 3D camera navigation.
- Building Energy Inspector HUD: Floating glassmorphic sheet showing 12-month energy profiles when a building or pillar is clicked.
- Attribution: show "© OpenStreetMap contributors", "Bus data © LTA DataMall" and "Air quality & lightning © NEA (data.gov.sg)" in the map attribution.
