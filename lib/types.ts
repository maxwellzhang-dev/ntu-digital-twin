export type BuildingCategory = 'academic' | 'residential' | 'recreation' | 'admin';

export interface MonthlyEnergy {
  month: string;
  cooling: number;
  equipment: number;
  lighting: number;
  total: number;
}

export interface BuildingEnergy {
  /** kWh/m²/year — simulated (no public NTU energy data). */
  annualTotal: number;
  monthlyBreakdown: MonthlyEnergy[];
}

export interface CampusBuilding {
  id: string;
  name: string;
  category: BuildingCategory;
  height: number;
  floorCount: number;
  latitude: number;
  longitude: number;
  eui: BuildingEnergy;
  footprint?: [number, number][];
}

export interface ShuttleEta {
  route: string;
  stopCode: string;
  etaMin: number;
  monitored: boolean;
}

export interface BusStop {
  code: string;
  name: string;
  lat: number;
  lng: number;
  routes: string[];
}

export type BusLoad = 'SEA' | 'SDA' | 'LSD';

export interface ActiveBus {
  id: string;
  route: string;
  plate: string | null;
  tripStart: string | null;
  status: 'IN_SERVICE' | 'AT_TERMINAL';
  lat: number;
  lng: number;
  bearing: number;
  speedKmh: number | null;
  arcM: number;
  routeLengthM: number;
  prevStop: string | null;
  anchorStop: string;
  anchorEtaMin: number;
  segmentFraction: number | null;
  errorBoundM: number;
  load: BusLoad | null;
  busType: string | null;
  occupancy: { ridership: number | null; capacity: number | null };
}

export interface CampusRoute {
  route: string;
  name: string;
  kind: 'ntu-shuttle' | 'public';
  color: string;
  length_m: number;
  closed: boolean;
  stops: { code: string; arc_m: number; seq: number }[];
  coordinates: [number, number][];
}

export interface ShuttleServiceStatus {
  route: string;
  name: string;
  color: string;
  inService: boolean;
  hours: string;
}

export interface TransitState {
  asOf: string;
  upstreamLastUpdated: string | null;
  stale: boolean;
  estimated: boolean;
  buses: ActiveBus[];
  shuttles: ShuttleServiceStatus[];
}

export interface PsiBand {
  label: string;
  color: string;
  advice: string;
}

export interface LightningStrike {
  lat: number;
  lng: number;
  /** C = cloud-to-cloud, G = cloud-to-ground */
  type: 'C' | 'G';
  datetime: string;
}

export interface FacilityStatus {
  id: string;
  name: string;
  kind: 'pool' | 'outdoor' | 'indoor';
  latitude: number;
  longitude: number;
  status: 'open' | 'closed' | 'unknown';
  reasons: string[];
}

export interface EnvironmentState {
  asOf: string;
  region: 'west';
  psi24h: number | null;
  pm25OneHour: number | null;
  airUpdatedAt: string | null;
  band: PsiBand;
  lightning: LightningStrike[];
  lightningTotal: number;
  lightningOk: boolean;
  airOk: boolean;
  /** true when a source failed and its last good reading (< 30 min old) is shown instead */
  stale: boolean;
  /** mm in the latest 5-min reading at the on-campus NEA gauge (S44 Nanyang Avenue). */
  rainMm: number | null;
  rules: { hazeOutdoorPsi: number; rainStationId: string; lightningRadiusKm: number; lightningWindowMin: number };
  facilities: FacilityStatus[];
}
