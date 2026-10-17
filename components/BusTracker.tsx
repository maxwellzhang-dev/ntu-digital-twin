'use client';

import { Bus, Moon, RadioTower } from 'lucide-react';
import type { TransitState } from '@/lib/types';

const LOAD: Record<string, { label: string; color: string }> = {
  SEA: { label: 'Seats', color: '#10B981' },
  SDA: { label: 'Standing', color: '#F59E0B' },
  LSD: { label: 'Crowded', color: '#EF4444' },
};

interface Props {
  transit: TransitState | null;
  secondsToRefresh: number;
  onBusClick: (lng: number, lat: number) => void;
}

export default function BusTracker({ transit, secondsToRefresh, onBusClick }: Props) {
  const buses = [...(transit?.buses ?? [])].sort((a, b) => a.route.localeCompare(b.route) || a.anchorEtaMin - b.anchorEtaMin);

  return (
    <section className="rounded-2xl border border-white/10 bg-slate-950/75 p-4 text-slate-100 shadow-2xl backdrop-blur-xl">
      <header className="mb-3 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-sm font-semibold tracking-wide">
          <RadioTower className="h-4 w-4 text-orange-400" /> Live Transit
        </h2>
        <span className="font-mono text-[11px] text-slate-400">
          {transit?.stale ? 'stale · ' : ''}refresh {secondsToRefresh}s
        </span>
      </header>

      <div className="mb-1 text-[11px] uppercase tracking-wider text-slate-400">Public buses · Live GPS (LTA)</div>
      {buses.length === 0 ? (
        <div className="mb-3 flex items-center gap-2 rounded-lg bg-white/5 px-3 py-2 text-xs text-slate-300">
          <Moon className="h-4 w-4 shrink-0 text-slate-400" />
          No 179 / 199 buses reporting GPS right now. Services usually resume around 05:30 SGT.
        </div>
      ) : (
        <ul className="mb-3 max-h-44 space-y-1 overflow-y-auto pr-1">
          {buses.map((b) => (
            <li key={b.id}>
              <button
                onClick={() => onBusClick(b.lng, b.lat)}
                className="flex w-full items-center gap-2 rounded-lg bg-white/5 px-2.5 py-1.5 text-left text-xs transition hover:bg-white/10"
              >
                <Bus className="h-3.5 w-3.5 text-orange-400" />
                <span className="w-9 font-mono font-semibold">{b.route}</span>
                <span className="flex-1 truncate text-slate-300">→ {b.anchorStop}</span>
                <span className="font-mono text-slate-200">{b.anchorEtaMin === 0 ? 'Arr' : `${b.anchorEtaMin}m`}</span>
                {b.load && <span className="h-2 w-2 rounded-full" style={{ background: LOAD[b.load]?.color }} title={LOAD[b.load]?.label} />}
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="mb-1 text-[11px] uppercase tracking-wider text-slate-400">NTU campus shuttles · schedule only</div>
      <ul className="space-y-1">
        {(transit?.shuttles ?? []).map((s) => (
          <li key={s.route} className="flex items-center gap-2 text-xs" title={s.hours}>
            <span className="h-2.5 w-2.5 rounded-sm" style={{ background: s.color }} />
            <span className="flex-1 truncate">{s.name}</span>
            <span className={s.inService ? 'text-emerald-400' : 'text-slate-500'}>{s.inService ? 'In service' : 'Not running'}</span>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-[10px] leading-snug text-slate-500">NTU shuttles have no public live feed — use the NTU Omnibus app for their real-time positions.</p>
    </section>
  );
}
