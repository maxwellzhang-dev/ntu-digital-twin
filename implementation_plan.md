# Implementation Plan — NTU 3D Campus Digital Twin & Live Transit Tracker

Follows `.agents/rules/workspace.md`. Mirrors the NUS workshop file layout; the data layer differs and the haze / weather / real-world features are new.

| # | File | Purpose | Verification |
|---|------|---------|--------------|
| 0 | `scripts/fetch-osm.ts` | One-off Overpass snapshot → `data/ntu-buildings.json`, `data/ntu-facilities.json`, `data/ntu-transit.json` (retries, campus-boundary filter, stitched route LineStrings, closed-ring facilities). `--only=buildings,facilities,transit` | `npx tsx scripts/fetch-osm.ts` prints counts |
| 1 | `lib/types.ts` | `BuildingEnergy`, `CampusBuilding`, `ShuttleEta`, `BusStop`, `ActiveBus`, `CampusRoute`, `TransitState`, `EnvironmentState`, `FacilityStatus`, `LightningStrike` | `npx tsc --noEmit` |
| 2 | `lib/digitaltwin.ts` | Buildings from snapshot: height/floors/category/footprint + simulated 12-month EUI; GeoJSON for buildings & pillars | `/api/buildings` |
| 3 | `lib/transit.ts` | Stops/routes from snapshot; live buses from LTA v3 BusArrival (9 stops, 20 s cache, dedupe, bearing/arc from route); NTU shuttle schedule status | `/api/transit/buses` |
| 4 | `lib/environment.ts` | NEA PSI / PM2.5 / campus rain (S44) / lightning, last-good fallback on 429, facility status (NTU haze + rain rules, reference lightning rule) | replay a past storm with a mocked `Date.now` |
| 5 | `app/api/*/route.ts` | `buildings`, `facilities`, `transit/stops` (cached with `'use cache'` + `cacheLife('hours')`), `transit/buses`, `environment` (request time via `connection()`) | `npm run build` route table |
| 6 | `components/MapCanvas.tsx` | MapLibre + OpenFreeMap dark, satellite raster, light, labels, facilities, lightning, haze sky + overlay, layer visibility, fly-to | browser |
| 7 | `lib/threeBusLayer.ts` | Three.js custom layer `ntu-bus-3d`, anchored at `[103.6835, 1.3455]`, 2.5x scale | browser |
| 8 | `lib/photorealistic.ts` | Google Photorealistic 3D Tiles via deck.gl `Tile3DLayer` + `TerrainExtension`-draped routes, stops, buses, facilities; attribution collection | browser with `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` |
| 9 | `components/BusTracker.tsx`, `EnvironmentPanel.tsx`, `CampusEnergyChart.tsx`, `BuildingEnergyModal.tsx`, `LayerToggles.tsx` | HUD panels | browser |
| 10 | `app/page.tsx` | Client page; fetches in `useEffect`; polls buses (5 s) and environment (60 s); `dynamic(..., { ssr: false })` MapCanvas | `npm run build` |
