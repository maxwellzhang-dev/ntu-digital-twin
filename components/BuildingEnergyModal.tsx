'use client';

import { X } from 'lucide-react';
import type { CampusBuilding } from '@/lib/types';

const SEGMENTS = [
  { key: 'cooling', label: 'Cooling', color: '#38bdf8' },
  { key: 'equipment', label: 'Equipment', color: '#a78bfa' },
  { key: 'lighting', label: 'Lighting', color: '#fbbf24' },
] as const;

const rating = (eui: number) =>
  eui < 160 ? { label: 'Efficient', color: '#10B981' } : eui <= 200 ? { label: 'Moderate', color: '#F59E0B' } : { label: 'Energy intensive', color: '#EF4444' };

export default function BuildingEnergyModal({ building, onClose }: { building: CampusBuilding; onClose: () => void }) {
  const months = building.eui.monthlyBreakdown;
  const max = Math.max(...months.map((m) => m.total));
  const r = rating(building.eui.annualTotal);

  return (
    <aside className="rounded-2xl border border-white/10 bg-slate-950/80 p-4 text-slate-100 shadow-2xl backdrop-blur-xl">
      <header className="mb-3 flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold leading-snug">{building.name}</h2>
          <p className="mt-0.5 text-[11px] capitalize text-slate-400">
            {building.category} · {building.floorCount} floors · {Math.round(building.height)} m
          </p>
        </div>
        <button onClick={onClose} className="rounded-md p-1 text-slate-400 hover:bg-white/10 hover:text-white" aria-label="Close">
          <X className="h-4 w-4" />
        </button>
      </header>

      <div className="mb-3 flex items-end gap-3">
        <div className="font-mono text-3xl font-semibold">{building.eui.annualTotal}</div>
        <div className="pb-1 text-[11px] text-slate-400">kWh/m²/yr</div>
        <span className="ml-auto rounded-full px-2 py-0.5 text-[11px] font-medium" style={{ background: `${r.color}22`, color: r.color }}>
          {r.label}
        </span>
      </div>

      <div className="flex h-28 items-end gap-1">
        {months.map((m) => (
          <div key={m.month} className="flex flex-1 flex-col items-center gap-1" title={`${m.month}: ${m.total.toFixed(1)} kWh/m²`}>
            <div className="flex w-full flex-col-reverse overflow-hidden rounded-sm" style={{ height: `${(m.total / max) * 96}px` }}>
              {SEGMENTS.map((s) => (
                <div key={s.key} style={{ height: `${(m[s.key] / m.total) * 100}%`, background: s.color }} />
              ))}
            </div>
            <span className="text-[9px] text-slate-500">{m.month[0]}</span>
          </div>
        ))}
      </div>

      <div className="mt-3 flex gap-3 text-[10px] text-slate-400">
        {SEGMENTS.map((s) => (
          <span key={s.key} className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-sm" style={{ background: s.color }} /> {s.label}
          </span>
        ))}
        <span className="ml-auto">simulated data</span>
      </div>
    </aside>
  );
}
