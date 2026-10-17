'use client';

import dynamic from 'next/dynamic';
import { useEffect, useMemo, useState } from 'react';
import { Building2, MapPin } from 'lucide-react';
import BusTracker from '@/components/BusTracker';
import CampusEnergyChart from '@/components/CampusEnergyChart';
import BuildingEnergyModal from '@/components/BuildingEnergyModal';
import EnvironmentPanel from '@/components/EnvironmentPanel';
import LayerToggles from '@/components/LayerToggles';
import type { FlyTarget, LayerVisibility } from '@/components/MapCanvas';
import type { CampusBuilding, EnvironmentState, TransitState } from '@/lib/types';

const MapCanvas = dynamic(() => import('@/components/MapCanvas'), { ssr: false });

type FC = GeoJSON.FeatureCollection;
const POLL_SECONDS = 5;
const ENV_POLL_MS = 60_000;

const LANDMARKS: { name: string; center: [number, number]; pitch: number; bearing: number }[] = [
  { name: 'The Hive', center: [103.6827, 1.3432], pitch: 65, bearing: 30 },
  { name: 'North Spine', center: [103.6809, 1.3464], pitch: 60, bearing: -30 },
  { name: 'Admin Building', center: [103.681, 1.3445], pitch: 55, bearing: 10 },
  { name: 'The Arc', center: [103.6816, 1.3476], pitch: 60, bearing: 45 },
  { name: 'Swimming Complex', center: [103.688, 1.3497], pitch: 60, bearing: 20 },
  { name: 'Pioneer MRT', center: [103.6974, 1.3376], pitch: 60, bearing: -60 },
];

export default function Home() {
  const [buildings, setBuildings] = useState<CampusBuilding[]>([]);
  const [buildingsGeoJson, setBuildingsGeoJson] = useState<FC | null>(null);
  const [pillarsGeoJson, setPillarsGeoJson] = useState<FC | null>(null);
  const [stopsAndRoutes, setStopsAndRoutes] = useState<{ stops: FC; routes: FC } | null>(null);
  const [facilitiesGeoJson, setFacilitiesGeoJson] = useState<FC | null>(null);
  const [transit, setTransit] = useState<TransitState | null>(null);
  const [environment, setEnvironment] = useState<EnvironmentState | null>(null);
  const [countdown, setCountdown] = useState(POLL_SECONDS);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [flyTarget, setFlyTarget] = useState<FlyTarget | null>(null);
  const [layers, setLayers] = useState<LayerVisibility>({ photoreal: false, satellite: false, transit: true, facilities: true, haze: true, energy: false });

  useEffect(() => {
    fetch('/api/buildings')
      .then((r) => r.json())
      .then((d) => {
        setBuildings(d.buildings);
        setBuildingsGeoJson(d.buildingsGeoJson);
        setPillarsGeoJson(d.pillarsGeoJson);
      })
      .catch(console.error);
    fetch('/api/transit/stops')
      .then((r) => r.json())
      .then(setStopsAndRoutes)
      .catch(console.error);
    fetch('/api/facilities')
      .then((r) => r.json())
      .then(setFacilitiesGeoJson)
      .catch(console.error);
  }, []);

  useEffect(() => {
    const load = () =>
      fetch('/api/environment')
        .then((r) => r.json())
        .then(setEnvironment)
        .catch(console.error);
    load();
    const t = setInterval(load, ENV_POLL_MS);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    let left = 0;
    const tick = () => {
      if (left <= 0) {
        left = POLL_SECONDS;
        fetch('/api/transit/buses')
          .then((r) => r.json())
          .then(setTransit)
          .catch(console.error);
      }
      setCountdown(left);
      left -= 1;
    };
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, []);

  const selected = useMemo(() => buildings.find((b) => b.id === selectedId) ?? null, [buildings, selectedId]);

  const flyTo = (center: [number, number], opts: Partial<FlyTarget> = {}) => setFlyTarget({ center, key: Date.now(), ...opts });

  const selectBuilding = (b: CampusBuilding) => {
    setSelectedId(b.id);
    setLayers((l) => ({ ...l, energy: true }));
    flyTo([b.longitude, b.latitude], { zoom: 17.6, pitch: 62 });
  };

  return (
    <main className="relative h-dvh w-full overflow-hidden bg-[#0b1120]">
      <MapCanvas
        buildingsGeoJson={buildingsGeoJson}
        pillarsGeoJson={pillarsGeoJson}
        stopsAndRoutes={stopsAndRoutes}
        facilitiesGeoJson={facilitiesGeoJson}
        environment={environment}
        buses={transit?.buses ?? []}
        layers={layers}
        flyTarget={flyTarget}
        onBuildingClick={setSelectedId}
      />

      <header className="pointer-events-none absolute inset-x-0 top-0 flex flex-wrap items-start justify-between gap-3 p-4">
        <div className="pointer-events-auto rounded-2xl border border-white/10 bg-slate-950/75 px-4 py-3 text-slate-100 shadow-2xl backdrop-blur-xl">
          <h1 className="flex items-center gap-2 text-base font-semibold tracking-tight">
            <Building2 className="h-5 w-5 text-sky-400" /> NTU 3D Digital Twin
          </h1>
          <p className="text-[11px] text-slate-400">Yunnan Garden Campus · live buses, air quality & facilities</p>
        </div>
        <div className="pointer-events-auto flex flex-col items-end gap-2">
          <LayerToggles layers={layers} onChange={setLayers} />
          <nav className="flex flex-wrap justify-end gap-1.5">
            {LANDMARKS.map((l) => (
              <button
                key={l.name}
                onClick={() => flyTo(l.center, { pitch: l.pitch, bearing: l.bearing, zoom: 17.4 })}
                className="flex items-center gap-1 rounded-full border border-white/10 bg-slate-950/75 px-3 py-1.5 text-xs text-slate-200 backdrop-blur-xl transition hover:border-sky-400/50 hover:text-white"
              >
                <MapPin className="h-3 w-3 text-sky-400" /> {l.name}
              </button>
            ))}
          </nav>
        </div>
      </header>

      <div className="pointer-events-none absolute bottom-10 left-4 top-28 flex w-[min(340px,calc(100vw-2rem))] flex-col gap-3 overflow-y-auto">
        <div className="pointer-events-auto">
          <EnvironmentPanel environment={environment} onFacilityClick={(lng, lat) => flyTo([lng, lat], { zoom: 17.8, pitch: 60 })} />
        </div>
        <div className="pointer-events-auto">
          <BusTracker transit={transit} secondsToRefresh={countdown} onBusClick={(lng, lat) => flyTo([lng, lat], { zoom: 17.8, pitch: 65 })} />
        </div>
      </div>

      <div className="pointer-events-none absolute bottom-10 right-14 top-36 hidden w-[320px] flex-col gap-3 md:flex">
        {selected && (
          <div className="pointer-events-auto">
            <BuildingEnergyModal building={selected} onClose={() => setSelectedId(null)} />
          </div>
        )}
        <div className="pointer-events-auto flex min-h-0 flex-1 flex-col">
          <CampusEnergyChart buildings={buildings} onSelect={selectBuilding} />
        </div>
      </div>
    </main>
  );
}
